// tasks/fb_ads.ts
import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { REPO_ROOT, OUTREACH_DIR, readVault, logLearning, sendTelegram, extractSelarLink } from './shared.js';

const VAULT_FILES = [
  'Marketing/foundations.md',
  'Marketing/core-principles.md',
  'Marketing/Offers/website-dna/offer.md',
  'Marketing/Offers/website-dna/audience.md',
  'Marketing/Offers/website-dna/tone.md',
  'Marketing/Offers/website-dna/hooks-and-angles.md',
  'Marketing/Offers/website-dna/objections.md',
  'Marketing/Offers/website-dna/proof.md',
];

const META_API_BASE = 'https://graph.facebook.com/v19.0';

async function generateAdCopy(vaultText: string): Promise<{headline: string, primaryText: string}> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const prompt = `You are writing Facebook ad copy for the Website DNA™ ebook.

VAULT CONTEXT:
---
${vaultText}
---

RULES:
- Generate ONE headline (under 40 characters) and ONE primary text (under 125 characters).
- Facebook ad conventions: headline is the bold line below the image, primary text appears above the image.
- Follow the tone rules exactly — peer voice, plain, specific, no hype words, no exclamation marks.
- Name the exact problem the audience has. Sell the feeling, not the product.
- Do NOT invent testimonials or claims.
- Output format — exactly two lines:
HEADLINE: <your headline>
PRIMARY_TEXT: <your primary text>`;

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
    }),
  });
  if (!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  const text = data.choices[0].message.content;

  let headline = '', primaryText = '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('HEADLINE:')) headline = trimmed.substring(9).trim();
    else if (trimmed.startsWith('PRIMARY_TEXT:')) primaryText = trimmed.substring(13).trim();
  }
  if (!headline || !primaryText) throw new Error(`Could not parse ad copy: ${text.slice(0,200)}`);
  return { headline, primaryText };
}

async function generateAdImage(headline: string): Promise<string> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;
  if (!accountId || !apiToken) throw new Error('CF_ACCOUNT_ID or CF_API_TOKEN not set');

  const imagePrompt = `Clean professional social media ad graphic. Bold typography on a solid dark background with one accent color. Minimalist graphic style, NOT photorealistic. Text reads: '${headline}'. Modern sans-serif font, high contrast, simple geometric elements. Flat design, no photos, no 3D. Square format suitable for Facebook feed ad.`;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: imagePrompt }),
  });
  if (!resp.ok) throw new Error(await resp.text());

  let imageBuffer: Buffer;
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('image')) {
    imageBuffer = Buffer.from(await resp.arrayBuffer());
  } else {
    const data = await resp.json();
    const base64 = data.image || data.result?.image;
    if (!base64) throw new Error('Unexpected CF AI response format');
    imageBuffer = Buffer.from(base64, 'base64');
  }

  const tempFile = path.join(OUTREACH_DIR, `fb-ad-${Date.now()}.png`);
  await mkdir(OUTREACH_DIR, { recursive: true });
  await writeFile(tempFile, imageBuffer);
  return tempFile;
}

async function createPausedAd(headline: string, primaryText: string, imagePath: string, selarLink: string): Promise<{campaignId: string, adsetId: string, creativeId: string, adId: string}> {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  const pageId = process.env.META_PAGE_ID;

  // Validate all required Meta credentials
  if (!accessToken) throw new Error('META_ACCESS_TOKEN not set');
  if (!adAccountId) throw new Error('META_AD_ACCOUNT_ID not set');
  if (!pageId) throw new Error('META_PAGE_ID not set');

  const accountApiId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const params = { access_token: accessToken };

  // 1. Upload image
  let imageHash: string;
  try {
    const formData = new FormData();
    formData.append('file', await readFile(imagePath), 'image.png');
    const imgResp = await fetch(`${META_API_BASE}/${accountApiId}/adimages?access_token=${accessToken}`, {
      method: 'POST',
      body: formData,
    });
    if (!imgResp.ok) throw new Error(await imgResp.text());
    const imgData = await imgResp.json();
    imageHash = Object.values(imgData.images)[0].hash;
  } catch (e: any) {
    throw new Error(`Image upload failed: ${e.message}`);
  }

  // 2. Campaign (PAUSED)
  let campaignId: string;
  try {
    const payload = {
      name: `Website DNA — ${headline}`,
      objective: 'OUTCOME_TRAFFIC',
      status: 'PAUSED',
      special_ad_categories: [], // FIXED: was "[]" as string
    };
    const resp = await fetch(`${META_API_BASE}/${accountApiId}/campaigns?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    campaignId = data.id;
  } catch (e: any) {
    throw new Error(`Campaign creation failed: ${e.message}`);
  }

  // 3. Ad Set (PAUSED)
  let adsetId: string;
  try {
    const payload = {
      name: `Website DNA Ad Set — ${headline}`,
      campaign_id: campaignId,
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'LINK_CLICKS',
      destination_type: 'WEBSITE',
      status: 'PAUSED',
      targeting: {
        geo_locations: { countries: ['US', 'NG', 'KE', 'ZA', 'GB', 'CA'] },
        age_min: 18,
        age_max: 55,
      },
      daily_budget: 500,
      promoted_object: { custom_event_type: 'LINK_CLICKS' }, // keep as-is, test live
    };
    const resp = await fetch(`${META_API_BASE}/${accountApiId}/adsets?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    adsetId = data.id;
  } catch (e: any) {
    throw new Error(`Ad set creation failed: ${e.message}`);
  }

  // 4. Creative
  let creativeId: string;
  try {
    const payload = {
      name: `Website DNA Creative — ${headline}`,
      object_story_spec: {
        page_id: pageId,
        link_data: {
          link: selarLink,
          message: primaryText,
          name: headline,
          image_hash: imageHash,
        },
      },
    };
    const resp = await fetch(`${META_API_BASE}/${accountApiId}/adcreatives?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    creativeId = data.id;
  } catch (e: any) {
    throw new Error(`Creative creation failed: ${e.message}`);
  }

  // 5. Ad (PAUSED)
  let adId: string;
  try {
    const payload = {
      name: `Website DNA Ad — ${headline}`,
      adset_id: adsetId,
      creative: { creative_id: creativeId },
      status: 'PAUSED',
    };
    const resp = await fetch(`${META_API_BASE}/${accountApiId}/ads?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    adId = data.id;
  } catch (e: any) {
    throw new Error(`Ad creation failed: ${e.message}`);
  }

  return { campaignId, adsetId, creativeId, adId };
}

async function main() {
  const vaultText = await readVault(VAULT_FILES);
  const selarLink = extractSelarLink(vaultText);

  console.log('Generating Facebook ad draft (PAUSED — will NOT spend budget)...');
  let headline: string, primaryText: string;
  try {
    const copy = await generateAdCopy(vaultText);
    headline = copy.headline;
    primaryText = copy.primaryText;
  } catch (e: any) {
    await sendTelegram(`❌ Facebook ad copy generation failed: ${e.message}`);
    throw e;
  }

  let imagePath: string | null = null;
  try {
    imagePath = await generateAdImage(headline);
  } catch (e: any) {
    await sendTelegram(`❌ Facebook ad image generation failed: ${e.message}`);
    throw e;
  }

  let result: any;
  try {
    result = await createPausedAd(headline, primaryText, imagePath, selarLink);
  } catch (e: any) {
    await sendTelegram(`❌ Facebook ad creation failed: ${e.message}`);
    throw e;
  } finally {
    if (imagePath && existsSync(imagePath)) await unlink(imagePath);
  }

  const summary = `✅ Facebook ad created as PAUSED draft!\nHeadline: ${headline}\nPrimary text: ${primaryText}\nCampaign ID: ${result.campaignId}\nAd ID: ${result.adId}\n\n⚠️ Created as PAUSED draft — review and activate manually in Ads Manager if you want it live.`;
  await sendTelegram(summary);
  console.log(summary);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
