/**
 * Reading the fields of a bookmark: the domain of its link, the tags it
 * carries, and the moment it was bookmarked. Cached days come from several
 * eras of this tool, so every reader here treats a missing or oddly shaped
 * field as absent rather than trusting the JSON.
 */

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function extractDomain(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch (_error) {
    try {
      const url = new URL(`https://${value}`);
      return url.hostname.replace(/^www\./, '').toLowerCase();
    } catch (_secondError) {
      return undefined;
    }
  }
}

export function normalizeTagText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) return undefined;
  const stripped = normalized.replace(/^[#＃]+/, '').trim();
  return stripped.length > 0 ? stripped : undefined;
}

/** Hatena writes tags into the comment as leading `[tag]` blocks. */
export function extractTagsFromDescription(description: unknown): string[] {
  if (typeof description !== 'string') return [];
  let cursor = description.normalize('NFKC');
  const tags: string[] = [];

  while (cursor.startsWith('[')) {
    const match = cursor.match(/^\[([^\[\]]+)\]/);
    if (!match) break;
    tags.push(match[1]);
    cursor = cursor.slice(match[0].length);
  }

  return tags;
}

export function extractBookmarkTags(bookmark: any): string[] {
  const rawTags: unknown[] = [];

  if (Array.isArray(bookmark?.tags)) {
    rawTags.push(...bookmark.tags);
  }
  if (Array.isArray(bookmark?.categories)) {
    rawTags.push(...bookmark.categories);
  }
  rawTags.push(...extractTagsFromDescription(bookmark?.description));

  const unique = new Map<string, string>();
  for (const rawTag of rawTags) {
    const tag = normalizeTagText(rawTag);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, tag);
    }
  }

  return Array.from(unique.values());
}

export function parseBookmarkTimestamp(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

/**
 * The Hatena Bookmark entry page for a bookmarked URL: where a person adds or
 * edits their own tags, and where everyone else's comments are.
 *
 * The shape is `/entry/s/<host><path>` for https and `/entry/<host><path>` for
 * http. Derived rather than fetched, so this works offline; the entry API
 * returns the same string as `entry_url` and a test checks a sample of real
 * bookmarks against it.
 */
export function hatenaEntryUrl(link: unknown): string | undefined {
  if (typeof link !== 'string' || link.trim().length === 0) return undefined;

  let url: URL;
  try {
    url = new URL(link.trim());
  } catch (_error) {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;

  const secure = url.protocol === 'https:' ? 's/' : '';
  return `https://b.hatena.ne.jp/entry/${secure}${url.host}${url.pathname}${url.search}`;
}
