import { api, duration, escapeHtml, queueItemHtml, renderNow, socket, toast } from "./shared.js";

let token = localStorage.getItem("cinderAdminToken") || "";
let appState = null;

const loginCard = document.querySelector("#login-card");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#login-form");
const tokenInput = document.querySelector("#token-input");
const loginStatus = document.querySelector("#login-status");
const nowPlaying = document.querySelector("#now-playing");
const queueList = document.querySelector("#queue-list");
const historyList = document.querySelector("#history-list");
const blockedList = document.querySelector("#blocked-list");
const blockedCount = document.querySelector("#blocked-count");
const pendingCount = document.querySelector("#pending-count");
const playlistForm = document.querySelector("#playlist-form");
const playlistInput = document.querySelector("#playlist-input");
const playlistStatus = document.querySelector("#playlist-status");
const playlistTitle = document.querySelector("#playlist-title");
const playlistCount = document.querySelector("#playlist-count");
const playlistMeta = document.querySelector("#playlist-meta");
const playlistFilterSummary = document.querySelector("#playlist-filter-summary");
const settingsForm = document.querySelector("#settings-form");
const settingsStatus = document.querySelector("#settings-status");
const volume = document.querySelector("#volume");
const playerConnection = document.querySelector("#player-connection");
const banCurrentButton = document.querySelector("#ban-current-button");

document.querySelector("#overlay-url").textContent = `${location.origin}/overlay`;
tokenInput.value = token;

function setField(id, value) {
  const node = document.querySelector(`#${id}`);
  if (node.type === "checkbox") node.checked = Boolean(value);
  else node.value = value ?? "";
}

function getLines(id) {
  return document.querySelector(`#${id}`).value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function humanReason(reason = "") {
  return String(reason || "No reason given")
    .replaceAll("viewer_probe", "viewer honesty test")
    .replaceAll("player", "main player")
    .replaceAll("manual", "control room ban button");
}

function blockedReasonLine(item) {
  const source = item.errorCode
    ? `YouTube error ${escapeHtml(item.errorCode)}`
    : "manually banned";
  return `${escapeHtml(item.reason || "It failed the player")} · ${source}`;
}

function render(state) {
  appState = state;
  renderNow(nowPlaying, state);
  banCurrentButton.disabled = !state.current?.videoId;

  const pending = state.queue.filter((item) => item.status === "pending").length;
  pendingCount.textContent = pending
    ? `${pending} waiting for your judgment`
    : "Nothing begging for approval";

  queueList.innerHTML = state.queue.length
    ? state.queue.map((item) => queueItemHtml(item, null, true)).join("")
    : `<div class="empty">Nobody is waiting. Either chat is behaving or they are plotting.</div>`;

  historyList.innerHTML = state.history.length
    ? state.history.slice(0, 100).map((item) => `
      <article class="queue-item">
        <img class="thumb" src="${escapeHtml(item.thumbnail)}" alt="">
        <div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.requester || "Cinder")} · ${escapeHtml(item.status)} · ${duration(item.durationSec)}</p>
        </div>
        <span class="pill">${escapeHtml(item.endReason || item.status)}</span>
      </article>
    `).join("")
    : `<div class="empty">No history yet. The room is far too innocent.</div>`;

  const blockedVideos = Array.isArray(state.blockedVideos) ? state.blockedVideos : [];
  blockedCount.textContent = blockedVideos.length
    ? `${blockedVideos.length} on the no-touch list`
    : "Nothing blocked";
  blockedList.innerHTML = blockedVideos.length
    ? blockedVideos.map((item) => `
      <article class="queue-item" data-blocked-video-id="${escapeHtml(item.videoId)}">
        <div class="blocked-id-chip">${escapeHtml(item.videoId)}</div>
        <div>
          <h3>${escapeHtml(item.title || "Mystery video")}</h3>
          <p>${blockedReasonLine(item)}</p>
          <p class="small">Caught by the ${escapeHtml(humanReason(item.source))} · failed ${escapeHtml(item.failureCount || 1)} time${Number(item.failureCount || 1) === 1 ? "" : "s"}</p>
        </div>
        <button class="ghost" type="button" data-unblock-video="${escapeHtml(item.videoId)}">Forgive It</button>
      </article>`).join("")
    : `<div class="empty">The no-touch list is empty. Enjoy the rare peace.</div>`;

  playlistTitle.textContent = state.fallbackPlaylist.title || "No backup playlist is wearing the collar yet.";
  playlistCount.textContent = state.fallbackPlaylist.items.length === 1
    ? "1 usable track"
    : `${state.fallbackPlaylist.items.length} usable tracks`;

  const importedAt = state.fallbackPlaylist.importedAt
    ? new Date(state.fallbackPlaylist.importedAt).toLocaleString()
    : "";
  playlistMeta.textContent = importedAt
    ? `Saved safely · imported ${importedAt} · tested for ${state.fallbackPlaylist.importSummary?.playbackRegion || state.diagnostics?.playbackRegion || "US"}`
    : "Nothing saved yet. The fallback is currently naked.";

  const summary = state.fallbackPlaylist.importSummary || {};
  const reasons = Object.entries(summary.skippedByReason || {})
    .map(([reason, count]) => `${reason.replaceAll("_", " ")}: ${count}`)
    .join(" · ");
  playlistFilterSummary.textContent = summary.total
    ? `I inspected ${summary.total}, kept ${summary.imported}, and threw out ${summary.skipped}${reasons ? ` · ${reasons}` : ""}`
    : "";

  if (document.activeElement !== playlistInput) {
    playlistInput.value = state.fallbackPlaylist.sourceUrl || "";
  }

  volume.value = state.settings.volume;
  playerConnection.textContent = state.playback?.updatedAt
    ? `Stage says: ${state.playback.status}`
    : "Still feeling for the player…";

  for (const key of [
    "streamName", "queueOpen", "requireApproval", "allowDuplicates", "allowSearch",
    "maxQueue", "maxDurationSec", "cooldownSec", "maxActivePerUser", "fallbackMode"
  ]) setField(key, state.settings[key]);

  setField("blockedKeywords", state.settings.blockedKeywords.join("\n"));
  setField("blockedChannels", state.settings.blockedChannels.join("\n"));
}

async function banVideo(videoId, title, reason) {
  if (!videoId) return;
  const label = title || videoId;
  if (!window.confirm(`Ban “${label}” by video ID? It will be removed from the queue and emergency mixtape.`)) {
    return;
  }

  await api(`/api/admin/quarantine/${encodeURIComponent(videoId)}`, {
    method: "POST",
    body: JSON.stringify({ reason })
  }, token);
  toast("Banished. That video ID is not touching the stage again.");
}

async function authenticate(nextToken) {
  const result = await api("/api/admin/auth", {
    method: "POST",
    body: "{}"
  }, nextToken);

  token = nextToken;
  localStorage.setItem("cinderAdminToken", token);
  loginCard.hidden = true;
  dashboard.hidden = false;
  render(result.state);

  socket.emit("admin:register", token, (reply) => {
    if (!reply?.ok) toast(reply?.error || "The live dashboard connection refused the token.", true);
    else render(reply.state);
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.textContent = "Testing the lock. Hold still…";
  loginStatus.className = "status";
  try {
    await authenticate(tokenInput.value);
    loginStatus.textContent = "";
  } catch (error) {
    loginStatus.textContent = error.message;
    loginStatus.className = "status bad";
  }
});

queueList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  const item = event.target.closest("[data-id]");
  if (!button || !item) return;

  const id = item.dataset.id;
  const videoId = item.dataset.videoId;
  const action = button.dataset.action;
  button.disabled = true;

  try {
    if (action === "approve") {
      await api(`/api/admin/queue/${id}/approve`, { method: "POST", body: "{}" }, token);
      toast("Fine. I let it in.");
    } else if (action === "up" || action === "down") {
      await api(`/api/admin/queue/${id}/move`, {
        method: "POST",
        body: JSON.stringify({ direction: action })
      }, token);
    } else if (action === "play") {
      await api(`/api/admin/player/play/${id}`, { method: "POST", body: "{}" }, token);
      toast("Taking that one now.");
    } else if (action === "ban") {
      const title = item.querySelector("h3")?.textContent?.trim() || videoId;
      await banVideo(videoId, title, "Cinder manually banned this video from the request queue");
    } else if (action === "reject") {
      await api(`/api/admin/queue/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: "Cinder denied entry" })
      }, token);
      toast("Denied. It can sulk outside.");
    } else if (action === "remove") {
      await api(`/api/admin/queue/${id}`, { method: "DELETE" }, token);
      toast("Thrown out of line.");
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#skip-button").addEventListener("click", async () => {
  try {
    await api("/api/admin/player/next", {
      method: "POST",
      body: JSON.stringify({ reason: "Cinder got bored and skipped it" })
    }, token);
    toast("Gone. Next temptation.");
  } catch (error) {
    toast(error.message, true);
  }
});

banCurrentButton.addEventListener("click", async () => {
  const item = appState?.current;
  if (!item?.videoId) return;
  banCurrentButton.disabled = true;
  try {
    await banVideo(
      item.videoId,
      item.title,
      "Cinder manually banned this video while it was playing"
    );
  } catch (error) {
    toast(error.message, true);
  } finally {
    banCurrentButton.disabled = !appState?.current?.videoId;
  }
});

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await api("/api/admin/player/command", {
        method: "POST",
        body: JSON.stringify({ action: button.dataset.command })
      }, token);
    } catch (error) {
      toast(error.message, true);
    }
  });
});

let volumeTimer;
volume.addEventListener("input", () => {
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(async () => {
    try {
      await api("/api/admin/player/command", {
        method: "POST",
        body: JSON.stringify({ action: "volume", value: Number(volume.value) })
      }, token);
    } catch (error) {
      toast(error.message, true);
    }
  }, 120);
});

playlistForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  playlistStatus.textContent = "Inspecting every track before I let the playlist touch the stage…";
  playlistStatus.className = "status";
  try {
    const result = await api("/api/admin/playlist/import", {
      method: "POST",
      body: JSON.stringify({ input: playlistInput.value })
    }, token);
    const reasons = Object.entries(result.skippedByReason || {})
      .map(([reason, count]) => `${reason.replaceAll("_", " ")}: ${count}`)
      .join(", ");
    playlistStatus.textContent = `Kept ${result.imported} playable tracks and rejected ${result.skipped}${reasons ? ` (${reasons})` : ""}. The useful ones are saved.`;
    playlistStatus.className = "status good";
    playlistInput.value = "";
  } catch (error) {
    playlistStatus.textContent = error.message;
    playlistStatus.className = "status bad";
  }
});

document.querySelector("#clear-quarantine").addEventListener("click", async () => {
  try {
    const result = await api("/api/admin/quarantine", { method: "DELETE" }, token);
    playlistStatus.textContent = `Forgave ${result.cleared} blocked video record${result.cleared === 1 ? "" : "s"}. Re-import the playlist if you want to tempt fate again.`;
    playlistStatus.className = "status good";
  } catch (error) {
    toast(error.message, true);
  }
});

document.querySelector("#clear-playlist").addEventListener("click", async () => {
  try {
    await api("/api/admin/playlist", { method: "DELETE" }, token);
    playlistStatus.textContent = "The emergency mixtape is stripped clean.";
    playlistStatus.className = "status good";
  } catch (error) {
    toast(error.message, true);
  }
});

blockedList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-unblock-video]");
  if (!button) return;
  button.disabled = true;
  try {
    await api(`/api/admin/quarantine/${encodeURIComponent(button.dataset.unblockVideo)}`, { method: "DELETE" }, token);
    toast("Fine. That video gets one more chance to behave.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  settingsStatus.textContent = "Tightening the rules…";
  settingsStatus.className = "status";
  try {
    const settings = {
      streamName: document.querySelector("#streamName").value,
      queueOpen: document.querySelector("#queueOpen").checked,
      requireApproval: document.querySelector("#requireApproval").checked,
      allowDuplicates: document.querySelector("#allowDuplicates").checked,
      allowSearch: document.querySelector("#allowSearch").checked,
      maxQueue: Number(document.querySelector("#maxQueue").value),
      maxDurationSec: Number(document.querySelector("#maxDurationSec").value),
      cooldownSec: Number(document.querySelector("#cooldownSec").value),
      maxActivePerUser: Number(document.querySelector("#maxActivePerUser").value),
      fallbackMode: document.querySelector("#fallbackMode").value,
      volume: Number(volume.value),
      blockedKeywords: getLines("blockedKeywords"),
      blockedChannels: getLines("blockedChannels")
    };
    await api("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify(settings)
    }, token);
    settingsStatus.textContent = "There. The leash fits better now.";
    settingsStatus.className = "status good";
  } catch (error) {
    settingsStatus.textContent = error.message;
    settingsStatus.className = "status bad";
  }
});

document.querySelector("#refresh-button").addEventListener("click", async () => {
  try {
    render(await api("/api/admin/state", {}, token));
    toast("Everything is awake again.");
  } catch (error) {
    toast(error.message, true);
  }
});

socket.on("admin:update", render);
socket.on("admin:alert", (alert) => toast(alert.message, alert.type === "error"));

if (token) {
  authenticate(token).catch(() => {
    localStorage.removeItem("cinderAdminToken");
    token = "";
  });
}
