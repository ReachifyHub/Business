// src/utils/state.ts
const kv = await Deno.openKv();

// ─── Drafts ───
export async function getPendingDrafts() {
  const result = await kv.get<Array<any>>(["pending_drafts"]);
  return result.value || [];
}

export async function setPendingDrafts(drafts: any[]) {
  await kv.set(["pending_drafts"], drafts);
}

export async function getNextPendingDraft() {
  const drafts = await getPendingDrafts();
  return drafts.find(d => d.status === "waiting_image") || null;
}

// ─── Scheduled posts ───
export async function getScheduledPosts() {
  const result = await kv.get<Array<any>>(["scheduled_posts"]);
  return result.value || [];
}

export async function addScheduledPost(post: any) {
  const posts = await getScheduledPosts();
  posts.push(post);
  await kv.set(["scheduled_posts"], posts);
}

export async function removeScheduledPost(postId: string) {
  const posts = await getScheduledPosts();
  const filtered = posts.filter(p => p.id !== postId);
  await kv.set(["scheduled_posts"], filtered);
}

// ─── Facebook comment tracking ───
export async function getLastCheckedComment() {
  const result = await kv.get<{ id: string }>(["fb_last_comment"]);
  return result.value?.id || null;
}

export async function setLastCheckedComment(commentId: string) {
  await kv.set(["fb_last_comment"], { id: commentId });
}

// ─── Stats (for daily summary) ───
export async function getYesterdayStats() {
  const result = await kv.get(["stats", "yesterday"]);
  return result.value || null;
}

export async function setYesterdayStats(stats: any) {
  await kv.set(["stats", "yesterday"], stats);
}
