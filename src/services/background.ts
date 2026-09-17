/**
 * The background the distinctive-word scoring compares a window against: how
 * often each word appears across the whole archive.
 *
 * It is a file rather than a computation, because tokenizing 374,000 titles
 * takes about seventy seconds and the answer barely moves from one day to the
 * next. A window is tokenized live, which costs a fifth of a second for a
 * month; only the background is worth keeping.
 *
 * Reading never creates anything, so this works under a read-only home. Only
 * the build writes, and only the CLI builds.
 */
import fs from 'fs';
import path from 'path';
import { getCacheDir } from '../storage';
import { extractWordsFromJapaneseText } from '../words';
import { iterateCachedDays } from './archive';
import type { Background } from './distinctive';

const VERSION = 2;

/** Versions this can read. v1 has the totals but no breakdown by year. */
const READABLE = [1, 2];

/**
 * Words seen in only one bookmark are dropped. They are half the vocabulary and
 * a tenth of the file, and a word the table does not know is scored as unseen,
 * which is what a word seen once nearly is.
 */
const PRUNE_BELOW = 2;

export type YearCounts = {
  /** Bookmarks of that year that had any words at all. */
  documents: number;
  /** Sum of df over the year, before pruning. */
  word_instances: number;
  df: Record<string, number>;
};

export type BackgroundFile = {
  version: number;
  built_at: string;
  documents: number;
  word_instances: number;
  vocabulary: number;
  pruned_below: number;
  first_day?: string;
  last_day?: string;
  df: Record<string, number>;
  /** Version 2 and later. Absent from a model built by an older version. */
  years?: Record<string, YearCounts>;
};

export type YearlyBackground = {
  documents: number;
  wordInstances: number;
  df: Map<string, number>;
};

export type LoadedBackground = Background & {
  builtAt: string;
  documents: number;
  /** Absent when the model on disk predates the breakdown by year. */
  years?: Map<string, YearlyBackground>;
};

export function backgroundPath(version: number = VERSION): string {
  return path.join(getCacheDir(), 'words', `df-v${version}.json`);
}

/**
 * The newest model on disk this version can read. A model built by an older
 * version still answers the distinctive ranking; only the parts that need the
 * breakdown by year have to ask for a rebuild.
 */
export function loadBackground(): LoadedBackground | null {
  for (const version of [...READABLE].sort((a, b) => b - a)) {
    const loaded = loadVersion(version);
    if (loaded) return loaded;
  }
  return null;
}

function loadVersion(version: number): LoadedBackground | null {
  const filePath = backgroundPath(version);
  if (!fs.existsSync(filePath)) return null;

  let parsed: BackgroundFile;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_error) {
    return null;
  }
  if (parsed?.version !== version || typeof parsed.df !== 'object' || parsed.df === null) {
    return null;
  }

  const years = parsed.years
    ? new Map(
        Object.entries(parsed.years).map(([year, counts]) => [
          year,
          {
            documents: counts.documents,
            wordInstances: counts.word_instances,
            df: new Map(Object.entries(counts.df)),
          },
        ]),
      )
    : undefined;

  return {
    df: new Map(Object.entries(parsed.df)),
    documents: parsed.documents,
    wordInstances: parsed.word_instances,
    vocabulary: parsed.vocabulary,
    builtAt: parsed.built_at,
    ...(years ? { years } : {}),
  };
}

export type BuildResult = {
  path: string;
  documents: number;
  vocabulary: number;
  kept: number;
  wordInstances: number;
  firstDay?: string;
  lastDay?: string;
  seconds: number;
};

/**
 * Walks every cached day and counts, for each word, the bookmarks whose title
 * contains it. A word counts once per bookmark however often the title repeats
 * it, which is the same rule the ranking uses.
 */
export function buildBackground(onProgress?: (documents: number) => void): BuildResult {
  const startedAt = Date.now();
  const counts = new Map<string, number>();
  const byYear = new Map<string, { documents: number; instances: number; counts: Map<string, number> }>();
  let documents = 0;
  let wordInstances = 0;
  let firstDay: string | undefined;
  let lastDay: string | undefined;

  for (const day of iterateCachedDays()) {
    // Days arrive newest first.
    lastDay = lastDay ?? day.dateKey;
    firstDay = day.dateKey;

    const year = day.dateKey.slice(0, 4);
    let yearly = byYear.get(year);
    if (!yearly) {
      yearly = { documents: 0, instances: 0, counts: new Map() };
      byYear.set(year, yearly);
    }

    for (const bookmark of day.bookmarks) {
      const words = extractWordsFromJapaneseText(bookmark?.title);
      if (words.length === 0) continue;
      documents += 1;
      yearly.documents += 1;
      for (const word of new Set(words)) {
        counts.set(word, (counts.get(word) || 0) + 1);
        yearly.counts.set(word, (yearly.counts.get(word) || 0) + 1);
        wordInstances += 1;
        yearly.instances += 1;
      }
    }
    if (onProgress) onProgress(documents);
  }

  const df: Record<string, number> = {};
  let kept = 0;
  for (const [word, count] of counts) {
    if (count < PRUNE_BELOW) continue;
    df[word] = count;
    kept += 1;
  }

  const years: Record<string, YearCounts> = {};
  for (const [year, yearly] of [...byYear.entries()].sort()) {
    if (yearly.documents === 0) continue;
    const yearDf: Record<string, number> = {};
    for (const [word, count] of yearly.counts) {
      // Same floor as the totals: a word seen once in a year says nothing
      // about that year and is half the size of the file.
      if (count < PRUNE_BELOW) continue;
      yearDf[word] = count;
    }
    years[year] = {
      documents: yearly.documents,
      word_instances: yearly.instances,
      df: yearDf,
    };
  }

  const file: BackgroundFile = {
    version: VERSION,
    built_at: new Date().toISOString(),
    documents,
    // Both totals are from before pruning, so the scoring's rates stay right.
    word_instances: wordInstances,
    vocabulary: counts.size,
    pruned_below: PRUNE_BELOW,
    ...(firstDay ? { first_day: firstDay } : {}),
    ...(lastDay ? { last_day: lastDay } : {}),
    df,
    years,
  };

  const filePath = backgroundPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(file), 'utf-8');

  return {
    path: filePath,
    documents,
    vocabulary: counts.size,
    kept,
    wordInstances,
    firstDay,
    lastDay,
    seconds: (Date.now() - startedAt) / 1000,
  };
}
