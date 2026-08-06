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
let transientRetryItemId = "";
let transientRetryCount = 0;
let transientRetryTimer = null;

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
        setupStatus.textContent = "The browser got shy about autoplay. Give Play one click and it should loosen up.";
        setupStatus.className = "status bad";
      }
    }
  });
}

function updateNow() {
  if (!current) {
    now.innerHTML = `<strong>The stage is hungry.</strong><div class="small">The queue or Cinder’s emergency mixtape will feed it.</div>`;
    return;
  }
  const requester = current.requester || "Cinder";
  now.innerHTML = `
    <strong>${escapeHtml(current.title)}</strong>
    <div class="small">${escapeHtml(current.channelTitle)} · ${duration(current.durationSec)} · blame ${escapeHtml(requester)}</div>
  `;
}

function loadTrack(item) {
  clearTimeout(transientRetryTimer);
  if (item?.id !== transientRetryItemId) {
    transientRetryItemId = item?.id || "";
    transientRetryCount = 0;
  }

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
  if (!window.YT) return "waking up";
  const map = {
    [YT.PlayerState.UNSTARTED]: "getting dressed",
    [YT.PlayerState.ENDED]: "finished",
    [YT.PlayerState.PLAYING]: "making noise",
    [YT.PlayerState.PAUSED]: "holding its breath",
    [YT.PlayerState.BUFFERING]: "YouTube is thinking",
    [YT.PlayerState.CUED]: "ready to bite"
  };
  return map[code] || "doing something suspicious";
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
        reason: "The song finished behaving"
      })
    }, token).catch((error) => {
      setupStatus.textContent = error.message;
      setupStatus.className = "status bad";
    });
  }
}

async function handlePlayerError(event) {
  const code = Number(event.data);

  if (code === 105 && current?.videoId && transientRetryCount < 1) {
    transientRetryCount += 1;
    const retryItemId = current.id;
    const retryVideoId = current.videoId;

    socket.emit("player:error", {
      code: String(code),
      videoId: retryVideoId,
      transient: true,
      retrying: true
    });

    now.innerHTML = `
      <strong>YouTube threw undocumented error 105.</strong>
      <div class="small">I am giving this song one clean retry before I throw it aside. I am not banning it for a mystery error.</div>
    `;

    transientRetryTimer = setTimeout(() => {
      if (!playerReady || current?.id !== retryItemId) return;
      endedLock = false;
      try {
        player.cueVideoById(retryVideoId);
        setTimeout(() => {
          if (playerReady && current?.id === retryItemId) player.playVideo();
        }, 350);
      } catch {
        // Let the next player error or timeout decide what happens.
      }
    }, 1400);
    return;
  }

  consecutivePlaybackErrors += 1;

  if (code === 153) {
    endedLock = true;
    haltingAfterErrors = true;
    now.innerHTML = `
      <strong>YouTube rejected the player’s identity. Error 153.</strong>
      <div class="small">That is our origin or referrer setup being bratty, not the song. I stopped the stage instead of chewing through the whole queue.</div>
    `;

    try {
      await api("/api/admin/player/halt", {
        method: "POST",
        body: JSON.stringify({
          reason: "YouTube error 153: the player identity or referrer was rejected"
        })
      }, token);
    } catch {
      // The stage is already restrained locally.
    }
    return;
  }

  socket.emit("player:error", {
    code: String(code),
    videoId: current?.videoId || "",
    transient: code === 105,
    retrying: false
  });

  if (consecutivePlaybackErrors >= 5 && !haltingAfterErrors) {
    haltingAfterErrors = true;
    endedLock = true;
    now.innerHTML = `
      <strong>I stopped after ${consecutivePlaybackErrors} YouTube failures in a row.</strong>
      <div class="small">Close duplicate Player tabs, make sure this page uses the correct public URL, then press Next from the control room.</div>
    `;

    try {
      await api("/api/admin/player/halt", {
        method: "POST",
        body: JSON.stringify({
          reason: `Cinder halted the stage after ${consecutivePlaybackErrors} consecutive YouTube errors; last code ${code}`
        })
      }, token);
    } catch {
      // Do not create another failure while handling a failure pileup.
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
          reason: code === 105
            ? "Undocumented YouTube player error 105 after one retry"
            : `YouTube player error ${code}`
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
      setupStatus.textContent = reply?.error || "The live player connection refused the token.";
      setupStatus.className = "status bad";
      return;
    }
    desiredVolume = reply.state.settings.volume;
    loadTrack(reply.state.current);
  });

  if (!current) {
    await api("/api/admin/player/next", {
      method: "POST",
      body: JSON.stringify({ reason: "The player stage woke up hungry" })
    }, token);
  }
}

setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setupStatus.textContent = "Turning the key and waking YouTube…";
  setupStatus.className = "status";
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
    body: JSON.stringify({ reason: "Cinder skipped it from the player stage" })
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
