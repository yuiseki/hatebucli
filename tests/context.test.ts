/**
 * `hatebu context`: what else was being read around a bookmark.
 *
 * Bookmarking happens in sittings. A page on its own says what was read; the
 * half hour around it says what it was read alongside, which is usually the
 * answer to why it was read at all.
 */
import { test, expect } from 'vitest';
import {
  createTempWorkspace,
  localTimestamp,
  runCli,
  writeDailyCache,
  type Workspace,
} from './helpers';

/**
 * Times are built in the timezone the test runs in. `context` reads and reports
 * local clock time, so a fixture written at a fixed offset lands at a different
 * hour depending on where it runs, and the run in UTC found that out.
 */
function seed(ws: Workspace): void {
  writeDailyCache(ws.cacheBase, '2026-04-10', [
    { title: '朝の一本', link: 'https://example.com/morning', date: localTimestamp('2026-04-10', 8) },
    { title: '調べもの1', link: 'https://example.com/a', date: localTimestamp('2026-04-10', 21, 0) },
    { title: '調べもの2', link: 'https://example.com/b', date: localTimestamp('2026-04-10', 21, 10) },
    { title: 'これ', link: 'https://example.com/target', date: localTimestamp('2026-04-10', 21, 15) },
    { title: '調べもの3', link: 'https://example.com/c', date: localTimestamp('2026-04-10', 21, 40) },
    { title: '夜更けの一本', link: 'https://example.com/late', date: localTimestamp('2026-04-10', 23, 30) },
  ]);
}

test('context shows what was bookmarked around a page, and marks it', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['context', 'https://example.com/target']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('調べもの1');
  expect(result.stdout).toContain('調べもの3');
  expect(result.stdout).toMatch(/→ .*これ/);
  // Outside the window, so not part of the sitting.
  expect(result.stdout).not.toContain('朝の一本');
  expect(result.stdout).not.toContain('夜更けの一本');
});

test('a gap ends a sitting', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const parsed = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, [
      'context', 'https://example.com/target', '--gap', '20', '--json',
    ]).stdout,
  );

  // 21:00, 21:10, 21:15 are within twenty minutes of each other; 21:40 is
  // twenty-five minutes after the last of them, so it starts another.
  expect(parsed.sessions).toHaveLength(2);
  expect(parsed.sessions[0].bookmarks.map((row: any) => row.title)).toEqual([
    '調べもの1',
    '調べもの2',
    'これ',
  ]);
  expect(parsed.sessions[1].bookmarks.map((row: any) => row.title)).toEqual(['調べもの3']);
  expect(parsed.sessions[0].bookmarks[2].target).toBe(true);
});

test('--minutes widens the window', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const titlesWithin = (minutes: string) => {
    const parsed = JSON.parse(
      runCli(ws.cacheBase, ws.homeDir, [
        'context', 'https://example.com/target', '--minutes', minutes, '--json',
      ]).stdout,
    );
    return parsed.sessions.flatMap((session: any) =>
      session.bookmarks.map((row: any) => row.title),
    );
  };

  // The target is at 21:15. 23:30 is two and a quarter hours later, 08:00 is
  // thirteen hours earlier.
  expect(titlesWithin('180')).toContain('夜更けの一本');
  expect(titlesWithin('180')).not.toContain('朝の一本');
  expect(titlesWithin('900')).toContain('朝の一本');
});

test('a bookmark that is not in the archive says so', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['context', 'https://example.com/never']);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/not bookmarked|no bookmark/i);
});

test('a time works as well as a URL', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const parsed = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['context', '2026-04-10T21:15', '--json']).stdout,
  );
  const titles = parsed.sessions.flatMap((session: any) =>
    session.bookmarks.map((row: any) => row.title),
  );
  expect(titles).toContain('これ');
  expect(titles).toContain('調べもの1');
  // Nothing is the target: a time names a moment, not a bookmark.
  expect(parsed.target).toBeUndefined();
});
