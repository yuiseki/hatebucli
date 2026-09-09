# ADR 005: Search by scanning, not by an index

## Status

Accepted. Supersedes the index described in ADR 004.

## Context

ADR 004 built a per-day inverted index under `<cacheRoot>/index/v1`, with
unigram tokens and separate title and URL postings, on the reasoning that
scanning would not scale.

Measured against the real archive, it does not hold. On 10,485 cached days
holding 373,963 bookmarks:

| | index | scanning |
| --- | --- | --- |
| on disk | 381MB | 110MB (the bookmarks themselves) |
| `search 地図` | 2.9s | 0.6s |
| `search maplibre` | 3.6s | 1.4s |
| `search ai` | 4.5s | 2.4s |

The index is three and a half times the size of the data it indexes, and
reading it is slower than reading the data. Unigram postings are why: with a
per-character vocabulary the postings are nearly as long as the corpus, and a
common character's posting list names most of the documents in its day.

## Decision

`searchBookmarks` reads the cached days and looks at every bookmark.
`src/services/search.ts` replaces `src/searchIndex.ts`, and nothing writes to
`index/v1` any more.

The matching is unchanged, deliberately: every character of the query must
appear, in the title for `--field title`, in the URL for `--field url`, in
either for `all`; the score is two per title character plus one per URL
character, plus four when the whole query appears as a run in the title and two
when it does in the URL; ties break newest first, then by title. A test
compared both implementations over the real archive across several queries,
every field and a single-day query, and the results were identical.

What the index did that a scan has to do too is the token membership test. A
query token is one non-skipped character, so asking whether the normalized
title contains it is the same question as asking whether it is in that title's
token set, and it costs one `includes` rather than a set built per document.

## Consequences

- No index to keep fresh, so the whole freshness apparatus is gone:
  `sourceMtimeMs`, `sourceSize`, the version check and the rebuild path. A
  re-synced day is simply searched as it now is, which is what the rebuild was
  there to imitate.
- `~/.cache/hatebucli/index` is left behind by earlier versions and is now
  dead. It can be deleted.
- `search` no longer writes to the cache directory, so it works on a read-only
  copy of an archive.
- The worst case is a query whose every character is common, where nearly every
  bookmark matches all tokens and gets scored: `ai` takes 2.4s over the whole
  archive. Restricting the range with `--date` avoids it, and it is still
  faster than the index was.
