/**
 * Which words a stretch of reading was about, as opposed to which words it
 * contained.
 *
 * Ranking by frequency answers the second question, and for this archive the
 * answer is always the same: ai, github, the, https. What is worth knowing is
 * which words this window used more than the archive usually does, which is a
 * comparison against a background.
 *
 * The comparison is the log-odds ratio with an informative Dirichlet prior
 * (Monroe, Colaresi and Quinn, 2008). The prior is what keeps a word seen once
 * from outranking a word seen twenty times: rare words get pulled towards the
 * background rate until there is enough evidence to move them.
 */

export type Background = {
  /** How many bookmarks in the whole archive contain each word. */
  df: Map<string, number>;
  /** Bookmarks the background was built from. */
  documents: number;
  /** Sum of df over every word, including the ones pruned from the table. */
  wordInstances: number;
  /** Distinct words seen while building, including pruned ones. */
  vocabulary: number;
};

export type WindowWord = {
  word: string;
  /** Bookmarks in the window containing the word. */
  count: number;
  /** Sum of count over every word in the window. */
  wordInstances: number;
};

export type DistinctiveWord = {
  word: string;
  count: number;
  score: number;
  /** How many bookmarks in the whole archive contain it. */
  background: number;
};

/** How strongly the background pulls a word towards its usual rate. */
const PRIOR_STRENGTH = 100;

/**
 * A z-score: how far this window's rate for the word is from the background's,
 * in standard deviations. Zero means the window used it exactly as often as
 * usual, which is the answer for a word like `the`.
 */
export function distinctiveness(window: WindowWord, background: Background): number {
  const backgroundCount = background.df.get(window.word) ?? 0;

  // The prior for this word: its background rate, smoothed, scaled to
  // PRIOR_STRENGTH pseudo-observations.
  const prior =
    (PRIOR_STRENGTH * (backgroundCount + 0.5)) /
    (background.wordInstances + 0.5 * background.vocabulary);

  const inWindow = logOdds(window.count, window.wordInstances, prior);
  const inBackground = logOdds(backgroundCount, background.wordInstances, prior);
  const variance = 1 / (window.count + prior) + 1 / (backgroundCount + prior);

  return (inWindow - inBackground) / Math.sqrt(variance);
}

function logOdds(count: number, instances: number, prior: number): number {
  const withPrior = count + prior;
  const rest = instances + PRIOR_STRENGTH - count - prior;
  return Math.log(withPrior / rest);
}

/**
 * The words of a window, most distinctive first.
 *
 * A word used once is dropped: one mention is not evidence of what a stretch
 * was about, and the tail of any window is full of them.
 */
export function rankDistinctiveWords(
  counts: Map<string, number>,
  background: Background,
  limit: number,
): DistinctiveWord[] {
  let wordInstances = 0;
  for (const count of counts.values()) {
    wordInstances += count;
  }

  const scored: DistinctiveWord[] = [];
  for (const [word, count] of counts) {
    if (count < 2) continue;
    scored.push({
      word,
      count,
      score: distinctiveness({ word, count, wordInstances }, background),
      background: background.df.get(word) ?? 0,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.count !== a.count) return b.count - a.count;
    return a.word.localeCompare(b.word, 'ja');
  });

  return scored.slice(0, limit);
}
