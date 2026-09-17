import { Command } from 'commander';
import { parseDateOption, parsePositiveIntegerOption } from '../options';
import {
  compareSides,
  countSide,
  type CompareDimension,
  type Shift,
} from '../services/compare';

const MAX_LIMIT = 50;

function parseDimension(value: string): CompareDimension {
  if (value === 'words' || value === 'domains' || value === 'tags') return value;
  console.error('Error: --by must be one of "words", "domains" or "tags".');
  process.exit(1);
}

export function registerCompareCommand(program: Command): void {
  program
    .command('compare <a> <b>')
    .description('What changed between two stretches: what rose, and what fell away')
    .option('--by <words|domains|tags>', 'what to compare', 'words')
    .option('-l, --limit <number>', `rows per side (max: ${MAX_LIMIT})`, '10')
    .option('-j, --json', 'output as JSON')
    .action(async (aOption, bOption, options) => {
      try {
        const dimension = parseDimension(options.by);
        const limit = Math.min(parsePositiveIntegerOption(options.limit, '--limit'), MAX_LIMIT);

        const a = await countSide(parseDateOption(aOption), dimension);
        const b = await countSide(parseDateOption(bOption), dimension);
        const { risen, fallen } = compareSides(a, b, limit);

        const empty = a.bookmarkCount === 0 || b.bookmarkCount === 0;
        const note = empty
          ? 'One of the two has nothing in it, so there is nothing to compare.'
          : undefined;

        if (options.json) {
          console.log(JSON.stringify({
            by: dimension,
            a: { date: a.range.dateKey, bookmark_count: a.bookmarkCount, missing_dates: a.missingDates },
            b: { date: b.range.dateKey, bookmark_count: b.bookmarkCount, missing_dates: b.missingDates },
            ...(note ? { note } : {}),
            risen,
            fallen,
          }, null, 2));
          return;
        }

        console.log(
          `${a.range.dateKey} (${a.bookmarkCount}) to ${b.range.dateKey} (${b.bookmarkCount}), by ${dimension}`,
        );
        if (note) {
          console.log(note);
          return;
        }

        console.log('');
        console.log(`More in ${b.range.dateKey}`);
        print(risen);
        console.log('');
        console.log(`More in ${a.range.dateKey}`);
        print(fallen);
      } catch (error: any) {
        console.error('Error comparing:', error.message);
        process.exit(1);
      }
    });
}

function print(rows: Shift[]): void {
  if (rows.length === 0) {
    console.log('  (nothing)');
    return;
  }
  for (const row of rows) {
    // Counts and rates: the counts say how much, the rates say how much of it.
    console.log(
      `  ${row.word}: ${row.a} → ${row.b}  (${row.aPer1000} → ${row.bPer1000} per 1000)`,
    );
  }
}
