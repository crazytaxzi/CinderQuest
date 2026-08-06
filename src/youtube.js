import { clean, extractVideoId, extractPlaylistId, formatDuration, parseDuration, requesterKey } from "./utils.js";

export function createYoutubeService({ config, store }) {
  async function youtubeGet(resource, params) {
    if (!config.youtubeApiKey) {
      throw Object.assign(new Error("The YouTube API key is missing, so the hunt cannot leave the house."), { status: 503 });
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
      throw Object.assign(new Error("That video disappeared before I could get my hands on it."), { status: 404 });
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
    filterReason,
    contentRule,
    requestRule,
    extractVideoId,
    extractPlaylistId
  };
}
