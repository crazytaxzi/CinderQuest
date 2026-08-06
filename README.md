# CinderQuest

CinderQuest is a self-hosted, browser-based YouTube song request system for livestreams. It includes a public request page, moderator dashboard, visible YouTube player stage, persistent fallback playlist, and transparent OBS now-playing overlay.

## Current feature set

- HellGlass styling across viewer, dashboard, player, and OBS overlay pages
- YouTube URL requests and optional YouTube search in one request card
- Modal search results with a `Choose Me` flow
- Requester name and optional note collected after choosing a video
- Visible, muted YouTube IFrame compatibility probe before queue insertion
- Failed probe popup with the YouTube player error reason
- Persistent blocked-video IDs for confirmed player failures
- Failed search results automatically excluded when the chooser reopens
- Dashboard list of blocked IDs with individual unblock controls
- Request approval, cooldowns, duplicate blocking, duration limits, keyword/channel blocks
- Persistent playlist import with shuffle or sequential fallback playback
- Queue, settings, playlist, history, and quarantine persistence in `data/state.json`
- Play, pause, skip, mute, volume, and queue-order controls
- Live state updates through Socket.IO

## Requirements

- Node.js 20 or newer
- YouTube Data API v3 key
- A long private admin token

## Setup

```bash
cp .env.example .env
nano .env
npm install
npm start
```

Configure `.env`:

```dotenv
PORT=3417
HOST=0.0.0.0
ADMIN_TOKEN=replace-with-a-long-private-value
YOUTUBE_API_KEY=replace-with-your-youtube-data-api-key
TRUST_PROXY=false
PLAYBACK_REGION=US
```

Local pages:

- Viewer request page: `http://127.0.0.1:3417/`
- Dashboard: `http://127.0.0.1:3417/dashboard`
- Player stage: `http://127.0.0.1:3417/player`
- OBS overlay: `http://127.0.0.1:3417/overlay`

When deployed to a VM, use the VM's domain or external IP instead of `127.0.0.1`. Keep `HOST=0.0.0.0`; do not browse to `0.0.0.0`.

## Playback probe flow

1. A viewer pastes a YouTube URL or searches for a video.
2. Server-side metadata filters reject known private, removed, non-embeddable, age-restricted, live, durationless, region-blocked, overlong, duplicated, keyword-blocked, channel-blocked, or quarantined videos.
3. The viewer supplies a display name and optional note.
4. CinderQuest creates a short-lived probe session.
5. A visible, muted 240 × 240 YouTube IFrame attempts to cue or play the selected video.
6. A successful `CUED`, `BUFFERING`, or `PLAYING` state commits the request to the queue.
7. Confirmed player failures with codes `5`, `100`, `101`, `105`, or `150` quarantine the video ID with its reason.
8. Error `153` is treated as a site/referrer configuration failure and does not block the song.

The legacy direct request endpoint refuses queue insertion without the playback probe.

## Persistent files

Do not commit these:

```text
.env
data/state.json
```

Back up both before replacing a deployment. `data/state.json` contains playlist data, queue history, settings, and blocked-video records.

## Linux upgrade helper

The included `upgrade-linux.sh` preserves `.env` and the `data` directory while replacing application files from a release ZIP.

```bash
./upgrade-linux.sh "$HOME/CinderQuest_v0.2.0.zip" "$HOME/songrequest"
```

## OBS

Add a Browser Source:

```text
http://YOUR_HOST:3417/overlay
```

Suggested size: `1000 × 240`.

Use the Player Stage in a normal browser for the official visible YouTube player. Capture that browser's audio through OBS Application Audio Capture or your normal VoiceMeeter/MixLine routing.

## Validation

Run static checks with:

```bash
npm run check
```

## Security

- Never commit `.env`.
- Put public deployments behind HTTPS.
- Restrict `/dashboard` and `/player` at the reverse proxy when possible.
- Keep the YouTube API key server-side.
- Use a long random admin token.
