import { Command } from 'commander';
import { parsePositiveIntegerOption, resolveRankingRangeOption } from '../options';
import { buildDomainsSummary } from '../services/analytics';

const MAX_LIMIT = 10;

export function registerDomainsCommand(program: Command): void {
  program
    .command('domains')
    .description('Rank bookmarked URL domains for a specific date')
    .option('--date <yyyy|yyyy-mm|yyyy-mm-dd>', 'target date/range')
    .option('--today', 'target today only (overrides default weekly range)')
    .option('-l, --limit <number>', `maximum ranking rows (max: ${MAX_LIMIT})`, '10')
    .option('-j, --json', 'output as JSON')
    .action(async (options) => {
      try {
        const range = resolveRankingRangeOption(options);
        const limit = Math.min(parsePositiveIntegerOption(options.limit, '--limit'), MAX_LIMIT);
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
}
