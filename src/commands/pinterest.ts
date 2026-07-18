// src/commands/pinterest.ts
import { getOfferContext } from "../vault.ts";
import { sendTelegram } from "../utils/telegram.ts";
import { generatePinCopy, generateImagePrompt, postPin } from "../utils/apiClients.ts";
import { getPendingDrafts, setPendingDrafts, addScheduledPost, trackActivity } from "../utils/state.ts";

const CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID")!;

export async function handlePinterestDraft(chatId: number, command: any) {
  const count = 3;
  const intervalHours = 2;
  const vault = await getOfferContext("dna");

  const drafts = [];
  for (let i = 0; i < count; i++) {
    const copy = await generatePinCopy(vault);
    const prompt = await generateImagePrompt(copy.title);
    drafts.push({
      id: crypto.randomUUID(),
      title: copy.title,
      description: copy.description,
      prompt,
      status: "waiting_image",
      scheduledTime: null,
    });
  }

  await setPendingDrafts(drafts);

  let message = `📌 Generated ${count} Pinterest drafts:\n\n`;
  drafts.forEach((d, i) => {
    message += `**Pin ${i+1}:**\nTitle: ${d.title}\nDescription: ${d.description}\nPrompt: ${d.prompt}\n\n`;
  });
  message += `Send me the images one by one, and I'll post them ${intervalHours} hours apart.`;

  await sendTelegram(chatId, message);
}

export async function handleImageUpload(chatId: number, photo: any) {
  const fileId = photo[photo.length - 1].file_id;
  const drafts = await getPendingDrafts();
  const draftIdx = drafts.findIndex(d => d.status === "waiting_image");
  
  if (draftIdx === -1) {
    await sendTelegram(chatId, "No pending drafts waiting for images.");
    return;
  }

  drafts[draftIdx].imageFileId = fileId;
  drafts[draftIdx].status = "scheduled";
  drafts[draftIdx].scheduledTime = Date.now() + 2 * 60 * 60 * 1000;
  await setPendingDrafts(drafts);

  await sendTelegram(chatId, `✅ Image received for Pin ${draftIdx+1}. It will post at ${new Date(drafts[draftIdx].scheduledTime).toLocaleString()}.`);
}

export async function processScheduledPins() {
  const drafts = await getPendingDrafts();
  const now = Date.now();
  let updated = false;
  
  for (const d of drafts) {
    if (d.status === "scheduled" && d.scheduledTime <= now) {
      try {
        await postPin(d.title, d.description, d.imageFileId);
        d.status = "posted";
        updated = true;
        await trackActivity("pinterest", { title: d.title });
      } catch (error) {
        console.error(`Failed to post pin ${d.id}:`, error);
      }
    }
  }
  
  if (updated) {
    await setPendingDrafts(drafts);
    await sendTelegram(CHAT_ID, "✅ One or more Pinterest pins posted.");
  }
}
