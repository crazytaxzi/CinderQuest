import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { Server } from "socket.io";
import { loadConfig } from "./src/config.js";
import { createStore } from "./src/store.js";
import { createYoutubeService } from "./src/youtube.js";
import { registerPublicRoutes } from "./src/public-routes.js";
import { registerAdminRoutes } from "./src/admin-routes.js";
import { registerSocketHandlers } from "./src/socket.js";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig(rootDir);
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

if (!config.adminToken) console.warn("[Cinder is annoyed] ADMIN_TOKEN is not configured.");
if (config.trustProxy) app.set("trust proxy", 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      upgradeInsecureRequests: null,
      scriptSrc: ["'self'", "https://www.youtube.com", "https://s.ytimg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https://i.ytimg.com", "https://yt3.ggpht.com"],
      frameSrc: ["https://www.youtube.com", "https://www.youtube-nocookie.com"],
      connectSrc: ["'self'", "ws:", "wss:"],
      mediaSrc: ["'self'", "blob:"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'", "http://localhost:*", "http://127.0.0.1:*"]
    }
  },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));

app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  const host = String(req.get("host") || "").split(":")[0];
  if (["0.0.0.0", "::"].includes(host)) {
    return res.redirect(307, `http://127.0.0.1:${config.port}${req.originalUrl}`);
  }
  next();
});
app.use(express.static(path.join(rootDir, "public"), {
  extensions: ["html"],
  etag: true,
  maxAge: 0,
  setHeaders: (res, filePath) => {
    if (/\.(?:html|js|css)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));

const requestLimiter = rateLimit({
  windowMs: 60_000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Easy, eager fingers. Give it a minute before touching the queue again." }
});
const searchLimiter = rateLimit({
  windowMs: 60_000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "The YouTube hunt needs a breather. Slip me a direct link for now." }
});

const store = createStore({ io, config });
const youtube = createYoutubeService({ config, store });
registerPublicRoutes({ app, config, store, youtube, requestLimiter, searchLimiter });
const { isAdmin } = registerAdminRoutes({ app, io, config, store, youtube });
registerSocketHandlers({ io, store, isAdmin });

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = Number(error.status || 500);
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: status >= 500
      ? "Something jammed in Cinder’s machinery. The server console knows who did it."
      : error.message
  });
});

httpServer.listen(config.port, config.host, () => {
  const displayHost = ["0.0.0.0", "::"].includes(config.host)
    ? "127.0.0.1"
    : config.host;
  console.log(`
CinderQuest is awake.
Listening: ${config.host}:${config.port}
Viewer pit: http://${displayHost}:${config.port}/
Control room: http://${displayHost}:${config.port}/dashboard
Player stage: http://${displayHost}:${config.port}/player
HellGlass overlay: http://${displayHost}:${config.port}/overlay
Emergency mixtape: ${store.state.fallbackPlaylist.title || "nothing loaded"} (${store.state.fallbackPlaylist.items.length} usable tracks)
`);
});

function shutdown(signal) {
  console.log(`${signal}: Cinder is saving everything before the lights go out.`);
  try {
    store.saveNow();
  } catch (error) {
    console.error(error);
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
