/**
 * `hatebu compare`: what changed between two stretches.
 *
 * Not the same question as ranking either one. A word can be common in both
 * and mean nothing about the difference; a word can be rare in both and be the
 * whole of it. The comparison is each window scored against the other.
 */
import { test, expect } from 'vitest';
import { createTempWorkspace, runCli, writeDailyCache, type Workspace } from './helpers';

function seed(ws: Workspace): void {
  // 2024 is about maps, 2026 is about agents, and both are full of GitHub.
  writeDailyCache(
    ws.cacheBase,
    '2024-05-02',
    Array.from({ length: 12 }, (_item, index) => ({
      title: index < 8 ? `地図の記事 ${index}` : `共通の記事 ${index}`,
      link: `https://github.com/maps/${index}`,
      date: '2024-05-02T09:00:00+09:00',
    })),
  );
  writeDailyCache(
    ws.cacheBase,
    '2026-05-02',
    Array.from({ length: 12 }, (_item, index) => ({
      title: index < 8 ? `エージェントの記事 ${index}` : `共通の記事 ${index}`,
      link: `https://github.com/agents/${index}`,
      date: '2026-05-02T09:00:00+09:00',
    })),
  );
}

test('compare names what each side had that the other did not', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const parsed = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['compare', '2024', '2026', '--json']).stdout,
  );

  expect(parsed.a.date).toBe('2024');
  expect(parsed.b.date).toBe('2026');

  const risen = parsed.risen.map((row: any) => row.word);
  const fallen = parsed.fallen.map((row: any) => row.word);
  expect(risen).toContain('エージェント');
  expect(fallen).toContain('地図');
  // A word both sides used the same amount is not what changed.
  expect(risen).not.toContain('記事');
  expect(fallen).not.toContain('記事');
});

test('compare counts both sides so the numbers can be read', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const parsed = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['compare', '2024', '2026', '--json']).stdout,
  );

  expect(parsed.a.bookmark_count).toBe(12);
  expect(parsed.b.bookmark_count).toBe(12);
  const agent = parsed.risen.find((row: any) => row.word === 'エージェント');
  expect(agent.a).toBe(0);
  expect(agent.b).toBe(8);
});

test('compare works on domains and tags too', () => {
  const ws = createTempWorkspace();
  writeDailyCache(ws.cacheBase, '2024-05-02', [
    { title: 'a', link: 'https://old.example/1', date: '2024-05-02T09:00:00+09:00', tags: ['昔'] },
    { title: 'b', link: 'https://old.example/2', date: '2024-05-02T10:00:00+09:00', tags: ['昔'] },
  ]);
  writeDailyCache(ws.cacheBase, '2026-05-02', [
    { title: 'c', link: 'https://new.example/1', date: '2026-05-02T09:00:00+09:00', tags: ['今'] },
    { title: 'd', link: 'https://new.example/2', date: '2026-05-02T10:00:00+09:00', tags: ['今'] },
  ]);

  const domains = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['compare', '2024', '2026', '--by', 'domains', '--json']).stdout,
  );
  expect(domains.risen.map((row: any) => row.word)).toContain('new.example');
  expect(domains.fallen.map((row: any) => row.word)).toContain('old.example');

  const tags = JSON.parse(
    runCli(ws.cacheBase, ws.homeDir, ['compare', '2024', '2026', '--by', 'tags', '--json']).stdout,
  );
  expect(tags.risen.map((row: any) => row.word)).toContain('今');
  expect(tags.fallen.map((row: any) => row.word)).toContain('昔');
});

test('compare refuses a dimension it does not have', () => {
  const ws = createTempWorkspace();
  const result = runCli(ws.cacheBase, ws.homeDir, ['compare', '2024', '2026', '--by', 'authors']);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/--by must be/);
});

test('compare reports an empty side rather than dividing by it', () => {
  const ws = createTempWorkspace();
  seed(ws);

  const result = runCli(ws.cacheBase, ws.homeDir, ['compare', '2024', '2019', '--json']);
  expect(result.status).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.b.bookmark_count).toBe(0);
  expect(parsed.risen).toEqual([]);
  expect(parsed.note).toMatch(/nothing/i);
});
