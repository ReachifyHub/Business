// tasks/router.ts
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { REPO_ROOT, OUTREACH_DIR } from './shared.js';

const STATE_FILE = path.join(OUTREACH_DIR, 'telegram-state.json');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set');

const API_BASE = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// Command map – lowercased text -> GitHub Actions output flag
const COMMAND_MAP: Record<string, string> = {
  'start outreach': 'run_outreach',
  '/start_outreach': 'run_outreach',
  'make pins': 'run_pinterest',
  'write article': 'run_medium',
  'make ad': 'run_fb_ads',
  'quora drafts': 'run_quora',
};

async function loadLastUpdateId(): Promise<number> {
  if (!existsSync(STATE_FILE)) return 0;
  try {
    const data = JSON.parse(await readFile(STATE_FILE, 'utf-8'));
    return data.last_update_id || 0;
  } catch {
    return 0;
  }
}

async function saveLastUpdateId(updateId: number): Promise<void> {
  await mkdir(OUTREACH_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify({ last_update_id: updateId }, null, 2));
}

async function getUpdates(offset: number): Promise<any> {
  const url = `${API_BASE}/getUpdates?offset=${offset}&timeout=0`;
  const resp = await fetch(url, { timeout: 30000 });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

function setGitHubOutput(key: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    // In Actions, we append to the file
    // We'll handle it asynchronously, but we need sync for this part – we can use fs.appendFileSync
    const fs = require('fs');
    fs.appendFileSync(outputFile, `${key}=${value}\n`);
  } else {
    console.log(`[dry-run] ${key}=${value}`);
  }
}

async function main() {
  const lastId = await loadLastUpdateId();
  const data = await getUpdates(lastId + 1);

  const triggeredOutputs = new Set<string>();
  let newestId = lastId;

  for (const update of data.result || []) {
    newestId = Math.max(newestId, update.update_id);
    const message = update.message || {};
    const text = (message.text || '').trim().toLowerCase();
    if (COMMAND_MAP[text]) {
      const flag = COMMAND_MAP[text];
      triggeredOutputs.add(flag);
      console.log(`Matched command '${text}' -> ${flag}`);
    }
  }

  if (newestId !== lastId) {
    await saveLastUpdateId(newestId);
    // Commit the state file – we'll let the workflow handle committing
    console.log('State file updated – workflow will commit it.');
  }

  // Set outputs for all possible flags
  const allFlags = ['run_outreach', 'run_pinterest', 'run_medium', 'run_fb_ads', 'run_quora'];
  for (const flag of allFlags) {
    setGitHubOutput(flag, triggeredOutputs.has(flag) ? 'true' : 'false');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
