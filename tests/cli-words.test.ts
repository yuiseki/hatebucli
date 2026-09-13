/**
 * `hatebu words`: what a stretch of reading was about.
 *
 * The default compares the window against a background built from the whole
 * archive, so a word the archive uses constantly cannot win just by being
 * frequent. The background is a file the user builds; without it the command
 * still works, by counting.
 */
import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTempWorkspace, runCli, writeDailyCache, type Workspace } from './helpers';

function backgroundPath(cacheBase: string): string {
  return path.join(cacheBase, 'hatebucli', 'words', 'df-v1.json');
}

/**
 * A long stretch where every title mentions 地図, and one week where half of
 * them also mention マップライブラリ. 地図 is the frequent word; the library is
 * what that week was about.
 */
function seedArchive(ws: Workspace): void {
  for (let day = 1; day <= 28; day += 1) {
    const dateKey = `2025-06-${String(day).padStart(2, '0')}`;
    writeDailyCache(
      ws.cacheBase,
      dateKey,
      Array.from({ length: 10 }, (_item, index) => ({
        title: `地図の記事 その${day}-${index}`,
        link: `https://example.com/${day}-${index}`,
        date: `${dateKey}T09:00:00+09:00`,
      })),
    );
  }
  for (let day = 1; day <= 7; day += 1) {
    const dateKey = `2026-02-0${day}`;
    writeDailyCache(ws.cacheBase, dateKey, [
      ...Array.from({ length: 5 }, (_item, index) => ({
        title: `地図の記事 ${day}-${index}`,
        link: `https://example.com/2026-${day}-${index}`,
        date: `${dateKey}T09:00:00+09:00`,
      })),
      ...Array.from({ length: 5 }, (_item, index) => ({
        title: `地図とマップライブラリ ${day}-${index}`,
        link: `https://example.com/lib-${day}-${index}`,
        date: `${dateKey}T10:00:00+09:00`,
      })),
    ]);
  }
}

test('the background is built on request and says what it covers', () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const built = runCli(ws.cacheBase, ws.homeDir, ['words', '--rebuild-background']);
  expect(built.status).toBe(0);
  expect(built.stdout).toMatch(/350 bookmarks/);
  expect(fs.existsSync(backgroundPath(ws.cacheBase))).toBe(true);

  const model = JSON.parse(fs.readFileSync(backgroundPath(ws.cacheBase), 'utf8'));
  expect(model.version).toBe(1);
  expect(model.documents).toBe(350);
  expect(model.df['地図']).toBe(350);
});

test('distinctive ranking beats frequency at saying what a week was about', () => {
  const ws = createTempWorkspace();
  seedArchive(ws);
  runCli(ws.cacheBase, ws.homeDir, ['words', '--rebuild-background']);

  const args = ['--date', '2026-02', '--json', '--limit', '5'];
  const byCount = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['words', ...args, '--by', 'count']).stdout,
  );
  const distinctive = JSON.parse(runCli(ws.cacheBase, ws.homeDir, ['words', ...args]).stdout);

  // 地図 is in every bookmark of the archive, so counting puts it first.
  expect(byCount.scoring).toBe('count');
  expect(byCount.ranking[0].word).toBe('地図');

  // The default says what this month had that the rest did not. マップライブラリ
  // is two tokens, equally distinctive, so both lead and their order between
  // themselves is not the point.
  expect(distinctive.scoring).toBe('distinctive');
  const words = distinctive.ranking.map((row: any) => row.word);
  expect(words.slice(0, 2).sort()).toEqual(['マップ', 'ライブラリ']);
  expect(distinctive.ranking[0]).toHaveProperty('score');
  expect(distinctive.ranking[0]).toHaveProperty('background');
  // 地図 is in every bookmark of both the window and the archive, so it is not
  // what the month was about. It is still listed, scored at or below nothing.
  const chizu = distinctive.ranking.find((row: any) => row.word === '地図');
  expect(chizu.score).toBeLessThanOrEqual(0);
  expect(words.indexOf('地図')).toBeGreaterThan(1);
});

test('without a background it counts, and says that is what it did', () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['words', '--date', '2026-02', '--json']);
  expect(result.status).toBe(0);

  const parsed = JSON.parse(result.stdout);
  expect(parsed.scoring).toBe('count');
  expect(parsed.note).toMatch(/--rebuild-background/);
  expect(parsed.ranking[0].word).toBe('地図');
});

test('reading works when the cache cannot be written to', () => {
  const ws = createTempWorkspace();
  seedArchive(ws);
  runCli(ws.cacheBase, ws.homeDir, ['words', '--rebuild-background']);

  const root = path.join(ws.cacheBase, 'hatebucli');
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
    const result = runCli(ws.cacheBase, ws.homeDir, ['words', '--date', '2026-02', '--json']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).scoring).toBe('distinctive');
  } finally {
    for (const directory of directories) {
      fs.chmodSync(directory, 0o755);
    }
  }
});

test('rejects a scoring it does not have', () => {
  const ws = createTempWorkspace();
  const result = runCli(ws.cacheBase, ws.homeDir, ['words', '--by', 'tfidf']);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/--by must be/);
});
