/**
 * Shared scaffolding for the CLI tests. Every test spawns the built CLI in a
 * temporary HOME and cache directory, so nothing here touches the real
 * ~/.cache/hatebucli or ~/.config/hatebu.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';

export const REPO_ROOT = process.cwd();
export const CLI_PATH = path.join(REPO_ROOT, 'dist', 'index.js');

export type BookmarkFixture = {
  title: string;
  link: string;
  date: string;
  description?: string;
  tags?: string[];
  categories?: string[];
};

export type Workspace = {
  rootDir: string;
  cacheBase: string;
  homeDir: string;
};

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function createTempWorkspace(): Workspace {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hatebucli-test-'));
  const cacheBase = path.join(rootDir, 'cache');
  const homeDir = path.join(rootDir, 'home');
  ensureDir(cacheBase);
  ensureDir(homeDir);
  return { rootDir, cacheBase, homeDir };
}

export function ymdPartsFromDate(date: Date): { year: string; month: string; day: string } {
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0'),
  };
}

export function ymdFromDate(date: Date): string {
  const parts = ymdPartsFromDate(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getDefaultWeeklyRangeLabels(): {
  start: Date;
  end: Date;
  startLabel: string;
  endLabel: string;
} {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 23, 59, 59, 999);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 8, 0, 0, 0, 0);
  return {
    start,
    end,
    startLabel: ymdFromDate(start),
    endLabel: ymdFromDate(end),
  };
}

/**
 * A timestamp at a given hour of a given day, in the timezone the test is
 * running in. The CLI buckets by local time, so a fixture written with a fixed
 * offset lands in a different hour, and sometimes a different day, depending
 * on where the test runs.
 */
export function localTimestamp(dateKey: string, hour: number, minute = 0): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const at = new Date(year, month - 1, day, hour, minute, 0, 0);
  const offsetMinutes = -at.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${dateKey}T${pad(hour)}:${pad(minute)}:00${offset}`;
}

export function dailyCachePath(cacheBase: string, dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  return path.join(cacheBase, 'hatebucli', year, month, `${day}.json`);
}

export function writeDailyCache(
  cacheBase: string,
  dateKey: string,
  bookmarks: BookmarkFixture[],
): void {
  const filePath = dailyCachePath(cacheBase, dateKey);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(bookmarks, null, 2), 'utf8');
}

export function readDailyCache(cacheBase: string, dateKey: string): BookmarkFixture[] {
  return JSON.parse(fs.readFileSync(dailyCachePath(cacheBase, dateKey), 'utf8'));
}

export type RunOptions = {
  /** Extra environment for the child, for example a stub RSS endpoint. */
  env?: Record<string, string>;
  /** Set to null to run with no HATENA_USER at all. */
  user?: string | null;
};

export function runCli(
  cacheBase: string,
  homeDir: string,
  args: string[],
  options: RunOptions = {},
): SpawnSyncReturns<string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    XDG_CACHE_HOME: cacheBase,
    HOME: homeDir,
    HATENA_USER: 'test-user',
    ...(options.env ?? {}),
  };
  if (options.user === null) {
    delete env.HATENA_USER;
  } else if (typeof options.user === 'string') {
    env.HATENA_USER = options.user;
  }

  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
  });
}

/**
 * A stand-in for b.hatena.ne.jp. `sync` and every `--today` path go through
 * `HATENA_BOOKMARK_RSS_URL`, so pointing that at a local server is what makes
 * the fetching paths testable without the network or an account.
 *
 * The server runs as its own process. The tests drive the CLI with spawnSync,
 * which blocks the event loop here, so a server in this process could never
 * answer the request the CLI is waiting on.
 */
export type StubRssServer = {
  urlTemplate: string;
  /** The `?date=YYYYMMDD` values the CLI has asked for so far, in order. */
  requestedDates(): string[];
  setBookmarks(dateParam: string, bookmarks: BookmarkFixture[]): void;
  close(): Promise<void>;
};

export async function startStubRssServer(): Promise<StubRssServer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hatebucli-rss-'));
  const script = path.join(REPO_ROOT, 'tests', 'stub-rss-server.mjs');
  const child = spawn(process.execPath, [script, dir], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the stub RSS server did not start')), 10_000);
    let buffered = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffered += chunk;
      const match = buffered.match(/^port (\d+)$/m);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  const requestsLog = path.join(dir, 'requests.log');

  return {
    urlTemplate: `http://127.0.0.1:${port}/%s/bookmark.rss`,
    requestedDates() {
      if (!fs.existsSync(requestsLog)) return [];
      return fs
        .readFileSync(requestsLog, 'utf8')
        .split('\n')
        .filter((line) => line.length > 0);
    },
    setBookmarks(dateParam, bookmarks) {
      fs.writeFileSync(path.join(dir, `${dateParam}.json`), JSON.stringify(bookmarks), 'utf8');
    },
    close() {
      return new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.kill();
      });
    },
  };
}

export function yyyymmdd(date: Date): string {
  const parts = ymdPartsFromDate(date);
  return `${parts.year}${parts.month}${parts.day}`;
}

/**
 * Speaks JSON-RPC to `hatebu --mcp-server` over a pipe, so the tests cover the
 * framing as well as the tools. One process per call batch: the server is
 * stateless, and a batch is cheaper than keeping one alive across tests.
 */
export type McpToolCall = { name: string; arguments?: Record<string, unknown> };

export type McpResponse = {
  id: number;
  result?: any;
  error?: { code: number; message: string };
};

export async function runMcp(
  workspace: Workspace,
  calls: McpToolCall[],
  options: RunOptions = {},
): Promise<{ initialize: any; tools: any[]; responses: McpResponse[]; stderr: string }> {
  const requests: string[] = [
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'hatebucli-test', version: '0' },
      },
    }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  ];
  calls.forEach((call, index) => {
    requests.push(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3 + index,
        method: 'tools/call',
        params: { name: call.name, arguments: call.arguments ?? {} },
      }),
    );
  });

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    XDG_CACHE_HOME: workspace.cacheBase,
    HOME: workspace.homeDir,
    HATENA_USER: 'test-user',
    ...(options.env ?? {}),
  };
  if (options.user === null) {
    delete env.HATENA_USER;
  } else if (typeof options.user === 'string') {
    env.HATENA_USER = options.user;
  }

  const result = spawnSync(process.execPath, [CLI_PATH, '--mcp-server'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
    input: `${requests.join('\n')}\n`,
    timeout: 60_000,
  });

  const messages: McpResponse[] = result.stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));

  return {
    initialize: messages.find((message) => message.id === 1)?.result,
    tools: messages.find((message) => message.id === 2)?.result?.tools ?? [],
    responses: messages.filter((message) => message.id >= 3),
    stderr: result.stderr,
  };
}

/** The first text block of a tool result, parsed as JSON. */
export function toolJson(response: McpResponse): any {
  return JSON.parse(response.result.content[0].text);
}

export function toolText(response: McpResponse): string {
  return response.result.content[0].text;
}
