/**
 * Where the bookmarks of a day come from.
 *
 * Today is still changing, so it is fetched from the feed; every earlier day
 * is read from the cache, and a day the cache does not hold is reported rather
 * than silently counted as empty. A range that does not include today needs no
 * account and no network.
 */
import { fetchBookmarksByDate } from '../api';
import { loadCache } from '../storage';
import { ensureHatenaUser } from '../credentials';
import { formatDateYmd, getDateListInRange, isToday, type ParsedDateOption } from '../dates';

export type Bookmark = {
  title?: string;
  link?: string;
  date?: string;
  description?: string;
  tags?: string[];
  categories?: string[];
};

/**
 * Walks a range a day at a time, handing each bookmark to `visit`, and returns
 * the days that were not in the cache. A callback rather than an array because
 * the archive runs to hundreds of thousands of bookmarks and the callers only
 * ever want counts.
 */
export async function forEachBookmarkInRange(
  range: ParsedDateOption,
  visit: (bookmark: Bookmark, date: Date) => void,
): Promise<string[]> {
  const missingDates: string[] = [];
  let user: string | null = null;

  for (const date of getDateListInRange(range.start, range.end)) {
    let bookmarks: Bookmark[] | null;
    if (isToday(date)) {
      if (!user) {
        user = await ensureHatenaUser();
      }
      bookmarks = await fetchBookmarksByDate(user, date);
    } else {
      bookmarks = loadCache(date);
      if (!bookmarks) {
        missingDates.push(formatDateYmd(date));
        continue;
      }
    }

    for (const bookmark of bookmarks) {
      visit(bookmark, date);
    }
  }

  return missingDates;
}

/** One day, from wherever that day lives. Null means the cache does not hold it. */
export async function loadDay(date: Date): Promise<Bookmark[] | null> {
  if (isToday(date)) {
    const user = await ensureHatenaUser();
    return fetchBookmarksByDate(user, date);
  }
  return loadCache(date);
}
