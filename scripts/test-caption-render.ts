// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 2 — DYNAMIC KINETIC CAPTION VERIFICATION HARNESS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Minimal local render pipeline that bypasses LLM script generation
// and Supabase upload so Ace can audit:
//   1. Corporate Noir Imagen 4 stills (suit in crowd / empty boardroom / burned document)
//   2. Adam Brooding HIGH EMOTION ElevenLabs narration
//   3. Groq Whisper word-level kinetic captions (.ass)
//   4. Final assembled mp4 with Bebas Neue + deep drop-plate + 80ms pop-in
//
// REQUIRED ENV (set in .env or shell):
//   ELEVENLABS_API_KEY  — Adam Brooding TTS
//   GEMINI_IMAGEN_KEY   — Imagen 4 scene stills
//   GROQ_API_KEY        — Whisper large-v3 word-level timestamps
//
// RUN (from repo root, Windows or Linux):
//   npx tsx scripts/test-caption-render.ts
//
// OUTPUT:
//   ./test-out/test_caption_<timestamp>.mp4
//   ./test-out/test_caption_<timestamp>.ass
//
// NOTE ON BEBAS NEUE:
//   libass renders the .ass file against the system fontconfig. If Bebas Neue
//   is not installed, the captions will fall back to a generic sans. To install:
//     Windows: double-click brand-assets/BebasNeue-Regular.ttf → "Install"
//     Linux:   sudo cp brand-assets/BebasNeue-Regular.ttf /usr/share/fonts/ && fc-cache -f
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Load .env FIRST before any module reads process.env
import "dotenv/config";

import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  statSync,
} from "fs";
import { resolve, basename } from "path";

import {
  renderAudio,
  assembleVideo,
  FACELESS_DIR,
  DIMS,
  type FacelessScript,
} from "../src/engine/faceless-factory";
import { generateCaptionsFromAudio } from "../src/engine/caption-engine";

// ─────────────────────────────────────────────────────────────
// PRE-FLIGHT: verify required secrets are present
// ─────────────────────────────────────────────────────────────
const REQUIRED_ENV = [
  "ELEVENLABS_API_KEY",
  "GEMINI_IMAGEN_KEY",
  "GROQ_API_KEY",
] as const;

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error("\n❌ MISSING ENV VARS:");
  for (const k of missing) console.error(`   - ${k}`);
  console.error("\nAdd them to .env or export them in your shell before running.\n");
  process.exit(1);
}

// SESSION 106: TTS is XTTS-only. No ElevenLabs/Edge to configure.

// ─────────────────────────────────────────────────────────────
// OUTPUT PATHS
// ─────────────────────────────────────────────────────────────
const REPO_ROOT = resolve(__dirname, "..");
const TEST_OUT_DIR = resolve(REPO_ROOT, "test-out");
if (!existsSync(TEST_OUT_DIR)) mkdirSync(TEST_OUT_DIR, { recursive: true });
if (!existsSync(FACELESS_DIR)) mkdirSync(FACELESS_DIR, { recursive: true });

const JOB_ID = `test_caption_${Date.now()}`;

// ─────────────────────────────────────────────────────────────
// HARDCODED SCRIPT — dark_psychology × containment_field × short
// Three segments + CTA, ~45s narration, ~100 words per segment.
// Bypasses the LLM step entirely — zero Claude/Groq text-gen cost.
// ─────────────────────────────────────────────────────────────
const SCRIPT: FacelessScript = {
  title: "The Contract You Never Signed",
  niche: "dark_psychology",
  brand: "containment_field",
  hook: "They hand you the simulation at birth and tell you it's reality.",
  segments: [
    {
      voiceover:
        "Every system you operate inside was designed before you arrived. " +
        "The rules. The schedule. The currency. The definition of success. " +
        "You did not negotiate any of it. " +
        "You inherited a contract written in a language you were never taught to read.",
      visual_direction:
        "A single man in a perfectly tailored charcoal three-piece suit walking directly toward camera " +
        "through a dense, fast-moving rush-hour crowd on a dimly lit city street. The crowd rendered " +
        "as heavy motion blur streaks. The central figure in razor focus, face obscured or turned " +
        "three-quarters away, tangible fabric weave on the suit lapel, wristwatch catching a glint. " +
        "Stark amber-gold volumetric key light raking from frame-left through atmospheric haze. " +
        "Deep crushed obsidian black negative space. Heavy chiaroscuro. " +
        "Documentary realism in the cinematography of Succession and Michael Clayton. " +
        "The feeling is quiet predatory calm inside chaos — isolation as power, not sadness.",
      duration_hint: 12,
    },
    {
      voiceover:
        "Most people spend their entire lives performing inside the contract without ever questioning it. " +
        "They confuse motion with progress. They confuse survival with sovereignty. " +
        "The real architects do not live inside the contract. " +
        "They stand in the room where the contract is signed. And they wait.",
      visual_direction:
        "Wide cinematic interior of a pristine, empty corporate boardroom at 4am. A single long polished " +
        "walnut table with twelve unoccupied Eames executive chairs. One chair at the head pushed " +
        "slightly back as if someone just stood up. A single crystal tumbler of amber whiskey and a " +
        "closed leather folio left on the table. Floor-to-ceiling windows behind showing a blurred " +
        "rain-streaked nightscape of a financial district skyline far below. The room illuminated only " +
        "by a single warm amber-gold pendant light hanging low over the center of the table. " +
        "Deep chiaroscuro — corners dissolving into crushed void black. " +
        "Tangible wood grain rendered at forensic macro where the light catches it. " +
        "Cinematography of Oppenheimer and The Godfather Part II. " +
        "Feeling: aftermath, revelation, consequence. Power already exercised.",
      duration_hint: 12,
    },
    {
      voiceover:
        "The moment you refuse the inherited contract is the moment the architecture becomes visible. " +
        "You stop asking for permission. You start writing terms. " +
        "And the old firmware, the one that ran you for decades, begins to burn.",
      visual_direction:
        "Extreme close-up of a pair of weathered masculine hands holding the charred remnant of a single " +
        "sheet of thick cotton paper. Edges blackened and still glowing cherry-red at the burn line. " +
        "Curls of smoke rising in volumetric amber-gold god-rays. Tiny embers drifting upward. " +
        "Skin rendered with forensic pore and knuckle detail. " +
        "A heavy signet ring on one finger catching a single specular amber highlight. " +
        "Background is crushed obsidian void black with a narrow hard rim light from camera-right " +
        "carving the hands out of the darkness. Extreme shallow depth of field — only the burn line " +
        "and the fingertips in razor focus, the rest dissolving into creamy bokeh. " +
        "Documentary realism in the cinematography of Oppenheimer and Tinker Tailor Soldier Spy. " +
        "Tangible human stakes — no fantasy, no sci-fi, no abstraction.",
      duration_hint: 12,
    },
  ],
  cta:
    "The Containment Field is not a community. It is a frequency. " +
    "If you recognized yourself in this transmission, you were already inside.",
  thumbnail_text: "THE CONTRACT",
  thumbnail_visual: "A single burned document held in weathered hands, amber god-rays, chiaroscuro.",
};

// ─────────────────────────────────────────────────────────────
// IMAGEN 4 — direct HTTP call with Corporate Noir BASE_STYLE
// Bypasses production generateSceneImage which still points at the
// legacy SCENE_VISUAL_STYLE table. Uses the aesthetic Ace approved
// in scripts/test-imagen.ts (suit in crowd / empty boardroom / burned document).
// ─────────────────────────────────────────────────────────────
const BASE_STYLE =
  "Shot on ARRI Alexa 65 with 35mm anamorphic prime lens at f/1.4, " +
  "anamorphic lens flare streaking horizontally, " +
  "Kodak Vision3 500T film emulation with visible film grain, " +
  "extreme shallow depth of field with creamy organic bokeh, " +
  "aggressive high-contrast chiaroscuro with deep void blacks and crushed shadows, " +
  "stark single-source practical key light, " +
  "volumetric light rays cutting through atmospheric haze, " +
  "hyper-tangible surface textures rendered with forensic macro sharpness, " +
  "cinematic color grading in the tradition of Roger Deakins and Hoyte van Hoytema, " +
  "9:16 vertical aspect ratio, prestige cinema still frame, not photography";

const NEGATIVE_BAN =
  "no stock photography, no sad man drinking coffee, no corporate headshot, " +
  "no lifestyle photography, no generic environmental shots, no fantasy, no sci-fi, " +
  "no glowing circuitry, no giant eyes, no abstract metaphors, " +
  "NO text, NO letters, NO words, NO writing, NO watermarks, NO signage, " +
  "NO UI overlays, NO HUD elements, NO subtitles, NO captions, " +
  "no cartoon, no illustration, no 3D render, no CGI, no video game graphics";

async function callImagen4(prompt: string, apiKey: string): Promise<Buffer> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`;
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
  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`Imagen 4 HTTP ${res.status}: ${errTxt.slice(0, 400)}`);
  }
  const data = (await res.json()) as any;
  const b64 =
    data.predictions?.[0]?.bytesBase64Encoded ||
    data.predictions?.[0]?.image?.bytesBase64Encoded;
  if (!b64) throw new Error("Imagen 4: no image bytes in response");
  return Buffer.from(b64, "base64");
}

function buildImagenPrompt(visualDirection: string): string {
  return `${visualDirection}\n\nCAMERA & FILM: ${BASE_STYLE}.\n\nNEGATIVE: ${NEGATIVE_BAN}`;
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  console.log("━".repeat(60));
  console.log(`PHASE 2 CAPTION RENDER TEST — jobId: ${JOB_ID}`);
  console.log("━".repeat(60));
  console.log(`Brand:   ${SCRIPT.brand}`);
  console.log(`Niche:   ${SCRIPT.niche}`);
  console.log(`Segments: ${SCRIPT.segments.length} + CTA`);
  console.log(`Output:   ${TEST_OUT_DIR}`);
  console.log("");

  const geminiKey = process.env.GEMINI_IMAGEN_KEY!;

  // ─── STEP 1: Imagen 4 scene stills (Corporate Noir) ───────
  console.log("🎨 [1/4] Generating Imagen 4 Corporate Noir scene stills...");
  const imagePaths: (string | null)[] = [];
  const totalScenes = SCRIPT.segments.length + 1; // +1 for CTA
  for (let i = 0; i < totalScenes; i++) {
    const isCTA = i === SCRIPT.segments.length;
    const visualDirection = isCTA
      ? SCRIPT.segments[SCRIPT.segments.length - 1].visual_direction
      : SCRIPT.segments[i].visual_direction;
    const prompt = buildImagenPrompt(visualDirection);
    const imgPath = `${FACELESS_DIR}/${JOB_ID}_scene_${i}.png`;
    try {
      console.log(`   scene ${i}${isCTA ? " (CTA)" : ""}: calling Imagen 4...`);
      const buf = await callImagen4(prompt, geminiKey);
      writeFileSync(imgPath, buf);
      const kb = (statSync(imgPath).size / 1024).toFixed(0);
      console.log(`   ✅ scene ${i}: ${kb}KB → ${imgPath}`);
      imagePaths.push(imgPath);
    } catch (err: any) {
      console.error(`   ❌ scene ${i} FAILED: ${err.message?.slice(0, 300)}`);
      imagePaths.push(null);
    }
  }
  const validCount = imagePaths.filter((p) => p !== null).length;
  if (validCount === 0) {
    throw new Error("Zero scene images generated — cannot proceed");
  }
  console.log(`✅ [1/4] Imagen 4: ${validCount}/${totalScenes} scenes generated\n`);

  // ─── STEP 2: ElevenLabs Adam Brooding HIGH EMOTION TTS ────
  console.log("🗣️  [2/4] Rendering narration (ElevenLabs Adam Brooding HIGH EMOTION)...");
  const audioResult = await renderAudio(SCRIPT, JOB_ID);
  console.log(`✅ [2/4] Narration: ${audioResult.audioPath}`);
  console.log(`   segmentDurations: [${audioResult.segmentDurations.map((d) => d.toFixed(2)).join(", ")}]s\n`);

  // ─── STEP 3: Groq Whisper word-level → .ass kinetic captions ──
  console.log("🎬 [3/4] Generating kinetic captions (Groq Whisper word-level)...");
  const dims = DIMS.vertical;
  const capResult = await generateCaptionsFromAudio(audioResult.audioPath, {
    outputPath: `${FACELESS_DIR}/${JOB_ID}_captions.ass`,
    videoWidth: dims.width,
    videoHeight: dims.height,
    skipUntilSeconds: 0, // no Terminal Override intro in this harness
    maxWordsPerChunk: 3,
    maxChunkDuration: 1.5,
    fontName: "Bebas Neue",
  });
  console.log(
    `✅ [3/4] Captions: ${capResult.chunkCount} chunks from ${capResult.wordCount} words ` +
      `(${capResult.firstWordStart.toFixed(2)}s → ${capResult.lastWordEnd.toFixed(2)}s)\n`
  );

  // ─── STEP 4: Assemble final video (ffmpeg + subtitles= filter) ──
  console.log("🎞️  [4/4] Assembling final video (ffmpeg + burned kinetic captions)...");
  const videoPath = await assembleVideo(
    SCRIPT,
    audioResult.audioPath,
    imagePaths,
    JOB_ID,
    "vertical",
    audioResult.segmentDurations,
    capResult.assPath
  );
  console.log(`✅ [4/4] Video: ${videoPath}\n`);

  // ─── Copy artifacts to test-out/ for the auditor ─────────
  const finalMp4 = resolve(TEST_OUT_DIR, `${JOB_ID}.mp4`);
  const finalAss = resolve(TEST_OUT_DIR, `${JOB_ID}.ass`);
  copyFileSync(videoPath, finalMp4);
  copyFileSync(capResult.assPath, finalAss);

  // ─── ffprobe final duration + size ───────────────────────
  let finalDur = 0;
  try {
    const dur = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${finalMp4}"`,
      { timeout: 10_000, stdio: "pipe" }
    )
      .toString()
      .trim();
    finalDur = parseFloat(dur) || 0;
  } catch {
    /* non-critical */
  }
  const mp4KB = (statSync(finalMp4).size / 1024).toFixed(0);
  const assKB = (statSync(finalAss).size / 1024).toFixed(0);

  console.log("━".repeat(60));
  console.log("✅ RENDER COMPLETE");
  console.log("━".repeat(60));
  console.log(`elapsed:   ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`duration:  ${finalDur.toFixed(2)}s`);
  console.log(`mp4:       ${finalMp4}  (${mp4KB}KB)`);
  console.log(`ass:       ${finalAss}  (${assKB}KB)`);
  console.log("");
  console.log("AUDIT CHECKLIST (Session 47 — True Background Plate):");
  console.log("  [ ] Captions appear from ~0s (no hook skip)");
  console.log("  [ ] 2-4 word bursts, uppercased BEBAS NEUE (not Arial — fontsdir locked)");
  console.log("  [ ] Solid dark plate (not drop shadow) behind every burst — ~69% opaque black");
  console.log("  [ ] A/V sync holds across all 3 scenes + CTA");
  console.log("  [ ] Pop-in snap VISIBLE (85→100% scale over 150ms = ~4.5 frames @ 30fps)");
  console.log("  [ ] Imagen 4 stills match locked aesthetic (suit / boardroom / burned doc)");
  console.log("");
}

main().catch((err) => {
  console.error("\n❌ FATAL:", err?.message || err);
  if (err?.stack) console.error(err.stack.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
});
