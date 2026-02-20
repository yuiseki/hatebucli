import Parser from 'rss-parser';
import { getRssUrl } from './config';

export interface BookmarkItem {
  title: string;
  link: string;
  date: string;
  description?: string;
}

export async function fetchBookmarksByDate(user: string, date: Date): Promise<BookmarkItem[]> {
  const parser = new Parser();
  const dateStr = date.getFullYear().toString() + 
                  (date.getMonth() + 1).toString().padStart(2, '0') + 
                  date.getDate().toString().padStart(2, '0');
  
  const url = `${getRssUrl(user)}?date=${dateStr}`;
  // console.info(`Fetching: ${url}`);
  
  try {
    const feed = await parser.parseURL(url);
    return feed.items.map(item => ({
      title: item.title || '',
      link: item.link || '',
      date: item.isoDate || item.dcDate || '',
      description: item.contentSnippet || item.description || '',
    }));
  } catch (error) {
    console.error(`Failed to fetch bookmarks for ${dateStr}:`, error);
    return [];
  }
}
