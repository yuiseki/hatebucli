import fs from 'fs';
import path from 'path';
import type { BookmarkItem } from './api';
import { getCacheDir } from './storage';

export type SearchField = 'all' | 'title' | 'url';

export interface SearchOptions {
  dateKey?: string;
  field?: SearchField;
  limit?: number;
}

export interface SearchResult {
  dateKey: string;
  title: string;
  link: string;
  date: string;
  description: string;
  score: number;
  matchedTitleTokens: string[];
  matchedUrlTokens: string[];
}

type IndexedDocument = {
  id: number;
  title: string;
  link: string;
  date: string;
  description: string;
};

type PostingMap = Record<string, number[]>;

type DayIndexFile = {
  version: number;
  date: string;
  sourceMtimeMs: number;
  sourceSize: number;
  documents: IndexedDocument[];
  fields: {
    title: PostingMap;
    url: PostingMap;
  };
};

type JsonObject = Record<string, unknown>;

type MatchAccumulator = {
  titleTokens: Set<string>;
  urlTokens: Set<string>;
};

const INDEX_VERSION = 1;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_PATTERN = /^\d{4}$/;
const MONTH_PATTERN = /^\d{2}$/;
const DAY_FILE_PATTERN = /^\d{2}\.json$/;
const SYMBOL_OR_PUNCT_CHAR = /[\p{P}\p{S}]/u;

export function isDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const probe = new Date(year, month - 1, day);
  return probe.getFullYear() === year &&
    probe.getMonth() === month - 1 &&
    probe.getDate() === day;
}

export function listCachedDateKeys(): string[] {
  const cacheDir = getCacheDir();
  if (!fs.existsSync(cacheDir)) return [];

  const dateKeys: string[] = [];
  const years = fs.readdirSync(cacheDir).filter(name => YEAR_PATTERN.test(name));

  for (const year of years) {
    const yearPath = path.join(cacheDir, year);
    if (!fs.statSync(yearPath).isDirectory()) continue;

    const months = fs.readdirSync(yearPath).filter(name => MONTH_PATTERN.test(name));
    for (const month of months) {
      const monthPath = path.join(yearPath, month);
      if (!fs.statSync(monthPath).isDirectory()) continue;

      const dayFiles = fs.readdirSync(monthPath).filter(name => DAY_FILE_PATTERN.test(name));
      for (const dayFile of dayFiles) {
        const day = dayFile.replace('.json', '');
        const dateKey = `${year}-${month}-${day}`;
        if (isDateKey(dateKey)) {
          dateKeys.push(dateKey);
        }
      }
    }
  }

  dateKeys.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return dateKeys;
}

export function searchBookmarks(query: string, options: SearchOptions = {}): SearchResult[] {
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery.trim().length === 0) return [];

  const field = options.field || 'all';
  const limit = options.limit && options.limit > 0 ? options.limit : 10;
  const queryTokens = tokenizeUnigram(query);
  if (queryTokens.length === 0) return [];

  const dateKeys = options.dateKey ? [options.dateKey] : listCachedDateKeys();
  const allResults: SearchResult[] = [];

  for (const dateKey of dateKeys) {
    if (!isDateKey(dateKey)) continue;
    const dayIndex = ensureDayIndex(dateKey);
    if (!dayIndex) continue;
    const dayResults = searchInDayIndex(dayIndex, query, queryTokens, field);
    allResults.push(...dayResults);
  }

  allResults.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? 1 : -1;
    return a.title.localeCompare(b.title, 'ja');
  });

  return allResults.slice(0, limit);
}

function searchInDayIndex(
  dayIndex: DayIndexFile,
  query: string,
  queryTokens: string[],
  field: SearchField,
): SearchResult[] {
  const matchedByDocId = new Map<number, MatchAccumulator>();

  for (const token of queryTokens) {
    const titleDocIds = dayIndex.fields.title[token] || [];
    const urlDocIds = dayIndex.fields.url[token] || [];

    for (const docId of titleDocIds) {
      const current = matchedByDocId.get(docId) || {
        titleTokens: new Set<string>(),
        urlTokens: new Set<string>(),
      };
      current.titleTokens.add(token);
      matchedByDocId.set(docId, current);
    }

    for (const docId of urlDocIds) {
      const current = matchedByDocId.get(docId) || {
        titleTokens: new Set<string>(),
        urlTokens: new Set<string>(),
      };
      current.urlTokens.add(token);
      matchedByDocId.set(docId, current);
    }
  }

  const normalizedQuery = normalizeForContains(query);
  const results: SearchResult[] = [];

  for (const [docId, matched] of matchedByDocId.entries()) {
    const doc = dayIndex.documents[docId];
    if (!doc) continue;

    const matchedTitleCount = matched.titleTokens.size;
    const matchedUrlCount = matched.urlTokens.size;
    const matchedAllCount = new Set<string>([
      ...matched.titleTokens,
      ...matched.urlTokens,
    ]).size;

    const matchAllTokens = field === 'title'
      ? matchedTitleCount === queryTokens.length
      : field === 'url'
        ? matchedUrlCount === queryTokens.length
        : matchedAllCount === queryTokens.length;
    if (!matchAllTokens) continue;

    let score = matchedTitleCount * 2 + matchedUrlCount;
    if (normalizedQuery.length > 0) {
      const normalizedTitle = normalizeForContains(doc.title);
      const normalizedUrl = normalizeForContains(doc.link);
      if ((field === 'all' || field === 'title') && normalizedTitle.includes(normalizedQuery)) {
        score += 4;
      }
      if ((field === 'all' || field === 'url') && normalizedUrl.includes(normalizedQuery)) {
        score += 2;
      }
    }

    results.push({
      dateKey: dayIndex.date,
      title: doc.title,
      link: doc.link,
      date: doc.date,
      description: doc.description,
      score,
      matchedTitleTokens: Array.from(matched.titleTokens).sort(),
      matchedUrlTokens: Array.from(matched.urlTokens).sort(),
    });
  }

  return results;
}

function ensureDayIndex(dateKey: string): DayIndexFile | null {
  const cachePath = getCachePathByDateKey(dateKey);
  if (!fs.existsSync(cachePath)) return null;

  const sourceStat = fs.statSync(cachePath);
  const sourceMtimeMs = Math.trunc(sourceStat.mtimeMs);
  const sourceSize = sourceStat.size;

  const fresh = loadFreshDayIndex(dateKey, sourceMtimeMs, sourceSize);
  if (fresh) return fresh;

  const bookmarks = loadBookmarksByDateKey(dateKey);
  if (!bookmarks) return null;

  const built = buildDayIndex(dateKey, sourceMtimeMs, sourceSize, bookmarks);
  saveDayIndex(dateKey, built);
  return built;
}

function getCachePathByDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  return path.join(getCacheDir(), year, month, `${day}.json`);
}

function getIndexRootDir(): string {
  return path.join(getCacheDir(), 'index', 'v1');
}

function getIndexPathByDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  return path.join(getIndexRootDir(), year, month, `${day}.json`);
}

function loadFreshDayIndex(dateKey: string, sourceMtimeMs: number, sourceSize: number): DayIndexFile | null {
  const indexPath = getIndexPathByDateKey(dateKey);
  const parsed = readJsonFile(indexPath);
  const asObject = toObject(parsed);
  if (!asObject) return null;

  if (asObject.version !== INDEX_VERSION) return null;
  if (asObject.date !== dateKey) return null;
  if (asObject.sourceMtimeMs !== sourceMtimeMs) return null;
  if (asObject.sourceSize !== sourceSize) return null;

  const documents = parseDocuments(asObject.documents);
  const fields = parseFields(asObject.fields);
  if (!documents || !fields) return null;

  return {
    version: INDEX_VERSION,
    date: dateKey,
    sourceMtimeMs,
    sourceSize,
    documents,
    fields,
  };
}

function parseDocuments(value: unknown): IndexedDocument[] | null {
  if (!Array.isArray(value)) return null;
  const docs: IndexedDocument[] = [];

  for (const rawItem of value) {
    const item = toObject(rawItem);
    if (!item) return null;

    const id = item.id;
    const title = item.title;
    const link = item.link;
    const date = item.date;
    const description = item.description;

    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) return null;
    if (typeof title !== 'string') return null;
    if (typeof link !== 'string') return null;
    if (typeof date !== 'string') return null;
    if (typeof description !== 'string') return null;

    docs.push({
      id,
      title,
      link,
      date,
      description,
    });
  }

  return docs;
}

function parseFields(value: unknown): DayIndexFile['fields'] | null {
  const asObject = toObject(value);
  if (!asObject) return null;

  const titlePosting = parsePostingMap(asObject.title);
  const urlPosting = parsePostingMap(asObject.url);
  if (!titlePosting || !urlPosting) return null;

  return {
    title: titlePosting,
    url: urlPosting,
  };
}

function parsePostingMap(value: unknown): PostingMap | null {
  const asObject = toObject(value);
  if (!asObject) return null;

  const postingMap: PostingMap = {};
  for (const [token, rawDocIds] of Object.entries(asObject)) {
    if (!Array.isArray(rawDocIds)) return null;
    const docIds: number[] = [];
    for (const rawDocId of rawDocIds) {
      if (!Number.isInteger(rawDocId) || rawDocId < 0) return null;
      docIds.push(rawDocId);
    }
    postingMap[token] = docIds;
  }
  return postingMap;
}

function loadBookmarksByDateKey(dateKey: string): BookmarkItem[] | null {
  const cachePath = getCachePathByDateKey(dateKey);
  const parsed = readJsonFile(cachePath);
  if (!Array.isArray(parsed)) return null;

  const bookmarks: BookmarkItem[] = [];
  for (const rawItem of parsed) {
    const item = toObject(rawItem);
    if (!item) continue;
    bookmarks.push({
      title: typeof item.title === 'string' ? item.title : '',
      link: typeof item.link === 'string' ? item.link : '',
      date: typeof item.date === 'string' ? item.date : '',
      description: typeof item.description === 'string' ? item.description : '',
    });
  }
  return bookmarks;
}

function buildDayIndex(
  dateKey: string,
  sourceMtimeMs: number,
  sourceSize: number,
  bookmarks: BookmarkItem[],
): DayIndexFile {
  const titlePosting: PostingMap = {};
  const urlPosting: PostingMap = {};
  const documents: IndexedDocument[] = [];

  bookmarks.forEach((bookmark, index) => {
    const title = bookmark.title || '';
    const link = bookmark.link || '';
    const date = bookmark.date || `${dateKey}T00:00:00Z`;
    const description = bookmark.description || '';

    documents.push({
      id: index,
      title,
      link,
      date,
      description,
    });

    const titleTokens = tokenizeUnigram(title);
    const urlTokens = tokenizeUnigram(link);
    for (const token of titleTokens) {
      addPosting(titlePosting, token, index);
    }
    for (const token of urlTokens) {
      addPosting(urlPosting, token, index);
    }
  });

  return {
    version: INDEX_VERSION,
    date: dateKey,
    sourceMtimeMs,
    sourceSize,
    documents,
    fields: {
      title: titlePosting,
      url: urlPosting,
    },
  };
}

function addPosting(postingMap: PostingMap, token: string, docId: number): void {
  if (!postingMap[token]) postingMap[token] = [];
  postingMap[token].push(docId);
}

function saveDayIndex(dateKey: string, index: DayIndexFile): void {
  const indexPath = getIndexPathByDateKey(dateKey);
  const indexDir = path.dirname(indexPath);
  if (!fs.existsSync(indexDir)) {
    fs.mkdirSync(indexDir, { recursive: true });
  }
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

function tokenizeUnigram(value: string): string[] {
  const tokens = new Set<string>();
  const normalized = normalizeText(value);
  for (const char of normalized) {
    if (shouldSkipChar(char)) continue;
    tokens.add(char);
  }
  return Array.from(tokens);
}

function normalizeForContains(value: string): string {
  const normalized = normalizeText(value);
  let compact = '';
  for (const char of normalized) {
    if (shouldSkipChar(char)) continue;
    compact += char;
  }
  return compact;
}

function shouldSkipChar(char: string): boolean {
  if (char.trim().length === 0) return true;
  return SYMBOL_OR_PUNCT_CHAR.test(char);
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function readJsonFile(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
  } catch (_error) {
    return null;
  }
}

function toObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonObject;
}
