import { Command } from 'commander';
import { isDateKey } from '../dates';
import { buildTimeline } from '../services/queries';

function parseBoundOption(value: string | undefined, optionName: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isDateKey(value)) {
    console.error(`Error: ${optionName} must be a valid yyyy-mm-dd.`);
    process.exit(1);
  }
  return value;
}

export function registerTimelineCommand(program: Command): void {
  program
    .command('timeline')
    .description('Count bookmarks over time, optionally about one subject')
    .option('--by <year|month>', 'bucket size', 'year')
    .option('--tag <tag>', 'only bookmarks under this tag')
    .option('--domain <domain>', 'only bookmarks from this site, subdomains included')
    .option('--query <text>', 'only bookmarks whose title or URL contains this')
    .option('--from <yyyy-mm-dd>', 'earliest day to count')
    .option('--to <yyyy-mm-dd>', 'latest day to count')
    .option('--bars', 'draw a bar for each row')
    .option('-j, --json', 'output as JSON')
    .action((options) => {
      if (options.by !== 'year' && options.by !== 'month') {
        console.error('Error: --by must be "year" or "month".');
        process.exit(1);
      }
      const from = parseBoundOption(options.from, '--from');
      const to = parseBoundOption(options.to, '--to');

      const filter = { tag: options.tag, domain: options.domain, query: options.query, from, to };
      const { rows, total, scannedBookmarks } = buildTimeline(filter, options.by);

      if (options.json) {
        console.log(JSON.stringify({
          by: options.by,
          filter: {
            ...(options.tag ? { tag: options.tag } : {}),
            ...(options.domain ? { domain: options.domain } : {}),
            ...(options.query ? { query: options.query } : {}),
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
          },
          total,
          scanned_bookmarks: scannedBookmarks,
          rows,
        }, null, 2));
        return;
      }

      if (rows.length === 0) {
        console.log('No bookmarks matched.');
        return;
      }

      const widest = rows.reduce((most, row) => Math.max(most, row.count), 0);
      for (const row of rows) {
        const bar = options.bars
          ? ` ${'#'.repeat(Math.max(1, Math.round((row.count / widest) * 40)))}`
          : '';
        console.log(`${row.period}\t${row.count}${bar}`);
      }
      console.log(`Total: ${total}`);
    });
}
