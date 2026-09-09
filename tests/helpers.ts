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
