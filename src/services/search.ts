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
 * appear as a substring. Japanese needs no special case: it does not put
 * spaces between words, so a substring search for 地図 finds 地図帳 and 白地図
 * on its own. See docs/ADR/009-substring-matching.md for what this replaced
 * and why.
 */
import { isDateKey } from '../dates';
import { iterateCachedDays, readCachedDay } from './archive';

export type SearchField = 'all' | 'title' | 'url';

export interface SearchOptions {
  dateKey?: string;
  field?: SearchField;
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

export function searchBookmarks(query: string, options: SearchOptions = {}): SearchOutcome {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return { matchCount: 0, results: [] };

  const field = options.field || 'all';
  const limit = options.limit && options.limit > 0 ? options.limit : 10;
  const whole = normalizeText(query).trim();
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
      for (const term of queryTerms) {
        const inTitle = wantsTitle && normalizedTitle.includes(term);
        const inUrl = wantsUrl && normalizedLink.includes(term);
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
