# ADR 003: CLI Structure and Commands

## Status
Accepted

## Context
The implemented CLI is a single binary (`hatebu`) built with `commander`. The previous draft listed commands and flags that do not exist in the codebase.

## Decision
Document the current command set exactly as implemented.

### 1. Root Command
- Binary name: `hatebu`
- Version command: `hatebu --version`

### 2. `config` Subcommands
- `hatebu config set <key> <value>`
  - Supported key: `username`
  - Writes to `~/.config/hatebu/credentials.json`
- `hatebu config get <key>`
  - Supported key: `username`
  - Prints value or exits with error if not found

### 3. `list` Command
- `hatebu list` (alias: `hatebu ls`)
- Options:
  - `-d, --date <yyyy-mm-dd>`
  - `-j, --json`
- Behavior:
  - An invalid `--date` exits 1 rather than throwing.
  - Today: fetch fresh data from API.
  - Non-today: read from local cache.

### 4. `search` Command
- `hatebu search <query>`
- Options:
  - `-f, --field <all|title|url>` (default: `all`)
  - `-d, --date <yyyy-mm-dd>`
  - `-l, --limit <number>` (default: `10`)
  - `-j, --json`
- Behavior:
  - Searches local cache only, by scanning it. See [ADR 005](005-search-by-scanning.md).

### 5. `domains` Command
- `hatebu domains`
- Default range:
  - from 8 days ago to yesterday
- Options:
  - `--date <yyyy|yyyy-mm|yyyy-mm-dd>`
  - `--today` (target today only; mutually exclusive with `--date`)
  - `-l, --limit <number>` (default: `10`, max: `10`)
  - `-j, --json`
- Behavior:
  - Aggregates domain counts from cached bookmark JSON.
  - If range includes today, today is fetched from API.

### 6. `tags` Command
- `hatebu tags` (alias: `hatebu tag`)
- Default range:
  - from 8 days ago to yesterday
- Options:
  - `--date <yyyy|yyyy-mm|yyyy-mm-dd>`
  - `--today` (target today only; mutually exclusive with `--date`)
  - `-l, --limit <number>` (default: `10`, max: `10`)
  - `-j, --json`
- Behavior:
  - Aggregates tag counts from cached bookmark JSON.
  - Tag sources are `tags`/`categories` fields and leading `[tag]` blocks in bookmark comment.
  - If range includes today, today is fetched from API.

### 7. `words` Command
- `hatebu words`
- Default range:
  - from 8 days ago to yesterday
- Options:
  - `--date <yyyy|yyyy-mm|yyyy-mm-dd>`
  - `--today` (target today only; mutually exclusive with `--date`)
  - `-l, --limit <number>` (default: `10`, max: `30`)
  - `-j, --json`
- Behavior:
  - Tokenizes bookmark titles with local Lindera IPADIC (`lindera-wasm-nodejs-ipadic`).
  - Aggregates tokenized word counts from cached bookmark JSON.
  - Counts each word at most once per bookmark.
  - If range includes today, today is fetched from API.

### 8. `stats` Command
- `hatebu stats`
- Default range:
  - from 8 days ago to yesterday
- Default behavior:
  - weekly Markdown summary.
- Options:
  - `--date <yyyy|yyyy-mm|yyyy-mm-dd>` (window end date anchor; default: yesterday)
  - `--days <number>` (default: `7`)
  - `--top <number>` (default: `10`, max: `20`)
- Behavior:
  - Aggregates bookmark time (hour/weekday), domain ranking, and tag ranking from cache.
  - If range includes today, today is fetched from API.
  - Shows missing cache dates when some days are not cached.

### 9. `sync` Command
- `hatebu sync`
- Options:
  - `--days <number>` (default: `1`)
  - `-d, --date <yyyy-mm-dd>`
- Behavior:
  - `--date` and `--days` cannot be used together.
  - Both are validated: a date that is not a real day, or a day count that is
    not a positive integer, exits 1.
  - `--date`: fetch that date and save cache.
  - no `--date`: fetch yesterday..N days ago and save each day.

### 10. `import` Command
- `hatebu import <dir>`
- Expects legacy layout under `<dir>/YYYY/MM/*.json`
- Copies files into current cache directory.

### 11. `lookup` Command
- `hatebu lookup <url-or-domain>`
- Options: `-l, --limit <number>` (default: `10`), `-j, --json`
- Behavior:
  - A full URL asks about one page; a bare hostname asks about a site and
    covers its subdomains.
  - Scheme and a trailing slash are ignored when comparing pages.
  - A URL that was never bookmarked reports `same_domain_count`.

### 12. `timeline` Command
- `hatebu timeline`
- Options: `--by <year|month>` (default: `year`), `--tag`, `--domain`,
  `--query`, `--from <yyyy-mm-dd>`, `--to <yyyy-mm-dd>`, `--bars`, `-j, --json`
- Behavior: counts matching bookmarks per bucket, oldest first.

### 13. `tagged` Command
- `hatebu tagged <tag>`
- Options: `-l, --limit <number>` (default: `20`), `-j, --json`

### 14. `random` Command
- `hatebu random`
- Options: `-n, --count <number>` (default: `5`), `--tag`, `--domain`,
  `--query`, `--from`, `--to`, `-j, --json`

### 15. MCP server
- `hatebu --mcp-server` (also `--mcp`, `mcp-server`, `mcp`)
- See [ADR 007](007-mcp-server.md).

## Consequences
- Documentation now matches actual runtime behavior.
- Removed references to non-existent commands and unrelated tools.
