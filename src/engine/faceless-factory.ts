// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — FACELESS VIDEO FACTORY
// Deterministic faceless video production pipeline:
//   1. LLM generates voiceover script from source intelligence
//   2. Pod (RunPod GPU) handles TTS + image gen + composition + R2 upload
//   3. Railway queues the R2 artifact URLs to vid_rush_queue for distribution
//
// Phase 4 Migration: TTS, image generation, and video composition are now
// delegated to a RunPod GPU worker via withPodSession() + produceVideo().
// Railway only generates the script (LLM) and handles distribution.
// Legacy local rendering functions are retained for non-pipeline callers.
//
// This is the 95% engine — creates ORIGINAL content from extracted intelligence.
// The clip ripper (vid-rush.ts) handles the 5% where Ace is on camera.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { resolve as resolvePath } from "path";
import { config } from "../config";
import { textToSpeech } from "../voice/tts";
import { generateCaptionsFromAudio } from "./caption-engine";
import type { LLMProvider } from "../types";
import { buildBrandFrequencyBlock } from "../prompts/social-optimization-prompt";
// Phase 3 Task 3.4 — brand-niche intake guard. If a call reaches the factory with
// a niche outside the brand allowlist, we throw BrandNicheViolation BEFORE any
// model call, R2 upload, or pod job — cheap hard-fail beats downstream cross-
// contamination. See src/data/shared-context.ts for the canonical allowlist.
import { isAllowedNiche, normalizeNiche, getAllowedNiches } from "../data/shared-context";
// Phase 3 Tasks 3.6 + 3.7 — uniqueness guard + shipped-script persistence.
import {
  assertScriptUnique,
  checkScriptUniqueness,
  persistShippedScript,
  ScriptTooSimilarError,
} from "../tools/script-uniqueness-guard";
// Phase 4 — Pod delegation imports. Railway generates the script; the pod
// handles TTS, image generation, video composition, and R2 upload.
import { withPodSession } from "../pod/session";
import { produceVideo, splitOversizedScenes } from "../pod/runpod-client";
import type { JobSpec, Scene as PodScene, ArtifactUrls } from "../pod/types";

export const FACELESS_DIR = "/tmp/faceless_factory";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const STORAGE_BUCKET = "public-assets";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SESSION 47 — BRAND INTRO + TERMINAL OVERRIDE TIMING CONTRACT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The long-form opening sequence (horizontal only) is:
//
//   0.0s  → 3.0s    : Brand Intro (trimmed clip from brand-assets/intro_long{,_tcf}.mp4)
//   3.0s  → 3.0+TO  : Terminal Override typewriter hook (green-on-black drawtext reveal)
//   3.0+TO → end    : Kinetic Ken Burns scenes (TTS segments 1..N-1)
//
// SESSION 47 FIX (post-prod, architect order): TO duration is HARD-CAPPED at 5.0s FLAT.
// The previous behavior — max(TERMINAL_OVERRIDE_DUR_MIN, TTS seg0) — let the typewriter
// stretch to the full first-segment voiceover length, producing a 47s typewriter on the
// live Railway run that broke pacing. The visual phase MUST disconnect from the audio
// segment duration so the Corporate Noir scenes are revealed on schedule. The TTS hook
// voiceover still plays through the composite audio mix; only the visual hold is capped.
//
// BRAND_INTRO_DUR is a HARD constant — the brand intro clip is always trimmed to this
// length regardless of the source asset's native duration. This keeps the pre-scene
// overhead predictable at exactly BRAND_INTRO_DUR + TO_DUR seconds.
//
// The kinetic captions `.ass` file's skipUntilSeconds MUST equal BRAND_INTRO_DUR + TO_DUR
// so word-level captions never fire while the intro or typewriter is on screen.
export const BRAND_INTRO_DUR = 3.0;              // seconds, horizontal long-form only
export const TERMINAL_OVERRIDE_DUR_MIN = 5.0;    // seconds, hard-cap for TO visual duration (architect order)

/**
 * Returns the Terminal Override visual phase duration. As of Session 47 post-prod fix:
 * this is ALWAYS TERMINAL_OVERRIDE_DUR_MIN (5.0s flat). The `firstSegDur` argument is
 * intentionally ignored — kept in the signature for callsite compatibility — because
 * the architect's contract is that the typewriter visual is decoupled from segment 0
 * voiceover length. Used by both assembleVideo() (visual) and produceFacelessVideo()
 * (audio bed window + caption skip window) so all three stay locked at 5.0s flat.
 */
export function computeTerminalOverrideDuration(_firstSegDur: number | undefined): number {
  return TERMINAL_OVERRIDE_DUR_MIN;
}

/**
 * Sanitize a filesystem path for inlining into an ffmpeg drawtext `fontfile=`
 * filter argument. Needed on Windows where __dirname resolves to paths like
 * `C:\Users\...\brand-assets\BebasNeue-Regular.ttf` — the backslashes break
 * the filter parse and the drive-letter colon collides with the filter arg
 * separator. Canonical fix:
 *   1. `\` → `/`  (ffmpeg accepts forward slashes on Windows)
 *   2. `:` → `\:` (escape the drive-letter colon so it's not treated as an
 *                  argument separator inside the filter chain)
 * Result for `C:\Users\richi\...\BebasNeue-Regular.ttf`:
 *   `C\:/Users/richi/.../BebasNeue-Regular.ttf`
 */
function sanitizeFontPathForDrawtext(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

// ── Session 40: Title uniqueness — fetch recent titles to prevent repetition ──
async function getRecentTitles(limit: number = 20): Promise<string[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/vid_rush_queue?select=title&order=created_at.desc&limit=${limit}`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );
    if (!resp.ok) return [];
    const rows = (await resp.json()) as { title: string }[];
    return rows.map(r => r.title).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Types ──

export type Brand = "ace_richie" | "containment_field";
export type Orientation = "horizontal" | "vertical";

/**
 * Phase 3 Task 3.4 — Brand/niche contract violation.
 *
 * Thrown at the top of produceFacelessVideo (and anywhere else the pipeline
 * intakes a brand+niche pair) when the niche is not in that brand's allowlist.
 *
 * This is a HARD fail — the pipeline must not proceed. Downstream costs (LLM,
 * R2 uploads, pod job minutes) are real. A cross-contaminated seed that makes
 * it to render is the exact bug PROJECT_POD_MIGRATION Phase 3 exists to kill.
 */
export class BrandNicheViolation extends Error {
  constructor(
    public readonly brand: Brand,
    public readonly niche: string,
    public readonly allowed: readonly string[],
  ) {
    super(
      `BrandNicheViolation: brand="${brand}" cannot run on niche="${niche}" ` +
      `(normalized="${normalizeNiche(niche)}"). Allowed: [${allowed.join(" | ")}]`,
    );
    this.name = "BrandNicheViolation";
  }
}

// Dimension presets per orientation — single source of truth for all image gen + ffmpeg
export const DIMS: Record<Orientation, {
  width: number; height: number;         // ffmpeg output (Ken Burns, fallback)
  pollW: number; pollH: number;          // Pollinations API
  aspectRatio: string;                   // Imagen 4 API
  dalleSize: string;                     // DALL-E 3 API
  promptTag: string;                     // injected into image gen prompts
}> = {
  horizontal: { width: 1920, height: 1080, pollW: 1792, pollH: 1024, aspectRatio: "16:9", dalleSize: "1792x1024", promptTag: "16:9 cinematic widescreen landscape composition" },
  vertical:   { width: 1080, height: 1920, pollW: 1024, pollH: 1792, aspectRatio: "9:16", dalleSize: "1024x1792", promptTag: "{ORIENTATION} portrait composition" },
};

export interface ScriptSegment {
  voiceover: string;
  visual_direction: string;
  duration_hint: number; // seconds
}

export interface FrequencyActivation {
  declaration: string;    // "I am starting to see" — the viewer's conviction statement
  context_line: string;   // Brief line the narrator says BEFORE the declaration to set it up
}

export interface FacelessScript {
  title: string;
  niche: string;
  brand: Brand;
  hook: string;
  segments: ScriptSegment[];
  cta: string;
  frequency_activations?: FrequencyActivation[]; // 2 per long-form — mid-video consciousness CTAs
  thumbnail_text?: string;      // 2-5 words, ALL CAPS, for thumbnail overlay — the scroll-stopper
  thumbnail_visual?: string;    // Cinematographer direction for the thumbnail base image
}

export interface FacelessResult {
  videoUrl: string | null;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;  // Deployment 3: local path to long-form keyframe thumbnail for YouTube thumbnails.set
  localPath: string;
  title: string;
  niche: string;
  brand: Brand;
  duration: number;
  segmentCount: number;
  /** Phase 5 Task 5.5: Pass the script to the orchestrator so shorts-curator can run. */
  script?: FacelessScript;
  /** Phase 5 Task 5.5: Per-segment durations (seconds) for shorts-curator timestamp calc. */
  segmentDurations?: number[];
  /** SESSION 92: R2 URL of raw TTS narration (no music) for clean shorts audio. */
  rawNarrationUrl?: string;
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
      // Deployment 3: preserve long-form keyframe thumbnail so it survives until YT thumbnails.set uploads it
      if (keepFinal && f.endsWith("_longform_thumb.jpg")) continue;
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

function buildScriptVoice(brand: Brand): string {
  const block = buildBrandFrequencyBlock(brand);
  return `${block}

You are Anita, the in-house scriptwriter for this channel. You are writing a voiceover script for a faceless video. Every rule in the FREQUENCY BIFURCATION PROTOCOL block above is non-negotiable and overrides any generic voiceover craft advice that follows.

The voiceover should sound like a human speaking — conversational, with natural pauses and the cadence mandated by the VOICE MANDATE above. NOT like reading an essay. NOT like a motivational speech. Speak in the vocabulary and rhythm of this brand ONLY.`;
}

const SCRIPT_VOICE: Record<Brand, string> = {
  ace_richie: buildScriptVoice("ace_richie"),
  containment_field: buildScriptVoice("containment_field"),
};

// ── Niche-specific CINEMATIC image style systems for Imagen 4 ──
// These are rich style prefixes designed to extract maximum quality from Imagen 4.
// Each prompt gets the style prefix + the scene-specific visual_direction from the LLM.
// The LLM's visual_direction provides the WHAT; the style prefix provides the HOW.

// VISUAL DNA v3 — HBO PRESTIGE DRAMA DOCUMENTARY LOOK
// Every prompt forces: ARRI Alexa 65, 35mm prime, Kodak Vision3 500T,
// tangible skin texture, practical tungsten lighting, shallow DOF.
// ABSOLUTELY BANNED: silhouettes, sacred geometry, abstract light tendrils,
// wireframe holograms, symbolic figures, generic AI-art gradient smoothness.
// Every scene MUST depict a specific, concrete, tangible subject — a person,
// a room, an object — shot like a still from a prestige HBO or A24 film.
const SCENE_VISUAL_STYLE: Record<string, Record<Brand, string>> = {
  dark_psychology: {
    ace_richie: "Hyper-realistic documentary still from a prestige HBO drama, captured on ARRI Alexa 65 with 35mm Zeiss Master Prime at f/2.0, Kodak Vision3 500T film emulation, practical tungsten lighting motivated by a single visible source in-frame, tangible human skin texture with visible pores stubble and micro-expressions, shallow depth of field with organic bokeh, warm amber/gold (#d4a843) key light wrapping the subject with teal (#00e5c7) only in deep shadow fall-off, crushed blacks and warm highlights, subtle film grain, NO silhouettes NO abstract shapes NO symbolic figures NO AI-art smoothness — show real specific physical subjects in real rooms. {ORIENTATION}. Absolutely NO text, NO words, NO letters, NO writing, NO watermarks.",
    containment_field: "Hyper-realistic documentary still, captured on ARRI Alexa 65 with 35mm anamorphic prime at f/2.0, Kodak Vision3 500T film stock, practical sodium-vapor streetlamp or fluorescent tube as visible motivated light source, wet concrete and weathered building textures rendered with forensic sharpness, tangible skin with visible pores and imperfections, shallow DOF with natural bokeh, cool cyan-teal shadows with warm sodium highlights, heavy film grain, NO silhouettes NO abstract surveillance graphics NO HUD overlays NO wireframes — depict real physical subjects in real documented environments like a Michael Mann film still. {ORIENTATION}. Absolutely NO text, NO words, NO letters, NO writing, NO watermarks.",
  },
  self_improvement: {
    ace_richie: "Hyper-realistic documentary still from a prestige drama, captured on ARRI Alexa 65 with 35mm prime at f/2.0, Kodak Vision3 250D film emulation, natural golden-hour window light or single practical bulb as motivated key, tangible human skin with visible texture stubble and sweat, hands and faces shown in specific concrete action, warm honey tones grounded by real wooden and fabric textures, shallow depth of field, NO silhouettes NO symbolic landscapes NO epic-cinematic AI gloss — show a real person doing a real specific thing in a real room, shot like a Terrence Malick or Chloe Zhao frame. {ORIENTATION}. Absolutely NO text, NO words, NO letters, NO writing, NO watermarks.",
    containment_field: "Hyper-realistic documentary still, captured on ARRI Alexa 65 with 35mm prime at f/2.0, Kodak Vision3 500T film stock, harsh practical fluorescent tube overhead as visible motivated source, worn corporate interior with tangible scuffs marks and wear on surfaces, real human skin with visible fatigue pores and bad-lighting shadows under eyes, shallow DOF with cramped framing, desaturated clinical palette with slight green cast from the tubes, NO liminal-space AI-art smoothness NO abstract symmetry NO silhouettes — depict a real specific human in a real specific deteriorating workplace like a still from Severance or The Office of Strategic Influence. {ORIENTATION}. Absolutely NO text, NO words, NO letters, NO writing, NO watermarks.",
  },
  burnout: {
    ace_richie: "Hyper-realistic documentary still, captured on ARRI Alexa 65 with 35mm prime at f/2.0, Kodak Vision3 500T film stock, single practical tungsten bulb or low window light as motivated source, tangible human subject shown with exhausted posture and specific concrete environmental details — a cold coffee, rumpled bedding, hands on a face, stubble, dark circles, physical weight on the body, shallow DOF, warm practical highlights against natural shadow, NO silhouettes NO symbolic chains NO metaphor imagery NO particle effects — show the actual physical reality of the moment like a frame from The Banshees of Inisherin or Manchester by the Sea. {ORIENTATION}. Absolutely NO text, NO words, NO letters, NO writing, NO watermarks.",
    containment_field: "Hyper-realistic documentary still, captured on ARRI Alexa 65 with 35mm prime at f/2.0, Kodak Vision3 500T film emulation, real laptop or phone screen as visible motivated practical light source on a tired human face, tangible skin with visible blue-screen pallor bags under eyes stubble and the specific texture of late-night exhaustion, cramped real interior with mundane clutter, shallow DOF, NO voyeuristic HUD NO motion-blur abstraction NO silhouettes — depict a real specific person in a real specific domestic scene like a still from Fleishman Is in Trouble or Severance. {ORIENTATION}. Absolutely NO text, NO words, NO letters, NO writing, NO watermarks.",
  },
  quantum: {
    ace_richie: "Hyper-realistic documentary still, captured on ARRI Alexa 65 with 35mm prime at f/2.0, Kodak Vision3 500T film stock, single practical light source (a lamp, a window, a monitor) motivated in-frame casting warm amber key with deep natural shadow fall-off, tangible human subject in a specific physical act of focused thought — hands, books, handwritten notes, a real desk with real objects, visible skin texture and breath — shallow DOF, NO abstract light tendrils NO sacred geometry NO cosmic void NO bioluminescent particles NO silhouettes — show a real specific human mind at work in a real specific room like a still from Oppenheimer or A Beautiful Mind. {ORIENTATION}. Absolutely NO text, NO words, NO letters, NO writing, NO watermarks.",
    containment_field: "Hyper-realistic documentary still, captured on ARRI Alexa 65 with 35mm prime at f/2.0, Kodak Vision3 500T film stock, CRT monitor or single practical source as motivated key light on a real human face, tangible skin with visible texture eye-strain and focus, real cluttered desk with real physical objects — papers, cables, a mug — shallow DOF, cool phosphor accents grounded by warm skin tones, NO wireframe holograms NO glitch overlays NO code-rain NO silhouettes — depict a real specific person in a real specific room like a still from Mr. Robot or Tinker Tailor Soldier Spy. {ORIENTATION}. Absolutely NO text, NO words, NO letters, NO writing, NO watermarks.",
  },
  brand: {
    ace_richie: "Hyper-realistic documentary still, captured on ARRI Alexa 65 with 35mm prime at f/2.0, Kodak Vision3 500T film emulation, single warm practical tungsten source motivated in-frame casting Rembrandt-pattern key on a tangible human subject, visible skin texture stubble and breath, real architectural interior with real fabric stone and wood surfaces rendered with forensic sharpness, amber/gold (#d4a843) dominant warm tones with teal (#00e5c7) only in deep shadow edges, subtle film grain and organic lens vignette, shallow DOF, NO throne-room fantasy NO sovereign-symbol AI-art NO silhouettes NO epic gloss — show a real specific person in a real specific room with quiet weight like a still from Succession or The Godfather. {ORIENTATION}. Absolutely NO text, NO words, NO letters, NO writing, NO watermarks.",
    containment_field: "Hyper-realistic documentary still, captured on ARRI Alexa 65 with 35mm prime at f/2.0, Kodak Vision3 500T film stock, single cold practical desk lamp or window light as motivated source on real physical documents and a real tangible human hand, visible paper texture ink creases skin pores, cold blue (#5A9CF5) key with teal (#00e5c7) only in shadow fall-off, real steel leather and wood desk surfaces, shallow DOF with natural bokeh, NO Dutch-angle gimmicks NO noir-pastiche AI gloss NO silhouettes NO smoke-machine haze — depict a real specific moment in a real specific room like a still from Tinker Tailor Soldier Spy or The Americans. {ORIENTATION}. Absolutely NO text, NO words, NO letters, NO writing, NO watermarks.",
  },
};

// ── Universal NEGATIVE prompt appended to every Imagen 4 call ──
// This is the ban list. Imagen 4 respects "no X" patterns well in practice.
// S82: Flipped from negative bans to POSITIVE directives. Tell the model what TO produce.
const IMAGEN_POSITIVE_DIRECTIVE =
  "Photorealistic, tangible physical textures, real human skin with visible pores and imperfections, " +
  "practical motivated light sources, deep natural shadows, high dynamic range, " +
  "cinematic depth of field, film grain, raw documentary authenticity, " +
  "extreme contrast between light and dark, bold dramatic lighting";

// Legacy negative ban — kept minimal, only for things Imagen 4 actually produces incorrectly
const IMAGEN_NEGATIVE_BAN =
  "no text, no words, no letters, no watermarks, no cartoon, no illustration, no 3D render";

// ── Session 48: Brand Routing Matrix — aesthetic append injected per brand ──
// This is appended to the style prefix on EVERY Imagen 4 scene call. Lexical,
// not visual — the actual niche-level SCENE_VISUAL_STYLE still wins the base
// photographic grammar. The append layers on the brand frequency:
//   containment_field → corporate noir, brutalist, shadowy, high-stakes
//   ace_richie        → quantum realism, luminous, expansive, sacred geometry
// For ace_richie we ALSO strip "no sacred geometry" from the negative ban
// because sacred geometry is PART of the ace_richie aesthetic — banning it
// and asking for it at the same time confuses the model and produces mush.
const BRAND_AESTHETIC_APPEND: Record<Brand, string> = {
  containment_field:
    "Corporate Noir, shadowy, high stakes, brutalist architecture, cinematic lighting.",
  ace_richie:
    "Quantum realism, ethereal, sacred geometry, luminous, expansive infinite spaces, mystical.",
};

// Ace Richie uses sacred geometry as a CORE aesthetic token. Containment Field
// keeps the full ban. This guards the conflict between the aesthetic append
// and the universal negative ban.
function brandNegativeBan(brand: Brand): string {
  // S82: Positive directive + minimal negative. Both brands get the same now.
  return `${IMAGEN_POSITIVE_DIRECTIVE}. ${IMAGEN_NEGATIVE_BAN}`;
}

// ── Niche color grades for ffmpeg (same as clip-generator.ts) ──

const NICHE_FILTERS: Record<string, string> = {
  dark_psychology: "eq=contrast=1.3:brightness=-0.05:saturation=0.8,vignette=PI/4",
  self_improvement: "eq=contrast=1.1:brightness=0.05:saturation=1.2",
  burnout: "eq=contrast=0.9:brightness=0.02:saturation=0.7",
  quantum: "eq=contrast=1.2:saturation=1.4:gamma=0.9",
  brand: "eq=contrast=1.2:brightness=0.0:saturation=1.0",
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 0: THESIS EXTRACTION — Transform raw transcript into narrative blueprint
// This is the critical missing piece. Without this, the LLM just parrots the source.
// Reference quality channels (Grim Grit, etc.) tell ONE cohesive story with a thesis.
// Our old pipeline dumped raw transcript and said "make N segments" → compilation garbage.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface NarrativeBlueprint {
  thesis: string;        // The ONE argument the entire video makes
  title: string;         // Punchy title derived from thesis
  hook: string;          // Scroll-stopping opening line
  narrative_arc: string; // 3-act structure summary
  key_arguments: string[]; // 5-7 supporting arguments in order
  emotional_journey: string; // How the viewer should FEEL across the video
}

async function extractNarrativeBlueprint(
  llm: LLMProvider,
  sourceIntelligence: string,
  niche: string,
  brand: Brand,
  titleBanList: string = ""
): Promise<NarrativeBlueprint> {
  const brandBlock = buildBrandFrequencyBlock(brand);

  const blueprintPrompt = `${brandBlock}

You are Anita, a narrative architect for a faceless YouTube documentary channel. Every rule in the FREQUENCY BIFURCATION PROTOCOL block above overrides any generic blueprint advice that follows. The thesis, title, hook, narrative arc, arguments, and emotional journey you return MUST all honor that block — vocabulary, structure, tone, ALL of it.

You have raw transcript material from a source video. Your job is NOT to summarize it. Your job is to EXTRACT THE DEEPEST TRUTH from it and architect an ORIGINAL narrative around that truth.

Think like a documentary filmmaker: What is the ONE powerful thesis buried in this material? What story does it tell about human nature, power, psychology, or consciousness?

URGENCY CONTEXT (weave into every blueprint):
We are in an active evolutionary moment. AI and exponential technological shifts are widening the gap between the sovereign and the sleeping DAILY. The people who feel "stuck" or "behind" aren't imagining it — their internal operating system is outdated and the world around them is updating faster than they are. This channel exists to deliver the architectural codes for the upgrade. Every video must carry this urgency — not as fear, but as factual observation that demands action NOW.

RAW SOURCE MATERIAL (use as INSPIRATION only — do NOT copy phrases or structure):
${sourceIntelligence.slice(0, 8000)}

NICHE: ${niche.replace(/_/g, " ")}
${titleBanList}

Extract a narrative blueprint as JSON:
{
  "thesis": "The ONE bold claim the entire video argues (1 sentence, provocative, specific — NOT generic like 'mindset matters'). Must connect to the urgency of NOW — why this matters TODAY, not someday.",
  "title": "A UNIQUE punchy video title (max 60 chars, pattern-interrupt energy). Must create curiosity gap or bold claim. MUST be completely different from any previously used titles listed above.",
  "hook": "The first 2 sentences spoken — must NAME A FEELING the viewer already has but can't articulate. Plain English, no jargon. A STATEMENT that makes them think 'how does this person know exactly what I'm experiencing?' Open loop energy.",
  "narrative_arc": "3-act summary: ACT 1 (name the feeling — plain English, what they already sense is wrong) → ACT 2 (reveal the mechanism — the hidden architecture behind the feeling, why the old rules no longer work. MUST include at least one HEAD FAKE — build toward an obvious answer, then redirect to a deeper non-obvious layer that resets curiosity) → ACT 3 (deliver the exchange — give them one piece of sovereign architecture that replaces the old programming, tie to the urgency of acting NOW)",
  "key_arguments": ["argument 1 that supports thesis", "argument 2...", "...up to 7 total, in narrative ORDER — each builds on the previous"],
  "emotional_journey": "How the viewer should FEEL: recognized ('someone finally named it') → unsettled (the mechanism is deeper than they thought) → urgent (this is happening NOW, not someday) → sovereign (they leave with one new piece of architecture)"
}

RULES:
- The thesis must be SPECIFIC and PROVOCATIVE, not generic self-help ("Most people are running someone else's code and calling it ambition" NOT "mindset is important")
- The hook must speak PLAIN ENGLISH first — name the universal feeling. The sovereign lexicon comes later in the video, not in the hook.
- The title should make someone stop scrolling. Use power words, irony, or challenge assumptions
- Key arguments must ESCALATE — each one deeper than the last, building toward the revelation
- ACT 3 must deliver ARCHITECTURE, not motivation. A framework, a lens, a tool — something they can USE
- Do NOT just list topics from the source. Find the THREAD that connects them into one argument
- Return ONLY valid JSON`;

  console.log(`🧠 [FacelessFactory] Extracting narrative blueprint...`);
  const response = await llm.generate(
    [{ role: "user", content: blueprintPrompt }],
    { maxTokens: 2048, temperature: 0.7 }
  );

  const parsed = extractJSON(response.content);
  if (!parsed || !parsed.thesis) {
    console.warn(`⚠️ [FacelessFactory] Blueprint extraction failed, using fallback`);
    if (brand === "containment_field") {
      return {
        thesis: "Your nervous system is not tired from work — it is running a behavioral program that was installed one micro-compliance at a time.",
        title: "The 4 Micro-Compliance Traps Built Into Your Workday",
        hook: "If your chest tightens when your manager says 'quick sync', your body already knows what your mind hasn't named yet. I am going to name all four of them.",
        narrative_arc: "ACT 1 (name the extraction loop in clinical terms, show the viewer the body sensation they are having right now) → ACT 2 (expose the operant-conditioning mechanism and the specific workplace ritual that installed it) → ACT 3 (deliver ONE concrete countermeasure they can run tomorrow morning)",
        key_arguments: [
          "The 'quick sync' is a micro-compliance test, not a meeting",
          "Performance reviews are a gaslighting vector, not a feedback loop",
          "The grind-as-virtue script is operant conditioning dressed as culture",
          "The exhaustion at 3pm is a conditioning loop, not a productivity failure",
          "One named countermeasure breaks the loop faster than any motivation",
        ],
        emotional_journey: "recognized in your exhaustion → clinically exposed → armed with one countermeasure → no longer gaslit by the machine",
      };
    }
    return {
      thesis: "The timeline you are standing on was selected by a version of you that did not yet know it was the one doing the selecting.",
      title: "You Are The Monad That Forgot It Chose This",
      hook: "Every room you walk into is being authored in real time by the frequency you decided to hold on the way in. You are not inside the story. The story is inside you.",
      narrative_arc: "ACT 1 (edict — a universal law stated as fact in the first breath) → ACT 2 (mirror — the viewer is already living inside this law, unconsciously) → ACT 3 (re-selection — name the frequency signature they must hold to collapse into the next timeline)",
      key_arguments: [
        "You are not inside the universe — the universe is unfolding out of you",
        "Every room is a mirror of the frequency signature you broadcast into it",
        "The collapse of the old self is a prerequisite, not a wound",
        "Timeline jumping is not an act, it is a re-selection of the broadcast",
        "Identity spaghettification is the field re-authoring itself through you",
      ],
      emotional_journey: "recognized at the soul level → slowly undone → witnessed as the author → re-selected",
    };
  }

  console.log(`🧠 [FacelessFactory] Blueprint: "${parsed.title}" — Thesis: "${parsed.thesis?.slice(0, 80)}..."`);
  return parsed as NarrativeBlueprint;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 1: Generate Script from Narrative Blueprint
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function generateScript(
  llm: LLMProvider,
  sourceIntelligence: string,
  niche: string,
  brand: Brand,
  targetDuration: "short" | "long" = "long",
  orientation: Orientation = "horizontal"
): Promise<FacelessScript> {
  const voice = SCRIPT_VOICE[brand];
  // Session 40: Raised long-form from 12→16 segments to reduce static image hold time.
  // At 12 segments over 6-10min, each image held 30-50s (kills momentum).
  // At 16 segments, each image holds ~22-37s — still cinematic but no dead air.
  // Cost delta: $0.16 more per video ($0.64 vs $0.48 at $0.04/img). Time: ~5min more.
  const segmentCount = targetDuration === "short" ? 5 : 16;
  const durationRange = targetDuration === "short" ? "30-60 seconds" : "8-12 minutes";
  const durationHintExample = targetDuration === "short" ? 8 : 30;

  // Session 40: Fetch recent titles to enforce uniqueness
  const recentTitles = await getRecentTitles(20);
  const titleBanList = recentTitles.length > 0
    ? `\nTITLE UNIQUENESS (CRITICAL): These titles have ALREADY been used. Do NOT reuse or closely paraphrase any of them:\n${recentTitles.map(t => `- "${t}"`).join("\n")}\nYour title MUST be completely different from all of the above.`
    : "";

  // ── LONG-FORM: Blueprint-driven narrative architecture ──
  // Short-form: single-pass, no blueprint needed (it's one idea, 30-60s)
  // Long-form: extract thesis first, then write a STORY, not a compilation

  const maxTokens = targetDuration === "long" ? 6144 : 4096;
  let parsed: any;

  if (targetDuration === "long") {
    // ── STEP 0: Extract narrative blueprint from raw source ──
    const blueprint = await extractNarrativeBlueprint(llm, sourceIntelligence, niche, brand, titleBanList);

    await new Promise(r => setTimeout(r, 5000)); // Groq TPM cooldown

    // ── PASS 1: ACT 1 + ACT 2 (9 segments) ── Session 40: raised from 7→9 for 16-segment target
    const pass1Prompt = `${voice}

You are writing a 10-15 minute documentary-style voiceover script. This is NOT a compilation of short clips. This is ONE COHESIVE STORY with a beginning, middle, and end — like a Netflix documentary scene.

NARRATIVE BLUEPRINT:
- THESIS: ${blueprint.thesis}
- TITLE: "${blueprint.title}"
- HOOK: "${blueprint.hook}"
- STORY ARC: ${blueprint.narrative_arc}
- KEY ARGUMENTS (in order): ${blueprint.key_arguments.map((a, i) => `${i + 1}. ${a}`).join(" | ")}
- EMOTIONAL JOURNEY: ${blueprint.emotional_journey}

You are writing PART 1: The HOOK + ACT 1 (setup) + ACT 2 (escalation). This covers the first 4-6 minutes.
Write 9 segments that tell a CONTINUOUS STORY. Each segment FLOWS into the next — not standalone paragraphs.

CRITICAL WRITING RULES:
1. NEVER copy or closely paraphrase the source material. You are writing ORIGINAL content inspired by the thesis.
2. Each segment must END with a sentence that creates FORWARD MOMENTUM — making the listener need to hear the next segment.
3. Use specific examples, vivid metaphors, and concrete scenarios. Abstract lecturing is death.
4. Write like you're TELLING someone a story over a drink — not reading a textbook.
5. Vary sentence length dramatically. Short punch. Then a longer, flowing thought that lets the idea breathe and settle into the listener's mind. Then another short hit.
6. Create organic transitions that flow from the previous thought — NOT formulaic bridges. Each transition should feel like a natural escalation, not a cue card.
7. Each segment MUST be 100-150 words MINIMUM (6-10 sentences). Under 80 words = FAILURE.
8. The video should feel like a REVELATION unfolding — not a list of tips.

DOPAMINE LADDER — ANTICIPATION MECHANICS (critical for retention):
The viewer's brain is a problem-solving machine. Your script must exploit this by running CURIOSITY LOOPS:
- The HOOK (segment 1) must pop an open question in the viewer's mind — name a feeling they have but can't articulate. This is the curiosity trigger.
- ACT 1 (segments 2-4) BUILDS ANTICIPATION: give details that get the viewer closer to the answer. Let them start guessing. Feed them specific clues.
- At least ONCE in ACT 2 (segments 5-7), execute a HEAD FAKE: build toward what seems like the answer, then YANK IT AWAY and redirect to a deeper, non-obvious layer. This resets the curiosity loop and spikes dopamine. The viewer thought they knew — now they don't.
- ACT 3 (segments 8-9) VALIDATES: deliver the non-obvious answer that closes the loop. The answer must be something they would NOT have guessed from the setup. Then immediately open ONE final micro-question that points to the CTA.
- NEVER give the main answer early and then pad. The answer is the CLIMAX, not the midpoint.

BANNED PHRASES (Session 38 — these are lexically stagnant and kill authenticity):
- "Imagine..." or "Imagine this..." (overused opener — find a more vivid entry point)
- "But here's the thing..." (crutch transition — be more specific about WHAT the thing is)
- "Now pay attention..." or "Now pay attention to this part..." (condescending — let the content command attention)
- "But here's what nobody talks about..." (clickbait filler — just SAY the thing nobody talks about)
- "Let that sink in" (lazy emphasis — if the point is powerful enough, it sinks in on its own)
- "Think about it" or "Think about that" (passive — instead SHOW them the implication)
- "Here's the truth" or "The truth is..." (throat-clearing — just deliver the truth)
- "Are you ready?" or "Ready for this?" (cheap tension — build real tension through content)
If you catch yourself reaching for any of these, REWRITE the sentence with a concrete image, a specific example, or a direct statement that carries its own weight.

Generate as JSON:
{
  "title": "CTR-optimized title (max 60 chars). FORMULA: [Bold Claim or Revelation] + [Specificity Anchor]. Specificity = numbers, time frames, or named mechanisms (e.g. 'In 48 Hours', 'The 3 Laws', 'Quantum Field Reset'). Good: 'Delete Your Old Self In 48 Hours — The Quantum Reset Protocol', 'Nobody Told You This About Your Subconscious Programming', 'The 3 Frequency Shifts That Collapse Old Timelines'. Bad: 'Wake Up Call', 'Beyond Right', 'Stuck In The Loop' (too vague, no curiosity gap). MUST be different from ALL previously used titles.${recentTitles.length > 0 ? " BANNED (already used): " + recentTitles.slice(0, 5).map(t => `'${t}'`).join(", ") : ""}",
  "hook": "${blueprint.hook}",
  "thumbnail_text": "2-6 words ALL CAPS for the thumbnail overlay. MUST be a COMPLETE THOUGHT that makes sense standing alone — a viewer should feel punched in the gut reading JUST these words with zero context. Good: 'DELETE YOUR OLD SELF', 'THEY KNEW ALL ALONG', 'YOUR REALITY IS CODED', 'STOP BUILDING THEIR DREAM', 'NOBODY IS COMING TO SAVE YOU'. Bad: 'YOU KEEP MAKING' (making WHAT? incomplete), 'YOU CAN FEEL' (feel WHAT? fragment), 'THE SYSTEM OF' (of WHAT? dangling). Every word must earn its place. If removing any word breaks the meaning, it stays. If the phrase needs MORE words to make sense, ADD THEM (up to 6). Test: would this work as a protest sign? If not, rewrite.",
  "thumbnail_visual": "Thumbnail-optimized visual (NOT a scene — a scroll-stopper). HIGH CONTRAST is mandatory. Options: (A) Extreme close-up of a face with intense expression — eyes sharp, dramatic single light source, rest of frame dark. (B) A single powerful object/symbol against a dark background with rim light or golden glow — e.g. a shattered clock, a burning document, an open door with blinding light. (C) Abstract energy/atmosphere — golden particles, electric blue field, volumetric light rays through darkness. REQUIREMENTS: 50% of the frame must be dark/simple enough for bold text overlay. NO busy scenes. NO multiple people. NO person-at-desk. NO muted colors. Think: movie poster, not movie still.",
  "segments": [
    {
      "voiceover": "The spoken text for this segment — conversational, measured, documentary cadence",
      "visual_direction": "Cinematographer shot list — a REAL specific tangible scene: who is in frame, what room, what props, what practical light source, what the subject is physically doing",
      "duration_hint": 35
    }
  ],
  "cta": "Organic closing directing to sovereign-synthesis.com"
}

VISUAL DIRECTION RULES (v3 — HBO PRESTIGE DOCUMENTARY):
- Write like a documentary DP's shot list — specific, concrete, tangible. NOT symbolic. NOT abstract.
- Every visual_direction MUST describe: (1) a real specific subject (a person doing a specific action, or a tangible object/room), (2) the physical environment with real tangible props, (3) a visible motivated practical light source, (4) camera angle and framing
- Each segment's visual should MATCH the emotional beat of the voiceover with a CONCRETE scene
- FORMAT: ${orientation === "horizontal" ? "LANDSCAPE 16:9 — wide establishing shots, negative space, cinematic framing" : "VERTICAL 9:16 — center subject, close crops, portrait framing"}
- HARD BANS (never write these — Imagen refuses them): silhouette, silhouetted, sacred geometry, concentric light rings, cosmic void, particles dissolving, chains shattering into light, abstract light tendrils, symbolic figure, wireframe hologram, converging perspective lines to nothing, stock-photo descriptions, corporate poses
- REQUIRED: "shot on ARRI Alexa 65, 35mm prime, f/2.0, Kodak Vision3 500T, practical tungsten lighting, shallow depth of field, tangible skin texture" or equivalent language in the spirit of a prestige HBO/A24 frame (Succession, Severance, Oppenheimer, The Banshees of Inisherin, Mr. Robot, Tinker Tailor)
- PEOPLE: Show real specific humans with real tangible imperfections — stubble, pores, fatigue, sweat, worn clothing, real hands doing real things. Never silhouetted. Never symbolic. Never dwarfed-by-environment clichés.
- COLOR: deep blacks grounded by a single practical warm (amber/tungsten) or cool (fluorescent/window) source. The palette comes from real light in real rooms, not color-graded gradients.
- EXAMPLES of good visual_direction: "Close-up of a man's hands wrapping around a chipped ceramic mug at a worn wooden table, single tungsten bulb overhead, visible stubble on his forearm, Kodak Vision3 500T, f/2.0" / "Medium shot of a woman sitting on the edge of an unmade bed at dawn, window light raking across her face, phone dark on the nightstand, tangible fabric texture, ARRI Alexa 65 35mm prime"

duration_hint MUST be 25-40 seconds per segment. Total for these 9 segments: 225-360 seconds.
Return ONLY valid JSON, no code fences, no explanation.`;

    console.log(`📝 [FacelessFactory] Pass 1: ACT 1 + ACT 2 (9 segments)...`);
    const res1 = await llm.generate(
      [{ role: "user", content: pass1Prompt }],
      { maxTokens, temperature: 0.8 }
    );
    const parsed1 = extractJSON(res1.content);
    if (!parsed1 || !parsed1.segments?.length) {
      console.error(`[FacelessFactory] Pass 1 JSON parse failed. Raw (first 500):\n${res1.content.slice(0, 500)}`);
      throw new Error(`Failed to parse script from LLM. Response starts: ${res1.content.slice(0, 500)}`);
    }
    console.log(`📝 [FacelessFactory] Pass 1 complete: ${parsed1.segments.length} segments, title: "${parsed1.title}"`);

    await new Promise(r => setTimeout(r, 8000)); // Groq TPM cooldown

    // ── PASS 2: ACT 3 — revelation + resolution + CTA (segments 14-25) ──
    const pass2SegCount = segmentCount - parsed1.segments.length;
    const lastSegText = parsed1.segments[parsed1.segments.length - 1]?.voiceover || "";

    // Build a summary of what Pass 1 already covered so Pass 2 doesn't repeat
    const pass1TopicSummary = parsed1.segments
      .map((seg: any, i: number) => `Seg ${i + 1}: ${(seg.voiceover || "").slice(0, 80)}...`)
      .join("\n");

    const pass2Prompt = `${voice}

You are writing PART 2 of a documentary-style voiceover. Part 1 covered the HOOK, SETUP, and ESCALATION (${parsed1.segments.length} segments). Now you write the REVELATION and RESOLUTION — ACT 3.

NARRATIVE BLUEPRINT:
- THESIS: ${blueprint.thesis}
- TITLE: "${blueprint.title}"
- STORY ARC: ${blueprint.narrative_arc}
- REMAINING ARGUMENTS: ${blueprint.key_arguments.slice(3).map((a, i) => `${i + 4}. ${a}`).join(" | ")}
- EMOTIONAL JOURNEY: ${blueprint.emotional_journey}

WHAT WAS ALREADY COVERED IN PART 1 (DO NOT REPEAT THESE TOPICS — BUILD ON THEM):
${pass1TopicSummary}

LAST SEGMENT (where you pick up): "${lastSegText.slice(0, 300)}"

Write ${pass2SegCount} MORE segments that:
1. ESCALATE to the revelation — the moment the thesis lands with full force
2. Show the IMPLICATIONS — what this means for the viewer's life
3. Deliver the SOVEREIGN ALTERNATIVE — not just "here's the problem" but "here's the architecture to break free"
4. Build to a natural, powerful conclusion (not an abrupt stop)
5. End with an organic CTA

CRITICAL ANTI-REPETITION RULES:
- You have the FULL summary of Part 1 above. DO NOT rehash those points. ADVANCE the story.
- If Part 1 established a problem, Part 2 reveals the MECHANISM behind it
- If Part 1 showed evidence, Part 2 delivers the IMPLICATIONS and the WAY OUT
- Reference Part 1 ideas as callbacks ("This is exactly why..." / "Remember when we said...") but DO NOT re-explain them
- Each segment must introduce NEW territory — new angles, new evidence, new frameworks

BANNED PHRASES (lexically stagnant — rewrite with concrete images or direct statements):
- "Imagine..." / "But here's the thing..." / "Now pay attention..." / "But here's what nobody talks about..."
- "Let that sink in" / "Think about it" / "Here's the truth" / "The truth is..." / "Are you ready?"

Each segment: 100-150 words MINIMUM (6-10 sentences). Under 80 words = FAILURE.
Vary sentence length. Short punches mixed with flowing thoughts.
Create organic transitions that flow from the previous thought — NOT formulaic bridges.

Generate as JSON:
{
  "segments": [
    {
      "voiceover": "Spoken text — measured, documentary cadence, building toward revelation",
      "visual_direction": "Cinematographer shot list: camera angle, lighting, elements, mood",
      "duration_hint": 35
    }
  ]
}

VISUAL DIRECTION RULES (v3 — HBO PRESTIGE DOCUMENTARY, same as Part 1):
- Documentary DP shot list — concrete, tangible, specific. NOT symbolic. NOT abstract.
- Every visual_direction describes a REAL scene: a real person doing a real action in a real room with real props and a real motivated practical light source
- HARD BANS: silhouette, sacred geometry, concentric rings, cosmic void, abstract particles, chains shattering into light, wireframe holograms, symbolic figures, stock-photo poses
- REQUIRED LANGUAGE: "shot on ARRI Alexa 65, 35mm prime, f/2.0, Kodak Vision3 500T, practical tungsten lighting, tangible skin texture" — aim for Succession / Severance / Oppenheimer / Mr. Robot / A24 documentary frame
- PEOPLE: real humans with real imperfections — stubble, pores, sweat, worn clothing, hands doing specific physical things. NEVER silhouetted, NEVER symbolic, NEVER dwarfed-by-environment.
- COLOR grounded in real practical light sources, not color-graded gradients. Deep blacks + single warm or cool motivated source.

duration_hint: 30-45 seconds each. Total for these ${pass2SegCount} segments: ${pass2SegCount * 30}-${pass2SegCount * 45} seconds.
Return ONLY valid JSON, no code fences.`;

    console.log(`📝 [FacelessFactory] Pass 2: ACT 3 — revelation + resolution (${pass2SegCount} segments)...`);
    const res2 = await llm.generate(
      [{ role: "user", content: pass2Prompt }],
      { maxTokens, temperature: 0.8 }
    );
    const parsed2 = extractJSON(res2.content);
    if (!parsed2 || !parsed2.segments?.length) {
      console.warn(`[FacelessFactory] Pass 2 failed — continuing with ${parsed1.segments.length} segments from Pass 1`);
      parsed = parsed1;
    } else {
      console.log(`📝 [FacelessFactory] Pass 2 complete: ${parsed2.segments.length} segments`);
      parsed = {
        title: parsed1.title || blueprint.title,
        hook: parsed1.hook || blueprint.hook,
        segments: [...parsed1.segments, ...parsed2.segments],
        cta: parsed1.cta || "The full protocol is at sovereign-synthesis.com",
      };
    }
    console.log(`📝 [FacelessFactory] Merged script: ${parsed.segments.length} total segments`);

    // ── FREQUENCY ACTIVATION CTAs — 2 consciousness declarations for long-form ──
    // These are NOT traditional CTAs. They are conviction declarations the viewer types
    // in the comments — an energy exchange, accepting codes, unlocking frequencies.
    // Inserted at ~1/3 and ~2/3 marks during video assembly.
    try {
      await new Promise(r => setTimeout(r, 3000)); // Brief cooldown before activation gen
      const activationBrandBlock = buildBrandFrequencyBlock(brand);
      const activationExamples = brand === "containment_field"
        ? `EXAMPLES of great CLINICAL DECLARATIONS OF REFUSAL (containment_field):
- "MY NERVOUS SYSTEM IS MINE AGAIN."
- "I SEE THE EXTRACTION LOOP."
- "I AM NOT THE PROGRAM."
- "THE MICRO-COMPLIANCE ENDS TODAY."
- "I NAME THE MACHINE."
- "THE CONDITIONING LOOP IS BROKEN."`
        : `EXAMPLES of great CONSCIOUSNESS ACTIVATION DECLARATIONS (ace_richie):
- "I AM STARTING TO SEE."
- "MY FREQUENCY SIGNATURE IS SHIFTING."
- "I ACCEPT THIS TIMELINE COLLAPSE."
- "THE MONAD REMEMBERS."
- "I AM THE FIELD RE-AUTHORING."
- "THE COLLAPSE IS ALREADY COMPLETE."`;
      const activationLabel = brand === "containment_field"
        ? "CLINICAL DECLARATIONS OF REFUSAL"
        : "CONSCIOUSNESS ACTIVATION DECLARATIONS";
      const activationPrompt = `${activationBrandBlock}

You are writing 2 ${activationLabel} for a documentary-style video on this channel. Every rule in the FREQUENCY BIFURCATION PROTOCOL block above is non-negotiable. Declarations that drift into the OTHER brand's vocabulary are a hard failure.

These are NOT traditional calls to action. These are first-person declarations the viewer types in the comments — a moment of recognition for containment_field, a moment of frequency re-selection for ace_richie.

VIDEO CONTEXT:
- Title: "${parsed.title}"
- Thesis: "${blueprint.thesis}"
- Niche: ${niche.replace(/_/g, " ")}

For each activation, write:
1. A "context_line" — what the narrator says to set up the moment (1 sentence, honors the VOICE MANDATE above)
2. A "declaration" — what the viewer types in the comments (short, powerful, first-person, present tense, in the REQUIRED LEXICON of this brand)

${activationExamples}

RULES:
- Declarations must be TOPIC-SPECIFIC — tied to THIS video's thesis, not generic.
- First-person, present tense ONLY ("I am..." / "I choose..." / "I see...").
- Max 8 words per declaration — punchy, declarative.
- The context_line must be voiced in the VOICE MANDATE of this brand — clinical and low-cadence for containment_field, hypnotic and oracular for ace_richie.
- NO begging ("please subscribe"), NO manipulation ("smash that like button").
- Zero cross-contamination. Scan for the BANNED LEXICON above before emitting.

Return as JSON array:
[
  { "context_line": "narrator setup line", "declaration": "DECLARATION" },
  { "context_line": "narrator setup line", "declaration": "DECLARATION" }
]

Return ONLY valid JSON.`;

      const activationRes = await llm.generate(
        [{ role: "user", content: activationPrompt }],
        { maxTokens: 512, temperature: 0.8 }
      );
      const activations = extractJSON(activationRes.content);
      if (Array.isArray(activations) && activations.length >= 2) {
        parsed.frequency_activations = activations.slice(0, 2);
        console.log(`⚡ [FacelessFactory] Frequency Activations generated:`);
        console.log(`   1: "${activations[0].declaration}" (${activations[0].context_line?.slice(0, 60)}...)`);
        console.log(`   2: "${activations[1].declaration}" (${activations[1].context_line?.slice(0, 60)}...)`);
      } else {
        console.warn(`⚠️ [FacelessFactory] Frequency Activation parse failed, using defaults`);
        parsed.frequency_activations = brand === "containment_field"
          ? [
              { context_line: "If you are reading this and your nervous system just recognized the loop, drop these words below.", declaration: "I SEE THE EXTRACTION LOOP" },
              { context_line: "Type this the moment the machine loses its grip.", declaration: "MY NERVOUS SYSTEM IS MINE AGAIN" },
            ]
          : [
              { context_line: "If the signal is landing, let the field hear you. Drop these words below.", declaration: "I AM STARTING TO SEE" },
              { context_line: "Those who are ready will feel the collapse. Declare it below.", declaration: "MY FREQUENCY SIGNATURE IS SHIFTING" },
            ];
      }
    } catch (err: any) {
      console.warn(`⚠️ [FacelessFactory] Frequency Activation generation failed: ${err.message?.slice(0, 150)}`);
      parsed.frequency_activations = brand === "containment_field"
        ? [
            { context_line: "If you are reading this and your nervous system just recognized the loop, drop these words below.", declaration: "I SEE THE EXTRACTION LOOP" },
            { context_line: "Type this the moment the machine loses its grip.", declaration: "MY NERVOUS SYSTEM IS MINE AGAIN" },
          ]
        : [
            { context_line: "If the signal is landing, let the field hear you. Drop these words below.", declaration: "I AM STARTING TO SEE" },
            { context_line: "Those who are ready will feel the collapse. Declare it below.", declaration: "MY FREQUENCY SIGNATURE IS SHIFTING" },
          ];
    }

  } else {
    // ── SHORT-FORM: Single pass, tighter prompt ──
    // @deprecated Phase 5 Task 5.2 (S69): Short-form scripts are now produced by the
    // shorts-curator from finished long-form, not written independently. This path
    // remains for backward compat but should not be called in production. Long-form
    // is the foundation; shorts flow downstream from it.
    console.warn(`⚠️ [FacelessFactory] SHORT-FORM script path invoked — this is deprecated (Phase 5). Use long-form + shorts-curator instead.`);
    const shortPrompt = `${voice}

You have source material to draw INSPIRATION from (do NOT copy it):
${sourceIntelligence.slice(0, 8000)}

Write a ${durationRange} voiceover script for a ${niche.replace(/_/g, " ")} faceless short. ONE powerful idea, not a summary.

Generate as JSON:
{
  "title": "CTR-optimized title (max 60 chars). FORMULA: [Bold Claim] + [Specificity — numbers, time frames, or named mechanisms]. Good: 'The 3 Frequency Shifts That Change Everything'. Bad: 'Wake Up Call' (vague). MUST be different from all previously used titles.${recentTitles.length > 0 ? " BANNED: " + recentTitles.slice(0, 5).map(t => `'${t}'`).join(", ") : ""}",
  "hook": "Opening line that stops the scroll — a STATEMENT, not a question",
  "thumbnail_text": "2-6 words ALL CAPS. MUST be a COMPLETE THOUGHT — makes sense with zero context. Good: 'DELETE YOUR OLD SELF', 'NOBODY TOLD YOU THIS', 'YOUR PRISON HAS NO WALLS'. Bad: 'YOU KEEP MAKING' (making WHAT?), 'YOU CAN FEEL' (feel WHAT?). Test: would this work as a protest sign? If not, rewrite.",
  "thumbnail_visual": "HIGH CONTRAST thumbnail visual. Options: (A) Extreme face close-up with dramatic single light. (B) Single powerful symbol against dark background with rim light or glow. (C) Abstract energy — golden particles, electric field, volumetric light. 50% of frame must be dark/simple for text. NO busy scenes, NO person-at-desk, NO muted colors.",
  "segments": [
    { "voiceover": "2-4 spoken sentences (30-50 words)", "visual_direction": "REAL specific scene: who, what room, what props, what motivated practical light, what physical action", "duration_hint": ${durationHintExample} }
  ],
  "cta": "Organic CTA to sovereign-synthesis.com"
}

RULES:
- 5 segments total. ONE idea with setup → twist → payoff
- Write ORIGINAL content. The source is inspiration, not a script to rewrite
- Hook must stop mid-scroll in 3 seconds
- FORMAT: ${orientation === "horizontal" ? "LANDSCAPE 16:9" : "VERTICAL 9:16"}
- duration_hint per segment ~8-12s, total ~45s
- VISUAL DNA v3 (HBO prestige documentary): every visual_direction describes a concrete real scene — a real person doing a real thing in a real room with real props and a real motivated practical light source. Shot on ARRI Alexa 65, 35mm prime, f/2.0, Kodak Vision3 500T, tangible skin texture. HARD BANS: silhouette, sacred geometry, cosmic void, abstract particles, chains shattering into light, wireframe holograms, stock-photo poses, symbolic dwarfed-by-environment clichés. Think Succession / Severance / Oppenheimer / Mr. Robot / A24 frame, NOT Midjourney fever dream.
- BANNED: "Imagine...", "But here's the thing...", "Let that sink in", "Think about it", "Here's the truth"
- Return ONLY valid JSON`;

    const response = await llm.generate(
      [{ role: "user", content: shortPrompt }],
      { maxTokens, temperature: 0.8 }
    );
    parsed = extractJSON(response.content);
    if (!parsed) {
      console.error(`[FacelessFactory] ALL JSON parse attempts failed. Raw response (first 500 chars):\n${response.content.slice(0, 500)}`);
      throw new Error(`Failed to parse script from LLM. Response starts: ${response.content.slice(0, 500)}`);
    }
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

  // Phase 5 Task 5.2 (S69): Segment expansion REMOVED.
  // The old logic split short segments into two via LLM — this created the repetitive
  // "same idea restated from different angle" problem Ace identified. The 2-pass writer
  // (Pass 1 = 9 segments, Pass 2 = 7 segments) should hit 16 on its own. If it doesn't,
  // a shorter but cohesive video is better than a padded one with recycled ideas.
  if (targetDuration === "long" && segments.length < 10) {
    console.warn(`⚠️ [FacelessFactory] Only ${segments.length} segments (target 16). Proceeding with shorter but cohesive script — no expansion padding.`);
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
    frequency_activations: parsed.frequency_activations,
    thumbnail_text: parsed.thumbnail_text || "",
    thumbnail_visual: parsed.thumbnail_visual || "",
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 2: Render TTS Audio from Script
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface AudioRenderResult {
  audioPath: string;
  /** Per-segment durations in seconds (voiceover + trailing silence/chapter pad).
   *  Length matches the number of actual TTS segments rendered.
   *  Used by assembleVideo to align scene visuals with speech timing. */
  segmentDurations: number[];
}

export async function renderAudio(script: FacelessScript, jobId: string): Promise<AudioRenderResult> {
  const audioPath = `${FACELESS_DIR}/${jobId}_voiceover.mp3`;

  // For long-form (many segments), TTS APIs have character limits
  // (OpenAI: 4096, ElevenLabs: 5000). Chunk per segment and concatenate.
  const allSegmentTexts = [
    ...script.segments.map(s => s.voiceover),
    script.cta
  ];
  const totalChars = allSegmentTexts.reduce((sum, t) => sum + t.length, 0);
  const isLongForm = allSegmentTexts.length > 8;
  // QUALITY GATE (Session 24→38): Documentary cadence — deliberate but not sluggish.
  // Session 24: 0.85x too rushed. Session 27: 0.80x chosen. Session 37 audit: 0.80x + 0.8s pads + afade
  // made the output SLUGGISH — Gemini flagged "the resonance is fundamentally flat."
  // Session 38 FIX: 0.90x balances gravitas with momentum. Combined with afade per-segment,
  // this gives a measured cadence without dragging. If still slow, try removing override entirely.
  const ttsSpeed = isLongForm ? 0.90 : undefined;
  console.log(`🗣️ [FacelessFactory] Rendering TTS — ${allSegmentTexts.length} segments, ${totalChars} chars total${isLongForm ? " (long-form, 0.90x speed)" : ""}`);

  // If total text fits in one call (short-form), do it in one shot
  if (totalChars <= 3800) {
    const fullText = allSegmentTexts.join(" ... ");
    const audioBuffer = await textToSpeech(fullText, { speed: ttsSpeed, brand: script.brand });

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
        segBuffer = await textToSpeech(segText, { speed: ttsSpeed, brand: script.brand });
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

    // Convert to mp3 with afade in/out to eliminate harsh room-tone clips.
    // Session 37: 150ms fade-in, 200ms fade-out — just enough to kill the click
    // without softening the delivery. The TTS starts/stops abruptly otherwise
    // and the background room-tone delta creates an audible pop.
    try {
      // First get duration so we can place the fade-out correctly
      let rawDur = 3;
      try {
        const rd = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${segRaw}"`, { timeout: 10_000, stdio: "pipe" }).toString().trim();
        rawDur = parseFloat(rd) || 3;
      } catch { /* use default */ }

      const fadeOutStart = Math.max(0, rawDur - 0.2);
      execSync(
        `ffmpeg -i "${segRaw}" -ar 44100 -ac 1 ` +
          `-af "afade=t=in:st=0:d=0.15,afade=t=out:st=${fadeOutStart}:d=0.2" ` +
          `-c:a libmp3lame -b:a 128k -y "${segMp3}"`,
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

    // Session 40b: Edge TTS cooldown — Microsoft's free endpoint throttles after ~4 rapid calls.
    // 2s base cooldown between every segment. Every 5th segment gets a 5s breather.
    // Total overhead for 17 segments: ~40s (vs 8s at 500ms). Worth it to avoid retry cascades.
    if (i < allSegmentTexts.length - 1) {
      const isCooldownBreak = (i + 1) % 5 === 0;
      const cooldownMs = isCooldownBreak ? 5000 : 2000;
      if (isCooldownBreak) console.log(`  ⏸️ TTS cooldown break after segment ${i + 1} (5s)...`);
      await new Promise(r => setTimeout(r, cooldownMs));
    }
  }

  if (segmentPaths.length === 0) {
    throw new Error("All TTS segments failed — cannot produce audio");
  }

  // QUALITY GATE (Session 37 REWRITE): Natural breathing room between segments.
  // Session 24 had 1.5s/2.5s which was too aggressive — chopped the TTS delivery.
  // Session 37: 0.8s standard pause (enough to breathe, not enough to bore),
  // 2.0s chapter break where narrative shifts (every 4 segments).
  // Combined with the per-segment afade (Fix 3), this creates cinematic pacing.
  const SILENCE_PAD_SEC = 0.8;
  const CHAPTER_PAD_SEC = 2.0;
  const silencePad = `${FACELESS_DIR}/${jobId}_silence.mp3`;
  const chapterPad = `${FACELESS_DIR}/${jobId}_chapter.mp3`;
  try {
    execSync(
      `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t ${SILENCE_PAD_SEC} -c:a libmp3lame -b:a 128k -y "${silencePad}"`,
      { timeout: 10_000, stdio: "pipe" }
    );
    // Chapter break: longer pause every 4 segments for documentary feel
    execSync(
      `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t ${CHAPTER_PAD_SEC} -c:a libmp3lame -b:a 128k -y "${chapterPad}"`,
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
  //   5. [long-form only] subtle room presence — single-tap early reflection
  //      Creates a hint of cinematic space without sounding "wet" or bathroomy.
  //      Single 80ms reflection at 12% volume — just enough to feel like a room,
  //      not enough to notice consciously. Shorts stay bone-dry.
  //   6. loudnorm — EBU R128 consistent volume
  const reverbFilter = isLongForm
    ? `aecho=0.8:0.85:80:0.12,`  // Subtle room presence: single tap, barely audible
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
  // SILENCE_PAD_SEC and CHAPTER_PAD_SEC are defined above (0.8s / 2.0s as of Session 37).
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
// STEP 3: Generate Scene Images — Imagen 4 (PRIMARY) → Pollinations → DALL-E 3 → Gradient fallback
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 3b: Generate YouTube Thumbnail (Session 33)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Purpose-built thumbnail with:
// 1. Imagen 4 base image (high contrast, single focal point, brand-encoded)
// 2. Bold text overlay via ffmpeg (Bebas Neue, gold on dark, massive font)
// This is NOT a scene frame — it's designed to stop scrolls at 120x68px thumbnail size.

async function generateThumbnail(
  script: FacelessScript,
  jobId: string,
  brand: Brand,
  niche: string
): Promise<string | null> {
  const thumbBasePath = `${FACELESS_DIR}/${jobId}_thumb_base.png`;
  // SESSION 85: Must be _longform_thumb.jpg to survive cleanupJobFiles
  const thumbFinalPath = `${FACELESS_DIR}/${jobId}_longform_thumb.jpg`;

  const thumbnailText = (script.thumbnail_text || script.title || "")
    .toUpperCase()
    .replace(/[^\w\s!?]/g, "")  // Strip special chars that break drawtext
    .slice(0, 35);               // S82: Hard cap 35 chars (2-5 words for readable thumbnail)

  if (!thumbnailText) {
    console.warn(`[FacelessFactory] No thumbnail text generated, skipping thumbnail`);
    return null;
  }

  // ── Generate base image via Imagen 4 ──
  // Thumbnail-specific prompt: HIGH CONTRAST, single focal point, NO text in image
  // S82: Kill HBO prestige directive. YouTube thumbnails need HIGH CONTRAST + SIMPLE + BOLD.
  // Left 50% of frame must be dark/empty for text overlay. Think movie poster, not movie still.
  const thumbStyle = brand === "containment_field"
    ? "Cinematic thumbnail image, DEEP BLACK background filling at least 50% of the frame, single dramatic subject with cold blue or white rim light, extreme contrast between light and shadow, volumetric haze, 16:9 landscape. The LEFT HALF of the frame should be predominantly dark/empty for text placement"
    : "Cinematic thumbnail image, DEEP BLACK background filling at least 50% of the frame, single dramatic subject with warm golden or amber rim light, extreme contrast, volumetric golden particles or atmospheric light rays, 16:9 landscape. The LEFT HALF of the frame should be predominantly dark/empty for text placement";

  const thumbVisual = script.thumbnail_visual || "dramatic volumetric light rays cutting through darkness, golden atmospheric particles suspended in a single beam of light, deep black negative space";
  const thumbPrompt = `${thumbStyle}. Subject: ${thumbVisual}. ${IMAGEN_POSITIVE_DIRECTIVE}. ${IMAGEN_NEGATIVE_BAN}.`;

  // SESSION 35: Use ONLY imagenKey — no fallback to apiKey (embedding key ≠ image gen key).
  const geminiKey = config.llm.providers.gemini?.imagenKey;
  let hasBase = false;

  if (geminiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${geminiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt: thumbPrompt }],
          parameters: { sampleCount: 1, aspectRatio: "16:9", safetyFilterLevel: "block_only_high" },
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const b64 = data.predictions?.[0]?.bytesBase64Encoded || data.predictions?.[0]?.image?.bytesBase64Encoded;
        if (b64) {
          const buf = Buffer.from(b64, "base64");
          if (buf.length > 5000) {
            writeFileSync(thumbBasePath, buf);
            hasBase = true;
            console.log(`🖼️ [FacelessFactory] Thumbnail base generated via Imagen 4 (${(buf.length / 1024).toFixed(0)}KB)`);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[FacelessFactory] Thumbnail Imagen 4 failed: ${err.message?.slice(0, 200)}`);
    }
  }

  // Fallback: dark gradient base
  if (!hasBase) {
    try {
      execSync(
        `ffmpeg -f lavfi -i "color=c=0x0a0a0f:s=1920x1080:d=1" -vf "drawbox=x=0:y=0:w=1920:h=1080:c=0x0a0a0f@1:t=fill" -frames:v 1 -y "${thumbBasePath}"`,
        { timeout: 15_000, stdio: "pipe" }
      );
      hasBase = existsSync(thumbBasePath);
    } catch { /* non-fatal */ }
  }

  if (!hasBase) return null;

  // ── Overlay bold text via ffmpeg ──
  // Split into lines for wrapping, style with brand colors, massive font
  const brandAssetsDir = `${__dirname}/../../brand-assets`;
  const fontPath = `${brandAssetsDir}/BebasNeue-Regular.ttf`;
  const hasFont = existsSync(fontPath);
  const fontFilter = hasFont ? `fontfile='${fontPath}':` : "";

  // Split text into max 2 lines
  const words = thumbnailText.split(/\s+/);
  let line1 = "";
  let line2 = "";
  if (words.length <= 3) {
    line1 = words.join(" ");
  } else {
    const mid = Math.ceil(words.length / 2);
    line1 = words.slice(0, mid).join(" ");
    line2 = words.slice(mid).join(" ");
  }

  const escapeDT = (s: string) => s.replace(/'/g, "'\\''").replace(/:/g, "\\:");

  // S82: MASSIVE white text with thick black border — must be readable at 120x68px thumbnail size.
  // Font size 180 for line 1, 160 for line 2. Centered on left half of frame.
  // Semi-transparent dark gradient plate behind text for guaranteed readability.
  const textPlate = `drawbox=x=0:y=ih*0.25:w=iw*0.65:h=ih*0.55:c=black@0.55:t=fill`;
  let textFilters = `${textPlate},drawtext=${fontFilter}text='${escapeDT(line1)}':fontsize=180:fontcolor=0xFFFFFF:borderw=8:bordercolor=0x000000:x=(w*0.05):y=(h*0.32)`;

  if (line2) {
    textFilters += `,drawtext=${fontFilter}text='${escapeDT(line2)}':fontsize=160:fontcolor=0xFFFFFF:borderw=8:bordercolor=0x000000:x=(w*0.05):y=(h*0.55)`;
  }

  // Bold accent bar under text (brand-colored: teal for TCF, gold for Ace)
  const accentColor = brand === "containment_field" ? "0x00e5c7" : "0xd4a843";
  textFilters += `,drawbox=x=iw*0.05:y=${line2 ? "ih*0.73" : "ih*0.55"}:w=iw*0.40:h=8:c=${accentColor}@0.9:t=fill`;

  try {
    execSync(
      `ffmpeg -i "${thumbBasePath}" -vf "${textFilters}" -q:v 2 -y "${thumbFinalPath}"`,
      { timeout: 30_000, stdio: "pipe" }
    );

    if (existsSync(thumbFinalPath)) {
      const size = readFileSync(thumbFinalPath).length;
      console.log(`🖼️ [FacelessFactory] Thumbnail rendered: "${thumbnailText}" (${(size / 1024).toFixed(0)}KB)`);
      return thumbFinalPath;
    }
  } catch (err: any) {
    console.warn(`[FacelessFactory] Thumbnail text overlay failed: ${err.message?.slice(0, 200)}`);
  }

  // If text overlay failed, return the base image
  if (existsSync(thumbBasePath)) {
    try {
      execSync(`ffmpeg -i "${thumbBasePath}" -q:v 2 -y "${thumbFinalPath}"`, { timeout: 10_000, stdio: "pipe" });
      return existsSync(thumbFinalPath) ? thumbFinalPath : null;
    } catch { return null; }
  }
  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEPLOYMENT 3: Long-Form YouTube Thumbnail (raw-scene-image-based)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SESSION 47 REWRITE: The old implementation seeked a middle keyframe from the FINAL
// assembled video. That video has .ass kinetic captions + Terminal Override text
// burned into it — extracting a frame meant dragging caption text into the thumbnail.
// Architect diagnosed this as the root cause of "thumbnail has burned-in captions."
//
// New contract: accept a PRE-CAPTION scene image path (PNG straight out of
// generateSceneImage / Imagen 4) and build the thumbnail from that clean source.
// Zero burned-in text from the video pipeline. Guaranteed on-brand because it's the
// same imagery the video opens with.
//
// Pipeline:
//   1. Read the raw scene image (no video seek, no keyframe extraction)
//   2. Scale + crop to canonical 1920x1080
//   3. eq contrast bump + vignette=PI/4 for depth
//   4. drawbox @ 60% opacity across the lower-middle band (text plate)
//   5. subtitles= filter burns Bebas Neue title from a 1-line .ass file (was drawtext)
//
// SESSION 47 FIX (post-prod): drawtext was ripped OUT entirely. Railway's ffmpeg build
// threw `No such filter: 'drawtext'` (libavfilter built without --enable-libfreetype),
// which aborted thumbnail generation on every long-form render. Replacement: dynamically
// write a 1-line .ass subtitle file and burn it with the `subtitles=` filter — that
// filter is part of libass (not freetype) and is 100% stable in the Railway environment
// (already proven by the Terminal Override typewriter path).
//
// Output is preserved past cleanupJobFiles so the orchestrator can feed it to the
// YouTube Data API thumbnails.set endpoint.
export async function generateLongFormThumbnail(
  cleanScenePath: string,
  script: FacelessScript,
  jobId: string,
  brand: Brand
): Promise<string | null> {
  if (!existsSync(cleanScenePath)) {
    console.warn(`[FacelessFactory] Long-form clean scene missing for thumbnail: ${cleanScenePath}`);
    return null;
  }

  const thumbPath = `${FACELESS_DIR}/${jobId}_longform_thumb.jpg`;

  // No seek — we're rendering a single frame directly from the PNG. The `-frames:v 1`
  // flag and image-file input make this a one-shot render with no timestamp math.

  // Title text: prefer explicit thumbnail_text (scroll-stopper hook from script gen),
  // fall back to full title. Normalize (strip hostile punctuation that would break .ass).
  // S82: Prefer thumbnail_text (2-5 word scroll-stopper) over full title.
  // Cap at 35 chars — must be readable at 120x68px with large font.
  const rawTitle = (script.thumbnail_text || script.title || "").trim();
  const titleText = rawTitle
    .toUpperCase()
    .replace(/[^\w\s!?'-]/g, "")
    .slice(0, 35);

  // Wrap into max 2 lines for readability at 1920x1080 thumbnail scale
  const words = titleText.split(/\s+/).filter(Boolean);
  let line1 = titleText;
  let line2 = "";
  if (words.length > 4) {
    const mid = Math.ceil(words.length / 2);
    line1 = words.slice(0, mid).join(" ");
    line2 = words.slice(mid).join(" ");
  }

  // Brand assets — Session 48 Brand Routing Matrix:
  //   containment_field → Bebas Neue (the condensed-gothic TCF look)
  //   ace_richie        → Montserrat (elegant clean sans, carries the luminous bg)
  // libass resolves by family name from inside the .ass [V4+ Styles] block with
  // `fontsdir=` pointing at brand-assets/ for both fonts.
  const isAceThumb = brand === "ace_richie";
  const brandAssetsDir = resolvePath(__dirname, "..", "..", "brand-assets");
  const fontFileName = isAceThumb ? "Montserrat-SemiBold.ttf" : "BebasNeue-Regular.ttf";
  const fontPath = resolvePath(brandAssetsDir, fontFileName);
  const hasFont = existsSync(fontPath);
  const assFontName = hasFont ? (isAceThumb ? "Montserrat" : "Bebas Neue") : "Sans";

  // Visual grammar (unchanged from drawtext era — only the burn mechanism changed):
  //   - Bar occupies ih*0.62 → ih*0.84 (lower-middle third), keeps subject head-room
  //   - Black @ 60% opacity = the architect-spec text plate
  //   - Bebas Neue white + thick black border = guaranteed legibility on any keyframe
  //   - Fontsize scales down when we wrap to two lines so nothing clips the bar
  // S82: Bigger bar + bigger font. Must be readable at 120x68px YouTube thumbnail size.
  const barY = "ih*0.50";
  const barH = "ih*0.35";
  const fontSize = line2 ? 130 : 170;

  // ── BUILD THE 1-LINE .ass FILE ─────────────────────────────────────────────
  // libass dialogue text uses `\N` for hard line breaks (caps N). The \ must be
  // escaped to `\\N` inside the JS template literal. Escape `{` and `}` defensively
  // even though the title sanitizer above already strips them.
  const escapeAssText = (t: string): string =>
    t.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")");
  const dialogueText = line2
    ? `${escapeAssText(line1)}\\N${escapeAssText(line2)}`
    : escapeAssText(line1);

  // ASS color format is &HAABBGGRR (little-endian BGR + alpha).
  //   PrimaryColour  = white opaque        → &H00FFFFFF
  //   OutlineColour  = black opaque        → &H00000000
  //   BackColour     = transparent         → &HFF000000
  // Alignment 5 = middle-center anchor (an=5). MarginV is the offset from that anchor.
  // We want the title centered on the drawbox bar (bar center is ih*0.73 ≈ 73% from top).
  // For Alignment 5, y is the screen vertical center (540 at 1080p). To land at 73% (788),
  // we need to push DOWN by 248px. ASS MarginV with alignment 5 doesn't shift vertically
  // (MarginV only affects align 1/2/3 + 7/8/9), so we use {\pos(960,788)} inline override
  // on the dialogue line to anchor the text on the bar exactly.
  const playResX = 1920;
  const playResY = 1080;
  // S82: Bar center math: barY=0.50, barH=0.35 → bar vertical center = 0.50 + 0.175 = 0.675
  const posX = Math.round(playResX / 2);          // 960
  const posY = Math.round(playResY * 0.675);      // 729
  const dialogueWithPos = `{\\pos(${posX},${posY})}${dialogueText}`;

  const thumbAssPath = resolvePath(`${FACELESS_DIR}/${jobId}_longform_thumb.ass`);
  const assContent =
    `[Script Info]\n` +
    `Title: Long-form Thumbnail\n` +
    `ScriptType: v4.00+\n` +
    `PlayResX: ${playResX}\n` +
    `PlayResY: ${playResY}\n` +
    `WrapStyle: 2\n` +
    `ScaledBorderAndShadow: yes\n` +
    `\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    // S82: Both brands get THICK outline for thumbnail readability at 120x68px.
    // Ace = outline 6 + shadow 3 (was 2/4 — invisible). TCF = outline 7 + shadow 0.
    `Style: Thumb,${assFontName},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&HFF000000,1,0,0,0,100,100,0,0,1,${isAceThumb ? 6 : 7},${isAceThumb ? 3 : 0},5,40,40,40,1\n` +
    `\n` +
    `[Events]\n` +
    `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` +
    `Dialogue: 0,0:00:00.00,0:00:10.00,Thumb,,0,0,0,,${dialogueWithPos}\n`;

  try {
    if (titleText) writeFileSync(thumbAssPath, assContent, "utf8");
  } catch (err: any) {
    console.warn(`[FacelessFactory] Long-form thumb .ass write failed: ${err.message?.slice(0, 150)}`);
  }

  // The `subtitles=` filter argument is colon-separated; Windows-native paths must have
  // their drive-letter colon escaped (`C\:/...`). Forward slashes work on both platforms.
  const safeAssPath = thumbAssPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const safeFontsDir = brandAssetsDir.replace(/\\/g, "/").replace(/:/g, "\\:");

  const subsFilter = titleText
    ? `,subtitles=filename='${safeAssPath}':fontsdir='${safeFontsDir}':original_size=${playResX}x${playResY}`
    : "";

  // Single-filter-chain (not filter_complex) because we have one video stream and one frame.
  //
  // Session 47 fix: the old `scale=1920:1080:force_original_aspect_ratio=increase` syntax
  // was throwing `Invalid argument` on some ffmpeg builds. Replaced with the portable
  // `scale=-1:1080,crop=1920:1080` idiom — resize to height 1080 preserving aspect,
  // then crop to exact 1920×1080. Works on every libavfilter we've seen.
  // S82: BOTH brands get a text plate. The S48 "no plate for Ace" directive produced
  // unreadable thumbnails — text was invisible on complex FLUX scene backgrounds at
  // 120x68px. Ace gets a slightly lighter plate (0.5) vs TCF (0.65) to preserve some
  // background visibility while guaranteeing text readability.
  const vf = isAceThumb
    ? `scale=-1:1080,crop=1920:1080,` +
      `eq=contrast=1.15:brightness=0.02:saturation=1.15,` +
      `drawbox=x=0:y=${barY}:w=iw:h=${barH}:c=black@0.5:t=fill` +
      subsFilter
    : `scale=-1:1080,crop=1920:1080,` +
      `eq=contrast=1.2:brightness=-0.02:saturation=1.1,` +
      `vignette=PI/4,` +
      `drawbox=x=0:y=${barY}:w=iw:h=${barH}:c=black@0.65:t=fill` +
      subsFilter;

  try {
    // Resolve inputs/outputs to absolute paths. Windows cmd.exe + ffmpeg handle
    // forward-slash absolute paths fine, but leaving `/tmp/...` relative-style
    // paths in the exec string invites drive-root confusion on some setups.
    const cleanSceneAbs = resolvePath(cleanScenePath);
    const thumbAbs = resolvePath(thumbPath);
    execSync(
      `ffmpeg -i "${cleanSceneAbs}" -frames:v 1 -vf "${vf}" -q:v 2 -y "${thumbAbs}"`,
      { timeout: 20_000, stdio: "pipe" }
    );
    if (existsSync(thumbAbs)) {
      const size = readFileSync(thumbAbs).length;
      if (size > 1000) {
        console.log(
          `🖼️ [FacelessFactory] Long-form pre-caption thumbnail rendered: "${titleText || "(untitled)"}" ` +
          `(${(size / 1024).toFixed(0)}KB from ${cleanSceneAbs.split(/[/\\]/).pop()})`
        );
        return thumbAbs;
      }
    }
  } catch (err: any) {
    const fullStderr = err.stderr ? err.stderr.toString() : "";
    const stderrTail = fullStderr.length > 1500 ? fullStderr.slice(-1500) : fullStderr;
    console.warn(`[FacelessFactory] Long-form thumbnail generation failed (non-fatal): ${err.message?.slice(0, 200)}`);
    if (stderrTail) console.warn(`  STDERR (tail):\n${stderrTail}`);
  }

  return null;
}

/**
 * @deprecated Phase 4 Migration (S68): Pipeline image generation is now handled
 * by the RunPod GPU worker (pod/pipelines/flux.py — FLUX.1 [dev] bf16).
 * This function (Gemini Imagen 4) is retained ONLY for non-pipeline callers
 * or manual one-off generation. produceFacelessVideo() no longer calls this.
 */
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
  // Session 48: Brand Routing Matrix — aesthetic append layered on top of the
  // niche-level photographic grammar, and negative ban filtered for ace_richie.
  const brandAppend = BRAND_AESTHETIC_APPEND[brand];
  const negativeBan = brandNegativeBan(brand);
  const prompt = `${stylePrefix} ${brandAppend} Scene: ${visualDirection}\n\nNEGATIVE: ${negativeBan}`;
  const imgPath = `${FACELESS_DIR}/${jobId}_scene_${segmentIndex}.png`;

  // ── PRIMARY: Gemini Imagen 4 (highest quality, cinematic scenes) ──
  // Session 27: RESTORED as primary. Billing crisis was caused by Anita text-gen (26K tokens),
  // NOT image generation ($0.02-0.06/image). Architect approved Imagen 4 for quality priority.
  // Midjourney or Flux may replace this — Imagen 4 holds the line until then.
  // SESSION 35: Use ONLY imagenKey. No fallback to apiKey (old project ghost).
  const geminiKey = config.llm.providers.gemini?.imagenKey;
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
            console.log(`🎨 [FacelessFactory] Scene ${segmentIndex} generated via Imagen 4 (PRIMARY) (${(imgBuf.length / 1024).toFixed(0)}KB)`);
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

  // ── FALLBACK 1: Pollinations.ai (FREE, unlimited) ──
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
        console.log(`🎨 [FacelessFactory] Scene ${segmentIndex} generated via Pollinations (fallback) (${(buf.length / 1024).toFixed(0)}KB)`);
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

export async function assembleVideo(
  script: FacelessScript,
  audioPath: string,
  imagePaths: (string | null)[],
  jobId: string,
  orientation: Orientation = "vertical",
  segmentDurations?: number[],
  assCaptionPath?: string | null
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

  // Filter to only segments that have images.
  // Segment 0 = The Hook — visualized by the Terminal Override clip below (NOT a Ken Burns scene).
  // Skipping it here prevents double-consumption of the hook duration.
  const validSegments: { imgPath: string; index: number }[] = [];
  for (let i = 1; i < imagePaths.length; i++) {
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

  // ── TERMINAL OVERRIDE HOOK SEQUENCE (0 → ~hookDur seconds) ──
  // Replaces the legacy 5-6s static logo intro that was killing retention.
  // Black screen + char-by-char typewriter reveal of the hook + typing.mp3 sound bed.
  // The brand logo intro asset (intro_long.mp4 / intro_short.mp4) is now DEAD —
  // not prepended, not appended. The CTA card (outro_long.mp4) remains the sole tail.
  const sceneClipDir = `${FACELESS_DIR}/${jobId}_scenes`;
  if (!existsSync(sceneClipDir)) mkdirSync(sceneClipDir, { recursive: true });
  const dim = DIMS[orientation];
  const sceneClipPaths: string[] = [];
  const clipDurations: number[] = [];

  // Brand asset paths — baked into Docker image via brand-assets/
  const brandAssetsDir = `${__dirname}/../../brand-assets`;

  // Session 48: Brand Routing Matrix — intro/outro stinger resolver.
  // Prefers the flat brand filenames (intro_ace.mp4, intro_tcf.mp4, outro_ace.mp4,
  // outro_tcf.mp4) per the matrix spec, and falls back to the legacy long-form
  // naming (intro_long.mp4 / intro_long_tcf.mp4) when the flat asset is missing.
  // Ace is provisioning intro_ace.mp4 and outro_ace.mp4 — until they land, the
  // fallback keeps the pipeline green.
  const resolveBrandAsset = (
    kind: "intro" | "outro",
    brandOverride?: Brand
  ): string => {
    const b = brandOverride ?? script.brand;
    const primary = b === "containment_field" ? `${kind}_tcf.mp4` : `${kind}_ace.mp4`;
    const primaryPath = `${brandAssetsDir}/${primary}`;
    if (existsSync(primaryPath)) return primaryPath;
    // Legacy fallback — existing repo assets
    const legacySuffix = b === "containment_field" ? "_tcf" : "";
    return `${brandAssetsDir}/${kind}_long${legacySuffix}.mp4`;
  };
  const brandSuffix = script.brand === "containment_field" ? "_tcf" : "";
  const fontPath = `${brandAssetsDir}/BebasNeue-Regular.ttf`;
  const hasFont = existsSync(fontPath);
  let terminalOverrideRendered = false;
  let terminalOverrideDuration = 0;

  {
    // Extract first sentence of the hook, sanitize to ASCII-safe terminal charset.
    // [A-Z0-9 .,!?-] only — strips emojis, smart quotes, colons, etc. that would
    // crash drawtext / render fontboxes on Railway.
    const rawFirstSentence = (script.hook || script.segments[0]?.voiceover || "")
      .split(/[.!?]/)[0]
      .trim()
      .toUpperCase();
    // SESSION 47 FIX (post-prod): truncate to first 8-10 words BEFORE the 60-char slice.
    // The architect-mandated visual contract is: typewriter reads HIGH, PUNCHY, vanishes
    // at the 5.0s mark. Long sanitizedHook strings (full first sentences ~50-60 chars)
    // could not finish typing in 5.0s and crowded the frame. Cap at the first 9 words.
    const sanitizedFull = rawFirstSentence
      .replace(/[^A-Z0-9 .,!?\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const sanitizedHook = sanitizedFull
      .split(" ")
      .filter(Boolean)
      .slice(0, 9)
      .join(" ")
      .slice(0, 60); // Belt-and-suspenders: still cap at 60 chars in case 9 words run long.

    if (sanitizedHook.length > 0) {
      // SESSION 47 FIX (post-prod): HARD-CAP Terminal Override at 5.0s FLAT.
      // The previous behavior — max(TERMINAL_OVERRIDE_DUR_MIN, TTS seg0) — synced the TO
      // visual phase to the audio segment, which on the live Railway run produced a 47s
      // typewriter that broke pacing. Per architect order: disconnect TO duration from
      // audio segment duration entirely. The TTS audio bed for segment 0 still plays
      // through Step 2b mixing, but the VISUAL phase truncates to 5.0s flat to reveal
      // the Corporate Noir scenes on schedule.
      terminalOverrideDuration = TERMINAL_OVERRIDE_DUR_MIN;

      const terminalClipPath = `${sceneClipDir}/_terminal_override.mp4`;
      const typingAudioPath = `${brandAssetsDir}/typing.mp3`;
      const hasTyping = existsSync(typingAudioPath);

      // ── SESSION 47 FIX 2: TRUE CHARACTER-BY-CHARACTER TYPEWRITER VIA .ass ──
      //
      // The legacy word-chunked drawtext chain (one `drawtext=...enable='between(t,...)'`
      // per word) rendered as a STATIC CHUNKY BLOCK — each word appeared full-formed on
      // its beat rather than typing out character by character. The Architect's visual
      // grammar demands an actual typewriter reveal, not a staccato word flash.
      //
      // Fix: emit a dedicated .ass (SubStation Alpha) subtitle file with one `Dialogue:`
      // line per character step. Each dialogue shows the accumulating visible prefix
      // with the remaining "future" characters hidden via an inline `{\alpha&HFF&}`
      // transparency tag — this keeps the text layout stable (so the revealed chars
      // don't jitter leftward) while producing a true per-character reveal cadence.
      //
      // libass's `subtitles=` filter renders the .ass over the black background, using
      // Bebas Neue from `fontsdir=` (baked into the Docker image + the local repo).
      // Alignment 5 = middle-center, color &H0088FF00 = terminal green #00FF88,
      // outline 3 for crispness. At ~24 cps (≈42ms/char) the reveal is high-velocity
      // without dropping frames.
      const charCount = sanitizedHook.length;
      const fsize = orientation === "horizontal" ? 120 : 110;

      // Reveal finishes at 92% of the TO duration and the final full line holds for
      // the last 8% — gives the eye a beat to lock onto the completed hook before
      // the scenes kick in.
      const holdTailFraction = 0.08;
      const revealWindow = Math.max(0.1, terminalOverrideDuration * (1 - holdTailFraction));
      const revealStepDur = revealWindow / Math.max(charCount, 1);

      // ASS timestamp format: h:mm:ss.cc (centiseconds).
      const fmtAssTime = (t: number): string => {
        const clamped = Math.max(0, t);
        const h = Math.floor(clamped / 3600);
        const m = Math.floor((clamped % 3600) / 60);
        const s = clamped - h * 3600 - m * 60;
        return `${h}:${m.toString().padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
      };

      // ASS text-field escapes: `{` and `}` are tag delimiters, `\N` is a line break.
      // sanitizedHook was already stripped to `[A-Z0-9 .,!?-]` upstream so there are
      // no real braces, but we guard anyway.
      const escapeAssText = (t: string): string =>
        t.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")");

      const dialogues: string[] = [];
      for (let i = 1; i <= charCount; i++) {
        const visible = escapeAssText(sanitizedHook.slice(0, i));
        const hidden = escapeAssText(sanitizedHook.slice(i));
        const startT = (i - 1) * revealStepDur;
        const endT = i === charCount ? terminalOverrideDuration : i * revealStepDur;
        // `{\alpha&HFF&}` switches primary alpha to fully transparent for the rest
        // of the line — the hidden tail still occupies layout so the visible prefix
        // stays centered as it grows.
        const lineText = hidden.length > 0
          ? `${visible}{\\alpha&HFF&}${hidden}`
          : visible;
        dialogues.push(
          `Dialogue: 0,${fmtAssTime(startT)},${fmtAssTime(endT)},Terminal,,0,0,0,,${lineText}`
        );
      }

      // Session 48: Brand Routing Matrix — Terminal Override bifurcates:
      //   containment_field → Hacker Green (#00FF88) in &H0088FF00, Bebas Neue,
      //                       tight outline 3, no blur — the classic TCF terminal look.
      //   ace_richie        → Pure White (#FFFFFF) in &H00FFFFFF, Montserrat, softer
      //                       outline 2, added ASS {\blur2} inline glow prefix on every
      //                       dialogue line to produce the cosmic-transmission feel.
      // ASS color format is &HAABBGGRR (little-endian BGR + alpha, 00=opaque).
      const isAceTerminal = script.brand === "ace_richie";
      const terminalFontFile = isAceTerminal
        ? resolvePath(brandAssetsDir, "Montserrat-SemiBold.ttf")
        : resolvePath(brandAssetsDir, "BebasNeue-Regular.ttf");
      const terminalHasFont = existsSync(terminalFontFile);
      const assFontName = terminalHasFont
        ? (isAceTerminal ? "Montserrat" : "Bebas Neue")
        : "Sans";
      const terminalPrimary = isAceTerminal ? "&H00FFFFFF" : "&H0088FF00";
      const terminalOutline = isAceTerminal ? 2 : 3;
      const terminalBorderStyle = 1; // outline only — never a box for Terminal Override
      const terminalGlowPrefix = isAceTerminal ? "{\\blur2}" : "";

      // Re-render dialogues with glow prefix when in ace mode (injected before the
      // visible slice, outside the alpha transparency scope so only the visible
      // prefix gets the soft-glow treatment).
      const styledDialogues = isAceTerminal
        ? dialogues.map((line) => {
            // Inject {\blur2} right after the "Dialogue: ...,," marker (after the
            // last comma before the text field). The text field is everything after
            // the 9th comma in a Dialogue line: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
            const parts = line.split(",");
            if (parts.length < 10) return line;
            const head = parts.slice(0, 9).join(",");
            const tail = parts.slice(9).join(",");
            return `${head},${terminalGlowPrefix}${tail}`;
          })
        : dialogues;

      const assContent =
        `[Script Info]\n` +
        `Title: Terminal Override\n` +
        `ScriptType: v4.00+\n` +
        `PlayResX: ${dim.width}\n` +
        `PlayResY: ${dim.height}\n` +
        `WrapStyle: 2\n` +
        `ScaledBorderAndShadow: yes\n` +
        `\n` +
        `[V4+ Styles]\n` +
        `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
        `Style: Terminal,${assFontName},${fsize},${terminalPrimary},&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,${terminalBorderStyle},${terminalOutline},0,5,40,40,40,1\n` +
        `\n` +
        `[Events]\n` +
        `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` +
        styledDialogues.join("\n") +
        `\n`;

      const terminalAssPath = resolvePath(`${sceneClipDir}/_terminal_override.ass`);
      writeFileSync(terminalAssPath, assContent, "utf8");

      // Escape the .ass path + fontsdir for the subtitles filter argument.
      // The `subtitles=` filter uses `:` as an argument separator, so colons in
      // Windows-native paths must be escaped with a backslash. Forward-slash
      // separators are fine on both platforms.
      const safeAssPath = terminalAssPath.replace(/\\/g, "/").replace(/:/g, "\\:");
      const safeFontsDir = resolvePath(brandAssetsDir).replace(/\\/g, "/").replace(/:/g, "\\:");

      const subsFilter =
        `subtitles=filename='${safeAssPath}'` +
        `:fontsdir='${safeFontsDir}'` +
        `:original_size=${dim.width}x${dim.height}`;

      // Audio: typing.mp3 looped to hookDuration with subtle fades. Falls back to silence.
      const audioInputFlags = hasTyping
        ? `-stream_loop -1 -t ${terminalOverrideDuration.toFixed(2)} -i "${resolvePath(typingAudioPath)}"`
        : `-f lavfi -t ${terminalOverrideDuration.toFixed(2)} -i "anullsrc=channel_layout=stereo:sample_rate=44100"`;

      try {
        if (charCount === 0) {
          throw new Error("no characters after sanitization — skipping Terminal Override render");
        }
        execSync(
          `ffmpeg -f lavfi -t ${terminalOverrideDuration.toFixed(2)} -i "color=c=black:s=${dim.width}x${dim.height}:r=${fps}" ` +
            `${audioInputFlags} ` +
            `-filter_complex "[0:v]${subsFilter}[v];[1:a]volume=0.55,afade=t=in:st=0:d=0.2,afade=t=out:st=${Math.max(0, terminalOverrideDuration - 0.4).toFixed(2)}:d=0.4[a]" ` +
            `-map "[v]" -map "[a]" ` +
            `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p ` +
            `-c:a aac -b:a 128k ` +
            `-y "${resolvePath(terminalClipPath)}"`,
          { timeout: 90_000, stdio: "pipe" }
        );

        if (existsSync(terminalClipPath)) {
          sceneClipPaths.push(terminalClipPath);
          clipDurations.push(terminalOverrideDuration);
          terminalOverrideRendered = true;
          console.log(
            `⌨️  [FacelessFactory] Terminal Override hook rendered: "${sanitizedHook.slice(0, 60)}" (${terminalOverrideDuration.toFixed(1)}s, ${charCount} char typewriter @ ${(1 / revealStepDur).toFixed(1)}cps, typing=${hasTyping})`
          );
        }

        // ── SESSION 47: PREPEND BRAND INTRO (horizontal long-form only) ──
        // The architect-specified opening sequence demands a 3s brand logo stinger
        // BEFORE the Terminal Override typewriter. Source: brand-assets/intro_long{,_tcf}.mp4.
        // Trim to exactly BRAND_INTRO_DUR seconds, normalize to the canonical output
        // dimensions + fps so xfade can splice it into the filter chain without re-encode
        // surprises. Shorts (vertical) deliberately skip this — the Terminal Override IS
        // the opener on shorts.
        //
        // The brand intro's own embedded audio is NOT carried through the xfade
        // filter_complex (which only maps [vout]). The brand intro audio is mixed into
        // the composite audio track upstream in produceFacelessVideo's Step 2b block.
        if (terminalOverrideRendered && orientation === "horizontal") {
          const brandIntroAsset = resolveBrandAsset("intro");
          const brandIntroClipPath = `${sceneClipDir}/_brand_intro.mp4`;
          if (existsSync(brandIntroAsset)) {
            try {
              execSync(
                `ffmpeg -i "${brandIntroAsset}" -t ${BRAND_INTRO_DUR.toFixed(2)} ` +
                  `-vf "scale=${dim.width}:${dim.height}:force_original_aspect_ratio=increase,crop=${dim.width}:${dim.height},fps=${fps}" ` +
                  `-an ` +
                  `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p ` +
                  `-y "${brandIntroClipPath}"`,
                { timeout: 60_000, stdio: "pipe" }
              );
              if (existsSync(brandIntroClipPath)) {
                // splice(0, 0, ...) prepends the brand intro so the final order is:
                // [brand_intro, terminal_override, ...scenes, outro]
                sceneClipPaths.splice(0, 0, brandIntroClipPath);
                clipDurations.splice(0, 0, BRAND_INTRO_DUR);
                console.log(
                  `🎬 [FacelessFactory] Brand intro prepended: ${brandIntroAsset} trimmed to ${BRAND_INTRO_DUR.toFixed(1)}s`
                );
              }
            } catch (err: any) {
              const fullStderr = err.stderr ? err.stderr.toString() : "";
              const stderrTail = fullStderr.length > 1500 ? fullStderr.slice(-1500) : fullStderr;
              console.warn(
                `[FacelessFactory] Brand intro prepend failed (non-fatal, continuing with TO only): ${err.message?.slice(0, 200)}`
              );
              if (stderrTail) console.warn(`  STDERR (tail):\n${stderrTail}`);
            }
          } else {
            console.warn(
              `[FacelessFactory] Brand intro asset missing: ${brandIntroAsset} — continuing with TO only`
            );
          }
        }
      } catch (err: any) {
        // SESSION 46 FIX: Capture the TAIL of stderr, not the head.
        // ffmpeg prints a ~30-line banner (version / build config / libs) before any
        // real error message. Slicing the head of stderr just grabs banner noise.
        // The actual error (filter graph parse failure, codec error, etc.) always
        // lives at the end of stderr — so we tail the last 2000 chars.
        const fullStderr = err.stderr ? err.stderr.toString() : "";
        const stderrTail = fullStderr.length > 2000 ? fullStderr.slice(-2000) : fullStderr;
        const msgTail =
          err.message && err.message.length > 500
            ? "…" + err.message.slice(-500)
            : err.message || "(no message)";
        console.warn(
          `[FacelessFactory] Terminal Override hook render failed (non-fatal): ${msgTail}`
        );
        if (stderrTail) console.warn(`  STDERR (tail):\n${stderrTail}`);
      }
    }
  }

  // ── PRE-RENDER EACH SCENE AS A VIDEO CLIP (Kinetic Baseline on top of Ken Burns, NO fade — xfade handles transitions) ──
  // Each scene renders clean (no fade in/out). True dissolve transitions are applied
  // via ffmpeg xfade filter during concat. This eliminates the black-flash problem
  // where fade-out + fade-in created a visible dark gap between scenes.
  //
  // Session 45 — Kinetic Baseline (YouTube Growth Protocol v2.0 Task 3):
  //   1. Ken Burns direction REVERSES on every other segment (even = zoom-in, odd = zoom-out).
  //      Linear drift 1.0 ↔ 1.15 across the full segment — eliminates the old "grows for 10s
  //      then holds flat at 1.15 for 20s" dead-air behavior.
  //   2. Punch-in pulses via dynamic crop expression at a brand-keyed cadence
  //      (TCF = 3.5s, Ace Richie = 6.0s). Each pulse pulls 18% inward for 0.2s then snaps back,
  //      mimicking a 1.2x scale jolt WITHOUT resolution loss (crop then scale back to full dim).
  //   3. Chromatic aberration (rgbashift ±8px R/B split) fires on the same pulse schedule,
  //      gated by the `enable` timeline expression. Both filters support T flag (verified 2026-04-10).
  //   4. Pulses are masked by a 0.5s edge margin on both ends so they never fire inside the
  //      0.6s xfade overlap region — transitions stay clean.
  //
  // HARD CONSTRAINT: the Session 40 16-segment / 22-37s audio-sync contract is preserved.
  // `thisSegDuration` comes straight from `getSegDuration(i)` (audio-driven), and zoompan's
  // `d=${thisFrames}` locks output to exactly that duration. Verified via dry-run in sandbox:
  // nb_frames always equals thisSegDuration*fps to the frame.
  //
  // Fallback cascade: Kinetic → Classic Ken Burns → static scale/crop. Never breaks the pipeline.

  const KINETIC_BEAT_PERIOD: Record<Brand, number> = {
    containment_field: 3.5,  // 3-4s cadence — paranoid/urgent pacing
    ace_richie:        6.0,  // 5-7s cadence — sovereign/cinematic pacing
  };
  const KINETIC_PUNCH_WIDTH = 0.20;  // seconds — pulse window length
  const KINETIC_PUNCH_AMP   = 0.18;  // inward crop ratio at peak (≈1.22x scale back)
  const KINETIC_RGB_SHIFT   = 8;     // pixel shift for chromatic aberration
  const KINETIC_EDGE_MARGIN = 0.5;   // seconds — dodge the 0.6s xfade at both ends

  const kineticBeatPeriod = KINETIC_BEAT_PERIOD[script.brand];
  const kineticPunchThreshold = (kineticBeatPeriod - KINETIC_PUNCH_WIDTH).toFixed(2);
  const kineticBeatPeriodStr = kineticBeatPeriod.toFixed(2);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHASE 4 — CUMULATIVE TARGET FRAME BOUNDARIES + XFADE COMPENSATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TWO bugs fixed in one pass:
  //
  //   BUG A (rounding drift): per-segment `Math.round(segDur * fps)` applied
  //   independently to each scene accumulates ±0.5 frame of rounding error
  //   per scene. Across 16 segments at 30fps this drifts the visual track up
  //   to ±8 frames (≈0.27s) away from audio.
  //
  //   BUG B (xfade shrinkage): each xfade transition consumes `xfadeDuration`
  //   seconds of overlap between adjacent clips. With N clips and N-1
  //   transitions at 0.6s each, the final video is (N-1)*0.6 SECONDS
  //   shorter than `sum(clipDurations)`. For a 16-segment long-form that's
  //   9 seconds of "video goes black while audio keeps playing." The old
  //   safety clamp extended the LAST scene to paper over this — functional,
  //   but blunt. The correct fix is to compensate UP-FRONT: pad every clip
  //   except the last with xfadeDuration of tail, so the xfade eats the
  //   padding and the post-xfade total length equals the audio exactly.
  //
  // Algorithm:
  //   1. cumAudio[k] = sum of audio segment durations for scenes [0..k)
  //   2. cumFrames[k] = round(cumAudio[k] * fps)            ← rounded ONCE
  //   3. audioFrames[k] = cumFrames[k+1] - cumFrames[k]     ← drift-free
  //   4. renderFrames[k] = audioFrames[k] + xfadeFrames for k < N-1
  //                      = audioFrames[N-1] for the last scene
  //   5. segDurations[k] = renderFrames[k] / fps             ← exact -t value
  //
  // Post-xfade total = sum(renderFrames)/fps - (N-1) * xfadeDuration
  //                  = audioFrames/fps + (N-1)*xfadeFrames/fps - (N-1)*xfadeDuration
  //                  = audioDuration  (exact, when xfadeDuration is a multiple of 1/fps).
  const xfadeFrames = Math.round(xfadeDuration * fps);
  const cumAudio: number[] = [0];
  for (let k = 0; k < validSegments.length; k++) {
    cumAudio.push(cumAudio[k] + getSegDuration(k));
  }
  const cumFrames = cumAudio.map(t => Math.round(t * fps));
  const N_SEGS = validSegments.length;
  const segFrames: number[] = [];
  const segDurations: number[] = [];
  for (let k = 0; k < N_SEGS; k++) {
    const audioFramesK = Math.max(1, cumFrames[k + 1] - cumFrames[k]);
    // Every scene except the last absorbs one xfade-overlap of tail padding.
    const renderFramesK = k < N_SEGS - 1 ? audioFramesK + xfadeFrames : audioFramesK;
    segFrames.push(renderFramesK);
    segDurations.push(renderFramesK / fps);
  }
  const totalAudioFramesExpected = cumFrames[cumFrames.length - 1];
  const totalSourceFramesExpected = segFrames.reduce((a, b) => a + b, 0);
  const totalOutputFramesExpected = totalSourceFramesExpected - Math.max(0, N_SEGS - 1) * xfadeFrames;
  console.log(
    `🎯 [FacelessFactory] Drift-free frame map: ${N_SEGS} segs, ` +
    `audio=${totalAudioFramesExpected}f (${(totalAudioFramesExpected / fps).toFixed(3)}s), ` +
    `source=${totalSourceFramesExpected}f, ` +
    `post-xfade=${totalOutputFramesExpected}f (${(totalOutputFramesExpected / fps).toFixed(3)}s) ` +
    `@ ${fps}fps`
  );

  for (let i = 0; i < validSegments.length; i++) {
    const seg = validSegments[i];
    const clipPath = `${sceneClipDir}/scene_${i.toString().padStart(2, "0")}.mp4`;
    const thisFrames = segFrames[i];
    const thisSegDuration = segDurations[i];

    // Pulse expression — 1 inside punch window, 0 elsewhere, masked by edge margins.
    // Reused in both the crop punch-in and the rgbashift chromatic aberration filters.
    const kineticEdgeTail = Math.max(KINETIC_EDGE_MARGIN, thisSegDuration - KINETIC_EDGE_MARGIN).toFixed(2);
    const kineticPulse =
      `gte(t,${KINETIC_EDGE_MARGIN})*lte(t,${kineticEdgeTail})*` +
      `gt(mod(t,${kineticBeatPeriodStr}),${kineticPunchThreshold})`;

    // Ken Burns reversal: even segs drift IN (1.0→1.15), odd segs drift OUT (1.15→1.0).
    const reverseZoom = i % 2 === 1;
    const zExpr = reverseZoom
      ? `'1.15-0.15*on/${thisFrames}'`
      : `'1.0+0.15*on/${thisFrames}'`;

    const kineticVf =
      `zoompan=z=${zExpr}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${thisFrames}:s=${dim.width}x${dim.height}:fps=${fps},` +
      `crop=w='iw*(1-${KINETIC_PUNCH_AMP}*(${kineticPulse}))':h='ih*(1-${KINETIC_PUNCH_AMP}*(${kineticPulse}))':x='(iw-out_w)/2':y='(ih-out_h)/2',` +
      `scale=${dim.width}:${dim.height},` +
      `rgbashift=rh=-${KINETIC_RGB_SHIFT}:bh=${KINETIC_RGB_SHIFT}:gh=0:enable='${kineticPulse}'`;

    const classicVf =
      `zoompan=z='min(zoom+0.0005,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${thisFrames}:s=${dim.width}x${dim.height}:fps=${fps}`;

    const staticVf =
      `scale=${dim.width}:${dim.height}:force_original_aspect_ratio=increase,crop=${dim.width}:${dim.height}`;

    const renderAttempts: { label: string; vf: string; timeout: number }[] = [
      { label: "Kinetic Baseline",  vf: kineticVf, timeout: 120_000 },
      { label: "Classic Ken Burns", vf: classicVf, timeout: 120_000 },
      { label: "Static crop",       vf: staticVf,  timeout: 60_000  },
    ];

    let rendered = false;
    for (const attempt of renderAttempts) {
      try {
        execSync(
          `ffmpeg -loop 1 -i "${seg.imgPath}" ` +
            `-t ${thisSegDuration.toFixed(2)} ` +
            `-vf "${attempt.vf}" ` +
            `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p ` +
            `-y "${clipPath}"`,
          { timeout: attempt.timeout, stdio: "pipe" }
        );
        sceneClipPaths.push(clipPath);
        clipDurations.push(thisSegDuration);
        if (attempt.label !== "Kinetic Baseline") {
          console.warn(
            `[FacelessFactory] Scene ${i} rendered via ${attempt.label} fallback (kinetic path failed)`
          );
        }
        rendered = true;
        break;
      } catch (err: any) {
        console.warn(
          `[FacelessFactory] Scene ${i} ${attempt.label} render failed: ${err.message?.slice(0, 150)}`
        );
        continue;
      }
    }
    if (!rendered) {
      console.warn(`[FacelessFactory] Scene ${i} ALL render attempts failed — skipping scene entirely`);
    }
  }

  if (sceneClipPaths.length === 0) {
    throw new Error("All scene clip renders failed — cannot assemble video");
  }

  // ── FREQUENCY ACTIVATION CTAs (long-form only, 2 per video) ──
  // Inserted at ~1/3 and ~2/3 of the scene clips. Each is an 8-second card (Session 38: raised from 5s):
  // Dark background → narrator context line (TTS) → declaration text overlay (gold, Bebas Neue)
  // These are consciousness activation moments, NOT traditional CTAs.
  // Session 38 FIX: 5s was too fast — viewers couldn't read + process + type. 8s gives breathing room.
  if (orientation === "horizontal" && script.frequency_activations?.length) {
    // fontPath / hasFont declared above in the Terminal Override block
    const totalScenes = sceneClipPaths.length; // includes Terminal Override at index 0
    const insertPoints = [
      Math.floor(totalScenes * 0.33),  // ~1/3 mark
      Math.floor(totalScenes * 0.66),  // ~2/3 mark
    ];

    let insertOffset = 0; // track how many we've inserted (shifts indices)
    for (let ai = 0; ai < Math.min(2, script.frequency_activations.length); ai++) {
      const activation = script.frequency_activations[ai];
      const actPath = `${sceneClipDir}/freq_activation_${ai}.mp4`;
      const actDuration = 8.0; // Session 38: raised from 5.0 — viewers need time to read + process + type

      // Escape text for ffmpeg drawtext
      const declaration = (activation.declaration || "I AM AWAKENING")
        .toUpperCase()
        .replace(/'/g, "'\\''")
        .replace(/:/g, "\\:");
      const contextLine = (activation.context_line || "Type this in the comments below.")
        .replace(/'/g, "'\\''")
        .replace(/:/g, "\\:");

      try {
        // Render TTS of the context line (uses the same textToSpeech imported at top)
        const ctaAudioBuf = await textToSpeech(activation.context_line || "Type this in the comments below.", { brand: script.brand });
        const ctaAudioPath = `${sceneClipDir}/freq_activation_${ai}.mp3`;
        writeFileSync(ctaAudioPath, ctaAudioBuf);

        // Build the activation card: dark bg + context text (white, small) + declaration (gold, large)
        const fontFilter = hasFont ? `fontfile='${fontPath}':` : "";
        execSync(
          `ffmpeg -f lavfi -i "color=c=0x0a0a0f:s=${dim.width}x${dim.height}:d=${actDuration}:r=30" ` +
            `-i "${ctaAudioPath}" ` +
            `-filter_complex "` +
              `[0:v]noise=alls=2:allf=t,` +
              `drawtext=${fontFilter}text='${contextLine}':fontsize=26:fontcolor=white@0.7:x=(w-text_w)/2:y=(h*0.35):alpha='if(lt(t,1),t,if(gt(t,${actDuration - 1}),(${actDuration}-t),1))',` +
              `drawtext=${fontFilter}text='${declaration}':fontsize=64:fontcolor=0xCCA050:x=(w-text_w)/2:y=(h*0.50):alpha='if(lt(t,1.5),(t-0.5)/1.0,if(gt(t,${actDuration - 1}),(${actDuration}-t),1))',` +
              `drawtext=${fontFilter}text='\\[ TYPE THIS IN THE COMMENTS \\]':fontsize=20:fontcolor=white@0.4:x=(w-text_w)/2:y=(h*0.62):alpha='if(lt(t,2),(t-1.5)/0.5,if(gt(t,${actDuration - 1}),(${actDuration}-t),1))'[v]` +
            `" ` +
            `-map "[v]" -map 1:a -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k ` +
            `-t ${actDuration} -shortest -y "${actPath}"`,
          { timeout: 60_000, stdio: "pipe" }
        );

        // Insert at the calculated position
        const insertIdx = insertPoints[ai] + insertOffset;
        sceneClipPaths.splice(insertIdx, 0, actPath);
        clipDurations.splice(insertIdx, 0, actDuration);
        insertOffset++;
        console.log(`⚡ [FacelessFactory] Frequency Activation ${ai + 1} inserted at position ${insertIdx}: "${activation.declaration}"`);
      } catch (err: any) {
        console.warn(`⚠️ [FacelessFactory] Frequency Activation ${ai + 1} render failed (non-fatal): ${err.message?.slice(0, 200)}`);
      }
    }
  }

  // ── PRE-RENDERED BRAND OUTRO (long-form only) ──
  // Shorts = NO outro (kills algorithm retention). Long-form = outro_long.mp4 (7s)
  if (orientation === "horizontal") {
    const outroAsset = resolveBrandAsset("outro");
    const outroDuration = 7.0;
    if (existsSync(outroAsset)) {
      sceneClipPaths.push(outroAsset);
      clipDurations.push(outroDuration);
      console.log(`🎬 [FacelessFactory] Brand outro loaded: ${outroAsset} (${outroDuration}s)`);
    } else {
      // Fallback outro
      const outroPath = `${sceneClipDir}/outro_cta.mp4`;
      const outroTagline = script.brand === "containment_field" ? "THE FIELD IS OPEN" : "THE PROTOCOL AWAITS";
      try {
        execSync(
          `ffmpeg -f lavfi -i "color=c=0x0a0a0f:s=${dim.width}x${dim.height}:d=5:r=30" ` +
            `-vf "drawtext=text='${outroTagline.replace(/'/g, "'\\''").replace(/:/g, "\\:")}':fontsize=28:fontcolor=white@0.5:x=(w-text_w)/2:y=(h*0.35):alpha='min(t/1.5,1)',` +
            `drawtext=text='sovereign-synthesis.com':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h*0.48):alpha='min(t/2,1)'" ` +
            `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -y "${outroPath}"`,
          { timeout: 30_000, stdio: "pipe" }
        );
        sceneClipPaths.push(outroPath);
        clipDurations.push(5.0);
        console.log(`🎬 [FacelessFactory] Fallback outro generated (brand assets not found)`);
      } catch (err: any) {
        console.warn(`[FacelessFactory] Outro generation failed (non-fatal): ${err.message?.slice(0, 150)}`);
      }
    }
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

  // ── SESSION 46 PHASE 4: Residual Drift Safety Clamp ──
  // With the xfade-compensated cumulative frame map above, the post-xfade
  // total should equal audioDuration to the frame. This clamp now catches
  // only residual drift (e.g. if segmentDurations underreports the true TTS
  // length for some reason), not the old (N-1)*xfadeDuration shortfall.
  // Threshold lowered from 2.0s to 0.5s: anything bigger is a real bug
  // worth surfacing loudly.
  if (usedXfade) {
    try {
      const videoDurStr = execSync(
        `ffprobe -v error -show_entries format=duration -of csv=p=0 "${xfadedPath}"`,
        { timeout: 10_000, stdio: "pipe" }
      ).toString().trim();
      const videoDur = parseFloat(videoDurStr) || 0;
      const gap = audioDuration - videoDur;
      if (gap > 0.5) {
        // Video is significantly shorter than audio — extend last scene
        console.warn(`⚠️ [FacelessFactory] Video/audio desync detected: video=${videoDur.toFixed(1)}s, audio=${audioDuration.toFixed(1)}s, gap=${gap.toFixed(1)}s. Extending last scene.`);
        const lastIdx = sceneClipPaths.length - 1;
        const lastClip = sceneClipPaths[lastIdx];
        const extendedPath = `${sceneClipDir}/scene_extended_last.mp4`;
        const newDuration = (clipDurations[lastIdx] || 10) + gap + 1.0; // +1s safety margin
        // Re-render last scene clip with extended duration (loop the last frame)
        execSync(
          `ffmpeg -stream_loop -1 -i "${lastClip}" -t ${newDuration.toFixed(2)} ` +
            `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -y "${extendedPath}"`,
          { timeout: 120_000, stdio: "pipe" }
        );
        sceneClipPaths[lastIdx] = extendedPath;
        clipDurations[lastIdx] = newDuration;

        // Re-do xfade assembly with the extended last clip
        const inputs2 = sceneClipPaths.map((p, i) => `-i "${p}"`).join(" ");
        let filterChain2 = "";
        let prevLabel2 = "[0]";
        let cumDur2 = clipDurations[0] || 0;
        for (let i = 1; i < sceneClipPaths.length; i++) {
          const offset = cumDur2 - (i * xfadeDuration);
          const outLabel = i === sceneClipPaths.length - 1 ? "[vout]" : `[v${i}]`;
          filterChain2 += `${prevLabel2}[${i}]xfade=transition=fade:duration=${xfadeDuration}:offset=${Math.max(0, offset).toFixed(2)}${outLabel}; `;
          prevLabel2 = outLabel;
          cumDur2 += clipDurations[i] || 0;
        }
        filterChain2 = filterChain2.replace(/;\s*$/, "");
        execSync(
          `ffmpeg ${inputs2} -filter_complex "${filterChain2}" -map "[vout]" ` +
            `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -y "${xfadedPath}"`,
          { timeout: 300_000, stdio: "pipe" }
        );
        console.log(`✅ [FacelessFactory] Desync fix applied: last scene extended by ${(gap + 1.0).toFixed(1)}s`);
      }
    } catch (err: any) {
      console.warn(`[FacelessFactory] Desync safety check failed (non-fatal): ${err.message?.slice(0, 200)}`);
    }
  }

  // ── LEGACY HOOK OVERLAY: DISABLED ──
  // Previously: burned a wrapped white drawtext over the first 3s of the final composition.
  // That overlay was designed to ride on top of the static brand logo intro.
  // The Terminal Override clip (built above) IS the new opening visual — green typewriter
  // reveal on black. Stacking the legacy white overlay on top would create two competing
  // text layers fighting for the same eye-line. Killed entirely.
  // hookOverlay stays as an empty string so the existing filter_complex string concat below
  // keeps working without further surgery.
  const hookOverlay = "";

  // ── PHASE 2: DYNAMIC KINETIC CAPTIONS (.ass) ──
  // If a caption file was generated upstream (from Groq Whisper word-level timestamps),
  // burn it into the video via ffmpeg's subtitles filter. The .ass styling (Bebas Neue,
  // bold, centered, opaque-box plate, visible pop-in) is baked into the file itself.
  //
  // ffmpeg's subtitles filter is a libass wrapper. The filename must be escaped carefully:
  //   : → \:     (filter arg separator)
  //   , → \,     (filter chain separator)
  //   \ → \\     (escape char)
  //   ' → \'     (single-quote)
  //
  // Session 47 HARD FIX — BULLETPROOF FONT PATH:
  //   libass falls back silently to Arial when it can't find the declared font (Bebas Neue).
  //   That's exactly what happened in the last local Windows run. We now pass `fontsdir=`
  //   pointing at brand-assets/ (where BebasNeue-Regular.ttf lives) so libass loads the
  //   font from the repo regardless of OS font registry state. Works on Linux, macOS, Windows.
  let captionFilter = "";
  if (assCaptionPath && existsSync(assCaptionPath)) {
    const escapePath = (p: string): string =>
      p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
    const escaped = escapePath(assCaptionPath);
    // brand-assets/ is the single source of truth for Bebas Neue + music + stingers.
    // Resolved relative to this compiled file so it works from dist/ and tsx both.
    const fontsDir = `${__dirname}/../../brand-assets`;
    const escapedFontsDir = escapePath(fontsDir);
    captionFilter = `,subtitles='${escaped}':fontsdir='${escapedFontsDir}'`;
    console.log(
      `🎬 [FacelessFactory] Kinetic captions will be burned in from ${assCaptionPath} (fontsdir=${fontsDir})`
    );
  }

  // ── BACKGROUND MUSIC BED ──
  // Session 37 REWRITE: ALL synthetic audio generation (sine, aevalsrc, anoisesrc) is DEAD.
  // Loop REAL static MP3 files from brand-assets/ using stream_loop.
  // NICHE-AWARE music selection: picks the right emotional bed for the content.
  //   music_urgent.mp3     → dark_psychology, burnout (ticking cadence, forward momentum)
  //   music_sovereign.mp3  → ace_richie self_improvement, quantum (melodic, uplifting)
  //   ambient_drone.mp3    → default fallback (containment_field, general)
  const musicPath = `${FACELESS_DIR}/${jobId}_music_bed.mp3`;
  let hasMusicBed = false;

  // Music selection map: brand + niche → file. Most specific match wins.
  const MUSIC_MAP: Record<string, string> = {
    // Niche overrides (strongest signal)
    "dark_psychology":  "music_urgent.mp3",
    "burnout":          "music_urgent.mp3",
    // Brand + niche combos
    "ace_richie:self_improvement": "music_sovereign.mp3",
    "ace_richie:quantum":         "music_sovereign.mp3",
    "ace_richie:brand":           "music_sovereign.mp3",
    // Brand-level defaults
    "ace_richie":           "music_sovereign.mp3",
    "containment_field":    "ambient_drone.mp3",
  };

  function selectMusicFile(brand: Brand, niche: string): string {
    // Try most-specific first: brand:niche → niche → brand → fallback
    return MUSIC_MAP[`${brand}:${niche}`]
      || MUSIC_MAP[niche]
      || MUSIC_MAP[brand]
      || "ambient_drone.mp3";
  }

  try {
    const brandAssetsDir = `${__dirname}/../../brand-assets`;
    const selectedFile = selectMusicFile(script.brand, script.niche);
    const musicSource = `${brandAssetsDir}/${selectedFile}`;

    if (!existsSync(musicSource)) {
      console.warn(`⚠️ [FacelessFactory] Music file not found: ${selectedFile} — video will have NO music bed.`);
    } else {
      const musicDuration = Math.ceil(audioDuration) + 4;

      // stream_loop -1 = infinite loop. -t caps to exact duration needed.
      // afade in 3s at start, fade out 4s at end — smooth cinematic envelope.
      execSync(
        `ffmpeg -stream_loop -1 -i "${musicSource}" ` +
          `-af "afade=t=in:st=0:d=3,afade=t=out:st=${Math.max(0, musicDuration - 4)}:d=4" ` +
          `-t ${musicDuration} -c:a libmp3lame -b:a 128k -y "${musicPath}"`,
        { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }
      );

      hasMusicBed = existsSync(musicPath);
      if (hasMusicBed) {
        console.log(`🎵 [FacelessFactory] Music bed: ${musicDuration}s looped from ${selectedFile} (${script.brand}/${script.niche})`);
      } else {
        console.error(`❌ [FacelessFactory] Music bed file not created despite no error`);
      }
    }
  } catch (err: any) {
    console.error(`❌ [FacelessFactory] Music bed generation FAILED: ${err.message?.slice(0, 400)}`);
    const stderr = err.stderr ? err.stderr.toString().slice(0, 500) : "(no stderr)";
    console.error(`  STDERR: ${stderr}`);
  }

  // ── TRANSITION STINGS — Session 33 ──
  // Short brand-derived audio hit at each segment boundary.
  // Creates a single "sting track" with silence + stings at the right offsets.
  // Source: 1.5s slice of brand signature, pitched down with reverb tail.
  const stingPath = `${FACELESS_DIR}/${jobId}_sting_track.mp3`;
  let hasStingTrack = false;

  try {
    const brandAssetsDir = `${__dirname}/../../brand-assets`;
    const brandSuffix = script.brand === "containment_field" ? "_tcf" : "";
    const stingSource = `${brandAssetsDir}/signature_short${brandSuffix}.mp3`;

    if (existsSync(stingSource) && segmentDurations && segmentDurations.length > 2) {
      // Generate a 1.5s processed sting from the brand signature
      const rawStingPath = `${FACELESS_DIR}/${jobId}_sting_raw.mp3`;
      execSync(
        `ffmpeg -i "${stingSource}" -af "` +
          `atrim=start=0:end=1.5,` +
          `asetrate=44100*0.85,aresample=44100,` +  // pitch down ~15%
          `lowpass=f=2000,` +
          `afade=t=in:st=0:d=0.1,afade=t=out:st=0.8:d=0.7,` +
          `aecho=0.8:0.7:40|80:0.3|0.2,` +  // reverb tail
          `volume=0.7" ` +
        `-t 1.5 -c:a libmp3lame -b:a 128k -y "${rawStingPath}"`,
        { timeout: 15_000, maxBuffer: 5 * 1024 * 1024 }
      );

      // Calculate segment boundary timestamps (cumulative durations)
      // Skip first boundary (that's the intro) and last (outro handles it)
      const boundaries: number[] = [];
      let cumulative = 0;
      for (let i = 0; i < segmentDurations.length; i++) {
        cumulative += segmentDurations[i] || 0;
        // Place sting at boundaries between content segments (not after intro, not at very end)
        if (i > 0 && i < segmentDurations.length - 1) {
          boundaries.push(cumulative);
        }
      }

      if (boundaries.length > 0 && existsSync(rawStingPath)) {
        // Build adelay filter: duplicate sting for each boundary, delay each to its offset
        const stingInputs = boundaries.map(() => `-i "${rawStingPath}"`).join(" ");
        const delayFilters = boundaries.map((t, idx) => {
          const ms = Math.round(t * 1000);
          return `[${idx}:a]adelay=${ms}|${ms},volume=0.6[s${idx}]`;
        }).join(";");
        const mixLabels = boundaries.map((_, idx) => `[s${idx}]`).join("");
        const mixFilter = `${delayFilters};${mixLabels}amix=inputs=${boundaries.length}:duration=longest:normalize=0[stings]`;

        execSync(
          `ffmpeg ${stingInputs} -filter_complex "${mixFilter}" ` +
            `-map "[stings]" -t ${Math.ceil(audioDuration) + 4} -c:a libmp3lame -b:a 128k -y "${stingPath}"`,
          { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }
        );

        hasStingTrack = existsSync(stingPath);
        if (hasStingTrack) {
          console.log(`🔔 [FacelessFactory] Transition stings: ${boundaries.length} hits at [${boundaries.map(t => t.toFixed(0) + "s").join(", ")}]`);
        }
      }
      try { unlinkSync(rawStingPath); } catch {}
    }
  } catch (err: any) {
    console.warn(`⚠️ [FacelessFactory] Transition sting generation failed (non-fatal): ${err.message?.slice(0, 300)}`);
    hasStingTrack = false;
  }

  // Build the final assembly command:
  // If xfade succeeded, use the pre-crossfaded video file.
  // If concat fallback, use the concat list.
  // Either way: apply color grade + hook overlay → mix audio.

  // Video input source: xfaded file or concat list
  const videoInput = usedXfade
    ? `-i "${xfadedPath}"`
    : `-f concat -safe 0 -i "${concatListPath}"`;

  // Audio mixing: voice + music bed + transition stings (3-layer audio)
  // Session 33: Raised music bed from 0.15 (inaudible) to 0.35
  // Session 33: Added transition sting track as third audio layer
  // Session 42: Architect-locked EQ — drone must feel HEAVY and present.
  //   - volume 0.35 → 0.85 (~+8dB perceptual)
  //   - removed lowpass=f=800 (was muffling the drone, killing presence)
  //   - added bass=g=3 (low-end body without clipping the voice channel)
  const inputCount = 1 + (hasMusicBed ? 1 : 0) + (hasStingTrack ? 1 : 0); // after video(0) + voice(1)
  let audioFilter = "";
  let musicInput = "";
  let audioMap = `-map 1:a`; // default: just voice

  if (hasMusicBed && hasStingTrack) {
    // 3-layer: voice(1) + music(2) + stings(3)
    musicInput = `-i "${musicPath}" -i "${stingPath}" `;
    audioFilter = `[1:a]volume=1.0[voice];[2:a]volume=0.85,bass=g=3[bg];[3:a]volume=0.5[stings];[voice][bg][stings]amix=inputs=3:duration=first:normalize=0[aout]`;
    audioMap = `-map "[aout]"`;
  } else if (hasMusicBed) {
    // 2-layer: voice + music
    musicInput = `-i "${musicPath}" `;
    audioFilter = `[1:a]volume=1.0[voice];[2:a]volume=0.85,bass=g=3[bg];[voice][bg]amix=inputs=2:duration=first:normalize=0[aout]`;
    audioMap = `-map "[aout]"`;
  } else if (hasStingTrack) {
    // 2-layer: voice + stings
    musicInput = `-i "${stingPath}" `;
    audioFilter = `[1:a]volume=1.0[voice];[2:a]volume=0.5[stings];[voice][stings]amix=inputs=2:duration=first:normalize=0[aout]`;
    audioMap = `-map "[aout]"`;
  }

  try {
    execSync(
      `ffmpeg ${videoInput} -i "${audioPath}" ${musicInput}` +
        `-filter_complex "[0:v]${nicheFilter}${captionFilter}${hookOverlay}[v]${audioFilter ? ";" + audioFilter : ""}" ` +
        `-map "[v]" ${audioMap} ` +
        `-c:v libx264 -preset fast -crf 23 ` +
        `-c:a aac -b:a 192k ` +
        `-shortest -y "${outputPath}"`,
      { timeout: 600_000, stdio: "pipe" }
    );
  } catch (err: any) {
    // Fallback: no filter_complex for video — just pass through + audio mix
    console.warn(`[FacelessFactory] Color grade/hook/captions failed, trying plain assembly: ${err.message?.slice(0, 200)}`);
    // Second try: keep captions but drop niche grade + hook overlay (they're cosmetic)
    if (captionFilter) {
      try {
        execSync(
          `ffmpeg ${videoInput} -i "${audioPath}" ${musicInput}` +
            `-filter_complex "[0:v]${captionFilter.replace(/^,/, "")}[v]${audioFilter ? ";" + audioFilter : ""}" ` +
            `-map "[v]" ${audioMap} ` +
            `-c:v libx264 -preset fast -crf 23 ` +
            `-c:a aac -b:a 192k ` +
            `-shortest -y "${outputPath}"`,
          { timeout: 600_000, stdio: "pipe" }
        );
        console.warn(`[FacelessFactory] Plain-captions assembly succeeded (dropped niche grade)`);
      } catch (err2: any) {
        console.warn(`[FacelessFactory] Plain-captions assembly also failed — dropping captions: ${err2.message?.slice(0, 200)}`);
        if (audioFilter) {
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
    } else if (audioFilter) {
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
  jobId: string,
  meta?: { brand?: string; niche?: string },
  thumbnailPath?: string | null
): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  // Build human-readable storage path: faceless/ace_richie_quantum_firmware_update_1775430704664/
  const titleSlug = (script.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40).replace(/_+$/, "");
  const folderParts = [meta?.brand || "unknown", meta?.niche || "general", titleSlug].filter(Boolean);
  const folderName = folderParts.join("_") + "_" + jobId.split("_").pop();
  const storagePath = `faceless/${folderName}/${folderName}_final.mp4`;
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

    // Upload thumbnail if available
    let thumbnailUrl: string | null = null;
    if (thumbnailPath && existsSync(thumbnailPath)) {
      try {
        const thumbStoragePath = `faceless/${folderName}/${folderName}_thumbnail.jpg`;
        const thumbBuf = readFileSync(thumbnailPath);
        const thumbResp = await fetch(
          `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${thumbStoragePath}`,
          {
            method: "POST",
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              "Content-Type": "image/jpeg",
              "x-upsert": "true",
            },
            body: thumbBuf,
          }
        );
        if (thumbResp.ok) {
          thumbnailUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${thumbStoragePath}`;
          console.log(`🖼️ [FacelessFactory] Thumbnail uploaded → ${thumbnailUrl}`);
        }
      } catch (err: any) {
        console.warn(`[FacelessFactory] Thumbnail upload failed (non-fatal): ${err.message?.slice(0, 150)}`);
      }
    }

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
        thumbnail_url: thumbnailUrl,
        metadata: {
          type: "faceless",
          brand: script.brand,
          job_id: jobId,
          segment_count: script.segments.length,
          cta: script.cta,
          hook: script.hook,
          thumbnail_text: script.thumbnail_text,
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
  targetDuration: "short" | "long" = "long"
): Promise<FacelessResult> {
  // Phase 3 Task 3.4 — INTAKE GUARD. Hard-fail before any model call, disk write,
  // pod job, or R2 upload if the brand/niche pair violates the allowlist contract.
  if (!isAllowedNiche(brand, niche)) {
    const allowed = getAllowedNiches(brand);
    const violation = new BrandNicheViolation(brand, niche, allowed);
    console.error(`❌ [FacelessFactory] ${violation.message}`);
    throw violation;
  }
  niche = normalizeNiche(niche);

  const jobId = `fv_${brand}_${niche}_${Date.now()}`;
  if (!existsSync(FACELESS_DIR)) mkdirSync(FACELESS_DIR, { recursive: true });

  const orientation: Orientation = targetDuration === "long" ? "horizontal" : "vertical";

  console.log(`\n🔥 [FacelessFactory] Starting job ${jobId}`);
  console.log(`   Brand: ${brand} | Niche: ${niche} | Duration: ${targetDuration} | Orientation: ${orientation} (${DIMS[orientation].width}x${DIMS[orientation].height})`);

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 1: Generate script on Railway (LLM text gen — lightweight, stays here)
  // Phase 3 Task 3.6 uniqueness guard + 2 retries.
  // ──────────────────────────────────────────────────────────────────────────
  console.log(`📝 [FacelessFactory] Generating script...`);
  let script: Awaited<ReturnType<typeof generateScript>> | null = null;
  const MAX_UNIQUENESS_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_UNIQUENESS_RETRIES; attempt++) {
    const candidate = await generateScript(llm, sourceIntelligence, niche, brand, targetDuration, orientation);
    const corpusForCheck = [
      candidate.title,
      ...candidate.segments.map((s: any) => String(s.voiceover || s.text || "")),
    ].join("\n\n");
    try {
      await assertScriptUnique(brand, corpusForCheck);
      script = candidate;
      if (attempt > 0) {
        console.log(`✅ [FacelessFactory] Uniqueness cleared on retry ${attempt}`);
      }
      break;
    } catch (err: any) {
      if (err instanceof ScriptTooSimilarError) {
        console.warn(
          `⚠️ [FacelessFactory] Attempt ${attempt + 1}/${MAX_UNIQUENESS_RETRIES + 1} rejected: ` +
          `cosine=${err.score.toFixed(4)} match=${err.matchId}`,
        );
        if (attempt === MAX_UNIQUENESS_RETRIES) {
          console.error(`❌ [FacelessFactory] ${MAX_UNIQUENESS_RETRIES + 1} consecutive duplicates — halting.`);
          throw err;
        }
        continue;
      }
      throw err;
    }
  }
  if (!script) {
    throw new Error("FacelessFactory: script uniqueness loop exited without result");
  }
  console.log(`✅ [FacelessFactory] Script: "${script.title}" — ${script.segments.length} segments`);

  writeFileSync(`${FACELESS_DIR}/${jobId}_script.json`, JSON.stringify(script, null, 2));

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 2: DELEGATE to RunPod GPU worker — TTS + FLUX images + Ken Burns
  // composition + R2 upload all happen on the pod in a single session.
  // Railway sends the script scenes as a JobSpec; pod returns R2 artifact URLs.
  // ──────────────────────────────────────────────────────────────────────────
  console.log(`🚀 [FacelessFactory] Delegating compute to pod (XTTS + FLUX + compose + R2)...`);

  // Map script segments to pod scene format, auto-splitting any >4000 char scenes (S91)
  const rawScenes: PodScene[] = script.segments.map((seg, i) => ({
    index: i,
    image_prompt: seg.visual_direction,
    tts_text: seg.voiceover,
    duration_hint_s: seg.duration_hint || undefined,
  }));
  const podScenes = splitOversizedScenes(rawScenes);

  // Extract hook text for the pod's opening typewriter overlay (Task 5.9).
  // Prefer the script's explicit hook; fall back to first segment's voiceover.
  const hookText = (script.hook || script.segments[0]?.voiceover || "").trim();

  const podJobSpec: JobSpec = {
    brand: brand as "ace_richie" | "containment_field",
    niche,
    seed: sourceIntelligence.slice(0, 500),
    script: script.segments.map(s => s.voiceover).join("\n\n"),
    scenes: podScenes,
    hook_text: hookText || undefined,
    client_job_id: jobId,
  };

  // withPodSession handles: wake pod (or reuse warm) → run fn → schedule sleep.
  // produceVideo: POST /produce → poll /jobs/{id} until done → return artifact URLs.
  const artifacts: ArtifactUrls = await withPodSession(async (handle) => {
    return produceVideo(handle, podJobSpec);
  });

  console.log(`✅ [FacelessFactory] Pod returned artifacts:`);
  console.log(`   Video: ${artifacts.videoUrl}`);
  console.log(`   Thumbnail: ${artifacts.thumbnailUrl}`);
  console.log(`   Duration: ${artifacts.durationS.toFixed(1)}s`);

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 3: Queue R2 artifact URLs to vid_rush_queue for distribution.
  // No Supabase Storage upload needed — pod already uploaded to R2.
  // ──────────────────────────────────────────────────────────────────────────
  console.log(`📤 [FacelessFactory] Queuing R2 artifacts to vid_rush_queue...`);
  let videoUrl: string | null = artifacts.videoUrl;
  try {
    if (SUPABASE_URL && SUPABASE_KEY) {
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
          video_url: artifacts.videoUrl,
          status: "ready",
          platform: "multi",
          thumbnail_url: artifacts.thumbnailUrl,
          metadata: {
            type: "faceless",
            brand: script.brand,
            job_id: jobId,
            pod_job_id: artifacts.jobId,
            segment_count: script.segments.length,
            cta: script.cta,
            hook: script.hook,
            thumbnail_text: script.thumbnail_text,
            source: "pod_r2",
          },
        }),
      });
      console.log(`✅ [FacelessFactory] Queued to vid_rush_queue`);
    }
  } catch (err: any) {
    console.error(`[FacelessFactory] Queue error: ${err.message}`);
    videoUrl = null;
  }

  // Phase 3 Task 3.7 — persist shipped script vector for uniqueness guard
  if (videoUrl) {
    try {
      const corpusForPersist = [
        script.title,
        ...script.segments.map((s: any) => String(s.voiceover || s.text || "")),
      ].join("\n\n");
      await persistShippedScript({
        brand,
        script: corpusForPersist,
        niche,
        thesis: sourceIntelligence.slice(0, 500),
        jobId,
        youtubeUrl: videoUrl,
        extra: {
          duration: artifacts.durationS,
          segments: script.segments.length,
          orientation,
          target_duration: targetDuration,
          pod_job_id: artifacts.jobId,
        },
      });
    } catch (persistErr: any) {
      console.warn(`[FacelessFactory] persistShippedScript non-fatal: ${persistErr?.message}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 4: Download R2 video to local temp. The orchestrator needs this for
  // shorts-curator ffmpeg extraction (Phase 5 Task 5.5) and the YouTube
  // publisher for long-form upload. Kept intentionally.
  // ──────────────────────────────────────────────────────────────────────────
  let localVideoPath = "";
  try {
    console.log(`⬇️ [FacelessFactory] Downloading R2 video for local compat...`);
    const dlResp = await fetch(artifacts.videoUrl);
    if (dlResp.ok) {
      const buf = Buffer.from(await dlResp.arrayBuffer());
      localVideoPath = `${FACELESS_DIR}/${jobId}_final.mp4`;
      writeFileSync(localVideoPath, buf);
      console.log(`✅ [FacelessFactory] Downloaded ${(buf.length / 1024 / 1024).toFixed(1)}MB → ${localVideoPath}`);
    } else {
      console.warn(`⚠️ [FacelessFactory] R2 download failed: ${dlResp.status} — shorts extraction will be skipped`);
    }
  } catch (dlErr: any) {
    console.warn(`⚠️ [FacelessFactory] R2 download failed (non-fatal): ${dlErr.message?.slice(0, 200)}`);
  }

  // SESSION 83: Download R2 thumbnail for YouTube custom thumbnail upload.
  // Previously swallowed errors silently — thumbnail was abandoned every run.
  let localThumbPath: string | null = null;
  if (artifacts.thumbnailUrl) {
    try {
      console.log(`⬇️ [FacelessFactory] Downloading R2 thumbnail...`);
      const thumbResp = await fetch(artifacts.thumbnailUrl);
      if (thumbResp.ok) {
        const thumbBuf = Buffer.from(await thumbResp.arrayBuffer());
        // SESSION 85: Was _thumbnail.jpg — cleanupJobFiles only preserves _longform_thumb.jpg.
        // Old name got deleted before YouTube upload could consume it → gray placeholder.
        localThumbPath = `${FACELESS_DIR}/${jobId}_longform_thumb.jpg`;
        writeFileSync(localThumbPath, thumbBuf);
        console.log(`🖼️ [FacelessFactory] Thumbnail downloaded (${(thumbBuf.length / 1024).toFixed(0)}KB) → ${localThumbPath}`);
      } else {
        console.warn(`⚠️ [FacelessFactory] R2 thumbnail download failed: ${thumbResp.status}`);
      }
    } catch (thumbErr: any) {
      console.error(`⚠️ [FacelessFactory] R2 thumbnail download error: ${thumbErr.message?.slice(0, 200)}`);
    }
  } else {
    console.warn(`⚠️ [FacelessFactory] No thumbnail URL in artifacts — YouTube will use auto-frame`);
  }

  cleanupJobFiles(jobId, true);

  console.log(`\n🔥 [FacelessFactory] JOB COMPLETE — ${jobId}`);
  console.log(`   Title: ${script.title}`);
  console.log(`   Duration: ${artifacts.durationS.toFixed(1)}s`);
  console.log(`   Segments: ${script.segments.length}`);
  console.log(`   Video URL: ${videoUrl || "queue failed"}`);
  console.log(`   Thumbnail URL: ${artifacts.thumbnailUrl}`);

  // SESSION 91 FIX: Use ACTUAL video duration divided evenly across segments
  // instead of LLM duration_hint guesses. The hints were 25-45s/segment while
  // real TTS audio is often 10-20s — inflated estimates caused the shorts
  // curator to reject every clip as "too long" (>175s cap). Pod only returns
  // total duration, not per-scene, so even distribution is the best estimate.
  const actualPerSeg = artifacts.durationS / script.segments.length;
  const segDurations = script.segments.map(() => actualPerSeg);

  return {
    videoUrl,
    localPath: localVideoPath,
    thumbnailPath: localThumbPath,
    title: script.title,
    niche,
    brand,
    duration: artifacts.durationS,
    segmentCount: script.segments.length,
    script,
    segmentDurations: segDurations,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BATCH PRODUCTION: produceFacelessBatch()
// Produces multiple videos from one source (both brands)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function produceFacelessBatch(
  llm: LLMProvider,
  sourceIntelligence: string,
  niche: string,
  brands: Brand[] = ["ace_richie", "containment_field"]
): Promise<FacelessResult[]> {
  const results: FacelessResult[] = [];

  for (const brand of brands) {
    try {
      const result = await produceFacelessVideo(llm, sourceIntelligence, niche, brand, "long");
      results.push(result);
    } catch (err: any) {
      console.error(`[FacelessFactory] Failed for ${brand}: ${err.message}`);
    }
  }

  return results;
}
