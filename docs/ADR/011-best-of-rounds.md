# ADR 011: The best-of rounds, without a write API

## Status

Accepted.

## Context

A daily habit: read the day's bookmarks, choose one, tag it `daily_best`. After
a week, choose a `weekly_best` from the seven. After a month, a `monthly_best`
from the weeks. The choosing is a person's, always.

Two ways to record the choice were considered.

Writing the tag through the Hatena Bookmark API needs OAuth: an app registered
for a consumer key, a token flow, and credentials stored on the machine. It
also means `POST /rest/1/my/bookmark`, which updates a bookmark rather than
amending it, so adding one tag is a read-modify-write over the existing
comment and tags. Getting that wrong deletes a comment silently.

The other way is that the person adds the tag where they already add tags: the
entry page on Hatena.

## Decision

`hatebu pick` lays out the candidates and hands back the entry page URL. It
writes nothing, anywhere.

The tag comes back by itself. `hatebu sync` reads the feed, the feed carries
the tags as they stood that day, and `hatebu tagged daily_best` has worked
since before this command existed. So the weekly round reads what the daily
round wrote without either of them sharing any state:

| round | candidates are | writes the tag |
| --- | --- | --- |
| `pick` | the day's bookmarks | `daily_best` |
| `pick --weekly` | `daily_best` in the last seven days | `weekly_best` |
| `pick --monthly` | `weekly_best` in the month | `monthly_best` |

The entry URL is derived, not fetched: `/entry/s/<host><path>` for https and
`/entry/<host><path>` for http. The entry API returns the same string as
`entry_url`, and a test checks five real bookmarks against it, including an
http one and one with a percent-encoded path. Deriving keeps `pick` offline and
instant on a day of 86 candidates, where fetching would be 86 requests to
somebody else's server.

Candidates are numbered newest first, by when they were bookmarked rather than
by the order the day is stored in, so a number means the same thing every time
the list is printed. One that already carries the tag is marked, which is how a
finished day looks different from an untouched one.

## Consequences

- hatebucli still cannot write to Hatena. The MCP server stays read-only by
  construction rather than by discipline, which is the claim
  `SECURE_MCP_TUNNEL.md` makes to justify pointing it at ChatGPT.
- No credentials, no OAuth, nothing to rotate, and no way for this tool to
  destroy a comment.
- The round trip costs a sync. A tag added now is invisible to `pick --weekly`
  until the day is synced again, which for a past day means running `sync`
  for it.
- `pick` never reads today. The day being chosen over is one that has been
  synced, so there is nothing to fetch, and the default is yesterday.
