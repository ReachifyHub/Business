// src/commands/pinterest.ts
import { getOfferContext } from "../vault.ts";
import { sendTelegram, sendPhoto } from "../utils/telegram.ts";
import { generatePinCopy, generateImagePrompt, postPin } from "../utils/apiClients.ts";

const kv = await Deno.openKv();

export async function handlePinterestDraft(chatId: number, command: any) {
  // Parse count (default 3) and interval (default 2h)
  const count = 3; // could parse from command
  const intervalHours = 2;

  const vault = await getOfferContext("dna");

  // Generate drafts
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

  // Store in KV
  await kv.set(["pending_drafts"], drafts);

  // Send prompts to user
  let message = `📌 Generated ${count} Pinterest drafts:\n\n`;
  drafts.forEach((d, i) => {
    message += `**Pin ${i+1}:**\nTitle: ${d.title}\nDescription: ${d.description}\nPrompt: ${d.prompt}\n\n`;
  });
  message += `Send me the images one by one, and I'll post them ${intervalHours} hours apart.`;

  await sendTelegram(chatId, message);
}

export async function handleImageUpload(chatId: number, photo: any) {
  // Get the largest photo (file_id)
  const fileId = photo[photo.length - 1].file_id;

  // Fetch pending drafts
  const pending = await kv.get<Array<any>>(["pending_drafts"]);
  if (!pending.value || pending.value.length === 0) {
    await sendTelegram(chatId, "No pending drafts found. Send 'create pins' first.");
    return;
  }

  // Find first draft waiting for image
  const draftIdx = pending.value.findIndex(d => d.status === "waiting_image");
  if (draftIdx === -1) {
    await sendTelegram(chatId, "All drafts already have images assigned.");
    return;
  }

  // Assign image to draft
  pending.value[draftIdx].imageFileId = fileId;
  pending.value[draftIdx].status = "scheduled";
  pending.value[draftIdx].scheduledTime = Date.now() + 2 * 60 * 60 * 1000; // 2 hours

  // Store back
  await kv.set(["pending_drafts"], pending.value);

  // Schedule posting (we'll use a separate cron that checks scheduled times)
  // For now, just confirm
  await sendTelegram(chatId,
    `✅ Image received for Pin ${draftIdx+1}. It will post at ${new Date(pending.value[draftIdx].scheduledTime).toLocaleString()}.`
  );
}

// This cron runs every 10 minutes to check scheduled posts
Deno.cron("Check scheduled pins", "*/10 * * * *", async () => {
  const drafts = await kv.get<Array<any>>(["pending_drafts"]);
  if (!drafts.value) return;

  const now = Date.now();
  let updated = false;
  for (const d of drafts.value) {
    if (d.status === "scheduled" && d.scheduledTime <= now) {
      // Post the pin
      await postPin(d.title, d.description, d.imageFileId);
      d.status = "posted";
      updated = true;
    }
  }
  if (updated) {
    await kv.set(["pending_drafts"], drafts.value);
  }
});
