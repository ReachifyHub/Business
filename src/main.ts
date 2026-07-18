// src/main.ts
import { getMyBotContext, getOfferContext } from "./vault.ts";
import { sendTelegram, parseCommand } from "./utils/telegram.ts";
import { handlePinterestDraft, handleImageUpload } from "./commands/pinterest.ts";
import { postMediumArticle } from "./commands/medium.ts";
import { postTweet } from "./commands/twitter.ts";
import { createPausedAd } from "./commands/fb_ads.ts";
import { draftQuoraAnswers } from "./commands/quora.ts";
import { runOutreach } from "./commands/outreach.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

// KV for conversation state
const kv = await Deno.openKv();

// ─── Telegram webhook handler ───
export async function handleTelegramUpdate(update: any) {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat.id;
  const text = message.text?.trim() || "";
  const lowerText = text.toLowerCase();

  // ─── Greeting flow ───
  if (lowerText.includes("good morning") || lowerText.includes("hey") || lowerText.includes("hello")) {
    const ctx = await getMyBotContext();
    // Fetch yesterday's stats from KV or external APIs
    const stats = await kv.get(["stats", "yesterday"]);
    const reply = `👋 Hey boss! Good morning.\n\n` +
      `Yesterday's engagement: ${stats.value || "no data yet"}.\n\n` +
      `I've got your daily routines ready. What do you want to do today?`;
    await sendTelegram(chatId, reply);
    return;
  }

  // ─── Command router ───
  const command = parseCommand(text);
  switch (command.action) {
    case "pinterest":
      await handlePinterestDraft(chatId, command);
      break;

    case "medium":
      await postMediumArticle(chatId, command);
      break;

    case "twitter":
      await postTweet(chatId, command);
      break;

    case "fb_ad":
      await createPausedAd(chatId, command);
      break;

    case "quora":
      await draftQuoraAnswers(chatId, command);
      break;

    case "outreach":
      await runOutreach(chatId, command);
      break;

    case "status":
      const status = await getStatus();
      await sendTelegram(chatId, status);
      break;

    default:
      // Send a helpful message for unknown commands
      await sendTelegram(chatId, 
        `I didn't understand that. Try:\n` +
        `• "create 3 pins, 2 hours apart"\n` +
        `• "post article about Brand DNA"\n` +
        `• "tweet about my skills"\n` +
        `• "good morning"`
      );
  }
}

// ─── Status helper ───
async function getStatus() {
  const scheduled = await kv.get(["scheduled_posts"]);
  const drafts = await kv.get(["pending_drafts"]);
  return `📊 Current status:\n` +
    `- Scheduled posts: ${scheduled.value?.length || 0}\n` +
    `- Pending drafts: ${drafts.value?.length || 0}\n` +
    `- Vault cache: ${await getCacheAge()}`;
}

async function getCacheAge() {
  const cache = await kv.get(["myBotContext"]);
  if (!cache.value) return "not cached";
  const age = (Date.now() - cache.value.timestamp) / 1000 / 60;
  return `${Math.round(age)} min old`;
}

// ─── Deno Deploy entry point ───
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Health check
  if (url.pathname === "/" && req.method === "GET") {
    return new Response("✅ JARVIS is alive", { status: 200 });
  }

  // Telegram webhook endpoint
  if (url.pathname === "/telegram" && req.method === "POST") {
    try {
      const update = await req.json();
      await handleTelegramUpdate(update);
      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("Error:", err);
      return new Response("Error", { status: 500 });
    }
  }

  return new Response("Not Found", { status: 404 });
});
