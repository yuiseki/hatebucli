/**
 * What a query means.
 *
 * A query is one or more terms separated by whitespace, and every term has to
 * appear as a substring. Japanese needs no special case: it does not put
 * spaces between words, so a substring search for 地図 finds 地図帳 and 白地図
 * on its own.
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
      title: '地図帳をめくる',
      link: 'https://example.com/atlas',
      date: '2026-02-18T10:00:00+09:00',
    },
    {
      // Contains a, r, x, i, v, o and g, which is all it took before.
      title: '無関係な記事',
      link: 'https://dev.classmethod.jp/articles/dgx-spark-vision/',
      date: '2026-02-18T11:00:00+09:00',
    },
    {
      // 地 and 図 are both here, but not together.
      title: '地理院の図解',
      link: 'https://example.com/gsi',
      date: '2026-02-18T12:00:00+09:00',
    },
    {
      title: '地図と生成AI',
      link: 'https://example.com/mapai',
      date: '2026-02-18T13:00:00+09:00',
    },
  ]);
}

function search(ws: Workspace, args: string[]): any[] {
  const result = runCli(ws.cacheBase, ws.homeDir, ['search', ...args, '--json']);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

test('a URL query matches the URL, not the letters in it', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const results = search(ws, ['arxiv.org', '--field', 'url']);
  expect(results).toHaveLength(1);
  expect(results[0].link).toContain('arxiv.org');
});

test('a Japanese term matches inside a word, and not scattered across one', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const titles = search(ws, ['地図']).map((row: any) => row.title);
  // 地図帳 and 地図と生成AI contain it; 地理院の図解 has the characters apart.
  expect(titles.sort()).toEqual(['地図と生成AI', '地図帳をめくる']);
});

test('whitespace separates terms, and every term has to appear', () => {
  const ws = createTempWorkspace();
  seed(ws);

  expect(search(ws, ['地図 AI']).map((row: any) => row.title)).toEqual(['地図と生成AI']);
  expect(search(ws, ['地図 みつからない'])).toEqual([]);
});

test('a term may match either field when the field is all', () => {
  const ws = createTempWorkspace();
  seed(ws);

  expect(search(ws, ['arxiv.org'])).toHaveLength(1);
  expect(search(ws, ['論文'])).toHaveLength(1);
  // One term in the title, one in the URL.
  expect(search(ws, ['論文 arxiv.org'])).toHaveLength(1);
});

test('a result says which field matched', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const [byTitle] = search(ws, ['地図帳']);
  expect(byTitle.matchedIn).toEqual(['title']);

  const [byUrl] = search(ws, ['arxiv.org']);
  expect(byUrl.matchedIn).toEqual(['url']);
});

test('search says how many matched, not just how many it returned', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const text = runCli(ws.cacheBase, ws.homeDir, ['search', '地図', '--limit', '1']);
  expect(text.status).toBe(0);
  expect(text.stdout).toContain('(showing 1 of 2)');
});

/**
 * Short alphabetic terms were the hole left by substring matching. `ai` found
 * mai, aichi, maplibre, flybrain and 因果推論: 44,678 bookmarks in the real
 * archive, twelve percent of it, against 6,585 that are about AI.
 */
function seedWords(ws: Workspace): void {
  writeDailyCache(ws.cacheBase, '2026-03-01', [
    { title: '生成AIの現在', link: 'https://example.com/1', date: '2026-03-01T09:00:00+09:00' },
    { title: 'AI-generated art', link: 'https://example.com/2', date: '2026-03-01T10:00:00+09:00' },
    { title: '愛知県の話', link: 'https://example.com/aichi', date: '2026-03-01T11:00:00+09:00' },
    { title: 'Jimmy Lai の半生', link: 'https://example.com/lai', date: '2026-03-01T12:00:00+09:00' },
    { title: 'maplibre-tile-spec', link: 'https://example.com/maplibre', date: '2026-03-01T13:00:00+09:00' },
    { title: 'KDDI地図サイト', link: 'https://example.com/kddi', date: '2026-03-01T14:00:00+09:00' },
    { title: '地図帳をめくる', link: 'https://example.com/atlas2', date: '2026-03-01T15:00:00+09:00' },
    { title: 'tile_spec の話', link: 'https://example.com/tile', date: '2026-03-01T16:00:00+09:00' },
  ]);
}

test('an alphabetic term matches whole words, not the letters inside them', () => {
  const ws = createTempWorkspace();
  seedWords(ws);

  const titles = search(ws, ['ai']).map((row: any) => row.title);
  expect(titles.sort()).toEqual(['AI-generated art', '生成AIの現在']);
});

test('a term next to Japanese is still a word', () => {
  const ws = createTempWorkspace();
  seedWords(ws);

  // 生成AIの現在: neither 成 nor の is a letter, so AI stands alone there.
  expect(search(ws, ['ai']).map((row: any) => row.title)).toContain('生成AIの現在');
});

test('an underscore separates words, the way a hyphen does', () => {
  const ws = createTempWorkspace();
  seedWords(ws);

  expect(search(ws, ['spec']).map((row: any) => row.title).sort()).toEqual([
    'maplibre-tile-spec',
    'tile_spec の話',
  ]);
});

test('a Japanese term is matched inside words, as before', () => {
  const ws = createTempWorkspace();
  seedWords(ws);

  // 地図 has no word boundaries to speak of, and KDDI地図 is a hit even though
  // the character before it is a letter.
  expect(search(ws, ['地図']).map((row: any) => row.title).sort()).toEqual([
    'KDDI地図サイト',
    '地図帳をめくる',
  ]);
});

test('a term that is not plain letters and digits stays a substring', () => {
  const ws = createTempWorkspace();
  writeDailyCache(ws.cacheBase, '2026-03-02', [
    { title: '論文', link: 'https://arxiv.org/abs/1', date: '2026-03-02T09:00:00+09:00' },
    { title: '別の論文', link: 'https://eartharxiv.org/abs/2', date: '2026-03-02T10:00:00+09:00' },
  ]);

  // arxiv.org has a dot in it, so it is matched as written.
  expect(search(ws, ['arxiv.org']).map((row: any) => row.link).sort()).toEqual([
    'https://arxiv.org/abs/1',
    'https://eartharxiv.org/abs/2',
  ]);
});

test('--match substring asks for the letters wherever they fall', () => {
  const ws = createTempWorkspace();
  seedWords(ws);

  const loose = search(ws, ['ai', '--match', 'substring']).map((row: any) => row.title);
  expect(loose).toContain('愛知県の話');
  expect(loose).toContain('Jimmy Lai の半生');
  expect(loose.length).toBeGreaterThan(2);
});

test('--match rejects a mode it does not have', () => {
  const ws = createTempWorkspace();
  const result = runCli(ws.cacheBase, ws.homeDir, ['search', 'ai', '--match', 'fuzzy']);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/--match must be/);
});
