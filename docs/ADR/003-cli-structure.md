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
  - Today: fetch fresh data from API.
  - Non-today: read from local cache.

### 4. `sync` Command
- `hatebu sync`
- Options:
  - `--days <number>` (default: `1`)
  - `-d, --date <yyyy-mm-dd>`
- Behavior:
  - `--date`: fetch that date and save cache.
  - no `--date`: fetch yesterday..N days ago and save each day.

### 5. `import` Command
- `hatebu import <dir>`
- Expects legacy layout under `<dir>/YYYY/MM/*.json`
- Copies files into current cache directory.

### 6. `search` Command
- `hatebu search <query>`
- Options:
  - `-f, --field <all|title|url>` (default: `all`)
  - `-d, --date <yyyy-mm-dd>`
  - `-l, --limit <number>` (default: `10`)
  - `-j, --json`
- Behavior:
  - Searches local cache only.
  - Builds/refreshes per-day local index under `index/v1` on demand.

### 7. `domains` Command
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

### 8. `tags` Command
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

## Consequences
- Documentation now matches actual runtime behavior.
- Removed references to non-existent commands and unrelated tools.
