# @yuiseki/hatebucli

Hatena Bookmark CLI for AI Secretary.

## Install

```bash
npm i -g @yuiseki/hatebucli
```

## Usage

```bash
hatebu --help
```

### Asking about the whole archive

```bash
hatebu lookup https://example.com/article   # have I bookmarked this page?
hatebu lookup example.com                   # what have I read from this site?
hatebu timeline --query maplibre --bars     # when was I reading about this?
hatebu tagged 地図                           # what did I file under this tag?
hatebu random -n 5                          # dig something out of the archive
```

These read every cached day rather than an index, which over a twenty-nine
year archive takes about half a second.

## MCP server

`hatebu --mcp-server` runs the CLI as a Model Context Protocol server over
stdio, so an MCP client can read your bookmarks. `--mcp`, `mcp-server` and
`mcp` start the same thing.

```bash
hatebu --mcp-server
```

It needs a username before it starts, from `hatebu config set username` or
from `HATENA_USER` in the client's environment. stdout carries only JSON-RPC;
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
before pointing a client at it. The cache is what makes the whole archive
searchable offline.

### Tools

- `hatebu_search`: full-text search over every cached day. Arguments: `query`
  (required, up to 200 characters), `field` (`all`, `title` or `url`), `date`
  to restrict to one day, and `limit` (default 10, max 100).
- `hatebu_list`: the bookmarks of one day. Argument: `date` (defaults to
  today). Says whether the day was in the cache, so a day that was never
  synced is not mistaken for a day with nothing in it.
- `hatebu_domains`: the sites bookmarked over a range, most bookmarked first.
  Arguments: `date`, `today`, `limit`.
- `hatebu_tags`: the tags used over a range. Same arguments.
- `hatebu_words`: the words in the titles of a range, tokenized with a
  Japanese morphological analyser. Same arguments, `limit` defaults to 30.
- `hatebu_stats`: a window as one summary, in Markdown and as JSON. Arguments:
  `date` (the day the window ends on), `days` (default 7) and `top`.
- `hatebu_lookup`: whether a page or a site is in the archive, and when.
  Argument: `url_or_domain`. A full URL asks about one page; a bare hostname
  asks about a site and covers its subdomains. A URL that is not there reports
  how much else came from the same site.
- `hatebu_timeline`: bookmarks counted per `year` or per `month`, optionally
  filtered by `tag`, `domain`, `query` and a `from`/`to` range. This is the
  tool for when an interest started and whether it is still going.
- `hatebu_tagged`: the bookmarks under one tag, newest first.
- `hatebu_random`: a handful drawn at random, with the same filters.

All of them are read-only, and they answer the same numbers as the matching
command, down to the defaults. Each ranking reports `missing_dates`, the days
of the range the cache does not hold, so a low count can be told apart from a
gap in the sync.

`hatebu_search` drops the `matchedTitleTokens` and `matchedUrlTokens` that the
CLI's `--json` returns: the index is per character, so they are lists of single
letters.
