# CinderQuest 0.2.5

## Playback compatibility and no-touch records

- Keeps the existing Data API prefilter and real same-origin IFrame playback probe as separate layers.
- Keeps known-bad video IDs out before another probe or queue attempt.
- Classifies YouTube errors `101` and `150` as `youtube_embed_restricted` in persistent no-touch records.
- Keeps error `153` out of the no-touch list; it remains a player identity/referrer setup failure that halts the stage.
- Stops viewer-probe error `5` from permanently quarantining a video ID.
- Preserves the requested permanent auto-ban policy for error `105`.
- Adds structured no-touch fields: `blocked`, `youtubeError`, `reasonCode`, `firstFailureAt`, and `lastFailureAt` while retaining the previous compatibility fields.
- Normalizes older saved no-touch records on load so the dashboard and filters can continue using them without migration work.
