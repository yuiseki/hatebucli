import fs from 'fs';
import path from 'path';
import os from 'os';
import { config, setHatenaUser } from './config';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'hatebu');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.json');

function loadStoredCredentials() {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

export function getStoredConfig(key: string): string | undefined {
  const stored = loadStoredCredentials();
  if (key === 'username') return stored.HATENA_USER;
  return undefined;
}

export function setStoredConfig(key: string, value: string): void {
  const stored = loadStoredCredentials();
  if (key === 'username') {
    stored.HATENA_USER = value;
  } else {
    console.error(`Unknown config key: ${key}`);
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(stored, null, 2));
  console.error(`Config set: ${key}=${value}`);
}

export async function ensureHatenaUser(): Promise<string> {
  // 1. Check current config (env)
  if (config.HATENA_USER) {
    return config.HATENA_USER;
  }

  // 2. Check stored config
  const storedUser = getStoredConfig('username');
  if (storedUser) {
    setHatenaUser(storedUser);
    return storedUser;
  }

  // 3. Fail with suggestion
  console.error('Error: Hatena Username is not set.');
  console.error('Please run the following command to set your username:');
  console.error('  hatebu config set username <your_username>');
  process.exit(1);
}
