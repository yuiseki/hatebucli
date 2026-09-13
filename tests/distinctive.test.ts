/**
 * The scoring behind `words --by distinctive`.
 *
 * Raw frequency answers "what words appear", which for any window of this
 * archive is "ai", "github", "the". The question worth answering is "what was
 * this stretch about that the rest of the archive was not", which is a
 * comparison against a background.
 */
import { test, expect } from 'vitest';
import { distinctiveness, rankDistinctiveWords } from '../dist/services/distinctive.js';

const background = {
  // A word in a tenth of everything, a word in a thousandth.
  df: new Map([
    ['github', 37000],
    ['qwen', 370],
  ]),
  documents: 374000,
  wordInstances: 2500000,
  vocabulary: 140000,
};

test('a word is distinctive when the window uses it more than the background does', () => {
  // Both appear 20 times in a window of 800 bookmarks. github is everywhere in
  // the archive, qwen is not, so qwen is what the window is about.
  const common = distinctiveness({ count: 20, wordInstances: 5000, word: 'github' }, background);
  const rare = distinctiveness({ count: 20, wordInstances: 5000, word: 'qwen' }, background);

  expect(rare).toBeGreaterThan(common);
});

test('a word the window uses no more than usual scores near nothing', () => {
  // Rates are per word instance, not per bookmark: github is 37000 of the
  // background's 2.5M instances, so 1.48% of a 5000-instance window is 74.
  const asUsual = distinctiveness(
    { count: 74, wordInstances: 5000, word: 'github' },
    background,
  );
  expect(Math.abs(asUsual)).toBeLessThan(2);

  // Half its usual rate is a word the window was quieter about than normal.
  const quieter = distinctiveness({ count: 37, wordInstances: 5000, word: 'github' }, background);
  expect(quieter).toBeLessThan(asUsual);
});

test('a word the background has never seen is still scored, not dropped', () => {
  const unseen = distinctiveness({ count: 10, wordInstances: 5000, word: 'maplibre' }, background);
  expect(Number.isFinite(unseen)).toBe(true);
  expect(unseen).toBeGreaterThan(0);
});

test('one mention is not evidence', () => {
  // A word used once in a window of thousands says nothing, however rare it is
  // elsewhere. It must not outrank a word used twenty times.
  const once = distinctiveness({ count: 1, wordInstances: 5000, word: 'maplibre' }, background);
  const often = distinctiveness({ count: 20, wordInstances: 5000, word: 'qwen' }, background);
  expect(often).toBeGreaterThan(once);
});

test('ranking puts the distinctive words first and keeps the counts', () => {
  const withThe = {
    ...background,
    df: new Map([...background.df, ['the', 200000]]),
  };
  // A window of 1000 word instances in which `the` and `github` appear at
  // exactly their usual rates, and qwen at a hundred times its own.
  const ranked = rankDistinctiveWords(
    new Map([
      ['the', 80],
      ['github', 15],
      ['qwen', 15],
      ['読む', 890],
    ]),
    withThe,
    10,
  );

  const scores = new Map(ranked.map((row) => [row.word, row.score]));
  expect(scores.get('qwen')).toBeGreaterThan(scores.get('github')!);
  expect(scores.get('qwen')).toBeGreaterThan(scores.get('the')!);
  // A word used at its usual rate is not news, whatever its raw count.
  expect(Math.abs(scores.get('the')!)).toBeLessThan(Math.abs(scores.get('qwen')!));

  const qwen = ranked.find((row) => row.word === 'qwen')!;
  expect(qwen.count).toBe(15);
  expect(qwen.background).toBe(370);
});
