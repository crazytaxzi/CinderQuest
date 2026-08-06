import { clean, clamp } from "./utils.js";

export function registerSocketHandlers({ io, store, isAdmin }) {
  io.on("connection", (socket) => {
    socket.emit("state:update", store.publicState());

    socket.on("admin:register", (token, callback = () => {}) => {
      if (!isAdmin(token)) return callback({ ok: false, error: "Bad admin token." });
      socket.join("admin");
      callback({ ok: true, state: store.adminState() });
    });

    socket.on("player:register", (token, callback = () => {}) => {
      if (!isAdmin(token)) return callback({ ok: false, error: "Bad admin token." });
      socket.join("player");
      socket.join("admin");
      callback({ ok: true, state: store.adminState() });
    });

    socket.on("player:progress", (payload = {}, callback = () => {}) => {
      if (!socket.rooms.has("player")) return callback({ ok: false });
      store.state.playback = {
        status: clean(payload.status, 20) || store.state.playback.status,
        progressSec: clamp(payload.progressSec, 0, 86400, store.state.playback.progressSec),
        durationSec: clamp(payload.durationSec, 0, 86400, store.state.playback.durationSec),
        updatedAt: new Date().toISOString()
      };
      io.emit("playback:update", store.state.playback);
      callback({ ok: true });
    });

    socket.on("player:error", (payload = {}) => {
      if (!socket.rooms.has("player")) return;
      console.error("YouTube player error:", payload.code, payload.videoId);
      io.to("admin").emit("admin:alert", {
        type: "error",
        message: `YouTube player error ${payload.code} for ${payload.videoId || "unknown video"}.`
      });
    });
  });
}
