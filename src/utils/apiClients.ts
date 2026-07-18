// src/utils/apiClients.ts
// ─── Gemini (for longer content like articles) ───
export async function callGemini(prompt: string): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY")!;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`; /* 1†L6-L7 */
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

// ─── Groq (for short, fast content like pins, ads, replies) ───
export async function callGroq(prompt: string): Promise<string> {
  const key = Deno.env.get("GROQ_API_KEY")!;
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b", /* 0†L10 */
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1500,
    }),
  });
  if (!resp.ok) throw new Error(`Groq error: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices[0].message.content;
}

// ─── AI-powered greeting ───
export async function generateAIGreeting(params: {
  userName: string;
  businessName?: string;
  todayActivities: any[];
  todayPosts: any[];
  pendingDrafts: any[];
  vaultContext: string;
  timeOfDay: string;
}): Promise<string> {
  const prompt = `You are JimpAI, a friendly and professional AI marketing assistant for ${params.userName}.

CONTEXT:
- User's business: ${params.businessName || "not set yet"}
- Time of day: ${params.timeOfDay}
- Today's activities: ${params.todayActivities.length} actions
- Scheduled posts today: ${params.todayPosts.length}
- Pending Pinterest drafts: ${params.pendingDrafts.filter(d => d.status === "waiting_image").length}

VAULT CONTEXT (tone, voice, audience):
${params.vaultContext.slice(0, 2000)}

RULES:
- Write a warm, personal greeting in the voice of a trusted assistant.
- Be concise (max 200 words).
- Mention if there are pending drafts or no activity yet.
- If business name is set, reference it naturally.
- Offer 2-3 specific suggestions for what they could do today.
- Do NOT use exclamation marks excessively. Keep it professional but warm.
- End with an open question like "What would you like to focus on today?"

OUTPUT ONLY THE GREETING MESSAGE — no extra commentary.`;

  return await callGroq(prompt);
}

// ─── AI-powered fallback for unknown messages ───
export async function generateAIFallbackReply(userMessage: string, vaultContext: string): Promise<string> {
  const prompt = `You are JARVIS, a professional AI marketing assistant.

USER SAID: "${userMessage}"

VAULT CONTEXT (tone, voice, business details):
${vaultContext.slice(0, 1500)}

RULES:
- Respond helpfully and professionally.
- If the user is asking for help, suggest available commands: "create 3 pins", "post article", "post to facebook", "quora drafts", "good morning".
- If the user is sharing something, acknowledge it and offer assistance.
- Keep response under 150 words.
- Match the tone from the vault — plain, specific, no hype.

OUTPUT ONLY YOUR REPLY — no extra commentary.`;

  return await callGroq(prompt);
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
  const fileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${imageFileId}`;
  const fileResp = await fetch(fileUrl);
  if (!fileResp.ok) throw new Error(`Telegram file error: ${await fileResp.text()}`);
  const fileData = await fileResp.json();
  const filePath = fileData.result.file_path;
  const imageUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;

  const imageResp = await fetch(imageUrl);
  if (!imageResp.ok) throw new Error(`Image download error: ${await imageResp.text()}`);
  const imageBuffer = await imageResp.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));

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

// ─── Facebook ───
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
// WordPress API client
export async function postToWordPress(title: string, content: string) {
  const url = Deno.env.get("WORDPRESS_URL")!;
  const username = Deno.env.get("WORDPRESS_USERNAME")!;
  const appPassword = Deno.env.get("WORDPRESS_APP_PASSWORD")!;

  const endpoint = `${url}/wp-json/wp/v2/posts`;
  const auth = btoa(`${username}:${appPassword}`);

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: title,
      content: content, // WordPress accepts HTML and plain text
      status: "publish", // or "draft" if you want to review first
    }),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`WordPress API error (${resp.status}): ${errorText}`);
  }

  return resp.json();
}

