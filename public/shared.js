export const socket = io();

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

export function duration(seconds) {
  const n = Math.max(0, Number(seconds || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = Math.floor(n % 60);
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export async function api(url, options = {}, token = "") {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (token) headers["x-admin-token"] = token;

  const response = await fetch(url, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export function renderNow(container, state) {
  const item = state.current;
  if (!item) {
    container.innerHTML = `<div class="empty">Nothing playing. The pit is waiting.</div>`;
    return;
  }
  const progress = state.playback?.durationSec
    ? Math.min(100, (state.playback.progressSec / state.playback.durationSec) * 100)
    : 0;

  container.innerHTML = `
    <div class="now-playing">
      <img class="thumb" src="${escapeHtml(item.thumbnail)}" alt="">
      <div class="now-copy">
        <span class="pill live">${escapeHtml(item.source === "playlist" ? "Playlist" : "Requested")}</span>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.channelTitle)} · ${duration(item.durationSec)}</p>
        <p class="small">Fed to the queue by ${escapeHtml(item.requester)}</p>
      </div>
    </div>
    <div class="progress"><span style="width:${progress}%"></span></div>
  `;
}

export function queueItemHtml(item, position = null, controls = false) {
  return `
    <article class="queue-item" data-id="${escapeHtml(item.id)}">
      <img class="thumb" src="${escapeHtml(item.thumbnail)}" alt="">
      <div>
        <h3>${position ? `${position}. ` : ""}${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.channelTitle)} · ${duration(item.durationSec)}</p>
        <p class="small">${escapeHtml(item.requester)} · ${escapeHtml(item.status)}</p>
      </div>
      ${controls ? `
        <div class="queue-actions">
          ${item.status === "pending" ? `<button class="primary" data-action="approve">Approve</button>` : ""}
          ${item.status === "queued" ? `
            <button class="ghost" data-action="up" title="Move up">↑</button>
            <button class="ghost" data-action="down" title="Move down">↓</button>
            <button class="secondary" data-action="play">Play</button>` : ""}
          <button class="danger" data-action="${item.status === "pending" ? "reject" : "remove"}">
            ${item.status === "pending" ? "Reject" : "Remove"}
          </button>
        </div>` : ""}
    </article>
  `;
}

export function toast(message, bad = false) {
  let node = document.querySelector(".toast");
  if (!node) {
    node = document.createElement("div");
    node.className = "toast";
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.style.borderColor = bad ? "rgba(255,71,119,.6)" : "rgba(141,255,50,.45)";
  node.classList.add("show");
  clearTimeout(node._timer);
  node._timer = setTimeout(() => node.classList.remove("show"), 3000);
}
