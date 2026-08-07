# CinderQuest

CinderQuest is a self-hosted HellGlass YouTube song requester for streams. It includes a viewer request pit, Cinder's control room, a visible YouTube player stage, a transparent OBS overlay, a persistent emergency playlist, queue history, a remembered no-touch list, and a PostgreSQL-backed YouTube search cache.

## Pages

- `/` — viewer request pit
- `/dashboard` — Cinder's control room
- `/player` — visible YouTube player stage
- `/overlay` — transparent HellGlass OBS overlay
- `/api/health` — health and cache readiness

## Requirements

- Node.js 20 or newer
- PostgreSQL
- A YouTube Data API v3 key
- A strong admin token
- The actual YouTube player kept visible somewhere on stream

## PostgreSQL setup on Ubuntu

```bash
sudo apt-get update
sudo apt-get install -y postgresql

sudo -u postgres psql <<'SQL'
CREATE USER cinderquest WITH PASSWORD 'replace-this-password';
CREATE DATABASE cinderquest OWNER cinderquest;
SQL
```

Set the same password in `.env`:

```dotenv
DATABASE_URL=postgresql://cinderquest:replace-this-password@127.0.0.1:5432/cinderquest
DATABASE_SSL=false
```

CinderQuest creates its cache and quota tables automatically at startup.

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

Then restart using `npm start` or the configured systemd service.

## Environment

```dotenv
PORT=3417
HOST=0.0.0.0
ADMIN_TOKEN=replace-with-a-long-random-secret
YOUTUBE_API_KEY=replace-with-your-youtube-data-api-key
PLAYBACK_REGION=US
TRUST_PROXY=false

DATABASE_URL=postgresql://cinderquest:replace-this-password@127.0.0.1:5432/cinderquest
DATABASE_SSL=false
YOUTUBE_CACHE_TTL_DAYS=30
YOUTUBE_SEARCH_DAILY_BUDGET=90
YOUTUBE_SEARCH_CANDIDATES=50
YOUTUBE_SEARCH_DISPLAY_LIMIT=8
YOUTUBE_QUOTA_TIMEZONE=America/Los_Angeles
```

`YOUTUBE_CACHE_TTL_DAYS` is hard-clamped to a maximum of 30 days.

## Search quota protection

CinderQuest protects YouTube search calls in several layers:

- Normalizes query spacing and case before cache lookup.
- Stores search result video IDs in PostgreSQL for up to 30 days.
- Stores fetched video metadata in PostgreSQL for up to 30 days.
- Reapplies current bans, blocked channels, duration limits, duplicates, and region rules every time cached data is used.
- Deduplicates identical searches that arrive at the same time.
- Reserves at most 90 fresh `search.list` calls per Pacific day by default.
- Pulls up to 50 candidates in one search call and batches metadata through `videos.list`.
- Uses `regionCode`, `videoSyndicated`, and `videoEmbeddable`.
- Uses partial response fields to reduce response size.
- Blocks repeated browser submissions while a search is active.
- Refuses to perform uncached search calls when PostgreSQL is unavailable.

Direct YouTube links also benefit from the PostgreSQL video metadata cache.

## Playback compatibility gate

A metadata flag is not trusted as the final answer. Requests pass through the following gate:

1. `search.list` asks for syndicated, embeddable video candidates when search is used.
2. `videos.list` checks current metadata including `status.embeddable`, privacy, processing state, region restrictions, age restriction, duration, and whether YouTube supplied an embed player.
3. The persistent no-touch list is checked before a known-bad video is offered or probed again.
4. The viewer page creates a real muted YouTube IFrame Player on the same origin as the requester and waits for a stable `PLAYING` or `CUED` state.
5. Runtime failures from the main player are also remembered when they match the permanent-failure policy.

Error handling is deliberately different depending on what the code means:

- `100` — removed/private/unavailable; permanently blocked until manually forgiven.
- `101` and `150` — embedded playback denied; permanently blocked as `youtube_embed_restricted` until manually forgiven.
- `105` — remains a permanent no-touch failure by project policy.
- `5` — HTML5/player failure; the request fails, but the viewer probe does not permanently poison the video ID.
- `153` — player identity/referrer problem; the stage halts instead of blaming or banning the song.

No-touch records are saved with structured fields including `blocked`, `youtubeError`, `reasonCode`, `failureCount`, `firstFailureAt`, `lastFailureAt`, and `source`. Older records are normalized when state is loaded, while the existing `errorCode`, `firstSeenAt`, and `lastSeenAt` fields remain for compatibility.

## Persistent state

Runtime queue data remains in `data/state.json`, including:

- queue and recent history
- rules and volume
- emergency playlist and cursor
- blocked video IDs with their failure reason and runtime failure metadata

YouTube search and metadata cache records live in PostgreSQL.

## Version 0.2.5

- Makes the two-layer embed check explicit: Data API metadata first, real same-origin IFrame playback second.
- Keeps known-bad video IDs out before another probe or queue attempt.
- Classifies errors `101` and `150` as `youtube_embed_restricted` in persistent no-touch records.
- Keeps error `153` out of the no-touch list and treats it as a player identity/referrer setup failure.
- Stops viewer-probe error `5` from permanently quarantining a video ID.
- Preserves the requested permanent auto-ban behavior for error `105`.
- Adds structured no-touch metadata while retaining the old record fields for compatibility.

## Version 0.2.4

- Adds PostgreSQL-backed search and video metadata caches.
- Enforces a maximum cache age of 30 days.
- Adds concurrent identical-search deduplication.
- Adds a configurable daily fresh-search budget that follows Pacific-day reset timing.
- Expands a single search call to as many as 50 candidates.
- Adds region and syndicated-playback search filters.
- Adds partial API response fields.
- Adds browser-side duplicate search-submit protection.
- Keeps error `105` as a persistent automatic ban until manually forgiven.

## OBS

Use `/overlay` as a Browser Source. A practical starting size is `1000 × 240`.

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
