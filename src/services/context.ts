/**
 * What was bookmarked around a moment, grouped into sittings.
 *
 * Bookmarking happens in sittings. A page on its own says what was read; the
 * half hour around it says what it was read alongside, which is usually the
 * answer to why it was read at all.
 */
import { formatDateYmd, isDateKey } from '../dates';
import { extractDomain, hatenaEntryUrl, parseBookmarkTimestamp } from '../format';
import { iterateCachedDays, readCachedDay } from './archive';
import type { ArchiveEntry } from './queries';

export type Moment = { at: Date; target?: ArchiveEntry };

export type Neighbour = ArchiveEntry & { at: Date; target: boolean };

export class ContextProblem extends Error {}

/**
 * The moment to look around: the time a bookmark was made, or a time given
 * directly. A URL names a bookmark and marks it in the output; a time names
 * only a moment.
 */
export function resolveMoment(input: string): Moment {
  const trimmed = input.trim();

  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?$/.test(trimmed)) {
    const [dayPart, timePart] = trimmed.split(/[T ]/);
    if (!isDateKey(dayPart)) {
      throw new ContextProblem(`'${trimmed}' is not a day this can read.`);
    }
    const [year, month, day] = dayPart.split('-').map(Number);
    const [hour, minute] = (timePart ?? '12:00').split(':').map(Number);
    return { at: new Date(year, month - 1, day, hour, minute) };
  }

  const found = findBookmark(trimmed);
  if (!found) {
    throw new ContextProblem(
      `${trimmed} is not bookmarked in the local cache. Sync the day it was ` +
        'bookmarked, or give a time as 2026-04-10T21:15.',
    );
  }
  const at = parseBookmarkTimestamp(found.date);
  if (!at) {
    throw new ContextProblem('that bookmark carries no timestamp, so it has no surroundings.');
  }
  return { at, target: found };
}

function normalizeLink(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
}

/**
 * Finds a bookmark by URL. Searching the whole archive would cost a scan; a
 * bookmark's own day is almost always the answer, and the scan is the fallback.
 */
function findBookmark(link: string): ArchiveEntry | undefined {
  const wanted = normalizeLink(link);
  for (const day of iterateCachedDays()) {
    for (const bookmark of day.bookmarks) {
      if (normalizeLink(bookmark.link) === wanted) {
        return { ...bookmark, dateKey: day.dateKey };
      }
    }
  }
  return undefined;
}

/** Everything bookmarked within `minutes` either side, oldest first. */
export function around(moment: Moment, minutes: number): Neighbour[] {
  const span = minutes * 60_000;
  const from = new Date(moment.at.getTime() - span);
  const to = new Date(moment.at.getTime() + span);

  const neighbours: Neighbour[] = [];
  // A window can straddle midnight, so the days either side are read too.
  for (let offset = -1; offset <= 1; offset += 1) {
    const day = new Date(
      moment.at.getFullYear(),
      moment.at.getMonth(),
      moment.at.getDate() + offset,
    );
    const dateKey = formatDateYmd(day);
    for (const bookmark of readCachedDay(dateKey) ?? []) {
      const at = parseBookmarkTimestamp(bookmark.date);
      if (!at || at < from || at > to) continue;
      neighbours.push({
        ...bookmark,
        dateKey,
        at,
        target:
          moment.target !== undefined &&
          normalizeLink(bookmark.link) === normalizeLink(moment.target.link),
      });
    }
  }

  return neighbours.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Consecutive bookmarks with less than `gap` minutes of quiet between them. */
export function intoSessions(neighbours: Neighbour[], gap: number): Neighbour[][] {
  const sessions: Neighbour[][] = [];
  const quiet = gap * 60_000;

  for (const neighbour of neighbours) {
    const current = sessions[sessions.length - 1];
    const previous = current?.[current.length - 1];
    if (previous && neighbour.at.getTime() - previous.at.getTime() <= quiet) {
      current.push(neighbour);
    } else {
      sessions.push([neighbour]);
    }
  }

  return sessions;
}

/** The whole answer, as the shape both the command and the tool report. */
export function bookmarksAround(input: string, minutes: number, gap: number) {
  const moment = resolveMoment(input);
  const sessions = intoSessions(around(moment, minutes), gap);

  return {
    at: moment.at.toISOString(),
    minutes,
    gap,
    ...(moment.target
      ? {
          target: {
            title: moment.target.title,
            link: moment.target.link,
            date: moment.target.dateKey,
          },
        }
      : {}),
    session_count: sessions.length,
    sessions: sessions.map((session) => ({
      from: session[0].at.toISOString(),
      to: session[session.length - 1].at.toISOString(),
      bookmark_count: session.length,
      bookmarks: session.map((entry) => ({
        title: entry.title,
        link: entry.link,
        domain: extractDomain(entry.link),
        at: entry.at.toISOString(),
        entry_url: hatenaEntryUrl(entry.link),
        ...(entry.target ? { target: true } : {}),
      })),
    })),
  };
}
