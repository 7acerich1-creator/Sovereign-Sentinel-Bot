// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROJECT_POD_MIGRATION — Phase 5 Task 5.3 + 5.4
// Shorts Curator — surgical clip extraction from long-form.
//
// Runs AFTER the long-form video is produced. Reads the script +
// scene-level durations and uses an LLM to identify 3-4 natural
// climax/hook moments worth clipping. Each clip must stand alone
// and drive the viewer back to the long-form channel.
//
// The current "chop into 9-19 shorts" behavior (clip-generator.ts)
// is retired by this module. Conservative > over-cutting.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { LLMProvider, LLMMessage } from "../types";
import type { FacelessScript, ScriptSegment, Brand } from "./faceless-factory";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A curated short candidate identified by the LLM curator. */
export interface CuratedShort {
  /** 0-indexed start segment (inclusive). */
  start_segment: number;
  /** 0-indexed end segment (inclusive). */
  end_segment: number;
  /** Approximate start time in seconds (derived from segment durations). */
  start_ts: number;
  /** Approximate end time in seconds. */
  end_ts: number;
  /** The hook line — first thing the viewer hears/reads in the short. */
  hook_text: string;
  /** One sentence: why this moment works as a standalone short. */
  why_this_moment: string;
  /** CTA overlay text for the last 2 seconds. */
  cta_overlay: string;
  /** LLM's self-assessed confidence (0.0 - 1.0). */
  confidence: number;
}

/** Output of the curator: curated clips ready for extraction. */
export interface CuratorResult {
  brand: Brand;
  /** The curated shorts, sorted by confidence descending, hard-capped at 4. */
  shorts: CuratedShort[];
  /** Total long-form duration for reference. */
  long_form_duration_s: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_SHORTS = 4;
const MIN_SHORTS = 0; // If curator returns fewer than 2, that's acceptable
const MAX_SHORT_DURATION_S = 56; // SESSION 84: Was 59 — PAD_AFTER (1.5s) + PAD_BEFORE (0.3s) overflow to 60s+ causing ffmpeg hard-truncation mid-word. 56 + 1.8 padding = 57.8s max, safely under YouTube's 60s limit.
const MIN_SHORT_DURATION_S = 15; // Below this is too short to hook

const CHANNEL_HANDLES: Record<string, string> = {
  ace_richie: "@ace_richie77",
  containment_field: "@TheContainmentField",
};

// ─────────────────────────────────────────────────────────────────────────────
// Curator Prompt
// ─────────────────────────────────────────────────────────────────────────────

function buildCuratorPrompt(
  script: FacelessScript,
  segmentDurations: number[],
): string {
  // Build a numbered segment list with cumulative timestamps
  let cumulativeTs = 0;
  const segmentMap = script.segments.map((seg, i) => {
    const startTs = cumulativeTs;
    const dur = segmentDurations[i] || seg.duration_hint || 20;
    cumulativeTs += dur;
    return `[${i}] ${startTs.toFixed(1)}s-${cumulativeTs.toFixed(1)}s (${dur.toFixed(1)}s): "${seg.voiceover.slice(0, 200)}"`;
  }).join("\n");

  const totalDur = cumulativeTs;
  const channelHandle = CHANNEL_HANDLES[script.brand] || "@ace_richie77";

  return `You are a YouTube Shorts curator for a faceless documentary channel. Your job is to identify the 3-4 STRONGEST standalone moments from a long-form script that would make viewers click through to the full video on the channel.

RULES:
1. Each short MUST stand alone — a viewer who has never seen the long-form should understand and be hooked.
2. Each short must be 15-59 seconds (YouTube Shorts limit).
3. Shorts must NOT overlap in segment ranges.
4. Prioritize CLIMAX moments, HEAD FAKES (where the narrative misdirects then corrects), and EMOTIONAL PEAKS over introductions or transitions.
5. The hook_text is the first thing spoken — it must be a scroll-stopping statement or question, NOT "In this video" or "Let me explain."
6. Conservative > over-cutting. If only 2 moments are genuinely strong, return 2. If only 1, return 1. Never pad with weak clips.
7. CTA overlay for every short: "Full video on the channel — ${channelHandle}"

SCRIPT (${script.segments.length} segments, ${totalDur.toFixed(0)}s total):
Title: "${script.title}"
Brand: ${script.brand}
Hook: "${script.hook}"

SEGMENTS (with timestamps):
${segmentMap}

Return ONLY a JSON array (no markdown, no explanation). Each element:
{
  "start_segment": <0-indexed inclusive>,
  "end_segment": <0-indexed inclusive>,
  "hook_text": "<first spoken line of this short — the scroll-stopper>",
  "why_this_moment": "<one sentence explaining the standalone hook value>",
  "confidence": <0.0 to 1.0>
}

Return between 1 and 4 objects. Highest confidence first.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the shorts curator on a completed long-form script.
 *
 * @param llm - The LLM provider to use for curation decisions.
 * @param script - The full FacelessScript from the long-form pipeline.
 * @param segmentDurations - Actual per-segment audio durations (seconds) from
 *   the pod's XTTS step. Falls back to duration_hint if not provided.
 * @returns CuratorResult with 0-4 curated shorts.
 */
export async function curateShorts(
  llm: LLMProvider,
  script: FacelessScript,
  segmentDurations: number[],
): Promise<CuratorResult> {
  const prompt = buildCuratorPrompt(script, segmentDurations);

  const messages: LLMMessage[] = [
    { role: "system", content: "You are a surgical YouTube Shorts curator. Return ONLY valid JSON." },
    { role: "user", content: prompt },
  ];

  console.log(`🎬 [ShortsCurator] Analyzing ${script.segments.length} segments for ${script.brand}...`);

  const response = await llm.generate(messages, { temperature: 0.3 });
  const raw = response.content.trim();

  // Parse response — handle markdown code fences if the LLM wraps them
  let jsonStr = raw;
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  let candidates: any[];
  try {
    candidates = JSON.parse(jsonStr);
  } catch (err) {
    console.error(`[ShortsCurator] Failed to parse LLM response: ${raw.slice(0, 300)}`);
    return {
      brand: script.brand,
      shorts: [],
      long_form_duration_s: segmentDurations.reduce((a, b) => a + b, 0),
    };
  }

  if (!Array.isArray(candidates)) {
    console.error(`[ShortsCurator] Expected array, got: ${typeof candidates}`);
    return {
      brand: script.brand,
      shorts: [],
      long_form_duration_s: segmentDurations.reduce((a, b) => a + b, 0),
    };
  }

  // ── Validate + enrich each candidate ──────────────────────────────────
  const totalDuration = segmentDurations.reduce((a, b) => a + b, 0);
  const channelHandle = CHANNEL_HANDLES[script.brand] || "@ace_richie77";
  const validShorts: CuratedShort[] = [];

  for (const c of candidates) {
    const startSeg = Number(c.start_segment);
    const endSeg = Number(c.end_segment);

    // Bounds check
    if (
      isNaN(startSeg) || isNaN(endSeg) ||
      startSeg < 0 || endSeg < startSeg ||
      endSeg >= script.segments.length
    ) {
      console.warn(`[ShortsCurator] Skipping invalid segment range: ${startSeg}-${endSeg}`);
      continue;
    }

    // Calculate timestamps from segment durations
    let startTs = 0;
    for (let i = 0; i < startSeg; i++) {
      startTs += segmentDurations[i] || script.segments[i].duration_hint || 20;
    }
    let endTs = startTs;
    for (let i = startSeg; i <= endSeg; i++) {
      endTs += segmentDurations[i] || script.segments[i].duration_hint || 20;
    }

    const clipDuration = endTs - startTs;

    // Duration bounds
    if (clipDuration < MIN_SHORT_DURATION_S) {
      console.warn(`[ShortsCurator] Skipping too-short clip: ${clipDuration.toFixed(1)}s`);
      continue;
    }
    if (clipDuration > MAX_SHORT_DURATION_S) {
      console.warn(`[ShortsCurator] Skipping too-long clip: ${clipDuration.toFixed(1)}s (max ${MAX_SHORT_DURATION_S}s)`);
      continue;
    }

    // Check for overlap with already-accepted shorts
    const overlaps = validShorts.some(
      (existing) =>
        startSeg <= existing.end_segment && endSeg >= existing.start_segment
    );
    if (overlaps) {
      console.warn(`[ShortsCurator] Skipping overlapping clip: segments ${startSeg}-${endSeg}`);
      continue;
    }

    validShorts.push({
      start_segment: startSeg,
      end_segment: endSeg,
      start_ts: startTs,
      end_ts: endTs,
      hook_text: String(c.hook_text || script.segments[startSeg].voiceover.split(".")[0] || ""),
      why_this_moment: String(c.why_this_moment || ""),
      cta_overlay: `Full video on the channel — ${channelHandle}`,
      confidence: Math.max(0, Math.min(1, Number(c.confidence) || 0.5)),
    });
  }

  // Sort by confidence descending, hard cap at MAX_SHORTS (Task 5.4)
  validShorts.sort((a, b) => b.confidence - a.confidence);
  const finalShorts = validShorts.slice(0, MAX_SHORTS);

  console.log(
    `🎬 [ShortsCurator] ${finalShorts.length} shorts curated from ${candidates.length} candidates ` +
    `(${script.brand}, ${totalDuration.toFixed(0)}s long-form)`
  );

  for (const s of finalShorts) {
    console.log(
      `   📎 Segments ${s.start_segment}-${s.end_segment} ` +
      `(${s.start_ts.toFixed(1)}s-${s.end_ts.toFixed(1)}s, ` +
      `${(s.end_ts - s.start_ts).toFixed(1)}s) ` +
      `conf=${s.confidence.toFixed(2)} — "${s.hook_text.slice(0, 60)}"`
    );
  }

  return {
    brand: script.brand,
    shorts: finalShorts,
    long_form_duration_s: totalDuration,
  };
}
