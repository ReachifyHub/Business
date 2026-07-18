// src/utils/telegram.ts
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

export async function sendTelegram(chatId: number, text: string) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (error) {
    console.error("Error sending Telegram message:", error);
  }
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
  if (lower.includes("facebook") || lower.includes("page") || lower.includes("post to facebook")) {
    return { action: "facebook" };
  }
  if (lower.includes("quora")) return { action: "quora" };
  if (lower.includes("status")) return { action: "status" };
  return { action: "unknown" };
  // Add this line in parseCommand():
  if (lower.includes("post to blog") || lower.includes("wordpress")) {
  return { action: "wordpress" };
  }
}
