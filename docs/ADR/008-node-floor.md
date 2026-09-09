# ADR 008: Node 22.12 as the floor

## Status

Accepted.

## Context

Updating the dependencies for seven security advisories turned up a second
question. The ecosystem is moving to ESM-only packages: commander 15 ships
`"type": "module"` with no `require` condition, and this CLI compiles to
CommonJS.

`require()` of an ES module landed in Node 22.12. Below it, requiring
commander 15 fails with `ERR_REQUIRE_ESM`, which was measured rather than
assumed:

| | |
| --- | --- |
| Node 18.19.0 | ERR_REQUIRE_ESM |
| Node 22.3.0 | ERR_REQUIRE_ESM |
| Node 22.20.0 | works |
| Node 24.16.0 | works |

Node 20 reached end of life on 2026-04-30, and 22, 24 and 26 are the lines
still supported.

## Decision

`engines.node` is `>=22.12.0`, and CI tests 22, 24 and 26.

TypeScript 7 removed `moduleResolution: node10`, which is what let the old
build require an ESM package without complaint. `module` is now `nodenext`,
which models `require(esm)` the way Node 22.12 and later implement it: the
emit is still CommonJS, and importing an ESM-only dependency is no longer an
error the compiler has to be blind to.

## Turning away an unsupported Node

`engines` is a warning at install time and nothing at all at run time, so on an
older Node the first thing a user would have seen was an `ERR_REQUIRE_ESM`
stack trace from inside `node_modules`, which says nothing about what to do.

`bin/hatebu.js` is now the entry point in `package.json`. It is plain
CommonJS with no dependencies, so it runs on the versions it exists to turn
away, and it checks `process.versions.node` before requiring anything else.
The tests spawn it rather than `dist/index.js`, because it is what a user runs.

## Consequences

- Anyone on Node 20 or earlier gets a sentence naming the version they need.
  They were going to be broken either way; this is the difference between a
  broken tool and an inscrutable one.
- vitest 5 requires `^22.12 || ^24 || >=26`, which the floor now satisfies, but
  it is not worth taking yet: 4.1.11 carries the security fixes and nothing
  here needs 5.
- npm 10.9.3 cannot resolve this dependency set at all. `npm install`,
  `npm update` and `npm audit fix` all die in arborist with
  `Cannot read properties of null (reading 'edgesOut')`. npm 11 resolves it,
  and `npm ci` against the committed lockfile works under either.
