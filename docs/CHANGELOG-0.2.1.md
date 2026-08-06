# CinderQuest 0.2.1

## Cinder voice pass

Visible copy was rewritten across the viewer request pit, modal search/request flow, control room, player stage, OBS overlay, queue cards, empty states, status text, YouTube rejection messages, rate limits, and live player alerts.

## Request loop fix

The false-success-then-404 loop came from a late YouTube callback firing after a successful probe had already consumed its token and the dialog had started closing. Destroying the probe player could trigger one final state or error event, which then attempted to call a failure route with a stale or empty token.

The fixed flow now:

- captures the probe token locally for the entire run
- binds callbacks to a monotonic probe generation
- marks the probe finished before destroying its player
- ignores callbacks from closed or superseded probes
- cancels the server-side probe with an idempotent DELETE route
- allows X, Escape, backdrop click, and the visible cancel button to stop testing
- waits for stable `PLAYING` or `CUED` instead of immediately accepting `BUFFERING`
- leaves the success verdict open until the viewer dismisses it

Static JavaScript checks passed for the server, route modules, shared browser code, viewer flow, dashboard, player, and overlay.
