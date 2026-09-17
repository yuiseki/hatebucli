/**
 * `hatebu resurface`: what the archive cared about and has stopped mentioning.
 *
 * Every other tool answers a question about a subject already in mind. This one
 * has none: it reads the vocabulary year by year, looking for the shape of
 * something that burned and went out.
 */
import { test, expect } from 'vitest';
import { createTempWorkspace, runCli, writeDailyCache, type Workspace } from './helpers';

/** A year of `total` bookmarks, made up of the given subjects and filler. */
function year(ws: Workspace, y: string, total: number, subjects: Array<[string, number]>): void {
  const titles: string[] = [];
  for (const [subject, hits] of subjects) {
    for (let index = 0; index < hits; index += 1) titles.push(`${subject}の記事 ${index}`);
  }
  while (titles.length < total) titles.push(`別の話題 ${titles.length}`);

  writeDailyCache(
    ws.cacheBase,
    `${y}-06-01`,
    titles.map((title, index) => ({
      title,
      link: `https://example.com/${y}-${index}`,
      date: `${y}-06-01T09:00:00+09:00`,
    })),
  );
}

function seed(ws: Workspace): void {
  // 携帯電話 burned in 2016 and went silent. 生成モデル is current. 天気 runs at
  // the same rate throughout, right up to now, so it never fell from anything.
  const weather: [string, number] = ['天気', 10];
  year(ws, '2016', 100, [weather, ['携帯電話', 40]]);
  year(ws, '2017', 100, [weather, ['携帯電話', 10]]);
  for (const y of ['2018', '2019', '2020', '2021', '2022', '2023', '2024']) {
    year(ws, y, 100, [weather]);
  }
  year(ws, '2025', 100, [weather, ['生成モデル', 40]]);
  year(ws, '2026', 100, [weather, ['生成モデル', 40]]);
}

function rows(ws: Workspace, args: string[] = []): any[] {
  const result = runCli(ws.cacheBase, ws.homeDir, ['resurface', '--json', ...args]);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout).rows;
}

test('it finds what burned and went out, not what is current', () => {
  const ws = createTempWorkspace();
  seed(ws);
  runCli(ws.cacheBase, ws.homeDir, ['words', '--rebuild-background']);

  const words = rows(ws).map((row: any) => row.word);
  expect(words).toContain('携帯');
  // Still going, so nothing to bring back.
  expect(words).not.toContain('生成');
  expect(words).not.toContain('モデル');
});

test('a steady subject never scores, however much of it there is', () => {
  const ws = createTempWorkspace();
  seed(ws);
  runCli(ws.cacheBase, ws.homeDir, ['words', '--rebuild-background']);

  // 天気 runs at the same rate from 2016 to now: no height to have fallen from.
  const weather = rows(ws).find((row: any) => row.word === '天気');
  expect(weather).toBeUndefined();
});

test('a row shows the shape it was judged on', () => {
  const ws = createTempWorkspace();
  seed(ws);
  runCli(ws.cacheBase, ws.homeDir, ['words', '--rebuild-background']);

  const phone = rows(ws).find((row: any) => row.word === '携帯');
  expect(phone.peak_year).toBe('2016');
  expect(phone.peak_per_1000).toBeCloseTo(400, 0);
  expect(phone.recent_per_1000).toBe(0);
  expect(phone.fade).toBe(1);
  expect(phone.dormant_years).toBe(10);
  expect(phone.total).toBe(50);
});

test('the peak year can be bounded, because dormancy always favours the oldest', () => {
  const ws = createTempWorkspace();
  seed(ws);
  runCli(ws.cacheBase, ws.homeDir, ['words', '--rebuild-background']);

  expect(rows(ws, ['--peaked-after', '2020']).map((row: any) => row.word)).not.toContain('携帯');
  expect(rows(ws, ['--peaked-before', '2017']).map((row: any) => row.word)).toContain('携帯');
});

test('a subject too small to have been a subject is left out', () => {
  const ws = createTempWorkspace();
  seed(ws);
  runCli(ws.cacheBase, ws.homeDir, ['words', '--rebuild-background']);

  // 携帯 has 50 bookmarks, so a floor above that drops it.
  expect(rows(ws, ['--min-total', '100']).map((row: any) => row.word)).not.toContain('携帯');
});

test('without a background it says how to build one', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['resurface']);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/--rebuild-background/);
});
