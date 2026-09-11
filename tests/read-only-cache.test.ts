/**
 * Reading must not write. The MCP server is read-only and is meant to run in a
 * sandbox whose home is mounted read-only, so a command that only reads has to
 * survive a cache it cannot write to.
 */
import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTempWorkspace, runCli, writeDailyCache } from './helpers';

function cacheRoot(cacheBase: string): string {
  return path.join(cacheBase, 'hatebucli');
}

test('reading a range does not create the months it did not find', () => {
  const ws = createTempWorkspace();
  writeDailyCache(ws.cacheBase, '2019-07-04', [
    { title: '昔の記事', link: 'https://example.com/a', date: '2019-07-04T09:00:00+09:00' },
  ]);

  const result = runCli(ws.cacheBase, ws.homeDir, ['domains', '--date', '2019', '--json']);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).bookmark_count).toBe(1);

  const months = fs.readdirSync(path.join(cacheRoot(ws.cacheBase), '2019')).sort();
  expect(months).toEqual(['07']);
});

test('reading works when the cache cannot be written to', () => {
  const ws = createTempWorkspace();
  writeDailyCache(ws.cacheBase, '2019-07-04', [
    { title: '地図の記事', link: 'https://example.com/a', date: '2019-07-04T09:00:00+09:00' },
  ]);

  const root = cacheRoot(ws.cacheBase);
  const walk = (dir: string): string[] => [
    dir,
    ...fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => walk(path.join(dir, entry.name))),
  ];
  const directories = walk(root);
  for (const directory of directories.slice().reverse()) {
    fs.chmodSync(directory, 0o555);
  }

  try {
    for (const args of [
      ['domains', '--date', '2018', '--json'],
      ['list', '--date', '2019-07-04', '--json'],
      ['search', '地図', '--json'],
      ['timeline', '--json'],
      ['lookup', 'example.com', '--json'],
    ]) {
      const result = runCli(ws.cacheBase, ws.homeDir, args);
      expect(result.status, `${args.join(' ')}: ${result.stderr}`).toBe(0);
      expect(result.stderr).not.toMatch(/EACCES|permission denied/);
    }
  } finally {
    for (const directory of directories) {
      fs.chmodSync(directory, 0o755);
    }
  }
});

test('an absent cache is reported, not created', () => {
  const ws = createTempWorkspace();

  const result = runCli(ws.cacheBase, ws.homeDir, ['search', 'anything', '--json']);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([]);
  expect(fs.existsSync(cacheRoot(ws.cacheBase))).toBe(false);
});
