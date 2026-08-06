import { Pool } from "pg";

export function createDatabase({ config }) {
  let pool = null;
  let ready = false;
  let cleanupTimer = null;

  function requireReady() {
    if (!ready || !pool) {
      throw Object.assign(
        new Error("The PostgreSQL search cache is unavailable, so I refused to burn a fresh YouTube search call."),
        { status: 503 }
      );
    }
  }

  async function init() {
    if (!config.databaseUrl) {
      console.warn("[Cinder is guarding quota] DATABASE_URL is missing. YouTube search will stay unavailable.");
      return false;
    }

    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });

    pool.on("error", (error) => {
      ready = false;
      console.error("PostgreSQL pool error:", error);
    });

    try {
      await pool.query("SELECT 1");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS youtube_search_cache (
          cache_key TEXT PRIMARY KEY,
          normalized_query TEXT NOT NULL,
          region_code VARCHAR(2) NOT NULL,
          video_ids JSONB NOT NULL,
          fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL
        );

        CREATE INDEX IF NOT EXISTS youtube_search_cache_expires_idx
          ON youtube_search_cache (expires_at);

        CREATE TABLE IF NOT EXISTS youtube_video_cache (
          video_id TEXT PRIMARY KEY,
          payload JSONB NOT NULL,
          fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL
        );

        CREATE INDEX IF NOT EXISTS youtube_video_cache_expires_idx
          ON youtube_video_cache (expires_at);

        CREATE TABLE IF NOT EXISTS youtube_search_usage (
          quota_day DATE PRIMARY KEY,
          calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      ready = true;
      await cleanup();
      cleanupTimer = setInterval(() => {
        cleanup().catch((error) => console.error("PostgreSQL cache cleanup failed:", error));
      }, 6 * 60 * 60 * 1000);
      cleanupTimer.unref();
      return true;
    } catch (error) {
      ready = false;
      console.error("PostgreSQL cache initialization failed:", error);
      return false;
    }
  }

  async function cleanup() {
    if (!ready || !pool) return;
    await pool.query("DELETE FROM youtube_search_cache WHERE expires_at <= NOW()");
    await pool.query("DELETE FROM youtube_video_cache WHERE expires_at <= NOW()");
    await pool.query("DELETE FROM youtube_search_usage WHERE quota_day < CURRENT_DATE - INTERVAL '45 days'");
  }

  async function getSearch(cacheKey) {
    requireReady();
    const result = await pool.query(
      `SELECT video_ids, fetched_at
         FROM youtube_search_cache
        WHERE cache_key = $1 AND expires_at > NOW()`,
      [cacheKey]
    );
    const row = result.rows[0];
    return row
      ? {
          videoIds: Array.isArray(row.video_ids) ? row.video_ids : [],
          fetchedAt: row.fetched_at
        }
      : null;
  }

  async function setSearch({ cacheKey, normalizedQuery, regionCode, videoIds }) {
    requireReady();
    const expiresAt = new Date(Date.now() + config.youtubeCacheTtlDays * 86_400_000);
    await pool.query(
      `INSERT INTO youtube_search_cache
         (cache_key, normalized_query, region_code, video_ids, fetched_at, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW(), $5)
       ON CONFLICT (cache_key) DO UPDATE SET
         normalized_query = EXCLUDED.normalized_query,
         region_code = EXCLUDED.region_code,
         video_ids = EXCLUDED.video_ids,
         fetched_at = NOW(),
         expires_at = EXCLUDED.expires_at`,
      [cacheKey, normalizedQuery, regionCode, JSON.stringify(videoIds), expiresAt]
    );
  }

  async function getVideos(videoIds) {
    if (!ready || !pool || !videoIds.length) return new Map();
    const result = await pool.query(
      `SELECT video_id, payload
         FROM youtube_video_cache
        WHERE video_id = ANY($1::text[]) AND expires_at > NOW()`,
      [videoIds]
    );
    return new Map(result.rows.map((row) => [row.video_id, row.payload]));
  }

  async function setVideos(videos) {
    if (!ready || !pool || !videos.length) return;
    const expiresAt = new Date(Date.now() + config.youtubeCacheTtlDays * 86_400_000);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const video of videos) {
        await client.query(
          `INSERT INTO youtube_video_cache
             (video_id, payload, fetched_at, expires_at)
           VALUES ($1, $2::jsonb, NOW(), $3)
           ON CONFLICT (video_id) DO UPDATE SET
             payload = EXCLUDED.payload,
             fetched_at = NOW(),
             expires_at = EXCLUDED.expires_at`,
          [video.videoId, JSON.stringify(video), expiresAt]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function reserveSearchCall(quotaDay) {
    requireReady();
    const result = await pool.query(
      `INSERT INTO youtube_search_usage (quota_day, calls, updated_at)
       VALUES ($1, 1, NOW())
       ON CONFLICT (quota_day) DO UPDATE SET
         calls = youtube_search_usage.calls + 1,
         updated_at = NOW()
       WHERE youtube_search_usage.calls < $2
       RETURNING calls`,
      [quotaDay, config.youtubeSearchDailyBudget]
    );
    return result.rows[0]?.calls ?? null;
  }

  async function getSearchUsage(quotaDay) {
    if (!ready || !pool) return 0;
    const result = await pool.query(
      "SELECT calls FROM youtube_search_usage WHERE quota_day = $1",
      [quotaDay]
    );
    return Number(result.rows[0]?.calls || 0);
  }

  async function close() {
    clearInterval(cleanupTimer);
    ready = false;
    if (pool) await pool.end();
  }

  return {
    init,
    close,
    cleanup,
    getSearch,
    setSearch,
    getVideos,
    setVideos,
    reserveSearchCall,
    getSearchUsage,
    isReady: () => ready
  };
}
