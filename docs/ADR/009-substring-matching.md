# ADR 009: Substring terms, not unigram tokens

## Status

Accepted. Replaces the tokenization in ADR 004, which ADR 005 carried forward
unchanged when the index was removed.

## Context

A query was matched a character at a time: every character of it had to appear
somewhere in the field, in any order. ADR 004 chose that for Japanese recall,
and it was the right shape for an inverted index, where substring matching is
not something postings can answer.

The first session through an MCP connector showed what it costs. The model
asked for `arxiv.org` in the URL field and got back a hundred rows, twenty-one
of which were not on arxiv.org: a URL only had to contain a, r, x, i, v, o and
g. `dev.classmethod.jp/articles/dgx-spark-vision/` qualifies.

Making the URL field a substring match fixed that and left the same defect in
the title field, which the next session found: `GeoAI` matched 46,953
bookmarks, twelve percent of the whole archive, because those five letters are
easy to find in a long Japanese title. The tool reports `match_count` and the
description tells a model to count from it, so a loose match is not merely
noisy any more; it is a wrong answer to "how many".

Measured over the archive, against substring terms:

| query | per character | substring |
| --- | --- | --- |
| `GeoAI` | 46,953 | 30 |
| `OpenStreetMap` | 22,135 | 290 |
| `MapLibre` | 13,457 | 120 |
| `geospatial` (title) | 19,120 | 255 |
| `arxiv` | 4,661 | 506 |
| `地図` | 1,072 | 995 |
| `地図 AI` | 341 | 107 |

The last two rows are the argument. Japanese was what per-character matching
existed for, and it is where it makes almost no difference: a substring search
for 地図 already finds 地図帳 and 白地図, because Japanese does not put spaces
between words. The 77 bookmarks it loses are titles with 地 and 図 in unrelated
places. Everywhere else the loose match is off by one to three orders of
magnitude.

## Decision

A query is one or more terms separated by whitespace. Every term has to appear
as a substring, in the title or the URL according to `--field`; with `all` a
term may match either. No tokenization, no per-script special case.

Scoring: two points for a term found in the title, one for the URL, and for a
multi-term query four more when the query appears in the title as written and
two when it does in the URL. Ties break newest first, then by title.

## Consequences

- `match_count` means something, which is what let the tool description say to
  count from it.
- Whitespace became meaningful. `地図 AI` is two terms, both required, where it
  used to be one bag of characters.
- Punctuation became meaningful, and that is the point: `arxiv.org` is a host,
  where before the dot was stripped and the rest was a letter set.
- Searching got faster: 0.44s to 0.61s over the archive against 0.6s to 2.4s,
  because a common character no longer collects most of the corpus before the
  scoring stage throws it away.
- `matchedTitleTokens` and `matchedUrlTokens` are gone from `SearchResult`.
  They listed the characters that matched, which only made sense for the old
  scheme. `matchedIn` says which field matched, which is the part worth having.
- A query for a run of characters that spans a word boundary in Japanese now
  misses, where the old scheme would have found it by accident. That is the
  trade, and the measurement above is why it is worth taking.
