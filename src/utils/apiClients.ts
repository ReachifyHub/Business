// src/utils/apiClients.ts
// Gemini / Groq
export async function callGemini(prompt: string): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY")!;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 6000 },
    }),
  });
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

export async function callGroq(prompt: string): Promise<string> {
  const key = Deno.env.get("GROQ_API_KEY")!;
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1500,
    }),
  });
  const data = await resp.json();
  return data.choices[0].message.content;
}

// Pinterest
export async function generatePinCopy(vault: string) {
  const prompt = `Generate Pinterest pin copy from this vault:\n${vault}\n\nOutput:\nTITLE: ...\nDESCRIPTION: ...`;
  const text = await callGroq(prompt);
  const lines = text.split("\n");
  return {
    title: lines.find(l => l.startsWith("TITLE:"))?.replace("TITLE:", "").trim() || "Title",
    description: lines.find(l => l.startsWith("DESCRIPTION:"))?.replace("DESCRIPTION:", "").trim() || "Desc",
  };
}

export async function generateImagePrompt(title: string) {
  return `A clean Pinterest infographic with bold text: "${title}". Minimalist design, dark background, one accent color, modern sans-serif font.`;
}

export async function postPin(title: string, description: string, imageFileId: string) {
  // Get image URL from Telegram
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const fileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${imageFileId}`;
  const fileResp = await fetch(fileUrl);
  const fileData = await fileResp.json();
  const filePath = fileData.result.file_path;
  const imageUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

  // Download image
  const imageResp = await fetch(imageUrl);
  const imageBuffer = await imageResp.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));

  // Post to Pinterest
  const accessToken = Deno.env.get("PINTEREST_ACCESS_TOKEN")!;
  const boardId = Deno.env.get("PINTEREST_BOARD_ID")!;
  const resp = await fetch("https://api.pinterest.com/v5/pins", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      board_id: boardId,
      title,
      description,
      media_source: {
        source_type: "image_base64",
        content_type: "image/jpeg",
        data: base64,
      },
    }),
  });
  return resp.json();
}

// Medium
export async function postMediumArticle(title: string, content: string, vault: string) {
  const token = Deno.env.get("MEDIUM_INTEGRATION_TOKEN")!;
  const me = await fetch("https://api.medium.com/v1/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meData = await me.json();
  const userId = meData.data.id;

  const resp = await fetch(`https://api.medium.com/v1/users/${userId}/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      contentFormat: "markdown",
      content,
      publishStatus: "public",
    }),
  });
  return resp.json();
}

// Twitter / X
export async function postTweet(text: string) {
  const bearerToken = Deno.env.get("TWITTER_BEARER_TOKEN")!;
  const resp = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  return resp.json();
}

// Facebook Ads
export async function createFacebookAdDraft(headline: string, primaryText: string, imageBase64: string) {
  const accessToken = Deno.env.get("META_ACCESS_TOKEN")!;
  const adAccountId = Deno.env.get("META_AD_ACCOUNT_ID")!;
  // ... (full fb_ads.ts logic)
}
