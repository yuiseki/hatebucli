/**
 * The background model, version 2: the same totals, plus a breakdown by year.
 *
 * The totals answer "is this word usual". The years answer "when was it
 * usual", which is what a question about something that has gone quiet needs.
 */
import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTempWorkspace, runCli, writeDailyCache, type Workspace } from './helpers';

function modelPath(cacheBase: string): string {
  return path.join(cacheBase, 'hatebucli', 'words', 'df-v2.json');
}

function seed(ws: Workspace): void {
  writeDailyCache(ws.cacheBase, '2019-05-02', [
    { title: '地図の記事', link: 'https://example.com/a', date: '2019-05-02T09:00:00+09:00' },
    { title: '地図と測量', link: 'https://example.com/b', date: '2019-05-02T10:00:00+09:00' },
    { title: '無関係な記事', link: 'https://example.com/c', date: '2019-05-02T11:00:00+09:00' },
  ]);
  writeDailyCache(ws.cacheBase, '2026-05-02', [
    { title: 'エージェントの記事', link: 'https://example.com/d', date: '2026-05-02T09:00:00+09:00' },
    { title: 'エージェントと自律', link: 'https://example.com/e', date: '2026-05-02T10:00:00+09:00' },
  ]);
}

test('the model carries a breakdown by year', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const built = runCli(ws.cacheBase, ws.homeDir, ['words', '--rebuild-background', '--json']);
  expect(built.status).toBe(0);

  const model = JSON.parse(fs.readFileSync(modelPath(ws.cacheBase), 'utf8'));
  expect(model.version).toBe(2);
  expect(model.documents).toBe(5);
  expect(model.df['地図']).toBe(2);

  expect(Object.keys(model.years).sort()).toEqual(['2019', '2026']);
  expect(model.years['2019'].documents).toBe(3);
  expect(model.years['2019'].df['地図']).toBe(2);
  expect(model.years['2026'].documents).toBe(2);
  expect(model.years['2026'].df['エージェント']).toBe(2);
  // A word of one year is absent from the other, not zero.
  expect(model.years['2026'].df['地図']).toBeUndefined();
});

test('the totals still answer the distinctive ranking', () => {
  const ws = createTempWorkspace();
  seed(ws);
  runCli(ws.cacheBase, ws.homeDir, ['words', '--rebuild-background']);

  const parsed = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['words', '--date', '2026', '--json']).stdout,
  );
  expect(parsed.scoring).toBe('distinctive');
  expect(parsed.ranking.map((row: any) => row.word)).toContain('エージェント');
});

test('a model from the old version is not read as if it had years', () => {
  const ws = createTempWorkspace();
  seed(ws);
  const oldPath = path.join(ws.cacheBase, 'hatebucli', 'words', 'df-v1.json');
  fs.mkdirSync(path.dirname(oldPath), { recursive: true });
  fs.writeFileSync(
    oldPath,
    JSON.stringify({
      version: 1,
      built_at: '2026-01-01T00:00:00.000Z',
      documents: 5,
      word_instances: 7,
      vocabulary: 4,
      pruned_below: 2,
      df: { 地図: 2 },
    }),
  );

  // The ranking still works from a version 1 model.
  const words = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['words', '--date', '2026', '--json']).stdout,
  );
  expect(words.scoring).toBe('distinctive');

  // Anything that needs the years says to rebuild rather than inventing them.
  const resurface = runCli(ws.cacheBase, ws.homeDir, ['resurface', '--json']);
  expect(resurface.status).toBe(1);
  expect(resurface.stderr).toMatch(/--rebuild-background/);
});
