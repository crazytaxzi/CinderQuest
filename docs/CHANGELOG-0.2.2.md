# CinderQuest 0.2.2

## Error 105 handling

- Removed undocumented YouTube IFrame error `105` from the permanent and probe block lists.
- The main player retries a `105` once, then skips without banning the video ID.
- The viewer playback probe also retries `105` once before giving up.
- Existing automatic `105` bans are released from `data/state.json` on startup.
- Manual bans are preserved.
- Server-side DNS now prefers IPv4 through Node's `dns.setDefaultResultOrder("ipv4first")`.

The IPv4 setting affects CinderQuest's server-side YouTube API traffic. It does not control the browser-hosted YouTube IFrame player.

## Dashboard

- Added **Ban This Video** for the currently playing track.
- Added **Ban This Video** to every pending or queued request.
- Manual bans remove the video from the active queue and emergency playlist, save the video ID and reason, and advance the player when necessary.
- Recent history and blocked-video lists now have bounded scroll areas.
- Emergency mixtape, Boundaries & bad habits, and OBS cards stay compact in a sticky, independently scrollable sidebar on desktop.

## Overlay

- Moved the projector haze and particles inside the song stack.
- Clipped the ambience to the exact height of the current-song card so it no longer climbs above the overlay on stream.
