/**
 * Option validation that the commands and the MCP server both need. The
 * exiting forms keep the messages the CLI has always printed; the `try` forms
 * are what a server uses, because it must answer one bad argument rather than
 * take the process down.
 */
import {
  DATE_OPTION_PROBLEMS,
  tryParseDateOption,
  tryParseDayOption,
  buildRecentWeekRangeUntilYesterday,
  type ParsedDateOption,
} from './dates';

export function tryParsePositiveInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export function parsePositiveIntegerOption(value: string, optionName: string): number {
  const parsed = tryParsePositiveInteger(value);
  if (parsed === undefined) {
    console.error(`Error: ${optionName} must be a positive integer.`);
    process.exit(1);
  }
  return parsed;
}

export function parseDateOption(value?: string): ParsedDateOption {
  const parsed = tryParseDateOption(value);
  if (!parsed.ok) {
    console.error(`Error: ${DATE_OPTION_PROBLEMS[parsed.problem]}`);
    process.exit(1);
  }
  return parsed.value;
}

export function parseDayOption(value: string): Date {
  const parsed = tryParseDayOption(value);
  if (!parsed.ok) {
    console.error(`Error: ${DATE_OPTION_PROBLEMS[parsed.problem]}`);
    process.exit(1);
  }
  return parsed.value;
}

/**
 * The range the ranking commands work over: today with `--today`, the given
 * date with `--date`, and otherwise the week ending yesterday.
 */
export function resolveRankingRangeOption(options: { date?: string; today?: boolean }): ParsedDateOption {
  if (options.today && options.date) {
    console.error('Error: --today and --date cannot be used together.');
    process.exit(1);
  }
  if (options.today) {
    return parseDateOption();
  }
  if (options.date) {
    return parseDateOption(options.date);
  }
  return buildRecentWeekRangeUntilYesterday();
}
