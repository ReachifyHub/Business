// src/commands/facebook.ts
import { getOfferContext } from "../vault.ts";
import { sendTelegram } from "../utils/telegram.ts";
import { callGemini, callGroq, postToFacebookPage, getPageComments, replyToComment } from "../utils/apiClients.ts";
import { getLastCheckedComment, setLastCheckedComment } from "../utils/state.ts";

const PAGE_ID = Deno.env.get("META_PAGE_ID")!;

// ─── Post to Facebook Page ───
export async function postFacebookPromo(chatId: number, command: any) {
  const vault = await getOfferContext("dna");

  // Generate post content using Gemini/Groq
  const prompt = `Create a Facebook post promoting the Website DNA™ ebook. Use this vault for context:\n${vault}\n\nWrite a compelling post (200-300 words) that educates and encourages clicks. No hype, plain language. Include the link: [SELAR_LINK]`;
  const content = await callGroq(prompt);
  const link = "https://selar.co/website-dna"; // or extract from vault

  // Post to Page
  const result = await postToFacebookPage(content, link);
  if (result.id) {
    await sendTelegram(chatId, `✅ Facebook post published! Post ID: ${result.id}`);
  } else {
    await sendTelegram(chatId, `❌ Failed to post: ${JSON.stringify(result)}`);
  }
}

// ─── Reply to new comments (triggered by cron) ───
export async function replyToNewComments() {
  console.log("[facebook] Checking for new comments...");
  const lastId = await getLastCheckedComment();
  const comments = await getPageComments(PAGE_ID, lastId);

  if (comments.length === 0) {
    console.log("[facebook] No new comments.");
    return;
  }

  // Get vault context for replies
  const vault = await getOfferContext("dna");

  for (const comment of comments) {
    // Generate reply using AI
    const prompt = `You are the author of the Website DNA™ ebook. Reply to this Facebook comment in a helpful, friendly, and informative way. Use the vault for context:\n${vault}\n\nComment: "${comment.message}"\n\nWrite a brief, natural reply (max 200 characters) that addresses the question or comment and subtly mentions the ebook if relevant.`;
    const replyText = await callGroq(prompt);

    // Post reply
    await replyToComment(comment.id, replyText);
    console.log(`[facebook] Replied to comment ${comment.id}`);
  }

  // Update last checked comment
  const lastComment = comments[comments.length - 1];
  if (lastComment) {
    await setLastCheckedComment(lastComment.id);
  }

  // Send summary to Telegram
  await sendTelegram(chatId, `💬 Replied to ${comments.length} new Facebook comments.`);
}
