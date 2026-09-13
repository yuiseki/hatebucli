import { Command } from 'commander';
import { formatDateYmd, isDateKey, tryParseDateOption } from '../dates';
import { DATE_OPTION_PROBLEMS } from '../dates';
import {
  extractBookmarkTags,
  extractDomain,
  hatenaEntryUrl,
  parseBookmarkTimestamp,
} from '../format';
import { parseDateOption } from '../options';
import { readCachedDay } from '../services/archive';
import { findBookmarks, type ArchiveEntry } from '../services/queries';

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
    .option('-j, --json', 'output as JSON')
    .action((numberArg, options) => {
      const round: Round = options.monthly ? 'monthly' : options.weekly ? 'weekly' : 'daily';
      if (options.weekly && options.monthly) {
        console.error('Error: --weekly and --monthly cannot be used together.');
        process.exit(1);
      }

      const window = resolveWindow(round, options.date);
      const candidates = collectCandidates(round, window);

      if (numberArg === undefined) {
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

function resolveWindow(round: Round, dateOption: string | undefined): Window {
  if (round === 'monthly') {
    // A month, so that the weekly bests of that month are the candidates.
    const parsed = parseDateOption(dateOption ? dateOption.slice(0, 7) : undefined);
    return {
      from: formatDateYmd(parsed.start),
      to: formatDateYmd(parsed.end),
      label: parsed.dateKey.slice(0, 7),
    };
  }

  const day = resolveDay(dateOption);
  if (round === 'daily') {
    const key = formatDateYmd(day);
    return { from: key, to: key, label: key };
  }

  // The week ending on the given day, that day included.
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 6);
  return {
    from: formatDateYmd(start),
    to: formatDateYmd(day),
    label: `${formatDateYmd(start)}..${formatDateYmd(day)}`,
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
  console.log(`\`hatebu pick <number>\` gives the page to add the tag on.`);
}
