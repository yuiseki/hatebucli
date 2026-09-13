# ADR 010: Distinctive words, against a background built once

## Status

Accepted.

## Context

`hatebu words` ranked by raw frequency. For any window of this archive the
answer was some arrangement of the same words:

```
ai(103) github(80) for(40) and(33) the(29) ニュース(21) 日本(21) https(21)
```

That is a true statement about which words appeared and a useless answer to
what the month was about. Frequency measures the archive's habits, not the
window's subject.

The question worth answering is comparative: which words did this stretch use
more than the archive usually does. Three ways of asking it were measured on
the same window (August 2026):

| | top words |
| --- | --- |
| frequency | ai github for and the qwen ニュース 日本 https 開発 |
| tf-idf | ai github qwen for and claude the hugging face マップ |
| log-odds with prior | ai github claude hugging face マップ qwen 地図 地震 map |

tf-idf still carries `for`, `and`, `the`: multiplying by term frequency lets a
word the archive uses everywhere win on volume. The log-odds ratio with an
informative Dirichlet prior (Monroe, Colaresi and Quinn, 2008) drops them
without a stopword list, in Japanese and English alike, because a word used at
its usual rate scores near zero whatever its count.

## Decision

Rank by the log-odds ratio with an informative Dirichlet prior, against a
background of the whole archive. `--by count` keeps the old ranking.

A word used once in a window is dropped. One mention is not evidence of what a
stretch was about, and the tail of every window is full of them.

## Why a file and not a database

Tokenizing 374,000 titles takes 68 seconds, so the background cannot be
computed per call. A window can: a month is 0.16s.

That split is the whole design. Only the background is stored, as one JSON
file of word to document count, and the window is tokenized live.

Measured alternatives, for the same job:

| | size | load or query |
| --- | --- | --- |
| background as JSON, pruned to df>=2 | 0.96MB | 28ms |
| background as JSON, everything | 2.14MB | 63ms |
| per-day counts in SQLite | 59MB | 2ms for a month, 43ms for a year |
| per-day counts as JSONL | ~60MB | 1-2s to parse |

SQLite via `node:sqlite` would add no dependency and answers a year window in
43ms against 4s. It was not taken: 59MB and a schema to migrate buys speed on
the one window size that is rare in practice, and the 1MB file is legible,
diffable and rebuilt in a minute. The same reasoning retired the search index
in [ADR 005](005-search-by-scanning.md), and it points the other way here only
because the cost being avoided is 68 seconds rather than half of one.

If year-scale queries turn out to matter, a per-year table is 2.7MB and 48ms,
and can be added without changing anything else.

## Consequences

- `words` is 0.4s for a week, 0.55s for a month, 4s for a year.
- The background is built by hand: `hatebu words --rebuild-background`, 68s.
  It is not wired into `sync`, because a day of 35 bookmarks moves a background
  of 374,000 by nothing, and incremental updates would need per-day bookkeeping
  to avoid double counting the same day twice.
- Without the background the command still answers, by counting, and says so.
  The MCP tool reports `scoring` for the same reason: a model must be able to
  tell which question it got an answer to.
- Reading the background never writes, so this works under the read-only home
  the MCP server runs in. Only the build writes, and only the CLI builds.
- Rates are per word instance, not per bookmark. A window whose titles are
  wordier than usual dilutes every word in it a little, which is correct: the
  comparison is between rates, not counts.
