#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { fetchBookmarksByDate } from './api';
import { saveCache, loadCache, getCacheDir } from './storage';
import { ensureHatenaUser, getStoredConfig, setStoredConfig } from './credentials';
import { isDateKey, searchBookmarks, type SearchField } from './searchIndex';

const program = new Command();

program
  .name('hatebu')
  .description('Hatena Bookmark CLI for AI Secretary')
  .version('1.0.0');

// Config Command
const configCmd = program.command('config').description('Manage configuration');

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action((key, value) => {
    setStoredConfig(key, value);
  });

configCmd
  .command('get <key>')
  .description('Get a configuration value')
  .action((key) => {
    const value = getStoredConfig(key);
    if (value) {
      if (key === 'token') {
        const masked = value.length > 8 
          ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}`
          : '********';
        console.log(masked);
      } else {
        console.log(value);
      }
    } else {
      console.error(`Config key '${key}' not found.`);
      process.exit(1);
    }
  });

function isToday(date: Date): boolean {
  const today = new Date();
  return date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
}

function parsePositiveIntegerOption(value: string, optionName: string): number {
  if (!/^\d+$/.test(value)) {
    console.error(`Error: ${optionName} must be a positive integer.`);
    process.exit(1);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    console.error(`Error: ${optionName} must be a positive integer.`);
    process.exit(1);
  }
  return parsed;
}

function parseSearchField(value: string): SearchField {
  if (value === 'all' || value === 'title' || value === 'url') {
    return value;
  }
  console.error('Error: --field must be one of "all", "title", or "url".');
  process.exit(1);
}

type ParsedDateOption = {
  granularity: 'day' | 'month' | 'year';
  dateKey: string;
  start: Date;
  end: Date;
};

type DomainRank = {
  domain: string;
  count: number;
};

type DomainsSummary = {
  range: ParsedDateOption;
  bookmarkCount: number;
  bookmarkCountWithDomain: number;
  ranking: DomainRank[];
  missingDates: string[];
};

function parseDateOption(value?: string): ParsedDateOption {
  if (!value) {
    const today = new Date();
    const year = String(today.getFullYear());
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return {
      granularity: 'day',
      dateKey: `${year}-${month}-${day}`,
      start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0),
      end: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999),
    };
  }

  if (/^\d{4}$/.test(value)) {
    const year = Number(value);
    return {
      granularity: 'year',
      dateKey: value,
      start: new Date(year, 0, 1, 0, 0, 0, 0),
      end: new Date(year, 11, 31, 23, 59, 59, 999),
    };
  }

  if (/^\d{4}-\d{2}$/.test(value)) {
    const [yearText, monthText] = value.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const probe = new Date(year, month - 1, 1);
    if (probe.getFullYear() !== year || probe.getMonth() !== month - 1) {
      console.error('Error: --date month is invalid.');
      process.exit(1);
    }
    return {
      granularity: 'month',
      dateKey: value,
      start: new Date(year, month - 1, 1, 0, 0, 0, 0),
      end: new Date(year, month, 0, 23, 59, 59, 999),
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [yearText, monthText, dayText] = value.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const probe = new Date(year, month - 1, day);
    if (
      probe.getFullYear() !== year ||
      probe.getMonth() !== month - 1 ||
      probe.getDate() !== day
    ) {
      console.error('Error: --date day is invalid.');
      process.exit(1);
    }
    return {
      granularity: 'day',
      dateKey: value,
      start: new Date(year, month - 1, day, 0, 0, 0, 0),
      end: new Date(year, month - 1, day, 23, 59, 59, 999),
    };
  }

  console.error('Error: --date format must be yyyy or yyyy-mm or yyyy-mm-dd.');
  process.exit(1);
}

function formatDateYmd(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildRecentWeekRangeUntilYesterday(): ParsedDateOption {
  const today = new Date();
  const end = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1,
    23,
    59,
    59,
    999,
  );
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 8,
    0,
    0,
    0,
    0,
  );

  return {
    granularity: 'day',
    dateKey: `${formatDateYmd(start)}..${formatDateYmd(end)}`,
    start,
    end,
  };
}

function resolveDomainsRangeOption(options: { date?: string; today?: boolean }): ParsedDateOption {
  if (options.today && options.date) {
    console.error('Error: --today and --date cannot be used together.');
    process.exit(1);
  }
  if (options.today) {
    return parseDateOption();
  }
  if (options.date) {
    return parseDateOption(options.date);
  }
  return buildRecentWeekRangeUntilYesterday();
}

function getDateListInRange(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0);

  while (cursor.getTime() <= last.getTime()) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function extractDomain(value?: string): string | undefined {
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

async function buildDomainsSummary(range: ParsedDateOption): Promise<DomainsSummary> {
  const dateList = getDateListInRange(range.start, range.end);
  const missingDates: string[] = [];
  const counts = new Map<string, number>();
  let bookmarkCount = 0;
  let bookmarkCountWithDomain = 0;
  let user: string | null = null;

  for (const date of dateList) {
    let bookmarks: any[] | null = null;
    if (isToday(date)) {
      if (!user) {
        user = await ensureHatenaUser();
      }
      bookmarks = await fetchBookmarksByDate(user, date);
    } else {
      bookmarks = loadCache(date);
      if (!bookmarks) {
        missingDates.push(formatDateYmd(date));
        continue;
      }
    }

    for (const bookmark of bookmarks) {
      bookmarkCount += 1;
      const domain = extractDomain(bookmark?.link);
      if (!domain) continue;
      bookmarkCountWithDomain += 1;
      counts.set(domain, (counts.get(domain) || 0) + 1);
    }
  }

  const ranking: DomainRank[] = Array.from(counts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.domain.localeCompare(b.domain);
    });

  return {
    range,
    bookmarkCount,
    bookmarkCountWithDomain,
    ranking,
    missingDates,
  };
}

program
  .command('list')
  .alias('ls')
  .description('List bookmarks for a specific date')
  .option('-d, --date <yyyy-mm-dd>', 'target date')
  .option('-j, --json', 'output as JSON')
  .action(async (options) => {
    const user = await ensureHatenaUser();
    const targetDate = options.date ? new Date(options.date) : new Date();
    
    let bookmarks;
    if (isToday(targetDate)) {
      if (!options.json) console.error(`Today's bookmarks: Fetching fresh data from API...`);
      bookmarks = await fetchBookmarksByDate(user, targetDate);
    } else {
      bookmarks = loadCache(targetDate);
    }
    
    if (!bookmarks || bookmarks.length === 0) {
      if (options.json) {
        console.log(JSON.stringify([]));
      } else {
        console.log(`No bookmarks found for ${targetDate.toISOString().split('T')[0]}.`);
      }
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(bookmarks, null, 2));
    } else {
      console.log(`--- Bookmarks for ${targetDate.toISOString().split('T')[0]} ---`);
      bookmarks.forEach((b: any) => {
        console.log(`- ${b.title}\n  ${b.link}`);
      });
    }
  });

program
  .command('search <query>')
  .description('Search bookmarks from local cache')
  .option('-f, --field <all|title|url>', 'search field', 'all')
  .option('-d, --date <yyyy-mm-dd>', 'target date')
  .option('-l, --limit <number>', 'maximum results', '10')
  .option('-j, --json', 'output as JSON')
  .action((query, options) => {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      console.error('Error: query must not be empty.');
      process.exit(1);
    }

    const field = parseSearchField(options.field);
    const limit = parsePositiveIntegerOption(options.limit, '--limit');

    if (options.date && !isDateKey(options.date)) {
      console.error('Error: --date must be a valid yyyy-mm-dd.');
      process.exit(1);
    }

    const results = searchBookmarks(normalizedQuery, {
      dateKey: options.date,
      field,
      limit,
    });

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      if (options.date) {
        console.log(`No matching bookmarks found for ${options.date}.`);
      } else {
        console.log('No matching bookmarks found.');
      }
      return;
    }

    results.forEach((result, index) => {
      console.log(`${index + 1}. [${result.dateKey}] ${result.title}`);
      console.log(`   ${result.link}`);
    });
  });

program
  .command('domains')
  .description('Rank bookmarked URL domains for a specific date')
  .option('--date <yyyy|yyyy-mm|yyyy-mm-dd>', 'target date/range')
  .option('--today', 'target today only (overrides default weekly range)')
  .option('-l, --limit <number>', 'maximum ranking rows (max: 10)', '10')
  .option('-j, --json', 'output as JSON')
  .action(async (options) => {
    try {
      const range = resolveDomainsRangeOption(options);
      const requestedLimit = parsePositiveIntegerOption(options.limit, '--limit');
      const limit = Math.min(requestedLimit, 10);
      const summary = await buildDomainsSummary(range);
      const displayedRanking = summary.ranking.slice(0, limit);

      if (options.json) {
        console.log(JSON.stringify({
          date: summary.range.dateKey,
          bookmark_count: summary.bookmarkCount,
          domain_bookmark_count: summary.bookmarkCountWithDomain,
          total_domains: summary.ranking.length,
          ranking: displayedRanking,
          missing_dates: summary.missingDates,
        }, null, 2));
        return;
      }

      if (summary.ranking.length === 0) {
        console.log(`No domain data found for ${summary.range.dateKey}.`);
        if (summary.missingDates.length > 0) {
          console.log(`Missing cache dates: ${summary.missingDates.join(', ')}`);
        }
        return;
      }

      console.log(`Domains on ${summary.range.dateKey}`);
      displayedRanking.forEach((item, index) => {
        console.log(`${index + 1}. ${item.domain}: ${item.count}`);
      });
      console.log(`Total bookmarks with domain: ${summary.bookmarkCountWithDomain}`);
      if (summary.missingDates.length > 0) {
        console.log(`Missing cache dates: ${summary.missingDates.join(', ')}`);
      }
    } catch (error: any) {
      console.error('Error ranking domains:', error.message);
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('Sync bookmarks from Hatena RSS (excluding today)')
  .option('--days <number>', 'number of days to sync', '1')
  .option('-d, --date <yyyy-mm-dd>', 'specific date to sync')
  .action(async (options) => {
    const user = await ensureHatenaUser();
    if (options.date) {
      const targetDate = new Date(options.date);
      if (isToday(targetDate)) {
        console.error("Warning: Syncing today's bookmarks is not recommended as it's still changing.");
      }
      console.log(`Syncing bookmarks for ${options.date}...`);
      const bookmarks = await fetchBookmarksByDate(user, targetDate);
      saveCache(targetDate, bookmarks);
      console.log(`Saved ${bookmarks.length} bookmarks.`);
    } else {
      const days = parseInt(options.days, 10);
      console.log(`Syncing bookmarks for the last ${days} days (excluding today)...`);
      for (let i = 1; i <= days; i++) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - i);
        const dateStr = targetDate.toISOString().split('T')[0];
        console.log(`Syncing bookmarks for ${dateStr}...`);
        const bookmarks = await fetchBookmarksByDate(user, targetDate);
        saveCache(targetDate, bookmarks);
        console.log(`Saved ${bookmarks.length} bookmarks.`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  });

program
  .command('import <dir>')
  .description('Import legacy bookmarks from a directory (e.g., hatebu-ai/public/data)')
  .action(async (dir) => {
    const sourceDir = path.resolve(dir);
    const targetDir = getCacheDir();
    console.log(`Importing legacy data from ${sourceDir} to ${targetDir}...`);

    if (!fs.existsSync(sourceDir)) {
      console.error(`Error: Source directory ${sourceDir} does not exist.`);
      process.exit(1);
    }

    const years = fs.readdirSync(sourceDir).filter(f => /^[0-9]{4}$/.test(f));
    let totalFiles = 0;

    for (const year of years) {
      const yearPath = path.join(sourceDir, year);
      const months = fs.readdirSync(yearPath).filter(f => /^[0-9]{2}$/.test(f));
      
      for (const month of months) {
        const monthPath = path.join(yearPath, month);
        const days = fs.readdirSync(monthPath).filter(f => f.endsWith('.json'));
        
        const destMonthDir = path.join(targetDir, year, month);
        if (!fs.existsSync(destMonthDir)) {
          fs.mkdirSync(destMonthDir, { recursive: true });
        }

        for (const dayFile of days) {
          const src = path.join(monthPath, dayFile);
          const dest = path.join(destMonthDir, dayFile);
          fs.copyFileSync(src, dest);
          totalFiles++;
        }
      }
      process.stdout.write(`.`);
    }
    console.log(`\nImport complete. Copied ${totalFiles} days of bookmarks.`);
  });

program.parseAsync(process.argv);
