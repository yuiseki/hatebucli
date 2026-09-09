/**
 * Local days, the ranges the commands accept, and the labels they print.
 *
 * Everything here works in local time. The cache paths, the feed's `date`
 * parameter and the timestamps inside a bookmark are all local, so a UTC day
 * would be the wrong day for part of every day.
 *
 * Each parser comes in two forms. `try*` reports a problem and returns it;
 * the plain form prints the message the CLI has always printed and exits.
 * A server cannot exit over one bad argument, which is why the pure form
 * exists at all.
 */

export type ParsedDateOption = {
  granularity: 'day' | 'month' | 'year';
  dateKey: string;
  start: Date;
  end: Date;
};

export type DateOptionProblem = 'month' | 'day' | 'format' | 'dayOption';

export const DATE_OPTION_PROBLEMS: Record<DateOptionProblem, string> = {
  month: '--date month is invalid.',
  day: '--date day is invalid.',
  format: '--date format must be yyyy or yyyy-mm or yyyy-mm-dd.',
  dayOption: '--date must be a valid yyyy-mm-dd.',
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; problem: DateOptionProblem };

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const probe = new Date(year, month - 1, day);
  return probe.getFullYear() === year &&
    probe.getMonth() === month - 1 &&
    probe.getDate() === day;
}

export function isToday(date: Date): boolean {
  const today = new Date();
  return date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
}

export function formatDateYmd(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayAsDateOption(): ParsedDateOption {
  const today = new Date();
  return {
    granularity: 'day',
    dateKey: formatDateYmd(today),
    start: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0),
    end: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999),
  };
}

/** `yyyy`, `yyyy-mm` or `yyyy-mm-dd`. Nothing at all means today. */
export function tryParseDateOption(value?: string): ParseResult<ParsedDateOption> {
  if (!value) {
    return { ok: true, value: todayAsDateOption() };
  }

  if (/^\d{4}$/.test(value)) {
    const year = Number(value);
    return {
      ok: true,
      value: {
        granularity: 'year',
        dateKey: value,
        start: new Date(year, 0, 1, 0, 0, 0, 0),
        end: new Date(year, 11, 31, 23, 59, 59, 999),
      },
    };
  }

  if (/^\d{4}-\d{2}$/.test(value)) {
    const [yearText, monthText] = value.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    const probe = new Date(year, month - 1, 1);
    if (probe.getFullYear() !== year || probe.getMonth() !== month - 1) {
      return { ok: false, problem: 'month' };
    }
    return {
      ok: true,
      value: {
        granularity: 'month',
        dateKey: value,
        start: new Date(year, month - 1, 1, 0, 0, 0, 0),
        end: new Date(year, month, 0, 23, 59, 59, 999),
      },
    };
  }

  if (DATE_KEY_PATTERN.test(value)) {
    if (!isDateKey(value)) {
      return { ok: false, problem: 'day' };
    }
    const [year, month, day] = value.split('-').map(Number);
    return {
      ok: true,
      value: {
        granularity: 'day',
        dateKey: value,
        start: new Date(year, month - 1, day, 0, 0, 0, 0),
        end: new Date(year, month - 1, day, 23, 59, 59, 999),
      },
    };
  }

  return { ok: false, problem: 'format' };
}

/**
 * The `-d, --date <yyyy-mm-dd>` options that name one day, as a local Date.
 * `new Date('2026-02-18')` is UTC midnight, which is a different day from the
 * one the cache paths are written in.
 */
export function tryParseDayOption(value: string): ParseResult<Date> {
  if (!isDateKey(value)) {
    return { ok: false, problem: 'dayOption' };
  }
  const [year, month, day] = value.split('-').map(Number);
  return { ok: true, value: new Date(year, month - 1, day, 0, 0, 0, 0) };
}

export function buildRecentWeekRangeUntilYesterday(): ParsedDateOption {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 23, 59, 59, 999);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 8, 0, 0, 0, 0);

  return {
    granularity: 'day',
    dateKey: `${formatDateYmd(start)}..${formatDateYmd(end)}`,
    start,
    end,
  };
}

export function getDateListInRange(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0);

  while (cursor.getTime() <= last.getTime()) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

export type StatsDateRange = {
  range: ParsedDateOption;
  days: number;
  startLabel: string;
  endLabel: string;
};

/**
 * The stats window: `days` days ending on the anchor, which defaults to
 * yesterday. The seven-day default is the same range the ranking commands use
 * with no options, so the two agree when neither is given anything.
 */
export function buildStatsDateRangeFrom(anchor: ParsedDateOption | undefined, days: number): StatsDateRange {
  const endDate = anchor
    ? new Date(anchor.end)
    : (() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
      })();

  const startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - (days - 1));

  const startLabel = formatDateYmd(startDate);
  const endLabel = formatDateYmd(endDate);

  return {
    range: {
      granularity: 'day',
      dateKey: `${startLabel}..${endLabel}`,
      start: startDate,
      end: endDate,
    },
    days,
    startLabel,
    endLabel,
  };
}

export function weeklyStatsDateRange(): StatsDateRange {
  const weekly = buildRecentWeekRangeUntilYesterday();
  return {
    range: weekly,
    days: 7,
    startLabel: formatDateYmd(weekly.start),
    endLabel: formatDateYmd(weekly.end),
  };
}
