import crypto from "node:crypto";
import { clean, clamp } from "./utils.js";

export function registerAdminRoutes({ app, io, config, store, youtube }) {
  function isAdmin(token) {
    const supplied = Buffer.from(String(token || ""));
    const expected = Buffer.from(config.adminToken);
    return supplied.length > 0
      && supplied.length === expected.length
      && crypto.timingSafeEqual(supplied, expected);
  }

  function adminOnly(req, res, next) {
    const token = req.get("x-admin-token") || req.body?.adminToken;
    if (!isAdmin(token)) return res.status(401).json({ error: "That token does not open Cinder’s control room." });
    next();
  }

  app.post("/api/admin/auth", adminOnly, (_req, res) => {
    res.json({ ok: true, state: store.adminState() });
  });

  app.get("/api/admin/state", adminOnly, (_req, res) => {
    res.json(store.adminState());
  });

  app.patch("/api/admin/settings", adminOnly, (req, res) => {
    const next = req.body || {};
    const settings = store.state.settings;
    store.state.settings = {
      ...settings,
      streamName: clean(next.streamName ?? settings.streamName, 80),
      queueOpen: Boolean(next.queueOpen),
      requireApproval: Boolean(next.requireApproval),
      maxQueue: clamp(next.maxQueue, 1, 500, settings.maxQueue),
      maxDurationSec: clamp(next.maxDurationSec, 30, 7200, settings.maxDurationSec),
      cooldownSec: clamp(next.cooldownSec, 0, 86400, settings.cooldownSec),
      maxActivePerUser: clamp(next.maxActivePerUser, 1, 20, settings.maxActivePerUser),
      allowDuplicates: Boolean(next.allowDuplicates),
      allowSearch: Boolean(next.allowSearch),
      fallbackMode: next.fallbackMode === "sequential" ? "sequential" : "shuffle",
      volume: clamp(next.volume, 0, 100, settings.volume),
      blockedKeywords: Array.isArray(next.blockedKeywords)
        ? next.blockedKeywords.map((item) => clean(item, 60)).filter(Boolean).slice(0, 100)
        : settings.blockedKeywords,
      blockedChannels: Array.isArray(next.blockedChannels)
        ? next.blockedChannels.map((item) => clean(item, 120)).filter(Boolean).slice(0, 100)
        : settings.blockedChannels
    };
    store.persist();
    io.to("player").emit("player:command", {
      action: "volume",
      value: store.state.settings.volume
    });
    res.json({ ok: true, settings: store.state.settings });
  });

  app.post("/api/admin/queue/:id/approve", adminOnly, (req, res) => {
    const item = store.state.queue.find((entry) => entry.id === req.params.id);
    if (!item) return res.status(404).json({ error: "That request slipped out of the queue before I could touch it." });
    item.status = "queued";
    item.approvedAt = new Date().toISOString();
    store.persist();
    res.json({ ok: true, item });
  });

  app.post("/api/admin/queue/:id/reject", adminOnly, (req, res) => {
    const index = store.state.queue.findIndex((entry) => entry.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "That request is already gone." });
    store.history(store.state.queue.splice(index, 1)[0], "rejected", req.body?.reason || "Cinder denied entry");
    store.persist();
    res.json({ ok: true });
  });

  app.delete("/api/admin/queue/:id", adminOnly, (req, res) => {
    const index = store.state.queue.findIndex((entry) => entry.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "That request already escaped the line." });
    store.history(store.state.queue.splice(index, 1)[0], "removed", "Cinder threw it out of the queue");
    store.persist();
    res.json({ ok: true });
  });

  app.post("/api/admin/queue/:id/move", adminOnly, (req, res) => {
    const approvedIndexes = store.state.queue
      .map((item, index) => item.status === "queued" ? index : -1)
      .filter((index) => index >= 0);
    const position = approvedIndexes.findIndex(
      (index) => store.state.queue[index].id === req.params.id
    );
    if (position < 0) return res.status(404).json({ error: "That song is not in the ready line anymore." });
    const target = req.body?.direction === "down" ? position + 1 : position - 1;
    if (target >= 0 && target < approvedIndexes.length) {
      const currentIndex = approvedIndexes[position];
      const targetIndex = approvedIndexes[target];
      [store.state.queue[currentIndex], store.state.queue[targetIndex]] =
        [store.state.queue[targetIndex], store.state.queue[currentIndex]];
    }
    store.persist();
    res.json({ ok: true });
  });

  app.post("/api/admin/player/next", adminOnly, (req, res) => {
    if (store.state.current) {
      store.finishCurrent("skipped", req.body?.reason || "Cinder got bored and skipped it");
    }
    const current = store.nextTrack();
    store.persist();
    io.to("player").emit("player:load", current);
    res.json({ ok: true, current });
  });

  app.post("/api/admin/player/play/:id", adminOnly, (req, res) => {
    const index = store.state.queue.findIndex(
      (item) => item.id === req.params.id && item.status === "queued"
    );
    if (index < 0) return res.status(404).json({ error: "That song is not waiting where I left it." });
    if (store.state.current) {
      store.finishCurrent("skipped", "Cinder replaced it with a more tempting request");
    }
    store.state.current = store.state.queue.splice(index, 1)[0];
    store.state.current.status = "playing";
    store.state.current.startedAt = new Date().toISOString();
    store.state.playback = {
      status: "loading",
      progressSec: 0,
      durationSec: store.state.current.durationSec,
      updatedAt: new Date().toISOString()
    };
    store.persist();
    io.to("player").emit("player:load", store.state.current);
    res.json({ ok: true, current: store.state.current });
  });

  app.post("/api/admin/player/command", adminOnly, (req, res) => {
    const action = clean(req.body?.action, 20);
    if (!["play", "pause", "stop", "mute", "unmute", "volume"].includes(action)) {
      return res.status(400).json({ error: "That player command is not one of Cinder’s tricks." });
    }
    const payload = {
      action,
      value: action === "volume"
        ? clamp(req.body?.value, 0, 100, store.state.settings.volume)
        : undefined
    };
    if (action === "volume") store.state.settings.volume = payload.value;
    store.persist();
    io.to("player").emit("player:command", payload);
    res.json({ ok: true });
  });

  app.post("/api/admin/player/halt", adminOnly, (req, res) => {
    if (store.state.current) {
      store.finishCurrent("failed", req.body?.reason || "Cinder restrained the player stage");
    }
    store.persist();
    io.to("player").emit("player:load", null);
    res.json({ ok: true });
  });

  app.post("/api/admin/player/ended", adminOnly, (req, res) => {
    const videoId = clean(req.body?.videoId, 20);
    if (store.state.current && videoId && videoId !== store.state.current.videoId) {
      return res.status(409).json({ error: "That message came from an old song. I ignored it." });
    }
    const code = Number(req.body?.errorCode || 0);
    const reason = clean(req.body?.reason, 160) || "The song finished behaving";
    const failed = Boolean(code) || /^YouTube player error/i.test(reason);
    if (failed && store.state.current && config.permanentVideoErrors.has(code)) {
      store.markBad(store.state.current, code, reason);
    }
    store.finishCurrent(failed ? "failed" : "played", reason);
    const current = store.nextTrack();
    store.persist(config.permanentVideoErrors.has(code));
    io.to("player").emit("player:load", current);
    res.json({ ok: true, current });
  });

  app.post("/api/admin/playlist/import", adminOnly, async (req, res, next) => {
    try {
      const playlistId = youtube.extractPlaylistId(req.body?.input);
      if (!playlistId) {
        return res.status(400).json({ error: "That is not a YouTube playlist I can get my hands around." });
      }
      const metadata = await youtube.youtubeGet("playlists", {
        part: "snippet,contentDetails,status",
        id: playlistId,
        maxResults: 1
      });
      const playlist = metadata.items?.[0];
      if (!playlist) return res.status(404).json({ error: "That playlist vanished or never wanted to be found." });

      let pageToken = "";
      let pages = 0;
      const ids = [];
      do {
        const page = await youtube.youtubeGet("playlistItems", {
          part: "contentDetails,status",
          playlistId,
          maxResults: 50,
          pageToken
        });
        for (const item of page.items || []) {
          if (item.status?.privacyStatus !== "private" && item.contentDetails?.videoId) {
            ids.push(item.contentDetails.videoId);
          }
        }
        pageToken = page.nextPageToken || "";
        pages += 1;
      } while (pageToken && pages < 20);

      const unique = [...new Set(ids)];
      const videos = await youtube.fetchVideos(unique);
      const byId = new Map(videos.map((video) => [video.videoId, video]));
      const usable = [];
      const skippedByReason = {};
      for (const id of unique) {
        const video = byId.get(id);
        const reason = youtube.filterReason(video);
        if (reason) skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;
        else usable.push(video);
      }

      store.state.fallbackPlaylist = {
        playlistId,
        sourceUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
        title: clean(playlist.snippet?.title, 180),
        items: usable,
        cursor: 0,
        importedAt: new Date().toISOString(),
        importSummary: {
          total: unique.length,
          imported: usable.length,
          skipped: unique.length - usable.length,
          skippedByReason,
          playbackRegion: config.playbackRegion
        }
      };
      store.persist(true);
      res.json({
        ok: true,
        title: store.state.fallbackPlaylist.title,
        imported: usable.length,
        skipped: unique.length - usable.length,
        skippedByReason,
        playbackRegion: config.playbackRegion,
        saved: true
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/admin/quarantine/:videoId", adminOnly, (req, res) => {
    const videoId = clean(req.params.videoId, 20);
    if (!store.state.badVideos[videoId]) {
      return res.status(404).json({ error: "That video is not on the no-touch list anymore." });
    }
    delete store.state.badVideos[videoId];
    store.persist(true);
    res.json({ ok: true, videoId });
  });

  app.delete("/api/admin/quarantine", adminOnly, (_req, res) => {
    const cleared = Object.keys(store.state.badVideos).length;
    store.state.badVideos = {};
    store.persist(true);
    res.json({ ok: true, cleared });
  });

  app.delete("/api/admin/playlist", adminOnly, (_req, res) => {
    store.state.fallbackPlaylist = {
      playlistId: "",
      sourceUrl: "",
      title: "",
      items: [],
      cursor: 0,
      importedAt: null,
      importSummary: {
        total: 0,
        imported: 0,
        skipped: 0,
        skippedByReason: {},
        playbackRegion: config.playbackRegion
      }
    };
    store.persist(true);
    res.json({ ok: true });
  });

  return { isAdmin };
}
