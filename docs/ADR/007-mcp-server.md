# ADR 007: Serve MCP from the CLI

## Status

Accepted. Ten tools, all read-only: `hatebu_search`, `hatebu_list`,
`hatebu_domains`, `hatebu_tags`, `hatebu_words`, `hatebu_stats`,
`hatebu_lookup`, `hatebu_timeline`, `hatebu_tagged`, `hatebu_random`.

## Context

The archive is 373,963 bookmarks over twenty-nine years, and the only way to
ask it anything is to type a command. The point of putting it behind MCP is to
let an assistant ask, and ask again, without the user translating each question
into flags.

## Decision

Serve MCP from this CLI, started with `hatebu --mcp-server` (also `--mcp`,
`mcp-server`, `mcp`), rather than shipping a second executable.

- Dispatched before commander parses. The server owns stdout for the whole
  process, which does not fit inside a command action that shares stdout with
  the usual human-readable output.
- The MCP SDK is required lazily, so every other command keeps its startup time.
- The username is resolved the same way as for every other command, and the
  server exits with a message on stderr when there is none, rather than
  starting and failing every call.

## The same answers as the CLI

Each tool calls the service function its command calls. A test asserts that
`hatebu_domains`, `hatebu_tags` and `hatebu_words` return exactly what
`hatebu domains --json` and the rest print. Copying a query into a second
caller is how two callers start disagreeing.

Argument names are snake_case, which is what tool arguments look like:
`url_or_domain`, `match_count`, `missing_dates`.

Validation stayed with each caller. Which options contradict each other is the
same question in both places, but the answers differ in kind: the CLI reports
and exits, and a server must not exit over one bad argument. The date parsers
grew non-exiting variants for that reason, and a test holds that the server is
still answering after three bad calls in a row.

## Two shapes of question

The commands that existed answered "what about this range of days". An archive
this old gets asked something else as well: have I read this, when did this
start, what did I file under that. `hatebu_lookup`, `hatebu_timeline`,
`hatebu_tagged` and `hatebu_random` answer that shape, and they scan the cache
rather than a range, which costs about half a second.

`hatebu_lookup` treats a subdomain as part of a site and ignores the scheme and
a trailing slash, because neither makes it a different page. A URL that was
never bookmarked still reports how much came from the same site, which is the
next thing anyone asks.

## Read-only by construction

Nothing writes. There is no `hatebu_sync` tool: syncing is a decision about
somebody else's server, and a server that cannot write cannot be talked into
writing. Every tool carries `readOnlyHint`, and a test asserts the tool list
contains nothing else.

The corollary is that the cache has to be filled by `hatebu sync` outside the
server, and that a day that was never synced must not read as a day with
nothing in it. Every ranking reports `missing_dates`, and `hatebu_list` says
whether the day was cached at all.

## Consequences

- `hatebu_search` drops the `matchedTitleTokens` and `matchedUrlTokens` that
  `--json` returns. Search matches a character at a time, so they are lists of
  single letters: they explain a score to someone reading the index and say
  nothing to a model.
- `hatebu_stats` returns the Markdown and the same numbers as JSON, as two
  content blocks. The Markdown is what a person wants pasted; the JSON is what
  a model should compute from.
- Tool descriptions carry what the data cannot say for itself: that a stretch
  from before the user started tagging has no tags rather than no subject, and
  that a negative answer from `hatebu_lookup` is meaningful when the archive is
  complete.
- The tests speak JSON-RPC to the built CLI over a pipe, so they cover the
  framing as well as the tools. CI additionally runs a handshake against a
  production install with hoisting turned off, because `--mcp-server` is the
  only path that loads the SDK.
