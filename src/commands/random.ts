import { Command } from 'commander';
import { parsePositiveIntegerOption } from '../options';
import { randomBookmarks } from '../services/queries';

export function registerRandomCommand(program: Command): void {
  program
    .command('random')
    .description('A few bookmarks at random, for digging something out of the archive')
    .option('-n, --count <number>', 'how many to return', '5')
    .option('--tag <tag>', 'only bookmarks under this tag')
    .option('--domain <domain>', 'only bookmarks from this site')
    .option('--query <text>', 'only bookmarks whose title or URL contains this')
    .option('--from <yyyy-mm-dd>', 'earliest day to draw from')
    .option('--to <yyyy-mm-dd>', 'latest day to draw from')
    .option('-j, --json', 'output as JSON')
    .action((options) => {
      const count = parsePositiveIntegerOption(options.count, '--count');
      const { entries, matchCount } = randomBookmarks(
        {
          tag: options.tag,
          domain: options.domain,
          query: options.query,
          from: options.from,
          to: options.to,
        },
        count,
      );

      if (options.json) {
        console.log(JSON.stringify({ match_count: matchCount, bookmarks: entries }, null, 2));
        return;
      }

      if (entries.length === 0) {
        console.log('No bookmarks matched.');
        return;
      }

      entries.forEach((entry) => {
        console.log(`- [${entry.dateKey}] ${entry.title}`);
        console.log(`  ${entry.link}`);
      });
      console.log(`(drawn from ${matchCount} bookmarks)`);
    });
}
