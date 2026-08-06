import crypto from "node:crypto";

export const clean = (value, max = 120) => String(value || "")
  .replace(/[\u0000-\u001F\u007F]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

export const clamp = (value, min, max, fallback) => Number.isFinite(Number(value))
  ? Math.min(max, Math.max(min, Number(value)))
  : fallback;

export function parseDuration(value) {
  const match = String(value || "").match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
  );
  if (!match) return 0;
  return Number(match[1] || 0) * 86400
    + Number(match[2] || 0) * 3600
    + Number(match[3] || 0) * 60
    + Number(match[4] || 0);
}

export function formatDuration(value) {
  const seconds = Math.max(0, Number(value || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = Math.floor(seconds % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function extractVideoId(input) {
  const raw = clean(input, 500);
  if (/^[\w-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return /^[\w-]{11}$/.test(id || "") ? id : null;
    }
    if (host.endsWith("youtube.com")) {
      const direct = url.searchParams.get("v");
      if (/^[\w-]{11}$/.test(direct || "")) return direct;
      const parts = url.pathname.split("/").filter(Boolean);
      const index = parts.findIndex((part) => ["embed", "shorts", "live"].includes(part));
      return /^[\w-]{11}$/.test(parts[index + 1] || "") ? parts[index + 1] : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function extractPlaylistId(input) {
  const raw = clean(input, 500);
  if (/^[\w-]{10,80}$/.test(raw) && raw.startsWith("PL")) return raw;
  try {
    const id = new URL(raw).searchParams.get("list");
    return /^[\w-]{10,80}$/.test(id || "") ? id : null;
  } catch {
    return null;
  }
}

export const normalizeRequester = (value) => clean(value, 40) || "Mysterious Gremlin";
export const requesterKey = (name, ip) => crypto
  .createHash("sha256")
  .update(`${name.toLowerCase()}|${ip || ""}`)
  .digest("hex");

export function playerErrorMessage(code) {
  return ({
    2: "YouTube rejected the video identifier or player request.",
    5: "YouTube could not play this video in the HTML5 player.",
    100: "This video was removed, private, or missing.",
    101: "The owner disabled embedded playback.",
    105: "YouTube rejected this video during the compatibility check.",
    150: "The owner disabled embedded playback.",
    153: "YouTube could not verify the player origin or referrer."
  })[Number(code)] || `YouTube playback failed with error ${code || "unknown"}.`;
}
