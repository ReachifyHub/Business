// tasks/pinterest_post.ts
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
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
const STATE_FILE = 'pinterest-state.json';

async function generatePinCopy(vaultText: string, angle: Hook): Promise<{title: string, description: string}> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const prompt = `You are writing Pinterest pin copy for the Website DNA™ ebook.

VAULT CONTEXT:
---
${vaultText}
---

ANGLE:
Title: ${angle.title}
Details:
${angle.lines.join('\n')}

RULES:
- Pin title: under 100 characters. Make it specific and curiosity-driving — name the exact problem.
- Pin description: under 500 characters. Give one genuinely useful insight, then mention the ebook naturally.
- Follow the tone rules — peer voice, plain writing, no hype words, no exclamation marks.
- In the description, write SELAR_LINK_PLACEHOLDER where the link should go.
- Do NOT invent testimonials or claims.
- Output format — exactly two lines:
TITLE: <your title>
DESCRIPTION: <your description>`;

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
    }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  const text = data.choices[0].message.content;

  let title = '', description = '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('TITLE:')) title = trimmed.substring(6).trim();
    else if (trimmed.startsWith('DESCRIPTION:')) description = trimmed.substring(12).trim();
  }
  if (!title || !description) throw new Error(`Could not parse pin copy: ${text.slice(0,200)}`);
  return { title, description };
}

async function generatePinImage(pinTitle: string): Promise<string> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!accountId || !apiToken) throw new Error('CF_ACCOUNT_ID or CF_API_TOKEN not set');

  const imagePrompt = `Clean professional Pinterest infographic design. Bold typography on a solid dark background with one accent color. Minimalist graphic style, NOT photorealistic. Text reads: '${pinTitle}'. Modern sans-serif font, high contrast, simple geometric shapes as decoration. Flat design, no photos, no 3D effects.`;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: imagePrompt }),
  });
  if (!resp.ok) throw new Error(await resp.text());

  let imageBuffer: Buffer;
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('image')) {
    imageBuffer = Buffer.from(await resp.arrayBuffer());
  } else {
    const data = await resp.json();
    const base64 = data.image || data.result?.image;
    if (!base64) throw new Error('Unexpected CF AI response format');
    imageBuffer = Buffer.from(base64, 'base64');
  }

  const tempFile = path.join(OUTREACH_DIR, `pin-${Date.now()}.png`);
  await mkdir(OUTREACH_DIR, { recursive: true });
  await writeFile(tempFile, imageBuffer);
  return tempFile;
}

async function postToPinterest(title: string, description: string, imagePath: string, selarLink: string): Promise<string> {
  const accessToken = process.env.PINTEREST_ACCESS_TOKEN;
  const boardId = process.env.PINTEREST_BOARD_ID;
  if (!accessToken || !boardId) throw new Error('PINTEREST_ACCESS_TOKEN or PINTEREST_BOARD_ID not set');

  const imageData = (await readFile(imagePath)).toString('base64');
  const payload = {
    board_id: boardId,
    title,
    description,
    link: selarLink,
    media_source: {
      source_type: 'image_base64',
      content_type: 'image/png',
      data: imageData,
    },
  };
  const resp = await fetch('https://api.pinterest.com/v5/pins', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  return data.id || 'unknown';
}

async function main() {
  const vaultText = await readVault(VAULT_FILES);
  const selarLink = extractSelarLink(vaultText);
  const hooks = parseHooks(vaultText);
  if (!hooks.length) {
    await logLearning('No hooks parsed – aborting Pinterest');
    await sendTelegram('❌ Pinterest pin failed: no hooks found in vault.');
    process.exit(1);
  }

  const state = await loadState(STATE_FILE);
  const lastIdx = state.last_angle_index ?? -1;
  const nextIdx = (lastIdx + 1) % hooks.length;
  const angle = hooks[nextIdx];

  console.log(`Generating pin for angle ${nextIdx+1}/${hooks.length}: ${angle.title}`);
  let pinTitle: string, pinDescription: string;
  try {
    const copy = await generatePinCopy(vaultText, angle);
    pinTitle = copy.title;
    pinDescription = copy.description.replace(/SELAR_LINK_PLACEHOLDER/g, selarLink);
  } catch (e: any) {
    await sendTelegram(`❌ Pinterest copy generation failed: ${e.message}`);
    throw e;
  }

  let imagePath: string | null = null;
  try {
    imagePath = await generatePinImage(pinTitle);
  } catch (e: any) {
    await sendTelegram(`❌ Pinterest image generation failed: ${e.message}`);
    throw e;
  }

  let pinId: string;
  try {
    pinId = await postToPinterest(pinTitle, pinDescription, imagePath, selarLink);
  } catch (e: any) {
    await logLearning(`Pinterest publish failed: ${e.message}`);
    await sendTelegram(`⚠️ Pinterest pin created but publish failed: ${e.message}`);
    throw e;
  } finally {
    if (imagePath && existsSync(imagePath)) await unlink(imagePath);
  }

  state.last_angle_index = nextIdx;
  await saveState(STATE_FILE, state);

  const summary = `✅ Pinterest pin published!\nAngle: ${angle.title}\nPin title: ${pinTitle}\nPin ID: ${pinId}`;
  await sendTelegram(summary);
  console.log(summary);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
