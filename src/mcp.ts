/**
 * A Model Context Protocol server over stdio, started with `hatebu --mcp-server`.
 *
 * It is the CLI itself rather than a second program, so it reads the same
 * username and the same cache as every other `hatebu` command, and a tool
 * answers exactly what the matching command prints.
 *
 * stdout belongs to the protocol. Everything this file has to say to a human
 * goes to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  DATE_OPTION_PROBLEMS,
  buildRecentWeekRangeUntilYesterday,
  buildStatsDateRangeFrom,
  formatDateYmd,
  isDateKey,
  tryParseDateOption,
  tryParseDayOption,
  weeklyStatsDateRange,
  type ParsedDateOption,
} from './dates';
import { resolveHatenaUser } from './credentials';
import { searchBookmarks, type SearchField } from './services/search';
import { loadDay } from './services/bookmarks';
import {
  buildTimeline,
  findBookmarks,
  lookup,
  randomBookmarks,
} from './services/queries';
import {
  buildDomainsSummary,
  buildStatsSummary,
  buildTagsSummary,
  buildWordsSummary,
  renderStatsMarkdown,
} from './services/analytics';

function serverVersion(): string {
  // The published tarball always contains package.json, and dist/ sits one
  // level below it, so this holds both in the repository and once installed.
  return require('../package.json').version as string;
}

const DATE_DESCRIPTION =
  'A day (2026-02-18), a month (2026-02) or a year (2026). Omit for the week ' +
  'ending yesterday.';

/**
 * A tool must answer a bad argument, not take the process down, so every
 * parser used here is the non-exiting form and its problem becomes an error
 * the client can read.
 */
function parseRange(date?: string, today?: boolean): ParsedDateOption {
  if (today && date) {
    throw new Error('today and date cannot be used together.');
  }
  if (today) {
    const parsed = tryParseDateOption();
    if (!parsed.ok) throw new Error(DATE_OPTION_PROBLEMS[parsed.problem]);
    return parsed.value;
  }
  if (date) {
    const parsed = tryParseDateOption(date);
    if (!parsed.ok) {
      throw new Error(DATE_OPTION_PROBLEMS[parsed.problem].replace('--date', 'date'));
    }
    return parsed.value;
  }
  return buildRecentWeekRangeUntilYesterday();
}

function parseDay(date: string): Date {
  const parsed = tryParseDayOption(date);
  if (!parsed.ok) {
    throw new Error(DATE_OPTION_PROBLEMS[parsed.problem].replace('--date', 'date'));
  }
  return parsed.value;
}

/** The open-ended yyyy-mm-dd bounds of a whole-archive question. */
function parseBound(value?: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isDateKey(value)) {
    throw new Error(`'${value}' is not a day. Pass a date as yyyy-mm-dd.`);
  }
  return value;
}

function asJsonResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Every tool call is announced on stderr. stdout is the protocol, and a server
 * that says nothing at all is indistinguishable from one that has hung.
 */
function logged<Args, Result>(
  name: string,
  handler: (args: Args) => Promise<Result>,
): (args: Args) => Promise<Result> {
  return async (args: Args) => {
    console.error(`[hatebu-mcp] ${name} ${JSON.stringify(args)}`);
    return handler(args);
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'hatebucli', version: serverVersion() });

  server.registerTool(
    'hatebu_search',
    {
      title: 'Search the bookmarks',
      description:
        'Full-text search over every bookmark the user has cached locally, which goes ' +
        'back to the beginning of their Hatena Bookmark account. Titles are mostly ' +
        'Japanese and are indexed per character, so a partial word matches. Returns the ' +
        'title, the URL and the day it was bookmarked. If nothing suitable comes back, ' +
        'rephrase the query rather than giving up on the first attempt.',
      inputSchema: {
        query: z.string().min(1).max(200).describe('Search keyword'),
        field: z
          .enum(['all', 'title', 'url'])
          .default('all')
          .describe('Where to match: the title, the URL, or either'),
        date: z
          .string()
          .optional()
          .describe('Restrict to one day, as yyyy-mm-dd. Omit to search every cached day'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(10)
          .describe('Most results to return (max: 100)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    logged('hatebu_search', async ({ query, field, date, limit }) => {
      const normalizedQuery = query.trim();
      if (normalizedQuery.length === 0) {
        throw new Error('query must not be empty.');
      }
      if (date !== undefined && !isDateKey(date)) {
        throw new Error('date must be a valid yyyy-mm-dd.');
      }

      const results = searchBookmarks(normalizedQuery, {
        dateKey: date,
        field: field as SearchField,
        limit,
      });
      return asJsonResult({
        query: normalizedQuery,
        field,
        ...(date ? { date } : {}),
        result_count: results.length,
        // The index is per character, so matchedTitleTokens is a list of single
        // letters. It explains the score to a human reading the index and says
        // nothing to a model, so it is dropped rather than sent.
        results: results.map(({ matchedTitleTokens, matchedUrlTokens, ...result }) => result),
      });
    }),
  );

  server.registerTool(
    'hatebu_list',
    {
      title: 'The bookmarks of one day',
      description:
        'Every bookmark the user saved on one day, newest first. Today comes from the ' +
        'live feed; an earlier day comes from the local cache, and a day that was never ' +
        'synced is reported as such rather than as an empty day.',
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe('The day, as yyyy-mm-dd. Omit for today'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    logged('hatebu_list', async ({ date }) => {
      const targetDate = date ? parseDay(date) : new Date();
      const label = formatDateYmd(targetDate);
      const bookmarks = await loadDay(targetDate);
      if (bookmarks === null) {
        return asJsonResult({
          date: label,
          cached: false,
          bookmark_count: 0,
          bookmarks: [],
          note: `${label} has not been synced into the local cache.`,
        });
      }
      return asJsonResult({
        date: label,
        cached: true,
        bookmark_count: bookmarks.length,
        bookmarks,
      });
    }),
  );

  server.registerTool(
    'hatebu_domains',
    {
      title: 'Which sites the user reads',
      description:
        'The sites the user bookmarked over a day, a month, a year or the week ending ' +
        'yesterday, most bookmarked first. missing_dates lists the days in the range ' +
        'that were never synced, so a low count can be told apart from a gap.',
      inputSchema: {
        date: z.string().optional().describe(DATE_DESCRIPTION),
        today: z.boolean().optional().describe('Today only. Cannot be combined with date'),
        limit: z.number().int().min(1).max(100).default(10).describe('Most rows to return'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    logged('hatebu_domains', async ({ date, today, limit }) => {
      const summary = await buildDomainsSummary(parseRange(date, today));
      return asJsonResult({
        date: summary.range.dateKey,
        bookmark_count: summary.bookmarkCount,
        domain_bookmark_count: summary.bookmarkCountWithDomain,
        total_domains: summary.ranking.length,
        ranking: summary.ranking.slice(0, limit),
        missing_dates: summary.missingDates,
      });
    }),
  );

  server.registerTool(
    'hatebu_tags',
    {
      title: 'The tags the user files bookmarks under',
      description:
        'The tags the user put on their bookmarks over a range, most used first. Tags ' +
        'come from the feed as it was on the day, so a stretch from before the user ' +
        'started tagging legitimately returns nothing; use hatebu_words for what an ' +
        'untagged stretch was about.',
      inputSchema: {
        date: z.string().optional().describe(DATE_DESCRIPTION),
        today: z.boolean().optional().describe('Today only. Cannot be combined with date'),
        limit: z.number().int().min(1).max(100).default(10).describe('Most rows to return'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    logged('hatebu_tags', async ({ date, today, limit }) => {
      const summary = await buildTagsSummary(parseRange(date, today));
      return asJsonResult({
        date: summary.range.dateKey,
        bookmark_count: summary.bookmarkCount,
        bookmark_count_with_tags: summary.bookmarkCountWithTags,
        total_tag_assignments: summary.totalTagAssignments,
        total_tags: summary.ranking.length,
        ranking: summary.ranking.slice(0, limit),
        missing_dates: summary.missingDates,
      });
    }),
  );

  server.registerTool(
    'hatebu_words',
    {
      title: 'What the bookmarks of a range were about',
      description:
        'The words in the bookmark titles of a range, most frequent first, tokenized ' +
        'with a Japanese morphological analyser. This is the subject matter of a ' +
        'stretch of reading, and it works on every year, tagged or not. A word is ' +
        'counted once per bookmark, however often the title repeats it.',
      inputSchema: {
        date: z.string().optional().describe(DATE_DESCRIPTION),
        today: z.boolean().optional().describe('Today only. Cannot be combined with date'),
        limit: z.number().int().min(1).max(100).default(30).describe('Most rows to return'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    logged('hatebu_words', async ({ date, today, limit }) => {
      const summary = await buildWordsSummary(parseRange(date, today));
      return asJsonResult({
        date: summary.range.dateKey,
        bookmark_count: summary.bookmarkCount,
        bookmark_count_with_words: summary.bookmarkCountWithWords,
        total_word_assignments: summary.totalWordAssignments,
        total_words: summary.ranking.length,
        ranking: summary.ranking.slice(0, limit),
        missing_dates: summary.missingDates,
      });
    }),
  );

  server.registerTool(
    'hatebu_stats',
    {
      title: 'What a stretch of reading adds up to',
      description:
        'A window of days as one summary: how much was bookmarked, at what hours and ' +
        'on what weekdays, and the sites and tags that led it. Returns Markdown, and ' +
        'the same numbers as JSON alongside it. With no arguments it covers the week ' +
        'ending yesterday.',
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe('The day the window ends on, as yyyy-mm-dd. Defaults to yesterday'),
        days: z.number().int().min(1).max(400).default(7).describe('Window length in days'),
        top: z.number().int().min(1).max(50).default(10).describe('Rows per section'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    logged('hatebu_stats', async ({ date, days, top }) => {
      const dateRange =
        date === undefined && days === 7
          ? weeklyStatsDateRange()
          : buildStatsDateRangeFrom(date === undefined ? undefined : parseRange(date), days);
      const summary = await buildStatsSummary(dateRange);
      return {
        content: [
          { type: 'text' as const, text: renderStatsMarkdown(summary, top) },
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                start: summary.dateRange.startLabel,
                end: summary.dateRange.endLabel,
                days: summary.dateRange.days,
                bookmark_count: summary.bookmarkCount,
                hour_ranking: summary.hourRanking.filter((row) => row.count > 0).slice(0, top),
                weekday_ranking: summary.weekdayRanking.filter((row) => row.count > 0),
                domain_ranking: summary.domainRanking.slice(0, top),
                tag_ranking: summary.tagRanking.slice(0, top),
                missing_dates: summary.missingDates,
              },
              null,
              2,
            ),
          },
        ],
      };
    }),
  );

  server.registerTool(
    'hatebu_lookup',
    {
      title: 'Has the user bookmarked this',
      description:
        'Whether a page or a site is in the archive, and when. Give a full URL to ask ' +
        'about one page; give a bare hostname to ask about a site, which also covers ' +
        'its subdomains. A URL that was never bookmarked still reports how much else ' +
        'came from the same site. The archive goes back to the beginning of the ' +
        "user's account, so a negative answer here is meaningful.",
      inputSchema: {
        url_or_domain: z
          .string()
          .min(1)
          .describe('A full URL such as https://example.com/a, or a hostname such as example.com'),
        limit: z.number().int().min(1).max(100).default(10).describe('Most bookmarks to return'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    logged('hatebu_lookup', async ({ url_or_domain, limit }) => {
      const result = lookup(url_or_domain, limit);
      return asJsonResult({
        input: result.input,
        kind: result.kind,
        ...(result.domain ? { domain: result.domain } : {}),
        bookmarked: result.bookmarked,
        match_count: result.matchCount,
        ...(result.first ? { first_bookmarked: result.first.dateKey } : {}),
        ...(result.last ? { last_bookmarked: result.last.dateKey } : {}),
        ...(result.sameDomainCount === undefined
          ? {}
          : { same_domain_count: result.sameDomainCount }),
        bookmarks: result.entries,
      });
    }),
  );

  server.registerTool(
    'hatebu_timeline',
    {
      title: 'How a subject came and went over the years',
      description:
        'Bookmarks counted per year or per month, optionally about one subject. This is ' +
        'the tool for when an interest started, whether it is still going, and how it ' +
        'compares with another year. Filter by tag, by site, or by text in the title or ' +
        'URL. With no filter it is the shape of the whole archive.',
      inputSchema: {
        by: z.enum(['year', 'month']).default('year').describe('Bucket size'),
        tag: z.string().optional().describe('Only bookmarks under this tag'),
        domain: z
          .string()
          .optional()
          .describe('Only bookmarks from this site, subdomains included'),
        query: z
          .string()
          .optional()
          .describe('Only bookmarks whose title or URL contains this text'),
        from: z.string().optional().describe('Earliest day to count, as yyyy-mm-dd'),
        to: z.string().optional().describe('Latest day to count, as yyyy-mm-dd'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    logged('hatebu_timeline', async ({ by, tag, domain, query, from, to }) => {
      const filter = { tag, domain, query, from: parseBound(from), to: parseBound(to) };
      const timeline = buildTimeline(filter, by);
      return asJsonResult({
        by,
        filter: {
          ...(tag ? { tag } : {}),
          ...(domain ? { domain } : {}),
          ...(query ? { query } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        },
        total: timeline.total,
        rows: timeline.rows,
      });
    }),
  );

  server.registerTool(
    'hatebu_tagged',
    {
      title: 'The bookmarks under one tag',
      description:
        'Every bookmark the user filed under a tag, newest first. Nothing is returned ' +
        'for a stretch from before the user started tagging, so use hatebu_timeline ' +
        'with a query for an older subject.',
      inputSchema: {
        tag: z.string().min(1).describe('The tag, without a leading #'),
        limit: z.number().int().min(1).max(100).default(20).describe('Most bookmarks to return'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    logged('hatebu_tagged', async ({ tag, limit }) => {
      const found = findBookmarks({ tag }, limit);
      return asJsonResult({
        tag,
        match_count: found.matchCount,
        ...(found.first ? { first_bookmarked: found.first.dateKey } : {}),
        ...(found.last ? { last_bookmarked: found.last.dateKey } : {}),
        bookmarks: found.entries,
      });
    }),
  );

  server.registerTool(
    'hatebu_random',
    {
      title: 'A few bookmarks at random',
      description:
        'A handful of bookmarks drawn at random from the archive, optionally filtered ' +
        'by tag, site, text or a date range. For digging out something from years ago ' +
        'that nothing would have thought to ask for.',
      inputSchema: {
        count: z.number().int().min(1).max(50).default(5).describe('How many to draw'),
        tag: z.string().optional().describe('Only bookmarks under this tag'),
        domain: z.string().optional().describe('Only bookmarks from this site'),
        query: z.string().optional().describe('Only bookmarks whose title or URL contains this'),
        from: z.string().optional().describe('Earliest day to draw from, as yyyy-mm-dd'),
        to: z.string().optional().describe('Latest day to draw from, as yyyy-mm-dd'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    logged('hatebu_random', async ({ count, tag, domain, query, from, to }) => {
      const drawn = randomBookmarks(
        { tag, domain, query, from: parseBound(from), to: parseBound(to) },
        count,
      );
      return asJsonResult({ match_count: drawn.matchCount, bookmarks: drawn.entries });
    }),
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  if (!resolveHatenaUser()) {
    console.error('Error: Hatena Username is not set.');
    console.error('The MCP server needs one before it can start. Set it with:');
    console.error('  hatebu config set username <your_username>');
    console.error('or pass HATENA_USER in the environment of the MCP client.');
    process.exit(1);
  }

  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  console.error('hatebu MCP server ready on stdio.');
}
