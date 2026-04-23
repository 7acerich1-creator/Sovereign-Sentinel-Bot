// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SESSION 90: Backlog Drainer — Push existing R2 clips to Buffer
// One-shot function that runs at boot. Lists clips from R2 that haven't
// been distributed yet, routes them to the correct brand channels,
// and schedules them across Buffer with proper metadata + anti-ghost jitter.
// Respects the 250/day budget via the shared daily budget tracker.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import {
  getDailyCallCount,
  isDailyBudgetExhausted,
  isBufferQuotaExhausted,
  getBufferChannels,
} from "./buffer-graphql";
import { SocialSchedulerPostTool } from "../tools/social-scheduler";
import { publishToFacebook } from "./facebook-publisher";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_PUBLIC_URL_BASE = process.env.R2_PUBLIC_URL_BASE;
const R2_BUCKET = process.env.R2_BUCKET_VIDEOS || "sovereign-videos";

// Supabase tracking: mark clips as distributed so we don't double-send
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// Brand detection from clip path: clips/sovereign_synthesis_*  or  clips/containment_field_*
function detectBrand(key: string): "sovereign_synthesis" | "containment_field" {
  if (key.includes("containment_field")) return "containment_field";
  return "sovereign_synthesis";
}

// Extract a human-readable title from the clip folder name
// e.g. "clips/sovereign_synthesis_sovereignty_collapse_your_old_self_in_48_hours_1776469555753/clip_00.mp4"
// → "Collapse Your Old Self in 48 Hours"
function extractTitle(key: string): string {
  const parts = key.split("/");
  if (parts.length < 2) return "Sovereign Synthesis";
  const folder = parts[1]; // sovereign_synthesis_sovereignty_collapse_your_old_self_in_48_hours_1776469555753
  // Remove brand prefix, niche, and trailing timestamp
  const withoutBrand = folder
    .replace(/^sovereign_synthesis_/, "")
    .replace(/^containment_field_/, "");
  // Remove niche prefix (first segment before the actual title words)
  // Pattern: niche_actual_title_words_timestamp
  const segments = withoutBrand.split("_");
  // Last segment is the timestamp (all digits)
  if (/^\d+$/.test(segments[segments.length - 1])) {
    segments.pop();
  }
  // First segment is the niche — remove it
  if (segments.length > 1) {
    segments.shift();
  }
  // Title case the remaining words
  return segments
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .slice(0, 90);
}

// Platforms that REQUIRE media
const MEDIA_REQUIRED_SERVICES = new Set(["tiktok", "instagram", "youtube"]);

// Anti-Ghost jitter ±14 minutes (same as vidrush-orchestrator)
function antiGhostJitter(iso: string): string {
  const d = new Date(iso);
  const jitterMin = Math.floor(Math.random() * 29) - 14;
  d.setUTCMinutes(d.getUTCMinutes() + jitterMin);
  return d.toISOString().slice(0, 19) + "Z";
}

// Time slots: 8 per day (CT: 4AM, 6AM, 8AM, 10AM, 12PM, 2PM, 5PM, 8PM)
const TIME_SLOTS = ["09:00:00", "11:00:00", "13:00:00", "15:00:00", "17:00:00", "19:00:00", "22:00:00", "01:00:00"];

interface R2Clip {
  key: string;
  publicUrl: string;
  brand: "sovereign_synthesis" | "containment_field";
  batchFolder: string;
  clipIndex: number;
  title: string;
}

async function listR2Clips(): Promise<R2Clip[]> {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_PUBLIC_URL_BASE) {
    console.warn("[BacklogDrainer] R2 not configured — skipping");
    return [];
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  const clips: R2Clip[] = [];
  let continuationToken: string | undefined;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: "clips/",
      MaxKeys: 500,
      ContinuationToken: continuationToken,
    });
    const resp = await s3.send(cmd);
    for (const obj of resp.Contents || []) {
      if (!obj.Key?.endsWith(".mp4")) continue;
      if ((obj.Size || 0) < 10000) continue; // Skip empty/corrupt clips (< 10KB)

      const parts = obj.Key.split("/");
      const batchFolder = parts[1] || "unknown";
      const clipFile = parts[2] || "clip_00.mp4";
      const clipIndex = parseInt(clipFile.replace("clip_", "").replace(".mp4", ""), 10) || 0;

      clips.push({
        key: obj.Key,
        publicUrl: `https://${R2_PUBLIC_URL_BASE.replace(/^https?:\/\//, "")}/${obj.Key}`,
        brand: detectBrand(obj.Key),
        batchFolder,
        clipIndex,
        title: extractTitle(obj.Key),
      });
    }
    continuationToken = resp.NextContinuationToken;
  } while (continuationToken);

  return clips;
}

// Check Supabase for already-distributed clips
async function getDistributedClips(): Promise<Set<string>> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return new Set();
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/backlog_distributed?select=clip_key`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    if (!resp.ok) {
      console.warn(`⚠️ [BacklogDrainer] backlog_distributed query failed (${resp.status}) — table may not exist. Treating all clips as un-distributed.`);
      return new Set();
    }
    const rows = (await resp.json()) as any[];
    return new Set(rows.map(r => r.clip_key));
  } catch {
    return new Set();
  }
}

// Mark a clip as distributed in Supabase
async function markDistributed(clipKey: string, bufferPostIds: string[]): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/backlog_distributed`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        clip_key: clipKey,
        buffer_post_ids: bufferPostIds,
        distributed_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Non-critical — worst case we might double-post one clip
  }
}

/**
 * Main entry point. Call once at boot. Will:
 * 1. Wait for Buffer quota to have headroom
 * 2. List R2 clips
 * 3. Filter out already-distributed clips
 * 4. Post remaining clips to Buffer channels
 * 5. Stop when budget is exhausted or all clips are done
 */
export async function drainBacklog(): Promise<void> {
  console.log("🔄 [BacklogDrainer] Starting backlog drain check...");

  // Pre-flight: if budget is already exhausted, schedule a retry in 1 hour
  if (isDailyBudgetExhausted()) {
    console.log("⏸️ [BacklogDrainer] Daily budget exhausted — will retry in 1 hour");
    setTimeout(() => drainBacklog(), 60 * 60 * 1000);
    return;
  }

  // SESSION 105: Reserve 100 calls for ContentEngine sweeps + channel discovery + /drain manual.
  // In-memory counter resets on deploy, so be conservative — assume we might be mid-day.
  const RESERVED_BUDGET = 100;
  const availableBudget = 240 - getDailyCallCount() - RESERVED_BUDGET;
  if (availableBudget <= 0) {
    console.log(`⏸️ [BacklogDrainer] Not enough headroom (${availableBudget} calls available after reserve). Retry in 1h.`);
    setTimeout(() => drainBacklog(), 60 * 60 * 1000);
    return;
  }

  // List clips from R2
  const allClips = await listR2Clips();
  if (allClips.length === 0) {
    console.log("✅ [BacklogDrainer] No clips in R2 — nothing to drain");
    return;
  }

  // Filter out already-distributed clips
  const distributed = await getDistributedClips();
  const pending = allClips.filter(c => !distributed.has(c.key));

  if (pending.length === 0) {
    console.log(`✅ [BacklogDrainer] All ${allClips.length} clips already distributed — nothing to do`);
    return;
  }

  console.log(`📦 [BacklogDrainer] ${pending.length} clips pending distribution (${allClips.length} total, ${distributed.size} already done)`);
  console.log(`💰 [BacklogDrainer] Budget: ${availableBudget} calls available for backlog drain`);

  // Get Buffer channels and categorize by brand
  const channels = await getBufferChannels();
  if (channels.length === 0) {
    console.warn("❌ [BacklogDrainer] No Buffer channels found — aborting");
    return;
  }

  const acePatterns = /ace|richie|77/i;
  const cfPatterns = /containment|sovereign-synthesis\.com/i;

  type ChannelWithService = { id: string; service: string; name: string; displayName?: string };
  const aceChannels: ChannelWithService[] = [];
  const cfChannels: ChannelWithService[] = [];

  for (const ch of channels) {
    const nameCheck = `${ch.name} ${ch.displayName || ""}`;
    if (cfPatterns.test(nameCheck)) {
      cfChannels.push(ch);
    } else {
      aceChannels.push(ch);
    }
  }

  console.log(`📡 [BacklogDrainer] Channels: Ace=${aceChannels.length}, CF=${cfChannels.length}`);

  // Only post to media-required channels for shorts (video platforms)
  const aceMediaChannels = aceChannels.filter(c => MEDIA_REQUIRED_SERVICES.has(c.service));
  const cfMediaChannels = cfChannels.filter(c => MEDIA_REQUIRED_SERVICES.has(c.service));

  const postTool = new SocialSchedulerPostTool();
  let totalScheduled = 0;
  let apiCallsUsed = 0;
  let globalSlotIndex = 0;
  const now = new Date();

  // Group clips by batch folder so we schedule them in order
  const batchMap = new Map<string, R2Clip[]>();
  for (const clip of pending) {
    const existing = batchMap.get(clip.batchFolder) || [];
    existing.push(clip);
    batchMap.set(clip.batchFolder, existing);
  }

  for (const [batchFolder, clips] of batchMap) {
    const brand = clips[0].brand;
    const mediaChannels = brand === "containment_field" ? cfMediaChannels : aceMediaChannels;

    if (mediaChannels.length === 0) {
      console.warn(`⚠️ [BacklogDrainer] No media channels for brand ${brand} — skipping ${batchFolder}`);
      continue;
    }

    console.log(`📤 [BacklogDrainer] Batch: ${batchFolder} (${clips.length} clips, brand=${brand})`);

    for (const clip of clips) {
      // Budget check before each clip — local counter OR server-side 429 flag
      if (isDailyBudgetExhausted() || isBufferQuotaExhausted() || apiCallsUsed >= availableBudget) {
        console.warn(`⏸️ [BacklogDrainer] Budget limit reached after ${totalScheduled} posts. Will retry remaining in 1h.`);
        setTimeout(() => drainBacklog(), 60 * 60 * 1000);
        return;
      }

      const bufferPostIds: string[] = [];
      const clipTitle = clip.title;
      const niche = batchFolder.split("_").slice(brand === "containment_field" ? 2 : 2, 3).join("_") || "sovereignty";

      // Generate caption
      const caption = brand === "containment_field"
        ? `${clipTitle}\n\nThe containment field runs deeper than you think.\n\nsovereign-synthesis.com\n#TheContainmentField #DarkPsychology #${niche.replace(/_/g, "")}`
        : `${clipTitle}\n\nFirmware Update incoming.\n\nsovereign-synthesis.com\n#SovereignSynthesis #Protocol77 #${niche.replace(/_/g, "")}`;

      for (const channel of mediaChannels) {
        // Schedule across days + time slots
        const dayOffset = Math.floor(globalSlotIndex / TIME_SLOTS.length);
        const slotIdx = globalSlotIndex % TIME_SLOTS.length;
        if (dayOffset >= 14) break; // Cap at 2 weeks

        const schedDate = new Date(now);
        schedDate.setDate(schedDate.getDate() + dayOffset + 1);
        const scheduledAt = antiGhostJitter(
          `${schedDate.toISOString().split("T")[0]}T${TIME_SLOTS[slotIdx]}Z`
        );

        // Build platform-specific metadata
        const metadata: Record<string, unknown> = {};
        if (channel.service === "youtube") {
          const ytTitle = clipTitle.includes("#Shorts") ? clipTitle : `${clipTitle} #Shorts`;
          metadata.youtube = {
            title: ytTitle.slice(0, 100),
            categoryId: "22",
            privacy: "ENUM:public",
            madeForKids: false,
          };
        } else if (channel.service === "instagram") {
          metadata.instagram = {
            type: "ENUM:reel",
            shouldShareToFeed: true,
          };
        } else if (channel.service === "tiktok") {
          metadata.tiktok = { title: clipTitle };
        }

        try {
          const result = await postTool.execute({
            channel_ids: channel.id,
            text: caption,
            media_url: clip.publicUrl,
            scheduled_at: scheduledAt,
            niche,
            metadata_json: JSON.stringify(metadata),
          });

          apiCallsUsed++;

          if (result.includes("✅")) {
            totalScheduled++;
            const postIdMatch = result.match(/ID:\s*([^\s)]+)/);
            if (postIdMatch) bufferPostIds.push(postIdMatch[1]);
            console.log(`  📌 ${clip.key} → ${channel.service} @ ${scheduledAt}`);
          } else if (result.includes("Plan limit")) {
            console.warn(`  ⏸️ Plan limit hit — stopping distribution`);
            await markDistributed(clip.key, bufferPostIds);
            setTimeout(() => drainBacklog(), 60 * 60 * 1000);
            return;
          } else {
            console.error(`  ❌ ${clip.key} → ${channel.service}: ${result.slice(0, 200)}`);
          }
        } catch (err: any) {
          apiCallsUsed++;
          console.error(`  ❌ ${clip.key} → ${channel.service}: ${err.message?.slice(0, 200)}`);
        }

        globalSlotIndex++;

        // 10s delay between API calls
        await new Promise(r => setTimeout(r, 10_000));
      }

      // ── SESSION 97: Facebook direct publish for shorts ──
      // Posts clip caption to the correct FB Page (ace or CF) via Graph API.
      {
        try {
          const fbResult = await publishToFacebook(caption, {
            link: clip.publicUrl || undefined,
            brand: brand,
          });
          if (fbResult.success) {
            totalScheduled++;
            bufferPostIds.push(`fb:${fbResult.postId}`);
            console.log(`  📌 ${clip.key} → facebook_direct [Graph API, ${brand}]: ${fbResult.postId}`);
          } else {
            console.error(`  ❌ ${clip.key} → facebook_direct [${brand}]: ${fbResult.error}`);
          }
        } catch (err: any) {
          console.error(`  ❌ ${clip.key} → facebook_direct [${brand}]: ${err.message?.slice(0, 200)}`);
        }
      }

      // SESSION 92 FIX: Only mark as distributed if at least one channel succeeded.
      // Prior bug: marked clips "distributed" with empty buffer_post_ids[], hiding 40 unposted clips.
      if (bufferPostIds.length > 0) {
        await markDistributed(clip.key, bufferPostIds);
      } else {
        console.warn(`  ⚠️ ${clip.key}: No channels succeeded — NOT marking as distributed (will retry on next /drain)`);
      }
    }
  }

  console.log(`✅ [BacklogDrainer] Complete — ${totalScheduled} posts scheduled from ${pending.length} clips`);
}
