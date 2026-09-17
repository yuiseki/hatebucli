/**
 * What changed between two stretches of reading.
 *
 * Not the same question as ranking either one. A word can be common in both
 * and say nothing about the difference; a word can be rare in both and be the
 * whole of it. So each side is scored against the other rather than against
 * the archive, using the same log-odds comparison the distinctive ranking uses
 * (see distinctive.ts and docs/ADR/010-distinctive-words.md).
 */
import { extractBookmarkTags, extractDomain } from '../format';
import { extractWordsFromJapaneseText } from '../words';
import { forEachBookmarkInRange } from './bookmarks';
import { distinctiveness, type Background } from './distinctive';
import type { ParsedDateOption } from '../dates';

export type CompareDimension = 'words' | 'domains' | 'tags';

export type Side = {
  range: ParsedDateOption;
  bookmarkCount: number;
  counts: Map<string, number>;
  instances: number;
  missingDates: string[];
};

export type Shift = {
  word: string;
  /** How many bookmarks of each side carry it. */
  a: number;
  b: number;
  /** Per thousand of each side's word instances, so the sides are comparable. */
  aPer1000: number;
  bPer1000: number;
  score: number;
};

/** Counts one side of the comparison, in whichever dimension is being compared. */
export async function countSide(
  range: ParsedDateOption,
  dimension: CompareDimension,
): Promise<Side> {
  const counts = new Map<string, number>();
  let bookmarkCount = 0;
  let instances = 0;

  const missingDates = await forEachBookmarkInRange(range, (bookmark) => {
    bookmarkCount += 1;
    for (const value of valuesOf(bookmark, dimension)) {
      counts.set(value, (counts.get(value) || 0) + 1);
      instances += 1;
    }
  });

  return { range, bookmarkCount, counts, instances, missingDates };
}

function valuesOf(bookmark: any, dimension: CompareDimension): string[] {
  if (dimension === 'domains') {
    const domain = extractDomain(bookmark?.link);
    return domain ? [domain] : [];
  }
  if (dimension === 'tags') {
    return extractBookmarkTags(bookmark);
  }
  // A word counts once per bookmark, however often the title repeats it.
  return Array.from(new Set(extractWordsFromJapaneseText(bookmark?.title)));
}

/** One side seen as the background the other is compared against. */
function asBackground(side: Side, otherVocabulary: Set<string>): Background {
  const vocabulary = new Set([...side.counts.keys(), ...otherVocabulary]);
  return {
    df: side.counts,
    documents: side.bookmarkCount,
    wordInstances: side.instances,
    vocabulary: vocabulary.size,
  };
}

export type Comparison = {
  risen: Shift[];
  fallen: Shift[];
};

/**
 * The words each side used more than the other, most striking first.
 *
 * A word seen once on the side it is rising on is dropped: one mention is not
 * a change, and the tail of any window is full of them.
 */
export function compareSides(a: Side, b: Side, limit: number): Comparison {
  if (a.bookmarkCount === 0 || b.bookmarkCount === 0) {
    return { risen: [], fallen: [] };
  }

  const vocabulary = new Set([...a.counts.keys(), ...b.counts.keys()]);
  const backgroundOfA = asBackground(a, vocabulary);
  const backgroundOfB = asBackground(b, vocabulary);

  const risen: Shift[] = [];
  const fallen: Shift[] = [];

  for (const word of vocabulary) {
    const inA = a.counts.get(word) ?? 0;
    const inB = b.counts.get(word) ?? 0;

    const shift: Shift = {
      word,
      a: inA,
      b: inB,
      aPer1000: rate(inA, a.instances),
      bPer1000: rate(inB, b.instances),
      score: 0,
    };

    if (inB >= 2) {
      const score = distinctiveness(
        { word, count: inB, wordInstances: b.instances },
        backgroundOfA,
      );
      if (score > 0) risen.push({ ...shift, score });
    }
    if (inA >= 2) {
      const score = distinctiveness(
        { word, count: inA, wordInstances: a.instances },
        backgroundOfB,
      );
      if (score > 0) fallen.push({ ...shift, score });
    }
  }

  const strongestFirst = (left: Shift, right: Shift) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.word.localeCompare(right.word, 'ja');
  };

  return {
    risen: risen.sort(strongestFirst).slice(0, limit),
    fallen: fallen.sort(strongestFirst).slice(0, limit),
  };
}

function rate(count: number, instances: number): number {
  if (instances === 0) return 0;
  return Math.round((count / instances) * 10_000) / 10;
}
