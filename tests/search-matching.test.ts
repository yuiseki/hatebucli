/**
 * How a query is matched against each field.
 *
 * Titles are mostly Japanese and are matched a character at a time, because
 * Japanese does not put spaces between words. URLs are not: they are ASCII
 * with structure, and matching them per character turns a hostname into a set
 * of letters that any long URL is likely to contain.
 */
import { test, expect } from 'vitest';
import { createTempWorkspace, runCli, writeDailyCache, type Workspace } from './helpers';

function seed(ws: Workspace): void {
  writeDailyCache(ws.cacheBase, '2026-02-18', [
    {
      title: '論文を読む',
      link: 'https://arxiv.org/abs/2602.00001',
      date: '2026-02-18T09:00:00+09:00',
    },
    {
      title: 'もう一本',
      link: 'https://arxiv.org/abs/2602.00002',
      date: '2026-02-18T10:00:00+09:00',
    },
    {
      // Contains a, r, x, i, v, o and g, which is all it took before.
      title: '無関係な記事',
      link: 'https://dev.classmethod.jp/articles/dgx-spark-vision/',
      date: '2026-02-18T11:00:00+09:00',
    },
  ]);
}

test('a URL query matches the URL, not the letters in it', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, [
    'search', 'arxiv.org', '--field', 'url', '--json',
  ]);
  expect(result.status).toBe(0);

  const results = JSON.parse(result.stdout) as Array<{ link: string }>;
  expect(results).toHaveLength(2);
  for (const row of results) {
    expect(row.link).toContain('arxiv.org');
  }
});

test('field all still finds a Japanese title a character at a time', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['search', '論文', '--json']);
  expect(result.status).toBe(0);
  const results = JSON.parse(result.stdout) as Array<{ title: string }>;
  expect(results).toHaveLength(1);
  expect(results[0].title).toBe('論文を読む');
});

test('field all matches either the title or the URL', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const byUrl = runCli(ws.cacheBase, ws.homeDir, ['search', 'arxiv.org', '--json']);
  expect(JSON.parse(byUrl.stdout)).toHaveLength(2);

  const byTitle = runCli(ws.cacheBase, ws.homeDir, ['search', '無関係', '--json']);
  expect(JSON.parse(byTitle.stdout)).toHaveLength(1);
});

test('search says how many matched, not just how many it returned', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const text = runCli(ws.cacheBase, ws.homeDir, [
    'search', 'arxiv.org', '--field', 'url', '--limit', '1',
  ]);
  expect(text.status).toBe(0);
  expect(text.stdout).toContain('(showing 1 of 2)');
});
