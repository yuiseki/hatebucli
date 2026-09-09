#!/usr/bin/env node
import { Command } from 'commander';
import { registerConfigCommand } from './commands/config';
import { registerListCommand } from './commands/list';
import { registerSearchCommand } from './commands/search';
import { registerDomainsCommand } from './commands/domains';
import { registerTagsCommand } from './commands/tags';
import { registerWordsCommand } from './commands/words';
import { registerStatsCommand } from './commands/stats';
import { registerSyncCommand } from './commands/sync';
import { registerImportCommand } from './commands/import';

/**
 * The published tarball always contains package.json, and dist/ sits one level
 * below it, so this holds both in the repository and once installed. Hardcoding
 * the version here is how it drifts from what npm actually shipped.
 */
function cliVersion(): string {
  return require('../package.json').version as string;
}

const program = new Command();

program
  .name('hatebu')
  .description('Hatena Bookmark CLI for AI Secretary')
  .version(cliVersion());

// In the order --help should print them.
registerConfigCommand(program);
registerListCommand(program);
registerSearchCommand(program);
registerDomainsCommand(program);
registerTagsCommand(program);
registerWordsCommand(program);
registerStatsCommand(program);
registerSyncCommand(program);
registerImportCommand(program);

program.parseAsync(process.argv);
