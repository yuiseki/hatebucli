import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { getCacheDir } from '../storage';

export function registerImportCommand(program: Command): void {
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
            fs.copyFileSync(path.join(monthPath, dayFile), path.join(destMonthDir, dayFile));
            totalFiles++;
          }
        }
        process.stdout.write(`.`);
      }
      console.log(`\nImport complete. Copied ${totalFiles} days of bookmarks.`);
    });
}
