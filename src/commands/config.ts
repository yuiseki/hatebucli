import { Command } from 'commander';
import { getStoredConfig, setStoredConfig } from '../credentials';

export function registerConfigCommand(program: Command): void {
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
}
