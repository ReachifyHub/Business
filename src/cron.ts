// src/cron.ts
import { getMyBotContext, getOfferContext } from "./vault.ts";
import { sendTelegram } from "./utils/telegram.ts";
import { postMediumArticle } from "./commands/medium.ts";
import { replyToNewComments } from "./commands/facebook.ts";
import { processScheduledPins } from "./commands/pinterest.ts";
import { getYesterdayStats, setYesterdayStats } from "./utils/state.ts";

const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

// ─── Daily routines ───
async function runDailyRoutines() {
  console.log("[cron] Starting daily routines...");
  const ctx = await getMyBotContext();
  const dnaVault = await getOfferContext("dna");

  // 1. Post a skill-based tweet (if Twitter is set up)
  // We'll skip since Twitter is not required yet.

  // 2. Post an ebook promo tweet (skip)

  // 3. Post a Medium article (optional – uncomment if wanted)
  // await postMediumArticle(CHAT_ID, { action: "daily" });

  // 4. Post to Facebook Page
  // We'll call the Facebook promo function directly – but it expects a chatId and command.
  // We'll import and call it if needed.

  // 5. Log success
  await sendTelegram(CHAT_ID, 
    `✅ Daily routines completed.\n` +
    `- (Medium article optional)\n` +
    `- Facebook/Quora/Pinterest scheduled tasks active.`
  );
}

// ─── Cron jobs ───

// Morning routine (9:00 UTC)
Deno.cron("Morning routine", "0 9 * * *", async () => {
  await runDailyRoutines();
});

// Afternoon check-in (13:00 UTC)
Deno.cron("Afternoon check-in", "0 13 * * *", async () => {
  await sendTelegram(CHAT_ID, "☀️ Afternoon update: All systems running. Need anything?");
});

// Evening summary (18:00 UTC)
Deno.cron("Evening summary", "0 18 * * *", async () => {
  // Gather stats (mock for now)
  const stats = await getYesterdayStats();
  await sendTelegram(CHAT_ID, 
    `🌙 End of day summary:\n` +
    `- Facebook comments replied: ${stats?.facebookReplies || 0}\n` +
    `- Pinterest pins posted: ${stats?.pinterestPosted || 0}\n` +
    `- Medium articles published: ${stats?.mediumPublished || 0}`
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

// Optional: Quora drafts (could run daily)
// Deno.cron("Quora drafts", "0 11 * * *", async () => {
//   await draftQuoraAnswers(CHAT_ID, {});
// });
