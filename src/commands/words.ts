import { Command } from 'commander';
import { parsePositiveIntegerOption, resolveRankingRangeOption } from '../options';
import { buildWordsSummary } from '../services/analytics';
import { buildBackground, loadBackground } from '../services/background';
import { rankDistinctiveWords } from '../services/distinctive';

const MAX_LIMIT = 30;

const NO_BACKGROUND =
  'No background model, so these are raw counts. Build one with ' +
  '`hatebu words --rebuild-background` to see what a stretch was about ' +
  'rather than which words it contained.';

type Scoring = 'distinctive' | 'count';

function parseScoring(value: string): Scoring {
  if (value === 'distinctive' || value === 'count') return value;
  console.error('Error: --by must be one of "distinctive" or "count".');
  process.exit(1);
}

export function registerWordsCommand(program: Command): void {
  program
    .command('words')
    .description('Rank the words in bookmark titles, by default the distinctive ones')
    .option('--date <yyyy|yyyy-mm|yyyy-mm-dd>', 'target date/range')
    .option('--today', 'target today only (overrides default weekly range)')
    .option('--by <distinctive|count>', 'distinctive against the archive, or raw counts', 'distinctive')
    .option('-l, --limit <number>', `maximum ranking rows (max: ${MAX_LIMIT})`, '10')
    .option('-j, --json', 'output as JSON')
    .option('--rebuild-background', 'rebuild the background model and exit')
    .action(async (options) => {
      try {
        if (options.rebuildBackground) {
          rebuildBackground(Boolean(options.json));
          return;
        }

        const scoring = parseScoring(options.by);
        const range = resolveRankingRangeOption(options);
        const limit = Math.min(parsePositiveIntegerOption(options.limit, '--limit'), MAX_LIMIT);
        const summary = await buildWordsSummary(range);

        const background = scoring === 'distinctive' ? loadBackground() : null;
        const usedScoring: Scoring = background ? 'distinctive' : 'count';
        const ranking = background
          ? rankDistinctiveWords(summary.counts, background, limit)
          : summary.ranking.slice(0, limit);

        if (options.json) {
          console.log(JSON.stringify({
            date: summary.range.dateKey,
            scoring: usedScoring,
            ...(background ? { background_built_at: background.builtAt } : {}),
            ...(scoring === 'distinctive' && !background ? { note: NO_BACKGROUND } : {}),
            bookmark_count: summary.bookmarkCount,
            bookmark_count_with_words: summary.bookmarkCountWithWords,
            total_word_assignments: summary.totalWordAssignments,
            total_words: summary.ranking.length,
            ranking,
            missing_dates: summary.missingDates,
          }, null, 2));
          return;
        }

        if (ranking.length === 0) {
          console.log(`No word data found for ${summary.range.dateKey}.`);
          if (summary.missingDates.length > 0) {
            console.log(`Missing cache dates: ${summary.missingDates.join(', ')}`);
          }
          return;
        }

        if (scoring === 'distinctive' && !background) {
          console.error(NO_BACKGROUND);
        }

        console.log(
          usedScoring === 'distinctive'
            ? `Distinctive words on ${summary.range.dateKey}`
            : `Words on ${summary.range.dateKey}`,
        );
        ranking.forEach((item, index) => {
          const row = item as { word: string; count: number; score?: number };
          const score = row.score === undefined ? '' : ` (${row.score.toFixed(1)})`;
          console.log(`${index + 1}. ${row.word}: ${row.count}${score}`);
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

function rebuildBackground(asJson: boolean): void {
  // Tokenizing the whole archive takes over a minute, so it says it is working.
  let lastReport = 0;
  const result = buildBackground((documents) => {
    if (asJson) return;
    if (documents - lastReport < 20000) return;
    lastReport = documents;
    process.stderr.write(`  ${documents} bookmarks read\n`);
  });

  if (asJson) {
    console.log(JSON.stringify({
      path: result.path,
      documents: result.documents,
      vocabulary: result.vocabulary,
      words_kept: result.kept,
      first_day: result.firstDay,
      last_day: result.lastDay,
      seconds: Number(result.seconds.toFixed(1)),
    }, null, 2));
    return;
  }

  console.log(
    `Background model built from ${result.documents} bookmarks ` +
      `(${result.firstDay} to ${result.lastDay}) in ${result.seconds.toFixed(1)}s.`,
  );
  console.log(`${result.kept} words kept of ${result.vocabulary} seen.`);
  console.log(result.path);
}
