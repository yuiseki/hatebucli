import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const configSchema = z.object({
  HATENA_USER: z.string().optional(),
  HATENA_BOOKMARK_RSS_URL: z.string().optional().default('https://b.hatena.ne.jp/%s/bookmark.rss'),
});

export let config = configSchema.parse({
  HATENA_USER: process.env.HATENA_USER,
  HATENA_BOOKMARK_RSS_URL: process.env.HATENA_BOOKMARK_RSS_URL,
});

export function setHatenaUser(user: string) {
  config.HATENA_USER = user;
}

export function getRssUrl(user: string): string {
  return config.HATENA_BOOKMARK_RSS_URL.replace('%s', user);
}
