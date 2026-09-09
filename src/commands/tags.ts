import { Command } from 'commander';
import { parsePositiveIntegerOption, resolveRankingRangeOption } from '../options';
import { buildTagsSummary } from '../services/analytics';

const MAX_LIMIT = 10;

export function registerTagsCommand(program: Command): void {
  program
    .command('tags')
    .alias('tag')
    .description('Rank bookmark tags for a specific date')
    .option('--date <yyyy|yyyy-mm|yyyy-mm-dd>', 'target date/range')
    .option('--today', 'target today only (overrides default weekly range)')
    .option('-l, --limit <number>', `maximum ranking rows (max: ${MAX_LIMIT})`, '10')
    .option('-j, --json', 'output as JSON')
    .action(async (options) => {
      try {
        const range = resolveRankingRangeOption(options);
        const limit = Math.min(parsePositiveIntegerOption(options.limit, '--limit'), MAX_LIMIT);
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
}
