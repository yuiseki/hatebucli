import { Command } from 'commander';
import { formatDateYmd, isToday } from '../dates';
import { parseDayOption } from '../options';
import { loadDay } from '../services/bookmarks';

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('List bookmarks for a specific date')
    .option('-d, --date <yyyy-mm-dd>', 'target date')
    .option('-j, --json', 'output as JSON')
    .action(async (options) => {
      const targetDate = options.date ? parseDayOption(options.date) : new Date();
      const targetLabel = formatDateYmd(targetDate);

      if (isToday(targetDate) && !options.json) {
        console.error(`Today's bookmarks: Fetching fresh data from API...`);
      }
      const bookmarks = await loadDay(targetDate);

      if (!bookmarks || bookmarks.length === 0) {
        if (options.json) {
          console.log(JSON.stringify([]));
        } else {
          console.log(`No bookmarks found for ${targetLabel}.`);
        }
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(bookmarks, null, 2));
      } else {
        console.log(`--- Bookmarks for ${targetLabel} ---`);
        bookmarks.forEach((bookmark) => {
          console.log(`- ${bookmark.title}\n  ${bookmark.link}`);
        });
      }
    });
}
