import { Command } from 'commander';
import {
  DATE_OPTION_PROBLEMS,
  formatDateYmd,
  isDateKey,
  lastCompleteMonth,
  lastCompleteWeek,
  tryParseDateOption,
  weekOf,
} from '../dates';
import {
  extractBookmarkTags,
  extractDomain,
  hatenaEntryUrl,
  parseBookmarkTimestamp,
} from '../format';
import { parseDateOption } from '../options';
import { fetchBookmarksByDate } from '../api';
import { resolveHatenaUser } from '../credentials';
import { readCachedDay } from '../services/archive';
import { findBookmarks, type ArchiveEntry } from '../services/queries';
import { saveCache } from '../storage';
import { isToday } from '../dates';

/**
 * The rounds, and what each one chooses from. A round reads the tag the
 * previous one wrote, which is why nothing here has to remember anything: the
 * tags live on Hatena and come back through `hatebu sync`.
 */
const ROUNDS = {
  daily: { tag: 'daily_best', from: null },
  weekly: { tag: 'weekly_best', from: 'daily_best' },
  monthly: { tag: 'monthly_best', from: 'weekly_best' },
} as const;

type Round = keyof typeof ROUNDS;

type Candidate = ArchiveEntry & { entryUrl?: string; alreadyTagged: boolean };

export function registerPickCommand(program: Command): void {
  program
    .command('pick [number]')
    .description('Lay out the candidates for a best-of round, and give the page to tag')
    .option('-d, --date <yyyy-mm-dd|yyyy-mm>', 'the day, or the month for --monthly')
    .option('--weekly', 'choose a weekly_best from the week of daily_best')
    .option('--monthly', 'choose a monthly_best from the month of weekly_best')
    .option('--all', 'list the candidates even when the round is already decided')
    .option('--no-sync', 'read the cache as it stands, without fetching the window first')
    .option('-j, --json', 'output as JSON')
    .action(async (numberArg, options) => {
      const round: Round = options.monthly ? 'monthly' : options.weekly ? 'weekly' : 'daily';
      if (options.weekly && options.monthly) {
        console.error('Error: --weekly and --monthly cannot be used together.');
        process.exit(1);
      }

      const window = resolveWindow(round, options.date);

      // A tag added on the entry page is invisible until that day is fetched
      // again, so a round that looks undecided may only look that way. Fetch
      // the window before saying so; a round the cache already shows as
      // decided is worth no requests.
      let candidates = collectCandidates(round, window);
      if (options.sync && !candidates.some((candidate) => candidate.alreadyTagged)) {
        const fetched = await syncWindow(window, Boolean(options.json));
        if (fetched) {
          candidates = collectCandidates(round, window);
        }
      }

      if (numberArg === undefined) {
        // A round that is already decided has nothing to choose, so it shows
        // what was chosen instead of eighty-six candidates to read again.
        const chosen = candidates.filter((candidate) => candidate.alreadyTagged);
        if (chosen.length > 0 && !options.all) {
          reportDecided(round, window, chosen, candidates.length, Boolean(options.json));
          return;
        }
        report(round, window, candidates, Boolean(options.json));
        return;
      }

      if (!/^\d+$/.test(numberArg)) {
        console.error('Error: the candidate to pick must be a number from the list.');
        process.exit(1);
      }
      if (candidates.length === 0) {
        console.error(`Error: No candidates for ${window.label}.`);
        process.exit(1);
      }
      const index = Number(numberArg);
      if (index < 1 || index > candidates.length) {
        console.error(
          `Error: pick a number between 1 and ${candidates.length}; ${index} is not on the list.`,
        );
        process.exit(1);
      }

      const chosen = candidates[index - 1];
      const tag = ROUNDS[round].tag;
      if (options.json) {
        console.log(JSON.stringify({
          round,
          tag,
          number: index,
          title: chosen.title,
          link: chosen.link,
          date: chosen.dateKey,
          entry_url: chosen.entryUrl,
          already_tagged: chosen.alreadyTagged,
        }, null, 2));
        return;
      }

      console.log(chosen.title);
      console.log(chosen.link);
      console.log('');
      console.log(chosen.entryUrl ?? '(this link has no Hatena entry page)');
      console.log('');
      console.log(
        chosen.alreadyTagged
          ? `It already carries ${tag}.`
          : `Add the ${tag} tag there. It comes back on the next \`hatebu sync\`.`,
      );
    });
}

type Window = { from: string; to: string; label: string };

/**
 * The command that produced this listing, so that a number is followed up
 * against the same list. Without the flags, `hatebu pick <number>` after a
 * weekly listing resolves against yesterday's daily candidates instead: a
 * different bookmark, with nothing to say it went wrong.
 */
function commandFor(round: Round, window: Window): string {
  if (round === 'weekly') return `hatebu pick --weekly --date ${window.to}`;
  if (round === 'monthly') return `hatebu pick --monthly --date ${window.label}`;
  return `hatebu pick --date ${window.from}`;
}

/**
 * Fetches every day of the window, so that tags added since the last sync are
 * in the cache before the round is judged. Today is skipped: it is still being
 * bookmarked into, and `sync` will not cache it either.
 *
 * Returns false when there is no username to fetch as, in which case the cache
 * stands as it is.
 */
async function syncWindow(window: Window, asJson: boolean): Promise<boolean> {
  const user = resolveHatenaUser();
  if (!user) {
    console.error(
      'No Hatena username, so this is the cache as it stands. Tags added since the ' +
        'last sync are not in it. Set one with `hatebu config set username <id>`.',
    );
    return false;
  }

  const days: Date[] = [];
  for (const dateKey of eachDay(window)) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (isToday(date)) continue;
    days.push(date);
  }
  if (days.length === 0) return false;

  if (!asJson) {
    console.error(`Fetching ${days.length === 1 ? 'the day' : `${days.length} days`}...`);
  }
  let fetched = false;
  for (const [index, date] of days.entries()) {
    const bookmarks = await fetchBookmarksByDate(user, date);
    if (bookmarks === null) {
      // Keep the day that is cached. An empty answer from a broken fetch is
      // not the same as a day with nothing in it.
      console.error(`${formatDateYmd(date)} could not be fetched; using the cached copy.`);
    } else {
      saveCache(date, bookmarks);
      fetched = true;
    }
    // The feed is somebody else's server, so the days are spaced out.
    if (index < days.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return fetched;
}

function* eachDay(window: Window): Generator<string> {
  const [fromYear, fromMonth, fromDay] = window.from.split('-').map(Number);
  const cursor = new Date(fromYear, fromMonth - 1, fromDay);
  while (formatDateYmd(cursor) <= window.to) {
    yield formatDateYmd(cursor);
    cursor.setDate(cursor.getDate() + 1);
  }
}

function resolveWindow(round: Round, dateOption: string | undefined): Window {
  if (round === 'monthly') {
    // A month, so that the weekly bests of that month are the candidates. With
    // no date it is the last month that has finished, for the same reason the
    // weekly round does not offer the week still being read.
    if (dateOption === undefined) {
      const month = lastCompleteMonth();
      return {
        from: formatDateYmd(month.start),
        to: formatDateYmd(month.end),
        label: formatDateYmd(month.start).slice(0, 7),
      };
    }
    const parsed = parseDateOption(dateOption.slice(0, 7));
    return {
      from: formatDateYmd(parsed.start),
      to: formatDateYmd(parsed.end),
      label: parsed.dateKey.slice(0, 7),
    };
  }

  if (round === 'daily') {
    const key = formatDateYmd(resolveDay(dateOption));
    return { from: key, to: key, label: key };
  }

  // Weeks run Monday to Sunday. A date names the week it falls in; with no
  // date it is the last week that has finished, because a week still being
  // read is not one to choose a best from.
  const week = dateOption === undefined ? lastCompleteWeek() : weekOf(resolveDay(dateOption));
  return {
    from: formatDateYmd(week.start),
    to: formatDateYmd(week.end),
    label: `${formatDateYmd(week.start)}..${formatDateYmd(week.end)}`,
  };
}

function resolveDay(dateOption: string | undefined): Date {
  if (dateOption === undefined) {
    // Yesterday: today is still being bookmarked into.
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  }
  if (!isDateKey(dateOption)) {
    const parsed = tryParseDateOption(dateOption);
    console.error(
      `Error: ${parsed.ok ? 'the date must be one day, as yyyy-mm-dd.' : DATE_OPTION_PROBLEMS[parsed.problem]}`,
    );
    process.exit(1);
  }
  const [year, month, day] = dateOption.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function collectCandidates(round: Round, window: Window): Candidate[] {
  const target = ROUNDS[round].tag;
  const source = ROUNDS[round].from;

  const entries: ArchiveEntry[] = source
    ? findBookmarks({ tag: source, from: window.from, to: window.to }, 1000).entries
    : readDay(window.from);

  const candidates = entries.map((entry) => ({
    ...entry,
    entryUrl: hatenaEntryUrl(entry.link),
    alreadyTagged: extractBookmarkTags(entry).some(
      (tag) => tag.toLowerCase() === target.toLowerCase(),
    ),
  }));

  // Newest first, by when it was bookmarked rather than by the order the day
  // happens to be stored in, so the numbers mean the same thing every time.
  return candidates.sort((a, b) => {
    const left = parseBookmarkTimestamp(a.date)?.getTime();
    const right = parseBookmarkTimestamp(b.date)?.getTime();
    if (left !== undefined && right !== undefined && left !== right) return right - left;
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? 1 : -1;
    return (a.title ?? '').localeCompare(b.title ?? '', 'ja');
  });
}

/**
 * A day, from the cache. Never today: the day being picked over is always one
 * that has been synced, so there is nothing to fetch and nothing to await.
 */
function readDay(dateKey: string): ArchiveEntry[] {
  const bookmarks = readCachedDay(dateKey) ?? [];
  return bookmarks.map((bookmark) => ({ ...bookmark, dateKey }));
}

function reportDecided(
  round: Round,
  window: Window,
  chosen: Candidate[],
  candidateCount: number,
  asJson: boolean,
): void {
  const tag = ROUNDS[round].tag;

  if (asJson) {
    console.log(JSON.stringify({
      round,
      tag,
      from: window.from,
      to: window.to,
      decided: true,
      candidate_count: candidateCount,
      chosen: chosen.map((candidate) => ({
        title: candidate.title,
        link: candidate.link,
        date: candidate.dateKey,
        domain: extractDomain(candidate.link),
        entry_url: candidate.entryUrl,
      })),
    }, null, 2));
    return;
  }

  // More than one is allowed. Some days do not narrow to one, and saying so
  // is a count rather than a complaint.
  console.log(
    chosen.length === 1
      ? `${window.label} already has its ${tag}.`
      : `${window.label} already has ${chosen.length} ${tag}.`,
  );
  for (const candidate of chosen) {
    console.log('');
    console.log(candidate.title);
    console.log(candidate.link);
    if (candidate.entryUrl) console.log(candidate.entryUrl);
  }
  console.log('');
  console.log(`\`${commandFor(round, window)} --all\` lists the ${candidateCount} candidates anyway.`);
}

function report(round: Round, window: Window, candidates: Candidate[], asJson: boolean): void {
  const tag = ROUNDS[round].tag;

  if (asJson) {
    console.log(JSON.stringify({
      round,
      tag,
      from: window.from,
      to: window.to,
      candidate_count: candidates.length,
      candidates: candidates.map((candidate, index) => ({
        number: index + 1,
        title: candidate.title,
        link: candidate.link,
        date: candidate.dateKey,
        domain: extractDomain(candidate.link),
        entry_url: candidate.entryUrl,
        already_tagged: candidate.alreadyTagged,
      })),
    }, null, 2));
    return;
  }

  if (candidates.length === 0) {
    console.log(`No candidates for ${window.label}.`);
    if (ROUNDS[round].from) {
      console.log(`Nothing carries ${ROUNDS[round].from} in that range yet.`);
    }
    return;
  }

  const count = candidates.length === 1 ? '1 candidate' : `${candidates.length} candidates`;
  console.log(`Choose the ${tag} for ${window.label} (${count})`);
  candidates.forEach((candidate, index) => {
    const mark = candidate.alreadyTagged ? ` [${tag}]` : '';
    const domain = extractDomain(candidate.link);
    console.log(`${index + 1}. ${candidate.title}${mark}`);
    console.log(`   ${domain ?? candidate.link}${round === 'daily' ? '' : ` / ${candidate.dateKey}`}`);
  });
  console.log('');
  console.log(`\`${commandFor(round, window)} <number>\` gives the page to add the tag on.`);
}
