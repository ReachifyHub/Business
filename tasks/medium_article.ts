// tasks/medium_article.ts
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { REPO_ROOT, OUTREACH_DIR, readVault, loadState, saveState, logLearning, sendTelegram, extractSelarLink, parseHooks, Hook } from './shared.js';

const VAULT_FILES = [
  'Marketing/foundations.md',
  'Marketing/core-principles.md',
  'Marketing/Offers/website-dna/offer.md',
  'Marketing/Offers/website-dna/audience.md',
  'Marketing/Offers/website-dna/tone.md',
  'Marketing/Offers/website-dna/hooks-and-angles.md',
  'Marketing/Offers/website-dna/objections.md',
  'Marketing/Offers/website-dna/proof.md',
];

const STATE_FILE = 'medium-state.json';

async function generateArticle(vaultText: string, angle: Hook, selarLink: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const prompt = `You are writing a full-length Medium article (800-1200 words) to promote the Website DNA™ ebook.

VAULT CONTEXT (read this carefully — it contains the product details, audience, tone rules, objections, and proof guidelines):
---
${vaultText}
---

ANGLE FOR THIS ARTICLE:
Title: ${angle.title}
Details:
${angle.lines.join('\n')}

RULES:
- The article MUST start with a line that begins exactly with "# " followed by the headline. No other text before that line.
- Follow the tone rules in the vault exactly — peer voice, not guru; plain and specific; no hype words.
- The article must be genuinely useful on its own — teach something real about understanding a business before prompting AI.
- Sell the feeling (the "so what?" chain), not the product features.
- Spend disproportionate effort on the headline — it should make one specific person think "that's exactly my problem."
- One clear call to action at the end — a natural final paragraph that mentions the ebook and links to it.
- Where the link goes, write exactly: SELAR_LINK_PLACEHOLDER (The actual URL will be inserted by code — do NOT generate or guess a URL.)
- Do NOT invent testimonials, reader counts, or claims not supported by the vault.
- Write the full article, not an outline or summary.
- Format with Markdown headings and paragraphs suitable for Medium.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 6000 },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  text = text.replace(/SELAR_LINK_PLACEHOLDER/g, selarLink);
  return text;
}

function extractTitle(content: string): string {
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.trim().startsWith('# ')) {
      return line.trim().substring(2).trim();
    }
  }
  return 'Website DNA™ — Building Websites That Don\'t Look AI-Generated';
}

async function postToMedium(articleText: string): Promise<string> {
  const token = process.env.MEDIUM_INTEGRATION_TOKEN;
  if (!token) throw new Error('MEDIUM_INTEGRATION_TOKEN not set');

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const meResp = await fetch('https://api.medium.com/v1/me', { headers });
  if (!meResp.ok) throw new Error(await meResp.text());
  const meData = await meResp.json();
  const userId = meData.data.id;

  const title = extractTitle(articleText);
  // Remove the first line if it's the title
  const body = articleText.replace(/^# .*\n/, '').trim();

  const payload = {
    title,
    contentFormat: 'markdown',
    content: body,
    publishStatus: 'public',
  };
  const postResp = await fetch(`https://api.medium.com/v1/users/${userId}/posts`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!postResp.ok) throw new Error(await postResp.text());
  const postData = await postResp.json();
  return postData.data.url;
}

async function main() {
  const vaultText = await readVault(VAULT_FILES);
  const selarLink = extractSelarLink(vaultText);
  const hooks = parseHooks(vaultText);
  if (!hooks.length) {
    await logLearning('No hooks parsed from vault – aborting Medium article');
    await sendTelegram('❌ Medium article failed: no hooks found in vault.');
    process.exit(1);
  }

  const state = await loadState(STATE_FILE);
  const lastIdx = state.last_angle_index ?? -1;
  const nextIdx = (lastIdx + 1) % hooks.length;
  const angle = hooks[nextIdx];

  console.log(`Generating article for angle ${nextIdx+1}/${hooks.length}: ${angle.title}`);
  let article: string;
  try {
    article = await generateArticle(vaultText, angle, selarLink);
  } catch (e: any) {
    await sendTelegram(`❌ Medium article generation failed: ${e.message}`);
    throw e;
  }

  let url: string;
  try {
    url = await postToMedium(article);
  } catch (e: any) {
    const draftPath = path.join(OUTREACH_DIR, `medium-draft-${new Date().toISOString().slice(0,10)}-${Date.now()}.md`);
    await mkdir(OUTREACH_DIR, { recursive: true });
    await writeFile(draftPath, article);
    await logLearning(`Medium publish failed, draft saved to ${draftPath}: ${e.message}`);
    await sendTelegram(`⚠️ Medium article generated but publish failed: ${e.message}\nDraft saved locally.`);
    process.exit(1);
  }

  state.last_angle_index = nextIdx;
  await saveState(STATE_FILE, state);

  const summary = `✅ Medium article published!\nAngle: ${angle.title}\nURL: ${url}`;
  await sendTelegram(summary);
  console.log(summary);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
