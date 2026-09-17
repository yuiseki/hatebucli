import { Command } from 'commander';
import { extractDomain } from '../format';
import { parsePositiveIntegerOption } from '../options';
import {
  around,
  bookmarksAround,
  ContextProblem,
  intoSessions,
  resolveMoment,
} from '../services/context';

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}


export function registerContextCommand(program: Command): void {
  program
    .command('context <url-or-time>')
    .description('What else was bookmarked around a page, grouped into sittings')
    .option('--minutes <number>', 'how far either side to look', '90')
    .option('--gap <number>', 'minutes of quiet that end a sitting', '30')
    .option('-j, --json', 'output as JSON')
    .action((input, options) => {
      const minutes = parsePositiveIntegerOption(options.minutes, '--minutes');
      const gap = parsePositiveIntegerOption(options.gap, '--gap');

      try {
        if (options.json) {
          console.log(JSON.stringify(bookmarksAround(input, minutes, gap), null, 2));
          return;
        }

        const sessions = intoSessions(around(resolveMoment(input), minutes), gap);
        if (sessions.length === 0) {
          console.log('Nothing was bookmarked around then.');
          return;
        }

        sessions.forEach((session, index) => {
          if (index > 0) console.log('');
          console.log(
            `${clock(session[0].at)}-${clock(session[session.length - 1].at)} ` +
              `(${session.length === 1 ? '1 bookmark' : `${session.length} bookmarks`})`,
          );
          for (const entry of session) {
            const mark = entry.target ? '\u2192 ' : '  ';
            console.log(`${mark}${clock(entry.at)} ${entry.title}`);
            console.log(`     ${extractDomain(entry.link) ?? entry.link}`);
          }
        });
      } catch (error) {
        if (error instanceof ContextProblem) {
          console.error(`Error: ${error.message}`);
          process.exit(1);
        }
        throw error;
      }
    });
}
