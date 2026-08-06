import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { clean } from "./utils.js";

const DEFAULT_STATE = {
  version: 2,
  settings: {
    streamName: "Cinder's Request Pit",
    queueOpen: true,
    requireApproval: false,
    maxQueue: 100,
    maxDurationSec: 600,
    cooldownSec: 180,
    maxActivePerUser: 2,
    allowDuplicates: false,
    allowSearch: false,
    fallbackMode: "shuffle",
    volume: 70,
    blockedKeywords: ["10 hours", "earrape", "nightcore"],
    blockedChannels: []
  },
  queue: [],
  history: [],
  badVideos: {},
  current: null,
  fallbackPlaylist: {
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
      playbackRegion: "US"
    }
  },
  playback: { status: "idle", progressSec: 0, durationSec: 0, updatedAt: null }
};

export function createStore({ io, config }) {
  function loadState() {
    try {
      if (!fs.existsSync(config.stateFile)) return structuredClone(DEFAULT_STATE);
      const saved = JSON.parse(fs.readFileSync(config.stateFile, "utf8"));
      return {
        ...structuredClone(DEFAULT_STATE),
        ...saved,
        settings: { ...DEFAULT_STATE.settings, ...(saved.settings || {}) },
        badVideos: { ...(saved.badVideos || {}) },
        fallbackPlaylist: {
          ...DEFAULT_STATE.fallbackPlaylist,
          ...(saved.fallbackPlaylist || {}),
          importSummary: {
            ...DEFAULT_STATE.fallbackPlaylist.importSummary,
            ...(saved.fallbackPlaylist?.importSummary || {})
          }
        },
        playback: { ...DEFAULT_STATE.playback, ...(saved.playback || {}) }
      };
    } catch (error) {
      console.error("Could not load state:", error);
      return structuredClone(DEFAULT_STATE);
    }
  }

  const store = {
    state: loadState(),
    saveTimer: null,
    videoFilter: () => null
  };

  store.saveNow = () => {
    clearTimeout(store.saveTimer);
    fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
    const temp = `${config.stateFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(store.state, null, 2));
    fs.renameSync(temp, config.stateFile);
  };

  store.persist = (immediate = false) => {
    clearTimeout(store.saveTimer);
    if (immediate) store.saveNow();
    else store.saveTimer = setTimeout(store.saveNow, 80);
    io.emit("state:update", store.publicState());
    io.to("admin").emit("admin:update", store.adminState());
  };

  store.publicState = () => {
    const state = store.state;
    const queue = state.queue
      .filter((item) => item.status === "queued")
      .map(({ requesterKey: _key, note: _note, ...item }) => item);
    return {
      settings: {
        streamName: state.settings.streamName,
        queueOpen: state.settings.queueOpen,
        requireApproval: state.settings.requireApproval,
        maxDurationSec: state.settings.maxDurationSec,
        cooldownSec: state.settings.cooldownSec,
        allowSearch: state.settings.allowSearch && Boolean(config.youtubeApiKey),
        volume: state.settings.volume
      },
      current: state.current,
      playback: state.playback,
      queue,
      pendingCount: state.queue.filter((item) => item.status === "pending").length,
      fallback: {
        title: state.fallbackPlaylist.title,
        sourceUrl: state.fallbackPlaylist.sourceUrl,
        itemCount: state.fallbackPlaylist.items.length,
        importedAt: state.fallbackPlaylist.importedAt,
        importSummary: state.fallbackPlaylist.importSummary
      }
    };
  };

  store.adminState = () => ({
    ...store.publicState(),
    settings: store.state.settings,
    queue: store.state.queue,
    history: store.state.history.slice(0, 100),
    fallbackPlaylist: store.state.fallbackPlaylist,
    blockedVideos: Object.values(store.state.badVideos)
      .sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0)),
    diagnostics: {
      youtubeApiConfigured: Boolean(config.youtubeApiKey),
      adminTokenConfigured: Boolean(config.adminToken),
      playbackRegion: config.playbackRegion,
      quarantinedVideos: Object.keys(store.state.badVideos).length
    }
  });

  store.history = (item, status, reason = "") => {
    if (item) {
      store.state.history.unshift({
        ...item,
        status,
        endedAt: new Date().toISOString(),
        endReason: clean(reason, 160)
      });
    }
    store.state.history = store.state.history.slice(0, 500);
  };

  store.queuePosition = (id) => {
    const index = store.state.queue
      .filter((item) => item.status === "queued")
      .findIndex((item) => item.id === id);
    return index < 0 ? null : index + 1;
  };

  store.markBad = (video, errorCode, reason, source = "player") => {
    const previous = store.state.badVideos[video.videoId] || {};
    const now = new Date().toISOString();
    store.state.badVideos[video.videoId] = {
      videoId: video.videoId,
      title: clean(video.title || previous.title || "Unknown", 180),
      channelTitle: clean(video.channelTitle || previous.channelTitle, 120),
      errorCode: Number(errorCode || previous.errorCode || 0),
      reason: clean(reason || previous.reason, 180),
      source: clean(source, 40),
      firstSeenAt: previous.firstSeenAt || now,
      lastSeenAt: now,
      failureCount: Number(previous.failureCount || 0) + 1
    };
    store.state.fallbackPlaylist.items = store.state.fallbackPlaylist.items
      .filter((item) => item.videoId !== video.videoId);
    store.state.queue = store.state.queue
      .filter((item) => item.videoId !== video.videoId);
  };

  store.pickFallback = () => {
    const state = store.state;
    const items = state.fallbackPlaylist.items.filter((item) => !store.videoFilter(item));
    if (!items.length) return null;
    let selected;
    if (state.settings.fallbackMode === "sequential") {
      const index = state.fallbackPlaylist.cursor % items.length;
      selected = items[index];
      state.fallbackPlaylist.cursor = (index + 1) % items.length;
    } else {
      selected = items[Math.floor(Math.random() * items.length)];
    }
    return {
      ...selected,
      id: crypto.randomUUID(),
      requester: "Cinder's Playlist",
      requesterKey: "fallback",
      source: "playlist",
      status: "playing",
      requestedAt: new Date().toISOString(),
      startedAt: new Date().toISOString()
    };
  };

  store.nextTrack = () => {
    const index = store.state.queue.findIndex((item) => item.status === "queued");
    const next = index >= 0 ? store.state.queue.splice(index, 1)[0] : store.pickFallback();
    if (next) {
      next.status = "playing";
      next.startedAt ||= new Date().toISOString();
    }
    store.state.current = next || null;
    store.state.playback = {
      status: next ? "loading" : "idle",
      progressSec: 0,
      durationSec: next?.durationSec || 0,
      updatedAt: new Date().toISOString()
    };
    return next;
  };

  store.finishCurrent = (status, reason) => {
    if (store.state.current) store.history(store.state.current, status, reason);
    store.state.current = null;
    store.state.playback = {
      status: "idle",
      progressSec: 0,
      durationSec: 0,
      updatedAt: new Date().toISOString()
    };
  };

  return store;
}
