/**
 * What the CLI does with arguments it cannot use. A bad argument should say
 * what is wrong and exit non-zero, never print a stack trace and never carry
 * on as if nothing happened.
 */
import { test, expect } from 'vitest';
import { createTempWorkspace, runCli, writeDailyCache } from './helpers';

test('list rejects a date it cannot read', () => {
  const ws = createTempWorkspace();
  const result = runCli(ws.cacheBase, ws.homeDir, ['list', '--date', 'not-a-date']);

  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/--date must be a valid yyyy-mm-dd/);
  expect(result.stderr).not.toMatch(/at Command\./);
  expect(result.stderr).not.toMatch(/RangeError/);
});

test('sync rejects a day count it cannot read', () => {
  const ws = createTempWorkspace();

  const notANumber = runCli(ws.cacheBase, ws.homeDir, ['sync', '--days', 'abc']);
  expect(notANumber.status).toBe(1);
  expect(notANumber.stderr).toMatch(/--days must be a positive integer/);
  expect(notANumber.stdout).not.toMatch(/NaN/);

  const zero = runCli(ws.cacheBase, ws.homeDir, ['sync', '--days', '0']);
  expect(zero.status).toBe(1);
  expect(zero.stderr).toMatch(/--days must be a positive integer/);
});

test('sync rejects a date it cannot read', () => {
  const ws = createTempWorkspace();
  const result = runCli(ws.cacheBase, ws.homeDir, ['sync', '--date', '2026-02-30']);

  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/--date must be a valid yyyy-mm-dd/);
});

test('search rejects an empty query, a bad field and a bad limit', () => {
  const ws = createTempWorkspace();

  const empty = runCli(ws.cacheBase, ws.homeDir, ['search', '   ']);
  expect(empty.status).toBe(1);
  expect(empty.stderr).toMatch(/query must not be empty/);

  const field = runCli(ws.cacheBase, ws.homeDir, ['search', 'foo', '--field', 'body']);
  expect(field.status).toBe(1);
  expect(field.stderr).toMatch(/--field must be one of/);

  const limit = runCli(ws.cacheBase, ws.homeDir, ['search', 'foo', '--limit', '0']);
  expect(limit.status).toBe(1);
  expect(limit.stderr).toMatch(/--limit must be a positive integer/);

  const date = runCli(ws.cacheBase, ws.homeDir, ['search', 'foo', '--date', '2026-2-1']);
  expect(date.status).toBe(1);
  expect(date.stderr).toMatch(/--date must be a valid yyyy-mm-dd/);
});

test('the ranking commands reject a date that is not a real day', () => {
  const ws = createTempWorkspace();

  const month = runCli(ws.cacheBase, ws.homeDir, ['words', '--date', '2026-13']);
  expect(month.status).toBe(1);
  expect(month.stderr).toMatch(/--date month is invalid/);

  const day = runCli(ws.cacheBase, ws.homeDir, ['tags', '--date', '2026-02-30']);
  expect(day.status).toBe(1);
  expect(day.stderr).toMatch(/--date day is invalid/);

  const shape = runCli(ws.cacheBase, ws.homeDir, ['domains', '--date', 'last-week']);
  expect(shape.status).toBe(1);
  expect(shape.stderr).toMatch(/--date format must be yyyy or yyyy-mm or yyyy-mm-dd/);
});

test('import reports a source directory that is not there', () => {
  const ws = createTempWorkspace();
  const result = runCli(ws.cacheBase, ws.homeDir, ['import', '/nonexistent-hatebucli-source']);

  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/does not exist/);
});

test('an unknown command exits non-zero', () => {
  const ws = createTempWorkspace();
  const result = runCli(ws.cacheBase, ws.homeDir, ['bookmarks']);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/unknown command/i);
});

test('the ranking limits are clamped rather than refused', () => {
  const ws = createTempWorkspace();
  const titles = Array.from({ length: 40 }, (_item, index) => ({
    title: `記事${index}の題名です`,
    link: `https://example${index}.com/a`,
    date: '2026-03-01T09:00:00+09:00',
    tags: [`tag${index}`],
  }));
  writeDailyCache(ws.cacheBase, '2026-03-01', titles);

  const domains = runCli(ws.cacheBase, ws.homeDir, [
    'domains', '--date', '2026-03-01', '--limit', '999', '--json',
  ]);
  expect(domains.status).toBe(0);
  expect(JSON.parse(domains.stdout).ranking).toHaveLength(10);

  const tags = runCli(ws.cacheBase, ws.homeDir, [
    'tags', '--date', '2026-03-01', '--limit', '999', '--json',
  ]);
  expect(tags.status).toBe(0);
  expect(JSON.parse(tags.stdout).ranking).toHaveLength(10);

  const words = runCli(ws.cacheBase, ws.homeDir, [
    'words', '--date', '2026-03-01', '--limit', '999', '--json',
  ]);
  expect(words.status).toBe(0);
  expect(JSON.parse(words.stdout).ranking.length).toBeLessThanOrEqual(30);
});

test('an empty day is reported as empty, not as a failure', () => {
  const ws = createTempWorkspace();

  const asJson = runCli(ws.cacheBase, ws.homeDir, ['list', '--date', '2026-02-18', '--json']);
  expect(asJson.status).toBe(0);
  expect(JSON.parse(asJson.stdout)).toEqual([]);

  const asText = runCli(ws.cacheBase, ws.homeDir, ['list', '--date', '2026-02-18']);
  expect(asText.status).toBe(0);
  expect(asText.stdout).toContain('No bookmarks found for 2026-02-18.');

  const search = runCli(ws.cacheBase, ws.homeDir, ['search', 'nothing-here']);
  expect(search.status).toBe(0);
  expect(search.stdout).toContain('No matching bookmarks found.');
});
