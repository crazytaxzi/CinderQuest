# CinderQuest 0.2.3

## Error 105 policy restored

Error `105` is once again treated as a permanent playback failure.

- The viewer compatibility probe immediately reports the failure to the server.
- The main player immediately ends the failed track and reports error `105`.
- The server automatically adds the video ID to the persistent no-touch list.
- The blocked ID remains in `data/state.json` across restarts.
- Startup does not delete or release error-105 records.
- The video remains blocked until the streamer explicitly uses **Forgive It** or clears the no-touch list.

The server-side IPv4 DNS preference remains enabled. The manual ban controls, scrollable history and blocked lists, sticky dashboard controls, and clipped overlay ambience are unchanged.
