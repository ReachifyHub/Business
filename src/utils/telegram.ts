// src/utils/telegram.ts
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

export async function sendTelegram(chatId: number, text: string) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

export async function sendPhoto(chatId: number, photoUrl: string, caption?: string) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption }),
  });
}

export function parseCommand(text: string): { action: string; args?: any } {
  const lower = text.toLowerCase();
  if (lower.includes("create") && lower.includes("pin")) return { action: "pinterest" };
  if (lower.includes("post article") || lower.includes("medium")) return { action: "medium" };
  if (lower.includes("tweet") || lower.includes("twitter")) return { action: "twitter" };
  if (lower.includes("ad") || lower.includes("facebook")) return { action: "fb_ad" };
  if (lower.includes("quora")) return { action: "quora" };
  if (lower.includes("outreach") || lower.includes("email")) return { action: "outreach" };
  if (lower.includes("status")) return { action: "status" };
  return { action: "unknown" };
}
