import { Command } from 'commander';
import { isDateKey } from '../dates';
import { parsePositiveIntegerOption } from '../options';
import { searchBookmarks, type SearchField } from '../services/search';

function parseSearchField(value: string): SearchField {
  if (value === 'all' || value === 'title' || value === 'url') {
    return value;
  }
  console.error('Error: --field must be one of "all", "title", or "url".');
  process.exit(1);
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('Search bookmarks from local cache')
    .option('-f, --field <all|title|url>', 'search field', 'all')
    .option('-d, --date <yyyy-mm-dd>', 'target date')
    .option('-l, --limit <number>', 'maximum results', '10')
    .option('-j, --json', 'output as JSON')
    .action((query, options) => {
      const normalizedQuery = query.trim();
      if (normalizedQuery.length === 0) {
        console.error('Error: query must not be empty.');
        process.exit(1);
      }

      const field = parseSearchField(options.field);
      const limit = parsePositiveIntegerOption(options.limit, '--limit');

      if (options.date && !isDateKey(options.date)) {
        console.error('Error: --date must be a valid yyyy-mm-dd.');
        process.exit(1);
      }

      const results = searchBookmarks(normalizedQuery, {
        dateKey: options.date,
        field,
        limit,
      });

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        if (options.date) {
          console.log(`No matching bookmarks found for ${options.date}.`);
        } else {
          console.log('No matching bookmarks found.');
        }
        return;
      }

      results.forEach((result, index) => {
        console.log(`${index + 1}. [${result.dateKey}] ${result.title}`);
        console.log(`   ${result.link}`);
      });
    });
}
