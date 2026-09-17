/**
 * What the archive cared about and has stopped mentioning.
 *
 * Every other tool here answers a question about a subject you already have in
 * mind. This one has no subject: it reads the whole vocabulary year by year and
 * looks for the shape of something that burned and went out.
 *
 * The score multiplies four things, so a word has to have all of them:
 *
 *   peak       how prominent it was at its height, per thousand of that year
 *   fade       how gone it is now, 0 when it is as loud as ever, 1 when silent
 *   dormancy   years since that height
 *   support    whether there was ever enough of it to mean anything
 *
 * Multiplying rather than adding is the point: a word that is merely old, or
 * merely quiet, or merely rare, scores nothing. All four together is a subject
 * that mattered and was dropped.
 */
import type { LoadedBackground, YearlyBackground } from './background';

export type Resurfaced = {
  word: string;
  score: number;
  /** Bookmarks carrying it, over the whole archive. */
  total: number;
  peak_year: string;
  peak_per_1000: number;
  recent_per_1000: number;
  fade: number;
  dormant_years: number;
  support: number;
};

export type ResurfaceOptions = {
  /** Bookmarks a word needs before it counts as having been a subject. */
  minTotal?: number;
  /** How many of the most recent years count as "now". */
  recentYears?: number;
  /** Only subjects whose height was in or after this year. */
  peakedAfter?: string;
  /** Only subjects whose height was in or before this year. */
  peakedBefore?: string;
  limit?: number;
};

const DEFAULTS = { minTotal: 20, recentYears: 2, limit: 20 };

export function resurface(
  background: LoadedBackground,
  options: ResurfaceOptions = {},
): Resurfaced[] {
  if (!background.years) {
    throw new Error(
      'This background model has no breakdown by year. Rebuild it with ' +
        '`hatebu words --rebuild-background`.',
    );
  }

  const minTotal = options.minTotal ?? DEFAULTS.minTotal;
  const recentCount = options.recentYears ?? DEFAULTS.recentYears;
  const limit = options.limit ?? DEFAULTS.limit;

  const years = [...background.years.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  if (years.length === 0) return [];

  const recentYears = years.slice(-recentCount);
  const latestYear = Number(years[years.length - 1][0]);

  const found: Resurfaced[] = [];

  for (const [word, total] of background.df) {
    if (total < minTotal) continue;

    let peakRate = 0;
    let peakYear = '';
    for (const [year, counts] of years) {
      const rate = rateOf(word, counts);
      if (rate > peakRate) {
        peakRate = rate;
        peakYear = year;
      }
    }
    if (peakRate === 0) continue;

    // The recent rate is over the recent years together, not their average of
    // rates, so a year with few bookmarks cannot swing it.
    let recentCountOfWord = 0;
    let recentDocuments = 0;
    for (const [, counts] of recentYears) {
      recentCountOfWord += counts.df.get(word) ?? 0;
      recentDocuments += counts.documents;
    }
    const recentRate = recentDocuments === 0 ? 0 : (recentCountOfWord / recentDocuments) * 1000;

    const fade = clamp(1 - recentRate / peakRate, 0, 1);
    const dormantYears = Math.max(0, latestYear - Number(peakYear));
    const support = clamp(total / minTotal, 0, 1);

    // Dormancy is a multiplier, so the oldest fades always lead. Bounding the
    // peak year is how a question about a recent one gets asked.
    if (options.peakedAfter && peakYear < options.peakedAfter) continue;
    if (options.peakedBefore && peakYear > options.peakedBefore) continue;

    const score = peakRate * fade * dormantYears * support;
    if (score <= 0) continue;

    found.push({
      word,
      score: round(score),
      total,
      peak_year: peakYear,
      peak_per_1000: round(peakRate),
      recent_per_1000: round(recentRate),
      fade: round(fade),
      dormant_years: dormantYears,
      support: round(support),
    });
  }

  return found
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.word.localeCompare(b.word, 'ja');
    })
    .slice(0, limit);
}

function rateOf(word: string, counts: YearlyBackground): number {
  if (counts.documents === 0) return 0;
  return ((counts.df.get(word) ?? 0) / counts.documents) * 1000;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
