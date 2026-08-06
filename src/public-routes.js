import crypto from "node:crypto";
import { clean, normalizeRequester, playerErrorMessage, requesterKey } from "./utils.js";

export function registerPublicRoutes({ app, config, store, youtube, requestLimiter, searchLimiter }) {
  const probes = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [token, session] of probes) {
      if (session.expiresAt <= now) probes.delete(token);
    }
  }, 60_000).unref();

  function makeProbe(video, requester, note, ip) {
    const token = crypto.randomUUID();
    probes.set(token, {
      video,
      requester,
      note,
      requesterKey: requesterKey(requester, ip),
      expiresAt: Date.now() + config.probeTtlMs
    });
    return token;
  }

  function takeProbe(token, requester, ip) {
    const safeToken = clean(token, 80);
    const session = probes.get(safeToken);
    if (!session || session.expiresAt < Date.now()) {
      probes.delete(safeToken);
      return { error: "That playback test expired. Choose the song again." };
    }
    if (session.requester !== requester
      || session.requesterKey !== requesterKey(requester, ip)) {
      return { error: "That playback test belongs to another request session." };
    }
    probes.delete(safeToken);
    return { session };
  }

  app.get("/api/health", (_req, res) => res.json({
    ok: true,
    app: "CinderQuest",
    youtubeApiConfigured: Boolean(config.youtubeApiKey),
    time: new Date().toISOString()
  }));

  app.get("/api/public-state", (_req, res) => res.json(store.publicState()));

  app.get("/api/search", searchLimiter, async (req, res, next) => {
    try {
      if (!store.state.settings.allowSearch) {
        return res.status(403).json({ error: "Search is disabled. Paste a YouTube URL instead." });
      }
      const query = clean(req.query.q, 100);
      if (query.length < 2) {
        return res.status(400).json({ error: "Search needs at least two characters." });
      }
      const body = await youtube.youtubeGet("search", {
        part: "snippet",
        type: "video",
        videoEmbeddable: "true",
        maxResults: 10,
        safeSearch: "moderate",
        q: query
      });
      const ids = (body.items || []).map((item) => item.id?.videoId).filter(Boolean);
      const videos = await youtube.fetchVideos(ids);
      const byId = new Map(videos.map((video) => [video.videoId, video]));
      const items = [];
      let excludedCount = 0;
      for (const id of ids) {
        const video = byId.get(id);
        if (!video || youtube.contentRule(video)) excludedCount += 1;
        else items.push(video);
        if (items.length >= 8) break;
      }
      res.json({ items, excludedCount });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/video-preview", requestLimiter, async (req, res, next) => {
    try {
      const id = youtube.extractVideoId(req.body?.input);
      if (!id) return res.status(400).json({ error: "Paste a valid YouTube video URL or ID." });
      const video = await youtube.fetchVideo(id);
      const error = youtube.contentRule(video);
      if (error) return res.status(400).json({ error, videoId: id });
      res.json({ ok: true, video });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/requests/probe", requestLimiter, async (req, res, next) => {
    try {
      const requester = normalizeRequester(req.body?.requester);
      const id = youtube.extractVideoId(req.body?.input || req.body?.videoId);
      if (!id) return res.status(400).json({ error: "Choose a valid YouTube video first." });
      const video = await youtube.fetchVideo(id);
      const error = youtube.requestRule(video, requester, req.ip);
      if (error) return res.status(400).json({ error, videoId: id });
      res.status(201).json({
        ok: true,
        probeToken: makeProbe(video, requester, clean(req.body?.note, 160), req.ip),
        expiresInSec: config.probeTtlMs / 1000,
        video
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/requests/probe/:token/pass", requestLimiter, (req, res) => {
    const requester = normalizeRequester(req.body?.requester);
    const result = takeProbe(req.params.token, requester, req.ip);
    if (result.error) return res.status(410).json({ error: result.error });
    const { session } = result;
    const error = youtube.requestRule(session.video, requester, req.ip);
    if (error) return res.status(400).json({ error });
    const item = {
      ...session.video,
      id: crypto.randomUUID(),
      requester,
      requesterKey: session.requesterKey,
      note: session.note,
      source: "request",
      status: store.state.settings.requireApproval ? "pending" : "queued",
      playbackTestedAt: new Date().toISOString(),
      requestedAt: new Date().toISOString()
    };
    store.state.queue.push(item);
    store.persist();
    res.status(201).json({
      ok: true,
      item: { ...item, requesterKey: undefined },
      position: item.status === "queued" ? store.queuePosition(item.id) : null,
      message: item.status === "pending"
        ? "Playback test passed. Request submitted for approval."
        : "Playback test passed. Your song is in the queue."
    });
  });

  app.post("/api/requests/probe/:token/fail", requestLimiter, (req, res) => {
    const requester = normalizeRequester(req.body?.requester);
    const result = takeProbe(req.params.token, requester, req.ip);
    if (result.error) return res.status(410).json({ error: result.error });
    const code = Number(req.body?.errorCode || 0);
    const reason = clean(req.body?.reason, 180) || playerErrorMessage(code);
    const blocked = config.probeBlockingErrors.has(code);
    if (blocked) {
      store.markBad(result.session.video, code, reason, "viewer_probe");
      store.persist(true);
    }
    res.json({
      ok: true,
      blocked,
      videoId: result.session.video.videoId,
      reason,
      message: blocked
        ? "This video failed the playback test and has been blocked."
        : reason
    });
  });

  app.post("/api/requests", requestLimiter, (_req, res) => res.status(409).json({
    error: "Playback testing is required. Use the current request page."
  }));
}
