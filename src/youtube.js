import { clean, extractVideoId, extractPlaylistId, formatDuration, parseDuration, requesterKey } from "./utils.js";

export function createYoutubeService({ config, store }) {
  async function youtubeGet(resource, params) {
    if (!config.youtubeApiKey) {
      throw Object.assign(new Error("YouTube API key is not configured."), { status: 503 });
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
        new Error(body?.error?.message || `YouTube API failed (${response.status}).`),
        { status: response.status }
      );
    }
    return body;
  }

  async function fetchVideos(ids) {
    const output = [];
    const unique = [...new Set(ids.filter(Boolean))];
    for (let index = 0; index < unique.length; index += 50) {
      const body = await youtubeGet("videos", {
        part: "snippet,contentDetails,status,liveStreamingDetails,player",
        id: unique.slice(index, index + 50).join(","),
        maxWidth: 640,
        maxHeight: 360
      });
      for (const video of body.items || []) {
        const durationSec = parseDuration(video.contentDetails?.duration);
        output.push({
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
        });
      }
    }
    return output;
  }

  async function fetchVideo(id) {
    const [video] = await fetchVideos([id]);
    if (!video) {
      throw Object.assign(new Error("That YouTube video is unavailable."), { status: 404 });
    }
    return video;
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
      quarantined_after_player_error: "That video previously failed playback and is blocked.",
      embedding_disabled: "That video cannot be played in an embedded YouTube player.",
      no_embed_player: "That video cannot be played in an embedded YouTube player.",
      not_public: "That video is not public or is unavailable.",
      missing_or_removed: "That video is unavailable.",
      not_processed: "That video is not fully processed.",
      age_restricted: "Age-restricted videos are not accepted.",
      live_stream: "Live streams are not accepted.",
      duration_unavailable: "I could not verify that video's duration."
    };
    if (reason) {
      return reason.startsWith("blocked_in_")
        ? `That video is blocked in ${config.playbackRegion}.`
        : messages[reason];
    }
    if (video.durationSec > store.state.settings.maxDurationSec) {
      return `That is too long. The limit is ${formatDuration(store.state.settings.maxDurationSec)}.`;
    }
    const combined = `${video.title} ${video.channelTitle}`.toLowerCase();
    const keyword = store.state.settings.blockedKeywords.find((item) =>
      item && combined.includes(String(item).toLowerCase())
    );
    if (keyword) return `Blocked by keyword: ${keyword}`;
    const channel = store.state.settings.blockedChannels.find((item) =>
      item && [video.channelId, video.channelTitle.toLowerCase()]
        .includes(String(item).toLowerCase())
    );
    if (channel) return "That channel is blocked.";
    if (!store.state.settings.allowDuplicates) {
      const duplicate = store.state.current?.videoId === video.videoId
        || store.state.queue.some((item) =>
          ["testing", "pending", "queued"].includes(item.status)
          && item.videoId === video.videoId
        );
      if (duplicate) return "That song is already in the active queue.";
    }
    return null;
  }

  function requestRule(video, requester, ip) {
    const state = store.state;
    if (!state.settings.queueOpen) return "The request pit is closed.";
    const activeCount = state.queue.filter((item) =>
      ["testing", "pending", "queued"].includes(item.status)
    ).length;
    if (activeCount >= state.settings.maxQueue) return "The queue is full.";
    const contentError = contentRule(video);
    if (contentError) return contentError;
    const key = requesterKey(requester, ip);
    const userActive = state.queue.filter((item) =>
      item.requesterKey === key && ["pending", "queued"].includes(item.status)
    ).length;
    if (userActive >= state.settings.maxActivePerUser) {
      return `You already have ${state.settings.maxActivePerUser} active request(s).`;
    }
    const latest = [...state.queue, ...state.history]
      .filter((item) => item.requesterKey === key && item.requestedAt)
      .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt))[0];
    if (latest && state.settings.cooldownSec > 0) {
      const remaining = state.settings.cooldownSec
        - (Date.now() - new Date(latest.requestedAt)) / 1000;
      if (remaining > 0) return `Cooldown active. Try again in ${Math.ceil(remaining)} seconds.`;
    }
    return null;
  }

  store.videoFilter = filterReason;

  return {
    youtubeGet,
    fetchVideos,
    fetchVideo,
    filterReason,
    contentRule,
    requestRule,
    extractVideoId,
    extractPlaylistId
  };
}
