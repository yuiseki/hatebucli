/**
 * Full-text search over the cached archive.
 *
 * It scans. The earlier design kept a per-day inverted index under
 * `index/v1`, and measured against the archive it was a pessimization: the
 * index came to 381MB against 110MB of bookmarks, and a whole-archive search
 * took 4.9s through it against 0.5s for reading every bookmark and looking at
 * it. See docs/ADR/005-search-by-scanning.md.
 *
 * The matching is unchanged, so the same query returns the same rows in the
 * same order. Titles are mostly Japanese, so a query is matched a character at
 * a time: every character of the query has to appear, and a run of them
 * appearing together scores higher.
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
  matchedTitleTokens: string[];
  matchedUrlTokens: string[];
}

const SYMBOL_OR_PUNCT_CHAR = /[\p{P}\p{S}]/u;

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function shouldSkipChar(char: string): boolean {
  if (char.trim().length === 0) return true;
  return SYMBOL_OR_PUNCT_CHAR.test(char);
}

/** The characters of the query, deduplicated, minus whitespace and punctuation. */
function tokenizeUnigram(value: string): string[] {
  const tokens = new Set<string>();
  for (const char of normalizeText(value)) {
    if (shouldSkipChar(char)) continue;
    tokens.add(char);
  }
  return Array.from(tokens);
}

/** The same text with the skipped characters removed, for the run-of-characters boost. */
function normalizeForContains(value: string): string {
  let compact = '';
  for (const char of normalizeText(value)) {
    if (shouldSkipChar(char)) continue;
    compact += char;
  }
  return compact;
}

function matchedTokens(normalizedField: string, queryTokens: string[]): string[] {
  // A query token is a single non-skipped character, so membership in the
  // field's token set is the same question as the normalized text containing it.
  return queryTokens.filter((token) => normalizedField.includes(token));
}

export function searchBookmarks(query: string, options: SearchOptions = {}): SearchResult[] {
  if (normalizeText(query).trim().length === 0) return [];

  const field = options.field || 'all';
  const limit = options.limit && options.limit > 0 ? options.limit : 10;
  const queryTokens = tokenizeUnigram(query);
  if (queryTokens.length === 0) return [];

  const compactQuery = normalizeForContains(query);
  const wantsTitle = field === 'all' || field === 'title';
  const wantsUrl = field === 'all' || field === 'url';

  const results: SearchResult[] = [];

  const days = options.dateKey
    ? isDateKey(options.dateKey)
      ? [{ dateKey: options.dateKey, bookmarks: readCachedDay(options.dateKey) ?? [] }]
      : []
    : iterateCachedDays();

  for (const day of days) {
    for (const bookmark of day.bookmarks) {
      const title = bookmark.title || '';
      const link = bookmark.link || '';

      const normalizedTitle = normalizeText(title);
      const normalizedLink = normalizeText(link);

      const titleTokens = matchedTokens(normalizedTitle, queryTokens);
      const urlTokens = matchedTokens(normalizedLink, queryTokens);

      const matchesAll = field === 'title'
        ? titleTokens.length === queryTokens.length
        : field === 'url'
          ? urlTokens.length === queryTokens.length
          : new Set([...titleTokens, ...urlTokens]).size === queryTokens.length;
      if (!matchesAll) continue;

      let score = titleTokens.length * 2 + urlTokens.length;
      if (compactQuery.length > 0) {
        if (wantsTitle && normalizeForContains(title).includes(compactQuery)) {
          score += 4;
        }
        if (wantsUrl && normalizeForContains(link).includes(compactQuery)) {
          score += 2;
        }
      }

      results.push({
        dateKey: day.dateKey,
        title,
        link,
        date: bookmark.date || `${day.dateKey}T00:00:00Z`,
        description: bookmark.description || '',
        score,
        matchedTitleTokens: [...titleTokens].sort(),
        matchedUrlTokens: [...urlTokens].sort(),
      });
    }
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? 1 : -1;
    return a.title.localeCompare(b.title, 'ja');
  });

  return results.slice(0, limit);
}
