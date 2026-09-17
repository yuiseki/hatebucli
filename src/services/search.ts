/**
 * Full-text search over the cached archive.
 *
 * It scans. The earlier design kept a per-day inverted index under
 * `index/v1`, and measured against the archive it was a pessimization: the
 * index came to 381MB against 110MB of bookmarks, and a whole-archive search
 * took 4.9s through it against 0.5s for reading every bookmark and looking at
 * it. See docs/ADR/005-search-by-scanning.md.
 *
 * A query is one or more terms separated by whitespace, and every term has to
 * appear. A term of plain letters and digits has to appear as a word: `ai`
 * means AI, not mai, aichi or maplibre. Anything else is matched as written,
 * which is what Japanese wants, since it does not put spaces between words and
 * 地図 should find 地図帳. See docs/ADR/009-substring-matching.md and
 * docs/ADR/012-word-terms.md.
 */
import { isDateKey } from '../dates';
import { iterateCachedDays, readCachedDay } from './archive';

export type SearchField = 'all' | 'title' | 'url';

/** How a term of plain letters and digits is matched. */
export type SearchMatch = 'word' | 'substring';

export interface SearchOptions {
  dateKey?: string;
  field?: SearchField;
  match?: SearchMatch;
  limit?: number;
}

export interface SearchResult {
  dateKey: string;
  title: string;
  link: string;
  date: string;
  description: string;
  score: number;
  /** Which fields the query was found in. */
  matchedIn: Array<'title' | 'url'>;
}

export interface SearchOutcome {
  /** Everything that matched, before the limit was applied. */
  matchCount: number;
  /** The best `limit` of them. */
  results: SearchResult[];
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

/** The terms of a query: whitespace-separated, normalized, all required. */
function terms(query: string): string[] {
  return normalizeText(query)
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

/** Plain letters and digits, which is what has words to be a whole one of. */
const PLAIN_TERM = /^[a-z0-9]+$/;

const LETTER_OR_DIGIT = /[a-z0-9]/;

/**
 * Whether the term appears in the text as a word.
 *
 * A word ends where the next character is not a letter or a digit, so `_` and
 * `-` both separate: `spec` is a word of `tile_spec` and of `maplibre-tile-spec`.
 * Japanese counts as a boundary too, which is what lets `ai` match 生成AIの現在
 * while missing aichi.
 */
function containsWord(haystack: string, term: string): boolean {
  let index = haystack.indexOf(term);
  while (index !== -1) {
    const before = index === 0 ? '' : haystack[index - 1];
    const after = haystack[index + term.length] ?? '';
    if (!LETTER_OR_DIGIT.test(before) && !LETTER_OR_DIGIT.test(after)) return true;
    index = haystack.indexOf(term, index + 1);
  }
  return false;
}

export function searchBookmarks(query: string, options: SearchOptions = {}): SearchOutcome {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return { matchCount: 0, results: [] };

  const field = options.field || 'all';
  const match = options.match || 'word';
  const limit = options.limit && options.limit > 0 ? options.limit : 10;
  const whole = normalizeText(query).trim();

  // A term with punctuation or Japanese in it has no word boundaries to hold
  // it to, so it is matched as written whatever the mode says.
  const matchers = queryTerms.map((term) =>
    match === 'word' && PLAIN_TERM.test(term)
      ? (text: string) => containsWord(text, term)
      : (text: string) => text.includes(term),
  );
  const wantsTitle = field === 'all' || field === 'title';
  const wantsUrl = field === 'all' || field === 'url';

  const results: SearchResult[] = [];
  let matchCount = 0;

  const days = options.dateKey
    ? isDateKey(options.dateKey)
      ? [{ dateKey: options.dateKey, bookmarks: readCachedDay(options.dateKey) ?? [] }]
      : []
    : iterateCachedDays();

  for (const day of days) {
    for (const bookmark of day.bookmarks) {
      const title = bookmark.title || '';
      const link = bookmark.link || '';
      const normalizedTitle = wantsTitle ? normalizeText(title) : '';
      const normalizedLink = wantsUrl ? normalizeText(link) : '';

      let titleTerms = 0;
      let urlTerms = 0;
      let matchesEveryTerm = true;
      for (const matches of matchers) {
        const inTitle = wantsTitle && matches(normalizedTitle);
        const inUrl = wantsUrl && matches(normalizedLink);
        if (!inTitle && !inUrl) {
          matchesEveryTerm = false;
          break;
        }
        if (inTitle) titleTerms += 1;
        if (inUrl) urlTerms += 1;
      }
      if (!matchesEveryTerm) continue;

      matchCount += 1;

      // A term in the title counts for more than one in the URL, and the whole
      // query appearing as written counts for more than its terms scattered.
      let score = titleTerms * 2 + urlTerms;
      if (queryTerms.length > 1) {
        if (wantsTitle && normalizedTitle.includes(whole)) score += 4;
        if (wantsUrl && normalizedLink.includes(whole)) score += 2;
      }

      results.push({
        dateKey: day.dateKey,
        title,
        link,
        date: bookmark.date || `${day.dateKey}T00:00:00Z`,
        description: bookmark.description || '',
        score,
        matchedIn: [
          ...(titleTerms > 0 ? ['title' as const] : []),
          ...(urlTerms > 0 ? ['url' as const] : []),
        ],
      });
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? 1 : -1;
    return a.title.localeCompare(b.title, 'ja');
  });

  return { matchCount, results: results.slice(0, limit) };
}
