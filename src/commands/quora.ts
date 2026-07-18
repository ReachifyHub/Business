// src/commands/quora.ts
import { getOfferContext } from "../vault.ts";
import { sendTelegram } from "../utils/telegram.ts";
import { callGroq } from "../utils/apiClients.ts";
import { getPendingDrafts, setPendingDrafts } from "../utils/state.ts";

const QUORA_QUESTIONS = [
  "How do I make AI-generated websites look less generic?",
  "What should I ask a client before building their website with AI tools?",
  // ... (full list from earlier)
];

export async function draftQuoraAnswers(chatId: number, command: any) {
  const vault = await getOfferContext("dna");
  const drafts = [];
  for (const question of QUORA_QUESTIONS) {
    const prompt = `Draft a helpful Quora answer (400-600 words) for: "${question}"\nUse this vault for context:\n${vault}\n\nWrite in first person, be genuinely useful, mention the ebook naturally. Include link as SELAR_LINK_PLACEHOLDER.`;
    const answer = await callGroq(prompt);
    drafts.push({ question, answer });
  }

  // Save drafts to state (or send to user)
  // We'll store in KV and also send the list to user
  const draftList = drafts.map((d, i) => `${i+1}. ${d.question}`).join("\n");
  await sendTelegram(chatId, `📝 Generated ${drafts.length} Quora drafts. Check them with /quora_drafts (I'll implement a view later)`);

  // Store in KV for later retrieval
  await Deno.openKv().then(kv => kv.set(["quora_drafts"], drafts));
}
