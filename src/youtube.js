import {
  clean,
  extractVideoId,
  extractPlaylistId,
  formatDuration,
  parseDuration,
  requesterKey
} from "./utils.js";

function normalizedSearchQuery(value) {
  return clean(value, 100).trim().toLowerCase().replace(/\s+/g, " ");
}

function quotaDay(timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function createYoutubeService({ config, store, database }) {
  const inFlightSearches = new Map();

  async function youtubeGet(resource, params) {
    if (!config.youtubeApiKey) {
      throw Object.assign(
        new Error("The YouTube API key is missing, so the hunt cannot leave the house."),
        { status: 503 }
      );
    }
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    for (const [key, value] of Object.entries({ ...params, key: config.youtubeApiKey })) {
      if (value !== "" && value != null) url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(
        new Error(body?.error?.message || `YouTube came back with a ${response.status}. Very helpful.`),
        { status: response.status }
      );
    }
    return body;
  }

  function mapVideo(video) {
    const durationSec = parseDuration(video.contentDetails?.duration);
    return {
      videoId: video.id,
      title: clean(video.snippet?.title, 180),
      channelId: video.snippet?.channelId || "",
      channelTitle: clean(video.snippet?.channelTitle, 120),
      thumbnail: video.snippet?.thumbnails?.medium?.url
        || video.snippet?.thumbnails?.default?.url
        || "",
      durationSec,
      durationLabel: formatDuration(durationSec),
      embeddable: video.status?.embeddable === true,
      hasEmbedHtml: Boolean(video.player?.embedHtml),
      privacyStatus: video.status?.privacyStatus || "unknown",
      uploadStatus: video.status?.uploadStatus || "unknown",
      ageRestricted: video.contentDetails?.contentRating?.ytRating === "ytAgeRestricted",
      regionRestriction: video.contentDetails?.regionRestriction || null,
      live: Boolean(video.liveStreamingDetails)
        || video.snippet?.liveBroadcastContent === "live"
    };
  }

  async function fetchVideos(ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return [];

    const cached = await database.getVideos(unique);
    const missing = unique.filter((id) => !cached.has(id));

    for (let index = 0; index < missing.length; index += 50) {
      const batch = missing.slice(index, index + 50);
      const body = await youtubeGet("videos", {
        part: "snippet,contentDetails,status,liveStreamingDetails,player",
        id: batch.join(","),
        fields: "items(id,snippet(title,channelId,channelTitle,liveBroadcastContent,thumbnails),contentDetails(duration,contentRating,regionRestriction),status(embeddable,privacyStatus,uploadStatus),liveStreamingDetails,player/embedHtml)"
      });
      const returned = new Map();
      for (const rawVideo of body.items || []) {
        const video = mapVideo(rawVideo);
        returned.set(video.videoId, video);
        cached.set(video.videoId, video);
      }

      const cacheWrites = [...returned.values()];
      for (const videoId of batch) {
        if (!returned.has(videoId)) {
          const missingVideo = { videoId, missing: true };
          cached.set(videoId, missingVideo);
          cacheWrites.push(missingVideo);
        }
      }
      await database.setVideos(cacheWrites);
    }

    return unique
      .map((id) => cached.get(id))
      .filter((video) => video && !video.missing);
  }

  async function fetchVideo(id) {
    const [video] = await fetchVideos([id]);
    if (!video) {
      throw Object.assign(
        new Error("That video disappeared before I could get my hands on it."),
        { status: 404 }
      );
    }
    return video;
  }

  async function searchVideos(query) {
    const normalizedQuery = normalizedSearchQuery(query);
    const cacheKey = `${config.playbackRegion}:${normalizedQuery}`;

    if (inFlightSearches.has(cacheKey)) {
      return inFlightSearches.get(cacheKey);
    }

    const work = (async () => {
      if (!database.isReady()) {
        throw Object.assign(
          new Error("Search is staying locked until PostgreSQL is connected. I am not wasting uncached YouTube calls."),
          { status: 503 }
        );
      }

      const cachedSearch = await database.getSearch(cacheKey);
      let videoIds;
      const cacheHit = Boolean(cachedSearch);
      let callsUsed = null;

      if (cachedSearch) {
        videoIds = cachedSearch.videoIds;
      } else {
        const day = quotaDay(config.youtubeQuotaTimezone);
        callsUsed = await database.reserveSearchCall(day);
        if (callsUsed == null) {
          throw Object.assign(
            new Error("Cinder’s fresh-search allowance is spent for today. Cached hunts and direct links still work."),
            { status: 429 }
          );
        }

        const body = await youtubeGet("search", {
          part: "snippet",
          type: "video",
          videoEmbeddable: "true",
          videoSyndicated: "true",
          regionCode: config.playbackRegion,
          maxResults: config.youtubeSearchCandidates,
          safeSearch: "moderate",
          q: normalizedQuery,
          fields: "items(id/videoId)"
        });
        videoIds = (body.items || [])
          .map((item) => item.id?.videoId)
          .filter(Boolean);

        await database.setSearch({
          cacheKey,
          normalizedQuery,
          regionCode: config.playbackRegion,
          videoIds
        });
      }

      const videos = await fetchVideos(videoIds);
      return {
        videoIds,
        videos,
        cacheHit,
        callsUsed,
        dailyBudget: config.youtubeSearchDailyBudget
      };
    })();

    inFlightSearches.set(cacheKey, work);
    try {
      return await work;
    } finally {
      inFlightSearches.delete(cacheKey);
    }
  }

  function allowedInRegion(video) {
    const restriction = video?.regionRestriction;
    if (!restriction) return true;
    const allowed = !Array.isArray(restriction.allowed)
      || restriction.allowed.includes(config.playbackRegion);
    const blocked = Array.isArray(restriction.blocked)
      && restriction.blocked.includes(config.playbackRegion);
    return allowed && !blocked;
  }

  function filterReason(video) {
    if (!video) return "missing_or_removed";
    if (store.state.badVideos[video.videoId]) return "quarantined_after_player_error";
    if (video.privacyStatus !== "public") return "not_public";
    if (video.uploadStatus !== "unknown" && video.uploadStatus !== "processed") return "not_processed";
    if (!video.embeddable) return "embedding_disabled";
    if (!video.hasEmbedHtml) return "no_embed_player";
    if (video.ageRestricted) return "age_restricted";
    if (!allowedInRegion(video)) return `blocked_in_${config.playbackRegion}`;
    if (video.live) return "live_stream";
    if (!video.durationSec) return "duration_unavailable";
    return null;
  }

  function contentRule(video) {
    const reason = filterReason(video);
    const messages = {
      quarantined_after_player_error: "That video already betrayed the player once. Pick another.",
      embedding_disabled: "The owner locked this one out of embedded players.",
      no_embed_player: "YouTube did not give this video an embed player to work with.",
      not_public: "That video is private, missing, or pretending not to know us.",
      missing_or_removed: "That video is gone.",
      not_processed: "YouTube has not finished preparing that video yet.",
      age_restricted: "Age-restricted videos stay outside the request pit.",
      live_stream: "Live streams are too slippery for this queue.",
      duration_unavailable: "I cannot verify how long that video is, so it does not get in."
    };
    if (reason) {
      return reason.startsWith("blocked_in_")
        ? `That video refuses to play in ${config.playbackRegion}.`
        : messages[reason];
    }
    if (video.durationSec > store.state.settings.maxDurationSec) {
      return `That one is too long for tonight. Keep it under ${formatDuration(store.state.settings.maxDurationSec)}.`;
    }
    const combined = `${video.title} ${video.channelTitle}`.toLowerCase();
    const keyword = store.state.settings.blockedKeywords.find((item) =>
      item && combined.includes(String(item).toLowerCase())
    );
    if (keyword) return `That tripped the blocked word “${keyword}.” Not happening.`;
    const channel = store.state.settings.blockedChannels.find((item) =>
      item && [video.channelId, video.channelTitle.toLowerCase()]
        .includes(String(item).toLowerCase())
    );
    if (channel) return "That channel is on Cinder’s no-touch list.";
    if (!store.state.settings.allowDuplicates) {
      const duplicate = store.state.current?.videoId === video.videoId
        || store.state.queue.some((item) =>
          ["testing", "pending", "queued"].includes(item.status)
          && item.videoId === video.videoId
        );
      if (duplicate) return "That song is already waiting its turn. Greedy.";
    }
    return null;
  }

  function requestRule(video, requester, ip) {
    const state = store.state;
    if (!state.settings.queueOpen) return "The request pit is closed. Cinder said no more hands in the jar.";
    const activeCount = state.queue.filter((item) =>
      ["testing", "pending", "queued"].includes(item.status)
    ).length;
    if (activeCount >= state.settings.maxQueue) return "The queue is stuffed. Let it breathe before adding more.";
    const contentError = contentRule(video);
    if (contentError) return contentError;
    const key = requesterKey(requester, ip);
    const userActive = state.queue.filter((item) =>
      item.requesterKey === key && ["pending", "queued"].includes(item.status)
    ).length;
    if (userActive >= state.settings.maxActivePerUser) {
      return `You already have ${state.settings.maxActivePerUser} active request${state.settings.maxActivePerUser === 1 ? "" : "s"}. Let somebody else have a turn.`;
    }
    const latest = [...state.queue, ...state.history]
      .filter((item) => item.requesterKey === key && item.requestedAt)
      .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt))[0];
    if (latest && state.settings.cooldownSec > 0) {
      const remaining = state.settings.cooldownSec
        - (Date.now() - new Date(latest.requestedAt)) / 1000;
      if (remaining > 0) return `Easy, eager thing. Try again in ${Math.ceil(remaining)} seconds.`;
    }
    return null;
  }

  store.videoFilter = filterReason;

  return {
    youtubeGet,
    fetchVideos,
    fetchVideo,
    searchVideos,
    filterReason,
    contentRule,
    requestRule,
    extractVideoId,
    extractPlaylistId
  };
}
