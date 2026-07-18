// src/main.ts
import { getMyBotContext, getOfferContext } from "./vault.ts";
import { sendTelegram, parseCommand } from "./utils/telegram.ts";
import { handlePinterestDraft, handleImageUpload } from "./commands/pinterest.ts";
import { postMediumArticle } from "./commands/medium.ts";
import { postFacebookPromo } from "./commands/facebook.ts";
import { draftQuoraAnswers } from "./commands/quora.ts";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

const kv = await Deno.openKv();

export async function handleTelegramUpdate(update: any) {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat.id;

  try {
    const text = message.text?.trim() || "";
    const lowerText = text.toLowerCase();

    // ─── Handle image uploads ───
    if (message.photo) {
      await handleImageUpload(chatId, message.photo);
      return;
    }

    // ─── Greeting flow ───
    if (lowerText.includes("good morning") || lowerText.includes("hey") || lowerText.includes("hello")) {
      const ctx = await getMyBotContext();
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
      case "facebook":
        await postFacebookPromo(chatId, command);
        break;
      case "quora":
        await draftQuoraAnswers(chatId, command);
        break;
      case "status":
        const status = await getStatus();
        await sendTelegram(chatId, status);
        break;
      default:
        await sendTelegram(chatId,
          `I didn't understand that. Try:\n` +
          `• "create 3 pins, 2 hours apart"\n` +
          `• "post article about Brand DNA"\n` +
          `• "post to facebook"\n` +
          `• "quora drafts"\n` +
          `• "good morning"`
        );
    }
  } catch (error: any) {
    console.error("Error in handleTelegramUpdate:", error);
    await sendTelegram(chatId, `❌ Error: ${error.message || "Unknown error"}`);
  }
}

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

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/" && req.method === "GET") {
    return new Response("✅ JARVIS is alive", { status: 200 });
  }
  if (url.pathname === "/telegram" && req.method === "POST") {
    try {
      const update = await req.json();
      await handleTelegramUpdate(update);
      return new Response("OK", { status: 200 });
    } catch (err) {
      console.error("Webhook error:", err);
      return new Response("Internal Error", { status: 500 });
    }
  }
  return new Response("Not Found", { status: 404 });
});
