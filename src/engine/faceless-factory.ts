// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — FACELESS VIDEO FACTORY
// Deterministic faceless video production pipeline:
//   1. LLM generates voiceover script from source intelligence
//   2. ElevenLabs/OpenAI TTS renders audio
//   3. Pollinations.ai generates scene images (FREE) → Imagen 4 → DALL-E 3 fallback
//   4. ffmpeg assembles: Ken Burns on images + voiceover + captions + color grade
//   5. Output → Supabase Storage → vid_rush_queue → auto-sweep to platforms
//
// This is the 95% engine — creates ORIGINAL content from extracted intelligence.
// The clip ripper (vid-rush.ts) handles the 5% where Ace is on camera.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { config } from "../config";
import { textToSpeech } from "../voice/tts";
import type { LLMProvider } from "../types";

const FACELESS_DIR = "/tmp/faceless_factory";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const STORAGE_BUCKET = "public-assets";

// ── Types ──

type Brand = "ace_richie" | "containment_field";

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

  console.error(`[extractJSON] All 4 strategies failed`);
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
    ace_richie: "Cinematic noir photography, amber light cutting through darkness, brutalist architecture, dramatic shadows, moody atmospheric, 9:16 vertical. NO text, NO words, NO letters.",
    containment_field: "Surveillance camera aesthetic, rain-slicked urban night, cold blue lighting, neon reflections on wet concrete, clinical, 9:16 vertical. NO text, NO words, NO letters.",
  },
  self_improvement: {
    ace_richie: "Golden hour photography, figure ascending stone steps, sovereign majestic landscape, warm amber tones, cinematic, 9:16 vertical. NO text, NO words, NO letters.",
    containment_field: "Sterile corporate interior, shattered mirror, deconstructed wellness imagery, cool muted tones, clinical, 9:16 vertical. NO text, NO words, NO letters.",
  },
  burnout: {
    ace_richie: "Chains dissolving into golden particles, industrial to natural transition, liberation imagery, warm undertones, cinematic, 9:16 vertical. NO text, NO words, NO letters.",
    containment_field: "Human silhouette surrounded by screens, hamster wheel of devices, toxic green glow, suffocating composition, 9:16 vertical. NO text, NO words, NO letters.",
  },
  quantum: {
    ace_richie: "Cosmic geometric light patterns, deep indigo and electric gold, sacred geometry, abstract energy visualization, cinematic, 9:16 vertical. NO text, NO words, NO letters.",
    containment_field: "Data visualization glitching, reality wireframe overlaid on physical space, matrix aesthetic, cool blue-green, 9:16 vertical. NO text, NO words, NO letters.",
  },
  brand: {
    ace_richie: "Midnight blue and amber, throne-like composition, master architect energy, sovereign aesthetic, cinematic, 9:16 vertical. NO text, NO words, NO letters.",
    containment_field: "Dark room, single red light on classified document, information broker aesthetic, noir, 9:16 vertical. NO text, NO words, NO letters.",
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
  targetDuration: "short" | "long" = "short"
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

  const prompt = `${voice}

SOURCE INTELLIGENCE (extracted from research):
${sourceIntelligence.slice(0, 4000)}

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
- PACING: Write for a MEASURED, documentary-style voiceover — not a fast-talking YouTuber. Include natural pauses with ellipses (...) and rhetorical questions. The listener should feel like they're being let in on a secret, not being sold something.
- Visual directions should be CINEMATIC and specific — think B-roll descriptions
- ${durationHintNote}
- CTA should feel organic, not salesy — "The full protocol is at sovereign-synthesis.com"
- Return ONLY valid JSON, no markdown code fences, no explanation`;

  // Long-form scripts with 20 segments of 80-130 words each need more token headroom
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

async function renderAudio(script: FacelessScript, jobId: string): Promise<string> {
  const audioPath = `${FACELESS_DIR}/${jobId}_voiceover.mp3`;

  // For long-form (many segments), TTS APIs have character limits
  // (OpenAI: 4096, ElevenLabs: 5000). Chunk per segment and concatenate.
  const allSegmentTexts = [
    ...script.segments.map(s => s.voiceover),
    script.cta
  ];
  const totalChars = allSegmentTexts.reduce((sum, t) => sum + t.length, 0);
  const isLongForm = allSegmentTexts.length > 8;
  // QUALITY GATE (Session 23): Slower TTS for documentary feel.
  // 0.9x was still too rushed per real output testing. 0.85x + 0.6s silence pads
  // between segments creates the measured, "letting you in on a secret" cadence.
  const ttsSpeed = isLongForm ? 0.85 : undefined;
  console.log(`🗣️ [FacelessFactory] Rendering TTS — ${allSegmentTexts.length} segments, ${totalChars} chars total${isLongForm ? " (long-form, 0.9x speed)" : ""}`);

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
    return audioPath;
  }

  // Long-form: render each segment separately, then concatenate with ffmpeg
  const segmentPaths: string[] = [];

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

    segmentPaths.push(segMp3);

    // Small delay between TTS calls to avoid rate limits
    if (i < allSegmentTexts.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  if (segmentPaths.length === 0) {
    throw new Error("All TTS segments failed — cannot produce audio");
  }

  // QUALITY GATE (Session 23): Generate a 0.6s silence pad for between segments.
  // This creates breathing room between thoughts, reducing the "rushed" feeling.
  const silencePad = `${FACELESS_DIR}/${jobId}_silence.mp3`;
  try {
    execSync(
      `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.6 -c:a libmp3lame -b:a 128k -y "${silencePad}"`,
      { timeout: 10_000, stdio: "pipe" }
    );
  } catch {
    // If silence generation fails, we'll concatenate without pads
  }
  const hasSilencePad = existsSync(silencePad);

  // Concatenate all segment mp3s with silence pads between them
  const concatListPath = `${FACELESS_DIR}/${jobId}_audio_concat.txt`;
  const concatLines: string[] = [];
  for (let i = 0; i < segmentPaths.length; i++) {
    concatLines.push(`file '${segmentPaths[i]}'`);
    // Add silence pad between segments (not after the last one)
    if (hasSilencePad && i < segmentPaths.length - 1) {
      concatLines.push(`file '${silencePad}'`);
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
  //   1. loudnorm — consistent volume (fixes "too quiet" issue)
  //   2. bass boost — voice warmth (subtle low-end fill, reduces robotic feel)
  //   3. highpass — remove rumble below 80Hz
  //   4. acompressor — gentle compression to even out volume peaks
  try {
    execSync(
      `ffmpeg -i "${rawConcatPath}" ` +
        `-af "highpass=f=80,` +
        `acompressor=threshold=-20dB:ratio=3:attack=5:release=50,` +
        `equalizer=f=200:t=h:w=100:g=3,` +  // Warm bass boost
        `equalizer=f=3000:t=h:w=1000:g=-1,` +  // Slight high cut (less harsh)
        `loudnorm=I=-16:LRA=11:TP=-1.5" ` +  // EBU R128 loudness normalization
        `-c:a libmp3lame -b:a 192k -y "${audioPath}"`,
      { timeout: 120_000, stdio: "pipe" }
    );
    console.log(`✅ [FacelessFactory] Audio rendered + mastered (${segmentPaths.length} segments, loudnorm + warmth): ${audioPath}`);
  } catch (err: any) {
    // Fallback: use raw concat without mastering
    console.warn(`[FacelessFactory] Audio mastering failed, using raw concat: ${err.message?.slice(0, 200)}`);
    const { copyFileSync } = require("fs");
    copyFileSync(rawConcatPath, audioPath);
    console.log(`✅ [FacelessFactory] Audio rendered (${segmentPaths.length} segments, no mastering): ${audioPath}`);
  }

  return audioPath;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 3: Generate Scene Images — Pollinations (FREE primary) → Imagen 4 → DALL-E 3
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function generateSceneImage(
  visualDirection: string,
  niche: string,
  brand: Brand,
  jobId: string,
  segmentIndex: number
): Promise<string | null> {
  const stylePrefix = SCENE_VISUAL_STYLE[niche]?.[brand] || SCENE_VISUAL_STYLE.brand[brand];
  const prompt = `${stylePrefix} Scene: ${visualDirection}`;
  const imgPath = `${FACELESS_DIR}/${jobId}_scene_${segmentIndex}.png`;

  // ── PRIMARY: Pollinations.ai (FREE, no auth, unlimited) ──
  try {
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 2000))}?width=1024&height=1792&nologo=true&seed=${Date.now() + segmentIndex}`;
    const res = await fetch(pollinationsUrl, { redirect: "follow" });

    if (res.ok) {
      const arrayBuf = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      if (buf.length > 10000) { // Sanity check: real image > 10KB
        writeFileSync(imgPath, buf);
        console.log(`🎨 [FacelessFactory] Scene ${segmentIndex} generated via Pollinations (${(buf.length / 1024).toFixed(0)}KB)`);
        return imgPath;
      } else {
        console.warn(`[FacelessFactory] Pollinations returned tiny response for segment ${segmentIndex}: ${buf.length}B`);
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
            aspectRatio: "9:16",
            safetyFilterLevel: "block_only_high",
          },
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        const b64 = data.predictions?.[0]?.bytesBase64Encoded || data.predictions?.[0]?.image?.bytesBase64Encoded;
        if (b64) {
          writeFileSync(imgPath, Buffer.from(b64, "base64"));
          console.log(`🎨 [FacelessFactory] Scene ${segmentIndex} generated via Imagen 4 (fallback)`);
          return imgPath;
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
          size: "1024x1792",
          quality: "standard",
          n: 1,
          response_format: "b64_json",
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        const b64 = data.data?.[0]?.b64_json;
        if (b64) {
          writeFileSync(imgPath, Buffer.from(b64, "base64"));
          console.log(`🎨 [FacelessFactory] Scene ${segmentIndex} generated via DALL-E 3 (fallback)`);
          return imgPath;
        }
      } else {
        const errText = await res.text();
        console.warn(`[FacelessFactory] DALL-E 3 failed for segment ${segmentIndex}: ${res.status} — ${errText.slice(0, 200)}`);
      }
    } catch (err: any) {
      console.warn(`[FacelessFactory] DALL-E 3 error segment ${segmentIndex}: ${err.message}`);
    }
  }

  // All providers failed for this segment
  console.warn(`[FacelessFactory] ALL image providers failed for segment ${segmentIndex}`);
  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 4: Assemble Video (Ken Burns + Voiceover + Captions)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function assembleVideo(
  script: FacelessScript,
  audioPath: string,
  imagePaths: (string | null)[],
  jobId: string
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

  const segDuration = audioDuration / validSegments.length;

  // Build ffmpeg concat input file
  // Each image shown for segDuration seconds
  const concatListPath = `${FACELESS_DIR}/${jobId}_concat.txt`;
  const concatLines = validSegments.map(
    (s) => `file '${s.imgPath}'\nduration ${segDuration.toFixed(2)}`
  );
  // ffmpeg concat requires last file repeated without duration
  concatLines.push(`file '${validSegments[validSegments.length - 1].imgPath}'`);
  writeFileSync(concatListPath, concatLines.join("\n"));

  // Ken Burns: slow zoom from 100% to 115% over each segment
  // zoompan filter: z increases from 1 to 1.15 over the segment, with pan to keep centered
  const fps = 30;
  const totalFrames = Math.ceil(audioDuration * fps);
  const framesPerSegment = Math.ceil(segDuration * fps);

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

  // Build the ffmpeg command:
  // 1. Concat images into slideshow
  // 2. Apply Ken Burns (zoompan) effect
  // 3. Apply niche color grade
  // 4. Overlay hook text (first 3s)
  // 5. Overlay voiceover audio
  // 6. Output 9:16 MP4

  const kenBurnsFilter = `zoompan=z='min(zoom+0.0005,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${framesPerSegment}:s=1080x1920:fps=${fps}`;

  try {
    execSync(
      `ffmpeg -f concat -safe 0 -i "${concatListPath}" -i "${audioPath}" ` +
        `-filter_complex "[0:v]${kenBurnsFilter},${nicheFilter}${hookOverlay}[v]" ` +
        `-map "[v]" -map 1:a ` +
        `-c:v libx264 -preset fast -crf 23 ` +
        `-c:a aac -b:a 192k ` +
        `-shortest -y "${outputPath}"`,
      { timeout: 600_000, stdio: "pipe" }  // 10 min timeout for long-form assembly
    );
  } catch (err: any) {
    // Fallback: simpler assembly without Ken Burns if zoompan fails
    console.warn(`[FacelessFactory] Ken Burns failed, trying simple assembly: ${err.message?.slice(0, 200)}`);
    execSync(
      `ffmpeg -f concat -safe 0 -i "${concatListPath}" -i "${audioPath}" ` +
        `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${nicheFilter}${hookOverlay}" ` +
        `-c:v libx264 -preset fast -crf 23 ` +
        `-c:a aac -b:a 192k ` +
        `-shortest -y "${outputPath}"`,
      { timeout: 600_000, stdio: "pipe" }  // 10 min timeout for long-form assembly
    );
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

  console.log(`\n🔥 [FacelessFactory] Starting job ${jobId}`);
  console.log(`   Brand: ${brand} | Niche: ${niche} | Duration: ${targetDuration}`);

  // STEP 1: Generate script
  console.log(`📝 [FacelessFactory] Generating script...`);
  const script = await generateScript(llm, sourceIntelligence, niche, brand, targetDuration);
  console.log(`✅ [FacelessFactory] Script: "${script.title}" — ${script.segments.length} segments`);

  // Save script for reference
  writeFileSync(`${FACELESS_DIR}/${jobId}_script.json`, JSON.stringify(script, null, 2));

  // STEP 2: Render TTS audio
  console.log(`🗣️ [FacelessFactory] Rendering voiceover...`);
  const audioPath = await renderAudio(script, jobId);

  // STEP 3: Generate scene images (parallel, with rate limiting)
  console.log(`🎨 [FacelessFactory] Generating ${script.segments.length} scene images...`);
  const imagePaths: (string | null)[] = [];
  for (let i = 0; i < script.segments.length; i++) {
    const imgPath = await generateSceneImage(
      script.segments[i].visual_direction,
      niche,
      brand,
      jobId,
      i
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
  const videoPath = await assembleVideo(script, audioPath, imagePaths, jobId);

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
