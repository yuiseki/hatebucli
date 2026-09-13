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

const VERSION = 1;

/**
 * Words seen in only one bookmark are dropped. They are half the vocabulary and
 * a tenth of the file, and a word the table does not know is scored as unseen,
 * which is what a word seen once nearly is.
 */
const PRUNE_BELOW = 2;

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
};

export function backgroundPath(): string {
  return path.join(getCacheDir(), 'words', `df-v${VERSION}.json`);
}

export function loadBackground(): (Background & { builtAt: string; documents: number }) | null {
  const filePath = backgroundPath();
  if (!fs.existsSync(filePath)) return null;

  let parsed: BackgroundFile;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_error) {
    return null;
  }
  if (parsed?.version !== VERSION || typeof parsed.df !== 'object' || parsed.df === null) {
    return null;
  }

  return {
    df: new Map(Object.entries(parsed.df)),
    documents: parsed.documents,
    wordInstances: parsed.word_instances,
    vocabulary: parsed.vocabulary,
    builtAt: parsed.built_at,
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
  let documents = 0;
  let wordInstances = 0;
  let firstDay: string | undefined;
  let lastDay: string | undefined;

  for (const day of iterateCachedDays()) {
    // Days arrive newest first.
    lastDay = lastDay ?? day.dateKey;
    firstDay = day.dateKey;

    for (const bookmark of day.bookmarks) {
      const words = extractWordsFromJapaneseText(bookmark?.title);
      if (words.length === 0) continue;
      documents += 1;
      for (const word of new Set(words)) {
        counts.set(word, (counts.get(word) || 0) + 1);
        wordInstances += 1;
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
