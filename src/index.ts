#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { fetchBookmarksByDate } from './api';
import { saveCache, loadCache, getCacheDir } from './storage';
import { ensureHatenaUser, getStoredConfig, setStoredConfig } from './credentials';
import { isDateKey, searchBookmarks, type SearchField } from './searchIndex';

const program = new Command();

program
  .name('hatebu')
  .description('Hatena Bookmark CLI for AI Secretary')
  .version('1.0.0');

// Config Command
const configCmd = program.command('config').description('Manage configuration');

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action((key, value) => {
    setStoredConfig(key, value);
  });

configCmd
  .command('get <key>')
  .description('Get a configuration value')
  .action((key) => {
    const value = getStoredConfig(key);
    if (value) {
      if (key === 'token') {
        const masked = value.length > 8 
          ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}`
          : '********';
        console.log(masked);
      } else {
        console.log(value);
      }
    } else {
      console.error(`Config key '${key}' not found.`);
      process.exit(1);
    }
  });

function isToday(date: Date): boolean {
  const today = new Date();
  return date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
}

function parsePositiveIntegerOption(value: string, optionName: string): number {
  if (!/^\d+$/.test(value)) {
    console.error(`Error: ${optionName} must be a positive integer.`);
    process.exit(1);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    console.error(`Error: ${optionName} must be a positive integer.`);
    process.exit(1);
  }
  return parsed;
}

function parseSearchField(value: string): SearchField {
  if (value === 'all' || value === 'title' || value === 'url') {
    return value;
  }
  console.error('Error: --field must be one of "all", "title", or "url".');
  process.exit(1);
}

program
  .command('list')
  .alias('ls')
  .description('List bookmarks for a specific date')
  .option('-d, --date <yyyy-mm-dd>', 'target date')
  .option('-j, --json', 'output as JSON')
  .action(async (options) => {
    const user = await ensureHatenaUser();
    const targetDate = options.date ? new Date(options.date) : new Date();
    
    let bookmarks;
    if (isToday(targetDate)) {
      if (!options.json) console.error(`Today's bookmarks: Fetching fresh data from API...`);
      bookmarks = await fetchBookmarksByDate(user, targetDate);
    } else {
      bookmarks = loadCache(targetDate);
    }
    
    if (!bookmarks || bookmarks.length === 0) {
      if (options.json) {
        console.log(JSON.stringify([]));
      } else {
        console.log(`No bookmarks found for ${targetDate.toISOString().split('T')[0]}.`);
      }
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(bookmarks, null, 2));
    } else {
      console.log(`--- Bookmarks for ${targetDate.toISOString().split('T')[0]} ---`);
      bookmarks.forEach((b: any) => {
        console.log(`- ${b.title}\n  ${b.link}`);
      });
    }
  });

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

program
  .command('sync')
  .description('Sync bookmarks from Hatena RSS (excluding today)')
  .option('--days <number>', 'number of days to sync', '1')
  .option('-d, --date <yyyy-mm-dd>', 'specific date to sync')
  .action(async (options) => {
    const user = await ensureHatenaUser();
    if (options.date) {
      const targetDate = new Date(options.date);
      if (isToday(targetDate)) {
        console.error("Warning: Syncing today's bookmarks is not recommended as it's still changing.");
      }
      console.log(`Syncing bookmarks for ${options.date}...`);
      const bookmarks = await fetchBookmarksByDate(user, targetDate);
      saveCache(targetDate, bookmarks);
      console.log(`Saved ${bookmarks.length} bookmarks.`);
    } else {
      const days = parseInt(options.days, 10);
      console.log(`Syncing bookmarks for the last ${days} days (excluding today)...`);
      for (let i = 1; i <= days; i++) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - i);
        const dateStr = targetDate.toISOString().split('T')[0];
        console.log(`Syncing bookmarks for ${dateStr}...`);
        const bookmarks = await fetchBookmarksByDate(user, targetDate);
        saveCache(targetDate, bookmarks);
        console.log(`Saved ${bookmarks.length} bookmarks.`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  });

program
  .command('import <dir>')
  .description('Import legacy bookmarks from a directory (e.g., hatebu-ai/public/data)')
  .action(async (dir) => {
    const sourceDir = path.resolve(dir);
    const targetDir = getCacheDir();
    console.log(`Importing legacy data from ${sourceDir} to ${targetDir}...`);

    if (!fs.existsSync(sourceDir)) {
      console.error(`Error: Source directory ${sourceDir} does not exist.`);
      process.exit(1);
    }

    const years = fs.readdirSync(sourceDir).filter(f => /^[0-9]{4}$/.test(f));
    let totalFiles = 0;

    for (const year of years) {
      const yearPath = path.join(sourceDir, year);
      const months = fs.readdirSync(yearPath).filter(f => /^[0-9]{2}$/.test(f));
      
      for (const month of months) {
        const monthPath = path.join(yearPath, month);
        const days = fs.readdirSync(monthPath).filter(f => f.endsWith('.json'));
        
        const destMonthDir = path.join(targetDir, year, month);
        if (!fs.existsSync(destMonthDir)) {
          fs.mkdirSync(destMonthDir, { recursive: true });
        }

        for (const dayFile of days) {
          const src = path.join(monthPath, dayFile);
          const dest = path.join(destMonthDir, dayFile);
          fs.copyFileSync(src, dest);
          totalFiles++;
        }
      }
      process.stdout.write(`.`);
    }
    console.log(`\nImport complete. Copied ${totalFiles} days of bookmarks.`);
  });

program.parseAsync(process.argv);
