// src/utils/apiClients.ts
// ─── Gemini ───
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
  if (!resp.ok) throw new Error(`Gemini error: ${await resp.text()}`);
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ─── Groq ───
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
  if (!resp.ok) throw new Error(`Groq error: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices[0].message.content;
}

// ─── Pinterest ───
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
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  // Get image URL from Telegram
  const fileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${imageFileId}`;
  const fileResp = await fetch(fileUrl);
  if (!fileResp.ok) throw new Error(`Telegram file error: ${await fileResp.text()}`);
  const fileData = await fileResp.json();
  const filePath = fileData.result.file_path;
  const imageUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

  // Download image
  const imageResp = await fetch(imageUrl);
  if (!imageResp.ok) throw new Error(`Image download error: ${await imageResp.text()}`);
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
  if (!resp.ok) throw new Error(`Pinterest error: ${await resp.text()}`);
  return resp.json();
}

// ─── Medium ───
export async function postMediumArticle(title: string, content: string) {
  const token = Deno.env.get("MEDIUM_INTEGRATION_TOKEN")!;
  const me = await fetch("https://api.medium.com/v1/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!me.ok) throw new Error(`Medium /me error: ${await me.text()}`);
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
  if (!resp.ok) throw new Error(`Medium post error: ${await resp.text()}`);
  return resp.json();
}

// ─── Facebook Page ───
export async function postToFacebookPage(message: string, link?: string) {
  const accessToken = Deno.env.get("META_ACCESS_TOKEN")!;
  const pageId = Deno.env.get("META_PAGE_ID")!;
  const url = `https://graph.facebook.com/v19.0/${pageId}/feed`;
  const body: any = { message, access_token: accessToken };
  if (link) body.link = link;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Facebook post error: ${await resp.text()}`);
  return resp.json();
}

export async function getPageComments(pageId: string, afterCommentId?: string | null) {
  const accessToken = Deno.env.get("META_ACCESS_TOKEN")!;
  let url = `https://graph.facebook.com/v19.0/${pageId}/feed?fields=comments{id,message,created_time}&access_token=${accessToken}&limit=10`;
  if (afterCommentId) {
    url += `&since_id=${afterCommentId}`;
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Facebook comments error: ${await resp.text()}`);
  const data = await resp.json();
  let allComments = [];
  for (const post of data.data || []) {
    if (post.comments && post.comments.data) {
      allComments = allComments.concat(post.comments.data);
    }
  }
  return allComments;
}

export async function replyToComment(commentId: string, message: string) {
  const accessToken = Deno.env.get("META_ACCESS_TOKEN")!;
  const url = `https://graph.facebook.com/v19.0/${commentId}/comments`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, access_token: accessToken }),
  });
  if (!resp.ok) throw new Error(`Facebook reply error: ${await resp.text()}`);
  return resp.json();
}
