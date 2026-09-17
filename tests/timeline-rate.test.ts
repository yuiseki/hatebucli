/**
 * A timeline of raw counts invites a wrong reading. Bookmarking itself rises
 * and falls: in this archive 2026 holds two thirds of what 2025 did, and is
 * not over. A subject can take a larger share of the reading while its raw
 * count drops.
 */
import { test, expect } from 'vitest';
import { createTempWorkspace, runCli, writeDailyCache, type Workspace } from './helpers';

function seed(ws: Workspace): void {
  // 2025: 20 bookmarks, 2 of them about maps. 2026: 5 bookmarks, 1 about maps.
  // The raw count halves; the share doubles.
  writeDailyCache(
    ws.cacheBase,
    '2025-06-02',
    Array.from({ length: 20 }, (_item, index) => ({
      title: index < 2 ? `地図の記事 ${index}` : `別の記事 ${index}`,
      link: `https://example.com/2025-${index}`,
      date: '2025-06-02T09:00:00+09:00',
    })),
  );
  writeDailyCache(
    ws.cacheBase,
    '2026-06-02',
    Array.from({ length: 5 }, (_item, index) => ({
      title: index < 1 ? `地図の記事 ${index}` : `別の記事 ${index}`,
      link: `https://example.com/2026-${index}`,
      date: '2026-06-02T09:00:00+09:00',
    })),
  );
}

test('a timeline reports the share as well as the count', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const parsed = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['timeline', '--query', '地図', '--json']).stdout,
  );

  expect(parsed.rows).toEqual([
    { period: '2025', count: 2, total: 20, per_1000: 100 },
    { period: '2026', count: 1, total: 5, per_1000: 200 },
  ]);
  // The count fell and the share rose. Both are true and only one is the answer
  // to "was I reading more about this".
  expect(parsed.rows[1].count).toBeLessThan(parsed.rows[0].count);
  expect(parsed.rows[1].per_1000).toBeGreaterThan(parsed.rows[0].per_1000);
});

test('the text output shows both, and the bars follow the share', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['timeline', '--query', '地図', '--bars']);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/2025\s+2\s+100/);
  expect(result.stdout).toMatch(/2026\s+1\s+200/);
  // 2026 has the larger share, so it gets the longer bar despite the smaller count.
  const lines = result.stdout.split('\n');
  const barOf = (year: string) =>
    (lines.find((line) => line.startsWith(year))?.match(/#+/)?.[0] ?? '').length;
  expect(barOf('2026')).toBeGreaterThan(barOf('2025'));
});

test('with no filter the share is the whole of it', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const parsed = JSON.parse(runCli(ws.cacheBase, ws.homeDir, ['timeline', '--json']).stdout);
  for (const row of parsed.rows) {
    expect(row.count).toBe(row.total);
    expect(row.per_1000).toBe(1000);
  }
});
