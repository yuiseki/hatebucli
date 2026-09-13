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
the list is printed.

A round that is already decided prints the choice and stops. The common case
for a daily round is a day whose best has been chosen, and eighty-six lines
that have to be scanned for a marker to find that out is the wrong answer to
"is this done". `--all` lists them anyway, with the chosen one marked, and a
number still resolves against that same list, so changing your mind costs
nothing. More than one bookmark may carry the tag: some days do not narrow to
one, and a round that refused them would be asking the archive to be tidier
than the reading was. They are all shown, and they are all candidates for the
round above, so a week with a two-best day simply has more than seven to choose
from.

## The round fetches before it judges

A tag added on the entry page is invisible until that day is fetched again.
That is the one way this workflow shows a wrong answer with a straight face: a
week looks half-finished because the cache predates the tagging, not because
the days were not chosen. It happened on the first real week.

So `pick` syncs its window first, and only when the cache does not already show
the round as decided. A decided round costs no requests and answers in 0.1s; an
undecided week costs its seven days and answers in 4.5s. `--no-sync` reads the
cache as it stands.

Today is never fetched: it is still being bookmarked into, and the daily round
defaults to yesterday anyway.

That change exposed an older fault. `fetchBookmarksByDate` returned an empty
array whether the day was empty or the fetch had failed, and both `sync` and
the new code cached that empty array over a good day. It now returns null for a
failure, `sync` reports the day and leaves the cache alone and exits non-zero,
and `pick` keeps the cached copy and says it did.

## Consequences

- hatebucli still cannot write to Hatena. The MCP server stays read-only by
  construction rather than by discipline, which is the claim
  `SECURE_MCP_TUNNEL.md` makes to justify pointing it at ChatGPT.
- No credentials, no OAuth, nothing to rotate, and no way for this tool to
  destroy a comment.
- The round trip costs a sync, which `pick` now does for its own window.
- `pick` never reads today. The day being chosen over is one that has been
  synced, so there is nothing to fetch, and the default is yesterday.
