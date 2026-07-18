// src/vault.ts
import { DenoKv } from "https://deno.land/x/deno_kv@v0.3.0/mod.ts";

// Environment variables for GitHub repo
const OWNER = Deno.env.get("GITHUB_VAULT_OWNER") || "your-username";
const REPO = Deno.env.get("GITHUB_VAULT_REPO") || "your-repo";
const BRANCH = Deno.env.get("GITHUB_VAULT_BRANCH") || "main";
const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;

// KV instance (global)
const kv = await Deno.openKv();

// Cache TTL (15 minutes)
const CACHE_TTL_MS = 15 * 60 * 1000;

// Helper: fetch a single file, return content or null
async function fetchFile(path: string): Promise<string | null> {
  const url = `${RAW_BASE}/${path}`;
  try {
    const resp = await fetch(url);
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
async function getBundle(
  key: string,
  filePaths: string[]
): Promise<string> {
  // Check KV cache
  const cacheEntry = await kv.get<{ content: string; timestamp: number }>([key]);
  if (cacheEntry.value) {
    const now = Date.now();
    if (now - cacheEntry.value.timestamp < CACHE_TTL_MS) {
      console.log(`[vault] Using cached bundle: ${key}`);
      return cacheEntry.value.content;
    }
  }

  // Fetch all files in parallel
  console.log(`[vault] Fetching fresh bundle: ${key}`);
  const results = await Promise.all(filePaths.map(async (path) => {
    const content = await fetchFile(path);
    return { path, content };
  }));

  // Filter out failures, log each missing
  const successful = results.filter(r => r.content !== null);
  const failed = results.filter(r => r.content === null);
  for (const f of failed) {
    console.warn(`[vault] Missing/error: ${f.path}`);
  }

  if (successful.length === 0) {
    throw new Error(`[vault] Bundle "${key}" completely empty – all files failed.`);
  }

  // Combine with separator
  const combined = successful.map(r => r.content).join("\n\n---\n\n");

  // Store in KV
  await kv.set([key], { content: combined, timestamp: Date.now() });

  return combined;
}

// ----- Export functions -----

/** My bot's operating context – used for conversation, commands, daily routines */
export async function getMyBotContext(): Promise<string> {
  const files = [
    "Marketing/foundations.md",
    "Marketing/core-principles.md",
    "Marketing/cold-email-structure.md",
    // AGENT_RULES.md removed – not applicable at runtime
    "PRODUCT_ROADMAP.md",
  ];
  return getBundle("myBotContext", files);
}

/** Offer content for generating posts, emails, ad copy, etc. */
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
