import { clean, clamp } from "./utils.js";

export function registerSocketHandlers({ io, store, isAdmin }) {
  io.on("connection", (socket) => {
    socket.emit("state:update", store.publicState());

    socket.on("admin:register", (token, callback = () => {}) => {
      if (!isAdmin(token)) return callback({ ok: false, error: "That token does not open Cinder’s control room." });
      socket.join("admin");
      callback({ ok: true, state: store.adminState() });
    });

    socket.on("player:register", (token, callback = () => {}) => {
      if (!isAdmin(token)) return callback({ ok: false, error: "That token does not wake Cinder’s player stage." });
      socket.join("player");
      socket.join("admin");
      callback({ ok: true, state: store.adminState() });
    });

    socket.on("player:progress", (payload = {}, callback = () => {}) => {
      if (!socket.rooms.has("player")) return callback({ ok: false });
      store.state.playback = {
        status: clean(payload.status, 40) || store.state.playback.status,
        progressSec: clamp(payload.progressSec, 0, 86400, store.state.playback.progressSec),
        durationSec: clamp(payload.durationSec, 0, 86400, store.state.playback.durationSec),
        updatedAt: new Date().toISOString()
      };
      io.emit("playback:update", store.state.playback);
      callback({ ok: true });
    });

    socket.on("player:error", (payload = {}) => {
      if (!socket.rooms.has("player")) return;
      console.error("YouTube player error:", payload.code, payload.videoId, payload);

      const transient105 = String(payload.code) === "105" && payload.transient;
      io.to("admin").emit("admin:alert", {
        type: transient105 ? "warning" : "error",
        message: transient105
          ? (payload.retrying
              ? `YouTube coughed up mystery error 105 for ${payload.videoId || "a video"}. I’m retrying once and not banning it.`
              : `Error 105 survived its retry for ${payload.videoId || "a video"}. I skipped it without adding it to the no-touch list.`)
          : `YouTube threw error ${payload.code} at ${payload.videoId || "a mystery video"}. I’m handling the little betrayal.`
      });
    });
  });
}
