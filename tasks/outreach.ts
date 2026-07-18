// tasks/outreach.ts
import { readFile, writeFile, appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { REPO_ROOT, VAULT_DIR, OUTREACH_DIR, logLearning, sendTelegram } from './shared.js';

// Env vars – they must be set
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

// Optional: if you have a Google Search API key, you can enable fallback
// const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
// const GOOGLE_CX = process.env.GOOGLE_CX;

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

// ---------- Vault ----------
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

// ---------- Sent log ----------
async function loadSentLog(): Promise<Set<string>> {
  if (!existsSync(SENT_LOG)) return new Set();
  const content = await readFile(SENT_LOG, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const contacted = new Set<string>();
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

// ---------- Overpass API (replaces Companies House) ----------
interface OverpassResult {
  name: string;
  address: string;
  website: string | null;
}

async function searchOverpass(sectorTags: string[], bbox: string): Promise<OverpassResult[]> {
  // Build a query that looks for nodes/ways with any of the given tags AND a website tag
  const tagFilters = sectorTags.map(tag => `["${tag}"]`).join('');
  const query = `
    [out:json][timeout:60];
    (
      node${tagFilters}["website"]({{bbox}});
      way${tagFilters}["website"]({{bbox}});
    );
    out body;
  `;
  // Replace {{bbox}} with actual coordinates
  const finalQuery = query.replace('{{bbox}}', bbox);
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(finalQuery)}`;

  console.log(`Overpass query: ${url}`);
  const resp = await fetch(url, { timeout: 60000 });
  if (!resp.ok) throw new Error(`Overpass error: ${await resp.text()}`);

  const data = await resp.json();
  const results: OverpassResult[] = [];

  for (const element of data.elements || []) {
    const tags = element.tags || {};
    const name = tags.name || '';
    // Build address from available fields
    const addressParts = [
      tags['addr:street'],
      tags['addr:city'],
      tags['addr:postcode'],
      tags['addr:county'],
    ].filter(Boolean);
    const address = addressParts.join(', ') || 'United Kingdom';
    const website = tags.website || null;

    if (name && website) {
      results.push({ name, address, website });
    }
  }

  // Dedup by name
  const seen = new Set<string>();
  const unique = results.filter(r => {
    const key = r.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique;
}

async function findCandidateBusinesses(contacted: Set<string>, limit: number): Promise<OverpassResult[]> {
  // Define sector tags (OpenStreetMap keys) for each target industry
  const sectorMap = [
    { tags: ['shop=plumber', 'craft=plumber'], label: 'plumbing' },
    { tags: ['shop=electrician', 'craft=electrician'], label: 'electrician' },
    { tags: ['shop=locksmith'], label: 'locksmith' },
    { tags: ['shop=hairdresser', 'amenity=hair_care'], label: 'hair salon' },
    { tags: ['shop=barber'], label: 'barber' },
    { tags: ['shop=beauty', 'amenity=beauty_shop'], label: 'beauty clinic' },
  ];

  // UK bounding box (rough)
  const bbox = '49.9,-10.0,60.0,3.0';

  const allCandidates: OverpassResult[] = [];

  for (const sector of sectorMap) {
    if (allCandidates.length >= limit) break;
    console.log(`Querying Overpass for: ${sector.label}`);
    try {
      const results = await searchOverpass(sector.tags, bbox);
      const filtered = results.filter(r => !contacted.has(r.name.toLowerCase()));
      allCandidates.push(...filtered);
      console.log(`  Found ${filtered.length} new candidates for ${sector.label}`);
    } catch (e: any) {
      console.error(`  Overpass error for ${sector.label}:`, e.message);
      await logLearning(`Overpass failed for ${sector.label}: ${e.message}`);
    }
  }

  // Shuffle to avoid always hitting the same sectors first
  const shuffled = allCandidates.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, limit);
}

// ---------- Website email scraper ----------
async function scrapeEmailFromWebsite(url: string): Promise<string | null> {
  try {
    // Clean URL
    if (!url.startsWith('http')) url = `https://${url}`;

    // Fetch with a timeout and user-agent
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 15000, // 15 seconds
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    // Email regex – matches mailto: links and plain text emails
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    // 1. Find all emails in the HTML
    const allMatches = html.match(emailRegex) || [];

    // 2. Filter out common false positives (e.g., example.com, placeholder, image src)
    const blockedDomains = ['example.com', 'test.com', 'domain.com', 'yourdomain'];
    const validEmails = allMatches.filter(email => {
      const domain = email.split('@')[1]?.toLowerCase() || '';
      return !blockedDomains.some(bad => domain.includes(bad)) &&
             !domain.includes('placeholder') &&
             !domain.includes('sample');
    });

    // 3. Prefer emails that look like contact, info, hello, or are in mailto: links
    const preferred = validEmails.filter(e =>
      /^(contact|info|hello|enquiries|sales|support)/i.test(e.split('@')[0])
    );

    // 4. Also check mailto: links explicitly (they're often the most accurate)
    const mailtoRegex = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
    let mailtoMatch;
    const mailtoEmails: string[] = [];
    while ((mailtoMatch = mailtoRegex.exec(html)) !== null) {
      mailtoEmails.push(mailtoMatch[1]);
    }
    const allCandidates = [...mailtoEmails, ...preferred, ...validEmails];

    // 5. Return the first unique email that passes basic validation
    const seen = new Set<string>();
    for (const email of allCandidates) {
      const trimmed = email.toLowerCase().trim();
      if (!seen.has(trimmed) && trimmed.length < 100) {
        seen.add(trimmed);
        // Avoid generic webmaster or nobody
        if (!/^(webmaster|nobody|admin|root)@/i.test(trimmed)) {
          return trimmed;
        }
      }
    }

    return null;
  } catch (e) {
    // Timeouts or fetch errors – just return null
    return null;
  }
}

// ---------- Gemini drafting ----------
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

// ---------- Main ----------
async function main() {
  console.log('Loading vault context...');
  const vaultContext = await loadVaultContext();

  console.log('Loading sent-log for dedup...');
  const contacted = await loadSentLog();
  console.log(`  ${contacted.size} businesses already contacted historically.`);

  console.log('Finding candidate businesses via Overpass...');
  const candidates = await findCandidateBusinesses(contacted, DAILY_CAP);
  console.log(`  Found ${candidates.length} new candidates.`);

  let sentCount = 0;
  const sentNames: string[] = [];
  let skippedNoEmail = 0;
  let skippedNoWebsite = 0;
  const failures: string[] = [];
  let accessToken: string | null = null;

  for (const business of candidates) {
    if (sentCount >= DAILY_CAP) break;

    // 1. Try to scrape an email from the website
    let email: string | null = null;
    if (business.website) {
      console.log(`  Scraping ${business.website} for email...`);
      email = await scrapeEmailFromWebsite(business.website);
      if (email) {
        console.log(`    Found email: ${email}`);
      } else {
        console.log(`    No email found on ${business.website}`);
        skippedNoEmail++;
        continue;
      }
    } else {
      skippedNoWebsite++;
      continue;
    }

    // 2. Draft and send
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

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  if (failures.length >= 2) {
    await logLearning(`${failures.length} send failures in one run — most recent error: ${failures[failures.length-1]?.slice(0,200)}`);
  }

  let report = `Outreach run complete for ${new Date().toISOString().slice(0,10)}\nSent: ${sentCount}\nSkipped (no email found): ${skippedNoEmail}\nSkipped (no website): ${skippedNoWebsite}`;
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
