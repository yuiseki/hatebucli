# @yuiseki/hatebucli

Your Hatena Bookmark history, on your machine and answerable.

Hatena Bookmark gives you a feed of what you bookmarked, one day at a time, and
not much else. `hatebu` syncs those days into a local cache and then answers
questions over the whole of it: what you were reading in 2019, which sites you
keep coming back to, when a subject first showed up, whether you have already
bookmarked the page in front of you. Everything except today is answered from
the cache, so it works offline and it stays fast on an archive of hundreds of
thousands of bookmarks.

It also runs as an [MCP server](#mcp-server), so an assistant can ask the same
questions without you translating each one into flags.

## Install

```bash
npm i -g @yuiseki/hatebucli
```

## Getting started

```bash
hatebu config set username <your_hatena_id>
hatebu sync --days 30
hatebu words
```

`sync` is what fills the cache, one request per day, spaced out because the
feed is somebody else's server. Nothing else here fetches anything, apart from
today.

## Commands

Every command that reports bookmarks or rankings takes `-j, --json`. `stats` is
the exception: it is Markdown by design.

### One day

```bash
hatebu list                      # today, fresh from the feed
hatebu list --date 2026-02-18    # an earlier day, from the cache
```

| Option | |
| --- | --- |
| `-d, --date <yyyy-mm-dd>` | the day. Defaults to today |
| `-j, --json` | |

### Search

```bash
hatebu search 地図                          # every cached day, best match first
hatebu search zenn.dev --field url
hatebu search 地図 --date 2026-02-18 -l 50
```

Titles are mostly Japanese, so a query is matched a character at a time: every
character has to appear, and a run of them appearing together scores higher.
Results are ordered by score, then newest first.

| Option | |
| --- | --- |
| `-f, --field <all\|title\|url>` | where to match. Default `all` |
| `-d, --date <yyyy-mm-dd>` | one day only |
| `-l, --limit <number>` | default 10 |
| `-j, --json` | |

### Rankings over a range

```bash
hatebu domains --date 2026       # the sites of a year
hatebu tags --date 2026-02       # the tags of a month
hatebu words                     # what last week was about
hatebu words --today
hatebu stats --days 30 --top 20  # a window as one summary
```

`domains`, `tags` and `words` take the same range options. With none of them
the range is the week ending yesterday.

| Option | |
| --- | --- |
| `--date <yyyy\|yyyy-mm\|yyyy-mm-dd>` | a day, a month or a year |
| `--today` | today only. Cannot be combined with `--date` |
| `-l, --limit <number>` | rows. Default 10, capped at 10 for `domains` and `tags`, 30 for `words` |
| `-j, --json` | |

`words` runs the titles through a Japanese morphological analyser, so it says
what a stretch was about even where nothing was tagged. A word counts once per
bookmark however often the title repeats it.

`stats` puts a window together as Markdown: how much, at what hours, on what
weekdays, and the sites and tags that led it.

| Option | |
| --- | --- |
| `--date <yyyy\|yyyy-mm\|yyyy-mm-dd>` | the day the window ends on. Defaults to yesterday |
| `--days <number>` | window length. Default 7 |
| `--top <number>` | rows per section. Default 10, capped at 20 |

Each of these reports the days of the range the cache does not hold, so a low
count can be told apart from a gap in the sync.

### The whole archive

```bash
hatebu lookup https://example.com/article   # have I bookmarked this page?
hatebu lookup example.com                   # what have I read from this site?
hatebu timeline --query maplibre --bars     # when was I reading about this?
hatebu timeline --by month --tag 地図
hatebu tagged 地図                           # what did I file under this tag?
hatebu random -n 5 --from 2010-01-01        # dig something out of the archive
```

`lookup` answers about one page when given a full URL, and about a site when
given a bare hostname. A subdomain counts as part of the site, and the scheme
and a trailing slash are ignored, because neither makes it a different page. A
URL that was never bookmarked still reports how much came from the same site.

`timeline` counts per `year` or per `month`, oldest first, and takes `--tag`,
`--domain`, `--query`, `--from` and `--to` in any combination. `--bars` draws
each row. `random` takes the same filters.

These read every cached day rather than an index. Over an archive of a few
hundred thousand bookmarks that is under a second.

### Filling the cache

```bash
hatebu sync                       # yesterday
hatebu sync --days 30             # yesterday back thirty days
hatebu sync --date 2019-07-04     # one day
hatebu import ./old-bookmarks     # a legacy <dir>/YYYY/MM/*.json tree
```

`sync` never fetches today by default: today is still changing, and a cached
copy of a half-finished day would be wrong from the moment it was written.
`--days` and `--date` cannot be combined.

### Configuration

```bash
hatebu config set username <your_hatena_id>
hatebu config get username
```

## Where things live

| | |
| --- | --- |
| Bookmarks | `${XDG_CACHE_HOME:-~/.cache}/hatebucli/YYYY/MM/DD.json` |
| Username | `~/.config/hatebu/credentials.json` |
| `HATENA_USER` | the user ID, and it wins over the stored one |
| `HATENA_BOOKMARK_RSS_URL` | override the feed URL. `%s` is the user ID |

The cache is plain JSON per day and safe to copy, diff or back up. Earlier
versions also kept a search index under `hatebucli/index`; nothing writes there
any more and it can be deleted (see
[ADR 005](docs/ADR/005-search-by-scanning.md)).

## What the archive can and cannot tell you

- A day that was never synced is not a day with nothing in it, and the
  commands say which is which rather than reporting a zero.
- Tags come from the feed as it stood on the day. A stretch from before you
  started tagging has no tags, which is a gap in the data and not a gap in your
  reading; `words` is the tool for those years.
- Comments are only present where you left one, which for most people is
  almost nowhere.
- Re-syncing an old day is safe and sometimes an improvement: a legacy import
  can carry a URL where the title should be, and the feed still has the title.

## MCP server

`hatebu --mcp-server` runs the CLI as a Model Context Protocol server over
stdio, so an MCP client can read your bookmarks. `--mcp`, `mcp-server` and
`mcp` start the same thing.

```bash
hatebu --mcp-server
```

It needs a username before it starts, from `hatebu config set username` or from
`HATENA_USER` in the client's environment. stdout carries only JSON-RPC;
anything meant for a human goes to stderr.

Configured in a client:

```json
{
  "mcpServers": {
    "hatebu": {
      "command": "npx",
      "args": ["-y", "@yuiseki/hatebucli", "--mcp-server"],
      "env": { "HATENA_USER": "your_username" }
    }
  }
}
```

Everything except today is answered from the local cache, so run `hatebu sync`
before pointing a client at it.

### Tools

Ten, all read-only. Nothing writes to your account, and there is no sync tool:
fetching is a decision about somebody else's server, so it stays a command you
run.

| Tool | Arguments |
| --- | --- |
| `hatebu_search` | `query` (required, up to 200 characters), `field`, `date`, `limit` (default 10, max 100) |
| `hatebu_list` | `date` (defaults to today) |
| `hatebu_domains` | `date`, `today`, `limit` |
| `hatebu_tags` | `date`, `today`, `limit` |
| `hatebu_words` | `date`, `today`, `limit` (default 30) |
| `hatebu_stats` | `date`, `days`, `top` |
| `hatebu_lookup` | `url_or_domain` (required), `limit` |
| `hatebu_timeline` | `by`, `tag`, `domain`, `query`, `from`, `to` |
| `hatebu_tagged` | `tag` (required), `limit` |
| `hatebu_random` | `count`, `tag`, `domain`, `query`, `from`, `to` |

They answer the same numbers as the matching command, down to the defaults, and
a test holds them to it. What differs is what a model needs and a terminal does
not:

- Every ranking returns `missing_dates` alongside the numbers, so a model can
  tell a quiet week from an unsynced one.
- `hatebu_list` says whether the day was in the cache at all.
- `hatebu_stats` returns the Markdown and the same numbers as JSON, as two
  blocks: the Markdown to show, the JSON to compute from.
- `hatebu_search` drops the `matchedTitleTokens` and `matchedUrlTokens` that
  `--json` returns. Matching is per character, so they are lists of single
  letters, which explain a score to a person and say nothing to a model.

A bad argument comes back as an error on that call. The server keeps answering.

## Development

```bash
npm install
npm run build
npm test
```

The tests spawn the built CLI and assert on its output, and the MCP tests speak
JSON-RPC to it over a pipe, so they cover the framing too. Nothing in them
touches your real cache or reaches Hatena: the fetching paths run against a
stub feed served from a second process.

To try a local build as the installed command:

```bash
npm link
hatebu --version
npm unlink -g @yuiseki/hatebucli
```

The decisions behind the shape of this thing are in [docs/ADR](docs/ADR),
including why search scans instead of keeping an index and why the MCP server
is the CLI rather than a second program.
