# ADR 001: Hatena User Configuration and Credentials

## Status
Accepted

## Context
`hatebucli` needs a Hatena username to fetch RSS entries. The implementation supports two configuration sources:

1. Environment variables loaded via `dotenv`.
2. Local stored config at `~/.config/hatebu/credentials.json`.

## Decision
Use environment variables as the primary source, with a local config file fallback for the username.

### 1. Environment Variables
- `HATENA_USER`:
  - Used as the target Hatena username.
  - Loaded from process environment and `.env` via `dotenv.config()`.
- `HATENA_BOOKMARK_RSS_URL`:
  - Optional RSS base URL override.
  - Default is `https://b.hatena.ne.jp/%s/bookmark.rss` (`%s` is replaced with username).

### 2. Stored Local Config
- File path: `~/.config/hatebu/credentials.json`
- Supported CLI key:
  - `username` only
- CLI interface:
  - `hatebu config set username <value>`
  - `hatebu config get username`

### 3. Username Resolution Order
`ensureHatenaUser()` resolves in this order:

1. `HATENA_USER` from environment/dotenv config.
2. `HATENA_USER` from stored config (`username` key).
3. If neither exists, show an error and exit.

## Consequences
- Configuration is explicit and portable across shells.
- Users can persist username without exporting env vars each time.
- Unknown config keys are rejected by `config set`.
