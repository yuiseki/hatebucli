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

type TagRank = {
  tag: string;
  count: number;
};

type HourRank = {
  hour: number;
  count: number;
};

type WeekdayRank = {
  weekday: number;
  count: number;
};

type DomainsSummary = {
  range: ParsedDateOption;
  bookmarkCount: number;
  bookmarkCountWithDomain: number;
  ranking: DomainRank[];
  missingDates: string[];
};

type TagsSummary = {
  range: ParsedDateOption;
  bookmarkCount: number;
  bookmarkCountWithTags: number;
  totalTagAssignments: number;
  ranking: TagRank[];
  missingDates: string[];
};

type StatsDateRange = {
  range: ParsedDateOption;
  days: number;
  startLabel: string;
  endLabel: string;
};

type StatsSummary = {
  dateRange: StatsDateRange;
  bookmarkCount: number;
  bookmarkCountWithTimestamp: number;
  bookmarkCountWithDomain: number;
  bookmarkCountWithTags: number;
  totalTagAssignments: number;
  hourRanking: HourRank[];
  weekdayRanking: WeekdayRank[];
  domainRanking: DomainRank[];
  tagRanking: TagRank[];
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

function resolveRankingRangeOption(options: { date?: string; today?: boolean }): ParsedDateOption {
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

function buildStatsDateRange(dateOption: string | undefined, daysOption: string): StatsDateRange {
  if (!dateOption && daysOption === '7') {
    const weekly = buildRecentWeekRangeUntilYesterday();
    return {
      range: weekly,
      days: 7,
      startLabel: formatDateYmd(weekly.start),
      endLabel: formatDateYmd(weekly.end),
    };
  }

  const days = parsePositiveIntegerOption(daysOption, '--days');
  let endDate: Date;

  if (dateOption) {
    const parsed = parseDateOption(dateOption);
    endDate = new Date(parsed.end);
  } else {
    const now = new Date();
    endDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
      23,
      59,
      59,
      999,
    );
  }

  const startDate = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
    0,
    0,
    0,
    0,
  );
  startDate.setDate(startDate.getDate() - (days - 1));

  const startLabel = formatDateYmd(startDate);
  const endLabel = formatDateYmd(endDate);

  return {
    range: {
      granularity: 'day',
      dateKey: `${startLabel}..${endLabel}`,
      start: startDate,
      end: endDate,
    },
    days,
    startLabel,
    endLabel,
  };
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

function normalizeTagText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) return undefined;
  const stripped = normalized.replace(/^[#＃]+/, '').trim();
  return stripped.length > 0 ? stripped : undefined;
}

function extractTagsFromDescription(description: unknown): string[] {
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

function extractBookmarkTags(bookmark: any): string[] {
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

async function buildTagsSummary(range: ParsedDateOption): Promise<TagsSummary> {
  const dateList = getDateListInRange(range.start, range.end);
  const missingDates: string[] = [];
  const counts = new Map<string, number>();
  let bookmarkCount = 0;
  let bookmarkCountWithTags = 0;
  let totalTagAssignments = 0;
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
      const tags = extractBookmarkTags(bookmark);
      if (tags.length === 0) continue;

      bookmarkCountWithTags += 1;
      totalTagAssignments += tags.length;
      for (const tag of tags) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
  }

  const ranking: TagRank[] = Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.tag.localeCompare(b.tag, 'ja');
    });

  return {
    range,
    bookmarkCount,
    bookmarkCountWithTags,
    totalTagAssignments,
    ranking,
    missingDates,
  };
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseBookmarkTimestamp(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

async function buildStatsSummary(dateRange: StatsDateRange): Promise<StatsSummary> {
  const dateList = getDateListInRange(dateRange.range.start, dateRange.range.end);
  const missingDates: string[] = [];
  const domainCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const hourCounts = Array.from({ length: 24 }, (_item, hour) => ({ hour, count: 0 }));
  const weekdayCounts = Array.from({ length: 7 }, (_item, weekday) => ({ weekday, count: 0 }));

  let bookmarkCount = 0;
  let bookmarkCountWithTimestamp = 0;
  let bookmarkCountWithDomain = 0;
  let bookmarkCountWithTags = 0;
  let totalTagAssignments = 0;
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

      const bookmarkDate = parseBookmarkTimestamp(bookmark?.date);
      if (bookmarkDate) {
        bookmarkCountWithTimestamp += 1;
        hourCounts[bookmarkDate.getHours()].count += 1;
        weekdayCounts[bookmarkDate.getDay()].count += 1;
      }

      const domain = extractDomain(bookmark?.link);
      if (domain) {
        bookmarkCountWithDomain += 1;
        domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
      }

      const tags = extractBookmarkTags(bookmark);
      if (tags.length > 0) {
        bookmarkCountWithTags += 1;
        totalTagAssignments += tags.length;
        for (const tag of tags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }
    }
  }

  const domainRanking = Array.from(domainCounts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.domain.localeCompare(b.domain);
    });

  const tagRanking = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.tag.localeCompare(b.tag, 'ja');
    });

  const hourRanking = hourCounts.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.hour - b.hour;
  });

  const weekdayRanking = weekdayCounts.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.weekday - b.weekday;
  });

  return {
    dateRange,
    bookmarkCount,
    bookmarkCountWithTimestamp,
    bookmarkCountWithDomain,
    bookmarkCountWithTags,
    totalTagAssignments,
    hourRanking,
    weekdayRanking,
    domainRanking,
    tagRanking,
    missingDates,
  };
}

function appendStatsRankSection(
  lines: string[],
  title: string,
  rows: Array<{ label: string; count: number }>,
  top: number,
): void {
  lines.push(`### ${title}`);
  const filtered = rows.filter(row => row.count > 0).slice(0, top);
  if (filtered.length === 0) {
    lines.push('- No data');
    lines.push('');
    return;
  }

  for (const row of filtered) {
    lines.push(`- ${row.label}: ${row.count}`);
  }
  lines.push('');
}

function renderStatsMarkdown(summary: StatsSummary, top: number): string {
  const lines: string[] = [];
  lines.push('## Hatebu Stats');
  lines.push('');
  lines.push(
    `- Window: ${summary.dateRange.startLabel} to ${summary.dateRange.endLabel} (${summary.dateRange.days} days)`,
  );
  lines.push(`- Total bookmarks: ${summary.bookmarkCount}`);
  lines.push(`- Bookmarks with timestamp: ${summary.bookmarkCountWithTimestamp}`);
  lines.push('');

  appendStatsRankSection(
    lines,
    'Bookmark Time (Hour)',
    summary.hourRanking.map(item => ({
      label: `${String(item.hour).padStart(2, '0')}:00`,
      count: item.count,
    })),
    top,
  );

  appendStatsRankSection(
    lines,
    'Bookmark Weekday',
    summary.weekdayRanking.map(item => ({
      label: WEEKDAY_LABELS[item.weekday] || String(item.weekday),
      count: item.count,
    })),
    Math.min(top, 7),
  );

  appendStatsRankSection(
    lines,
    'Domains',
    summary.domainRanking.map(item => ({
      label: item.domain,
      count: item.count,
    })),
    top,
  );

  appendStatsRankSection(
    lines,
    'Tags',
    summary.tagRanking.map(item => ({
      label: `#${item.tag}`,
      count: item.count,
    })),
    top,
  );

  if (summary.missingDates.length > 0) {
    lines.push(`- Missing cache dates: ${summary.missingDates.join(', ')}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
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
      const range = resolveRankingRangeOption(options);
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
  .command('tags')
  .alias('tag')
  .description('Rank bookmark tags for a specific date')
  .option('--date <yyyy|yyyy-mm|yyyy-mm-dd>', 'target date/range')
  .option('--today', 'target today only (overrides default weekly range)')
  .option('-l, --limit <number>', 'maximum ranking rows (max: 10)', '10')
  .option('-j, --json', 'output as JSON')
  .action(async (options) => {
    try {
      const range = resolveRankingRangeOption(options);
      const requestedLimit = parsePositiveIntegerOption(options.limit, '--limit');
      const limit = Math.min(requestedLimit, 10);
      const summary = await buildTagsSummary(range);
      const displayedRanking = summary.ranking.slice(0, limit);

      if (options.json) {
        console.log(JSON.stringify({
          date: summary.range.dateKey,
          bookmark_count: summary.bookmarkCount,
          bookmark_count_with_tags: summary.bookmarkCountWithTags,
          total_tag_assignments: summary.totalTagAssignments,
          total_tags: summary.ranking.length,
          ranking: displayedRanking,
          missing_dates: summary.missingDates,
        }, null, 2));
        return;
      }

      if (summary.ranking.length === 0) {
        console.log(`No tag data found for ${summary.range.dateKey}.`);
        if (summary.missingDates.length > 0) {
          console.log(`Missing cache dates: ${summary.missingDates.join(', ')}`);
        }
        return;
      }

      console.log(`Tags on ${summary.range.dateKey}`);
      displayedRanking.forEach((item, index) => {
        console.log(`${index + 1}. #${item.tag}: ${item.count}`);
      });
      console.log(`Total bookmarks with tags: ${summary.bookmarkCountWithTags}`);
      console.log(`Total tag assignments: ${summary.totalTagAssignments}`);
      if (summary.missingDates.length > 0) {
        console.log(`Missing cache dates: ${summary.missingDates.join(', ')}`);
      }
    } catch (error: any) {
      console.error('Error ranking tags:', error.message);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('Show weekly stats summary in Markdown')
  .option('--date <yyyy|yyyy-mm|yyyy-mm-dd>', 'window end date anchor (default: yesterday)')
  .option('--days <number>', 'window length in days', '7')
  .option('--top <number>', 'rows per section', '10')
  .action(async (options) => {
    try {
      const dateRange = buildStatsDateRange(options.date, options.days || '7');
      const top = Math.min(parsePositiveIntegerOption(options.top, '--top'), 20);
      const summary = await buildStatsSummary(dateRange);
      console.log(renderStatsMarkdown(summary, top));
    } catch (error: any) {
      console.error('Error building stats:', error.message);
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
