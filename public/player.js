import { api, duration, escapeHtml, socket } from "./shared.js";

let token = localStorage.getItem("cinderPlayerToken") || "";
let player = null;
let apiReady = false;
let playerReady = false;
let current = null;
let progressTimer = null;
let endedLock = false;
let desiredVolume = 70;
let consecutivePlaybackErrors = 0;
let haltingAfterErrors = false;

const setup = document.querySelector("#setup");
const setupForm = document.querySelector("#setup-form");
const tokenInput = document.querySelector("#player-token");
const setupStatus = document.querySelector("#setup-status");
const shell = document.querySelector("#player-shell");
const now = document.querySelector("#player-now");

tokenInput.value = token;

function loadYouTubeApi() {
  if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) return;
  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(script);
}

window.onYouTubeIframeAPIReady = () => {
  apiReady = true;
  createPlayer();
};

function createPlayer() {
  if (!apiReady || player) return;
  player = new YT.Player("youtube-player", {
    width: 1280,
    height: 720,
    playerVars: {
      autoplay: 0,
      controls: 1,
      playsinline: 1,
      rel: 0,
      origin: location.origin.replace("0.0.0.0", "127.0.0.1")
    },
    events: {
      onReady: () => {
        playerReady = true;
        player.setVolume(desiredVolume);
        if (current?.videoId) player.loadVideoById(current.videoId);
        startProgress();
      },
      onStateChange: handleStateChange,
      onError: handlePlayerError,
      onAutoplayBlocked: () => {
        setupStatus.textContent = "Autoplay was blocked. Click Play once in the player.";
        setupStatus.className = "status bad";
      }
    }
  });
}

function updateNow() {
  if (!current) {
    now.innerHTML = `<strong>Waiting for a track.</strong><div class="small">Queue or fallback playlist will feed the stage.</div>`;
    return;
  }
  now.innerHTML = `
    <strong>${escapeHtml(current.title)}</strong>
    <div class="small">${escapeHtml(current.channelTitle)} · ${duration(current.durationSec)} · requested by ${escapeHtml(current.requester)}</div>
  `;
}

function loadTrack(item) {
  current = item;
  endedLock = false;
  updateNow();

  if (!item) {
    if (playerReady) player.stopVideo();
    return;
  }

  if (playerReady) {
    player.loadVideoById(item.videoId);
    player.setVolume(desiredVolume);
  }
}

function statusName(code) {
  if (!window.YT) return "loading";
  const map = {
    [YT.PlayerState.UNSTARTED]: "unstarted",
    [YT.PlayerState.ENDED]: "ended",
    [YT.PlayerState.PLAYING]: "playing",
    [YT.PlayerState.PAUSED]: "paused",
    [YT.PlayerState.BUFFERING]: "buffering",
    [YT.PlayerState.CUED]: "cued"
  };
  return map[code] || "unknown";
}

function handleStateChange(event) {
  const status = statusName(event.data);
  emitProgress(status);

  if (event.data === YT.PlayerState.PLAYING) {
    consecutivePlaybackErrors = 0;
    haltingAfterErrors = false;
  }

  if (event.data === YT.PlayerState.ENDED && !endedLock) {
    endedLock = true;
    api("/api/admin/player/ended", {
      method: "POST",
      body: JSON.stringify({
        videoId: current?.videoId || "",
        reason: "YouTube playback ended"
      })
    }, token).catch((error) => {
      setupStatus.textContent = error.message;
      setupStatus.className = "status bad";
    });
  }
}

async function handlePlayerError(event) {
  const code = Number(event.data);
  consecutivePlaybackErrors += 1;

  if (code === 153) {
    endedLock = true;
    haltingAfterErrors = true;
    now.innerHTML = `
      <strong>YouTube rejected the player identity (error 153).</strong>
      <div class="small">This is an origin/referrer configuration problem, not a bad song. Playback has been halted instead of chewing through the playlist.</div>
    `;

    try {
      await api("/api/admin/player/halt", {
        method: "POST",
        body: JSON.stringify({
          reason: "YouTube player error 153: missing referrer or client identity"
        })
      }, token);
    } catch {
      // Already halted locally.
    }
    return;
  }

  socket.emit("player:error", {
    code: String(code),
    videoId: current?.videoId || ""
  });

  if (consecutivePlaybackErrors >= 5 && !haltingAfterErrors) {
    haltingAfterErrors = true;
    endedLock = true;
    now.innerHTML = `
      <strong>Playback halted after ${consecutivePlaybackErrors} consecutive YouTube errors.</strong>
      <div class="small">Use http://127.0.0.1:${location.port || "3417"}/player, close duplicate Player tabs, then press Next from the dashboard.</div>
    `;

    try {
      await api("/api/admin/player/halt", {
        method: "POST",
        body: JSON.stringify({
          reason: `Halted after ${consecutivePlaybackErrors} consecutive YouTube player errors; last code ${code}`
        })
      }, token);
    } catch {
      // Avoid another cascading failure while already handling playback errors.
    }
    return;
  }

  if (!endedLock) {
    endedLock = true;
    setTimeout(() => {
      api("/api/admin/player/ended", {
        method: "POST",
        body: JSON.stringify({
          videoId: current?.videoId || "",
          errorCode: code,
          reason: `YouTube player error ${code}`
        })
      }, token).catch(() => {});
    }, 900);
  }
}

function emitProgress(status = "") {
  if (!playerReady) return;
  socket.emit("player:progress", {
    status: status || statusName(player.getPlayerState()),
    progressSec: player.getCurrentTime?.() || 0,
    durationSec: player.getDuration?.() || current?.durationSec || 0
  });
}

function startProgress() {
  clearInterval(progressTimer);
  progressTimer = setInterval(() => emitProgress(), 1000);
}

function handleCommand(command) {
  if (!playerReady) return;
  switch (command.action) {
    case "play": player.playVideo(); break;
    case "pause": player.pauseVideo(); break;
    case "stop": player.stopVideo(); break;
    case "mute": player.mute(); break;
    case "unmute": player.unMute(); break;
    case "volume":
      desiredVolume = Number(command.value ?? desiredVolume);
      player.setVolume(desiredVolume);
      break;
  }
}

async function register(nextToken) {
  const result = await api("/api/admin/auth", { method: "POST", body: "{}" }, nextToken);
  token = nextToken;
  localStorage.setItem("cinderPlayerToken", token);
  desiredVolume = result.state.settings.volume;
  current = result.state.current;

  setup.hidden = true;
  shell.hidden = false;
  loadYouTubeApi();
  updateNow();

  socket.emit("player:register", token, (reply) => {
    if (!reply?.ok) {
      setup.hidden = false;
      shell.hidden = true;
      setupStatus.textContent = reply?.error || "Player socket authentication failed.";
      setupStatus.className = "status bad";
      return;
    }
    desiredVolume = reply.state.settings.volume;
    loadTrack(reply.state.current);
  });

  if (!current) {
    await api("/api/admin/player/next", {
      method: "POST",
      body: JSON.stringify({ reason: "Player stage started" })
    }, token);
  }
}

setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setupStatus.textContent = "Unlocking…";
  try {
    await register(tokenInput.value);
  } catch (error) {
    setupStatus.textContent = error.message;
    setupStatus.className = "status bad";
  }
});

socket.on("player:load", loadTrack);
socket.on("player:command", handleCommand);
socket.on("admin:update", (state) => {
  desiredVolume = state.settings.volume;
  if (state.current?.id !== current?.id) loadTrack(state.current);
});

document.querySelector("#local-play").addEventListener("click", () => playerReady && player.playVideo());
document.querySelector("#local-pause").addEventListener("click", () => playerReady && player.pauseVideo());
document.querySelector("#local-next").addEventListener("click", () => {
  api("/api/admin/player/next", {
    method: "POST",
    body: JSON.stringify({ reason: "Skipped from player stage" })
  }, token).catch((error) => {
    setupStatus.textContent = error.message;
    setupStatus.className = "status bad";
  });
});

if (token) {
  register(token).catch(() => {
    localStorage.removeItem("cinderPlayerToken");
    token = "";
  });
}
