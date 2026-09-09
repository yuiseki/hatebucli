/**
 * What a range of bookmarks adds up to: the domain, tag and word rankings, and
 * the stats summary that puts them together with the time of day.
 *
 * Each summary is a plain value. The command prints it and the MCP tool
 * serialises it, so neither of them holds a copy of the query.
 */
import {
  extractBookmarkTags,
  extractDomain,
  parseBookmarkTimestamp,
  WEEKDAY_LABELS,
} from '../format';
import { extractWordsFromJapaneseText } from '../words';
import { forEachBookmarkInRange } from './bookmarks';
import type { ParsedDateOption, StatsDateRange } from '../dates';

export type DomainRank = { domain: string; count: number };
export type TagRank = { tag: string; count: number };
export type WordRank = { word: string; count: number };
export type HourRank = { hour: number; count: number };
export type WeekdayRank = { weekday: number; count: number };

export type DomainsSummary = {
  range: ParsedDateOption;
  bookmarkCount: number;
  bookmarkCountWithDomain: number;
  ranking: DomainRank[];
  missingDates: string[];
};

export type TagsSummary = {
  range: ParsedDateOption;
  bookmarkCount: number;
  bookmarkCountWithTags: number;
  totalTagAssignments: number;
  ranking: TagRank[];
  missingDates: string[];
};

export type WordsSummary = {
  range: ParsedDateOption;
  bookmarkCount: number;
  bookmarkCountWithWords: number;
  totalWordAssignments: number;
  ranking: WordRank[];
  missingDates: string[];
};

export type StatsSummary = {
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

/** Most frequent first, then by label so equal counts keep a stable order. */
function rankByCount<T>(
  counts: Map<string, number>,
  toRow: (label: string, count: number) => T,
  compareLabels: (a: string, b: string) => number,
): T[] {
  return Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return compareLabels(a[0], b[0]);
    })
    .map(([label, count]) => toRow(label, count));
}

const byAscii = (a: string, b: string) => a.localeCompare(b);
const byJapanese = (a: string, b: string) => a.localeCompare(b, 'ja');

export async function buildDomainsSummary(range: ParsedDateOption): Promise<DomainsSummary> {
  const counts = new Map<string, number>();
  let bookmarkCount = 0;
  let bookmarkCountWithDomain = 0;

  const missingDates = await forEachBookmarkInRange(range, (bookmark) => {
    bookmarkCount += 1;
    const domain = extractDomain(bookmark?.link);
    if (!domain) return;
    bookmarkCountWithDomain += 1;
    counts.set(domain, (counts.get(domain) || 0) + 1);
  });

  return {
    range,
    bookmarkCount,
    bookmarkCountWithDomain,
    ranking: rankByCount(counts, (domain, count) => ({ domain, count }), byAscii),
    missingDates,
  };
}

export async function buildTagsSummary(range: ParsedDateOption): Promise<TagsSummary> {
  const counts = new Map<string, number>();
  let bookmarkCount = 0;
  let bookmarkCountWithTags = 0;
  let totalTagAssignments = 0;

  const missingDates = await forEachBookmarkInRange(range, (bookmark) => {
    bookmarkCount += 1;
    const tags = extractBookmarkTags(bookmark);
    if (tags.length === 0) return;

    bookmarkCountWithTags += 1;
    totalTagAssignments += tags.length;
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  });

  return {
    range,
    bookmarkCount,
    bookmarkCountWithTags,
    totalTagAssignments,
    ranking: rankByCount(counts, (tag, count) => ({ tag, count }), byJapanese),
    missingDates,
  };
}

export async function buildWordsSummary(range: ParsedDateOption): Promise<WordsSummary> {
  const counts = new Map<string, number>();
  let bookmarkCount = 0;
  let bookmarkCountWithWords = 0;
  let totalWordAssignments = 0;

  const missingDates = await forEachBookmarkInRange(range, (bookmark) => {
    bookmarkCount += 1;
    const words = extractWordsFromJapaneseText(bookmark?.title);
    if (words.length === 0) return;

    // A word repeated within one title still says that title once.
    const uniqueWords = Array.from(new Set(words));
    bookmarkCountWithWords += 1;
    totalWordAssignments += uniqueWords.length;
    for (const word of uniqueWords) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  });

  return {
    range,
    bookmarkCount,
    bookmarkCountWithWords,
    totalWordAssignments,
    ranking: rankByCount(counts, (word, count) => ({ word, count }), byJapanese),
    missingDates,
  };
}

export async function buildStatsSummary(dateRange: StatsDateRange): Promise<StatsSummary> {
  const domainCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const hourCounts = Array.from({ length: 24 }, (_item, hour) => ({ hour, count: 0 }));
  const weekdayCounts = Array.from({ length: 7 }, (_item, weekday) => ({ weekday, count: 0 }));

  let bookmarkCount = 0;
  let bookmarkCountWithTimestamp = 0;
  let bookmarkCountWithDomain = 0;
  let bookmarkCountWithTags = 0;
  let totalTagAssignments = 0;

  const missingDates = await forEachBookmarkInRange(dateRange.range, (bookmark) => {
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
    domainRanking: rankByCount(domainCounts, (domain, count) => ({ domain, count }), byAscii),
    tagRanking: rankByCount(tagCounts, (tag, count) => ({ tag, count }), byJapanese),
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

export function renderStatsMarkdown(summary: StatsSummary, top: number): string {
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
    summary.domainRanking.map(item => ({ label: item.domain, count: item.count })),
    top,
  );

  appendStatsRankSection(
    lines,
    'Tags',
    summary.tagRanking.map(item => ({ label: `#${item.tag}`, count: item.count })),
    top,
  );

  if (summary.missingDates.length > 0) {
    lines.push(`- Missing cache dates: ${summary.missingDates.join(', ')}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * The stats summary as JSON, for `stats --json` and for the MCP tool. One
 * function so the two cannot drift, and so the rows are cut the same way the
 * Markdown cuts them: `--top` applies, and a bucket nobody bookmarked in is
 * left out rather than reported as a zero.
 */
export function toStatsJson(summary: StatsSummary, top: number) {
  return {
    start: summary.dateRange.startLabel,
    end: summary.dateRange.endLabel,
    days: summary.dateRange.days,
    bookmark_count: summary.bookmarkCount,
    bookmark_count_with_timestamp: summary.bookmarkCountWithTimestamp,
    bookmark_count_with_domain: summary.bookmarkCountWithDomain,
    bookmark_count_with_tags: summary.bookmarkCountWithTags,
    total_tag_assignments: summary.totalTagAssignments,
    hour_ranking: summary.hourRanking.filter((row) => row.count > 0).slice(0, top),
    weekday_ranking: summary.weekdayRanking
      .filter((row) => row.count > 0)
      // Seven is the whole week, so --top never cuts it. The label saves every
      // reader from having to know that 0 is Sunday.
      .map((row) => ({
        weekday: row.weekday,
        label: WEEKDAY_LABELS[row.weekday] || String(row.weekday),
        count: row.count,
      })),
    domain_ranking: summary.domainRanking.slice(0, top),
    tag_ranking: summary.tagRanking.slice(0, top),
    missing_dates: summary.missingDates,
  };
}
