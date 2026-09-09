# ADR 006: Module layout

## Status

Accepted.

## Context

`src/index.ts` had grown to 1,073 lines. It held the commander definitions for
nine commands, and underneath them the date handling, the cache walks, the
rankings and the printers. Four ranking builders each repeated the same walk
over a range of days, with the today-versus-cache decision inlined in all four.

The MCP server was the forcing function. A tool has to give the same answer as
its command, and the only way to be sure of that is for both to call the same
function. There was no such function to call.

## Decision

```
src/
  index.ts              the program, the register calls, the entry dispatch
  commands/             one module per command, each exporting
                        register<Name>Command(program)
  api.ts                the Hatena bookmark feed
  storage.ts            reading and writing the cache files
  config.ts             environment
  credentials.ts        the username
  dates.ts              local days, ranges, the stats window
  options.ts            option validation
  format.ts             reading the fields of a bookmark
  mcp.ts                the MCP server
  services/
    bookmarks.ts        where the bookmarks of a day come from
    analytics.ts        the rankings, the summaries, the stats markdown
    archive.ts          the cached days, as a whole
    queries.ts          lookup, timeline, tagged, random
    search.ts           full-text search
```

Dependencies run one way. A command module may use anything below it;
`services/` may use the modules above it; nothing below reaches back up into
`commands/`. Within `services/`, `analytics` uses `bookmarks`, and `queries`
and `search` use `archive`.

The register calls in `index.ts` run in the order `--help` should print them.

Two things are worth recording.

`forEachBookmarkInRange` takes a callback rather than returning an array. The
four ranking builders only ever want counts, and the archive runs to hundreds
of thousands of bookmarks; materialising it four times to count it would be the
one place this tool could run out of memory.

Every parser comes in two forms. `tryParseDateOption` reports a problem and
returns it; `parseDateOption` prints the message the CLI has always printed and
exits. The exiting form is right for a command and fatal for a server, and
having only one of them is how one of the two callers ends up wrong.

## Consequences

- `index.ts` is about 60 lines: the program metadata, the register calls, and
  the MCP branch that runs before parsing.
- The largest command module is `lookup.ts` at about 50 lines; `services/` holds
  the code that used to make `index.ts` long.
- `noUnusedLocals` and `noUnusedParameters` are on. The move left imports behind
  for functions that were no longer there, and that class of leftover should
  fail the build.
- The tests all spawn the built CLI and assert on its output, so none of them
  changed during the move. That is what made it safe to do at all.
