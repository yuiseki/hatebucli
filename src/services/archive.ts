/**
 * The whole cached archive, day by day.
 *
 * Reading every cached day and looking at every bookmark costs about half a
 * second over twenty-nine years, which is cheap enough that the questions
 * spanning the whole archive can just scan it. The alternative would be a
 * second index per question.
 */
import fs from 'fs';
import path from 'path';
import { isDateKey } from '../dates';
import { getCacheDir } from '../storage';
import type { Bookmark } from './bookmarks';

const YEAR_PATTERN = /^\d{4}$/;
const MONTH_PATTERN = /^\d{2}$/;
const DAY_FILE_PATTERN = /^\d{2}\.json$/;

/** Newest day first, which is the order every caller wants to report in. */
export function listCachedDateKeys(): string[] {
  const cacheDir = getCacheDir();
  if (!fs.existsSync(cacheDir)) return [];

  const dateKeys: string[] = [];
  const years = fs.readdirSync(cacheDir).filter(name => YEAR_PATTERN.test(name));

  for (const year of years) {
    const yearPath = path.join(cacheDir, year);
    if (!fs.statSync(yearPath).isDirectory()) continue;

    const months = fs.readdirSync(yearPath).filter(name => MONTH_PATTERN.test(name));
    for (const month of months) {
      const monthPath = path.join(yearPath, month);
      if (!fs.statSync(monthPath).isDirectory()) continue;

      const dayFiles = fs.readdirSync(monthPath).filter(name => DAY_FILE_PATTERN.test(name));
      for (const dayFile of dayFiles) {
        const dateKey = `${year}-${month}-${dayFile.replace('.json', '')}`;
        if (isDateKey(dateKey)) {
          dateKeys.push(dateKey);
        }
      }
    }
  }

  dateKeys.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return dateKeys;
}

export function readCachedDay(dateKey: string): Bookmark[] | null {
  const [year, month, day] = dateKey.split('-');
  const filePath = path.join(getCacheDir(), year, month, `${day}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    // A half-written day should not take a whole-archive question down.
    return null;
  }
}

export type ArchiveWindow = {
  /** Inclusive yyyy-mm-dd bounds. Omit either end for open. */
  from?: string;
  to?: string;
};

export type CachedDay = { dateKey: string; bookmarks: Bookmark[] };

/** Every cached day within the window, newest first. */
export function* iterateCachedDays(window: ArchiveWindow = {}): Generator<CachedDay> {
  for (const dateKey of listCachedDateKeys()) {
    if (window.from && dateKey < window.from) continue;
    if (window.to && dateKey > window.to) continue;
    const bookmarks = readCachedDay(dateKey);
    if (!bookmarks) continue;
    yield { dateKey, bookmarks };
  }
}

export function countCachedDays(window: ArchiveWindow = {}): number {
  let days = 0;
  for (const dateKey of listCachedDateKeys()) {
    if (window.from && dateKey < window.from) continue;
    if (window.to && dateKey > window.to) continue;
    days += 1;
  }
  return days;
}
