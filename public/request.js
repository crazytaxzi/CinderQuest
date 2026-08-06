import { api, duration, escapeHtml, queueItemHtml, renderNow, socket } from "./shared.js";

const linkForm = document.querySelector("#link-form");
const requestInput = document.querySelector("#request-input");
const statusNode = document.querySelector("#request-status");
const queueList = document.querySelector("#queue-list");
const queueCount = document.querySelector("#queue-count");
const queueState = document.querySelector("#queue-state");
const streamName = document.querySelector("#stream-name");
const limit = document.querySelector("#duration-limit");
const nowPlaying = document.querySelector("#now-playing");
const playbackState = document.querySelector("#playback-state");
const searchForm = document.querySelector("#search-form");
const searchDivider = document.querySelector("#search-divider");
const searchInput = document.querySelector("#search-input");

const dialog = document.querySelector("#request-dialog");
const dialogClose = document.querySelector("#dialog-close");
const searchStep = document.querySelector("#dialog-search");
const detailsStep = document.querySelector("#dialog-details");
const testingStep = document.querySelector("#dialog-testing");
const resultStep = document.querySelector("#dialog-result");
const searchResults = document.querySelector("#search-results");
const searchResultCount = document.querySelector("#search-result-count");
const searchNotice = document.querySelector("#search-notice");
const selectedVideoNode = document.querySelector("#selected-video");
const detailsForm = document.querySelector("#details-form");
const requesterInput = document.querySelector("#requester");
const noteInput = document.querySelector("#note");
const detailsStatus = document.querySelector("#details-status");
const detailsBack = document.querySelector("#details-back");
const testingCancel = document.querySelector("#testing-cancel");
const testingVideo = document.querySelector("#testing-video");
const testingStatus = document.querySelector("#testing-status");
const resultIcon = document.querySelector("#result-icon");
const resultEyebrow = document.querySelector("#result-eyebrow");
const resultTitle = document.querySelector("#result-title");
const resultMessage = document.querySelector("#result-message");
const resultPrimary = document.querySelector("#result-primary");
const resultSecondary = document.querySelector("#result-secondary");

let currentState = null;
let selectedVideo = null;
let selectedOrigin = "link";
let currentSearchQuery = "";
let cachedSearchResults = [];
let currentProbeToken = "";
let probePlayer = null;
let probeTimer = null;
let probePassTimer = null;
let youtubeApiPromise = null;
let probeFinished = true;
let probeGeneration = 0;
let resultMode = "close";

requesterInput.value = localStorage.getItem("cinderRequester") || "";

function playbackLabel(status) {
  const labels = {
    idle: "stage is hungry",
    loading: "waking the stage",
    playing: "making noise",
    paused: "holding its breath",
    buffering: "YouTube is thinking",
    cued: "ready to bite",
    ended: "finished misbehaving",
    halted: "stage was restrained"
  };
  return labels[String(status || "idle").toLowerCase()] || String(status || "idle");
}

function render(state) {
  currentState = state;
  streamName.textContent = state.settings.streamName;
  document.title = `${state.settings.streamName} · CinderQuest`;
  queueState.textContent = state.settings.queueOpen ? "The pit is open" : "Cinder shut the door";
  queueState.className = `pill ${state.settings.queueOpen ? "live" : "closed"}`;
  linkForm.querySelector("button").disabled = !state.settings.queueOpen;
  searchForm.querySelector("button").disabled = !state.settings.queueOpen;
  limit.textContent = `Keep it under ${duration(state.settings.maxDurationSec)}`;
  queueCount.textContent = state.queue.length === 1
    ? "1 song waiting"
    : `${state.queue.length} songs waiting`;
  playbackState.textContent = playbackLabel(state.playback?.status);
  searchForm.hidden = !state.settings.allowSearch;
  searchDivider.hidden = !state.settings.allowSearch;

  renderNow(nowPlaying, state);
  queueList.innerHTML = state.queue.length
    ? state.queue.map((item, index) => queueItemHtml(item, index + 1, false)).join("")
    : `<div class="empty">The queue is naked. Somebody fix that.</div>`;
}

function showStep(step) {
  for (const node of [searchStep, detailsStep, testingStep, resultStep]) {
    node.hidden = node !== step;
  }
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}

function clearProbeTimers() {
  clearTimeout(probeTimer);
  clearTimeout(probePassTimer);
  probeTimer = null;
  probePassTimer = null;
}

function destroyProbePlayer() {
  const player = probePlayer;
  probePlayer = null;
  if (player?.destroy) {
    try { player.destroy(); } catch { /* YouTube already pulled it apart */ }
  } else if (player?.stopVideo) {
    try { player.stopVideo(); } catch { /* nothing left to stop */ }
  }
  document.querySelector("#probe-player")?.replaceChildren();
}

function cancelProbeOnServer(token) {
  if (!token) return;
  api(`/api/requests/probe/${encodeURIComponent(token)}`, {
    method: "DELETE"
  }).catch(() => {});
}

function closeDialog() {
  const token = currentProbeToken;
  probeGeneration += 1;
  probeFinished = true;
  currentProbeToken = "";
  clearProbeTimers();
  destroyProbePlayer();
  cancelProbeOnServer(token);

  if (dialog.open) dialog.close();
  resultMode = "close";
  selectedVideo = null;
  detailsStatus.textContent = "";
  testingStatus.textContent = "";
}

function videoCard(video, actionLabel = "Choose This One") {
  return `
    <article class="search-result-card" data-video-id="${escapeHtml(video.videoId)}">
      <img class="thumb" src="${escapeHtml(video.thumbnail)}" alt="">
      <div class="search-result-copy">
        <h3>${escapeHtml(video.title)}</h3>
        <p>${escapeHtml(video.channelTitle)} · ${duration(video.durationSec)}</p>
      </div>
      <button class="primary" type="button" data-choose-video="${escapeHtml(video.videoId)}">${actionLabel}</button>
    </article>`;
}

function renderSelectedVideo(video) {
  selectedVideoNode.innerHTML = `
    <img class="thumb" src="${escapeHtml(video.thumbnail)}" alt="">
    <div>
      <h3>${escapeHtml(video.title)}</h3>
      <p>${escapeHtml(video.channelTitle)} · ${duration(video.durationSec)}</p>
    </div>`;
}

async function runSearch({ notice = "" } = {}) {
  const query = currentSearchQuery.trim();
  if (query.length < 2) {
    statusNode.textContent = "Give me at least two characters to hunt with.";
    statusNode.className = "status bad";
    searchInput.focus();
    return;
  }

  showStep(searchStep);
  searchNotice.textContent = notice || "Digging through YouTube's closet…";
  searchNotice.className = "status";
  searchResults.innerHTML = `<div class="empty">Hunting for something worth touching…</div>`;
  searchResultCount.textContent = "";

  try {
    const result = await api(`/api/search?q=${encodeURIComponent(query)}`);
    cachedSearchResults = result.items;
    searchResultCount.textContent = `${result.items.length} tempting option${result.items.length === 1 ? "" : "s"}`;
    searchNotice.textContent = notice || (result.excludedCount
      ? `I quietly threw out ${result.excludedCount} result${result.excludedCount === 1 ? "" : "s"} that would have wasted your time.`
      : "Pick the one that looks least likely to disappoint me.");
    searchNotice.className = "status good";
    searchResults.innerHTML = result.items.length
      ? result.items.map((item) => videoCard(item)).join("")
      : `<div class="empty">Nothing playable survived. Try a dirtier search.</div>`;
  } catch (error) {
    searchNotice.textContent = error.message;
    searchNotice.className = "status bad";
    searchResults.innerHTML = `<div class="empty">YouTube refused to cooperate. Rude.</div>`;
  }
}

function chooseVideo(video, origin = "search") {
  selectedVideo = video;
  selectedOrigin = origin;
  renderSelectedVideo(video);
  detailsStatus.textContent = "";
  noteInput.value = "";
  showStep(detailsStep);
  requestAnimationFrame(() => requesterInput.focus());
}

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => settle(() => {
      if (typeof previous === "function") previous();
      resolve();
    });

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => settle(() => reject(new Error("YouTube refused to bring me the test player.")));
    document.head.appendChild(script);
    setTimeout(() => settle(() => reject(new Error("YouTube took too long getting dressed for the test."))), 12_000);
  });

  return youtubeApiPromise;
}

function playerErrorMessage(code) {
  const messages = {
    2: "YouTube rejected the video ID before I could even tease it.",
    5: "YouTube's HTML5 player could not handle this one.",
    100: "This video vanished, went private, or never existed in the first place.",
    101: "The owner locked this video out of embedded players.",
    105: "YouTube rejected this video during the compatibility test.",
    150: "The owner locked this video out of embedded players.",
    153: "YouTube could not verify this site's player identity. That is our setup being bratty, not the song."
  };
  return messages[Number(code)] || `YouTube threw playback error ${code}. Charming.`;
}

async function beginProbe() {
  const requester = requesterInput.value.trim();
  if (!requester) {
    detailsStatus.textContent = "Give me a name so I know who to blame.";
    detailsStatus.className = "status bad";
    requesterInput.focus();
    return;
  }
  if (!selectedVideo?.videoId) {
    detailsStatus.textContent = "The song slipped away. Pick it again.";
    detailsStatus.className = "status bad";
    return;
  }

  localStorage.setItem("cinderRequester", requester);
  detailsStatus.textContent = "Holding your place while I make YouTube prove itself…";
  detailsStatus.className = "status";
  detailsForm.querySelector('button[type="submit"]').disabled = true;

  try {
    const prepared = await api("/api/requests/probe", {
      method: "POST",
      body: JSON.stringify({
        videoId: selectedVideo.videoId,
        requester,
        note: noteInput.value
      })
    });

    const runId = ++probeGeneration;
    currentProbeToken = prepared.probeToken;
    probeFinished = false;

    testingVideo.innerHTML = `
      <strong>${escapeHtml(prepared.video.title)}</strong>
      <div class="small">${escapeHtml(prepared.video.channelTitle)} · ${duration(prepared.video.durationSec)}</div>`;
    testingStatus.textContent = "Waking a tiny muted player…";
    testingStatus.className = "status";
    showStep(testingStep);
    await testPlayback(prepared.video, requester, prepared.probeToken, runId);
  } catch (error) {
    detailsStatus.textContent = error.message;
    detailsStatus.className = "status bad";
  } finally {
    detailsForm.querySelector('button[type="submit"]').disabled = false;
  }
}

async function testPlayback(video, requester, probeToken, runId) {
  clearProbeTimers();
  await loadYouTubeApi();

  const runIsCurrent = () => runId === probeGeneration && dialog.open;
  const canFinish = () => runIsCurrent() && !probeFinished && currentProbeToken === probeToken;

  if (!canFinish()) return;
  destroyProbePlayer();

  const host = document.querySelector("#probe-player");
  const mount = document.createElement("div");
  mount.id = `probe-player-${Date.now()}`;
  host.appendChild(mount);

  const retirePlayer = () => {
    clearProbeTimers();
    destroyProbePlayer();
  };

  const finishPass = async () => {
    if (!canFinish()) return;
    probeFinished = true;
    testingStatus.textContent = "It behaved. Sliding it into the queue…";
    testingStatus.className = "status good";
    retirePlayer();

    try {
      const result = await api(`/api/requests/probe/${encodeURIComponent(probeToken)}/pass`, {
        method: "POST",
        body: JSON.stringify({ requester })
      });
      if (!runIsCurrent()) return;
      currentProbeToken = "";
      showResult({
        good: true,
        title: "It's in. Try not to look too smug.",
        message: result.position
          ? `${result.message} It is sitting at position ${result.position}.`
          : result.message,
        mode: "close"
      });
      requestInput.value = "";
      searchInput.value = "";
    } catch (error) {
      if (!runIsCurrent()) return;
      currentProbeToken = "";
      showResult({
        good: false,
        title: "The queue moved while I was touching it.",
        message: error.message,
        mode: selectedOrigin === "search" ? "search" : "close"
      });
    }
  };

  const schedulePass = (delayMs, message) => {
    if (!canFinish()) return;
    testingStatus.textContent = message;
    clearTimeout(probePassTimer);
    probePassTimer = setTimeout(() => {
      if (canFinish()) finishPass();
    }, delayMs);
  };

  const finishFail = async (code, explicitReason = "") => {
    if (!canFinish()) return;
    probeFinished = true;
    const reason = explicitReason || playerErrorMessage(code);
    retirePlayer();

    try {
      const result = await api(`/api/requests/probe/${encodeURIComponent(probeToken)}/fail`, {
        method: "POST",
        body: JSON.stringify({ requester, errorCode: Number(code || 0), reason })
      });
      if (!runIsCurrent()) return;
      currentProbeToken = "";
      showResult({
        good: false,
        title: result.blocked ? "Nope. This one betrayed us." : "I could not get a clean answer.",
        message: result.blocked
          ? `${reason} I blocked that video ID so it cannot drag anyone through this again.`
          : reason,
        mode: selectedOrigin === "search" ? "search" : "close",
        returnToSearchNotice: result.blocked
          ? `I removed “${video.title}.” Pick another temptation.`
          : "That one never proved itself. Pick another."
      });
    } catch (error) {
      if (!runIsCurrent()) return;
      currentProbeToken = "";
      showResult({
        good: false,
        title: "The test tripped over its own heels.",
        message: error.message,
        mode: selectedOrigin === "search" ? "search" : "close"
      });
    }
  };

  probePlayer = new YT.Player(mount.id, {
    width: 240,
    height: 240,
    playerVars: {
      autoplay: 1,
      controls: 1,
      playsinline: 1,
      rel: 0,
      origin: location.origin
    },
    events: {
      onReady: (event) => {
        if (!canFinish()) return;
        event.target.mute();
        testingStatus.textContent = "Testing the actual embed. No metadata sweet-talk allowed…";
        event.target.loadVideoById(video.videoId);
      },
      onStateChange: (event) => {
        if (!canFinish()) return;
        if (event.data === YT.PlayerState.PLAYING) {
          schedulePass(900, "It is actually playing. Giving it one second to stay honest…");
        } else if (event.data === YT.PlayerState.CUED) {
          schedulePass(2200, "It cued cleanly. Waiting a moment in case YouTube changes its mind…");
        } else if (event.data === YT.PlayerState.BUFFERING) {
          testingStatus.textContent = "Buffering. I am watching it very closely…";
        }
      },
      onError: (event) => finishFail(Number(event.data)),
      onAutoplayBlocked: (event) => {
        if (!canFinish()) return;
        testingStatus.textContent = "Autoplay got shy. Checking whether it can at least cue cleanly…";
        try {
          event.target.mute();
          event.target.cueVideoById(video.videoId);
        } catch {
          finishFail(0, "The browser would not let the compatibility test finish.");
        }
      }
    }
  });

  probeTimer = setTimeout(() => {
    if (!canFinish()) return;
    const state = probePlayer?.getPlayerState?.();
    if ([YT.PlayerState.PLAYING, YT.PlayerState.CUED].includes(state)) {
      finishPass();
    } else {
      finishFail(0, "The test timed out without a real YouTube error, so I did not block the song.");
    }
  }, 15_000);
}

function showResult({ good, title, message, mode = "close", returnToSearchNotice = "" }) {
  resultMode = mode;
  resultIcon.textContent = good ? "✓" : "!";
  resultIcon.className = `result-icon ${good ? "good" : "bad"}`;
  resultEyebrow.textContent = good ? "Cinder approves" : "Cinder says no";
  resultTitle.textContent = title;
  resultMessage.textContent = message;
  resultPrimary.textContent = mode === "search" ? "Show Me the Survivors" : "Done Here";
  resultPrimary.dataset.notice = returnToSearchNotice;
  resultSecondary.hidden = mode !== "search";
  resultSecondary.textContent = "Close This Mess";
  showStep(resultStep);
}

linkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusNode.textContent = "Let me inspect that link…";
  statusNode.className = "status";
  try {
    const result = await api("/api/video-preview", {
      method: "POST",
      body: JSON.stringify({ input: requestInput.value })
    });
    statusNode.textContent = "";
    chooseVideo(result.video, "link");
  } catch (error) {
    statusNode.textContent = error.message;
    statusNode.className = "status bad";
  }
});

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  currentSearchQuery = searchInput.value;
  await runSearch();
});

searchResults.addEventListener("click", (event) => {
  const button = event.target.closest("[data-choose-video]");
  if (!button) return;
  const video = cachedSearchResults.find((item) => item.videoId === button.dataset.chooseVideo);
  if (video) chooseVideo(video, "search");
});

detailsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await beginProbe();
});

detailsBack.addEventListener("click", () => {
  if (selectedOrigin === "search") showStep(searchStep);
  else closeDialog();
});

testingCancel?.addEventListener("click", closeDialog);

resultPrimary.addEventListener("click", async () => {
  if (resultMode === "search") {
    await runSearch({ notice: resultPrimary.dataset.notice || "Pick another one." });
  } else {
    closeDialog();
  }
});

resultSecondary.addEventListener("click", closeDialog);
dialogClose.addEventListener("click", closeDialog);
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDialog();
});

dialog.addEventListener("click", (event) => {
  if (event.target === dialog) closeDialog();
});

socket.on("state:update", render);
socket.on("playback:update", () => {
  api("/api/public-state").then(render).catch(() => {});
});

api("/api/public-state").then(render).catch((error) => {
  statusNode.textContent = error.message;
  statusNode.className = "status bad";
});
