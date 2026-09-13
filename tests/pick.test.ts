/**
 * `hatebu pick`: the human chooses, the CLI only lays out the candidates and
 * hands back the URL of the page where the tag gets added.
 *
 * Nothing here writes to Hatena. The tag is added by hand on the entry page,
 * and comes back into the cache on the next sync, which is what makes the
 * weekly and monthly rounds readable with the commands that already exist.
 */
import { test, expect } from 'vitest';
import { hatenaEntryUrl } from '../dist/format.js';
import { createTempWorkspace, runCli, writeDailyCache, type Workspace } from './helpers';

test('the entry URL follows the scheme of the bookmarked page', () => {
  // https is /entry/s/, http is /entry/. Checked against a real entry page.
  expect(hatenaEntryUrl('https://mamor-web.jp/_ct/17470587')).toBe(
    'https://b.hatena.ne.jp/entry/s/mamor-web.jp/_ct/17470587',
  );
  expect(hatenaEntryUrl('http://example.com/a')).toBe(
    'https://b.hatena.ne.jp/entry/example.com/a',
  );
  expect(hatenaEntryUrl('https://example.com/a?b=1')).toBe(
    'https://b.hatena.ne.jp/entry/s/example.com/a?b=1',
  );
  expect(hatenaEntryUrl('https://example.com/')).toBe(
    'https://b.hatena.ne.jp/entry/s/example.com/',
  );
});

test('a link that is not a web page has no entry URL', () => {
  expect(hatenaEntryUrl('mailto:someone@example.com')).toBeUndefined();
  expect(hatenaEntryUrl('not a url')).toBeUndefined();
  expect(hatenaEntryUrl('')).toBeUndefined();
});

function seed(ws: Workspace): void {
  writeDailyCache(ws.cacheBase, '2026-09-12', [
    { title: '一本目', link: 'https://example.com/1', date: '2026-09-12T09:00:00+09:00' },
    {
      title: '二本目',
      link: 'https://example.com/2',
      date: '2026-09-12T11:00:00+09:00',
      tags: ['daily_best'],
    },
    { title: '三本目', link: 'https://example.com/3', date: '2026-09-12T20:00:00+09:00' },
  ]);
  // A week of daily bests, for the weekly round.
  for (const [day, title] of [['06', '月曜の一本'], ['08', '水曜の一本'], ['10', '金曜の一本']]) {
    writeDailyCache(ws.cacheBase, `2026-09-${day}`, [
      {
        title,
        link: `https://example.com/best-${day}`,
        date: `2026-09-${day}T09:00:00+09:00`,
        tags: ['daily_best'],
      },
    ]);
  }
}

test('pick lists a day newest first, numbered, and marks what is already chosen', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-12']);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/1\. .*三本目/);
  expect(result.stdout).toMatch(/2\. .*二本目/);
  expect(result.stdout).toMatch(/3\. .*一本目/);
  // The one that already carries the tag says so, so a finished day is obvious.
  expect(result.stdout).toMatch(/2\..*daily_best/);
});

test('pick with a number gives the page where the tag is added', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-12', '1']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('https://b.hatena.ne.jp/entry/s/example.com/3');
  expect(result.stdout).toContain('daily_best');
  // Nothing is opened and nothing is written: the person adds the tag there.
  expect(result.stdout).toContain('三本目');
});

test('pick --weekly offers the daily bests of the week', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--weekly', '--date', '2026-09-12', '--json']);
  expect(result.status).toBe(0);

  const parsed = JSON.parse(result.stdout);
  expect(parsed.round).toBe('weekly');
  expect(parsed.tag).toBe('weekly_best');
  expect(parsed.from).toBe('2026-09-06');
  expect(parsed.to).toBe('2026-09-12');
  expect(parsed.candidates.map((row: any) => row.title)).toEqual([
    '二本目',
    '金曜の一本',
    '水曜の一本',
    '月曜の一本',
  ]);
  expect(parsed.candidates[0].entry_url).toBe('https://b.hatena.ne.jp/entry/s/example.com/2');
});

test('pick --monthly offers the weekly bests of the month', () => {
  const ws = createTempWorkspace();
  seed(ws);
  writeDailyCache(ws.cacheBase, '2026-09-05', [
    {
      title: '先週の一本',
      link: 'https://example.com/weekly',
      date: '2026-09-05T09:00:00+09:00',
      tags: ['weekly_best'],
    },
  ]);
  writeDailyCache(ws.cacheBase, '2026-08-30', [
    {
      title: '先月の一本',
      link: 'https://example.com/last-month',
      date: '2026-08-30T09:00:00+09:00',
      tags: ['weekly_best'],
    },
  ]);

  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--monthly', '--date', '2026-09', '--json']);
  expect(result.status).toBe(0);

  const parsed = JSON.parse(result.stdout);
  expect(parsed.round).toBe('monthly');
  expect(parsed.tag).toBe('monthly_best');
  // The month, and only the month.
  expect(parsed.candidates.map((row: any) => row.title)).toEqual(['先週の一本']);
});

test('one candidate is one candidate', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--weekly', '--date', '2026-09-06']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('(1 candidate)');
});

test('pick refuses a number that is not on the list', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const tooHigh = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-12', '9']);
  expect(tooHigh.status).toBe(1);
  expect(tooHigh.stderr).toMatch(/1 and 3/);

  const empty = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-01-01', '1']);
  expect(empty.status).toBe(1);
  expect(empty.stderr).toMatch(/No candidates/);
});
