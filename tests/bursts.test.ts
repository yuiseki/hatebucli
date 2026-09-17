/**
 * `hatebu bursts`: when a subject flared up.
 *
 * A timeline shows the shape; a burst names the stretches. The comparison is
 * against the subject's own rate over the whole archive, not against the other
 * months, because most months of a specific subject are zero and a median of
 * zeroes cannot be exceeded.
 */
import { test, expect } from 'vitest';
import { createTempWorkspace, runCli, writeDailyCache, type Workspace } from './helpers';

/** A month of `total` bookmarks, `hits` of which mention 地図. */
function month(ws: Workspace, dateKey: string, total: number, hits: number): void {
  writeDailyCache(
    ws.cacheBase,
    dateKey,
    Array.from({ length: total }, (_item, index) => ({
      title: index < hits ? `地図の記事 ${index}` : `別の記事 ${index}`,
      link: `https://example.com/${dateKey}-${index}`,
      date: `${dateKey}T09:00:00+09:00`,
    })),
  );
}

function seed(ws: Workspace): void {
  // Mostly quiet, as a subject usually is, with two flares in it. The baseline
  // is the subject's rate over the whole archive, so quiet months matter: they
  // are what the flares stand out against.
  for (const dateKey of [
    '2023-01-05', '2023-02-05', '2023-03-05', '2023-04-05', '2023-05-05', '2023-06-05',
    '2023-07-05', '2023-08-05', '2023-09-05', '2023-10-05', '2023-11-05', '2023-12-05',
    '2024-01-05', '2024-02-05',
  ]) {
    month(ws, dateKey, 50, 0);
  }
  month(ws, '2024-03-05', 50, 10);
  month(ws, '2024-04-05', 50, 12);
  month(ws, '2024-05-05', 50, 0);
  month(ws, '2024-06-05', 50, 0);
  month(ws, '2024-07-05', 50, 0);
  month(ws, '2024-08-05', 50, 9);
}

test('bursts names the stretches, oldest first', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const parsed = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['bursts', '--query', '地図', '--json']).stdout,
  );

  expect(parsed.bursts).toHaveLength(2);
  expect(parsed.bursts[0].from).toBe('2024-03');
  expect(parsed.bursts[0].to).toBe('2024-04');
  expect(parsed.bursts[0].count).toBe(22);
  expect(parsed.bursts[1].from).toBe('2024-08');
  expect(parsed.bursts[1].to).toBe('2024-08');
});

test('a burst says how far above the usual rate it was', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const parsed = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['bursts', '--query', '地図', '--json']).stdout,
  );

  // 31 of 1000 bookmarks mention it, so the usual rate is 31 per 1000. March
  // and April run at 200 and 240.
  expect(parsed.baseline_per_1000).toBeCloseTo(31, 1);
  expect(parsed.bursts[0].peak_month).toBe('2024-04');
  expect(parsed.bursts[0].peak_per_1000).toBe(240);
  expect(parsed.bursts[0].lift).toBeCloseTo(240 / 31, 1);
});

test('a quiet subject has no bursts rather than a fake one', () => {
  const ws = createTempWorkspace();
  // Evenly spread: the same rate every month is never a flare, whatever the rate.
  for (const dateKey of ['2024-01-05', '2024-02-05', '2024-03-05', '2024-04-05']) {
    month(ws, dateKey, 50, 5);
  }

  const parsed = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['bursts', '--query', '地図', '--json']).stdout,
  );
  expect(parsed.bursts).toEqual([]);
});

test('a month with one mention is not a flare', () => {
  const ws = createTempWorkspace();
  month(ws, '2024-01-05', 200, 0);
  month(ws, '2024-02-05', 2, 1);

  const parsed = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['bursts', '--query', '地図', '--json']).stdout,
  );
  // Half of a two-bookmark month is a huge rate and no evidence at all.
  expect(parsed.bursts).toEqual([]);
});

test('bursts needs something to look for', () => {
  const ws = createTempWorkspace();
  const result = runCli(ws.cacheBase, ws.homeDir, ['bursts']);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/--query, --tag or --domain/);
});
