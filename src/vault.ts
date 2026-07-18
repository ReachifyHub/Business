// src/vault.ts
const OWNER = Deno.env.get("GITHUB_VAULT_OWNER") || "ReachifyHub";
const REPO = Deno.env.get("GITHUB_VAULT_REPO") || "Business";
const BRANCH = Deno.env.get("GITHUB_VAULT_BRANCH") || "main";
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN") || "";

// If no token, try raw.githubusercontent.com (only works for public repos)
const API_BASE = GITHUB_TOKEN
  ? `https://api.github.com/repos/${OWNER}/${REPO}/contents`
  : `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;

const kv = await Deno.openKv();
const CACHE_TTL_MS = 15 * 60 * 1000;

// Helper: fetch a single file from GitHub API (authenticated) or raw (public)
async function fetchFile(path: string): Promise<string | null> {
  let url: string;
  let headers: Record<string, string> = {};

  if (GITHUB_TOKEN) {
    url = `${API_BASE}/${path}?ref=${BRANCH}`;
    headers = {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.raw+json",
    };
  } else {
    url = `${API_BASE}/${path}`;
  }

  try {
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      console.error(`[vault] Failed to fetch ${path}: ${resp.status}`);
      return null;
    }
    return await resp.text();
  } catch (e) {
    console.error(`[vault] Error fetching ${path}:`, e.message);
    return null;
  }
}

// Helper: get bundle from KV or fetch fresh
async function getBundle(key: string, filePaths: string[]): Promise<string> {
  const cacheEntry = await kv.get<{ content: string; timestamp: number }>([key]);
  if (cacheEntry.value) {
    const now = Date.now();
    if (now - cacheEntry.value.timestamp < CACHE_TTL_MS) {
      console.log(`[vault] Using cached bundle: ${key}`);
      return cacheEntry.value.content;
    }
  }

  console.log(`[vault] Fetching fresh bundle: ${key}`);
  const results = await Promise.all(filePaths.map(async (path) => {
    const content = await fetchFile(path);
    return { path, content };
  }));

  const successful = results.filter(r => r.content !== null);
  const failed = results.filter(r => r.content === null);
  for (const f of failed) {
    console.warn(`[vault] Missing/error: ${f.path}`);
  }

  if (successful.length === 0) {
    throw new Error(`Bundle "${key}" completely empty – all files failed.`);
  }

  const combined = successful.map(r => r.content).join("\n\n---\n\n");
  await kv.set([key], { content: combined, timestamp: Date.now() });
  return combined;
}

// Export functions
export async function getMyBotContext(): Promise<string> {
  const files = [
    "Marketing/foundations.md",
    "Marketing/core-principles.md",
    "Marketing/cold-email-structure.md",
    "PRODUCT_ROADMAP.md",
  ];
  return getBundle("myBotContext", files);
}

export async function getOfferContext(section: "ai" | "dna"): Promise<string> {
  const base = `Marketing/Offers/${section === "ai" ? "ai-automation" : "website-dna"}`;
  const files = [
    `${base}/offer.md`,
    `${base}/audience.md`,
    `${base}/tone.md`,
    `${base}/hooks-and-angles.md`,
    `${base}/objections.md`,
    `${base}/proof.md`,
  ];
  const key = `offerContext_${section}`;
  return getBundle(key, files);
}
