import { Command } from 'commander';
import { parsePositiveIntegerOption } from '../options';
import { findBookmarks } from '../services/queries';

export function registerTaggedCommand(program: Command): void {
  program
    .command('tagged <tag>')
    .description('The bookmarks filed under one tag, newest first')
    .option('-l, --limit <number>', 'maximum bookmarks to show', '20')
    .option('-j, --json', 'output as JSON')
    .action((tag, options) => {
      const limit = parsePositiveIntegerOption(options.limit, '--limit');
      const found = findBookmarks({ tag }, limit);

      if (options.json) {
        console.log(JSON.stringify({
          tag,
          match_count: found.matchCount,
          first_bookmarked: found.first?.dateKey,
          last_bookmarked: found.last?.dateKey,
          bookmarks: found.entries,
        }, null, 2));
        return;
      }

      if (found.matchCount === 0) {
        console.log(`No bookmarks tagged #${tag}.`);
        return;
      }

      console.log(`#${tag}: ${found.matchCount} bookmarks`);
      found.entries.forEach((entry) => {
        console.log(`- [${entry.dateKey}] ${entry.title}`);
        console.log(`  ${entry.link}`);
      });
      if (found.matchCount > found.entries.length) {
        console.log(`(showing ${found.entries.length} of ${found.matchCount})`);
      }
    });
}
