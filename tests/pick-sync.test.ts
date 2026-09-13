/**
 * `pick` syncs before it reads.
 *
 * A tag added on the entry page is invisible until that day is fetched again,
 * which is the one way this workflow silently shows the wrong answer: the week
 * looks half-finished because the cache predates the tagging, not because the
 * days were not chosen.
 *
 * It syncs only when the answer would otherwise be "not decided yet", which is
 * exactly when a stale day misleads. A round the cache already shows as decided
 * is not worth a request.
 */
import { test, expect, afterEach } from 'vitest';
import {
  createTempWorkspace,
  runCli,
  startStubRssServer,
  writeDailyCache,
  type StubRssServer,
} from './helpers';

let stub: StubRssServer | undefined;

afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

function feedEnv(): { HATENA_BOOKMARK_RSS_URL: string } {
  return { HATENA_BOOKMARK_RSS_URL: stub!.urlTemplate };
}

test('an undecided day is fetched again before it is called undecided', async () => {
  const ws = createTempWorkspace();
  stub = await startStubRssServer();
  // The cache has the day without the tag; Hatena has it with the tag.
  writeDailyCache(ws.cacheBase, '2026-09-05', [
    { title: '選ばれた記事', link: 'https://example.com/a', date: '2026-09-05T09:00:00+09:00' },
  ]);
  stub.setBookmarks('20260905', [
    {
      title: '選ばれた記事',
      link: 'https://example.com/a',
      date: '2026-09-05T09:00:00+09:00',
      tags: ['daily_best'],
    },
  ]);

  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-05'], {
    env: feedEnv(),
  });

  expect(result.status).toBe(0);
  expect(stub.requestedDates()).toEqual(['20260905']);
  expect(result.stdout).toContain('already has its daily_best');
});

test('a day the cache already shows as decided costs no request', async () => {
  const ws = createTempWorkspace();
  stub = await startStubRssServer();
  writeDailyCache(ws.cacheBase, '2026-09-05', [
    {
      title: '選ばれた記事',
      link: 'https://example.com/a',
      date: '2026-09-05T09:00:00+09:00',
      tags: ['daily_best'],
    },
  ]);

  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-05'], {
    env: feedEnv(),
  });

  expect(result.status).toBe(0);
  expect(stub.requestedDates()).toEqual([]);
});

test('--no-sync reads the cache as it stands', async () => {
  const ws = createTempWorkspace();
  stub = await startStubRssServer();
  writeDailyCache(ws.cacheBase, '2026-09-05', [
    { title: '選ばれた記事', link: 'https://example.com/a', date: '2026-09-05T09:00:00+09:00' },
  ]);

  const result = runCli(
    ws.cacheBase,
    ws.homeDir,
    ['pick', '--date', '2026-09-05', '--no-sync'],
    { env: feedEnv() },
  );

  expect(result.status).toBe(0);
  expect(stub.requestedDates()).toEqual([]);
  expect(result.stdout).toContain('Choose the daily_best');
});

test('an undecided week fetches every day of it', async () => {
  const ws = createTempWorkspace();
  stub = await startStubRssServer();

  // A week wholly in the past, so the expectation does not depend on today.
  const result = runCli(
    ws.cacheBase,
    ws.homeDir,
    ['pick', '--weekly', '--date', '2026-09-05'],
    { env: feedEnv() },
  );

  expect(result.status).toBe(0);
  // Monday the 31st to Sunday the 6th.
  expect(stub.requestedDates()).toEqual([
    '20260831',
    '20260901',
    '20260902',
    '20260903',
    '20260904',
    '20260905',
    '20260906',
  ]);
});

test('today is not fetched, because today is still being bookmarked into', async () => {
  const ws = createTempWorkspace();
  stub = await startStubRssServer();

  const today = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', todayKey], {
    env: feedEnv(),
  });

  expect(result.status).toBe(0);
  expect(stub.requestedDates()).toEqual([]);
});

test('without a username it reads the cache and says why', async () => {
  const ws = createTempWorkspace();
  writeDailyCache(ws.cacheBase, '2026-09-05', [
    { title: '選ばれた記事', link: 'https://example.com/a', date: '2026-09-05T09:00:00+09:00' },
  ]);

  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-05'], {
    user: null,
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Choose the daily_best');
  expect(result.stderr).toMatch(/username/i);
});

test('a failed fetch leaves the cached day alone', async () => {
  const ws = createTempWorkspace();
  writeDailyCache(ws.cacheBase, '2026-09-05', [
    { title: '大事な記事', link: 'https://example.com/a', date: '2026-09-05T09:00:00+09:00' },
  ]);

  // A feed that is not there. The day must survive: an empty answer from a
  // broken fetch is not the same as a day with nothing in it.
  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-05'], {
    env: { HATENA_BOOKMARK_RSS_URL: 'http://127.0.0.1:9/%s/bookmark.rss' },
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('大事な記事');
  expect(result.stderr).toMatch(/could not be fetched|failed/i);
});

test('sync refuses to cache a day it could not fetch', async () => {
  const ws = createTempWorkspace();
  writeDailyCache(ws.cacheBase, '2026-09-05', [
    { title: '大事な記事', link: 'https://example.com/a', date: '2026-09-05T09:00:00+09:00' },
  ]);

  const result = runCli(ws.cacheBase, ws.homeDir, ['sync', '--date', '2026-09-05'], {
    env: { HATENA_BOOKMARK_RSS_URL: 'http://127.0.0.1:9/%s/bookmark.rss' },
  });

  expect(result.status).toBe(1);
  expect(result.stdout).not.toMatch(/Saved 0 bookmarks/);

  const kept = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['list', '--date', '2026-09-05', '--json']).stdout,
  );
  expect(kept).toHaveLength(1);
});
