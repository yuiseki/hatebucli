/**
 * The MCP server, driven over a pipe with JSON-RPC, against a cache the test
 * writes. Nothing here reaches Hatena.
 */
import { test, expect } from 'vitest';
import {
  createTempWorkspace,
  runCli,
  runMcp,
  toolJson,
  toolText,
  writeDailyCache,
  type Workspace,
} from './helpers';

function seedArchive(ws: Workspace): void {
  writeDailyCache(ws.cacheBase, '2019-07-04', [
    {
      title: '昔の地図の記事',
      link: 'https://legacy.example/maps',
      date: '2019-07-04T09:00:00+09:00',
    },
  ]);
  writeDailyCache(ws.cacheBase, '2026-02-18', [
    {
      title: '地図を描く技術',
      link: 'https://zenn.dev/articles/maps',
      date: '2026-02-18T09:00:00+09:00',
      tags: ['地図', 'GIS'],
    },
    {
      title: '生成AIの現在',
      link: 'https://zenn.dev/articles/ai',
      date: '2026-02-18T22:00:00+09:00',
      tags: ['AI'],
    },
  ]);
  writeDailyCache(ws.cacheBase, '2026-02-19', [
    {
      title: '地図と生成AI',
      link: 'https://news.example.net/mapai',
      date: '2026-02-19T07:00:00+09:00',
      tags: ['AI'],
    },
  ]);
}

test('the server introduces itself and lists read-only tools', async () => {
  const ws = createTempWorkspace();
  const { initialize, tools, stderr } = await runMcp(ws, []);

  expect(initialize.serverInfo.name).toBe('hatebucli');
  expect(initialize.serverInfo.version).toBe(require('../package.json').version);
  expect(tools.map((tool: any) => tool.name).sort()).toEqual([
    'hatebu_domains',
    'hatebu_list',
    'hatebu_lookup',
    'hatebu_random',
    'hatebu_search',
    'hatebu_stats',
    'hatebu_tagged',
    'hatebu_tags',
    'hatebu_timeline',
    'hatebu_words',
  ]);
  for (const tool of tools) {
    expect(tool.annotations?.readOnlyHint).toBe(true);
  }
  expect(stderr).toContain('hatebu MCP server ready on stdio.');
});

test('the server refuses to start without a username', async () => {
  const ws = createTempWorkspace();
  const { tools, stderr } = await runMcp(ws, [], { user: null });

  expect(tools).toEqual([]);
  expect(stderr).toContain('Hatena Username is not set.');
  expect(stderr).toContain('hatebu config set username');
});

test('hatebu_search answers over the whole archive, newest first', async () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const { responses } = await runMcp(ws, [{ name: 'hatebu_search', arguments: { query: '地図' } }]);
  const payload = toolJson(responses[0]);

  expect(payload.result_count).toBe(3);
  expect(payload.results.map((row: any) => row.dateKey)).toEqual([
    '2026-02-19',
    '2026-02-18',
    '2019-07-04',
  ]);
  // The index is per character, so the matched tokens would be single letters.
  expect(payload.results[0]).not.toHaveProperty('matchedTitleTokens');
  expect(payload.results[0].link).toBe('https://news.example.net/mapai');
});

test('hatebu_search honours field, date and limit', async () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const { responses } = await runMcp(ws, [
    { name: 'hatebu_search', arguments: { query: 'zenn.dev', field: 'url' } },
    { name: 'hatebu_search', arguments: { query: '地図', date: '2019-07-04' } },
    { name: 'hatebu_search', arguments: { query: '地図', limit: 1 } },
  ]);

  expect(toolJson(responses[0]).result_count).toBe(2);
  const onOneDay = toolJson(responses[1]);
  expect(onOneDay.date).toBe('2019-07-04');
  expect(onOneDay.result_count).toBe(1);
  expect(toolJson(responses[2]).result_count).toBe(1);
});

test('hatebu_list tells a synced empty day from a day never synced', async () => {
  const ws = createTempWorkspace();
  seedArchive(ws);
  writeDailyCache(ws.cacheBase, '2026-02-20', []);

  const { responses } = await runMcp(ws, [
    { name: 'hatebu_list', arguments: { date: '2026-02-18' } },
    { name: 'hatebu_list', arguments: { date: '2026-02-20' } },
    { name: 'hatebu_list', arguments: { date: '2026-02-21' } },
  ]);

  const day = toolJson(responses[0]);
  expect(day.bookmark_count).toBe(2);
  expect(day.bookmarks[0].title).toBe('地図を描く技術');

  const emptyButSynced = toolJson(responses[1]);
  expect(emptyButSynced.cached).toBe(true);
  expect(emptyButSynced.bookmark_count).toBe(0);

  const neverSynced = toolJson(responses[2]);
  expect(neverSynced.cached).toBe(false);
  expect(neverSynced.note).toContain('has not been synced');
});

test('the ranking tools answer the same numbers as their commands', async () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const { responses } = await runMcp(ws, [
    { name: 'hatebu_domains', arguments: { date: '2026-02' } },
    { name: 'hatebu_tags', arguments: { date: '2026-02' } },
    { name: 'hatebu_words', arguments: { date: '2026-02' } },
  ]);

  for (const [index, args] of [
    ['domains', ['domains', '--date', '2026-02', '--json', '--limit', '10']],
    ['tags', ['tags', '--date', '2026-02', '--json', '--limit', '10']],
    ['words', ['words', '--date', '2026-02', '--json', '--limit', '30']],
  ].entries()) {
    const fromCli = JSON.parse(runCli(ws.cacheBase, ws.homeDir, args[1] as string[]).stdout);
    expect(toolJson(responses[index])).toEqual(fromCli);
  }
});

test('hatebu_stats returns the markdown and the same numbers as JSON', async () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const { responses } = await runMcp(ws, [
    { name: 'hatebu_stats', arguments: { date: '2026-02-19', days: 2, top: 5 } },
  ]);

  const markdown = toolText(responses[0]);
  expect(markdown).toMatch(/## Hatebu Stats/);
  expect(markdown).toMatch(/Window: 2026-02-18 to 2026-02-19 \(2 days\)/);
  expect(markdown).toContain('- zenn.dev: 2');

  const numbers = JSON.parse(responses[0].result.content[1].text);
  expect(numbers.start).toBe('2026-02-18');
  expect(numbers.end).toBe('2026-02-19');
  expect(numbers.bookmark_count).toBe(3);
  expect(numbers.domain_ranking[0]).toEqual({ domain: 'zenn.dev', count: 2 });
  expect(numbers.weekday_ranking.every((row: any) => row.count > 0)).toBe(true);
});

test('a bad argument is an error on the call, not a dead server', async () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const { responses } = await runMcp(ws, [
    { name: 'hatebu_list', arguments: { date: '2026-13-01' } },
    { name: 'hatebu_domains', arguments: { date: 'last-week' } },
    { name: 'hatebu_domains', arguments: { date: '2026-02', today: true } },
    // The server has to still be answering after all of those.
    { name: 'hatebu_search', arguments: { query: '地図' } },
  ]);

  expect(responses[0].result.isError).toBe(true);
  expect(toolText(responses[0])).toContain('date must be a valid yyyy-mm-dd');
  expect(responses[1].result.isError).toBe(true);
  expect(toolText(responses[1])).toContain('date format must be yyyy or yyyy-mm or yyyy-mm-dd');
  expect(responses[2].result.isError).toBe(true);
  expect(toolText(responses[2])).toContain('today and date cannot be used together');
  expect(responses[3].result.isError).toBeFalsy();
  expect(toolJson(responses[3]).result_count).toBe(3);
});

test('missing_dates says which days of the range were never synced', async () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const { responses } = await runMcp(ws, [
    { name: 'hatebu_domains', arguments: { date: '2026-02' } },
  ]);

  const payload = toolJson(responses[0]);
  expect(payload.bookmark_count).toBe(3);
  expect(payload.missing_dates).toHaveLength(26);
  expect(payload.missing_dates).toContain('2026-02-01');
  expect(payload.missing_dates).not.toContain('2026-02-18');
});

test('the archive tools answer the same as their commands', async () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const { responses } = await runMcp(ws, [
    { name: 'hatebu_lookup', arguments: { url_or_domain: 'zenn.dev' } },
    { name: 'hatebu_timeline', arguments: { by: 'year', query: '地図' } },
    { name: 'hatebu_tagged', arguments: { tag: 'AI' } },
  ]);

  const lookedUp = toolJson(responses[0]);
  expect(lookedUp.kind).toBe('domain');
  expect(lookedUp.match_count).toBe(2);
  expect(lookedUp.first_bookmarked).toBe('2026-02-18');

  const timeline = toolJson(responses[1]);
  expect(timeline.total).toBe(3);
  expect(timeline.rows).toEqual([
    { period: '2019', count: 1 },
    { period: '2026', count: 2 },
  ]);

  const tagged = toolJson(responses[2]);
  expect(tagged.match_count).toBe(2);
  expect(tagged.bookmarks[0].dateKey).toBe('2026-02-19');
});

test('hatebu_lookup reports a page that is not in the archive', async () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const { responses } = await runMcp(ws, [
    { name: 'hatebu_lookup', arguments: { url_or_domain: 'https://zenn.dev/articles/never' } },
  ]);

  const payload = toolJson(responses[0]);
  expect(payload.kind).toBe('url');
  expect(payload.bookmarked).toBe(false);
  expect(payload.same_domain_count).toBe(2);
});

test('a whole-archive tool rejects a bound it cannot read', async () => {
  const ws = createTempWorkspace();
  seedArchive(ws);

  const { responses } = await runMcp(ws, [
    { name: 'hatebu_timeline', arguments: { from: 'January' } },
  ]);

  expect(responses[0].result.isError).toBe(true);
  expect(toolText(responses[0])).toContain('is not a day');
});
