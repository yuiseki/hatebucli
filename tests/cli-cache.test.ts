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

test('a re-synced day is searched as it now is', () => {
  const ws = createTempWorkspace();
  writeDailyCache(ws.cacheBase, '2026-02-01', [
    { title: '最初の記事', link: 'https://example.com/1', date: '2026-02-01T09:00:00+09:00' },
  ]);

  const first = runCli(ws.cacheBase, ws.homeDir, ['search', '最初', '--json']);
  expect(first.status).toBe(0);
  expect(JSON.parse(first.stdout)).toHaveLength(1);

  // A later sync replaces the day. Nothing may answer for the old contents.
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

test('stats --json carries the same window and numbers as the markdown', () => {
  const ws = createTempWorkspace();
  writeDailyCache(ws.cacheBase, '2026-02-18', [
    {
      title: 'One',
      link: 'https://example.com/a',
      date: '2026-02-18T09:00:00+09:00',
      tags: ['alpha'],
    },
    {
      title: 'Two',
      link: 'https://example.com/b',
      date: '2026-02-18T21:00:00+09:00',
    },
  ]);
  writeDailyCache(ws.cacheBase, '2026-02-19', [
    {
      title: 'Three',
      link: 'https://news.example.net/c',
      date: '2026-02-19T09:00:00+09:00',
      tags: ['alpha'],
    },
  ]);

  const args = ['stats', '--date', '2026-02-19', '--days', '3', '--top', '2'];
  const asJson = runCli(ws.cacheBase, ws.homeDir, [...args, '--json']);
  expect(asJson.status).toBe(0);

  const parsed = JSON.parse(asJson.stdout);
  expect(parsed.start).toBe('2026-02-17');
  expect(parsed.end).toBe('2026-02-19');
  expect(parsed.days).toBe(3);
  expect(parsed.bookmark_count).toBe(3);
  expect(parsed.bookmark_count_with_timestamp).toBe(3);
  expect(parsed.bookmark_count_with_tags).toBe(2);
  expect(parsed.total_tag_assignments).toBe(2);

  // Ranked like the markdown, cut to --top, and empty buckets left out.
  expect(parsed.domain_ranking).toEqual([
    { domain: 'example.com', count: 2 },
    { domain: 'news.example.net', count: 1 },
  ]);
  expect(parsed.tag_ranking).toEqual([{ tag: 'alpha', count: 2 }]);
  expect(parsed.hour_ranking).toEqual([
    { hour: 9, count: 2 },
    { hour: 21, count: 1 },
  ]);
  expect(parsed.weekday_ranking).toEqual([
    { weekday: 3, label: 'Wed', count: 2 },
    { weekday: 4, label: 'Thu', count: 1 },
  ]);
  expect(parsed.missing_dates).toEqual(['2026-02-17']);

  // The markdown says the same thing, for the same window.
  const asMarkdown = runCli(ws.cacheBase, ws.homeDir, args);
  expect(asMarkdown.stdout).toMatch(/Window: 2026-02-17 to 2026-02-19 \(3 days\)/);
  expect(asMarkdown.stdout).toContain('- example.com: 2');
  expect(asMarkdown.stdout).toContain('- #alpha: 2');
  expect(asMarkdown.stdout).toContain('Missing cache dates: 2026-02-17');
});
