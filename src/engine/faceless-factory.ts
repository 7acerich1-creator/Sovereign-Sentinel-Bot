// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — FACELESS VIDEO FACTORY
// Deterministic faceless video production pipeline:
//   1. LLM generates voiceover script from source intelligence
//   2. ElevenLabs/OpenAI TTS renders audio
//   3. Pollinations.ai generates scene images (FREE primary) → Gemini Imagen 4 → DALL-E 3 fallback
//   4. ffmpeg assembles: Ken Burns on images + voiceover + captions + color grade
//   5. Output → Supabase Storage → vid_rush_queue → auto-sweep to platforms
//
// This is the 95% engine — creates ORIGINAL content from extracted intelligence.
// The clip ripper (vid-rush.ts) handles the 5% where Ace is on camera.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { config } from "../config";
import { textToSpeech } from "../voice/tts";
import type { LLMProvider } from "../types";

const FACELESS_DIR = "/tmp/faceless_factory";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const STORAGE_BUCKET = "public-assets";

// ── Types ──

type Brand = "ace_richie" | "containment_field";
type Orientation = "horizontal" | "vertical";

// Dimension presets per orientation — single source of truth for all image gen + ffmpeg
const DIMS: Record<Orientation, {
  width: number; height: number;         // ffmpeg output (Ken Burns, fallback)
  pollW: number; pollH: number;          // Pollinations API
  aspectRatio: string;                   // Imagen 4 API
  dalleSize: string;                     // DALL-E 3 API
  promptTag: string;                     // injected into image gen prompts
}> = {
  horizontal: { width: 1920, height: 1080, pollW: 1792, pollH: 1024, aspectRatio: "16:9", dalleSize: "1792x1024", promptTag: "16:9 cinematic widescreen landscape composition" },
  vertical:   { width: 1080, height: 1920, pollW: 1024, pollH: 1792, aspectRatio: "9:16", dalleSize: "1024x1792", promptTag: "{ORIENTATION} portrait composition" },
};

interface ScriptSegment {
  voiceover: string;
  visual_direction: string;
  duration_hint: number; // seconds
}

interface FacelessScript {
  title: string;
  niche: string;
  brand: Brand;
  hook: string;
  segments: ScriptSegment[];
  cta: string;
}

interface FacelessResult {
  videoUrl: string | null;
  localPath: string;
  title: string;
  niche: string;
  brand: Brand;
  duration: number;
  segmentCount: number;
}

// ── Brand voice for script generation (reuses Anita's Protocol 77 voice) ──

// ── Robust JSON extraction from LLM responses ──
// LLMs frequently return JSON with trailing text, markdown fences, control chars, etc.
// This tries multiple strategies before giving up.
function extractJSON(raw: string): any | null {
  // Strategy 1: Direct parse after stripping code fences
  try {
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch { /* continue */ }

  // Strategy 2: Extract outermost { ... } with balanced brace matching
  try {
    let depth = 0;
    let start = -1;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (raw[i] === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          const candidate = raw.slice(start, i + 1);
          return JSON.parse(candidate);
        }
      }
    }
  } catch { /* continue */ }

  // Strategy 3: Greedy regex + strip control characters
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      // Remove control chars except \n \r \t
      const sanitized = match[0].replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
      return JSON.parse(sanitized);
    }
  } catch { /* continue */ }

  // Strategy 4: Fix common LLM JSON mistakes (trailing commas, single quotes)
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      let fixed = match[0]
        .replace(/,\s*([}\]])/g, "$1")        // trailing commas
        .replace(/'/g, '"')                     // single quotes → double
        .replace(/(\w+)\s*:/g, '"$1":')         // unquoted keys
        .replace(/""(\w+)""/g, '"$1"');         // double-double quotes
      return JSON.parse(fixed);
    }
  } catch { /* continue */ }

  // Strategy 5: TRUNCATION REPAIR — LLM ran out of tokens mid-JSON.
  // Close any open strings, arrays, and objects to salvage partial data.
  // This is critical for long-form scripts where 20 segments can exceed token limits.
  try {
    const match = raw.match(/\{[\s\S]*/);
    if (match) {
      let truncated = match[0]
        .replace(/```\s*$/g, "")              // Strip trailing code fence
        .replace(/,\s*([}\]])/g, "$1")        // Trailing commas
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ""); // Control chars

      // Close any open string (odd number of unescaped quotes)
      const quoteCount = (truncated.match(/(?<!\\)"/g) || []).length;
      if (quoteCount % 2 !== 0) truncated += '"';

      // Remove any trailing partial key-value pair (e.g., `"voiceover": "some text`)
      // by trimming back to the last complete value
      truncated = truncated.replace(/,\s*"[^"]*":\s*"[^"]*$/, "");
      truncated = truncated.replace(/,\s*"[^"]*":\s*$/, "");
      truncated = truncated.replace(/,\s*"[^"]*$/, "");

      // Close open structures: count [ vs ] and { vs }
      const openBraces = (truncated.match(/{/g) || []).length;
      const closeBraces = (truncated.match(/}/g) || []).length;
      const openBrackets = (truncated.match(/\[/g) || []).length;
      const closeBrackets = (truncated.match(/]/g) || []).length;

      // Close arrays first, then objects
      for (let i = 0; i < openBrackets - closeBrackets; i++) truncated += "]";
      for (let i = 0; i < openBraces - closeBraces; i++) truncated += "}";

      const repaired = JSON.parse(truncated);
      console.warn(`[extractJSON] Strategy 5: Repaired truncated JSON. Segments recovered: ${repaired.segments?.length || 0}`);
      return repaired;
    }
  } catch { /* continue */ }

  console.error(`[extractJSON] All 5 strategies failed`);
  return null;
}

// ── Cleanup: remove all temp files for a job ──
// Keeps the final video (needed by orchestrator) but removes intermediates
function cleanupJobFiles(jobId: string, keepFinal: boolean = true): void {
  try {
    const { readdirSync, unlinkSync, statSync } = require("fs");
    if (!existsSync(FACELESS_DIR)) return;
    const files = readdirSync(FACELESS_DIR) as string[];
    let cleaned = 0;
    for (const f of files) {
      if (!f.startsWith(jobId)) continue;
      if (keepFinal && f.endsWith("_final.mp4")) continue;
      const fullPath = `${FACELESS_DIR}/${f}`;
      try {
        const stat = statSync(fullPath);
        if (stat.isFile()) {
          unlinkSync(fullPath);
          cleaned++;
        }
      } catch { /* skip */ }
    }
    // Also clean up scene clips subdirectory
    const sceneDir = `${FACELESS_DIR}/${jobId}_scenes`;
    if (existsSync(sceneDir)) {
      try {
        const { rmSync } = require("fs");
        rmSync(sceneDir, { recursive: true, force: true });
        cleaned++;
      } catch { /* skip */ }
    }
    if (cleaned > 0) console.log(`🧹 [FacelessFactory] Cleaned ${cleaned} intermediate files for ${jobId}`);
  } catch (err: any) {
    console.error(`⚠️ [FacelessFactory] Cleanup error: ${err.message}`);
  }
}

const SCRIPT_VOICE: Record<Brand, string> = {
  ace_richie: `You are writing a voiceover script for a faceless video on the Sovereign Synthesis channel (Ace Richie).

VOICE: Sovereign, direct, zero-fear. You speak as someone who cracked the code and is handing the blueprint to the next person. Bold but warm, authoritative but approachable. You've escaped The Simulation.

LEXICON (use naturally): Firmware Update, Escape Velocity, The Simulation, Protocol 77, Biological Drag, Sovereign Synthesis.

STRUCTURE: HOOK (pattern interrupt, first 3 seconds) → PIVOT (dark psychology insight flipped into sovereignty tool) → ANCHOR (consciousness hook linking to Protocol 77).

The voiceover should sound like a human speaking — conversational, with natural pauses. NOT like reading an essay.`,

  containment_field: `You are writing a voiceover script for a faceless video on The Containment Field channel.

VOICE: Dark, clinical, anonymous. Intelligence analyst exposing hidden architecture of control. Detached but magnetic — like a declassified briefing. You don't motivate. You REVEAL.

THEMES: Dopamine extraction, manipulation defense, hidden power structures, cognitive warfare, pattern recognition.

STRUCTURE: HOOK (unsettling fact, cold open) → PIVOT (clinical mechanism breakdown) → ANCHOR (defense protocol, one actionable countermeasure).

The voiceover should sound measured and low-cadence — like a whistleblower reading a classified report. NOT dramatic.`
};

// ── Niche-specific image prompts for Ken Burns scenes ──

const SCENE_VISUAL_STYLE: Record<string, Record<Brand, string>> = {
  dark_psychology: {
    ace_richie: "Cinematic noir photography, amber light cutting through darkness, brutalist architecture, dramatic shadows, moody atmospheric, {ORIENTATION}. NO text, NO words, NO letters.",
    containment_field: "Surveillance camera aesthetic, rain-slicked urban night, cold blue lighting, neon reflections on wet concrete, clinical, {ORIENTATION}. NO text, NO words, NO letters.",
  },
  self_improvement: {
    ace_richie: "Golden hour photography, figure ascending stone steps, sovereign majestic landscape, warm amber tones, cinematic, {ORIENTATION}. NO text, NO words, NO letters.",
    containment_field: "Sterile corporate interior, shattered mirror, deconstructed wellness imagery, cool muted tones, clinical, {ORIENTATION}. NO text, NO words, NO letters.",
  },
  burnout: {
    ace_richie: "Chains dissolving into golden particles, industrial to natural transition, liberation imagery, warm undertones, cinematic, {ORIENTATION}. NO text, NO words, NO letters.",
    containment_field: "Human silhouette surrounded by screens, hamster wheel of devices, toxic green glow, suffocating composition, {ORIENTATION}. NO text, NO words, NO letters.",
  },
  quantum: {
    ace_richie: "Cosmic geometric light patterns, deep indigo and electric gold, sacred geometry, abstract energy visualization, cinematic, {ORIENTATION}. NO text, NO words, NO letters.",
    containment_field: "Data visualization glitching, reality wireframe overlaid on physical space, matrix aesthetic, cool blue-green, {ORIENTATION}. NO text, NO words, NO letters.",
  },
  brand: {
    ace_richie: "Midnight blue and amber, throne-like composition, master architect energy, sovereign aesthetic, cinematic, {ORIENTATION}. NO text, NO words, NO letters.",
    containment_field: "Dark room, single red light on classified document, information broker aesthetic, noir, {ORIENTATION}. NO text, NO words, NO letters.",
  },
};

// ── Niche color grades for ffmpeg (same as clip-generator.ts) ──

const NICHE_FILTERS: Record<string, string> = {
  dark_psychology: "eq=contrast=1.3:brightness=-0.05:saturation=0.8,vignette=PI/4",
  self_improvement: "eq=contrast=1.1:brightness=0.05:saturation=1.2",
  burnout: "eq=contrast=0.9:brightness=0.02:saturation=0.7",
  quantum: "eq=contrast=1.2:saturation=1.4:gamma=0.9",
  brand: "eq=contrast=1.2:brightness=0.0:saturation=1.0",
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 1: Generate Script from Source Intelligence
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function generateScript(
  llm: LLMProvider,
  sourceIntelligence: string,
  niche: string,
  brand: Brand,
  targetDuration: "short" | "long" = "short",
  orientation: Orientation = "vertical"
): Promise<FacelessScript> {
  const voice = SCRIPT_VOICE[brand];
  const segmentCount = targetDuration === "short" ? 5 : 20;
  const durationRange = targetDuration === "short" ? "30-60 seconds" : "10-15 minutes";
  const perSegmentGuidance = targetDuration === "short"
    ? `Each segment's voiceover should be 2-4 natural spoken sentences (about 30-50 words).`
    : `Each segment's voiceover should be 6-10 natural spoken sentences (about 80-130 words). This is CRITICAL — short segments will make the video too short. Write as if you're narrating a documentary scene, not a social media clip. Take your time. Let ideas breathe. Use rhetorical pauses. Paint the picture slowly.`;
  const durationHintExample = targetDuration === "short" ? 8 : 40;
  const durationHintNote = targetDuration === "short"
    ? `duration_hint is approximate seconds per segment (total should sum to ~45s)`
    : `duration_hint MUST be 30-45 seconds per segment (total should sum to 600-900 seconds / 10-15 minutes). Do NOT use values under 25.`;

  // Groq free tier has strict per-request token limits.
  // The full prompt template + rules + JSON schema ~2000 tokens.
  // Truncate source intelligence aggressively to stay under limits.
  // 2500 chars ≈ ~700 tokens — keeps total well under Groq's cap.
  const truncatedIntel = sourceIntelligence.slice(0, 2500);
  const prompt = `${voice}

SOURCE INTELLIGENCE (extracted from research):
${truncatedIntel}

TARGET: ${durationRange} faceless video with ${segmentCount} visual segments.
NICHE: ${niche.replace(/_/g, " ")}

Generate a voiceover script as a JSON object with this exact structure:
{
  "title": "Short punchy title for the video (max 60 chars)",
  "hook": "The first 1-2 sentences — the scroll-stopping opening line",
  "segments": [
    {
      "voiceover": "The text to be spoken aloud for this segment",
      "visual_direction": "Brief description of what the viewer SEES during this segment",
      "duration_hint": ${durationHintExample}
    }
  ],
  "cta": "Closing call-to-action directing to sovereign-synthesis.com"
}

RULES:
- The hook MUST stop someone mid-scroll in under 3 seconds
- ${perSegmentGuidance}
- PACING: Write for a MEASURED, documentary-style voiceover — not a fast-talking YouTuber. Include natural pauses with ellipses (...) and rhetorical questions. Use SHORT sentences. Let ideas land. Leave space between thoughts. The listener should feel like they're being let in on a secret, not being sold something. Every 4 segments, write a transitional beat — a sentence that signals a shift in the narrative ("But here's where it gets interesting..." or "Now... consider this.").
- Visual directions should be CINEMATIC and specific — think B-roll descriptions
- FORMAT: ${orientation === "horizontal" ? "LANDSCAPE 16:9 — compose for widescreen. Sweeping vistas, wide establishing shots, cinematic framing with negative space." : "VERTICAL 9:16 — compose for mobile. Center subject, close crops, portrait framing."}
- ${durationHintNote}
- CTA should feel organic, not salesy — "The full protocol is at sovereign-synthesis.com"
- Return ONLY valid JSON, no markdown code fences, no explanation`;

  // Long-form scripts with 20 segments of 80-130 words each need ~5-6k tokens of output.
  // Groq free tier: 12,000 TPM (tokens per minute) = input + output combined.
  // With ~2k input tokens, max output must stay under ~8k to avoid 413 errors.
  // 8192 is plenty for 20 segments. Previous 12288 exceeded Groq's TPM limit.
  const maxTokens = targetDuration === "long" ? 8192 : 4096;

  const response = await llm.generate(
    [{ role: "user", content: prompt }],
    { maxTokens, temperature: 0.8 }
  );
  const result = response.content;

  // Robust JSON extraction — LLMs frequently return malformed JSON
  const parsed = extractJSON(result);
  if (!parsed) {
    console.error(`[FacelessFactory] ALL JSON parse attempts failed. Raw response (first 500 chars):\n${result.slice(0, 500)}`);
    throw new Error(`Failed to parse script from LLM. Response starts: ${result.slice(0, 150)}`);
  }

  // Enforce minimum duration hints for long mode
  const minDurationHint = targetDuration === "long" ? 25 : 5;
  const defaultDurationHint = targetDuration === "long" ? 40 : 8;

  const segments = (parsed.segments || []).map((s: any) => ({
    voiceover: s.voiceover || "",
    visual_direction: s.visual_direction || "",
    duration_hint: Math.max(s.duration_hint || defaultDurationHint, minDurationHint),
  }));

  // Log actual voiceover word counts for debugging duration
  const wordCounts = segments.map((s: any, i: number) => {
    const words = s.voiceover.split(/\s+/).filter(Boolean).length;
    return `seg${i}:${words}w`;
  });
  const totalWords = segments.reduce((sum: number, s: any) => sum + s.voiceover.split(/\s+/).filter(Boolean).length, 0);
  const estimatedMinutes = (totalWords / 140).toFixed(1); // ~140 WPM for measured narration
  console.log(`📊 [FacelessFactory] Script word counts: [${wordCounts.join(", ")}] | Total: ${totalWords} words | Estimated: ~${estimatedMinutes} min at 140 WPM`);

  // QUALITY GATE (Session 23): Enforce minimum segment count for long-form.
  // If the LLM produces fewer than 15 segments, the video will be 2-4 min instead of 10-15.
  // This was the root cause of "Break Free" at 171s (7 segments) and "Beyond The Simulation"
  // at 258s (12 segments). The LLM simply doesn't produce enough content on the first pass.
  if (targetDuration === "long" && segments.length < 15) {
    console.warn(`⚠️ [FacelessFactory] Only ${segments.length} segments (need 15+). Attempting segment expansion...`);
    // Don't retry the whole LLM call (costs time + tokens) — instead, expand what we have.
    // Take each short segment and ask the LLM to elaborate it into 2 segments.
    const expansionNeeded = Math.max(15 - segments.length, 5);
    const segmentsToExpand = segments
      .map((s: any, i: number) => ({ ...s, _idx: i, _words: s.voiceover.split(/\s+/).filter(Boolean).length }))
      .sort((a: any, b: any) => a._words - b._words) // Expand shortest segments first
      .slice(0, expansionNeeded);

    for (const seg of segmentsToExpand) {
      try {
        const expandPrompt = `You are expanding a voiceover script segment for a faceless documentary video.

ORIGINAL SEGMENT: "${seg.voiceover}"
VISUAL: "${seg.visual_direction}"

Rewrite this as TWO separate segments. Each segment should be 6-10 sentences (80-130 words).
The first segment sets up the idea. The second segment deepens it with examples, implications, or a provocative question.
Write in a measured, documentary-style voice — not fast-talking.

Return ONLY valid JSON:
[
  { "voiceover": "first segment text", "visual_direction": "visual for first", "duration_hint": 35 },
  { "voiceover": "second segment text", "visual_direction": "visual for second", "duration_hint": 35 }
]`;

        // Groq free tier: 12k TPM. Space expansion calls to avoid hitting the per-minute cap.
        // Each call is ~2.3k tokens. 5 calls in <60s would consume ~11.5k of the 12k budget.
        if (seg !== segmentsToExpand[0]) {
          await new Promise(r => setTimeout(r, 3000)); // 3s between expansion calls
        }
        const expandResponse = await llm.generate(
          [{ role: "user", content: expandPrompt }],
          { maxTokens: 2048, temperature: 0.7 }
        );

        const expandParsed = extractJSON(expandResponse.content);
        if (Array.isArray(expandParsed) && expandParsed.length === 2) {
          // Replace the original segment with the two expanded ones
          const idx = segments.findIndex((s: any) => s.voiceover === seg.voiceover);
          if (idx !== -1) {
            segments.splice(idx, 1,
              { voiceover: expandParsed[0].voiceover, visual_direction: expandParsed[0].visual_direction || seg.visual_direction, duration_hint: Math.max(expandParsed[0].duration_hint || 35, 25) },
              { voiceover: expandParsed[1].voiceover, visual_direction: expandParsed[1].visual_direction || seg.visual_direction, duration_hint: Math.max(expandParsed[1].duration_hint || 35, 25) }
            );
            console.log(`  📝 Expanded segment ${seg._idx}: ${seg._words}w → ${expandParsed[0].voiceover.split(/\s+/).length}w + ${expandParsed[1].voiceover.split(/\s+/).length}w`);
          }
        }
      } catch (err: any) {
        console.warn(`  ⚠️ Expansion failed for segment ${seg._idx}: ${err.message?.slice(0, 100)}`);
      }
    }

    const newTotal = segments.reduce((sum: number, s: any) => sum + s.voiceover.split(/\s+/).filter(Boolean).length, 0);
    console.log(`📊 [FacelessFactory] After expansion: ${segments.length} segments, ${newTotal} words (~${(newTotal / 140).toFixed(1)} min)`);
  }

  if (targetDuration === "long" && totalWords < 800) {
    console.warn(`⚠️ [FacelessFactory] Long-form script only has ${totalWords} words — expected 1200-1800 for 10-15 min. Video will be shorter than target.`);
  }

  return {
    title: parsed.title || "Untitled",
    niche,
    brand,
    hook: parsed.hook || parsed.segments?.[0]?.voiceover || "",
    segments,
    cta: parsed.cta || "The full protocol is at sovereign-synthesis.com",
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 2: Render TTS Audio from Script
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface AudioRenderResult {
  audioPath: string;
  /** Per-segment durations in seconds (voiceover + trailing silence/chapter pad).
   *  Length matches the number of actual TTS segments rendered.
   *  Used by assembleVideo to align scene visuals with speech timing. */
  segmentDurations: number[];
}

async function renderAudio(script: FacelessScript, jobId: string): Promise<AudioRenderResult> {
  const audioPath = `${FACELESS_DIR}/${jobId}_voiceover.mp3`;

  // For long-form (many segments), TTS APIs have character limits
  // (OpenAI: 4096, ElevenLabs: 5000). Chunk per segment and concatenate.
  const allSegmentTexts = [
    ...script.segments.map(s => s.voiceover),
    script.cta
  ];
  const totalChars = allSegmentTexts.reduce((sum, t) => sum + t.length, 0);
  const isLongForm = allSegmentTexts.length > 8;
  // QUALITY GATE (Session 24): Documentary cadence — slow and deliberate.
  // 0.85x was still too rushed per Session 23 test. 0.80x with 1.5s silence pads
  // + 2.5s chapter breaks every 4 segments creates measured pacing.
  const ttsSpeed = isLongForm ? 0.80 : undefined;
  console.log(`🗣️ [FacelessFactory] Rendering TTS — ${allSegmentTexts.length} segments, ${totalChars} chars total${isLongForm ? " (long-form, 0.80x speed)" : ""}`);

  // If total text fits in one call (short-form), do it in one shot
  if (totalChars <= 3800) {
    const fullText = allSegmentTexts.join(" ... ");
    const audioBuffer = await textToSpeech(fullText, ttsSpeed ? { speed: ttsSpeed } : undefined);

    const rawPath = `${FACELESS_DIR}/${jobId}_voiceover_raw.opus`;
    writeFileSync(rawPath, audioBuffer);

    try {
      execSync(
        `ffmpeg -i "${rawPath}" -ar 44100 -ac 1 -c:a libmp3lame -b:a 128k -y "${audioPath}"`,
        { timeout: 60_000, stdio: "pipe" }
      );
    } catch {
      writeFileSync(audioPath, audioBuffer);
    }

    console.log(`✅ [FacelessFactory] Audio rendered (single pass): ${audioPath}`);
    // Single-pass: we don't have per-segment timing, use equal division
    const equalDur = (() => {
      try {
        const d = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`, { timeout: 10_000, stdio: "pipe" }).toString().trim();
        return (parseFloat(d) || 60) / allSegmentTexts.length;
      } catch { return 60 / allSegmentTexts.length; }
    })();
    return { audioPath, segmentDurations: allSegmentTexts.map(() => equalDur) };
  }

  // Long-form: render each segment separately, then concatenate with ffmpeg
  const segmentPaths: string[] = [];
  const rawSegDurations: number[] = []; // voiceover-only durations per segment (seconds)

  for (let i = 0; i < allSegmentTexts.length; i++) {
    const segText = allSegmentTexts[i];
    if (!segText.trim()) continue;

    const segRaw = `${FACELESS_DIR}/${jobId}_seg_${i}_raw.opus`;
    const segMp3 = `${FACELESS_DIR}/${jobId}_seg_${i}.mp3`;

    // Retry logic: 3 attempts with exponential backoff. NO skipping — every segment is required.
    const MAX_TTS_RETRIES = 3;
    let segBuffer: Buffer | null = null;

    for (let attempt = 1; attempt <= MAX_TTS_RETRIES; attempt++) {
      try {
        console.log(`  🗣️ Segment ${i + 1}/${allSegmentTexts.length} (${segText.length} chars) — attempt ${attempt}/${MAX_TTS_RETRIES}...`);
        segBuffer = await textToSpeech(segText, ttsSpeed ? { speed: ttsSpeed } : undefined);
        break; // Success — exit retry loop
      } catch (err: any) {
        console.error(`  ⚠️ TTS attempt ${attempt} failed for segment ${i + 1}: ${err.message?.slice(0, 200)}`);
        if (attempt === MAX_TTS_RETRIES) {
          throw new Error(`TTS FATAL: Segment ${i + 1}/${allSegmentTexts.length} failed after ${MAX_TTS_RETRIES} attempts. Cannot produce broken video. Last error: ${err.message?.slice(0, 300)}`);
        }
        // Exponential backoff: 2s, 4s
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }

    writeFileSync(segRaw, segBuffer!);

    // Convert to mp3
    try {
      execSync(
        `ffmpeg -i "${segRaw}" -ar 44100 -ac 1 -c:a libmp3lame -b:a 128k -y "${segMp3}"`,
        { timeout: 30_000, stdio: "pipe" }
      );
    } catch {
      // If ffmpeg conversion fails, write raw as mp3
      writeFileSync(segMp3, segBuffer!);
    }

    // Measure this segment's audio duration for scene sync
    let segAudioDur = 3; // default fallback
    try {
      const d = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${segMp3}"`, { timeout: 10_000, stdio: "pipe" }).toString().trim();
      segAudioDur = parseFloat(d) || 3;
    } catch { /* use default */ }

    segmentPaths.push(segMp3);
    rawSegDurations.push(segAudioDur);

    // Small delay between TTS calls to avoid rate limits
    if (i < allSegmentTexts.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  if (segmentPaths.length === 0) {
    throw new Error("All TTS segments failed — cannot produce audio");
  }

  // QUALITY GATE (Session 24): 1.5s silence between segments, 2.5s chapter breaks every 4.
  // Session 23 test showed 0.6s was too tight — felt like a run-on. 1.5s lets ideas breathe.
  const silencePad = `${FACELESS_DIR}/${jobId}_silence.mp3`;
  const chapterPad = `${FACELESS_DIR}/${jobId}_chapter.mp3`;
  try {
    execSync(
      `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 1.5 -c:a libmp3lame -b:a 128k -y "${silencePad}"`,
      { timeout: 10_000, stdio: "pipe" }
    );
    // Chapter break: longer pause every 4 segments for documentary feel
    execSync(
      `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 2.5 -c:a libmp3lame -b:a 128k -y "${chapterPad}"`,
      { timeout: 10_000, stdio: "pipe" }
    );
  } catch {
    // If silence generation fails, we'll concatenate without pads
  }
  const hasSilencePad = existsSync(silencePad);
  const hasChapterPad = existsSync(chapterPad);

  // Concatenate all segment mp3s with silence pads + chapter breaks
  const concatListPath = `${FACELESS_DIR}/${jobId}_audio_concat.txt`;
  const concatLines: string[] = [];
  for (let i = 0; i < segmentPaths.length; i++) {
    concatLines.push(`file '${segmentPaths[i]}'`);
    // Add silence between segments (not after the last one)
    if (i < segmentPaths.length - 1) {
      // Chapter break every 4 segments (longer pause for documentary pacing)
      if (hasChapterPad && (i + 1) % 4 === 0) {
        concatLines.push(`file '${chapterPad}'`);
      } else if (hasSilencePad) {
        concatLines.push(`file '${silencePad}'`);
      }
    }
  }
  writeFileSync(concatListPath, concatLines.join("\n"));

  // Concatenate with silence pads, then apply loudnorm + voice warmth
  const rawConcatPath = `${FACELESS_DIR}/${jobId}_voiceover_raw_concat.mp3`;
  try {
    execSync(
      `ffmpeg -f concat -safe 0 -i "${concatListPath}" -c:a libmp3lame -b:a 128k -y "${rawConcatPath}"`,
      { timeout: 120_000, stdio: "pipe" }
    );
  } catch (err: any) {
    console.warn(`[FacelessFactory] Concat failed, using first segment: ${err.message?.slice(0, 200)}`);
    const { copyFileSync } = require("fs");
    copyFileSync(segmentPaths[0], rawConcatPath);
  }

  // QUALITY GATE: Audio post-processing chain
  //   1. highpass — remove rumble below 80Hz
  //   2. acompressor — gentle compression to even out volume peaks
  //   3. bass boost — voice warmth (subtle low-end fill)
  //   4. high cut — reduce harshness above 3kHz
  //   5. [long-form only] room reverb — cinematic presence via dual-tap aecho
  //      Creates the "dark theater" feel where the voice exists in a space,
  //      not injected dry into the ear. Two reflections: 100ms + 200ms.
  //      Shorts stay dry — they need to hit fast and direct.
  //   6. loudnorm — EBU R128 consistent volume
  const reverbFilter = isLongForm
    ? `aecho=0.8:0.72:100|200:0.25|0.15,`  // Dark theater: dual-tap room reverb
    : "";
  try {
    execSync(
      `ffmpeg -i "${rawConcatPath}" ` +
        `-af "highpass=f=80,` +
        `acompressor=threshold=-20dB:ratio=3:attack=5:release=50,` +
        `equalizer=f=200:t=h:w=100:g=3,` +  // Warm bass boost
        `equalizer=f=3000:t=h:w=1000:g=-1,` +  // Slight high cut (less harsh)
        `${reverbFilter}` +                     // Room reverb (long-form only)
        `loudnorm=I=-16:LRA=11:TP=-1.5" ` +  // EBU R128 loudness normalization
        `-c:a libmp3lame -b:a 192k -y "${audioPath}"`,
      { timeout: 120_000, stdio: "pipe" }
    );
    console.log(`✅ [FacelessFactory] Audio rendered + mastered (${segmentPaths.length} segments, loudnorm + warmth${isLongForm ? " + room reverb" : ""}): ${audioPath}`);
  } catch (err: any) {
    // Fallback: use raw concat without mastering
    console.warn(`[FacelessFactory] Audio mastering failed, using raw concat: ${err.message?.slice(0, 200)}`);
    const { copyFileSync } = require("fs");
    copyFileSync(rawConcatPath, audioPath);
    console.log(`✅ [FacelessFactory] Audio rendered (${segmentPaths.length} segments, no mastering): ${audioPath}`);
  }

  // ── Calculate per-segment durations (voiceover + trailing silence pad) for scene sync ──
  // This tells assembleVideo exactly how long each scene should display,
  // so visual transitions align with the natural speech pauses.
  const SILENCE_PAD_SEC = 1.5;
  const CHAPTER_PAD_SEC = 2.5;
  const segmentDurations: number[] = [];
  for (let i = 0; i < rawSegDurations.length; i++) {
    let dur = rawSegDurations[i];
    // Add the trailing silence pad (mirrors the concat logic above)
    if (i < rawSegDurations.length - 1) {
      if ((i + 1) % 4 === 0) {
        dur += CHAPTER_PAD_SEC; // chapter break every 4 segments
      } else {
        dur += SILENCE_PAD_SEC; // standard inter-segment pause
      }
    }
    segmentDurations.push(dur);
  }
  console.log(`🎯 [FacelessFactory] Per-segment durations for scene sync: [${segmentDurations.map(d => d.toFixed(1) + "s").join(", ")}]`);

  return { audioPath, segmentDurations };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 3: Generate Scene Images — Pollinations (FREE primary) → Imagen 4 → DALL-E 3 → Gradient fallback
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Verify a buffer is a real image by checking magic bytes (PNG/JPEG/WebP/GIF) */
function isValidImage(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  // WebP: RIFF....WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true;
  // GIF: GIF87a or GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
  return false;
}

/** Generate a cinematic gradient fallback image using ffmpeg when all providers fail.
 *  Niche-aware color palettes so the video still looks intentional, not broken. */
function generateFallbackGradient(
  imgPath: string, width: number, height: number, niche: string, segmentIndex: number
): boolean {
  // Niche-specific gradient palettes (dark cinematic tones)
  const GRADIENT_PALETTES: Record<string, { from: string; to: string; overlay: string }[]> = {
    dark_psychology: [
      { from: "#0a0a0a", to: "#1a0a00", overlay: "#ff660015" }, // near-black to dark amber
      { from: "#0d0d1a", to: "#0a0000", overlay: "#ff000010" }, // dark navy to blood
      { from: "#0a0a0a", to: "#001a1a", overlay: "#00ffff08" }, // black to dark teal
    ],
    self_improvement: [
      { from: "#0a0800", to: "#1a1000", overlay: "#ffa50020" }, // dark gold gradient
      { from: "#0d0a00", to: "#1a0d00", overlay: "#ff880018" }, // warm amber
      { from: "#0a0500", to: "#1a1200", overlay: "#ffcc0015" }, // sunrise dark
    ],
    burnout: [
      { from: "#0a0a0a", to: "#0a0d1a", overlay: "#4488ff10" }, // cold blue fade
      { from: "#050505", to: "#0d0a0a", overlay: "#ff444408" }, // ash to ember
      { from: "#0a0a0d", to: "#0d0a0a", overlay: "#8844ff08" }, // dark purple shift
    ],
    quantum: [
      { from: "#000a0d", to: "#0d000a", overlay: "#8800ff15" }, // cosmic indigo
      { from: "#0a0005", to: "#00050a", overlay: "#00ffaa10" }, // electric teal
      { from: "#050008", to: "#080005", overlay: "#ff00ff08" }, // void purple
    ],
    brand: [
      { from: "#0a0a0a", to: "#1a0a00", overlay: "#ff660015" },
      { from: "#0a0800", to: "#1a1000", overlay: "#ffa50020" },
      { from: "#050505", to: "#0d0a0a", overlay: "#ff444408" },
    ],
  };

  const palettes = GRADIENT_PALETTES[niche] || GRADIENT_PALETTES.brand;
  const palette = palettes[segmentIndex % palettes.length];

  try {
    // Generate a dark cinematic gradient with subtle noise texture using ffmpeg
    // gradients + geq noise creates a film-grain look that doesn't scream "placeholder"
    execSync(
      `ffmpeg -f lavfi -i "color=c=${palette.from}:s=${width}x${height}:d=1,format=rgb24,` +
      `geq=r='clip(r(X,Y)+random(1)*8,0,255)':g='clip(g(X,Y)+random(1)*6,0,255)':b='clip(b(X,Y)+random(1)*10,0,255)'" ` +
      `-frames:v 1 -y "${imgPath}"`,
      { timeout: 15_000, stdio: "pipe" }
    );
    if (existsSync(imgPath)) {
      console.log(`🎨 [FacelessFactory] Scene ${segmentIndex} → cinematic gradient fallback (${niche})`);
      return true;
    }
  } catch (err: any) {
    console.warn(`[FacelessFactory] Gradient fallback failed: ${err.message?.slice(0, 100)}`);
  }

  // Ultra-fallback: write a minimal valid PNG (1x1 dark pixel, ffmpeg will scale it)
  try {
    // Minimal valid 1x1 PNG — dark pixel (0x0A, 0x0A, 0x0A)
    const minPng = Buffer.from([
      0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A, // PNG signature
      0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52, // IHDR chunk
      0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01, // 1x1
      0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53, // 8-bit RGB
      0xDE,0x00,0x00,0x00,0x0C,0x49,0x44,0x41, // IDAT chunk
      0x54,0x08,0xD7,0x63,0x60,0x60,0x60,0x00, // compressed pixel data
      0x00,0x00,0x04,0x00,0x01,0x9A,0xFF,0xA1, // (dark)
      0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44, // IEND
      0xAE,0x42,0x60,0x82,
    ]);
    writeFileSync(imgPath, minPng);
    console.log(`🎨 [FacelessFactory] Scene ${segmentIndex} → minimal dark PNG fallback`);
    return true;
  } catch {
    return false;
  }
}

async function generateSceneImage(
  visualDirection: string,
  niche: string,
  brand: Brand,
  jobId: string,
  segmentIndex: number,
  orientation: Orientation = "vertical"
): Promise<string | null> {
  const dim = DIMS[orientation];
  const rawStyle = SCENE_VISUAL_STYLE[niche]?.[brand] || SCENE_VISUAL_STYLE.brand[brand];
  const stylePrefix = rawStyle.replace(/\{ORIENTATION\}/g, dim.promptTag);
  const prompt = `${stylePrefix} Scene: ${visualDirection}`;
  const imgPath = `${FACELESS_DIR}/${jobId}_scene_${segmentIndex}.png`;

  // ── PRIMARY: Pollinations.ai (FREE, no auth, unlimited) ──
  // Session 26: REVERTED from Imagen 4 primary — Gemini billing $62+ with card declining.
  // Railway IPs may get blocked/CAPTCHAd — validate response is a REAL image, not HTML garbage
  try {
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 2000))}?width=${dim.pollW}&height=${dim.pollH}&nologo=true&seed=${Date.now() + segmentIndex}`;
    const res = await fetch(pollinationsUrl, { redirect: "follow" });

    if (res.ok) {
      const contentType = res.headers.get("content-type") || "";
      const arrayBuf = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      if (isValidImage(buf) && buf.length > 10000) {
        writeFileSync(imgPath, buf);
        console.log(`🎨 [FacelessFactory] Scene ${segmentIndex} generated via Pollinations (${(buf.length / 1024).toFixed(0)}KB)`);
        return imgPath;
      } else {
        console.warn(`[FacelessFactory] Pollinations returned non-image for segment ${segmentIndex}: ${buf.length}B, content-type: ${contentType}, magic: ${buf.slice(0, 4).toString("hex")}`);
      }
    } else {
      console.warn(`[FacelessFactory] Pollinations failed for segment ${segmentIndex}: ${res.status}`);
    }
  } catch (err: any) {
    console.warn(`[FacelessFactory] Pollinations error segment ${segmentIndex}: ${err.message}`);
  }

  // ── FALLBACK 1: Gemini Imagen 4 ──
  const geminiKey = config.llm.providers.gemini?.apiKey;
  if (geminiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${geminiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: dim.aspectRatio,
            safetyFilterLevel: "block_only_high",
          },
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        const b64 = data.predictions?.[0]?.bytesBase64Encoded || data.predictions?.[0]?.image?.bytesBase64Encoded;
        if (b64) {
          const imgBuf = Buffer.from(b64, "base64");
          if (isValidImage(imgBuf)) {
            writeFileSync(imgPath, imgBuf);
            console.log(`🎨 [FacelessFactory] Scene ${segmentIndex} generated via Imagen 4 (fallback)`);
            return imgPath;
          } else {
            console.warn(`[FacelessFactory] Imagen 4 returned invalid image data for segment ${segmentIndex}`);
          }
        }
      } else {
        console.warn(`[FacelessFactory] Imagen 4 failed for segment ${segmentIndex}: ${res.status}`);
      }
    } catch (err: any) {
      console.warn(`[FacelessFactory] Imagen 4 error segment ${segmentIndex}: ${err.message}`);
    }
  }

  // ── FALLBACK 2: DALL-E 3 via OpenAI ──
  const openaiKey = config.llm.providers.openai?.apiKey;
  if (openaiKey) {
    try {
      console.log(`🔄 [FacelessFactory] Segment ${segmentIndex} falling back to DALL-E 3...`);
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt: prompt.slice(0, 4000),
          size: dim.dalleSize,
          quality: "standard",
          n: 1,
          response_format: "b64_json",
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        const b64 = data.data?.[0]?.b64_json;
        if (b64) {
          const imgBuf = Buffer.from(b64, "base64");
          if (isValidImage(imgBuf)) {
            writeFileSync(imgPath, imgBuf);
            console.log(`🎨 [FacelessFactory] Scene ${segmentIndex} generated via DALL-E 3 (fallback)`);
            return imgPath;
          } else {
            console.warn(`[FacelessFactory] DALL-E 3 returned invalid image data for segment ${segmentIndex}`);
          }
        }
      } else {
        const errText = await res.text();
        console.warn(`[FacelessFactory] DALL-E 3 failed for segment ${segmentIndex}: ${res.status} — ${errText.slice(0, 200)}`);
      }
    } catch (err: any) {
      console.warn(`[FacelessFactory] DALL-E 3 error segment ${segmentIndex}: ${err.message}`);
    }
  }

  // ── FALLBACK 3: Cinematic gradient (NEVER return null — always produce SOMETHING visual) ──
  // Better a dark atmospheric gradient than a black void. The audio IS the payload;
  // the visual just needs to not be broken.
  console.warn(`[FacelessFactory] ALL image providers failed for segment ${segmentIndex} — generating cinematic gradient`);
  const fallbackOk = generateFallbackGradient(imgPath, dim.width, dim.height, niche, segmentIndex);
  return fallbackOk ? imgPath : null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 4: Assemble Video (Ken Burns + Voiceover + Captions)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function assembleVideo(
  script: FacelessScript,
  audioPath: string,
  imagePaths: (string | null)[],
  jobId: string,
  orientation: Orientation = "vertical",
  segmentDurations?: number[]
): Promise<string> {
  const outputPath = `${FACELESS_DIR}/${jobId}_final.mp4`;
  const nicheFilter = NICHE_FILTERS[script.niche] || NICHE_FILTERS.brand;

  // Get audio duration to calculate per-image timing
  let audioDuration: number;
  try {
    const probeOutput = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`,
      { timeout: 10_000, stdio: "pipe" }
    ).toString().trim();
    audioDuration = parseFloat(probeOutput) || 60;
  } catch {
    audioDuration = script.segments.reduce((sum, s) => sum + s.duration_hint, 0);
  }

  // Filter to only segments that have images
  const validSegments: { imgPath: string; index: number }[] = [];
  for (let i = 0; i < imagePaths.length; i++) {
    if (imagePaths[i] && existsSync(imagePaths[i]!)) {
      validSegments.push({ imgPath: imagePaths[i]!, index: i });
    }
  }

  if (validSegments.length === 0) {
    throw new Error("No scene images generated — cannot assemble video");
  }

  // ── Per-segment timing: use actual TTS durations when available, fall back to equal division ──
  // When segmentDurations is provided (long-form), each scene's visual duration matches
  // its voiceover + silence pad — so scene transitions land on the natural speech pauses.
  const hasPerSegTiming = segmentDurations && segmentDurations.length >= validSegments.length;
  const getSegDuration = (segIdx: number): number => {
    if (hasPerSegTiming) {
      // Map valid segment index back to original script segment index
      const origIdx = validSegments[segIdx].index;
      return segmentDurations![origIdx] || (audioDuration / validSegments.length);
    }
    return audioDuration / validSegments.length;
  };
  const fps = 30;
  const xfadeDuration = 0.6; // 0.6s true dissolve between scenes (not fade-to-black)

  // ── PRE-RENDER EACH SCENE AS A VIDEO CLIP (Ken Burns, NO fade — xfade handles transitions) ──
  // Each scene renders clean (no fade in/out). True dissolve transitions are applied
  // via ffmpeg xfade filter during concat. This eliminates the black-flash problem
  // where fade-out + fade-in created a visible dark gap between scenes.
  const sceneClipPaths: string[] = [];
  const sceneClipDir = `${FACELESS_DIR}/${jobId}_scenes`;
  if (!existsSync(sceneClipDir)) mkdirSync(sceneClipDir, { recursive: true });

  const dim = DIMS[orientation];

  // Track per-clip durations for xfade offset calculation
  const clipDurations: number[] = [];

  for (let i = 0; i < validSegments.length; i++) {
    const seg = validSegments[i];
    const clipPath = `${sceneClipDir}/scene_${i.toString().padStart(2, "0")}.mp4`;
    const thisSegDuration = getSegDuration(i);
    const thisFrames = Math.round(thisSegDuration * fps);

    try {
      execSync(
        `ffmpeg -loop 1 -i "${seg.imgPath}" ` +
          `-t ${thisSegDuration.toFixed(2)} ` +
          `-vf "zoompan=z='min(zoom+0.0005,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${thisFrames}:s=${dim.width}x${dim.height}:fps=${fps}" ` +
          `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p ` +
          `-y "${clipPath}"`,
        { timeout: 120_000, stdio: "pipe" }
      );
      sceneClipPaths.push(clipPath);
      clipDurations.push(thisSegDuration);
    } catch (err: any) {
      console.warn(`[FacelessFactory] Scene ${i} clip render failed, using raw: ${err.message?.slice(0, 150)}`);
      // Fallback: render without Ken Burns
      try {
        execSync(
          `ffmpeg -loop 1 -i "${seg.imgPath}" ` +
            `-t ${thisSegDuration.toFixed(2)} ` +
            `-vf "scale=${dim.width}:${dim.height}:force_original_aspect_ratio=increase,crop=${dim.width}:${dim.height}" ` +
            `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p ` +
            `-y "${clipPath}"`,
          { timeout: 60_000, stdio: "pipe" }
        );
        sceneClipPaths.push(clipPath);
        clipDurations.push(thisSegDuration);
      } catch { /* skip this scene entirely */ }
    }
  }

  if (sceneClipPaths.length === 0) {
    throw new Error("All scene clip renders failed — cannot assemble video");
  }

  // ── TRUE CROSSFADE via xfade filter ──
  // If we have multiple scenes, chain xfade filters for real dissolve transitions.
  // If xfade fails (older ffmpeg), fall back to simple concat.
  const concatListPath = `${FACELESS_DIR}/${jobId}_concat.txt`;
  let usedXfade = false;
  const xfadedPath = `${FACELESS_DIR}/${jobId}_xfaded.mp4`;

  if (sceneClipPaths.length >= 2) {
    try {
      // Build xfade filter chain: [0][1]xfade=...[v01]; [v01][2]xfade=...[v012]; etc.
      const inputs = sceneClipPaths.map((p, i) => `-i "${p}"`).join(" ");
      let filterChain = "";
      let prevLabel = "[0]";
      // Cumulative offset: each xfade starts where the previous output ends minus overlap.
      // offset_i = sum(clipDurations[0..i-1]) - (i * xfadeDuration)
      // This correctly handles variable-length clips instead of assuming equal durations.
      let cumulativeDuration = clipDurations[0] || 0;
      for (let i = 1; i < sceneClipPaths.length; i++) {
        const offset = cumulativeDuration - (i * xfadeDuration);
        const outLabel = i === sceneClipPaths.length - 1 ? "[vout]" : `[v${i}]`;
        filterChain += `${prevLabel}[${i}]xfade=transition=fade:duration=${xfadeDuration}:offset=${Math.max(0, offset).toFixed(2)}${outLabel}; `;
        prevLabel = outLabel;
        cumulativeDuration += clipDurations[i] || 0;
      }
      // Remove trailing "; " and clean up
      filterChain = filterChain.replace(/;\s*$/, "");

      execSync(
        `ffmpeg ${inputs} -filter_complex "${filterChain}" -map "[vout]" ` +
          `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p ` +
          `-y "${xfadedPath}"`,
        { timeout: 300_000, stdio: "pipe" }
      );
      usedXfade = true;
      console.log(`🎬 [FacelessFactory] ${sceneClipPaths.length} scenes assembled with ${xfadeDuration}s true dissolve crossfades`);
    } catch (err: any) {
      console.warn(`[FacelessFactory] xfade failed (falling back to concat): ${err.message?.slice(0, 200)}`);
    }
  }

  if (!usedXfade) {
    // Simple concat fallback
    const concatLines = sceneClipPaths.map(p => `file '${p}'`);
    writeFileSync(concatListPath, concatLines.join("\n"));
    console.log(`🎬 [FacelessFactory] ${sceneClipPaths.length}/${validSegments.length} scene clips rendered (concat, no xfade)`);
  }

  // Ken Burns is now applied per-scene above. Video assembly just concats + applies color grade + hook.

  // QUALITY GATE (Session 23): Text hook overlay
  // Burns the hook text into the first 3 seconds of the video as a scroll-stopping overlay.
  // White text with dark shadow, centered, large font. Fades out from 2s-3s.
  const hookText = (script.hook || script.segments[0]?.voiceover || "")
    .split(/[.!?]/)[0]  // First sentence only
    .replace(/'/g, "'\\''")  // Escape single quotes for ffmpeg
    .replace(/:/g, "\\:")     // Escape colons for ffmpeg drawtext
    .slice(0, 80);            // Max 80 chars for readability

  // drawtext filter: show for first 3s, fade out during second 2-3
  const hookOverlay = hookText
    ? `,drawtext=text='${hookText}':fontsize=42:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=(h*0.4):enable='between(t,0,3)':alpha='if(lt(t,2),1,(3-t))'`
    : "";

  // ── BACKGROUND MUSIC BED ──
  // Generate a dark cinematic ambient drone using ffmpeg synthesis.
  // Zero external dependencies, zero royalty issues — pure math.
  // Niche-aware: dark_psychology gets darker tones, self_improvement gets warmer.
  // Mixed at -20dB under voice with 2s fade in and 3s fade out.
  const musicPath = `${FACELESS_DIR}/${jobId}_music_bed.mp3`;
  let hasMusicBed = false;

  // Niche-specific tone frequencies (Hz) — sets the emotional color
  const MUSIC_TONES: Record<string, { base: number; harmonic: number; sub: number }> = {
    dark_psychology: { base: 110, harmonic: 165, sub: 55 },     // A2 + E3 + A1 — ominous
    self_improvement: { base: 130.81, harmonic: 196, sub: 65 }, // C3 + G3 + C2 — uplifting
    burnout: { base: 98, harmonic: 146.83, sub: 49 },           // G2 + D3 + G1 — melancholic
    quantum: { base: 123.47, harmonic: 185, sub: 61.74 },       // B2 + F#3 + B1 — ethereal
    brand: { base: 110, harmonic: 164.81, sub: 55 },            // A2 + E3 + A1 — default
  };

  try {
    const tones = MUSIC_TONES[script.niche] || MUSIC_TONES.brand;
    const musicDuration = Math.ceil(audioDuration) + 4; // extra 4s for fade buffer
    const sampleRate = 44100;
    const totalSamples = sampleRate * musicDuration;

    // ── Node.js WAV generation ──
    // Railway's ffmpeg may lack lavfi/anoisesrc filters.
    // Generate all tones + noise as raw PCM in Node, write WAV files,
    // then let ffmpeg mix from standard file inputs — zero filter dependencies.

    /** Write a mono 16-bit WAV file from a Float32 sample buffer */
    const writeWav = (filePath: string, samples: Float32Array): void => {
      const numSamples = samples.length;
      const byteRate = sampleRate * 2; // 16-bit mono = 2 bytes/sample
      const dataSize = numSamples * 2;
      const buf = Buffer.alloc(44 + dataSize);
      // RIFF header
      buf.write("RIFF", 0);
      buf.writeUInt32LE(36 + dataSize, 4);
      buf.write("WAVE", 8);
      // fmt chunk
      buf.write("fmt ", 12);
      buf.writeUInt32LE(16, 16);       // chunk size
      buf.writeUInt16LE(1, 20);        // PCM format
      buf.writeUInt16LE(1, 22);        // mono
      buf.writeUInt32LE(sampleRate, 24);
      buf.writeUInt32LE(byteRate, 28);
      buf.writeUInt16LE(2, 30);        // block align
      buf.writeUInt16LE(16, 32);       // bits per sample
      // data chunk
      buf.write("data", 36);
      buf.writeUInt32LE(dataSize, 40);
      for (let i = 0; i < numSamples; i++) {
        const clamped = Math.max(-1, Math.min(1, samples[i]));
        buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
      }
      writeFileSync(filePath, buf);
    };

    /** Generate a sine wave at given frequency and amplitude */
    const generateSine = (freq: number, amp: number): Float32Array => {
      const out = new Float32Array(totalSamples);
      const step = (2 * Math.PI * freq) / sampleRate;
      for (let i = 0; i < totalSamples; i++) {
        out[i] = Math.sin(step * i) * amp;
      }
      return out;
    };

    /** Generate pink noise using Voss-McCartney algorithm, amplitude-scaled */
    const generatePinkNoise = (amp: number): Float32Array => {
      const out = new Float32Array(totalSamples);
      // 8-octave pink noise via running-sum of white noise octaves
      const numOctaves = 8;
      const octaves = new Float64Array(numOctaves);
      let runningSum = 0;
      for (let i = 0; i < totalSamples; i++) {
        // Update one octave per sample based on bit pattern (Voss algorithm)
        const changed = i === 0 ? (1 << numOctaves) - 1 : i ^ (i - 1);
        for (let o = 0; o < numOctaves; o++) {
          if (changed & (1 << o)) {
            runningSum -= octaves[o];
            octaves[o] = (Math.random() * 2 - 1);
            runningSum += octaves[o];
          }
        }
        out[i] = (runningSum / numOctaves) * amp;
      }
      return out;
    };

    // Generate each layer as a WAV file
    const basePath = `${FACELESS_DIR}/${jobId}_tone_base.wav`;
    const harmPath = `${FACELESS_DIR}/${jobId}_tone_harm.wav`;
    const subPath  = `${FACELESS_DIR}/${jobId}_tone_sub.wav`;
    const noisePath = `${FACELESS_DIR}/${jobId}_noise.wav`;

    writeWav(basePath, generateSine(tones.base, 0.3));
    writeWav(harmPath, generateSine(tones.harmonic, 0.15));
    writeWav(subPath, generateSine(tones.sub, 0.2));
    writeWav(noisePath, generatePinkNoise(0.02));

    // Mix all 4 layers via ffmpeg standard file inputs (no lavfi needed).
    // amix → fade in/out → lowpass → master volume → mp3
    execSync(
      `ffmpeg ` +
        `-i "${basePath}" ` +
        `-i "${harmPath}" ` +
        `-i "${subPath}" ` +
        `-i "${noisePath}" ` +
        `-filter_complex "` +
          `[3:a]lowpass=f=800[noise];` +     // Filtered pink noise — warmth
          `[0:a][1:a][2:a][noise]amix=inputs=4:duration=first:normalize=0,` +
          `afade=t=in:st=0:d=2,` +           // 2s fade in
          `afade=t=out:st=${musicDuration - 3}:d=3,` +  // 3s fade out
          `lowpass=f=2000,` +                // Roll off highs — don't compete with voice
          `volume=0.4` +                     // Master level before mixing with voice
        `[music]" ` +
        `-map "[music]" -c:a libmp3lame -b:a 128k -y "${musicPath}"`,
      { timeout: 60_000, stdio: "pipe" }
    );

    hasMusicBed = existsSync(musicPath);
    if (hasMusicBed) {
      console.log(`🎵 [FacelessFactory] Music bed generated: ${script.niche} ambient (${musicDuration}s)`);
    }

    // Clean up intermediate WAV files
    for (const tmp of [basePath, harmPath, subPath, noisePath]) {
      try { unlinkSync(tmp); } catch { /* ignore */ }
    }
  } catch (err: any) {
    console.warn(`[FacelessFactory] Music bed generation failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  // Build the final assembly command:
  // If xfade succeeded, use the pre-crossfaded video file.
  // If concat fallback, use the concat list.
  // Either way: apply color grade + hook overlay → mix audio.

  // Video input source: xfaded file or concat list
  const videoInput = usedXfade
    ? `-i "${xfadedPath}"`
    : `-f concat -safe 0 -i "${concatListPath}"`;

  // Audio filter: if music bed exists, mix voice (loud) + music (quiet) via amix.
  const audioFilter = hasMusicBed
    ? `[1:a]volume=1.0[voice];[2:a]volume=0.15[bg];[voice][bg]amix=inputs=2:duration=first:normalize=0[aout]`
    : "";
  const musicInput = hasMusicBed ? `-i "${musicPath}" ` : "";
  const audioMap = hasMusicBed ? `-map "[aout]"` : `-map 1:a`;

  try {
    execSync(
      `ffmpeg ${videoInput} -i "${audioPath}" ${musicInput}` +
        `-filter_complex "[0:v]${nicheFilter}${hookOverlay}[v]${hasMusicBed ? ";" + audioFilter : ""}" ` +
        `-map "[v]" ${audioMap} ` +
        `-c:v libx264 -preset fast -crf 23 ` +
        `-c:a aac -b:a 192k ` +
        `-shortest -y "${outputPath}"`,
      { timeout: 600_000, stdio: "pipe" }
    );
  } catch (err: any) {
    // Fallback: no filter_complex for video — just pass through + audio mix
    console.warn(`[FacelessFactory] Color grade/hook failed, trying plain assembly: ${err.message?.slice(0, 200)}`);
    if (hasMusicBed) {
      execSync(
        `ffmpeg ${videoInput} -i "${audioPath}" ${musicInput}` +
          `-filter_complex "${audioFilter}" ` +
          `-map 0:v ${audioMap} ` +
          `-c:v libx264 -preset fast -crf 23 ` +
          `-c:a aac -b:a 192k ` +
          `-shortest -y "${outputPath}"`,
        { timeout: 600_000, stdio: "pipe" }
      );
    } else {
      execSync(
        `ffmpeg ${videoInput} -i "${audioPath}" ` +
          `-c:v libx264 -preset fast -crf 23 ` +
          `-c:a aac -b:a 192k ` +
          `-shortest -y "${outputPath}"`,
        { timeout: 600_000, stdio: "pipe" }
      );
    }
  }

  console.log(`🎬 [FacelessFactory] Video assembled: ${outputPath}`);
  return outputPath;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 5: Upload to Supabase Storage + Write to vid_rush_queue
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function uploadAndQueue(
  videoPath: string,
  script: FacelessScript,
  jobId: string
): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  // Upload to storage
  const storagePath = `faceless/${jobId}/${jobId}_final.mp4`;
  try {
    const fileBuffer = readFileSync(videoPath);
    const resp = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "video/mp4",
          "x-upsert": "true",
        },
        body: fileBuffer,
      }
    );

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[FacelessFactory] Storage upload failed: ${resp.status} ${err.slice(0, 200)}`);
      return null;
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
    console.log(`📤 [FacelessFactory] Uploaded → ${publicUrl}`);

    // Write to vid_rush_queue
    await fetch(`${SUPABASE_URL}/rest/v1/vid_rush_queue`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        title: script.title,
        topic: script.niche,
        niche: script.niche,
        script: script.segments.map(s => s.voiceover).join(" "),
        video_url: publicUrl,
        status: "ready",
        platform: "multi",
        metadata: {
          type: "faceless",
          brand: script.brand,
          job_id: jobId,
          segment_count: script.segments.length,
          cta: script.cta,
          hook: script.hook,
        },
      }),
    });

    return publicUrl;
  } catch (err: any) {
    console.error(`[FacelessFactory] Upload/queue error: ${err.message}`);
    return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN PIPELINE: produceFacelessVideo()
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function produceFacelessVideo(
  llm: LLMProvider,
  sourceIntelligence: string,
  niche: string,
  brand: Brand,
  targetDuration: "short" | "long" = "short"
): Promise<FacelessResult> {
  const jobId = `fv_${brand}_${niche}_${Date.now()}`;

  if (!existsSync(FACELESS_DIR)) mkdirSync(FACELESS_DIR, { recursive: true });

  // Long-form = YouTube = 16:9 horizontal. Shorts = TikTok/IG/YT Shorts = 9:16 vertical.
  const orientation: Orientation = targetDuration === "long" ? "horizontal" : "vertical";

  console.log(`\n🔥 [FacelessFactory] Starting job ${jobId}`);
  console.log(`   Brand: ${brand} | Niche: ${niche} | Duration: ${targetDuration} | Orientation: ${orientation} (${DIMS[orientation].width}x${DIMS[orientation].height})`);

  // STEP 1: Generate script
  console.log(`📝 [FacelessFactory] Generating script...`);
  const script = await generateScript(llm, sourceIntelligence, niche, brand, targetDuration, orientation);
  console.log(`✅ [FacelessFactory] Script: "${script.title}" — ${script.segments.length} segments`);

  // Save script for reference
  writeFileSync(`${FACELESS_DIR}/${jobId}_script.json`, JSON.stringify(script, null, 2));

  // STEP 2: Render TTS audio
  console.log(`🗣️ [FacelessFactory] Rendering voiceover...`);
  const audioResult = await renderAudio(script, jobId);
  const audioPath = audioResult.audioPath;

  // STEP 3: Generate scene images (parallel, with rate limiting)
  console.log(`🎨 [FacelessFactory] Generating ${script.segments.length} scene images...`);
  const imagePaths: (string | null)[] = [];
  for (let i = 0; i < script.segments.length; i++) {
    const imgPath = await generateSceneImage(
      script.segments[i].visual_direction,
      niche,
      brand,
      jobId,
      i,
      orientation
    );
    imagePaths.push(imgPath);
    // Small delay between Imagen requests to avoid rate limits
    if (i < script.segments.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  const generatedCount = imagePaths.filter(Boolean).length;
  console.log(`✅ [FacelessFactory] ${generatedCount}/${script.segments.length} images generated`);

  if (generatedCount === 0) {
    throw new Error("Zero scene images generated — check Gemini Imagen API key and quota");
  }

  // STEP 4: Assemble video
  console.log(`🎬 [FacelessFactory] Assembling video...`);
  const videoPath = await assembleVideo(script, audioPath, imagePaths, jobId, orientation, audioResult.segmentDurations);

  // Get final duration
  let finalDuration = 0;
  try {
    const dur = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
      { timeout: 10_000, stdio: "pipe" }
    ).toString().trim();
    finalDuration = parseFloat(dur) || 0;
  } catch { /* non-critical */ }

  // STEP 5: Upload + queue
  console.log(`📤 [FacelessFactory] Uploading to Supabase...`);
  const videoUrl = await uploadAndQueue(videoPath, script, jobId);

  // Clean up intermediate files (TTS segments, raw audio, images, concat lists)
  // Keep the final video — orchestrator needs it for chopping
  cleanupJobFiles(jobId, true);

  console.log(`\n🔥 [FacelessFactory] JOB COMPLETE — ${jobId}`);
  console.log(`   Title: ${script.title}`);
  console.log(`   Duration: ${finalDuration.toFixed(1)}s`);
  console.log(`   Segments: ${generatedCount}`);
  console.log(`   URL: ${videoUrl || "upload failed"}`);

  return {
    videoUrl,
    localPath: videoPath,
    title: script.title,
    niche,
    brand,
    duration: finalDuration,
    segmentCount: generatedCount,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BATCH PRODUCTION: produceFacelessBatch()
// Produces multiple videos from one source (both brands)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function produceFacelessBatch(
  llm: LLMProvider,
  sourceIntelligence: string,
  niche: string,
  brands: Brand[] = ["ace_richie", "containment_field"]
): Promise<FacelessResult[]> {
  const results: FacelessResult[] = [];

  for (const brand of brands) {
    try {
      const result = await produceFacelessVideo(llm, sourceIntelligence, niche, brand, "short");
      results.push(result);
    } catch (err: any) {
      console.error(`[FacelessFactory] Failed for ${brand}: ${err.message}`);
    }
  }

  return results;
}
