// src/main.ts
import { getMyBotContext } from "./vault.ts";
import { sendTelegram, parseCommand } from "./utils/telegram.ts";
import { handlePinterestDraft, handleImageUpload } from "./commands/pinterest.ts";
import { postMediumArticle } from "./commands/medium.ts";
import { postFacebookPromo } from "./commands/facebook.ts";
import { draftQuoraAnswers } from "./commands/quora.ts";
import { postToBlog } from "./commands/wordpress.ts";
import { generateAIFallbackReply, generateAIGreeting } from "./utils/apiClients.ts";
import { 
  getUserMemory, 
  updateUserMemory, 
  getTodayActivities, 
  getTodayScheduledPosts, 
  getPendingDrafts,
  trackActivity 
} from "./utils/state.ts";

const kv = await Deno.openKv();

export async function handleTelegramUpdate(update: any) {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat.id;
  const userId = message.from?.id?.toString() || "unknown";

  try {
    const text = message.text?.trim() || "";
    const lowerText = text.toLowerCase();

    // ─── Handle image uploads ───
    if (message.photo) {
      await handleImageUpload(chatId, message.photo);
      return;
    }

    // ─── Store user's business info ───
    if (lowerText.startsWith("my business is")) {
      const businessName = text.slice("my business is".length).trim();
      await updateUserMemory(userId, { businessName });
      await sendTelegram(chatId, `✅ Got it! Your business is "${businessName}".`);
      return;
    }

    // ─── AI-powered greeting flow ───
    if (lowerText.includes("good morning") || lowerText.includes("hey") || lowerText.includes("hello")) {
      const memory = await getUserMemory(userId);
      const todayActivities = await getTodayActivities();
      const todayPosts = await getTodayScheduledPosts();
      const pendingDrafts = await getPendingDrafts();
      const ctx = await getMyBotContext();

      const greeting = await generateAIGreeting({
        userName: message.from?.first_name || "boss",
        businessName: memory.businessName,
        todayActivities,
        todayPosts,
        pendingDrafts,
        vaultContext: ctx,
        timeOfDay: getTimeOfDay(),
      });

      await sendTelegram(chatId, greeting);
      await trackActivity("greeting", { userId });
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
      case "wordpress":
        await postToBlog(chatId, command);
        break;
      case "status":
        const status = await getStatus();
        await sendTelegram(chatId, status);
        break;
      default:
        const ctx = await getMyBotContext();
        const aiReply = await generateAIFallbackReply(text, ctx);
        await sendTelegram(chatId, aiReply);
        break;
    }
  } catch (error: any) {
    console.error("Error in handleTelegramUpdate:", error);
    await sendTelegram(chatId, `❌ Error: ${error.message || "Unknown error"}`);
  }
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
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
