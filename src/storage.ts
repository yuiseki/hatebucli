import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Where the cached days live.
 *
 * Reading never creates anything. Only `sync` and `import` write, and they are
 * the only callers that ask for the directories to be made: the MCP server is
 * read-only and is meant to run in a sandbox whose home is mounted read-only,
 * where an mkdir on the way to a file that is not there fails the whole call.
 */
export function getCacheDir(options: { create?: boolean } = {}): string {
  const cacheBase = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  const dir = path.join(cacheBase, 'hatebucli');
  if (options.create && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getCachePath(date: Date, options: { create?: boolean } = {}): string {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');

  const dir = path.join(getCacheDir(options), year, month);
  if (options.create && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return path.join(dir, `${day}.json`);
}

export function saveCache(date: Date, data: any): void {
  const filePath = getCachePath(date, { create: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function loadCache(date: Date): any | null {
  const filePath = getCachePath(date);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_error) {
    // A half-written day should not take a whole range down.
    return null;
  }
}
