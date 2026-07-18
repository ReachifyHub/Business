// tasks/outreach.ts
import { readFile, writeFile, appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { REPO_ROOT, VAULT_DIR, OUTREACH_DIR, logLearning, sendTelegram } from './shared.js';

// Env vars – they must be set
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
const COMPANIES_HOUSE_KEY = process.env.COMPANIES_HOUSE_API_KEY;
if (!COMPANIES_HOUSE_KEY) throw new Error('COMPANIES_HOUSE_API_KEY not set');
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

const DAILY_CAP = parseInt(process.env.DAILY_EMAIL_CAP || '100', 10);

const SENT_LOG = path.join(OUTREACH_DIR, 'sent-log.csv');
const VAULT_FILES = [
  'foundations.md',
  'core-principles.md',
  'cold-email-structure.md',
  'Offers/ai-automation/offer.md',
  'Offers/ai-automation/audience.md',
  'Offers/ai-automation/tone.md',
  'Offers/ai-automation/hooks-and-angles.md',
  'Offers/ai-automation/proof.md',
];

// ---------- vault ----------
async function loadVaultContext(): Promise<string> {
  const parts: string[] = [];
  for (const f of VAULT_FILES) {
    const full = path.join(VAULT_DIR, f);
    if (existsSync(full)) {
      const content = await readFile(full, 'utf-8');
      parts.push(`--- ${path.basename(f)} ---\n${content}`);
    } else {
      console.warn(`WARNING: expected vault file missing: ${f}`);
    }
  }
  return parts.join('\n\n');
}

// ---------- sent log ----------
async function loadSentLog(): Promise<Set<string>> {
  if (!existsSync(SENT_LOG)) return new Set();
  const content = await readFile(SENT_LOG, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const contacted = new Set<string>();
  // skip header
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length >= 2) contacted.add(cols[1].trim().toLowerCase());
  }
  return contacted;
}

async function appendSentLog(businessName: string, email: string, sector: string): Promise<void> {
  const fileExists = existsSync(SENT_LOG);
  const header = 'date,business_name,email,sector,status\n';
  const line = `${new Date().toISOString().slice(0,10)},${businessName},${email},${sector},emailed\n`;
  await mkdir(OUTREACH_DIR, { recursive: true });
  if (!fileExists) {
    await writeFile(SENT_LOG, header + line);
  } else {
    await appendFile(SENT_LOG, line);
  }
}

// ---------- Companies House ----------
async function searchCompanies(query: string, maxResults = 50): Promise<{name: string, address: string}[]> {
  const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(query)}&items_per_page=${maxResults}`;
  const auth = Buffer.from(`${COMPANIES_HOUSE_KEY}:`).toString('base64');
  const resp = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  const results: {name: string, address: string}[] = [];
  for (const item of data.items || []) {
    if (item.company_status === 'active') {
      results.push({
        name: item.title?.trim() || '',
        address: item.address_snippet || '',
      });
    }
  }
  return results;
}

async function findCandidateBusinesses(contacted: Set<string>, limit: number): Promise<{name: string, address: string}[]> {
  const searchTerms = ['plumbing', 'electrician', 'locksmith', 'hair salon', 'barber', 'beauty clinic'];
  const candidates: {name: string, address: string}[] = [];
  for (const term of searchTerms) {
    if (candidates.length >= limit) break;
    const before = candidates.length;
    try {
      const companies = await searchCompanies(term, 30);
      for (const company of companies) {
        if (!contacted.has(company.name.toLowerCase())) {
          candidates.push(company);
          if (candidates.length >= limit) break;
        }
      }
    } catch (e: any) {
      console.error(`Companies House search failed for '${term}':`, e.message);
    }
    const added = candidates.length - before;
    if (added === 0) {
      await logLearning(`'${term}' search returned 0 new candidates – likely exhausted or needs a different search term`);
    }
  }
  return candidates.slice(0, limit);
}

// TODO: replace this stub with real website scraper (priority #2)
async function findContactEmail(businessName: string): Promise<string | null> {
  return null;
}

// ---------- Gemini ----------
async function callGemini(prompt: string, maxTokens = 2000): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.8 },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
}

async function draftEmail(vaultContext: string, business: {name: string, address: string}): Promise<string> {
  const prompt = `Using the writing rules, offer details, audience notes, tone guide, and hooks below, draft ONE cold outreach email to this specific UK business. Follow cold-email-structure.md exactly, including the required identity line and opt-out line.

${vaultContext}

--- BUSINESS TO EMAIL ---
Name: ${business.name}
Address: ${business.address}
---

Output ONLY the email — a subject line on the first line prefixed "Subject: ", then a blank line, then the body. No commentary.`;
  return callGemini(prompt);
}

// ---------- Gmail ----------
async function getGmailAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    client_id: GMAIL_CLIENT_ID!,
    client_secret: GMAIL_CLIENT_SECRET!,
    refresh_token: GMAIL_REFRESH_TOKEN!,
    grant_type: 'refresh_token',
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  return data.access_token;
}

async function sendGmail(accessToken: string, toEmail: string, subject: string, body: string): Promise<void> {
  const raw = Buffer.from(`To: ${toEmail}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`)
    .toString('base64url');
  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  if (!resp.ok) throw new Error(await resp.text());
}

// ---------- main ----------
async function main() {
  console.log('Loading vault context...');
  const vaultContext = await loadVaultContext();

  console.log('Loading sent-log for dedup...');
  const contacted = await loadSentLog();
  console.log(`  ${contacted.size} businesses already contacted historically.`);

  console.log('Finding candidate businesses via Companies House...');
  const candidates = await findCandidateBusinesses(contacted, DAILY_CAP);
  console.log(`  Found ${candidates.length} new candidates.`);

  let sentCount = 0;
  const sentNames: string[] = [];
  let skippedNoEmail = 0;
  const failures: string[] = [];
  let accessToken: string | null = null;

  for (const business of candidates) {
    if (sentCount >= DAILY_CAP) break;
    const email = await findContactEmail(business.name);
    if (!email) {
      skippedNoEmail++;
      continue;
    }

    try {
      const draft = await draftEmail(vaultContext, business);
      const parts = draft.split('\n\n');
      const subjectLine = parts[0] || '';
      const subject = subjectLine.replace(/^Subject:\s*/, '').trim();
      const body = parts.slice(1).join('\n\n');

      if (!accessToken) accessToken = await getGmailAccessToken();
      await sendGmail(accessToken, email, subject, body);
      await appendSentLog(business.name, email, 'unknown');
      sentCount++;
      sentNames.push(business.name);
      console.log(`  Sent to ${business.name}`);
    } catch (e: any) {
      console.error(`  Failed on ${business.name}:`, e.message);
      failures.push(e.message);
    }
  }

  if (failures.length >= 2) {
    await logLearning(`${failures.length} send failures in one run — most recent error: ${failures[failures.length-1]?.slice(0,200)}`);
  }

  let report = `Outreach run complete for ${new Date().toISOString().slice(0,10)}\nSent: ${sentCount}\nSkipped (no email found): ${skippedNoEmail}`;
  if (sentNames.length) {
    report += '\n\nBusinesses emailed:\n' + sentNames.map(n => `- ${n}`).join('\n');
  }
  console.log(report);
  await sendTelegram(report);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
