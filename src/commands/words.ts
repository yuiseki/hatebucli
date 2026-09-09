import { Command } from 'commander';
import { parsePositiveIntegerOption, resolveRankingRangeOption } from '../options';
import { buildWordsSummary } from '../services/analytics';

const MAX_LIMIT = 30;

export function registerWordsCommand(program: Command): void {
  program
    .command('words')
    .description('Rank tokenized Japanese words in bookmark titles')
    .option('--date <yyyy|yyyy-mm|yyyy-mm-dd>', 'target date/range')
    .option('--today', 'target today only (overrides default weekly range)')
    .option('-l, --limit <number>', `maximum ranking rows (max: ${MAX_LIMIT})`, '10')
    .option('-j, --json', 'output as JSON')
    .action(async (options) => {
      try {
        const range = resolveRankingRangeOption(options);
        const limit = Math.min(parsePositiveIntegerOption(options.limit, '--limit'), MAX_LIMIT);
        const summary = await buildWordsSummary(range);
        const displayedRanking = summary.ranking.slice(0, limit);

        if (options.json) {
          console.log(JSON.stringify({
            date: summary.range.dateKey,
            bookmark_count: summary.bookmarkCount,
            bookmark_count_with_words: summary.bookmarkCountWithWords,
            total_word_assignments: summary.totalWordAssignments,
            total_words: summary.ranking.length,
            ranking: displayedRanking,
            missing_dates: summary.missingDates,
          }, null, 2));
          return;
        }

        if (summary.ranking.length === 0) {
          console.log(`No word data found for ${summary.range.dateKey}.`);
          if (summary.missingDates.length > 0) {
            console.log(`Missing cache dates: ${summary.missingDates.join(', ')}`);
          }
          return;
        }

        console.log(`Words on ${summary.range.dateKey}`);
        displayedRanking.forEach((item, index) => {
          console.log(`${index + 1}. ${item.word}: ${item.count}`);
        });
        console.log(`Total bookmarks with words: ${summary.bookmarkCountWithWords}`);
        console.log(`Total word assignments: ${summary.totalWordAssignments}`);
        if (summary.missingDates.length > 0) {
          console.log(`Missing cache dates: ${summary.missingDates.join(', ')}`);
        }
      } catch (error: any) {
        console.error('Error ranking words:', error.message);
        process.exit(1);
      }
    });
}
