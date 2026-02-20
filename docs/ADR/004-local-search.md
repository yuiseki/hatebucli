# ADR 004: Local Search Index for `hatebu search`

## Status
Accepted

## Context
`hatebucli` currently stores daily bookmarks as JSON cache files (`YYYY/MM/DD.json`) but has no local search command.
We want to add `hatebu search` with these constraints:

- Most bookmark titles are Japanese.
- Search should work offline from local cache.
- Title and URL must be indexed as separate fields.

## Decision
Adopt a local per-day inverted index with unigram tokenization and field-separated postings.

### 1. Command Scope
Add a new command:

- `hatebu search <query>`

Planned options:

- `-f, --field <all|title|url>` (default: `all`)
- `-d, --date <yyyy-mm-dd>` (optional day filter)
- `-l, --limit <number>` (default: `10`)
- `-j, --json` (machine-readable output)

### 2. Source of Truth
Search reads from existing cache files only:

- `~/.cache/hatebucli/YYYY/MM/DD.json` (or `${XDG_CACHE_HOME}/hatebucli/...`)

No API fetch is performed by `search`.

### 3. Index Storage Layout
Store index files under:

- `<cacheRoot>/index/v1/YYYY/MM/DD.json`

Each day index stores:

- Source metadata for freshness check:
  - `sourceMtimeMs`
  - `sourceSize`
- `documents` array (title, link, date, description)
- Field postings:
  - `fields.title[token] -> docId[]`
  - `fields.url[token] -> docId[]`

### 4. Tokenization Strategy (Japanese-first)
Use unigram tokenization:

1. Normalize text with `NFKC` and lowercase.
2. Split into single characters.
3. Skip whitespace and punctuation/symbol characters.
4. De-duplicate tokens per document field.

Rationale:

- Better recall for Japanese text than whitespace-based tokenization.
- No external morphological analyzer dependency.

### 5. Query Semantics
- Default mode is `AND` over query tokens.
- `--field title` searches only title postings.
- `--field url` searches only URL postings.
- `--field all` allows token matches across both fields.
- Results are sorted by score, then by date (newer first).

Scoring baseline:

- Title token hit: higher weight.
- URL token hit: lower weight.
- Exact normalized substring match: additional boost.

### 6. Index Refresh Policy
Index build is on-demand per day:

1. When a day is searched, if index is missing, build it.
2. If index exists but source metadata does not match cache file, rebuild it.
3. Otherwise reuse existing index.

This avoids full rebuilds while keeping index consistent with cache updates from `sync` and `import`.

## Consequences
- Fast local search without network dependency.
- High Japanese recall with unigram indexing.
- Separate title/URL querying becomes possible.
- Unigram can increase noise for short queries; ranking and field filters mitigate this.
