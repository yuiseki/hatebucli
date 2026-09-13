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

  // --all because this day is already decided; the listing is what is tested.
  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-12', '--all', '--no-sync']);
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

  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-12', '1', '--no-sync']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('https://b.hatena.ne.jp/entry/s/example.com/3');
  expect(result.stdout).toContain('daily_best');
  // Nothing is opened and nothing is written: the person adds the tag there.
  expect(result.stdout).toContain('三本目');
});

test('a week runs Monday to Sunday, and --date names the week it falls in', () => {
  const ws = createTempWorkspace();
  seed(ws);

  // 2026-09-12 is a Saturday. Its week is Monday the 7th to Sunday the 13th.
  const saturday = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['pick', '--weekly', '--date', '2026-09-12', '--json', '--no-sync']).stdout,
  );
  expect([saturday.from, saturday.to]).toEqual(['2026-09-07', '2026-09-13']);

  // A Monday names its own week, not the one before it.
  const monday = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['pick', '--weekly', '--date', '2026-09-07', '--json', '--no-sync']).stdout,
  );
  expect([monday.from, monday.to]).toEqual(['2026-09-07', '2026-09-13']);

  // A Sunday is the last day of its week, not the first.
  const sunday = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['pick', '--weekly', '--date', '2026-09-06', '--json', '--no-sync']).stdout,
  );
  expect([sunday.from, sunday.to]).toEqual(['2026-08-31', '2026-09-06']);
});

test('pick --weekly offers the daily bests of the week', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--weekly', '--date', '2026-09-12', '--json', '--no-sync']);
  expect(result.status).toBe(0);

  const parsed = JSON.parse(result.stdout);
  expect(parsed.round).toBe('weekly');
  expect(parsed.tag).toBe('weekly_best');
  expect(parsed.from).toBe('2026-09-07');
  expect(parsed.to).toBe('2026-09-13');
  // 月曜の一本 is 2026-09-06, a Sunday, so it belongs to the week before.
  expect(parsed.candidates.map((row: any) => row.title)).toEqual([
    '二本目',
    '金曜の一本',
    '水曜の一本',
  ]);
  expect(parsed.candidates[0].entry_url).toBe('https://b.hatena.ne.jp/entry/s/example.com/2');
});

test('a period still being read is not one to choose from', () => {
  const ws = createTempWorkspace();
  seed(ws);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const week = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['pick', '--weekly', '--json', '--no-sync']).stdout,
  );
  // The default week is a whole Monday-to-Sunday week that has already ended.
  expect(week.to < todayKey).toBe(true);
  expect(new Date(week.from).getDay()).toBe(1);
  expect(new Date(week.to).getDay()).toBe(0);

  const month = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['pick', '--monthly', '--json', '--no-sync']).stdout,
  );
  expect(month.from).toMatch(/^\d{4}-\d{2}-01$/);
  expect(month.to < todayKey).toBe(true);
  expect(month.to.slice(0, 7)).toBe(month.from.slice(0, 7));
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

  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--monthly', '--date', '2026-09', '--json', '--no-sync']);
  expect(result.status).toBe(0);

  const parsed = JSON.parse(result.stdout);
  expect(parsed.round).toBe('monthly');
  expect(parsed.tag).toBe('monthly_best');
  // The month, and only the month.
  expect(parsed.candidates.map((row: any) => row.title)).toEqual(['先週の一本']);
});

test('a round that is already decided shows the choice and stops', () => {
  const ws = createTempWorkspace();
  seed(ws);

  // 2026-09-12 already has a daily_best, so there is nothing to choose.
  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-12', '--no-sync']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('二本目');
  expect(result.stdout).toContain('https://b.hatena.ne.jp/entry/s/example.com/2');
  // The other candidates are not listed.
  expect(result.stdout).not.toContain('三本目');
  expect(result.stdout).not.toContain('一本目');
  // And it says how to see them anyway.
  expect(result.stdout).toMatch(/--all/);
});

test('--all lists the candidates even when the round is decided', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-12', '--all', '--no-sync']);
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/1\. .*三本目/);
  expect(result.stdout).toMatch(/2\..*daily_best/);
});

test('a number still resolves when the round is decided', () => {
  const ws = createTempWorkspace();
  seed(ws);

  // Changing your mind is allowed: the numbering is the same list as --all.
  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-12', '1', '--no-sync']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('三本目');
  expect(result.stdout).toContain('https://b.hatena.ne.jp/entry/s/example.com/3');
});

test('the decided round says so in JSON too', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const parsed = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-12', '--json', '--no-sync']).stdout,
  );
  expect(parsed.decided).toBe(true);
  expect(parsed.chosen).toHaveLength(1);
  expect(parsed.chosen[0].title).toBe('二本目');
  expect(parsed.chosen[0].entry_url).toBe('https://b.hatena.ne.jp/entry/s/example.com/2');
  expect(parsed.candidate_count).toBe(3);
  expect(parsed.candidates).toBeUndefined();
});

test('a day may have more than one best, and all of them are shown', () => {
  const ws = createTempWorkspace();
  writeDailyCache(ws.cacheBase, '2026-09-11', [
    {
      title: '片方',
      link: 'https://example.com/a',
      date: '2026-09-11T09:00:00+09:00',
      tags: ['daily_best'],
    },
    {
      title: 'もう片方',
      link: 'https://example.com/b',
      date: '2026-09-11T10:00:00+09:00',
      tags: ['daily_best'],
    },
    { title: '選ばれなかった', link: 'https://example.com/c', date: '2026-09-11T11:00:00+09:00' },
  ]);

  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-11', '--no-sync']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('片方');
  expect(result.stdout).toContain('もう片方');
  expect(result.stdout).not.toContain('選ばれなかった');
  // Some days do not narrow to one. That is a count, not a complaint.
  expect(result.stdout).toMatch(/2 daily_best/);
  expect(result.stdout).toContain('https://b.hatena.ne.jp/entry/s/example.com/a');
  expect(result.stdout).toContain('https://b.hatena.ne.jp/entry/s/example.com/b');
});

test('several bests in a week are all candidates for the weekly round', () => {
  const ws = createTempWorkspace();
  seed(ws);
  // 2026-09-10 gets two, so the week has more candidates than it has days.
  writeDailyCache(ws.cacheBase, '2026-09-10', [
    {
      title: '木曜の一本目',
      link: 'https://example.com/thu-1',
      date: '2026-09-10T09:00:00+09:00',
      tags: ['daily_best'],
    },
    {
      title: '木曜の二本目',
      link: 'https://example.com/thu-2',
      date: '2026-09-10T10:00:00+09:00',
      tags: ['daily_best'],
    },
  ]);

  const parsed = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['pick', '--weekly', '--date', '2026-09-12', '--json', '--no-sync']).stdout,
  );
  expect(parsed.candidate_count).toBe(4);
  expect(parsed.candidates.map((row: any) => row.title)).toContain('木曜の一本目');
  expect(parsed.candidates.map((row: any) => row.title)).toContain('木曜の二本目');
});

test('one candidate is one candidate', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['pick', '--weekly', '--date', '2026-09-06', '--no-sync']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('(1 candidate)');
});

test('the hint repeats the command that produced the list', () => {
  const ws = createTempWorkspace();
  seed(ws);

  // Following `hatebu pick <number>` after a weekly listing would resolve
  // against yesterday's daily candidates: a different bookmark, silently.
  const weekly = runCli(ws.cacheBase, ws.homeDir, ['pick', '--weekly', '--date', '2026-09-12', '--no-sync']);
  expect(weekly.stdout).toContain('hatebu pick --weekly --date 2026-09-13 <number>');

  const daily = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-12', '--all', '--no-sync']);
  expect(daily.stdout).toContain('hatebu pick --date 2026-09-12 <number>');

  writeDailyCache(ws.cacheBase, '2026-09-03', [
    {
      title: '週の一本',
      link: 'https://example.com/w',
      date: '2026-09-03T09:00:00+09:00',
      tags: ['weekly_best'],
    },
  ]);
  const monthly = runCli(ws.cacheBase, ws.homeDir, ['pick', '--monthly', '--date', '2026-09', '--all', '--no-sync']);
  expect(monthly.stdout).toContain('hatebu pick --monthly --date 2026-09 <number>');
});

test('pick refuses a number that is not on the list', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const tooHigh = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-09-12', '9', '--no-sync']);
  expect(tooHigh.status).toBe(1);
  expect(tooHigh.stderr).toMatch(/1 and 3/);

  const empty = runCli(ws.cacheBase, ws.homeDir, ['pick', '--date', '2026-01-01', '1', '--no-sync']);
  expect(empty.status).toBe(1);
  expect(empty.stderr).toMatch(/No candidates/);
});
