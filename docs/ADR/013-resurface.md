# ADR 013: Resurface, and the background's second version

## Status

Accepted. Extends [ADR 010](010-distinctive-words.md).

## Context

Every tool here answers a question about a subject already in mind: what was
2013 about, when did maplibre flare, what changed between two years. None of
them can answer "what did I care about and forget", because that question has
no subject to hand them.

## The score

Four things multiplied, from a shape proposed in conversation:

```
peak × fade × dormancy × support
```

- `peak` is the subject's rate in its best year, per thousand bookmarks of that
  year. How loud it ever got.
- `fade` is `1 - recent/peak`, clamped: 1 when it is silent now, 0 when it is
  as loud as ever.
- `dormancy` is years since that best year.
- `support` is `total / minimum`, clamped: whether there was ever enough of it.

Multiplying rather than adding is the whole design. A word that is merely old,
or merely quiet, or merely rare, scores nothing; only all four together is a
subject that mattered and was dropped.

The recent rate is taken over the recent years together rather than as an
average of their rates, so a thin year cannot swing it.

## What it needed

The background model held one number per word: how many bookmarks of the whole
archive carry it. That answers "is this word usual" and cannot answer "when was
it usual". Version 2 adds a breakdown by year: per year, the documents counted
and the same pruned word counts.

The file goes from 1.0MB to 3.8MB, and is built in the same pass. A model from
version 1 still answers the distinctive ranking; only the parts that need the
years ask for a rebuild, by name.

## What the first run showed

The top of the list was `jp`, `co`, `http`, `html`, `www`, `com`. Not subjects:
fragments of addresses, from bookmarks saved before the page had a title, whose
title is therefore the address. 3.3% of this archive is like that, and 12% of
2005, which was enough for hostname parts to lead the early years.

Two changes followed, and both improve every word ranking, not just this one:

- A title that is only a URL contributes no words.
- A dozen address and markup fragments joined the stop list.

## Dormancy always favours the oldest

Multiplying by years means a 2005 fade beats a 2020 one at equal strength, and
the default list is the 2005 web forever. That is faithful to the formula and
not always the question, so the peak year can be bounded:

```
$ hatebu resurface --peaked-after 2015
ニュース   2020  125.2 → 30.8   6y
android   2015   56.4 →  4.9  11y
コロナ     2020   77.8 →  0.9   6y
vr        2018   42.7 →  0.4   8y
techcrunch 2015  16.2 →  0.8  11y
ワクチン    2021   41.0 →  0.7   5y
```

## Consequences

- `resurface` is the only tool here that reads the background's years, and the
  only one that refuses to work until the model is rebuilt.
- Rebuilding is two minutes now rather than one: the same pass counts per year
  as well as in total.
- The scoring has four knobs and all four are exposed, because what counts as
  dormant or as enough support is a matter of taste rather than of fact.
