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
//
// S103 Cleanup: ~1,700 lines of dead local rendering code removed. The old
// assembleVideo(), generateSceneImage(), generateThumbnail(), MUSIC_MAP,
// SCENE_VISUAL_STYLE, NICHE_FILTERS, and uploadAndQueue() were all legacy
// pre-pod code that nothing called anymore. Pod is the sole renderer now.
//
// This is the 95% engine — creates ORIGINAL content from extracted intelligence.
// The clip ripper (vid-rush.ts) handles the 5% where Ace is on camera.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { resolve as resolvePath } from "path";
import { config } from "../config";
import { textToSpeech } from "../voice/tts";

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
  "thumbnail_text": "A 3-6 word MEMETIC TRIGGER in ALL CAPS. This is a protest sign, a wall graffiti tag, a punch to the chest. It must be a COMPLETE STANDALONE STATEMENT — a stranger reads it on a wall and feels something WITHOUT any other context. Write it as a declaration, a command, or a revelation. Examples by category — REVELATIONS: 'THEY DESIGNED YOUR CAGE', 'YOUR MEMORIES ARE INSTALLED', 'REALITY HAS A OWNER'. COMMANDS: 'DELETE YOUR OLD SELF', 'STOP BUILDING THEIR DREAM', 'BURN THE INSTRUCTION MANUAL'. CONFRONTATIONS: 'NOBODY IS COMING FOR YOU', 'YOUR COMFORT IS THE TRAP', 'YOU WERE NEVER FREE'. Pick the category that hits hardest for THIS topic. Every word must carry weight. The phrase must be FINISHED — if someone reads it, they understand the full thought instantly.",
  "thumbnail_visual": "A MOVIE POSTER frame, not a movie still. HIGH CONTRAST, 50% of the frame dark/empty for text. Pick ONE: (A) EXTREME face close-up — eyes filling the frame, single hard light source, rest pitch black, visible skin texture, intensity in the gaze. (B) SINGLE powerful object against darkness — a shattered mirror, a burning letter, a key in a lock, a door cracked open with blinding white light behind it — rim-lit or glowing, everything else black. (C) Abstract energy — golden particles swirling in void, electric arcs, volumetric god-rays cutting through pure darkness. Frame it like a Fincher title card or a Saul Bass poster.",
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
  "thumbnail_text": "A 3-6 word MEMETIC TRIGGER in ALL CAPS. Write a protest sign — a complete standalone statement a stranger reads on a wall and FEELS something with zero context. DECLARATIONS: 'THEY DESIGNED YOUR CAGE', 'YOUR COMFORT IS THE TRAP'. COMMANDS: 'DELETE YOUR OLD SELF', 'BURN THE INSTRUCTION MANUAL'. REVELATIONS: 'NOBODY IS COMING FOR YOU', 'YOUR MEMORIES ARE INSTALLED'. Every word carries weight. The thought is FINISHED.",
  "thumbnail_visual": "A MOVIE POSTER frame. HIGH CONTRAST, 50% dark/empty for text. Pick ONE: (A) EXTREME face close-up — eyes filling the frame, single hard light, rest pitch black. (B) SINGLE powerful object against darkness — shattered mirror, burning letter, door cracked open with blinding light behind it. (C) Abstract energy — golden particles in void, electric arcs, god-rays cutting through darkness. Frame it like a Fincher title card.",
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
// STEP 1B: STANDALONE SHORTS GENERATOR (Session 102)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Generates 4 completely independent short scripts from source intelligence.
// Each short is a COMPLETE STORY with its own hook, premise, and payoff.
// NOT chopped from long-form. NOT referencing a "full video."
// This replaces the shorts-curator for new production.

/** A standalone short script ready for TTS + pod rendering. */
export interface StandaloneShort {
  /** Script — same FacelessScript shape, 5 segments, 30-60s target. */
  script: FacelessScript;
  /** CTA overlay text burned into last 3s of the rendered short. */
  cta_overlay: string;
  /** Vertical scene prompts for native 9:16 rendering. */
  vertical_scenes: { index: number; image_prompt: string; duration_s: number }[];
}

const STANDALONE_CTA: Record<Brand, string> = {
  ace_richie: "The protocol is live — @ace_richie77",
  containment_field: "Exit the field — @TheContainmentField",
};

/**
 * Generate 4 standalone short scripts from source intelligence.
 * Each is a complete, self-contained story — no reference to a long-form video.
 */
export async function generateStandaloneShorts(
  llm: LLMProvider,
  sourceIntelligence: string,
  niche: string,
  brand: Brand,
): Promise<StandaloneShort[]> {
  const voice = SCRIPT_VOICE[brand];
  const channelCta = STANDALONE_CTA[brand] || STANDALONE_CTA.ace_richie;
  const recentTitles = await getRecentTitles(20);
  const titleBan = recentTitles.length > 0
    ? `\nBANNED TITLES (already used): ${recentTitles.slice(0, 10).map(t => `"${t}"`).join(", ")}`
    : "";

  const prompt = `${voice}

You have source material to draw INSPIRATION from (do NOT copy it):
${sourceIntelligence.slice(0, 8000)}

NICHE: ${niche.replace(/_/g, " ")}
${titleBan}

Write EXACTLY 4 standalone YouTube Shorts scripts. Each short is a COMPLETE, SELF-CONTAINED story — a viewer who has never seen ANY other content from this channel must understand and be hooked by EACH short independently.

RULES:
1. Each short = 5 segments, 30-60 seconds total spoken. ONE powerful idea with setup → twist → payoff.
2. Each short MUST have a DIFFERENT thesis/angle from the others. Mine 4 distinct veins from the source material.
3. The hook (segment 1) must stop the scroll in 3 seconds — a bold statement, a named feeling, or a pattern interrupt. NOT "Imagine..." or "Let me tell you..."
4. Each short MUST resolve its own premise. No open loops, no "but that's not all," no cliffhangers pointing elsewhere.
5. Write ORIGINAL content. The source is inspiration, not a script to rewrite.
6. Visual directions must describe concrete physical scenes — real people, real rooms, real objects. NOT abstract symbolism.
7. FORMAT: VERTICAL 9:16 (all visual compositions for portrait framing).
8. duration_hint per segment ~6-12s, total ~40-55s.

VISUAL DNA v3 (HBO prestige documentary):
Every visual_direction describes a concrete real scene — a real person doing a real thing in a real room with real props and a real motivated practical light source. Shot on ARRI Alexa 65, 35mm prime, f/2.0, Kodak Vision3 500T, tangible skin texture.
HARD BANS: silhouette, sacred geometry (unless ace_richie brand), cosmic void, abstract particles, chains shattering into light, wireframe holograms, stock-photo poses.

BANNED PHRASES: "Imagine...", "But here's the thing...", "Now pay attention...", "Let that sink in", "Think about it", "Here's the truth", "Are you ready?"

Return ONLY a JSON array of 4 objects (no markdown, no explanation):
[
  {
    "title": "Short title (max 50 chars, scroll-stopping)",
    "hook": "First spoken line — the scroll stopper",
    "segments": [
      { "voiceover": "2-4 spoken sentences (30-50 words)", "visual_direction": "9:16 portrait scene description", "duration_hint": 10 }
    ],
    "cta": "Organic closing line (1 sentence, sovereign tone)",
    "thumbnail_text": "3-5 word ALL CAPS memetic trigger",
    "thumbnail_visual": "Movie poster 9:16 composition"
  }
]

Each object must have exactly 5 segments. Highest-impact short first.`;

  console.log(`🎬 [StandaloneShorts] Generating 4 standalone shorts for ${brand} / ${niche}...`);

  // Retry up to 2 times on parse failure
  let shorts: any[] | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const temp = attempt === 1 ? 0.8 : 0.5;
    const response = await llm.generate(
      [{ role: "user", content: prompt }],
      { maxTokens: 6144, temperature: temp },
    );
    const raw = response.content.trim();

    // Extract JSON array
    let jsonStr: string | null = null;
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    if (!jsonStr) {
      const firstBracket = raw.indexOf("[");
      const lastBracket = raw.lastIndexOf("]");
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        jsonStr = raw.slice(firstBracket, lastBracket + 1);
      }
    }
    if (!jsonStr) jsonStr = raw;

    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        shorts = parsed;
        break;
      }
    } catch (err) {
      console.error(`[StandaloneShorts] JSON parse failed (attempt ${attempt}): ${jsonStr?.slice(0, 200)}`);
    }
    if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
  }

  if (!shorts || shorts.length === 0) {
    console.error(`[StandaloneShorts] ❌ All parse attempts failed — returning 0 shorts`);
    return [];
  }

  // Validate and build StandaloneShort objects
  const results: StandaloneShort[] = [];
  for (let i = 0; i < Math.min(shorts.length, 4); i++) {
    const s = shorts[i];
    if (!s.segments || !Array.isArray(s.segments) || s.segments.length === 0) {
      console.warn(`[StandaloneShorts] Short ${i} has no segments, skipping`);
      continue;
    }

    const segments: ScriptSegment[] = s.segments.map((seg: any) => ({
      voiceover: String(seg.voiceover || ""),
      visual_direction: String(seg.visual_direction || "dark atmospheric portrait scene"),
      duration_hint: Math.max(Number(seg.duration_hint) || 8, 5),
    }));

    const script: FacelessScript = {
      title: String(s.title || `Standalone Short ${i + 1}`),
      niche,
      brand,
      hook: String(s.hook || segments[0]?.voiceover?.split(".")[0] || ""),
      segments,
      cta: String(s.cta || "The protocol is at sovereign-synthesis.com"),
      thumbnail_text: String(s.thumbnail_text || ""),
      thumbnail_visual: String(s.thumbnail_visual || ""),
    };

    // Build vertical scenes from segment visual directions
    const vertical_scenes = segments.map((seg, idx) => ({
      index: idx,
      image_prompt: `9:16 portrait cinematic composition. ${seg.visual_direction}. Shot on 35mm kodak portra 400, f/2.8 shallow depth of field, chiaroscuro lighting, tangible texture`,
      duration_s: seg.duration_hint,
    }));

    results.push({
      script,
      cta_overlay: channelCta,
      vertical_scenes,
    });

    console.log(`  📎 Short ${i}: "${script.title}" — ${segments.length} segs, ~${segments.reduce((a, s) => a + s.duration_hint, 0)}s`);
  }

  console.log(`🎬 [StandaloneShorts] ${results.length} standalone shorts generated for ${brand}`);
  return results;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STEP 2: Render TTS Audio from Script
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface AudioRenderResult {
  audioPath: string;
  /** Per-segment durations in seconds (voiceover + trailing silence/chapter pad).
   *  Length matches the number of actual TTS segments rendered.
   *  Used by the pod renderer to align scene visuals with speech timing. */
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
  // This tells the pod renderer exactly how long each scene should display,
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
    // SESSION 99 FIX: Was missing — pod returns raw TTS narration URL but it
    // never reached the orchestrator. Shorts always used the rendered long-form
    // audio (with music already baked in) instead of clean TTS. Now the
    // orchestrator can download clean narration and tell the pod to mix its
    // own music bed at the right level for vertical format.
    rawNarrationUrl: artifacts.rawNarrationUrl,
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
