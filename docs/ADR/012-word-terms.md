# ADR 012: A plain term is a word

## Status

Accepted. Refines [ADR 009](009-substring-matching.md).

## Context

ADR 009 replaced per-character matching with substring terms, which fixed the
case it was measured on: `GeoAI` went from 46,953 matches to 30. It did not
look at short alphabetic terms, and that is where substring matching has the
same shape of fault.

`ai` matched 44,678 bookmarks, twelve percent of the archive. Among them:
`flybrain`, `maplibre-tile-spec`, `Jimmy Lai`, `Kanagai Yukiko`, `因果推論`,
`fly_ocr`. The letters a and i next to each other, wherever they fall.

A tokenizer was the obvious suggestion, and it does not fit:

- Tokenizing every title with lindera takes 68 seconds over the archive, which
  is why the distinctive-word background is a file built by hand
  ([ADR 010](010-distinctive-words.md)). A search cannot pay that.
- Filtering first and tokenizing the survivors does not help where it hurts:
  `ai` has 44,678 survivors, about eleven seconds of tokenizing.
- For Japanese it would be a regression. Token matching makes 地図 stop finding
  地図帳, which is the behaviour ADR 009 chose deliberately.

## Decision

A term of plain letters and digits has to appear as a whole word. Any other
term is matched as written.

A word ends where the next character is not a letter or a digit. Underscore and
hyphen separate, so `spec` is a word of both `tile_spec` and
`maplibre-tile-spec`. Japanese is a boundary too, which is what lets `ai` match
生成AIの現在 while missing aichi.

The rule keys on the term, not the text, and that distinction is the whole
reason it works. A first attempt applied word boundaries to every term and cut
地図 from 1,004 matches to 939, because the character before 地 in `KDDI地図`
is a letter. Japanese terms have no word boundaries to be held to, so they are
not held to any.

`--match substring` asks for the old behaviour, and the MCP tool takes the same
argument.

## What it costs

Measured over the archive:

| term | word | substring |
| --- | --- | --- |
| `ai` | 6,637 | 44,678 |
| `go` | 4,043 | 26,331 |
| `map` | 709 | 3,326 |
| `llm` | 887 | 1,217 |
| `地図` | 1,004 | 1,004 |
| `arxiv.org` | 497 | 497 |

The first two rows are the point. The third and fourth are the price: `map` no
longer finds `maplibre`, and `llm` no longer finds `LiteLLM`. Compound
identifiers are real, and a term inside one is now a deliberate ask rather than
the default.

That trade was taken because the default has to be right for the common case,
and the common case is a person typing two letters and meaning them. The last
two rows are what the rule protects: Japanese and anything with punctuation
behave exactly as they did.

## Consequences

- `--match substring` is the escape hatch, and the tool description tells a
  model when to reach for it.
- A term of one letter is now nearly useless in word mode, which is correct: it
  was nearly useless before too, and noisier.
- Nothing is indexed and nothing is tokenized, so search still costs one scan.
