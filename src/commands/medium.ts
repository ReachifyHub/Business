// src/commands/medium.ts
import { getOfferContext } from "../vault.ts";
import { sendTelegram } from "../utils/telegram.ts";
import { callGemini, postMediumArticle } from "../utils/apiClients.ts";
import { parseHooks, extractSelarLink } from "../utils/helpers.ts";

export async function postMediumArticle(chatId: number, command: any) {
  const vault = await getOfferContext("dna");
  const selarLink = extractSelarLink(vault);
  const hooks = parseHooks(vault);

  // Rotate through hooks (store in KV)
  const kv = await Deno.openKv();
  let state = await kv.get<{ lastIdx: number }>(["medium_state"]);
  const lastIdx = state.value?.lastIdx ?? -1;
  const nextIdx = (lastIdx + 1) % hooks.length;
  const hook = hooks[nextIdx];

  // Generate article
  const prompt = `Write a Medium article (800-1200 words) promoting the Website DNA™ ebook. Use this vault for context:\n${vault}\n\nAngle: ${hook.title}\nDetails: ${hook.lines.join("\n")}\n\nStart with a headline as the first line starting with "# ". Include the link as SELAR_LINK_PLACEHOLDER. Follow the tone rules.`;
  const content = await callGemini(prompt);
  const article = content.replace(/SELAR_LINK_PLACEHOLDER/g, selarLink);

  // Extract title
  const title = article.split("\n")[0].replace(/^#\s*/, "").trim();

  // Post to Medium
  const result = await postMediumArticle(title, article);
  if (result.url) {
    await sendTelegram(chatId, `✅ Medium article published!\nTitle: ${title}\nURL: ${result.url}`);
    // Update state
    await kv.set(["medium_state"], { lastIdx: nextIdx });
  } else {
    await sendTelegram(chatId, `❌ Failed to post: ${JSON.stringify(result)}`);
  }
}
