# CinderQuest

CinderQuest is a self-hosted HellGlass YouTube song requester for streams. It includes a viewer request pit, Cinder's control room, a visible YouTube player stage, a transparent OBS overlay, a persistent emergency playlist, queue history, and a remembered no-touch list for videos that fail playback.

## Pages

- `/` — viewer request pit
- `/dashboard` — Cinder's control room
- `/player` — visible YouTube player stage
- `/overlay` — transparent HellGlass OBS overlay
- `/api/health` — health check

## Request flow

Viewers can slip in a YouTube URL or hunt by artist and title. Search results open in a modal, where the viewer chooses a video, enters a display name, and may leave Cinder a note.

Before a request touches the queue, CinderQuest creates a temporary probe session and loads the selected video in a muted YouTube IFrame player. A stable `PLAYING` or `CUED` state passes. Confirmed player errors are remembered by video ID and excluded from later searches and playlist imports.

Closing the modal, pressing Escape, clicking the backdrop, or using **Never Mind, Let It Go** cancels the active probe. Late YouTube callbacks are ignored after cancellation, preventing stale success/failure loops.

## Requirements

- Node.js 20 or newer
- A YouTube Data API v3 key
- A strong admin token
- The actual YouTube player kept visible somewhere on stream

## Install from GitHub

```bash
cd ~
git clone https://github.com/crazytaxzi/CinderQuest.git songrequest
cd songrequest
git switch agent/hellglass-search-probe
cp .env.example .env
nano .env
npm install
npm run check
npm start
```

## Update from GitHub

```bash
cd ~/songrequest
git pull --ff-only origin agent/hellglass-search-probe
npm install
npm run check
```

Then restart the process using either `npm start` or the configured systemd service.

After the feature branch is merged, switch the VM to `main` once:

```bash
cd ~/songrequest
git fetch origin
git switch main
git pull --ff-only origin main
npm install
npm run check
```

## Environment

```dotenv
PORT=3417
HOST=0.0.0.0
ADMIN_TOKEN=replace-with-a-long-random-secret
YOUTUBE_API_KEY=replace-with-your-youtube-data-api-key
PLAYBACK_REGION=US
TRUST_PROXY=false
```

Never commit `.env` or `data/state.json`. Both are ignored by Git.

## Persistent state

Runtime data is saved in `data/state.json`, including:

- queue and recent history
- rules and volume
- emergency playlist and cursor
- blocked video IDs with their failure reason

## OBS

Use `/overlay` as a Browser Source. A practical starting size is `1000 × 240`. The overlay is transparent, while the viewer, dashboard, and player pages use the same HellGlass visual language over a full-page background.

Keep the Player Stage visible somewhere on stream. Capture its audio through OBS Application Audio Capture, VoiceMeeter, MixLine, or the rest of your preferred audio ritual.

## Version 0.2.1

- Rewrote viewer, dashboard, player, overlay, status, empty-state, and common error copy in Cinder's voice.
- Fixed the false-success-then-404 request loop caused by late YouTube callbacks after the probe player was destroyed.
- Bound every probe callback to one captured token and one probe generation.
- Added explicit cancellation through X, Escape, backdrop click, and the testing cancel button.
- Removed automatic closing after success so the viewer controls when the verdict disappears.
- Requires stable playback or cue state before accepting a probe.
- Disables browser caching for HTML, JavaScript, and CSS so Git deployments do not leave stale front-end code behind.

## Validation

```bash
npm run check
```

## Security

- Never commit `.env`.
- Put public deployments behind HTTPS.
- Restrict `/dashboard` and `/player` at the reverse proxy when possible.
- Keep the YouTube API key server-side.
- Use a long random admin token.
