# CinderQuest 0.2.4

## PostgreSQL quota protection

- Adds PostgreSQL-backed YouTube search-result and video-metadata caches.
- Keeps cached YouTube API data for no longer than 30 days.
- Reuses normalized searches across capitalization and spacing differences.
- Deduplicates identical concurrent searches.
- Enforces a configurable daily fresh-search budget, defaulting to 90 calls per Pacific day.
- Retrieves up to 50 candidates in one search call and batches video details.
- Adds `regionCode`, `videoSyndicated`, and partial response fields.
- Prevents repeated browser submissions while a search is active.
- Refuses uncached search calls when PostgreSQL is unavailable.
- Leaves persistent error-105 automatic bans unchanged.
