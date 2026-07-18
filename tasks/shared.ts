// tasks/shared.ts
import { readFile, writeFile, mkdir, appendFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, '..');
export const VAULT_DIR = path.join(REPO_ROOT, 'Marketing');
export const OUTREACH_DIR = path.join(REPO_ROOT, 'outreach');

// --- Vault reading ---
export async function readVaultFile(filePath: string): Promise<string> {
  const fullPath = path.join(REPO_ROOT, filePath);
  if (!existsSync(fullPath)) {
    await logLearning(`Missing vault file: ${filePath}`);
    return '';
  }
  return readFile(fullPath, 'utf-8');
}

export async function readVault(files: string[]): Promise<string> {
  const parts: string[] = [];
  for (const f of files) {
    const content = await readVaultFile(f);
    if (content) parts.push(`--- ${path.basename(f)} ---\n${content}`);
  }
  return parts.join('\n\n---\n\n');
}

// --- State helpers ---
export async function loadState(stateFile: string): Promise<any> {
  const fullPath = path.join(OUTREACH_DIR, stateFile);
  if (!existsSync(fullPath)) return {};
  try {
    return JSON.parse(await readFile(fullPath, 'utf-8'));
  } catch {
    return {};
  }
}

export async function saveState(stateFile: string, data: any): Promise<void> {
  const fullPath = path.join(OUTREACH_DIR, stateFile);
  await mkdir(OUTREACH_DIR, { recursive: true });
  await writeFile(fullPath, JSON.stringify(data, null, 2));
}

// --- Logging ---
export async function logLearning(description: string): Promise<void> {
  const learningsPath = path.join(OUTREACH_DIR, 'learnings.md');
  const timestamp = new Date().toISOString().slice(0, 10);
  await mkdir(OUTREACH_DIR, { recursive: true });
  await appendFile(learningsPath, `${timestamp} — ${description}\n`);
  console.log(`[learning] ${description}`);
}

// --- Telegram ---
export async function sendTelegram(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('Telegram credentials not set, skipping notification.');
    return;
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    });
    if (!resp.ok) throw new Error(await resp.text());
  } catch (e: any) {
    await logLearning(`Telegram send failed: ${e.message}`);
  }
}

// --- Selar link extraction ---
export function extractSelarLink(vaultText: string): string {
  const match = vaultText.match(/^SELAR_LINK:\s*(.+)$/m);
  if (match) return match[1].trim();
  logLearning('SELAR_LINK not found in vault – using fallback');
  return 'https://selar.co/';
}

// --- Hook parsing (for website-dna offers) ---
export interface Hook {
  title: string;
  lines: string[];
}
export function parseHooks(vaultText: string): Hook[] {
  const hooks: Hook[] = [];
  let current: Hook | null = null;
  for (const line of vaultText.split('\n')) {
    const match = line.match(/^#{2,3}\s+\d+\.\s+(.+)/);
    if (match) {
      if (current) hooks.push(current);
      current = { title: match[1].trim(), lines: [] };
    } else if (current && line.trim()) {
      current.lines.push(line);
    }
  }
  if (current) hooks.push(current);
  return hooks;
}
