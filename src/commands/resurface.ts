import { Command } from 'commander';
import { parsePositiveIntegerOption } from '../options';
import { loadBackground } from '../services/background';
import { resurface } from '../services/resurface';

export function registerResurfaceCommand(program: Command): void {
  program
    .command('resurface')
    .description('What the archive cared about and has stopped mentioning')
    .option('-l, --limit <number>', 'rows to return', '20')
    .option('--min-total <number>', 'bookmarks a word needs to count as a subject', '20')
    .option('--recent-years <number>', 'how many of the latest years count as now', '2')
    .option('--peaked-after <year>', 'only subjects whose height was in or after this year')
    .option('--peaked-before <year>', 'only subjects whose height was in or before this year')
    .option('-j, --json', 'output as JSON')
    .action((options) => {
      const background = loadBackground();
      if (!background) {
        console.error(
          'Error: no background model. Build one with `hatebu words --rebuild-background`.',
        );
        process.exit(1);
      }
      if (!background.years) {
        console.error(
          'Error: the background model on disk has no breakdown by year. Rebuild it ' +
            'with `hatebu words --rebuild-background`.',
        );
        process.exit(1);
      }

      for (const [name, value] of [
        ['--peaked-after', options.peakedAfter],
        ['--peaked-before', options.peakedBefore],
      ] as const) {
        if (value !== undefined && !/^\d{4}$/.test(value)) {
          console.error(`Error: ${name} must be a year, as 2015.`);
          process.exit(1);
        }
      }

      const rows = resurface(background, {
        limit: Math.min(parsePositiveIntegerOption(options.limit, '--limit'), 100),
        minTotal: parsePositiveIntegerOption(options.minTotal, '--min-total'),
        recentYears: parsePositiveIntegerOption(options.recentYears, '--recent-years'),
        peakedAfter: options.peakedAfter,
        peakedBefore: options.peakedBefore,
      });

      if (options.json) {
        console.log(JSON.stringify({ built_at: background.builtAt, rows }, null, 2));
        return;
      }

      if (rows.length === 0) {
        console.log('Nothing has gone quiet enough to bring back.');
        return;
      }

      console.log('word            peak year   then     now   dormant');
      for (const row of rows) {
        console.log(
          `${row.word.padEnd(15)} ${row.peak_year}   ` +
            `${String(row.peak_per_1000).padStart(6)}  ${String(row.recent_per_1000).padStart(6)}   ` +
            `${row.dormant_years}y   (${row.total} bookmarks)`,
        );
      }
      console.log('');
      console.log('then and now are per thousand bookmarks of the year.');
    });
}
