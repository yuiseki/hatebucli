/**
 * The whole-archive questions: lookup, timeline, tagged and random. They scan
 * the cache rather than an index, so these hold the matching rules.
 */
import { test, expect } from 'vitest';
import { createTempWorkspace, runCli, writeDailyCache, type Workspace } from './helpers';

function seedArchive(ws: Workspace): void {
  writeDailyCache(ws.cacheBase, '2019-07-04', [
    { title: '昔の地図', link: 'https://maps.example.com/old', date: '2019-07-04T09:00:00+09:00' },
  ]);
  writeDailyCache(ws.cacheBase, '2022-03-10', [
    { title: '地図の話', link: 'https://example.com/maps', date: '2022-03-10T09:00:00+09:00' },
    { title: '別の話', link: 'https://other.test/a', date: '2022-03-10T10:00:00+09:00' },
  ]);
  writeDailyCache(ws.cacheBase, '2026-02-18', [
    {
      title: '地図と生成AI',
      link: 'https://example.com/maps',
      date: '2026-02-18T09:00:00+09:00',
      tags: ['地図', 'AI'],
    },
  ]);
}

test('lookup on a URL says whether that page was bookmarked, and how often', () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const found = runCli(ws.cacheBase, ws.homeDir, [
    'lookup', 'https://example.com/maps', '--json',
  ]);
  expect(found.status).toBe(0);
  const payload = JSON.parse(found.stdout);
  expect(payload.kind).toBe('url');
  expect(payload.bookmarked).toBe(true);
  expect(payload.match_count).toBe(2);
  expect(payload.first_bookmarked).toBe('2022-03-10');
  expect(payload.last_bookmarked).toBe('2026-02-18');

  // The scheme and a trailing slash are not a different page.
  const samePage = runCli(ws.cacheBase, ws.homeDir, [
    'lookup', 'http://example.com/maps/', '--json',
  ]);
  expect(JSON.parse(samePage.stdout).match_count).toBe(2);
});

test('lookup on a URL that is not there points at the rest of the site', () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, [
    'lookup', 'https://example.com/never-read', '--json',
  ]);
  expect(result.status).toBe(0);
  const payload = JSON.parse(result.stdout);
  expect(payload.bookmarked).toBe(false);
  expect(payload.match_count).toBe(0);
  // Two on example.com plus the one on maps.example.com: a subdomain is the site.
  expect(payload.same_domain_count).toBe(3);
});

test('lookup on a hostname covers its subdomains', () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['lookup', 'example.com', '--json']);
  expect(result.status).toBe(0);
  const payload = JSON.parse(result.stdout);
  expect(payload.kind).toBe('domain');
  // maps.example.com counts as example.com; other.test does not.
  expect(payload.match_count).toBe(3);
  expect(payload.first_bookmarked).toBe('2019-07-04');
});

test('timeline counts per year and per month, oldest first', () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const byYear = runCli(ws.cacheBase, ws.homeDir, ['timeline', '--json']);
  expect(byYear.status).toBe(0);
  expect(JSON.parse(byYear.stdout).rows).toEqual([
    { period: '2019', count: 1 },
    { period: '2022', count: 2 },
    { period: '2026', count: 1 },
  ]);

  const byMonth = runCli(ws.cacheBase, ws.homeDir, ['timeline', '--by', 'month', '--json']);
  expect(JSON.parse(byMonth.stdout).rows[0]).toEqual({ period: '2019-07', count: 1 });
});

test('timeline filters by query, tag, domain and date bounds', () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const byQuery = runCli(ws.cacheBase, ws.homeDir, ['timeline', '--query', '地図', '--json']);
  expect(JSON.parse(byQuery.stdout).total).toBe(3);

  const byTag = runCli(ws.cacheBase, ws.homeDir, ['timeline', '--tag', 'AI', '--json']);
  expect(JSON.parse(byTag.stdout).total).toBe(1);

  const byDomain = runCli(ws.cacheBase, ws.homeDir, ['timeline', '--domain', 'other.test', '--json']);
  expect(JSON.parse(byDomain.stdout).total).toBe(1);

  const bounded = runCli(ws.cacheBase, ws.homeDir, [
    'timeline', '--from', '2020-01-01', '--to', '2025-12-31', '--json',
  ]);
  expect(JSON.parse(bounded.stdout).rows).toEqual([{ period: '2022', count: 2 }]);
});

test('timeline rejects bounds and buckets it cannot use', () => {
  const ws = createTempWorkspace();

  const bound = runCli(ws.cacheBase, ws.homeDir, ['timeline', '--from', '2026-2-1']);
  expect(bound.status).toBe(1);
  expect(bound.stderr).toMatch(/--from must be a valid yyyy-mm-dd/);

  const bucket = runCli(ws.cacheBase, ws.homeDir, ['timeline', '--by', 'week']);
  expect(bucket.status).toBe(1);
  expect(bucket.stderr).toMatch(/--by must be "year" or "month"/);
});

test('tagged lists what is under a tag, case-insensitively', () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['tagged', 'ai', '--json']);
  expect(result.status).toBe(0);
  const payload = JSON.parse(result.stdout);
  expect(payload.match_count).toBe(1);
  expect(payload.bookmarks[0].dateKey).toBe('2026-02-18');

  const missing = runCli(ws.cacheBase, ws.homeDir, ['tagged', 'nothing', '--json']);
  expect(JSON.parse(missing.stdout).match_count).toBe(0);
});

test('random draws from the matches and never more than there are', () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['random', '-n', '10', '--json']);
  expect(result.status).toBe(0);
  const payload = JSON.parse(result.stdout);
  expect(payload.match_count).toBe(4);
  expect(payload.bookmarks).toHaveLength(4);

  const filtered = runCli(ws.cacheBase, ws.homeDir, [
    'random', '-n', '10', '--domain', 'other.test', '--json',
  ]);
  expect(JSON.parse(filtered.stdout).match_count).toBe(1);
});
