/**
 * The parts that read the cache: search across days, the index that backs it,
 * the JSON shapes the ranking commands return, and import.
 */
import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  createTempWorkspace,
  dailyCachePath,
  ensureDir,
  runCli,
  writeDailyCache,
} from './helpers';

function indexPath(cacheBase: string, dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  return path.join(cacheBase, 'hatebucli', 'index', 'v1', year, month, `${day}.json`);
}

test('search with no --date covers every cached day, newest first', () => {
  const ws = createTempWorkspace();
  writeDailyCache(ws.cacheBase, '2024-05-01', [
    { title: '地図の歴史', link: 'https://old.example/1', date: '2024-05-01T09:00:00+09:00' },
  ]);
  writeDailyCache(ws.cacheBase, '2026-02-01', [
    { title: '地図を描く', link: 'https://new.example/1', date: '2026-02-01T09:00:00+09:00' },
  ]);

  const result = runCli(ws.cacheBase, ws.homeDir, ['search', '地図', '--json']);
  expect(result.status).toBe(0);

  const results = JSON.parse(result.stdout) as Array<{ dateKey: string; title: string }>;
  expect(results.map((item) => item.dateKey)).toEqual(['2026-02-01', '2024-05-01']);
});

test('search --limit caps the results', () => {
  const ws = createTempWorkspace();
  writeDailyCache(ws.cacheBase, '2026-02-01', [
    { title: '地図1', link: 'https://example.com/1', date: '2026-02-01T09:00:00+09:00' },
    { title: '地図2', link: 'https://example.com/2', date: '2026-02-01T10:00:00+09:00' },
    { title: '地図3', link: 'https://example.com/3', date: '2026-02-01T11:00:00+09:00' },
  ]);

  const result = runCli(ws.cacheBase, ws.homeDir, ['search', '地図', '--limit', '2', '--json']);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toHaveLength(2);
});

test('the day index is rebuilt when the cached day changes', () => {
  const ws = createTempWorkspace();
  writeDailyCache(ws.cacheBase, '2026-02-01', [
    { title: '最初の記事', link: 'https://example.com/1', date: '2026-02-01T09:00:00+09:00' },
  ]);

  const first = runCli(ws.cacheBase, ws.homeDir, ['search', '最初', '--json']);
  expect(first.status).toBe(0);
  expect(JSON.parse(first.stdout)).toHaveLength(1);
  expect(fs.existsSync(indexPath(ws.cacheBase, '2026-02-01'))).toBe(true);

  // A later sync replaces the day. The stale index must not answer for it.
  writeDailyCache(ws.cacheBase, '2026-02-01', [
    { title: '差し替えた記事', link: 'https://example.com/2', date: '2026-02-01T09:00:00+09:00' },
  ]);

  const stale = runCli(ws.cacheBase, ws.homeDir, ['search', '最初', '--json']);
  expect(stale.status).toBe(0);
  expect(JSON.parse(stale.stdout)).toEqual([]);

  const rebuilt = runCli(ws.cacheBase, ws.homeDir, ['search', '差し替え', '--json']);
  expect(rebuilt.status).toBe(0);
  expect(JSON.parse(rebuilt.stdout)).toHaveLength(1);
});

test('the ranking commands report the days they could not read', () => {
  const ws = createTempWorkspace();
  writeDailyCache(ws.cacheBase, '2026-02-01', [
    { title: 'One', link: 'https://example.com/a', date: '2026-02-01T09:00:00+09:00' },
  ]);

  const result = runCli(ws.cacheBase, ws.homeDir, [
    'domains', '--date', '2026-02', '--json',
  ]);
  expect(result.status).toBe(0);

  const parsed = JSON.parse(result.stdout);
  expect(parsed.date).toBe('2026-02');
  expect(parsed.bookmark_count).toBe(1);
  expect(parsed.domain_bookmark_count).toBe(1);
  expect(parsed.total_domains).toBe(1);
  expect(parsed.missing_dates).toHaveLength(27);
  expect(parsed.missing_dates[0]).toBe('2026-02-02');
});

test('stats --days counts back from the anchor and clamps --top', () => {
  const ws = createTempWorkspace();
  for (const day of ['01', '02', '03']) {
    writeDailyCache(ws.cacheBase, `2026-02-${day}`, [
      {
        title: `Day ${day}`,
        link: `https://example.com/${day}`,
        date: `2026-02-${day}T09:00:00+09:00`,
      },
    ]);
  }

  const result = runCli(ws.cacheBase, ws.homeDir, [
    'stats', '--date', '2026-02-03', '--days', '2', '--top', '999',
  ]);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/Window: 2026-02-02 to 2026-02-03 \(2 days\)/);
  expect(result.stdout).toMatch(/Total bookmarks: 2/);
  expect(result.stdout).not.toContain('example.com/01');
  // Weekday never shows more than the seven there are, whatever --top says.
  const weekdaySection = result.stdout.split('### Bookmark Weekday')[1].split('###')[0];
  expect(weekdaySection.match(/^- /gm)?.length ?? 0).toBeLessThanOrEqual(7);
});

test('import copies a legacy tree into the cache and search finds it', () => {
  const ws = createTempWorkspace();
  const sourceDir = path.join(ws.rootDir, 'legacy');
  ensureDir(path.join(sourceDir, '2019', '07'));
  fs.writeFileSync(
    path.join(sourceDir, '2019', '07', '04.json'),
    JSON.stringify([
      { title: '昔のブックマーク', link: 'https://legacy.example/1', date: '2019-07-04T09:00:00+09:00' },
    ]),
    'utf8',
  );

  const imported = runCli(ws.cacheBase, ws.homeDir, ['import', sourceDir]);
  expect(imported.status).toBe(0);
  expect(fs.existsSync(dailyCachePath(ws.cacheBase, '2019-07-04'))).toBe(true);

  const found = runCli(ws.cacheBase, ws.homeDir, ['search', '昔の', '--json']);
  expect(found.status).toBe(0);
  expect(JSON.parse(found.stdout)).toHaveLength(1);
});
