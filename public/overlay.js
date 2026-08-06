import { api, duration, socket } from "./shared.js";

let state = null;

const songShell = document.querySelector("#song-shell");
const card = document.querySelector("#overlay-card");
const thumb = document.querySelector("#overlay-thumb");
const source = document.querySelector("#overlay-source");
const title = document.querySelector("#overlay-title");
const sub = document.querySelector("#overlay-sub");
const progress = document.querySelector("#overlay-progress");
const time = document.querySelector("#overlay-time");
const queue = document.querySelector("#overlay-queue");
const queueText = document.querySelector("#queue-text");
const particleContainer = document.querySelector("#song-particles");

class PingPongScroller {
  constructor(viewport, content, {
    speed = 15,
    edgePauseMs = 1500,
    startPauseMs = 1200
  } = {}) {
    this.viewport = viewport;
    this.content = content;
    this.speed = speed;
    this.edgePauseMs = edgePauseMs;
    this.startPauseMs = startPauseMs;
    this.position = 0;
    this.direction = 1;
    this.max = 0;
    this.lastFrame = performance.now();
    this.pauseUntil = this.lastFrame + startPauseMs;
    this.frame = 0;

    this.resizeObserver = new ResizeObserver(() => this.measure(true));
    this.resizeObserver.observe(viewport);
    this.resizeObserver.observe(content);

    this.measure(true);
    this.tick = this.tick.bind(this);
    this.frame = requestAnimationFrame(this.tick);
  }

  measure(preserveDirection = false) {
    this.max = Math.max(0, this.content.scrollWidth - this.viewport.clientWidth);
    this.position = Math.min(this.position, this.max);

    if (!preserveDirection || this.max === 0) {
      this.direction = 1;
    }

    this.content.classList.toggle("not-scrolling", this.max === 0);

    if (this.max === 0) {
      this.position = 0;
    }

    this.apply();
  }

  reset() {
    this.position = 0;
    this.direction = 1;
    this.pauseUntil = performance.now() + this.startPauseMs;
    requestAnimationFrame(() => this.measure(false));
  }

  apply() {
    this.content.style.transform = `translate3d(${-this.position}px, 0, 0)`;
  }

  tick(now) {
    const deltaSeconds = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;

    if (this.max > 0 && now >= this.pauseUntil) {
      this.position += this.direction * this.speed * deltaSeconds;

      if (this.position >= this.max) {
        this.position = this.max;
        this.direction = -1;
        this.pauseUntil = now + this.edgePauseMs;
      } else if (this.position <= 0) {
        this.position = 0;
        this.direction = 1;
        this.pauseUntil = now + this.edgePauseMs;
      }

      this.apply();
    }

    this.frame = requestAnimationFrame(this.tick);
  }
}

const titleScroller = new PingPongScroller(
  document.querySelector("#title-viewport"),
  title,
  { speed: 14, edgePauseMs: 1500, startPauseMs: 1200 }
);

const queueScroller = new PingPongScroller(
  document.querySelector("#queue-viewport"),
  queueText,
  { speed: 12, edgePauseMs: 1800, startPauseMs: 1500 }
);

function setScrollingText(node, value, scroller) {
  const next = String(value || "");
  if (node.textContent === next) return;
  node.textContent = next;
  scroller.reset();
}

function queueLine(items) {
  return items.slice(0, 12).map((item, index) => {
    const requester = item.requester ? ` · ${item.requester}` : "";
    return `${index + 1}. ${item.title}${requester}`;
  }).join("     ◆     ");
}

function buildParticles(count = 16) {
  particleContainer.innerHTML = "";

  for (let index = 0; index < count; index += 1) {
    const dust = document.createElement("span");
    dust.className = "dust";
    dust.style.setProperty("--left", `${randomBetween(2, 94).toFixed(2)}%`);
    dust.style.setProperty("--size", `${randomBetween(1.5, 4.2).toFixed(2)}px`);
    dust.style.setProperty("--duration", `${randomBetween(6.5, 13.5).toFixed(2)}s`);
    dust.style.setProperty("--delay", `${randomBetween(-12, 0).toFixed(2)}s`);
    dust.style.setProperty("--drift", `${randomBetween(-16, 16).toFixed(2)}px`);
    particleContainer.appendChild(dust);
  }
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function render(next) {
  state = { ...(state || {}), ...next };
  const item = state.current;

  songShell.classList.toggle("has-current", Boolean(item));

  if (!item) {
    card.classList.add("hidden");
    queue.classList.add("hidden");
    return;
  }

  thumb.src = item.thumbnail || "";
  thumb.alt = item.title ? `Artwork for ${item.title}` : "Current song artwork";

  source.textContent = item.source === "playlist"
    ? "CINDER'S PLAYLIST"
    : "VIEWER REQUEST";

  setScrollingText(title, item.title, titleScroller);

  const requester = item.requester
    ? `Requested by ${item.requester}`
    : "Selected by Cinder";

  sub.textContent = `${item.channelTitle}  ◆  ${requester}`;

  const upcoming = Array.isArray(state.queue) ? state.queue : [];
  if (upcoming.length) {
    setScrollingText(queueText, queueLine(upcoming), queueScroller);
    queue.classList.remove("hidden");
  } else {
    queue.classList.add("hidden");
    setScrollingText(queueText, "", queueScroller);
  }

  updateProgress(state.playback);
  card.classList.remove("hidden");
}

function updateProgress(playback) {
  if (!playback) return;
  state = { ...(state || {}), playback };

  const elapsed = Number(playback.progressSec || 0);
  const total = Number(playback.durationSec || state?.current?.durationSec || 0);
  const percent = total ? Math.min(100, (elapsed / total) * 100) : 0;

  progress.style.width = `${percent}%`;
  time.textContent = `${duration(elapsed)} / ${duration(total)}`;
}

buildParticles();

socket.on("state:update", render);
socket.on("playback:update", updateProgress);

api("/api/public-state")
  .then(render)
  .catch(() => {
    card.classList.add("hidden");
    queue.classList.add("hidden");
  });
