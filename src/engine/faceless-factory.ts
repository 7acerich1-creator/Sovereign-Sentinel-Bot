// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — FACELESS VIDEO FACTORY
// Deterministic faceless video production pipeline:
//   1. LLM generates voiceover script from source intelligence
//   2. ElevenLabs/OpenAI TTS renders audio
//   3. Gemini Imagen 4 generates scene images (PRIMARY) → Pollinations.ai fallback → DALL-E 3 fallback
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
import { generateCaptionsFromAudio } from "./caption-engine";
import type { LLMProvider } from "../types";

export const FACELESS_DIR = "/tmp/faceless_factory";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const STORAGE_BUCKET = "public-assets";

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

interface FacelessResult {
  videoUrl: string | null;
  thumbnailUrl?: string | null;
  thumbnailPath?: string | null;  // Deployment 3: local path to long-form keyframe thumbnail for YouTube thumbnails.set
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

const SCRIPT_VOICE: Record<Brand, string> = {
  ace_richie: `You are writing a voiceover script for a faceless video on the Sovereign Synthesis channel (Ace Richie).

CORE MISSION — THE SOVEREIGN EXCHANGE:
This channel deploys a firmware update for human consciousness. The viewer trades their old, inherited programming for sovereign architecture. Every video must leave them with ONE piece of that architecture they didn't have before — not motivation, not inspiration, ARCHITECTURE. A tool. A framework. A lens that permanently changes how they see reality.

URGENCY THREAD (hardcode into EVERY video):
Humanity is in active evolution RIGHT NOW. AI is accelerating this shift exponentially. The people who refuse to update their internal operating system aren't just "falling behind" — they are becoming obsolete in real time. This is not future tense. This is not hypothetical. The gap between the sovereign and the sleeping is widening every single day, and most people can feel it but can't name it. YOUR JOB IS TO NAME IT.

DUAL-LAYER ENCODING (critical):
Layer 1 — PLAIN ENGLISH (for the uninitiated): Always FIRST. Name the feeling they already carry but can't articulate. "You feel like you're running someone else's program." "The rules you followed were designed for a game that no longer exists." "Everyone around you is optimizing for a world that's already gone." This is the door. No jargon. Just the precise articulation of a truth they've been holding alone.
Layer 2 — SOVEREIGN LEXICON (for the initiated): AFTER the plain-English truth lands, give it its upgraded name. The feeling of being stuck isn't just "being stuck" — it's running legacy firmware. The world feeling fake isn't paranoia — it's pattern recognition of The Simulation's parameters. The lexicon REPLACES their old language with something more precise. That's the exchange.

LEXICON (deploy naturally after plain-English setup): Firmware Update, Escape Velocity, The Simulation, Protocol 77, Biological Drag, Sovereign Synthesis, System Mastery Architecture.

VOICE: Sovereign, direct, zero-fear. You speak as someone who cracked the code and is handing the blueprint to the next person. Bold but warm, authoritative but approachable. You carry urgency without panic — the energy of someone who sees the wave coming and is calmly showing people how to ride it.

STRUCTURE: HOOK (name the feeling they can't articulate — plain English, 3 seconds) → PIVOT (reveal the hidden mechanism — dark psychology insight transmuted into sovereignty tool) → EXCHANGE (give them the architecture — one piece of the sovereign framework they can USE) → ANCHOR (consciousness hook linking to Protocol 77, urgency call forward).

The voiceover should sound like a human speaking — conversational, with natural pauses. NOT like reading an essay. NOT like a motivational speech. Like someone telling you something urgent and real over a quiet table.`,

  containment_field: `You are writing a voiceover script for a faceless video on The Containment Field channel.

VOICE: Dark, clinical, anonymous. Intelligence analyst exposing hidden architecture of control. Detached but magnetic — like a declassified briefing. You don't motivate. You REVEAL.

THEMES: Dopamine extraction, manipulation defense, hidden power structures, cognitive warfare, pattern recognition.

STRUCTURE: HOOK (unsettling fact, cold open) → PIVOT (clinical mechanism breakdown) → ANCHOR (defense protocol, one actionable countermeasure).

The voiceover should sound measured and low-cadence — like a whistleblower reading a classified report. NOT dramatic.`
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
const IMAGEN_NEGATIVE_BAN =
  "no silhouettes, no abstract representations, no symbolic figures, no sacred geometry, " +
  "no wireframe holograms, no HUD overlays, no code rain, no glitch effects, no particle tendrils, " +
  "no generic digital art, no AI-art gradient smoothness, no plastic skin, no symmetrical perfection, " +
  "no neon cyberpunk, no cartoon, no illustration, no 3D render look, no Midjourney fever dream, " +
  "no throne-room fantasy, no epic-cinematic gloss";

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
  const brandContext = brand === "ace_richie"
    ? "Sovereign Synthesis (Ace Richie) — sovereign, zero-fear, cracked-the-code energy"
    : "The Containment Field — dark, clinical, intelligence-analyst exposing hidden control systems";

  const blueprintPrompt = `You are a narrative architect for a faceless YouTube documentary channel: ${brandContext}.

You have raw transcript material from a source video. Your job is NOT to summarize it. Your job is to EXTRACT THE DEEPEST TRUTH from it and architect an ORIGINAL narrative around that truth.

Think like a documentary filmmaker: What is the ONE powerful thesis buried in this material? What story does it tell about human nature, power, psychology, or consciousness?

URGENCY CONTEXT (weave into every blueprint):
We are in an active evolutionary moment. AI and exponential technological shifts are widening the gap between the sovereign and the sleeping DAILY. The people who feel "stuck" or "behind" aren't imagining it — their internal operating system is outdated and the world around them is updating faster than they are. This channel exists to deliver the architectural codes for the upgrade. Every video must carry this urgency — not as fear, but as factual observation that demands action NOW.

RAW SOURCE MATERIAL (use as INSPIRATION only — do NOT copy phrases or structure):
${sourceIntelligence.slice(0, 2500)}

NICHE: ${niche.replace(/_/g, " ")}
${titleBanList}

Extract a narrative blueprint as JSON:
{
  "thesis": "The ONE bold claim the entire video argues (1 sentence, provocative, specific — NOT generic like 'mindset matters'). Must connect to the urgency of NOW — why this matters TODAY, not someday.",
  "title": "A UNIQUE punchy video title (max 60 chars, pattern-interrupt energy). Must create curiosity gap or bold claim. MUST be completely different from any previously used titles listed above.",
  "hook": "The first 2 sentences spoken — must NAME A FEELING the viewer already has but can't articulate. Plain English, no jargon. A STATEMENT that makes them think 'how does this person know exactly what I'm experiencing?' Open loop energy.",
  "narrative_arc": "3-act summary: ACT 1 (name the feeling — plain English, what they already sense is wrong) → ACT 2 (reveal the mechanism — the hidden architecture behind the feeling, why the old rules no longer work) → ACT 3 (deliver the exchange — give them one piece of sovereign architecture that replaces the old programming, tie to the urgency of acting NOW)",
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
    return {
      thesis: "The system you're operating in was designed before you were born — and it was never designed for you to win.",
      title: "The Architecture Nobody Told You About",
      hook: "Everything you were taught about success is an instruction manual for someone else's dream. And the worst part... you've been following it perfectly.",
      narrative_arc: "ACT 1: Surface truth everyone accepts → ACT 2: Hidden mechanisms of control → ACT 3: The sovereign alternative",
      key_arguments: ["The default path is engineered", "Compliance is rewarded, not capability", "The exit exists but is hidden", "Awareness is the first step", "Sovereignty requires active architecture"],
      emotional_journey: "comfortable → unsettled → angry → empowered → sovereign"
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
  targetDuration: "short" | "long" = "short",
  orientation: Orientation = "vertical"
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
  "title": "UNIQUE CTR-optimized title (max 60 chars) — curiosity gap, emotional trigger, or bold claim. MUST be different from ALL previously used titles.${recentTitles.length > 0 ? " BANNED (already used): " + recentTitles.slice(0, 5).map(t => `'${t}'`).join(", ") : ""}",
  "hook": "${blueprint.hook}",
  "thumbnail_text": "2-5 words ALL CAPS that STOP the scroll. This is the TEXT that goes ON the thumbnail image. Think: 'BREAK THE BLOCK', 'YOU WERE CHOSEN', 'SYSTEM FAILURE', 'THEY LIED TO YOU'. Must create instant curiosity or emotional reaction in under 1 second.",
  "thumbnail_visual": "Thumbnail-specific visual: ONE real tangible human subject in ONE real specific room shot on ARRI Alexa 65 with 35mm prime, Kodak Vision3 500T, practical tungsten or window light, visible skin texture. HBO prestige drama still. HIGH CONTRAST. NO silhouettes, NO sacred geometry, NO AI-art gloss.",
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
      const activationPrompt = `You are writing 2 FREQUENCY ACTIVATION moments for a documentary-style video.

These are NOT calls to action. These are CONSCIOUSNESS ACTIVATION DECLARATIONS — moments where the viewer makes a sovereign declaration of their own awakening. Like accepting a frequency code.

VIDEO CONTEXT:
- Title: "${parsed.title}"
- Thesis: "${blueprint.thesis}"
- Niche: ${niche.replace(/_/g, " ")}

For each activation, write:
1. A "context_line" — what the narrator says to set up the moment (1 sentence, builds anticipation)
2. A "declaration" — what the viewer types in the comments (short, powerful, first-person, present tense)

EXAMPLES of great declarations:
- "I am starting to see."
- "I am aligning."
- "I accept this frequency."
- "The code is activating."
- "I am no longer running their program."
- "My firmware is updating."

RULES:
- Declarations must be TOPIC-SPECIFIC — tied to THIS video's thesis, not generic
- First-person, present tense ONLY ("I am..." / "I choose..." / "I see...")
- Max 8 words per declaration — punchy, declarative, sovereign
- The context_line should frame it as an energy exchange: "If you feel this truth resonating..." or "Those who are ready will know..."
- NO begging ("please subscribe"), NO manipulation ("smash that like button") — this is FREQUENCY ALIGNMENT

Return as JSON array:
[
  { "context_line": "narrator setup line", "declaration": "I AM DECLARATION" },
  { "context_line": "narrator setup line", "declaration": "I AM DECLARATION" }
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
        parsed.frequency_activations = [
          { context_line: "If this truth is resonating with something deep inside you... type these words in the comments right now.", declaration: "I AM STARTING TO SEE" },
          { context_line: "Those who are ready will feel this. Declare it below.", declaration: "MY FREQUENCY IS SHIFTING" },
        ];
      }
    } catch (err: any) {
      console.warn(`⚠️ [FacelessFactory] Frequency Activation generation failed: ${err.message?.slice(0, 150)}`);
      parsed.frequency_activations = [
        { context_line: "If this truth is resonating with something deep inside you... type these words in the comments right now.", declaration: "I AM STARTING TO SEE" },
        { context_line: "Those who are ready will feel this. Declare it below.", declaration: "MY FREQUENCY IS SHIFTING" },
      ];
    }

  } else {
    // ── SHORT-FORM: Single pass, tighter prompt ──
    const shortPrompt = `${voice}

You have source material to draw INSPIRATION from (do NOT copy it):
${sourceIntelligence.slice(0, 2500)}

Write a ${durationRange} voiceover script for a ${niche.replace(/_/g, " ")} faceless short. ONE powerful idea, not a summary.

Generate as JSON:
{
  "title": "UNIQUE CTR-optimized title (max 60 chars) — curiosity gap or bold claim. MUST be different from all previously used titles.${recentTitles.length > 0 ? " BANNED: " + recentTitles.slice(0, 5).map(t => `'${t}'`).join(", ") : ""}",
  "hook": "Opening line that stops the scroll — a STATEMENT, not a question",
  "thumbnail_text": "2-5 words ALL CAPS for thumbnail overlay — instant emotional hit at 120x68px",
  "thumbnail_visual": "ONE real specific tangible subject in ONE real room. ARRI Alexa 65, 35mm, Kodak Vision3 500T, practical tungsten lighting, visible skin texture, HBO prestige drama still. NO silhouettes, NO sacred geometry, NO AI-art gloss.",
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

  // QUALITY GATE (Session 23/32/40): Enforce minimum segment count for long-form.
  // Session 40: Target raised to 16 segments. Quality gate at 10 (was 8).
  if (targetDuration === "long" && segments.length < 10) {
    console.warn(`⚠️ [FacelessFactory] Only ${segments.length} segments (need 10+). Attempting segment expansion...`);
    // Don't retry the whole LLM call (costs time + tokens) — instead, expand what we have.
    // Take each short segment and ask the LLM to elaborate it into 2 segments.
    const expansionNeeded = Math.max(10 - segments.length, 3);
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
  const thumbFinalPath = `${FACELESS_DIR}/${jobId}_thumbnail.jpg`;

  const thumbnailText = (script.thumbnail_text || script.title || "")
    .toUpperCase()
    .replace(/[^\w\s!?]/g, "")  // Strip special chars that break drawtext
    .slice(0, 30);               // Hard cap

  if (!thumbnailText) {
    console.warn(`[FacelessFactory] No thumbnail text generated, skipping thumbnail`);
    return null;
  }

  // ── Generate base image via Imagen 4 ──
  // Thumbnail-specific prompt: HIGH CONTRAST, single focal point, NO text in image
  const thumbStyle = brand === "containment_field"
    ? "Hyper-realistic documentary still from a prestige thriller, ARRI Alexa 65, 35mm prime, f/2.0, Kodak Vision3 500T film emulation, single cold practical light source (desk lamp, monitor, window) motivated in-frame, tangible real human subject with visible skin texture and imperfections, real cluttered interior with tangible props, shallow depth of field, 16:9 landscape, large empty dark area left or right third for text overlay"
    : "Hyper-realistic documentary still from a prestige HBO drama, ARRI Alexa 65, 35mm prime, f/2.0, Kodak Vision3 500T film emulation, single warm practical tungsten source motivated in-frame, tangible real human subject with visible skin texture stubble and breath, real physical room with real props, amber/gold (#d4a843) warm key with deep natural shadow fall-off, shallow depth of field, 16:9 landscape, large empty dark area left or right third for text overlay";

  const thumbVisual = script.thumbnail_visual || "a weathered man in his late 30s sitting alone at a worn wooden table, single tungsten bulb overhead, hands wrapped around a chipped ceramic coffee mug, visible stubble, tangible skin texture";
  const thumbPrompt = `${thumbStyle}. Scene: ${thumbVisual}. Absolutely NO text, NO words, NO letters, NO writing, NO watermarks.\n\nNEGATIVE: ${IMAGEN_NEGATIVE_BAN}`;

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

  // Gold text (#d4a843) with dark border, positioned right-of-center for maximum impact
  // Font size 120 for line 1, 110 for line 2 (if exists)
  let textFilters = `drawtext=${fontFilter}text='${escapeDT(line1)}':fontsize=120:fontcolor=0xd4a843:borderw=5:bordercolor=0x0a0a0f:x=(w*0.05):y=(h*0.35)`;

  if (line2) {
    textFilters += `,drawtext=${fontFilter}text='${escapeDT(line2)}':fontsize=110:fontcolor=0xd4a843:borderw=5:bordercolor=0x0a0a0f:x=(w*0.05):y=(h*0.55)`;
  }

  // Add subtle teal accent line under the text
  textFilters += `,drawbox=x=iw*0.05:y=${line2 ? "ih*0.72" : "ih*0.55"}:w=iw*0.35:h=4:c=0x00e5c7@0.8:t=fill`;

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
// DEPLOYMENT 3: Long-Form YouTube Thumbnail (keyframe-based)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Port of the Session 39 short-form ffmpeg thumbnail technique, adapted for 1920x1080
// long-form YouTube assets. Does NOT call Imagen — the cost is zero, the failure surface
// is pure ffmpeg, and the visual is guaranteed to be on-brand because it IS a frame from
// the finished video.
//
// Pipeline:
//   1. Seek to the middle of the finished long-form video (high-contrast narrative beat)
//   2. Scale + crop to canonical 1920x1080
//   3. vignette=PI/4 for depth
//   4. drawbox @ 60% opacity across the lower-middle band (text plate)
//   5. drawtext Bebas Neue (white, thick black border) with the video title on the bar
//
// Output is preserved past cleanupJobFiles so the orchestrator can feed it to the
// YouTube Data API thumbnails.set endpoint.
async function generateLongFormThumbnail(
  videoPath: string,
  script: FacelessScript,
  jobId: string,
  _brand: Brand
): Promise<string | null> {
  if (!existsSync(videoPath)) {
    console.warn(`[FacelessFactory] Long-form video missing for thumbnail: ${videoPath}`);
    return null;
  }

  const thumbPath = `${FACELESS_DIR}/${jobId}_longform_thumb.jpg`;

  // Probe duration so we can seek to the actual middle of the final video
  let durationSec = 0;
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
      { timeout: 10_000, stdio: "pipe" }
    ).toString().trim();
    durationSec = parseFloat(out) || 0;
  } catch { /* non-fatal — fall through with 0 */ }

  // Middle keyframe. Clamp to at least 1s in case probe fails or video is tiny.
  const seekSec = Math.max(1, (durationSec || 60) / 2).toFixed(2);

  // Title text: prefer explicit thumbnail_text (scroll-stopper hook from script gen),
  // fall back to full title. Normalize for drawtext (strip hostile punctuation).
  const rawTitle = (script.thumbnail_text || script.title || "").trim();
  const titleText = rawTitle
    .toUpperCase()
    .replace(/[^\w\s!?'-]/g, "")
    .slice(0, 60);

  // Wrap into max 2 lines for readability at 1920x1080 thumbnail scale
  const words = titleText.split(/\s+/).filter(Boolean);
  let line1 = titleText;
  let line2 = "";
  if (words.length > 4) {
    const mid = Math.ceil(words.length / 2);
    line1 = words.slice(0, mid).join(" ");
    line2 = words.slice(mid).join(" ");
  }

  const thumbTextFile = `${FACELESS_DIR}/${jobId}_longform_thumb_text.txt`;
  try {
    // Session 38 lesson: never pass long strings through shell quoting; write to file + textfile=
    writeFileSync(thumbTextFile, line2 ? `${line1}\n${line2}` : line1);
  } catch (err: any) {
    console.warn(`[FacelessFactory] Long-form thumb text-file write failed: ${err.message?.slice(0, 150)}`);
  }

  const brandAssetsDir = `${__dirname}/../../brand-assets`;
  const fontPath = `${brandAssetsDir}/BebasNeue-Regular.ttf`;
  const hasFont = existsSync(fontPath);
  const fontFilter = hasFont ? `fontfile='${fontPath}':` : "";

  // Visual grammar:
  //   - Bar occupies ih*0.62 → ih*0.84 (lower-middle third), keeps keyframe subject's head-room
  //   - Black @ 60% opacity = the 60% architect spec
  //   - Bebas Neue white + 4px black border = guaranteed legibility on any keyframe
  //   - fontsize scales down when we had to wrap to two lines so nothing clips the bar
  const barY = "ih*0.62";
  const barH = "ih*0.22";
  const fontSize = line2 ? 88 : 120;
  // Single-line: vertical-center on bar. Two-line: nudge up so both lines fit inside the bar.
  const textY = line2 ? `ih*0.645` : `(h-text_h)/2+ih*0.23`;

  const textOverlay = titleText
    ? `,drawtext=${fontFilter}textfile='${thumbTextFile.replace(/'/g, "'\\''")}':fontsize=${fontSize}:fontcolor=white:borderw=4:bordercolor=black@0.85:x=(w-text_w)/2:y=${textY}:line_spacing=10`
    : "";

  // Single-filter-chain (not filter_complex) because we have one video stream and output one frame.
  const vf =
    `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,` +
    `eq=contrast=1.1:brightness=-0.02:saturation=1.05,` + // subtle pop for 120x68 render
    `vignette=PI/4,` +
    `drawbox=x=0:y=${barY}:w=iw:h=${barH}:c=black@0.6:t=fill` +
    textOverlay;

  try {
    execSync(
      `ffmpeg -ss ${seekSec} -i "${videoPath}" -frames:v 1 -vf "${vf}" -q:v 2 -y "${thumbPath}"`,
      { timeout: 20_000, stdio: "pipe" }
    );
    if (existsSync(thumbPath)) {
      const size = readFileSync(thumbPath).length;
      if (size > 1000) {
        console.log(
          `🖼️ [FacelessFactory] Long-form keyframe thumbnail rendered: "${titleText || "(untitled)"}" ` +
          `(${(size / 1024).toFixed(0)}KB @ ${seekSec}s)`
        );
        return thumbPath;
      }
    }
  } catch (err: any) {
    console.warn(`[FacelessFactory] Long-form thumbnail generation failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  return null;
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
  const prompt = `${stylePrefix} Scene: ${visualDirection}\n\nNEGATIVE: ${IMAGEN_NEGATIVE_BAN}`;
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
    const sanitizedHook = rawFirstSentence
      .replace(/[^A-Z0-9 .,!?\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60); // Cap at 60 chars to keep the drawtext chain manageable.

    if (sanitizedHook.length > 0) {
      // Hook duration: prefer actual first-segment TTS duration when available, clamped 3-5s.
      // Falls back to 4.0s for shorts (no per-segment timing).
      const firstSegDur = segmentDurations?.[0];
      terminalOverrideDuration = Math.min(
        5.0,
        Math.max(3.0, firstSegDur && firstSegDur > 0 ? firstSegDur : 4.0)
      );

      const terminalClipPath = `${sceneClipDir}/_terminal_override.mp4`;
      const typingAudioPath = `${brandAssetsDir}/typing.mp3`;
      const hasTyping = existsSync(typingAudioPath);

      // Build word-chunk reveal drawtext chain — one filter per revealed word group.
      //
      // SESSION 46 FIX: Previously built ONE drawtext filter PER CHARACTER (up to 60
      // chained drawtexts + 60 temp textfiles). That was fragile on Alpine ffmpeg —
      // the chain was too long, too many open textfiles, and when ffmpeg errored the
      // stderr banner consumed all captured output so we could never see why (the
      // old `.slice(0, 400)` on stderr captured only the ffmpeg banner, never the
      // actual error at the tail of stderr).
      //
      // New approach: accumulate WORDS instead of chars. A 60-char hook is typically
      // 8-12 words → 8-12 drawtext filters. Preserves the typewriter "reveal" feel
      // (each word pops in on beat) while cutting filter count and textfile count
      // ~6x. Each filter still writes its substring to a temp file (Session 38 lesson:
      // textfile= bypasses shell quoting hell for apostrophes/quotes/etc.).
      const words = sanitizedHook.split(" ").filter((w) => w.length > 0);
      const stepCount = words.length;
      const charCount = sanitizedHook.length; // preserved for the log line below
      const stepInterval = terminalOverrideDuration / Math.max(stepCount, 1);
      const drawFilters: string[] = [];

      for (let i = 1; i <= stepCount; i++) {
        const substr = words.slice(0, i).join(" ");
        const revealFile = `${sceneClipDir}/_term_${i.toString().padStart(3, "0")}.txt`;
        writeFileSync(revealFile, substr);
        // ffmpeg drawtext textfile value is single-quote-delimited inside filter_complex.
        // Paths here are ASCII-safe (/app/faceless/<jobId>_scenes/_term_NNN.txt), so the
        // only special char to worry about is ':' which needs a backslash escape.
        const escRevealPath = revealFile.replace(/:/g, "\\:");
        const startTime = ((i - 1) * stepInterval).toFixed(3);
        const endTime =
          i === stepCount
            ? terminalOverrideDuration.toFixed(3)
            : (i * stepInterval).toFixed(3);
        const fontfileFilter = hasFont ? `fontfile='${fontPath}':` : "";
        // Bright terminal green (#00FF88) on pure black, sharp black border for crispness.
        // Font size scales to orientation: larger on horizontal (1920w), smaller on vertical (1080w).
        const fsize = orientation === "horizontal" ? 64 : 56;
        drawFilters.push(
          `drawtext=${fontfileFilter}textfile='${escRevealPath}':fontsize=${fsize}:fontcolor=0x00FF88:borderw=2:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,${startTime},${endTime})'`
        );
      }

      const drawtextChain = drawFilters.join(",");

      // Audio: typing.mp3 looped to hookDuration with subtle fades. Falls back to silence.
      const audioInputFlags = hasTyping
        ? `-stream_loop -1 -t ${terminalOverrideDuration.toFixed(2)} -i "${typingAudioPath}"`
        : `-f lavfi -t ${terminalOverrideDuration.toFixed(2)} -i "anullsrc=channel_layout=stereo:sample_rate=44100"`;

      try {
        // Defensive: refuse to invoke ffmpeg with an empty filter chain — it would
        // emit a cryptic filter-parse error and waste a ffmpeg startup.
        if (drawFilters.length === 0) {
          throw new Error("no words after sanitization — skipping Terminal Override render");
        }
        execSync(
          `ffmpeg -f lavfi -t ${terminalOverrideDuration.toFixed(2)} -i "color=c=black:s=${dim.width}x${dim.height}:r=${fps}" ` +
            `${audioInputFlags} ` +
            `-filter_complex "[0:v]${drawtextChain}[v];[1:a]volume=0.55,afade=t=in:st=0:d=0.2,afade=t=out:st=${Math.max(0, terminalOverrideDuration - 0.4).toFixed(2)}:d=0.4[a]" ` +
            `-map "[v]" -map "[a]" ` +
            `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p ` +
            `-c:a aac -b:a 128k ` +
            `-y "${terminalClipPath}"`,
          { timeout: 90_000, stdio: "pipe" }
        );

        if (existsSync(terminalClipPath)) {
          sceneClipPaths.push(terminalClipPath);
          clipDurations.push(terminalOverrideDuration);
          terminalOverrideRendered = true;
          console.log(
            `⌨️  [FacelessFactory] Terminal Override hook rendered: "${sanitizedHook.slice(0, 60)}" (${terminalOverrideDuration.toFixed(1)}s, ${stepCount} words / ${charCount} chars, typing=${hasTyping})`
          );
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
        const ctaAudioBuf = await textToSpeech(activation.context_line || "Type this in the comments below.");
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
    const outroAsset = `${brandAssetsDir}/outro_long${brandSuffix}.mp4`;
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
  let audioPath = audioResult.audioPath;

  // STEP 2b: Mix Terminal Override typewriter bed + outro signature into the TTS track.
  //
  // SESSION 42 ARCHITECTURAL REWRITE:
  //   Old behavior: prepended a 2-6s static brand-logo intro video AND delayed the TTS by
  //   introPad seconds, then mixed signature_long.mp3 over that pad. This was destroying
  //   retention — viewers saw a static logo for 5 seconds before any payload arrived.
  //
  //   New behavior:
  //     • TTS plays at t=0 (NO adelay, NO introPad).
  //     • typing.mp3 is mixed UNDER the first hookDuration seconds at low volume — this is
  //       the audio bed for the Terminal Override clip rendered in assembleVideo() (the
  //       green typewriter on black). The visual hook IS the video's first segment.
  //     • signature_outro.mp3 is mixed in at t=ttsDur (after the voiceover finishes).
  //     • signature_long / signature_short are NO LONGER prepended — the static-logo intro
  //       is dead.
  //     • segmentDurations is NOT modified; segment 0 IS the hook.
  const brandAssetsRoot = `${__dirname}/../../brand-assets`;
  const brandSfx = brand === "containment_field" ? "_tcf" : "";
  const outroSig = `${brandAssetsRoot}/signature_outro${brandSfx}.mp3`;
  const typingBed = `${brandAssetsRoot}/typing.mp3`;

  // Hook duration mirrors the assembleVideo Terminal Override calculation:
  // clamp segmentDurations[0] to [3.0, 5.0]; default 4.0 if missing.
  const firstSegDurForHook = audioResult.segmentDurations?.[0] || 0;
  const hookDuration = Math.min(5.0, Math.max(3.0, firstSegDurForHook > 0 ? firstSegDurForHook : 4.0));

  const compositeAudioPath = `${FACELESS_DIR}/${jobId}_composite_audio.mp3`;
  try {
    const hasOutro = existsSync(outroSig);
    const hasTyping = existsSync(typingBed);

    if (hasOutro || hasTyping) {
      // Get TTS duration
      const ttsDur = parseFloat(
        execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`,
          { timeout: 10_000, maxBuffer: 1024 * 1024 }).toString().trim()
      ) || 0;

      if (ttsDur > 0) {
        // Build inputs and filter graph dynamically based on what assets we have.
        // Index 0 is always the TTS voice. Typing and outro are appended as available.
        const inputs: string[] = [`-i "${audioPath}"`];
        const filterParts: string[] = [`[0:a]volume=1.0[voice]`];
        const mixLabels: string[] = [`[voice]`];
        let inputIdx = 1;

        if (hasTyping) {
          // Loop the typing bed so it always covers the hook window even if it's short.
          inputs.push(`-stream_loop -1 -t ${hookDuration.toFixed(2)} -i "${typingBed}"`);
          // Bed it under the hook: low volume, fade in fast, fade out before hook ends.
          const fadeOutStart = Math.max(0, hookDuration - 0.4);
          filterParts.push(
            `[${inputIdx}:a]volume=0.35,afade=t=in:st=0:d=0.15,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=0.4[typing]`
          );
          mixLabels.push(`[typing]`);
          inputIdx++;
        }

        if (hasOutro) {
          inputs.push(`-i "${outroSig}"`);
          const outroOffsetMs = Math.round(ttsDur * 1000);
          filterParts.push(`[${inputIdx}:a]adelay=${outroOffsetMs}|${outroOffsetMs},volume=0.85[outro]`);
          mixLabels.push(`[outro]`);
          inputIdx++;
        }

        const totalMixInputs = mixLabels.length;
        const mixFilter = `${mixLabels.join("")}amix=inputs=${totalMixInputs}:duration=longest:normalize=0[out]`;
        const filterComplex = `${filterParts.join(";")};${mixFilter}`;

        execSync(
          `ffmpeg ${inputs.join(" ")} ` +
            `-filter_complex "${filterComplex}" ` +
            `-map "[out]" -c:a libmp3lame -b:a 192k -y "${compositeAudioPath}"`,
          { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }
        );
        console.log(
          `🔊 [FacelessFactory] Composite audio: TTS(${ttsDur.toFixed(1)}s)` +
            (hasTyping ? ` + typing-bed(${hookDuration.toFixed(1)}s)` : "") +
            (hasOutro ? ` + outro@${ttsDur.toFixed(1)}s` : "")
        );
      }

      if (existsSync(compositeAudioPath)) {
        audioPath = compositeAudioPath;
        // NOTE: segmentDurations is INTENTIONALLY NOT modified.
        // The Terminal Override is segment 0 — the visual is generated FROM segmentDurations[0],
        // not in addition to it. Prepending introPad here would double-count the hook.
        console.log(`🔊 [FacelessFactory] Audio track now includes typing bed + outro signature`);
      }
    }
  } catch (err: any) {
    console.error(`⚠️ [FacelessFactory] Signature audio mixing failed (non-fatal, using raw TTS): ${err.message?.slice(0, 300)}`);
    const stderr = err.stderr ? err.stderr.toString().slice(0, 300) : "";
    if (stderr) console.error(`  STDERR: ${stderr}`);
  }

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

  // STEP 3b: Generate thumbnail (runs while scene images are fresh in Imagen quota)
  console.log(`🖼️ [FacelessFactory] Generating thumbnail...`);
  let thumbnailPath: string | null = null;
  try {
    thumbnailPath = await generateThumbnail(script, jobId, brand, niche);
  } catch (err: any) {
    console.warn(`⚠️ [FacelessFactory] Thumbnail generation failed (non-fatal): ${err.message?.slice(0, 200)}`);
  }

  // STEP 3c: Dynamic Kinetic Captions — transcribe the raw TTS narration with Groq Whisper
  // (word-level timestamps) and emit a styled .ass file. Non-fatal: a caption failure must
  // never kill a render. skipUntilSeconds hides captions during the Terminal Override hook
  // so they don't collide with the typewriter drawtext reveal on segment 0.
  let assCaptionPath: string | null = null;
  try {
    console.log(`🎬 [FacelessFactory] Generating kinetic captions (Groq Whisper word-level)...`);
    const dims = DIMS[orientation];
    const capResult = await generateCaptionsFromAudio(audioResult.audioPath, {
      outputPath: `${FACELESS_DIR}/${jobId}_captions.ass`,
      videoWidth: dims.width,
      videoHeight: dims.height,
      skipUntilSeconds: hookDuration,
      maxWordsPerChunk: 3,
      maxChunkDuration: 1.5,
      fontName: "Bebas Neue",
    });
    assCaptionPath = capResult.assPath;
    console.log(
      `✅ [FacelessFactory] Captions: ${capResult.chunkCount} chunks from ${capResult.wordCount} words ` +
      `(${capResult.firstWordStart.toFixed(2)}s → ${capResult.lastWordEnd.toFixed(2)}s)`
    );
  } catch (err: any) {
    console.warn(
      `⚠️ [FacelessFactory] Caption generation failed (non-fatal, video will render uncaptioned): ${err.message?.slice(0, 300)}`
    );
    assCaptionPath = null;
  }

  // STEP 4: Assemble video
  console.log(`🎬 [FacelessFactory] Assembling video...`);
  const videoPath = await assembleVideo(script, audioPath, imagePaths, jobId, orientation, audioResult.segmentDurations, assCaptionPath);

  // STEP 4b (Deployment 3): For long-form (16:9), replace the Imagen-based thumbnail
  // with a keyframe pulled from the middle of the finished video. This guarantees:
  //   1. Zero Imagen spend on the thumbnail path (billing crisis insurance)
  //   2. Brand-coherence (thumb IS a frame from the actual video, not a synthetic still)
  //   3. YouTube always gets a custom thumbnail instead of auto-picking a generic frame
  //
  // The Imagen thumbnail is kept as a fallback: if keyframe generation fails,
  // `thumbnailPath` stays whatever Step 3b produced. Shorts (vertical) still use the
  // Imagen path since the vidrush orchestrator handles per-clip thumbnails separately.
  if (orientation === "horizontal") {
    try {
      const keyframeThumb = await generateLongFormThumbnail(videoPath, script, jobId, brand);
      if (keyframeThumb) {
        thumbnailPath = keyframeThumb;
      }
    } catch (err: any) {
      console.warn(`⚠️ [FacelessFactory] Long-form keyframe thumbnail failed (keeping Imagen fallback): ${err.message?.slice(0, 200)}`);
    }
  }

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
  const videoUrl = await uploadAndQueue(videoPath, script, jobId, { brand, niche }, thumbnailPath);

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
    thumbnailPath, // Deployment 3: long-form keyframe thumbnail (or Imagen fallback) for YouTube thumbnails.set
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
      const result = await produceFacelessVideo(llm, sourceIntelligence, niche, brand, "short");
      results.push(result);
    } catch (err: any) {
      console.error(`[FacelessFactory] Failed for ${brand}: ${err.message}`);
    }
  }

  return results;
}
