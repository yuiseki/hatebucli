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
  .option('--mcp-server', 'run as a Model Context Protocol server over stdio')
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

/**
 * The MCP server is not a commander command: it owns stdout for the whole
 * process, which does not fit inside an action that shares stdout with the
 * usual human-readable output. The spellings a client is likely to be
 * configured with all work.
 */
const MCP_INVOCATIONS = new Set(['--mcp-server', '--mcp', 'mcp-server', 'mcp']);

function isMcpInvocation(argv: string[]): boolean {
  const first = argv.slice(2)[0];
  return first !== undefined && MCP_INVOCATIONS.has(first);
}

if (isMcpInvocation(process.argv)) {
  // Required lazily: the MCP SDK is a large import that every other command
  // would otherwise pay for at startup.
  const { runMcpServer } = require('./mcp') as typeof import('./mcp');
  runMcpServer().catch((error: any) => {
    console.error('MCP server failed:', error?.message || error);
    process.exit(1);
  });
} else {
  program.parseAsync(process.argv);
}
