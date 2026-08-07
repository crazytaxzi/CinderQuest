import path from "node:path";

function intEnv(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

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
    databaseUrl: String(process.env.DATABASE_URL || ""),
    databaseSsl: String(process.env.DATABASE_SSL).toLowerCase() === "true",
    youtubeCacheTtlDays: intEnv("YOUTUBE_CACHE_TTL_DAYS", 30, 1, 30),
    youtubeSearchDailyBudget: intEnv("YOUTUBE_SEARCH_DAILY_BUDGET", 90, 1, 100),
    youtubeSearchCandidates: intEnv("YOUTUBE_SEARCH_CANDIDATES", 50, 8, 50),
    youtubeSearchDisplayLimit: intEnv("YOUTUBE_SEARCH_DISPLAY_LIMIT", 8, 1, 20),
    youtubeQuotaTimezone: String(process.env.YOUTUBE_QUOTA_TIMEZONE || "America/Los_Angeles"),
    permanentVideoErrors: new Set([100, 101, 105, 150]),
    probeBlockingErrors: new Set([100, 101, 105, 150]),
    probeTtlMs: 120_000
  };
}
