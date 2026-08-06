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
let youtubeApiPromise = null;
let probeFinished = false;

requesterInput.value = localStorage.getItem("cinderRequester") || "";

function render(state) {
  currentState = state;
  streamName.textContent = state.settings.streamName;
  document.title = `${state.settings.streamName} · Song Requests`;
  queueState.textContent = state.settings.queueOpen ? "Queue open" : "Queue closed";
  queueState.className = `pill ${state.settings.queueOpen ? "live" : "closed"}`;
  linkForm.querySelector("button").disabled = !state.settings.queueOpen;
  searchForm.querySelector("button").disabled = !state.settings.queueOpen;
  limit.textContent = `Max ${duration(state.settings.maxDurationSec)}`;
  queueCount.textContent = `${state.queue.length} waiting`;
  playbackState.textContent = state.playback?.status || "idle";
  searchForm.hidden = !state.settings.allowSearch;
  searchDivider.hidden = !state.settings.allowSearch;

  renderNow(nowPlaying, state);
  queueList.innerHTML = state.queue.length
    ? state.queue.map((item, index) => queueItemHtml(item, index + 1, false)).join("")
    : `<div class="empty">The queue is empty. You know what to do.</div>`;
}

function showStep(step) {
  for (const node of [searchStep, detailsStep, testingStep, resultStep]) {
    node.hidden = node !== step;
  }
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}

function closeDialog() {
  clearTimeout(probeTimer);
  if (probePlayer?.stopVideo) {
    try { probePlayer.stopVideo(); } catch { /* already gone */ }
  }
  if (dialog.open) dialog.close();
  currentProbeToken = "";
  probeFinished = false;
}

function videoCard(video, actionLabel = "Choose Me") {
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
  if (query.length < 2) return;

  showStep(searchStep);
  searchNotice.textContent = notice || "Searching YouTube…";
  searchNotice.className = "status";
  searchResults.innerHTML = `<div class="empty">Searching…</div>`;
  searchResultCount.textContent = "";

  try {
    const result = await api(`/api/search?q=${encodeURIComponent(query)}`);
    cachedSearchResults = result.items;
    searchResultCount.textContent = `${result.items.length} choices`;
    searchNotice.textContent = notice || (result.excludedCount
      ? `${result.excludedCount} result(s) were filtered before you ever had to touch them.`
      : "Choose a result to continue.");
    searchNotice.className = "status good";
    searchResults.innerHTML = result.items.length
      ? result.items.map((item) => videoCard(item)).join("")
      : `<div class="empty">No playable results survived the filter.</div>`;
  } catch (error) {
    searchNotice.textContent = error.message;
    searchNotice.className = "status bad";
    searchResults.innerHTML = `<div class="empty">Search did not complete.</div>`;
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
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === "function") previous();
      resolve();
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("YouTube's test player could not be loaded."));
    document.head.appendChild(script);
    setTimeout(() => reject(new Error("YouTube's test player took too long to load.")), 12_000);
  });

  return youtubeApiPromise;
}

function playerErrorMessage(code) {
  const messages = {
    2: "YouTube rejected the video identifier or player request.",
    5: "YouTube could not play this video in the HTML5 player.",
    100: "This video was removed, made private, or could not be found.",
    101: "The video owner does not permit embedded playback.",
    105: "YouTube rejected this video during the playback compatibility check.",
    150: "The video owner does not permit embedded playback.",
    153: "YouTube could not verify this site's player identity. The video was not blocked because this is a server configuration issue."
  };
  return messages[Number(code)] || `YouTube playback failed with error ${code}.`;
}

async function beginProbe() {
  const requester = requesterInput.value.trim();
  if (!requester) {
    detailsStatus.textContent = "Give me a display name first.";
    detailsStatus.className = "status bad";
    requesterInput.focus();
    return;
  }

  localStorage.setItem("cinderRequester", requester);
  detailsStatus.textContent = "Reserving the request and preparing its playback test…";
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

    currentProbeToken = prepared.probeToken;
    testingVideo.innerHTML = `
      <strong>${escapeHtml(prepared.video.title)}</strong>
      <div class="small">${escapeHtml(prepared.video.channelTitle)} · ${duration(prepared.video.durationSec)}</div>`;
    testingStatus.textContent = "Loading a muted YouTube player…";
    testingStatus.className = "status";
    showStep(testingStep);
    await testPlayback(prepared.video, requester);
  } catch (error) {
    detailsStatus.textContent = error.message;
    detailsStatus.className = "status bad";
  } finally {
    detailsForm.querySelector('button[type="submit"]').disabled = false;
  }
}

async function testPlayback(video, requester) {
  clearTimeout(probeTimer);
  probeFinished = false;
  await loadYouTubeApi();

  if (probePlayer?.destroy) {
    try { probePlayer.destroy(); } catch { /* old player already removed */ }
  }
  const host = document.querySelector("#probe-player");
  host.innerHTML = "";
  const mount = document.createElement("div");
  mount.id = `probe-player-${Date.now()}`;
  host.appendChild(mount);

  const finishPass = async () => {
    if (probeFinished) return;
    probeFinished = true;
    clearTimeout(probeTimer);
    try { probePlayer?.pauseVideo(); } catch { /* no-op */ }
    testingStatus.textContent = "Playback accepted. Adding it to the queue…";
    testingStatus.className = "status good";

    try {
      const result = await api(`/api/requests/probe/${encodeURIComponent(currentProbeToken)}/pass`, {
        method: "POST",
        body: JSON.stringify({ requester })
      });
      showResult({
        good: true,
        title: "It passed.",
        message: result.position
          ? `${result.message} Queue position: ${result.position}.`
          : result.message
      });
      requestInput.value = "";
      searchInput.value = "";
      setTimeout(closeDialog, 1800);
    } catch (error) {
      showResult({ good: false, title: "The queue changed underneath us.", message: error.message });
    }
  };

  const finishFail = async (code, explicitReason = "") => {
    if (probeFinished) return;
    probeFinished = true;
    clearTimeout(probeTimer);
    const reason = explicitReason || playerErrorMessage(code);

    try {
      const result = await api(`/api/requests/probe/${encodeURIComponent(currentProbeToken)}/fail`, {
        method: "POST",
        body: JSON.stringify({ requester, errorCode: Number(code || 0), reason })
      });
      showResult({
        good: false,
        title: result.blocked ? "This one cannot be played." : "Playback could not be verified.",
        message: result.blocked
          ? `${reason} It has been added to the blocked video IDs and removed from future search results.`
          : reason,
        chooseAnother: selectedOrigin === "search",
        returnToSearchNotice: result.blocked
          ? `${video.title} failed its playback test and was removed. Choose another result.`
          : "That result could not be verified. Choose another one."
      });
    } catch (error) {
      showResult({ good: false, title: "The test failed awkwardly.", message: error.message, chooseAnother: selectedOrigin === "search" });
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
        event.target.mute();
        testingStatus.textContent = "Probing the embed now…";
        event.target.loadVideoById(video.videoId);
      },
      onStateChange: (event) => {
        if ([YT.PlayerState.PLAYING, YT.PlayerState.BUFFERING, YT.PlayerState.CUED].includes(event.data)) {
          finishPass();
        }
      },
      onError: (event) => finishFail(Number(event.data)),
      onAutoplayBlocked: (event) => {
        testingStatus.textContent = "Autoplay was blocked; checking whether the video can at least be cued…";
        try { event.target.cueVideoById(video.videoId); } catch { finishFail(0, "The browser blocked the compatibility test."); }
      }
    }
  });

  probeTimer = setTimeout(() => {
    const state = probePlayer?.getPlayerState?.();
    if ([YT.PlayerState.PLAYING, YT.PlayerState.BUFFERING, YT.PlayerState.CUED].includes(state)) finishPass();
    else finishFail(0, "The playback test timed out. The video was not blocked because YouTube never returned a definitive error.");
  }, 12_000);
}

function showResult({ good, title, message, chooseAnother = false, returnToSearchNotice = "" }) {
  resultIcon.textContent = good ? "✓" : "!";
  resultIcon.className = `result-icon ${good ? "good" : "bad"}`;
  resultEyebrow.textContent = good ? "Queue accepted" : "Request rejected";
  resultTitle.textContent = title;
  resultMessage.textContent = message;
  resultPrimary.textContent = good ? "Done" : (chooseAnother ? "Back to Results" : "Close");
  resultPrimary.dataset.notice = returnToSearchNotice;
  resultSecondary.hidden = true;
  showStep(resultStep);
}

linkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusNode.textContent = "Checking that link…";
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

resultPrimary.addEventListener("click", async () => {
  if (selectedOrigin === "search" && !resultIcon.classList.contains("good")) {
    await runSearch({ notice: resultPrimary.dataset.notice || "Choose another result." });
  } else {
    closeDialog();
  }
});

resultSecondary.addEventListener("click", closeDialog);
dialogClose.addEventListener("click", closeDialog);
dialog.addEventListener("cancel", (event) => {
  if (!testingStep.hidden && !probeFinished) {
    event.preventDefault();
    return;
  }
  closeDialog();
});

dialog.addEventListener("click", (event) => {
  if (event.target === dialog && testingStep.hidden) closeDialog();
});

socket.on("state:update", render);
socket.on("playback:update", () => {
  api("/api/public-state").then(render).catch(() => {});
});

api("/api/public-state").then(render).catch((error) => {
  statusNode.textContent = error.message;
  statusNode.className = "status bad";
});
