import { Command } from 'commander';
import { parsePositiveIntegerOption } from '../options';
import { lookup } from '../services/queries';

export function registerLookupCommand(program: Command): void {
  program
    .command('lookup <url-or-domain>')
    .description('Ask whether a page or a site has been bookmarked, and when')
    .option('-l, --limit <number>', 'maximum bookmarks to show', '10')
    .option('-j, --json', 'output as JSON')
    .action((input, options) => {
      const limit = parsePositiveIntegerOption(options.limit, '--limit');
      const result = lookup(input, limit);

      if (options.json) {
        console.log(JSON.stringify({
          input: result.input,
          kind: result.kind,
          domain: result.domain,
          bookmarked: result.bookmarked,
          match_count: result.matchCount,
          first_bookmarked: result.first?.dateKey,
          last_bookmarked: result.last?.dateKey,
          ...(result.sameDomainCount === undefined
            ? {}
            : { same_domain_count: result.sameDomainCount }),
          bookmarks: result.entries,
        }, null, 2));
        return;
      }

      if (!result.bookmarked) {
        console.log(`Not bookmarked: ${result.input}`);
        if (result.sameDomainCount) {
          console.log(`${result.sameDomainCount} bookmarks from ${result.domain} though.`);
        }
        return;
      }

      const times = result.matchCount === 1 ? 'once' : `${result.matchCount} times`;
      console.log(`Bookmarked ${times}: ${result.input}`);
      if (result.first && result.last && result.first.dateKey !== result.last.dateKey) {
        console.log(`First ${result.first.dateKey}, last ${result.last.dateKey}`);
      }
      result.entries.forEach((entry) => {
        console.log(`- [${entry.dateKey}] ${entry.title}`);
        console.log(`  ${entry.link}`);
      });
    });
}
