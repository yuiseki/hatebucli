# ADR 002: Cache Strategy and Storage Layout

## Status
Accepted

## Context
`hatebucli` stores fetched bookmarks on local disk so users can re-read old days without calling the RSS endpoint every time.

## Decision
Use an XDG-style cache root with a date-based directory structure.

### 1. Cache Root Directory
- If `XDG_CACHE_HOME` is set:
  - `<XDG_CACHE_HOME>/hatebucli`
- Otherwise:
  - `~/.cache/hatebucli`

`getCacheDir()` creates this directory automatically if it does not exist.

### 2. File Layout
- Path format: `YYYY/MM/DD.json`
- Example: `~/.cache/hatebucli/2026/02/20.json`

`getCachePath(date)` creates intermediate year/month directories automatically.

### 3. Runtime Behavior
- `hatebu list`:
  - For today: always fetches from RSS API.
  - For non-today: reads local cache only.
- `hatebu sync --date YYYY-MM-DD`:
  - Fetches that date from API and writes cache.
  - If the date is today, it still runs (with warning output).
- `hatebu sync --days N`:
  - Fetches from yesterday back to `N` days.
  - Sleeps 500ms between requests.
- `hatebu import <dir>`:
  - Copies legacy `YYYY/MM/*.json` files into cache structure.

## Consequences
- Cache files are predictable and easy to inspect.
- Historical access is fast when cache exists.
- `list` does not auto-backfill missing non-today cache; users need `sync`/`import` for that.
