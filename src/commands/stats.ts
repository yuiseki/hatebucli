import { Command } from 'commander';
import { buildStatsDateRangeFrom, weeklyStatsDateRange, type StatsDateRange } from '../dates';
import { parseDateOption, parsePositiveIntegerOption } from '../options';
import { buildStatsSummary, renderStatsMarkdown } from '../services/analytics';

const MAX_TOP = 20;

function buildStatsDateRange(dateOption: string | undefined, daysOption: string): StatsDateRange {
  // No options at all means the same week the ranking commands default to.
  if (!dateOption && daysOption === '7') {
    return weeklyStatsDateRange();
  }
  const days = parsePositiveIntegerOption(daysOption, '--days');
  const anchor = dateOption ? parseDateOption(dateOption) : undefined;
  return buildStatsDateRangeFrom(anchor, days);
}

export function registerStatsCommand(program: Command): void {
  program
    .command('stats')
    .description('Show weekly stats summary in Markdown')
    .option('--date <yyyy|yyyy-mm|yyyy-mm-dd>', 'window end date anchor (default: yesterday)')
    .option('--days <number>', 'window length in days', '7')
    .option('--top <number>', 'rows per section', '10')
    .action(async (options) => {
      try {
        const dateRange = buildStatsDateRange(options.date, options.days || '7');
        const top = Math.min(parsePositiveIntegerOption(options.top, '--top'), MAX_TOP);
        const summary = await buildStatsSummary(dateRange);
        console.log(renderStatsMarkdown(summary, top));
      } catch (error: any) {
        console.error('Error building stats:', error.message);
        process.exit(1);
      }
    });
}
