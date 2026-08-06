import path from "node:path";

export function loadConfig(rootDir) {
  const playbackRegion = String(process.env.PLAYBACK_REGION || "US").toUpperCase();
  return {
    port: Number(process.env.PORT || 3417),
    host: process.env.HOST || "127.0.0.1",
    adminToken: String(process.env.ADMIN_TOKEN || ""),
    youtubeApiKey: String(process.env.YOUTUBE_API_KEY || ""),
    playbackRegion: /^[A-Z]{2}$/.test(playbackRegion) ? playbackRegion : "US",
    trustProxy: String(process.env.TRUST_PROXY).toLowerCase() === "true",
    stateFile: path.join(rootDir, "data", "state.json"),
    permanentVideoErrors: new Set([100, 101, 150]),
    probeBlockingErrors: new Set([5, 100, 101, 150]),
    transientVideoErrors: new Set([105]),
    probeTtlMs: 120_000
  };
}
