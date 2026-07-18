// src/utils/state.ts
const kv = await Deno.openKv();

// ─── User memory ───
export async function getUserMemory(userId: string) {
  const result = await kv.get(["user_memory", userId]);
  return result.value || {};
}

export async function updateUserMemory(userId: string, updates: any) {
  const current = await getUserMemory(userId);
  const updated = { ...current, ...updates, lastUpdated: Date.now() };
  await kv.set(["user_memory", userId], updated);
  return updated;
}

// ─── Activity tracking ───
export async function trackActivity(type: string, details: any) {
  const today = new Date().toISOString().slice(0, 10);
  const key = ["activity", today, type];
  const result = await kv.get<any[]>(key);
  const activities = result.value || [];
  activities.push({ ...details, timestamp: Date.now() });
  await kv.set(key, activities);
  
  const recent = await kv.get<any[]>(["activity", "recent"]);
  const recentList = recent.value || [];
  recentList.unshift({ type, details, timestamp: Date.now() });
  if (recentList.length > 50) recentList.pop();
  await kv.set(["activity", "recent"], recentList);
}

export async function getTodayActivities() {
  const today = new Date().toISOString().slice(0, 10);
  const result = await kv.get<any[]>(["activity", today]);
  return result.value || [];
}

export async function getRecentActivities() {
  const result = await kv.get<any[]>(["activity", "recent"]);
  return result.value || [];
}

// ─── Drafts ───
export async function getPendingDrafts() {
  const result = await kv.get<Array<any>>(["pending_drafts"]);
  return result.value || [];
}

export async function setPendingDrafts(drafts: any[]) {
  await kv.set(["pending_drafts"], drafts);
}

// ─── Scheduled posts ───
export async function getScheduledPosts() {
  const result = await kv.get<Array<any>>(["scheduled_posts"]);
  return result.value || [];
}

export async function getTodayScheduledPosts() {
  const posts = await getScheduledPosts();
  const today = new Date().toISOString().slice(0, 10);
  return posts.filter(p => {
    const date = new Date(p.scheduledTime).toISOString().slice(0, 10);
    return date === today;
  });
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

// ─── Stats ───
export async function getYesterdayStats() {
  const result = await kv.get(["stats", "yesterday"]);
  return result.value || null;
}

export async function setYesterdayStats(stats: any) {
  await kv.set(["stats", "yesterday"], stats);
}
