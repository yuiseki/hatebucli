/**
 * The edges of a date range.
 *
 * Two faults lived here. The default week was eight days and said seven, and a
 * range that ran past today reported the days that have not happened yet as
 * days missing from the cache. Missing and future are not the same thing: one
 * asks to be synced, the other cannot be.
 */
import { test, expect } from 'vitest';
import { createTempWorkspace, runCli, writeDailyCache } from './helpers';

const pad = (value: number) => String(value).padStart(2, '0');
const key = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function daysAgo(count: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - count);
}

function dayCount(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 + 1;
}

test('the default week is seven days, ending yesterday', () => {
  const ws = createTempWorkspace();
  // A bookmark on each of the last ten days, so the range is what decides.
  for (let back = 0; back <= 10; back += 1) {
    const dateKey = key(daysAgo(back));
    writeDailyCache(ws.cacheBase, dateKey, [
      { title: `${dateKey} の記事`, link: `https://example.com/${back}`, date: `${dateKey}T09:00:00+09:00` },
    ]);
  }

  const parsed = JSON.parse(runCli(ws.cacheBase, ws.homeDir, ['domains', '--json']).stdout);
  const [from, to] = parsed.date.split('..');

  expect(dayCount(from, to)).toBe(7);
  expect(to).toBe(key(daysAgo(1)));
  expect(from).toBe(key(daysAgo(7)));
  expect(parsed.bookmark_count).toBe(7);
});

test('stats counts the days it says it counts', () => {
  const ws = createTempWorkspace();
  for (let back = 0; back <= 10; back += 1) {
    const dateKey = key(daysAgo(back));
    writeDailyCache(ws.cacheBase, dateKey, [
      { title: `${dateKey} の記事`, link: `https://example.com/${back}`, date: `${dateKey}T09:00:00+09:00` },
    ]);
  }

  const stats = runCli(ws.cacheBase, ws.homeDir, ['stats']).stdout;
  const window = stats.match(/Window: (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2}) \((\d+) days\)/);
  expect(window).not.toBeNull();
  const [, from, to, claimed] = window!;
  expect(dayCount(from, to)).toBe(Number(claimed));
  expect(Number(claimed)).toBe(7);
  expect(stats).toMatch(/Total bookmarks: 7/);
});

test('a range never runs past today', () => {
  const ws = createTempWorkspace();
  const today = new Date();
  const thisYear = String(today.getFullYear());
  writeDailyCache(ws.cacheBase, key(daysAgo(1)), [
    { title: '昨日の記事', link: 'https://example.com/a', date: `${key(daysAgo(1))}T09:00:00+09:00` },
  ]);

  const parsed = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['domains', '--date', thisYear, '--json']).stdout,
  );

  // Days that have not happened are not days the cache is missing.
  const future = parsed.missing_dates.filter((day: string) => day > key(today));
  expect(future).toEqual([]);
  expect(parsed.missing_dates).not.toContain(key(today));
});

test('a month still running stops at today', () => {
  const ws = createTempWorkspace();
  const today = new Date();
  const thisMonth = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
  writeDailyCache(ws.cacheBase, key(daysAgo(1)), [
    { title: '昨日の記事', link: 'https://example.com/a', date: `${key(daysAgo(1))}T09:00:00+09:00` },
  ]);

  const parsed = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['tags', '--date', thisMonth, '--json']).stdout,
  );
  const future = parsed.missing_dates.filter((day: string) => day > key(today));
  expect(future).toEqual([]);
});

test('a range wholly in the future has nothing in it and nothing missing', () => {
  const ws = createTempWorkspace();
  const nextYear = String(new Date().getFullYear() + 1);

  const parsed = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['domains', '--date', nextYear, '--json']).stdout,
  );
  expect(parsed.bookmark_count).toBe(0);
  expect(parsed.missing_dates).toEqual([]);
});
