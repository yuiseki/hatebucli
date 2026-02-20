import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

const REPO_ROOT = process.cwd();
const CLI_PATH = path.join(REPO_ROOT, 'dist', 'index.js');

type BookmarkFixture = {
  title: string;
  link: string;
  date: string;
  description?: string;
  tags?: string[];
  categories?: string[];
};

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function createTempWorkspace(): { rootDir: string; cacheBase: string; homeDir: string } {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hatebucli-test-'));
  const cacheBase = path.join(rootDir, 'cache');
  const homeDir = path.join(rootDir, 'home');
  ensureDir(cacheBase);
  ensureDir(homeDir);
  return { rootDir, cacheBase, homeDir };
}

function ymdPartsFromDate(date: Date): { year: string; month: string; day: string } {
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0'),
  };
}

function ymdFromDate(date: Date): string {
  const parts = ymdPartsFromDate(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getDefaultWeeklyRangeLabels(): {
  start: Date;
  end: Date;
  startLabel: string;
  endLabel: string;
} {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 23, 59, 59, 999);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 8, 0, 0, 0, 0);
  return {
    start,
    end,
    startLabel: ymdFromDate(start),
    endLabel: ymdFromDate(end),
  };
}

function writeDailyCache(cacheBase: string, dateKey: string, bookmarks: BookmarkFixture[]): void {
  const [year, month, day] = dateKey.split('-');
  const dir = path.join(cacheBase, 'hatebucli', year, month);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, `${day}.json`), JSON.stringify(bookmarks, null, 2), 'utf8');
}

function runCli(
  cacheBase: string,
  homeDir: string,
  args: string[],
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      XDG_CACHE_HOME: cacheBase,
      HOME: homeDir,
      HATENA_USER: 'test-user',
    },
  });
}

test('domains default range is from 8 days ago to yesterday', () => {
  const ws = createTempWorkspace();
  const range = getDefaultWeeklyRangeLabels();
  const todayLabel = ymdFromDate(new Date());

  writeDailyCache(ws.cacheBase, range.endLabel, [
    {
      title: 'Yesterday entry',
      link: 'https://weekly.example/article',
      date: `${range.endLabel}T10:00:00+09:00`,
    },
  ]);
  writeDailyCache(ws.cacheBase, todayLabel, [
    {
      title: 'Today entry',
      link: 'https://today.example/article',
      date: `${todayLabel}T10:00:00+09:00`,
    },
  ]);

  const result = runCli(ws.cacheBase, ws.homeDir, ['domains', '--limit', '5']);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(new RegExp(`Domains on ${range.startLabel}\\.\\.${range.endLabel}`));
  expect(result.stdout).toContain('weekly.example: 1');
  expect(result.stdout).not.toContain('today.example');
});

test('tags ranking is built from tags, categories and description tag blocks', () => {
  const ws = createTempWorkspace();

  writeDailyCache(ws.cacheBase, '2026-01-15', [
    {
      title: 'Entry 1',
      link: 'https://example.com/1',
      date: '2026-01-15T09:00:00+09:00',
      tags: ['alpha', 'beta'],
      description: '[gamma] first',
    },
    {
      title: 'Entry 2',
      link: 'https://example.com/2',
      date: '2026-01-15T10:00:00+09:00',
      tags: ['alpha'],
      categories: ['beta'],
      description: 'second',
    },
    {
      title: 'Entry 3',
      link: 'https://example.com/3',
      date: '2026-01-15T11:00:00+09:00',
      description: '[gamma][delta] third',
    },
  ]);

  const result = runCli(ws.cacheBase, ws.homeDir, ['tags', '--date', '2026-01', '--limit', '5']);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/Tags on 2026-01/);
  expect(result.stdout).toContain('#alpha: 2');
  expect(result.stdout).toContain('#beta: 2');
  expect(result.stdout).toContain('#gamma: 2');
  expect(result.stdout).toContain('#delta: 1');
});

test('search honors --field and creates day index file', () => {
  const ws = createTempWorkspace();

  writeDailyCache(ws.cacheBase, '2026-02-01', [
    {
      title: '生成AIメモ',
      link: 'https://example.com/ai/start',
      date: '2026-02-01T08:00:00+09:00',
      description: 'memo',
    },
    {
      title: 'example.com title only',
      link: 'https://zenn.dev/articles/abc',
      date: '2026-02-01T09:00:00+09:00',
      description: 'memo',
    },
  ]);

  const urlFieldResult = runCli(ws.cacheBase, ws.homeDir, [
    'search',
    'example.com',
    '--field',
    'url',
    '--date',
    '2026-02-01',
  ]);
  expect(urlFieldResult.status).toBe(0);
  expect(urlFieldResult.stdout).toContain('生成AIメモ');
  expect(urlFieldResult.stdout).not.toContain('title only');

  const titleFieldResult = runCli(ws.cacheBase, ws.homeDir, [
    'search',
    'example.com',
    '--field',
    'title',
    '--date',
    '2026-02-01',
  ]);
  expect(titleFieldResult.status).toBe(0);
  expect(titleFieldResult.stdout).toContain('[2026-02-01] example.com title only');
  expect(titleFieldResult.stdout).not.toContain('生成AIメモ');

  const indexPath = path.join(
    ws.cacheBase,
    'hatebucli',
    'index',
    'v1',
    '2026',
    '02',
    '01.json',
  );
  expect(fs.existsSync(indexPath)).toBe(true);
});

test('stats outputs markdown summary sections', () => {
  const ws = createTempWorkspace();

  writeDailyCache(ws.cacheBase, '2026-02-18', [
    {
      title: 'Entry 1',
      link: 'https://example.com/a',
      date: '2026-02-18T09:00:00+09:00',
      tags: ['alpha'],
      description: '',
    },
    {
      title: 'Entry 2',
      link: 'https://example.com/b',
      date: '2026-02-18T10:00:00+09:00',
      description: '[beta]',
    },
  ]);
  writeDailyCache(ws.cacheBase, '2026-02-19', [
    {
      title: 'Entry 3',
      link: 'https://news.example.net/c',
      date: '2026-02-19T21:00:00+09:00',
      tags: ['alpha'],
      description: '',
    },
  ]);

  const result = runCli(ws.cacheBase, ws.homeDir, [
    'stats',
    '--date',
    '2026-02-19',
    '--days',
    '2',
    '--top',
    '3',
  ]);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/## Hatebu Stats/);
  expect(result.stdout).toMatch(/Window: 2026-02-18 to 2026-02-19 \(2 days\)/);
  expect(result.stdout).toMatch(/### Bookmark Time \(Hour\)/);
  expect(result.stdout).toMatch(/### Bookmark Weekday/);
  expect(result.stdout).toMatch(/### Domains/);
  expect(result.stdout).toContain('- example.com: 2');
  expect(result.stdout).toMatch(/### Tags/);
  expect(result.stdout).toContain('- #alpha: 2');
});

test('domains rejects --today with --date', () => {
  const ws = createTempWorkspace();
  const result = runCli(ws.cacheBase, ws.homeDir, ['domains', '--today', '--date', '2026-02-20']);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/--today and --date cannot be used together/);
});
