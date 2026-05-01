// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROJECT_POD_MIGRATION Phase 7 Task 7.5 — Batch Producer
//
// Produces up to 6 videos (3 Sovereign Synthesis + 3 TCF) in a single GPU session.
//
// Architecture:
//   1. PRE-POD: Generate all scripts on Railway (LLM calls only, 10s pacing).
//      Validate every script before waking the pod.
//   2. WARM-POD: One withPodSession call, idleWindowMs = 5 min between jobs.
//      Feed validated scripts sequentially — job N finishes, job N+1 starts.
//   3. PER-VIDEO DISTRIBUTION: After each video returns from pod, run
//      executeFullPipeline's Steps 3-8 inline (YouTube upload, shorts curation,
//      Buffer scheduling). Distribution interleaves with next video's pod run
//      naturally — distribution is I/O bound, pod is GPU bound.
//
// Rate limits (verified S85):
//   - Anthropic: 50 RPM, 30K input tokens/min. 6 videos × 4 calls = 24 pre-pod
//     calls at 10s spacing = 4 min. Safe.
//   - Buffer: 100 req/15min. Shared limiter enforces 10s interval. Safe.
//   - YouTube Data API: 100 units/upload. 6 uploads = 600 units / 10K daily. Safe.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { LLMProvider } from "../types";
import type { Brand } from "../pod/types";
import {
  generateScript,
  type FacelessScript,
  type FacelessResult,
} from "./faceless-factory";
import { assertScriptUnique, ScriptTooSimilarError } from "../tools/script-uniqueness-guard";
import { pickNextNiche } from "../tools/niche-cooldown";
import {
  getAllowedNiches,
  normalizeNiche,
  isAllowedNiche,
} from "../data/shared-context";
import {
  getNicheCooldownSnapshot,
  recordNicheRun,
  pickNextAesthetic,
  type AestheticStyle,
} from "../tools/niche-cooldown";
import { AESTHETIC_MODIFIERS } from "./content-engine";
import { pickUnusedAngle } from "../data/thesis-angles";
// S125+ — Sequential rotator. Replaces the batch's old selectNichesForBrand
// LRU + pickUnusedAngle path with the deterministic march used by the
// auto-pipeline. One cursor per brand, advances per ship, ~225 unique seeds
// before any wrap. See src/tools/rotation-state.ts.
import { advanceAndPickSeed } from "../tools/rotation-state";
import { withPodSession } from "../pod/session";
import { produceVideo, splitOversizedScenes } from "../pod/runpod-client";
import type { JobSpec, Scene as PodScene } from "../pod/types";
import { executeFullPipeline } from "./vidrush-orchestrator";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const BATCH_SIZE_PER_BRAND = 3;
const SCRIPT_PACING_MS = 10_000; // 10s between LLM calls (Anthropic RPM safety)
const MAX_UNIQUENESS_RETRIES = 2;
const INTER_JOB_DELAY_MS = 5_000; // 5s between pod jobs (let GPU VRAM settle)
const BATCH_IDLE_WINDOW_MS = 5 * 60 * 1000; // 5 min pod warm between jobs

export interface BatchConfig {
  /** Videos per brand. Default 3 (= 6 total). */
  perBrand?: number;
  /** Brands to produce. Default both. */
  brands?: Brand[];
  /** Dry run — generate scripts but skip pod + distribution. */
  dryRun?: boolean;
  /** Progress callback for Telegram status updates. */
  onProgress?: (msg: string) => Promise<void>;
}

export interface BatchResult {
  totalScriptsGenerated: number;
  totalScriptsValid: number;
  totalVideosProduced: number;
  totalVideosDistributed: number;
  errors: string[];
  /** Per-video timing for diagnostics. */
  timings: { brand: Brand; niche: string; title: string; podMs: number; distMs: number }[];
}

interface ValidatedScript {
  brand: Brand;
  niche: string;
  sourceIntelligence: string;
  angleId: string | null;
  script: FacelessScript;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Niche selection — pick N unique niches per brand from cooldown ledger
// ─────────────────────────────────────────────────────────────────────────────
async function selectNichesForBrand(brand: Brand, count: number): Promise<string[]> {
  const snapshot = await getNicheCooldownSnapshot(brand);

  // Session 113+ — LRU rotation. snapshot.permittedLRU is permitted niches
  // sorted by lastRanAt ASC (never-run first, then oldest-used). This replaces
  // the Math.random() shuffle that landed on the same depleted niche back to
  // back and caused the S113 ScriptTooSimilarError regression.
  if (snapshot.permittedLRU.length >= count) {
    return snapshot.permittedLRU.slice(0, count);
  }

  // Not enough fresh/relax niches — fall back to full allowlist, also ordered
  // LRU by pulling in the full entries list and sorting by lastRanAt.
  const lruFallback = [...snapshot.entries]
    .sort((a, b) => {
      if (a.lastRanAt === null && b.lastRanAt === null) return a.niche.localeCompare(b.niche);
      if (a.lastRanAt === null) return -1;
      if (b.lastRanAt === null) return 1;
      return a.lastRanAt.getTime() - b.lastRanAt.getTime();
    })
    .map((e) => e.niche);

  if (lruFallback.length >= count) {
    return lruFallback.slice(0, count);
  }
  const allNiches = [...getAllowedNiches(brand)];
  return allNiches.slice(0, count);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Script pre-generation with pacing + uniqueness validation
// ─────────────────────────────────────────────────────────────────────────────
async function preGenerateScripts(
  llm: LLMProvider,
  brands: Brand[],
  perBrand: number,
  onProgress?: (msg: string) => Promise<void>,
): Promise<{ valid: ValidatedScript[]; errors: string[] }> {
  const valid: ValidatedScript[] = [];
  const errors: string[] = [];

  for (const brand of brands) {
    const brandLabel = brand === "sovereign_synthesis" ? "Sovereign Synthesis" : "TCF";

    await onProgress?.(`📝 ${brandLabel}: generating ${perBrand} scripts via sequential rotator`);

    for (let i = 0; i < perBrand; i++) {
      // S125+ — SEQUENTIAL ROTATOR. Each iteration advances the brand cursor
      // and returns the next (niche, angle) pair. Replaces the old LRU niche
      // pick + random angle pick which was producing same-niche duplicates
      // within a single batch (e.g. two SS legacy-engineering videos in one
      // run). The rotator guarantees ~225 unique seeds before any repeat.
      const seed = await advanceAndPickSeed(brand);
      let niche = seed.niche;
      const angleId: string | null = seed.angle.id;
      const sourceIntelligence =
        `BRAND: ${brand === "sovereign_synthesis" ? "Sovereign Synthesis" : "The Containment Field"}\n` +
        `NICHE: ${niche}\n\n` +
        `THESIS ANGLE:\n${seed.angle.seed}\n\n` +
        `Build the entire video around this specific angle. Do NOT generalize or ` +
        `broaden the topic — the thesis seed above IS the video's core argument. ` +
        `Expand it with evidence, mechanisms, lived examples, and a concrete ` +
        `sovereign takeaway the viewer can act on immediately.`;
      console.log(`🔄 [BatchProducer] ${brandLabel} slot ${i + 1}/${perBrand} → ${niche}/${angleId} (rotator slot=${seed.slotIndex}, pass=${seed.passIndex + 1})`);

      try {
        let script: FacelessScript | null = null;
        // S122c — divergence directive on retry. Mirrors faceless-factory.
        let divergenceDirective = "";

        for (let attempt = 0; attempt <= MAX_UNIQUENESS_RETRIES; attempt++) {
          // Pacing: 10s between every LLM call
          if (valid.length > 0 || attempt > 0) {
            await new Promise(r => setTimeout(r, SCRIPT_PACING_MS));
          }

          // S122c — rotate niche on retry to break out of the colliding lane.
          if (attempt > 0) {
            const rotatedNiche = await pickNextNiche(brand, niche);
            if (rotatedNiche !== niche) {
              console.log(`🔁 [BatchProducer] ${brandLabel} niche rotated for retry ${attempt}: ${niche} → ${rotatedNiche}`);
              niche = rotatedNiche;
            } else {
              console.warn(`⚠️ [BatchProducer] ${brandLabel} no alternate niche for retry ${attempt}`);
            }
          }

          const augmentedSource = divergenceDirective
            ? `${divergenceDirective}\n\n---\n\n${sourceIntelligence}`
            : sourceIntelligence;
          const candidate = await generateScript(llm, augmentedSource, niche, brand, "long", "horizontal");

          // Uniqueness check
          const corpus = [
            candidate.title,
            ...candidate.segments.map((s: any) => String(s.voiceover || s.text || "")),
          ].join("\n\n");

          try {
            await assertScriptUnique(brand, corpus);
            script = candidate;
            break;
          } catch (err: any) {
            if (err instanceof ScriptTooSimilarError) {
              console.warn(
                `⚠️ [BatchProducer] ${brandLabel}/${niche} attempt ${attempt + 1}: ` +
                `cosine=${err.score.toFixed(4)} → retrying`,
              );
              if (attempt === MAX_UNIQUENESS_RETRIES) {
                errors.push(`${brandLabel}/${niche}: ${MAX_UNIQUENESS_RETRIES + 1} consecutive duplicates — skipped`);
              }
              // Build divergence directive for next attempt.
              const colliderPreview = String(err.matchPreview || "").slice(0, 400).replace(/\s+/g, " ").trim();
              const candidateTitle = String(candidate.title || "").trim();
              divergenceDirective = [
                `🚫 DIVERGENCE DIRECTIVE — attempt ${attempt + 1} of this script clustered too closely with already-shipped content (cosine ${err.score.toFixed(3)}).`,
                ``,
                `ALREADY SHIPPED (do not retread): "${colliderPreview}"`,
                ``,
                `JUST PRODUCED + REJECTED: "${candidateTitle}"`,
                ``,
                `For this next attempt produce a script with a meaningfully DIFFERENT angle. Change the central metaphor, the opening hook, the structural frame, and the named target. Do not paraphrase the rejected attempt.`,
              ].join("\n");
              continue;
            }
            throw err;
          }
        }

        if (script) {
          // Validate script structure
          if (!script.segments || script.segments.length < 8) {
            errors.push(`${brandLabel}/${niche}: script has ${script.segments?.length ?? 0} segments (need ≥8) — skipped`);
            continue;
          }
          if (script.segments.length > 20) {
            errors.push(`${brandLabel}/${niche}: script has ${script.segments.length} segments (max 20) — skipped`);
            continue;
          }

          valid.push({ brand, niche, sourceIntelligence, angleId, script });
          await onProgress?.(
            `✅ ${brandLabel}/${niche}: "${script.title.slice(0, 60)}" ` +
            `(${script.segments.length} segments) [${valid.length}/${brands.length * perBrand}]`,
          );
        }
      } catch (err: any) {
        errors.push(`${brandLabel}/${niche}: ${err.message?.slice(0, 200)}`);
        await onProgress?.(`❌ ${brandLabel}/${niche}: script gen failed — ${err.message?.slice(0, 100)}`);
      }
    }
  }

  return { valid, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Thesis Angle Selection — replaces the generic "make a video about X" prompt
// with a deeply specific thesis seed from the angle matrix.
// Cross-batch tracking: angle IDs stored in niche_cooldown.source as "angle:<id>".
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pull all previously consumed angle IDs for a brand from Supabase.
 * Reads niche_cooldown rows where source starts with "angle:".
 * Graceful: returns empty Set on any failure.
 */
async function getUsedAngleIds(brand: Brand): Promise<Set<string>> {
  const usedIds = new Set<string>();
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return usedIds;

  try {
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/niche_cooldown?brand=eq.${encodeURIComponent(brand)}&source=like.angle:%25&select=source`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      },
    );
    if (resp.ok) {
      const rows = (await resp.json()) as Array<{ source: string }>;
      for (const row of rows) {
        const angleId = row.source.replace(/^angle:/, "");
        if (angleId) usedIds.add(angleId);
      }
      if (rows.length > 0) {
        console.log(`🎯 [BatchProducer] ${brand}: ${rows.length} angles previously consumed`);
      }
    }
  } catch (err: any) {
    console.warn(`[BatchProducer] Failed to fetch used angles for ${brand}: ${err?.message}`);
  }
  return usedIds;
}

/**
 * Build source intelligence from the thesis angle matrix.
 * Each call picks an unused angle and returns both the rich seed prompt AND the
 * angle ID for tracking. Falls back to a generic prompt if the matrix is exhausted.
 *
 * `usedAngleIds` is mutated in-place — the picked angle's ID is added so the
 * same angle can't be picked twice within a single batch.
 */
function buildSourceIntelligence(
  brand: Brand,
  niche: string,
  usedAngleIds: Set<string>,
): { text: string; angleId: string | null } {
  const brandName = brand === "sovereign_synthesis" ? "Sovereign Synthesis / Sovereign Synthesis" : "The Containment Field";

  const angle = pickUnusedAngle(brand, niche, usedAngleIds);

  if (angle) {
    usedAngleIds.add(angle.id);
    return {
      text:
        `BRAND: ${brandName}\n` +
        `NICHE: ${niche}\n\n` +
        `THESIS ANGLE:\n${angle.seed}\n\n` +
        `Build the entire video around this specific angle. Do NOT generalize or ` +
        `broaden the topic — the thesis seed above IS the video's core argument. ` +
        `Expand it with evidence, mechanisms, lived examples, and a concrete ` +
        `sovereign takeaway the viewer can act on immediately.`,
      angleId: angle.id,
    };
  }

  // All angles exhausted for this niche — fall back to generic prompt
  console.warn(`⚠️ [BatchProducer] All thesis angles exhausted for ${brand}/${niche} — using generic prompt`);
  return {
    text:
      `Generate a powerful ${niche} thesis for the ${brandName} brand. ` +
      `The video must explore a specific, non-obvious angle within ${niche} — ` +
      `not a general overview. Find the hidden mechanism, the counterintuitive truth, ` +
      `the thing the viewer has felt but never had words for. ` +
      `Make it concrete and actionable, not abstract philosophy.`,
    angleId: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Pod production — one warm session, sequential jobs
// ─────────────────────────────────────────────────────────────────────────────
async function produceBatchOnPod(
  llm: LLMProvider,
  scripts: ValidatedScript[],
  onProgress?: (msg: string) => Promise<void>,
): Promise<{ produced: ProducedVideo[]; errors: string[] }> {
  const produced: ProducedVideo[] = [];
  const errors: string[] = [];

  await onProgress?.(`🔥 Waking pod for ${scripts.length}-video batch...`);

  await withPodSession(async (handle) => {
    for (let i = 0; i < scripts.length; i++) {
      const { brand, niche, script } = scripts[i];
      const label = `${brand === "sovereign_synthesis" ? "SS" : "TCF"}/${niche}`;

      try {
        await onProgress?.(`🎬 [${i + 1}/${scripts.length}] Producing ${label}: "${script.title.slice(0, 50)}"`);

        const t0 = Date.now();

        // S114 — deterministic per-video jobId, threaded through both the
        // niche_cooldown insert (production time) and the eventual FacelessResult
        // (publish time) so the Aesthetic Performance tile can join YT analytics
        // back to the aesthetic_style row.
        const videoJobId = `fv_${brand}_${niche}_${Date.now()}_${i}`;

        // Session 113+ — pick aesthetic A/B/C via LRU, inject into every
        // scene's image prompt. All scenes in a given video share the same
        // aesthetic; next video rotates.
        const aestheticStyle: AestheticStyle = await pickNextAesthetic(brand);
        const aestheticMod = AESTHETIC_MODIFIERS[brand]?.[aestheticStyle] ?? "";

        // Build pod job spec — auto-split oversized TTS scenes (S91)
        const rawScenes: PodScene[] = script.segments.map((seg, idx) => ({
          index: idx,
          image_prompt: brand === "sovereign_synthesis"
            ? `${seg.visual_direction}. ${aestheticMod}NO people NO faces NO skin`
            : `${seg.visual_direction}. ${aestheticMod}`,
          tts_text: seg.voiceover,
          duration_hint_s: seg.duration_hint || undefined,
        }));
        const scenes = splitOversizedScenes(rawScenes);

        const hookText = script.hook?.slice(0, 60) || script.segments[0]?.voiceover?.split(" ").slice(0, 9).join(" ");

        const jobSpec: JobSpec = {
          brand,
          niche,
          seed: script.title,
          script: script.segments.map(s => s.voiceover).join("\n\n"),
          scenes,
          hook_text: hookText,
          // S125+ — pass our own jobId as client_job_id so the pod uploads to
          // a predictable R2 key (videos/{brand}/{client_job_id}.mp4).
          // Without this, the pod generates a random UUID and we lose
          // the ability to construct/lookup video URLs later.
          client_job_id: videoJobId,
        };

        await onProgress?.(`[${i + 1}/${scripts.length}] ${label} aesthetic: ${aestheticStyle}`);
        const artifacts = await produceVideo(handle, jobSpec);
        const podMs = Date.now() - t0;

        produced.push({
          brand,
          niche,
          script,
          videoUrl: artifacts.videoUrl,
          thumbnailUrl: artifacts.thumbnailUrl,
          durationS: artifacts.durationS ?? 0,
          podMs,
          rawNarrationUrl: artifacts.rawNarrationUrl,
          jobId: videoJobId,
        });

        await onProgress?.(
          `✅ [${i + 1}/${scripts.length}] ${label} produced in ${Math.round(podMs / 1000)}s ` +
          `(${Math.round((artifacts.durationS ?? 0))}s video)`,
        );

        // Record niche cooldown + angle consumption + aesthetic style
        // (S113+ — aesthetic logged for the 30-video A/B/C performance test)
        // (S114 — jobId threaded through so vidrush-orchestrator can patch
        //  niche_cooldown.youtube_video_id back after publish)
        try {
          const { angleId } = scripts[i];
          await recordNicheRun({
            brand,
            niche,
            thesis: script.title,
            jobId: videoJobId,
            source: angleId ? `angle:${angleId}` : "batch_generic",
            aestheticStyle,
          });
        } catch { /* non-fatal */ }

        // Inter-job delay (let VRAM settle)
        if (i < scripts.length - 1) {
          await new Promise(r => setTimeout(r, INTER_JOB_DELAY_MS));
        }
      } catch (err: any) {
        errors.push(`${label}: pod production failed — ${err.message?.slice(0, 200)}`);
        await onProgress?.(`❌ [${i + 1}/${scripts.length}] ${label} FAILED: ${err.message?.slice(0, 100)}`);
        // Continue to next video — don't kill the batch for one failure
      }
    }
  }, {
    idleWindowMs: BATCH_IDLE_WINDOW_MS,
  });

  return { produced, errors };
}

interface ProducedVideo {
  brand: Brand;
  niche: string;
  script: FacelessScript;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  durationS: number;
  podMs: number;
  rawNarrationUrl?: string;  // SESSION 92: clean TTS narration from pod
  /** S114: per-video deterministic jobId. Same value goes into both
   * niche_cooldown.job_id (production-time INSERT) and FacelessResult.jobId
   * (publish-time, so vidrush-orchestrator's PATCH can link niche_cooldown
   * → youtube_video_id for the Aesthetic Performance tile join). */
  jobId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: Distribution — per-video, interleaved
// Downloads R2 assets to local, builds FacelessResult, feeds into orchestrator
// via preProduced path (skips Steps 1+2, runs Steps 3-8).
// ─────────────────────────────────────────────────────────────────────────────

const BATCH_TEMP_DIR = join(process.cwd(), "tmp", "sovereign_batch");

async function downloadR2Asset(url: string, localPath: string): Promise<boolean> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return false;
    const buf = Buffer.from(await resp.arrayBuffer());
    writeFileSync(localPath, buf);
    return true;
  } catch {
    return false;
  }
}

async function distributeVideo(
  llm: LLMProvider,
  video: ProducedVideo,
  onProgress?: (msg: string) => Promise<void>,
  scheduledPublishAt?: string,
): Promise<{ success: boolean; error?: string; distMs: number }> {
  const label = `${video.brand === "sovereign_synthesis" ? "SS" : "TCF"}/${video.niche}`;
  const t0 = Date.now();

  try {
    if (!video.videoUrl) {
      return { success: false, error: `${label}: no video URL from pod`, distMs: 0 };
    }

    await onProgress?.(`📡 Distributing ${label}: "${video.script.title.slice(0, 50)}"`);

    // Download R2 video + thumbnail to local temp
    if (!existsSync(BATCH_TEMP_DIR)) mkdirSync(BATCH_TEMP_DIR, { recursive: true });
    const jobId = `batch_${video.brand}_${Date.now()}`;
    const localVideoPath = join(BATCH_TEMP_DIR, `${jobId}_final.mp4`);
    const localThumbPath = join(BATCH_TEMP_DIR, `${jobId}_longform_thumb.jpg`);

    const videoOk = await downloadR2Asset(video.videoUrl, localVideoPath);
    if (!videoOk) {
      return { success: false, error: `${label}: R2 video download failed`, distMs: Date.now() - t0 };
    }

    let thumbPath: string | null = null;
    if (video.thumbnailUrl) {
      const thumbOk = await downloadR2Asset(video.thumbnailUrl, localThumbPath);
      if (thumbOk) thumbPath = localThumbPath;
    }

    // Build a FacelessResult for the preProduced orchestrator path
    // SESSION 91 FIX: Use actual video duration / segment count instead of
    // duration_hint guesses — inflated hints were causing shorts curator to
    // reject every clip as >175s, resulting in 0 shorts + 0 Buffer posts.
    const actualPerSeg = video.durationS / video.script.segments.length;
    const preProduced: FacelessResult = {
      videoUrl: video.videoUrl,
      thumbnailUrl: video.thumbnailUrl,
      thumbnailPath: thumbPath,
      localPath: localVideoPath,
      title: video.script.title,
      niche: video.niche,
      brand: video.brand,
      duration: video.durationS,
      segmentCount: video.script.segments.length,
      script: video.script,
      segmentDurations: video.script.segments.map(() => actualPerSeg),
      rawNarrationUrl: video.rawNarrationUrl,
      // S114 — same jobId that batch-producer wrote into niche_cooldown,
      // so vidrush-orchestrator's post-publish PATCH lands on the right row.
      jobId: video.jobId,
    };

    // Feed into orchestrator Steps 3-8 via preProduced bypass
    const result = await executeFullPipeline(
      `batch_${jobId}`, // synthetic video ID
      llm,
      video.brand,
      async (step, detail) => {
        // Only forward major steps to Telegram
        if (step.includes("3/8") || step.includes("4/8") || step.includes("8/8")) {
          await onProgress?.(`  ${label} ${step}: ${detail.slice(0, 100)}`);
        }
      },
      {
        niche: video.niche,
        preProduced,
        scheduledPublishAt,
      },
    );

    const distMs = Date.now() - t0;
    await onProgress?.(
      `✅ ${label} distributed in ${Math.round(distMs / 1000)}s ` +
      `(${result.clipCount} shorts, ${result.bufferScheduled} Buffer posts)`,
    );

    // Cleanup local temp files
    try {
      const { unlinkSync } = await import("fs");
      if (existsSync(localVideoPath)) unlinkSync(localVideoPath);
      if (thumbPath && existsSync(thumbPath)) unlinkSync(thumbPath);
    } catch { /* non-critical */ }

    return { success: true, distMs };
  } catch (err: any) {
    const distMs = Date.now() - t0;
    return { success: false, error: `${label}: ${err.message?.slice(0, 200)}`, distMs };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────
export async function produceBatch(
  llm: LLMProvider,
  config: BatchConfig = {},
): Promise<BatchResult> {
  const perBrand = config.perBrand ?? BATCH_SIZE_PER_BRAND;
  const brands = config.brands ?? ["sovereign_synthesis", "containment_field"];
  const dryRun = config.dryRun ?? false;
  const onProgress = config.onProgress;
  const batchStart = Date.now();

  const result: BatchResult = {
    totalScriptsGenerated: 0,
    totalScriptsValid: 0,
    totalVideosProduced: 0,
    totalVideosDistributed: 0,
    errors: [],
    timings: [],
  };

  await onProgress?.(
    `🔥 BATCH PRODUCER ACTIVATED\n` +
    `${brands.length} brands × ${perBrand} videos = ${brands.length * perBrand} total\n` +
    `${dryRun ? "🏜️ DRY RUN — scripts only, no pod" : "🎯 LIVE — full production + distribution"}\n` +
    `────────────────────────────`,
  );

  // ── Phase 1: Pre-generate all scripts ──
  await onProgress?.(`\n📝 PHASE 1: Script pre-generation (${brands.length * perBrand} scripts, ~${Math.round(brands.length * perBrand * 4 * 10 / 60)} min)...`);

  const { valid, errors: scriptErrors } = await preGenerateScripts(llm, brands, perBrand, onProgress);
  result.totalScriptsGenerated = brands.length * perBrand;
  result.totalScriptsValid = valid.length;
  result.errors.push(...scriptErrors);

  if (valid.length === 0) {
    result.errors.push("No valid scripts generated — batch aborted before pod wake");
    await onProgress?.(`❌ No valid scripts. Batch aborted.\n${scriptErrors.join("\n")}`);
    return result;
  }

  await onProgress?.(
    `\n✅ SCRIPTS READY: ${valid.length}/${brands.length * perBrand} passed validation\n` +
    valid.map((s, i) => `  ${i + 1}. [${s.brand === "sovereign_synthesis" ? "SS" : "TCF"}] ${s.niche}: "${s.script.title.slice(0, 60)}"`).join("\n"),
  );

  if (dryRun) {
    await onProgress?.(`\n🏜️ DRY RUN complete. ${valid.length} scripts ready. Pod not woken.`);
    return result;
  }

  // ── Phase 2: Produce on pod ──
  await onProgress?.(`\n🔥 PHASE 2: Pod production (${valid.length} videos, one warm GPU session)...`);

  const { produced, errors: podErrors } = await produceBatchOnPod(llm, valid, onProgress);
  result.totalVideosProduced = produced.length;
  result.errors.push(...podErrors);

  if (produced.length === 0) {
    result.errors.push("No videos produced — batch aborted before distribution");
    await onProgress?.(`❌ No videos produced. Pod errors:\n${podErrors.join("\n")}`);
    return result;
  }

  // ── Phase 3: Distribute each video ──
  // SESSION 86: Stagger YouTube publish times 3 hours apart. Videos upload as
  // PRIVATE with publishAt, then YouTube auto-publishes at the scheduled time.
  // First video publishes 1 hour from now (gives upload time to complete),
  // then every 3 hours after. 6 videos = 16 hours of staggered content.
  const PUBLISH_STAGGER_MS = 3 * 60 * 60 * 1000; // 3 hours
  const FIRST_PUBLISH_OFFSET_MS = 60 * 60 * 1000; // 1 hour from now
  const publishBaseTime = Date.now() + FIRST_PUBLISH_OFFSET_MS;

  await onProgress?.(`\n📡 PHASE 3: Distribution (${produced.length} videos → YouTube + shorts + Buffer)...`);
  await onProgress?.(
    `📅 YouTube publish schedule (3h stagger):\n` +
    produced.map((v, i) => {
      const t = new Date(publishBaseTime + i * PUBLISH_STAGGER_MS);
      return `  ${i + 1}. ${v.brand === "sovereign_synthesis" ? "SS" : "TCF"}/${v.niche} → ${t.toISOString().slice(0, 16)}Z`;
    }).join("\n"),
  );

  for (let vi = 0; vi < produced.length; vi++) {
    const video = produced[vi];
    const publishAt = new Date(publishBaseTime + vi * PUBLISH_STAGGER_MS).toISOString();
    const { success, error, distMs } = await distributeVideo(llm, video, onProgress, publishAt);
    if (success) {
      result.totalVideosDistributed++;
    } else if (error) {
      result.errors.push(error);
    }
    result.timings.push({
      brand: video.brand,
      niche: video.niche,
      title: video.script.title,
      podMs: video.podMs,
      distMs,
    });
  }

  // ── Summary ──
  const elapsed = Math.round((Date.now() - batchStart) / 1000);
  const totalPodMin = Math.round(result.timings.reduce((s, t) => s + t.podMs, 0) / 60_000);
  const avgPodSec = result.timings.length > 0
    ? Math.round(result.timings.reduce((s, t) => s + t.podMs, 0) / result.timings.length / 1000)
    : 0;

  await onProgress?.(
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ BATCH COMPLETE in ${Math.round(elapsed / 60)}m ${elapsed % 60}s\n` +
    `Scripts: ${result.totalScriptsValid}/${result.totalScriptsGenerated} valid\n` +
    `Videos: ${result.totalVideosProduced} produced, ${result.totalVideosDistributed} distributed\n` +
    `GPU time: ~${totalPodMin} min total, ~${avgPodSec}s avg/video\n` +
    (result.errors.length > 0
      ? `Errors (${result.errors.length}):\n${result.errors.map(e => `  • ${e}`).join("\n")}\n`
      : "") +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  );

  return result;
}
