import { Command } from 'commander';
import { parseBoundOption, parsePositiveIntegerOption } from '../options';
import { findBursts } from '../services/queries';

export function registerBurstsCommand(program: Command): void {
  program
    .command('bursts')
    .description('When a subject flared up, and how far above its usual rate')
    .option('--tag <tag>', 'only bookmarks under this tag')
    .option('--domain <domain>', 'only bookmarks from this site, subdomains included')
    .option('--query <text>', 'only bookmarks whose title or URL contains this')
    .option('--from <yyyy-mm-dd>', 'earliest day to look at')
    .option('--to <yyyy-mm-dd>', 'latest day to look at')
    .option('--lift <number>', 'times the usual rate a month must run at', '3')
    .option('--min-count <number>', 'matches a month needs before it counts', '3')
    .option('-j, --json', 'output as JSON')
    .action((options) => {
      if (!options.tag && !options.domain && !options.query) {
        console.error('Error: bursts needs --query, --tag or --domain to look for.');
        process.exit(1);
      }

      const lift = Number(options.lift);
      if (!Number.isFinite(lift) || lift <= 1) {
        console.error('Error: --lift must be a number greater than 1.');
        process.exit(1);
      }
      const minCount = parsePositiveIntegerOption(options.minCount, '--min-count');

      const filter = {
        tag: options.tag,
        domain: options.domain,
        query: options.query,
        from: parseBoundOption(options.from, '--from'),
        to: parseBoundOption(options.to, '--to'),
      };
      const report = findBursts(filter, { lift, minCount });

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      const subject = options.query ?? options.tag ?? options.domain;
      console.log(
        `${subject}: ${report.total} bookmarks, usually ${report.baseline_per_1000} per 1000`,
      );
      if (report.bursts.length === 0) {
        console.log('No stretch ran far enough above that to call a burst.');
        return;
      }
      for (const burst of report.bursts) {
        const span = burst.from === burst.to ? burst.from : `${burst.from}..${burst.to}`;
        console.log(
          `  ${span}  ${burst.count} bookmarks, peak ${burst.peak_month} ` +
            `at ${burst.peak_per_1000} per 1000 (${burst.lift}x)`,
        );
      }
    });
}
