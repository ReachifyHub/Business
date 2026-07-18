// src/commands/quora.ts
import { getOfferContext } from "../vault.ts";
import { sendTelegram } from "../utils/telegram.ts";
import { callGroq } from "../utils/apiClients.ts";

const QUORA_QUESTIONS = [
  "How do I make AI-generated websites look less generic?",
  "What should I ask a client before building their website with AI tools?",
  "Why do AI-built websites all look the same?",
  "How can I charge more as a freelance web developer when AI can build websites for free?",
  "What information do I need before prompting AI to build a website?",
  "How do I build websites with AI that actually represent a business?",
  "Why do clients reject AI-generated websites even when they look good?",
  "What's the difference between a good AI website and a great one?",
  "How do I stop my AI-generated websites from looking like templates?",
  "What should a web developer know about a business before starting a project?",
];

export async function draftQuoraAnswers(chatId: number, command: any) {
  const vault = await getOfferContext("dna");
  const drafts = [];
  
  for (const question of QUORA_QUESTIONS) {
    const prompt = `Draft a helpful Quora answer (400-600 words) for: "${question}"\nUse this vault for context:\n${vault}\n\nWrite in first person, be genuinely useful, mention the ebook naturally. Include link as SELAR_LINK_PLACEHOLDER.`;
    const answer = await callGroq(prompt);
    drafts.push({ question, answer });
  }

  const kv = await Deno.openKv();
  await kv.set(["quora_drafts"], drafts);

  const draftList = drafts.map((d, i) => `${i+1}. ${d.question}`).join("\n");
  await sendTelegram(chatId, `📝 Generated ${drafts.length} Quora drafts.\n\n${draftList}\n\n(They're stored. Use /quora_drafts to view them later.)`);
}
