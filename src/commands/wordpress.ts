// src/commands/wordpress.ts
import { getOfferContext } from "../vault.ts";
import { sendTelegram } from "../utils/telegram.ts";
import { callGemini, postToWordPress } from "../utils/apiClients.ts";
import { parseHooks, extractSelarLink } from "../utils/helpers.ts";
import { trackActivity } from "../utils/state.ts";

export async function postToBlog(chatId: number, command: any) {
  const vault = await getOfferContext("dna");
  const selarLink = extractSelarLink(vault);
  const hooks = parseHooks(vault);

  const kv = await Deno.openKv();
  let state = await kv.get<{ lastIdx: number }>(["wordpress_state"]);
  const lastIdx = state.value?.lastIdx ?? -1;
  const nextIdx = (lastIdx + 1) % hooks.length;
  const hook = hooks[nextIdx];

  // Generate article using Gemini
  const prompt = `Write a blog post (800-1200 words) promoting the Website DNA™ ebook. Use this vault for context:\n${vault}\n\nAngle: ${hook.title}\nDetails: ${hook.lines.join("\n")}\n\nStart with a headline as the first line starting with "# ". Include the link as SELAR_LINK_PLACEHOLDER. Follow the tone rules. Use plain paragraphs, not markdown (WordPress accepts HTML, but we'll keep it simple). CRITICAL: Include the link SELAR_LINK_PLACEHOLDER at least 2-3 times naturally:
- Once in the introduction: "As I cover in my ebook..."
- Once in the middle: "The Website DNA™ framework (link) walks you through..."
- Once in the conclusion: "Get the full system at SELAR_LINK_PLACEHOLDER"

The link should feel like a natural part of the content, not an ad.`;
  const content = await callGemini(prompt);
  const article = content.replace(/SELAR_LINK_PLACEHOLDER/g, selarLink);

  // Extract title
  const lines = article.split("\n");
  let title = lines[0].replace(/^#\s*/, "").trim();
  // Remove the first line from body if it was the title
  const body = lines.slice(1).join("\n");

  try {
    const result = await postToWordPress(title, body);
    await trackActivity("wordpress", { title, url: result.link });
    await sendTelegram(chatId, `✅ Blog post published!\nTitle: ${title}\nURL: ${result.link}`);
    await kv.set(["wordpress_state"], { lastIdx: nextIdx });
  } catch (error: any) {
    await sendTelegram(chatId, `❌ Failed to post: ${error.message}`);
  }
}
