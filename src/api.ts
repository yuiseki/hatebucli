import Parser from 'rss-parser';
import { getRssUrl } from './config';

export interface BookmarkItem {
  title: string;
  link: string;
  date: string;
  description?: string;
  tags?: string[];
}

export async function fetchBookmarksByDate(user: string, date: Date): Promise<BookmarkItem[]> {
  const parser = new Parser({
    customFields: {
      item: [
        ['dc:subject', 'subjects', { keepArray: true }],
      ],
    },
  });
  const dateStr = date.getFullYear().toString() + 
                  (date.getMonth() + 1).toString().padStart(2, '0') + 
                  date.getDate().toString().padStart(2, '0');
  
  const url = `${getRssUrl(user)}?date=${dateStr}`;
  // console.info(`Fetching: ${url}`);
  
  try {
    const feed = await parser.parseURL(url);
    return feed.items.map(item => {
      const anyItem = item as any;
      const subjectTags = Array.isArray(anyItem.subjects)
        ? anyItem.subjects
        : typeof anyItem.subjects === 'string'
          ? [anyItem.subjects]
          : [];
      const categoryTags = Array.isArray(anyItem.categories) ? anyItem.categories : [];

      const uniqueTags = new Map<string, string>();
      for (const rawTag of [...subjectTags, ...categoryTags]) {
        const tag = String(rawTag).normalize('NFKC').trim();
        if (tag.length === 0) continue;
        const key = tag.toLowerCase();
        if (!uniqueTags.has(key)) {
          uniqueTags.set(key, tag);
        }
      }

      return {
        title: anyItem.title || '',
        link: anyItem.link || '',
        date: anyItem.isoDate || anyItem.dcDate || '',
        description: anyItem.contentSnippet || anyItem.description || '',
        tags: Array.from(uniqueTags.values()),
      };
    });
  } catch (error) {
    console.error(`Failed to fetch bookmarks for ${dateStr}:`, error);
    return [];
  }
}
