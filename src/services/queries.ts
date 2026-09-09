/**
 * The questions that are about the archive as a whole rather than about a
 * range of days: have I bookmarked this, what have I read from this site, how
 * did this subject come and go over the years, what did I file under this tag.
 *
 * All of them scan the cache. Reading every cached day costs about half a
 * second over twenty-nine years, and a second index per question would cost
 * more than that to keep honest.
 */
import { extractBookmarkTags, extractDomain, normalizeTagText } from '../format';
import { iterateCachedDays, type ArchiveWindow } from './archive';
import type { Bookmark } from './bookmarks';

export type ArchiveEntry = Bookmark & { dateKey: string };

export type ArchiveFilter = ArchiveWindow & {
  /** Matched against the tags of a bookmark, case-insensitively. */
  tag?: string;
  /** Matched against the hostname of the link, www- and case-insensitively. */
  domain?: string;
  /** Matched as a substring of the title or the link. */
  query?: string;
};

function normalizeForContains(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFKC').toLowerCase() : '';
}

/**
 * A domain matches itself and its subdomains: `hatena.ne.jp` covers
 * `b.hatena.ne.jp`, which is what someone naming a site means.
 */
function domainMatches(bookmarkDomain: string | undefined, wanted: string): boolean {
  if (!bookmarkDomain) return false;
  return bookmarkDomain === wanted || bookmarkDomain.endsWith(`.${wanted}`);
}

function buildMatcher(filter: ArchiveFilter): (bookmark: Bookmark) => boolean {
  const wantedTag = filter.tag ? normalizeTagText(filter.tag)?.toLowerCase() : undefined;
  const wantedDomain = filter.domain ? extractDomain(filter.domain) : undefined;
  const wantedQuery = filter.query ? normalizeForContains(filter.query) : undefined;

  return (bookmark: Bookmark) => {
    if (wantedTag) {
      const tags = extractBookmarkTags(bookmark).map((tag) => tag.toLowerCase());
      if (!tags.includes(wantedTag)) return false;
    }
    if (wantedDomain && !domainMatches(extractDomain(bookmark?.link), wantedDomain)) {
      return false;
    }
    if (wantedQuery) {
      const haystack = `${normalizeForContains(bookmark?.title)} ${normalizeForContains(bookmark?.link)}`;
      if (!haystack.includes(wantedQuery)) return false;
    }
    return true;
  };
}

export type FindResult = {
  matchCount: number;
  scannedBookmarks: number;
  scannedDays: number;
  /** Newest first, capped at the limit. */
  entries: ArchiveEntry[];
  first?: ArchiveEntry;
  last?: ArchiveEntry;
};

export function findBookmarks(filter: ArchiveFilter, limit: number): FindResult {
  const matcher = buildMatcher(filter);
  const entries: ArchiveEntry[] = [];
  let matchCount = 0;
  let scannedBookmarks = 0;
  let scannedDays = 0;
  let first: ArchiveEntry | undefined;
  let last: ArchiveEntry | undefined;

  for (const day of iterateCachedDays(filter)) {
    scannedDays += 1;
    for (const bookmark of day.bookmarks) {
      scannedBookmarks += 1;
      if (!matcher(bookmark)) continue;

      const entry: ArchiveEntry = { ...bookmark, dateKey: day.dateKey };
      matchCount += 1;
      // The days arrive newest first, so the last match seen is the oldest.
      if (!last) last = entry;
      first = entry;
      if (entries.length < limit) {
        entries.push(entry);
      }
    }
  }

  return { matchCount, scannedBookmarks, scannedDays, entries, first, last };
}

export type TimelineRow = { period: string; count: number };

export function buildTimeline(
  filter: ArchiveFilter,
  by: 'year' | 'month',
): { rows: TimelineRow[]; total: number; scannedBookmarks: number } {
  const matcher = buildMatcher(filter);
  const counts = new Map<string, number>();
  let total = 0;
  let scannedBookmarks = 0;

  for (const day of iterateCachedDays(filter)) {
    const period = by === 'year' ? day.dateKey.slice(0, 4) : day.dateKey.slice(0, 7);
    for (const bookmark of day.bookmarks) {
      scannedBookmarks += 1;
      if (!matcher(bookmark)) continue;
      total += 1;
      counts.set(period, (counts.get(period) || 0) + 1);
    }
  }

  // Oldest first: a timeline reads forwards.
  const rows = Array.from(counts.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([period, count]) => ({ period, count }));

  return { rows, total, scannedBookmarks };
}

export type LookupResult = {
  input: string;
  /** A full URL was given, so an exact link match is what was asked about. */
  kind: 'url' | 'domain';
  domain?: string;
  bookmarked: boolean;
  matchCount: number;
  entries: ArchiveEntry[];
  first?: ArchiveEntry;
  last?: ArchiveEntry;
  /** For a URL that was never bookmarked: what else came from that site. */
  sameDomainCount?: number;
};

function normalizeLink(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) return '';
  // A trailing slash and the scheme are not what anyone means by a different page.
  return text
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/**
 * Have I bookmarked this? A full URL asks about one page; a bare hostname asks
 * about a site. A URL that was never bookmarked still reports how much else
 * came from the same site, because that is the next thing anyone asks.
 */
export function lookup(input: string, limit: number): LookupResult {
  const trimmed = input.trim();
  const looksLikeUrl = /^https?:\/\//i.test(trimmed) || trimmed.includes('/');
  const domain = extractDomain(trimmed);

  if (!looksLikeUrl) {
    const found = findBookmarks({ domain: trimmed }, limit);
    return {
      input: trimmed,
      kind: 'domain',
      domain,
      bookmarked: found.matchCount > 0,
      matchCount: found.matchCount,
      entries: found.entries,
      first: found.first,
      last: found.last,
    };
  }

  const wanted = normalizeLink(trimmed);
  const entries: ArchiveEntry[] = [];
  let matchCount = 0;
  let sameDomainCount = 0;
  let first: ArchiveEntry | undefined;
  let last: ArchiveEntry | undefined;

  for (const day of iterateCachedDays()) {
    for (const bookmark of day.bookmarks) {
      const bookmarkDomain = extractDomain(bookmark?.link);
      if (domain && domainMatches(bookmarkDomain, domain)) {
        sameDomainCount += 1;
      }
      if (normalizeLink(bookmark?.link) !== wanted) continue;

      const entry: ArchiveEntry = { ...bookmark, dateKey: day.dateKey };
      matchCount += 1;
      if (!last) last = entry;
      first = entry;
      if (entries.length < limit) {
        entries.push(entry);
      }
    }
  }

  return {
    input: trimmed,
    kind: 'url',
    domain,
    bookmarked: matchCount > 0,
    matchCount,
    entries,
    first,
    last,
    sameDomainCount,
  };
}

/**
 * A handful of bookmarks at random, for digging something out of the archive
 * that nothing would have thought to ask for.
 */
export function randomBookmarks(filter: ArchiveFilter, count: number): {
  entries: ArchiveEntry[];
  matchCount: number;
} {
  const matcher = buildMatcher(filter);
  const reservoir: ArchiveEntry[] = [];
  let matchCount = 0;

  for (const day of iterateCachedDays(filter)) {
    for (const bookmark of day.bookmarks) {
      if (!matcher(bookmark)) continue;
      matchCount += 1;
      const entry: ArchiveEntry = { ...bookmark, dateKey: day.dateKey };
      // Reservoir sampling: one pass, no array of every match.
      if (reservoir.length < count) {
        reservoir.push(entry);
      } else {
        const slot = Math.floor(Math.random() * matchCount);
        if (slot < count) reservoir[slot] = entry;
      }
    }
  }

  return { entries: reservoir, matchCount };
}
