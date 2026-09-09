/**
 * The paths that talk to Hatena: `sync`, and every command that covers today.
 * They run against a stub RSS server rather than b.hatena.ne.jp, so no account
 * and no network are involved.
 */
import { test, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import {
  createTempWorkspace,
  dailyCachePath,
  readDailyCache,
  runCli,
  startStubRssServer,
  writeDailyCache,
  ymdFromDate,
  yyyymmdd,
  type StubRssServer,
} from './helpers';

let stub: StubRssServer | undefined;

afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

function daysAgo(count: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - count);
}

test('sync --date writes the fetched day to the cache', async () => {
  const ws = createTempWorkspace();
  stub = await startStubRssServer();
  stub.setBookmarks('20260218', [
    {
      title: '同期したブックマーク',
      link: 'https://example.com/synced',
      date: '2026-02-18T09:00:00+09:00',
      tags: ['alpha', 'beta'],
    },
  ]);

  const result = runCli(ws.cacheBase, ws.homeDir, ['sync', '--date', '2026-02-18'], {
    env: { HATENA_BOOKMARK_RSS_URL: stub.urlTemplate },
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Saved 1 bookmarks.');
  expect(stub.requestedDates()).toEqual(['20260218']);

  const cached = readDailyCache(ws.cacheBase, '2026-02-18');
  expect(cached).toHaveLength(1);
  expect(cached[0].title).toBe('同期したブックマーク');
  expect(cached[0].link).toBe('https://example.com/synced');
  expect(cached[0].tags).toEqual(['alpha', 'beta']);
});

test('sync --days walks back from yesterday and never asks for today', async () => {
  const ws = createTempWorkspace();
  stub = await startStubRssServer();

  const result = runCli(ws.cacheBase, ws.homeDir, ['sync', '--days', '3'], {
    env: { HATENA_BOOKMARK_RSS_URL: stub.urlTemplate },
  });

  expect(result.status).toBe(0);
  expect(stub.requestedDates()).toEqual([
    yyyymmdd(daysAgo(1)),
    yyyymmdd(daysAgo(2)),
    yyyymmdd(daysAgo(3)),
  ]);
  expect(stub.requestedDates()).not.toContain(yyyymmdd(new Date()));

  for (const count of [1, 2, 3]) {
    expect(fs.existsSync(dailyCachePath(ws.cacheBase, ymdFromDate(daysAgo(count))))).toBe(true);
  }
});

test('list reads today from the API and an older day from the cache', async () => {
  const ws = createTempWorkspace();
  stub = await startStubRssServer();
  const todayLabel = ymdFromDate(new Date());
  stub.setBookmarks(yyyymmdd(new Date()), [
    {
      title: 'Fresh from the feed',
      link: 'https://today.example/fresh',
      date: `${todayLabel}T08:00:00+09:00`,
    },
  ]);
  writeDailyCache(ws.cacheBase, '2026-02-18', [
    {
      title: 'From the cache',
      link: 'https://example.com/cached',
      date: '2026-02-18T09:00:00+09:00',
    },
  ]);

  const today = runCli(ws.cacheBase, ws.homeDir, ['list', '--json'], {
    env: { HATENA_BOOKMARK_RSS_URL: stub.urlTemplate },
  });
  expect(today.status).toBe(0);
  expect(JSON.parse(today.stdout)).toHaveLength(1);
  expect(today.stdout).toContain('Fresh from the feed');
  expect(stub.requestedDates()).toEqual([yyyymmdd(new Date())]);

  const older = runCli(ws.cacheBase, ws.homeDir, ['ls', '--date', '2026-02-18'], {
    env: { HATENA_BOOKMARK_RSS_URL: stub.urlTemplate },
  });
  expect(older.status).toBe(0);
  expect(older.stdout).toContain('From the cache');
  // Still one request: an older day must not reach the feed.
  expect(stub.requestedDates()).toEqual([yyyymmdd(new Date())]);
});

test('domains --today counts what the feed returns for today', async () => {
  const ws = createTempWorkspace();
  stub = await startStubRssServer();
  const todayLabel = ymdFromDate(new Date());
  stub.setBookmarks(yyyymmdd(new Date()), [
    {
      title: 'One',
      link: 'https://news.example.net/a',
      date: `${todayLabel}T08:00:00+09:00`,
    },
    {
      title: 'Two',
      link: 'https://news.example.net/b',
      date: `${todayLabel}T09:00:00+09:00`,
    },
  ]);

  const result = runCli(ws.cacheBase, ws.homeDir, ['domains', '--today', '--json'], {
    env: { HATENA_BOOKMARK_RSS_URL: stub.urlTemplate },
  });

  expect(result.status).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.date).toBe(todayLabel);
  expect(parsed.bookmark_count).toBe(2);
  expect(parsed.ranking).toEqual([{ domain: 'news.example.net', count: 2 }]);
  expect(parsed.missing_dates).toEqual([]);
});

test('a command that needs the account says so when no username is set', () => {
  const ws = createTempWorkspace();
  const result = runCli(ws.cacheBase, ws.homeDir, ['list'], { user: null });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Hatena Username is not set.');
  expect(result.stderr).toContain('hatebu config set username');
});

test('config set username is picked up by a later command', async () => {
  const ws = createTempWorkspace();
  stub = await startStubRssServer();

  const set = runCli(ws.cacheBase, ws.homeDir, ['config', 'set', 'username', 'stored-user'], {
    user: null,
  });
  expect(set.status).toBe(0);

  const get = runCli(ws.cacheBase, ws.homeDir, ['config', 'get', 'username'], { user: null });
  expect(get.status).toBe(0);
  expect(get.stdout.trim()).toBe('stored-user');

  const list = runCli(ws.cacheBase, ws.homeDir, ['list', '--json'], {
    user: null,
    env: { HATENA_BOOKMARK_RSS_URL: stub.urlTemplate },
  });
  expect(list.status).toBe(0);
  expect(JSON.parse(list.stdout)).toEqual([]);
});
