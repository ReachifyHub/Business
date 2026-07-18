// src/cron.ts
import { getMyBotContext, getOfferContext } from "./vault.ts";
import { sendTelegram } from "./utils/telegram.ts";
import { postMediumArticle } from "./commands/medium.ts";
import { replyToNewComments } from "./commands/facebook.ts";
import { processScheduledPins } from "./commands/pinterest.ts";
import { getTodayActivities, getPendingDrafts, getScheduledPosts } from "./utils/state.ts";
import { generateAIGreeting } from "./utils/apiClients.ts";

const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

// ─── Daily morning routine ───
async function runMorningRoutine() {
  console.log("[cron] Starting morning routine...");
  const ctx = await getMyBotContext();
  const todayActivities = await getTodayActivities();
  const pendingDrafts = await getPendingDrafts();
  const scheduledPosts = await getScheduledPosts();

  // Generate an AI-powered morning briefing
  const greeting = await generateAIGreeting({
    userName: "Boss",
    businessName: "Boostlyte",
    todayActivities,
    todayPosts: scheduledPosts.filter(p => {
      const date = new Date(p.scheduledTime).toISOString().slice(0, 10);
      return date === new Date().toISOString().slice(0, 10);
    }),
    pendingDrafts,
    vaultContext: ctx,
    timeOfDay: "morning",
  });

  await sendTelegram(CHAT_ID, greeting);
}

// ─── Cron jobs ───

// Morning routine (9:00 UTC)
Deno.cron("Morning routine", "0 9 * * *", async () => {
  await runMorningRoutine();
});

// Afternoon check-in (13:00 UTC)
Deno.cron("Afternoon check-in", "0 13 * * *", async () => {
  const ctx = await getMyBotContext();
  const reply = await generateAIFallbackReply(
    "Afternoon update",
    ctx
  );
  await sendTelegram(CHAT_ID, `☀️ ${reply}`);
});

// Evening summary (18:00 UTC)
Deno.cron("Evening summary", "0 18 * * *", async () => {
  const activities = await getTodayActivities();
  const pendingDrafts = await getPendingDrafts();
  await sendTelegram(CHAT_ID, 
    `🌙 End of day summary:\n` +
    `- Activities today: ${activities.length}\n` +
    `- Pending drafts: ${pendingDrafts.filter(d => d.status === "waiting_image").length}\n` +
    `- Scheduled posts: ${(await getScheduledPosts()).length}\n\n` +
    `Good work today! 🚀`
  );
});

// Facebook comment replies (every 30 minutes)
Deno.cron("Facebook comment replies", "*/30 * * * *", async () => {
  await replyToNewComments();
});

// Pinterest scheduled posts (every 5 minutes)
Deno.cron("Pinterest scheduled posts", "*/5 * * * *", async () => {
  await processScheduledPins();
});

// Morning reminder for pending drafts (8:30 UTC)
Deno.cron("Pending drafts reminder", "30 8 * * *", async () => {
  const pendingDrafts = await getPendingDrafts();
  const waiting = pendingDrafts.filter(d => d.status === "waiting_image");
  if (waiting.length > 0) {
    await sendTelegram(CHAT_ID, 
      `📌 Reminder: You have ${waiting.length} Pinterest draft${waiting.length > 1 ? 's' : ''} waiting for images. Send them when you're ready.`
    );
  }
});
