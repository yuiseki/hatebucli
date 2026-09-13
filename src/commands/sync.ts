import { Command } from 'commander';
import { fetchBookmarksByDate } from '../api';
import { ensureHatenaUser } from '../credentials';
import { formatDateYmd, isToday } from '../dates';
import { parseDayOption, parsePositiveIntegerOption } from '../options';
import { saveCache } from '../storage';

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Sync bookmarks from Hatena RSS (excluding today)')
    .option('--days <number>', 'number of days to sync', '1')
    .option('-d, --date <yyyy-mm-dd>', 'specific date to sync')
    .action(async (options) => {
      if (options.date && options.days && options.days !== '1') {
        console.error('Error: --date and --days cannot be used together.');
        process.exit(1);
      }

      const user = await ensureHatenaUser();
      if (options.date) {
        const targetDate = parseDayOption(options.date);
        if (isToday(targetDate)) {
          console.error("Warning: Syncing today's bookmarks is not recommended as it's still changing.");
        }
        console.log(`Syncing bookmarks for ${options.date}...`);
        const bookmarks = await fetchBookmarksByDate(user, targetDate);
        if (bookmarks === null) {
          // Caching the failure would replace a good day with an empty one.
          console.error(`${options.date} could not be fetched; the cache is unchanged.`);
          process.exit(1);
        }
        saveCache(targetDate, bookmarks);
        console.log(`Saved ${bookmarks.length} bookmarks.`);
        return;
      }

      const days = parsePositiveIntegerOption(options.days, '--days');
      console.log(`Syncing bookmarks for the last ${days} days (excluding today)...`);
      let failed = 0;
      for (let i = 1; i <= days; i++) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - i);
        const label = formatDateYmd(targetDate);
        console.log(`Syncing bookmarks for ${label}...`);
        const bookmarks = await fetchBookmarksByDate(user, targetDate);
        if (bookmarks === null) {
          console.error(`${label} could not be fetched; the cache is unchanged.`);
          failed += 1;
          continue;
        }
        saveCache(targetDate, bookmarks);
        console.log(`Saved ${bookmarks.length} bookmarks.`);
        // The feed is somebody else's server, so the days are spaced out.
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (failed > 0) {
        process.exit(1);
      }
    });
}
