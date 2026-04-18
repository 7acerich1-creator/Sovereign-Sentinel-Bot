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

/** A vertical scene for native 9:16 short rendering (Session 90). */
export interface VerticalScene {
  /** Scene index within this short (0-based). */
  index: number;
  /** FLUX image prompt composed for 9:16 portrait — NOT a crop of the horizontal prompt. */
  image_prompt: string;
  /** How long this scene should last in seconds. */
  duration_s: number;
}

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
  /** Vertical scene prompts for native 9:16 rendering (Session 90). */
  vertical_scenes: VerticalScene[];
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

const MAX_SHORTS = 6;
const MIN_SHORTS = 0; // If curator returns fewer than 2, that's acceptable
// SESSION 86: YouTube Shorts expanded to 3 minutes (180s) in late 2024.
// No arbitrary floor — a 5-second value-bomb is valid content. Quality decides, not duration.
const MAX_SHORT_DURATION_S = 175; // 175 + padding = ~177s, safely under 180s YouTube limit
const MIN_SHORT_DURATION_S = 3; // Only reject true glitches (sub-3s = something broke)

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
    // SESSION 92: Show FULL voiceover text (was sliced to 200 chars — LLM couldn't
    // see how segments end, causing incoherent shorts that cut mid-thought).
    return `[${i}] ${startTs.toFixed(1)}s-${cumulativeTs.toFixed(1)}s (${dur.toFixed(1)}s): "${seg.voiceover}"`;
  }).join("\n");

  const totalDur = cumulativeTs;
  const channelHandle = CHANNEL_HANDLES[script.brand] || "@ace_richie77";

  // Build visual direction map so LLM can re-imagine scenes for vertical
  const visualMap = script.segments.map((seg, i) => {
    return `[${i}] "${seg.visual_direction?.slice(0, 200) || "no visual direction"}"`;
  }).join("\n");

  return `You are a YouTube Shorts curator for a faceless documentary channel. Your job is to identify the 5-6 STRONGEST standalone moments from a long-form script that would make viewers click through to the full video on the channel.

RULES:
1. Each short MUST stand alone — a viewer who has never seen the long-form should understand and be hooked.
2. YouTube Shorts supports up to 3 minutes. A short can be 5 seconds or 2 minutes — duration does NOT matter. What matters is that the moment DELIVERS VALUE as a standalone piece. A 5-second insight that hits hard is better than a padded 45-second clip.
3. Shorts must NOT overlap in segment ranges.
4. Prioritize: CLIMAX moments, HEAD FAKES (narrative misdirection then correction), EMOTIONAL PEAKS, SINGLE-LINE TRUTH BOMBS (even if only one segment), and ACTIONABLE INSIGHTS (itemized lists, frameworks, techniques).
5. The hook_text is the first thing spoken — it must be a scroll-stopping statement or question, NOT "In this video" or "Let me explain."
6. Quality > quantity. If only 3 moments are genuinely strong, return 3. Never pad with weak clips. But a typical 12-16 segment long-form should yield 5-6 strong moments — look harder before settling for fewer.
7. CTA overlay for every short: "Full video on the channel — ${channelHandle}"
8. Mix durations — some shorts should be punchy (1-2 segments, under 30s), others can be deeper dives (3-4 segments, 60-120s). Variety in pacing keeps the channel from feeling algorithmic.

NARRATIVE COHERENCE (NON-NEGOTIABLE):
9. Every short MUST be a COMPLETE STORY with its own beginning, middle, and end. "Get off your ass!" is a complete story. "off your ass and" is NOT. Read the FULL text of each segment — if the first segment starts mid-argument (references something from a previous segment the viewer hasn't seen), it is NOT a valid start. If the last segment ends on a cliffhanger that only resolves in the next segment, it is NOT a valid end.
10. The first sentence of your selected range must INTRODUCE its own premise — no dangling references to prior segments. The last sentence must RESOLVE the point — no open loops or "but that's not all" trailing into the next segment.
11. A single-segment short is PREFERRED over a multi-segment short that starts or ends mid-thought. One powerful, complete statement beats three segments stitched into an incoherent mess.

VERTICAL SCENE GENERATION (CRITICAL):
Each short will be rendered as a NATIVE 9:16 vertical video, NOT cropped from horizontal. You must generate "vertical_scenes" for each short — these are NEW image prompts composed for PORTRAIT framing.

Rules for vertical_scenes:
- Each scene in the short's segment range gets ONE vertical_scene entry.
- The image_prompt must describe the scene composed for 9:16 PORTRAIT (tall, narrow frame). Think: subjects centered vertically, close-up faces filling the frame, tall architecture, figures standing, looking up/down.
- Do NOT just copy the horizontal prompt. RE-IMAGINE the composition for portrait: tighter framing, more vertical emphasis, subjects filling the tall narrow space.
- Include cinematic quality tags: "shot on 35mm kodak portra, shallow depth of field, chiaroscuro lighting, f/2.8 bokeh" etc.
- duration_s for each scene = that segment's audio duration (provided in the segment map).

SCRIPT (${script.segments.length} segments, ${totalDur.toFixed(0)}s total):
Title: "${script.title}"
Brand: ${script.brand}
Hook: "${script.hook}"

SEGMENTS (with timestamps):
${segmentMap}

HORIZONTAL VISUAL DIRECTIONS (for reference — re-imagine these for 9:16):
${visualMap}

Return ONLY a JSON array (no markdown, no explanation). Each element:
{
  "start_segment": <0-indexed inclusive>,
  "end_segment": <0-indexed inclusive>,
  "hook_text": "<first spoken line of this short — the scroll-stopper>",
  "why_this_moment": "<one sentence explaining the standalone hook value>",
  "confidence": <0.0 to 1.0>,
  "vertical_scenes": [
    {"index": 0, "image_prompt": "<9:16 portrait-composed FLUX prompt>", "duration_s": <seconds>},
    ...
  ]
}

Return between 1 and 6 objects. Highest confidence first.`;
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

    // Parse vertical_scenes from LLM response (Session 90)
    const rawVScenes: VerticalScene[] = [];
    if (Array.isArray(c.vertical_scenes)) {
      for (let vi = 0; vi < c.vertical_scenes.length; vi++) {
        const vs = c.vertical_scenes[vi];
        const segIdx = startSeg + vi;
        const segDur = segmentDurations[segIdx] || script.segments[segIdx]?.duration_hint || 15;
        rawVScenes.push({
          index: vi,
          image_prompt: String(vs.image_prompt || script.segments[segIdx]?.visual_direction || "dark cinematic portrait, 9:16"),
          duration_s: Number(vs.duration_s) > 0 ? Number(vs.duration_s) : segDur,
        });
      }
    }
    // Fallback: if LLM didn't generate vertical_scenes, create from horizontal prompts
    if (rawVScenes.length === 0) {
      for (let segI = startSeg; segI <= endSeg; segI++) {
        const segDur = segmentDurations[segI] || script.segments[segI]?.duration_hint || 15;
        rawVScenes.push({
          index: segI - startSeg,
          image_prompt: `9:16 portrait cinematic composition. ${script.segments[segI]?.visual_direction || "dark atmospheric scene"}. Shot on 35mm kodak portra 400, f/2.8 shallow depth of field, chiaroscuro lighting`,
          duration_s: segDur,
        });
      }
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
      vertical_scenes: rawVScenes,
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
