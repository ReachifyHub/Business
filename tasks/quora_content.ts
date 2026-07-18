// tasks/quora_content.ts
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { REPO_ROOT, OUTREACH_DIR, readVault, loadState, saveState, logLearning, sendTelegram, extractSelarLink } from './shared.js';

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

const STATE_FILE = 'quora-state.json';
const DRAFTS_DIR = path.join(OUTREACH_DIR, 'quora-drafts');

const QUORA_QUESTIONS = [
  'How do I make AI-generated websites look less generic?',
  'What should I ask a client before building their website with AI tools?',
  'Why do AI-built websites all look the same?',
  'How can I charge more as a freelance web developer when AI can build websites for free?',
  'What information do I need before prompting AI to build a website?',
  'How do I build websites with AI that actually represent a business?',
  'Why do clients reject AI-generated websites even when they look good?',
  "What's the difference between a good AI website and a great one?",
  'How do I stop my AI-generated websites from looking like templates?',
  'What should a web developer know about a business before starting a project?',
];

function slugify(text: string): string {
  return text.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

async function draftAnswer(vaultText: string, question: string, selarLink: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const prompt = `You are drafting a Quora answer for the question: "${question}"

VAULT CONTEXT:
---
${vaultText}
---

RULES:
- Write a genuinely helpful answer (400-600 words) that would be valuable even if the reader never buys anything.
- Teach something specific and actionable about understanding a business before using AI to build a website.
- Follow the tone rules exactly — peer voice, plain writing, no hype, no exclamation marks, no "game-changing" or "revolutionary."
- Mention the Website DNA™ ebook naturally near the end, as one resource among the advice — not as the entire point of the answer.
- The mention should be brief and contextual, not salesy. Something like: "I wrote more about this system in Website DNA™ if you want the full framework with worksheets."
- Where a link would go, write: SELAR_LINK_PLACEHOLDER
- Do NOT invent testimonials, reader counts, or claims not in the vault.
- Write in first person — you're a practitioner sharing what you've learned, not a brand representative.`;

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
    }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  let text = data.choices[0].message.content;
  text = text.replace(/SELAR_LINK_PLACEHOLDER/g, selarLink);
  return text;
}

async function main() {
  const vaultText = await readVault(VAULT_FILES);
  const selarLink = extractSelarLink(vaultText);

  const state = await loadState(STATE_FILE);
  const answered = state.answered || [];

  const newDrafts: string[] = [];
  const errors: string[] = [];

  for (const question of QUORA_QUESTIONS) {
    if (answered.includes(question)) {
      console.log(`Skipping already answered: ${question}`);
      continue;
    }
    console.log(`Drafting answer for: ${question}`);
    try {
      const draft = await draftAnswer(vaultText, question, selarLink);
      const filename = `${slugify(question)}.md`;
      const filePath = path.join(DRAFTS_DIR, filename);
      await mkdir(DRAFTS_DIR, { recursive: true });
      await writeFile(filePath, `# ${question}\n\n${draft}\n\n---\n*Post manually to Quora*`);
      newDrafts.push(question);
      answered.push(question);
    } catch (e: any) {
      errors.push(`Failed on "${question}": ${e.message}`);
      await logLearning(`Quora draft error for "${question}": ${e.message}`);
    }
  }

  if (newDrafts.length) {
    state.answered = answered;
    await saveState(STATE_FILE, state);
  }

  const summary = `✅ Quora drafts completed:\n- New drafts: ${newDrafts.length}\n- Errors: ${errors.length}\nDrafts saved in outreach/quora-drafts/`;
  await sendTelegram(summary);
  console.log(summary);
  if (errors.length) {
    console.error(errors.join('\n'));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
