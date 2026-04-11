// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SESSION 47 — LOCAL TEMPORAL + THUMBNAIL VERIFICATION HARNESS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Zero-API-burn local diagnostic for the three Session 47 architectural fixes:
//
//   FIX 1  — Brand Intro [0-3s] + Terminal Override [3-8s, fontsize 110+] concat
//            in assembleVideo, with captions `skipUntilSeconds` honoring the full
//            pre-scene overhead so kinetic captions never fire on the intro/TO.
//
//   FIX 2  — generateLongFormThumbnail renders a single frame directly from the
//            raw scene PNG (NO mid-video seek, NO .ass subtitle burn-in). Vignette
//            + 60% drop-plate + Bebas Neue title overlay on a clean frame.
//
//   FIX 3  — (description routing — not testable here, lives in vidrush-orchestrator)
//
// This harness BYPASSES every external service. No Anthropic, no Groq, no Whisper,
// no ElevenLabs, no Imagen, no Supabase, no YouTube, no network at all. All assets
// are either synthesized via ffmpeg lavfi (audio + scene image) or pre-written
// as static files (.ass captions) by this script at runtime.
//
// INPUTS (all synthesized in-process):
//   • scene_1.png    — 1920x1080 gradient PNG (ffmpeg lavfi)
//   • voiceover.mp3  — 20s silent stereo MP3 (ffmpeg lavfi anullsrc)
//   • captions.ass   — static libass file with 2 chunks AFTER t=8.0s so we can
//                      visually confirm captions do not overlap Brand Intro or TO.
//
// OUTPUTS (dropped into ./test-out/):
//   • test_session47_<ts>.mp4  — full assembled video. Timeline should read:
//                                  [0.0 → 3.0]  Brand Intro (logo stinger)
//                                  [3.0 → 8.0]  Terminal Override typewriter (Bebas, 120px)
//                                  [8.0 → end]  Scene 1 gradient + caption chunks
//   • test_session47_<ts>.jpg  — pre-caption thumbnail rendered from raw scene PNG
//                                (no .ass burn-in, no kinetic captions visible)
//
// RUN (from repo root):
//   npx tsx scripts/test-session-47.ts
//
// PRE-REQUISITES: ffmpeg + ffprobe on PATH. Nothing else.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  statSync,
} from "fs";
import { resolve } from "path";

import {
  assembleVideo,
  generateLongFormThumbnail,
  computeTerminalOverrideDuration,
  BRAND_INTRO_DUR,
  FACELESS_DIR,
  type FacelessScript,
} from "../src/engine/faceless-factory";

// ─────────────────────────────────────────────────────────────
// ZERO-BURN GUARD: hard-clear any upstream network credentials that
// production modules might attempt to use if imported transitively.
// We are NOT calling renderAudio / generateSceneImage / Supabase.
// This belt-and-suspenders wipe means even if a constructor fires
// during import, it can't reach a live endpoint.
// ─────────────────────────────────────────────────────────────
for (const k of [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_IMAGEN_KEY",
  "ELEVENLABS_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "YOUTUBE_ACCESS_TOKEN",
  "YOUTUBE_REFRESH_TOKEN",
  "BUFFER_ACCESS_TOKEN",
]) {
  delete process.env[k];
}

// ─────────────────────────────────────────────────────────────
// OUTPUT PATHS
// ─────────────────────────────────────────────────────────────
const REPO_ROOT = resolve(__dirname, "..");
const TEST_OUT_DIR = resolve(REPO_ROOT, "test-out");
if (!existsSync(TEST_OUT_DIR)) mkdirSync(TEST_OUT_DIR, { recursive: true });
if (!existsSync(FACELESS_DIR)) mkdirSync(FACELESS_DIR, { recursive: true });

const JOB_ID = `test_session47_${Date.now()}`;

// ─────────────────────────────────────────────────────────────
// SYNTHETIC SCRIPT
// Two segments:
//   seg 0 = the hook (consumed by the Terminal Override typewriter —
//           NOT rendered as a Ken Burns scene, per assembleVideo logic)
//   seg 1 = the single test scene, visualized by scene_1.png
// ─────────────────────────────────────────────────────────────
const SEG0_DUR = 5.0;  // forces TO duration = max(5.0, 5.0) = 5.0s exactly
const SEG1_DUR = 6.0;  // scene 1 displays for 6s (plus xfade overlap)

const SCRIPT: FacelessScript = {
  title: "SESSION 47 VERIFICATION RUN",
  niche: "brand",
  brand: "ace_richie",
  hook: "SESSION FORTY SEVEN TIMELINE VERIFIED.",
  segments: [
    {
      voiceover: "Session forty seven timeline verified.",
      visual_direction: "Synthetic gradient placeholder scene (not rendered).",
      duration_hint: SEG0_DUR,
    },
    {
      voiceover:
        "Scene one holds for six seconds so the test can measure brand intro, " +
        "terminal override, and scene transitions without touching any live API.",
      visual_direction: "Synthetic 1920x1080 gradient placeholder — scene 1.",
      duration_hint: SEG1_DUR,
    },
  ],
  cta: "SESSION 47 CTA placeholder.",
  thumbnail_text: "SESSION 47 VERIFIED",
  thumbnail_visual: "Synthetic gradient — pre-caption thumbnail test.",
};

const SEGMENT_DURATIONS: number[] = [SEG0_DUR, SEG1_DUR];

// ─────────────────────────────────────────────────────────────
// SYNTHETIC ASSET GENERATORS
// ─────────────────────────────────────────────────────────────

/** Generate a 1920x1080 PNG with a visible diagonal gradient. */
function synthesizeSceneImage(outPath: string): void {
  // lavfi nullsrc + geq → RGB gradient. No network, pure libavfilter math.
  // Red ramps left→right, Green ramps top→bottom, Blue constant mid — gives an
  // unmistakable "this is synthetic" tint that also exercises the vignette
  // darkening logic in generateLongFormThumbnail.
  execSync(
    `ffmpeg -f lavfi -i "nullsrc=s=1920x1080:d=1" ` +
      `-vf "format=rgb24,geq=r='255*X/W':g='255*Y/H':b='128'" ` +
      `-frames:v 1 -y "${outPath}"`,
    { timeout: 15_000, stdio: "pipe" }
  );
  if (!existsSync(outPath)) {
    throw new Error(`Synthetic scene image not created: ${outPath}`);
  }
}

/** Generate a ~20s stereo silent MP3 (plenty of runway; -shortest will trim). */
function synthesizeSilentAudio(outPath: string, seconds: number): void {
  execSync(
    `ffmpeg -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" ` +
      `-t ${seconds.toFixed(2)} -c:a libmp3lame -b:a 128k -y "${outPath}"`,
    { timeout: 15_000, stdio: "pipe" }
  );
  if (!existsSync(outPath)) {
    throw new Error(`Synthetic audio not created: ${outPath}`);
  }
}

/**
 * Write a static libass .ass file with two caption chunks that deliberately
 * fire AFTER the brand intro + Terminal Override window. If either chunk
 * leaks into the [0.0, 8.0s] region in the final MP4, FIX 1 is regressed.
 */
function writeStaticAssCaptions(outPath: string): void {
  const brandIntroEnd = BRAND_INTRO_DUR;
  const toDur = computeTerminalOverrideDuration(SEG0_DUR);
  const sceneStart = brandIntroEnd + toDur; // expected = 8.0s

  // Place the chunks half a second INTO the scene so they're clearly past the TO
  const c1Start = sceneStart + 0.5;  // 8.5s
  const c1End = sceneStart + 2.0;    // 10.0s
  const c2Start = sceneStart + 2.5;  // 10.5s
  const c2End = sceneStart + 4.5;    // 12.5s

  const fmt = (t: number): string => {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t - h * 3600 - m * 60;
    // .ass uses h:mm:ss.cc (centiseconds)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
  };

  const ass =
    `[Script Info]\n` +
    `Title: Session 47 Test Captions\n` +
    `ScriptType: v4.00+\n` +
    `PlayResX: 1920\n` +
    `PlayResY: 1080\n` +
    `WrapStyle: 2\n` +
    `ScaledBorderAndShadow: yes\n` +
    `\n` +
    `[V4+ Styles]\n` +
    `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Default,Bebas Neue,96,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,3,3,0,2,40,40,120,1\n` +
    `\n` +
    `[Events]\n` +
    `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` +
    `Dialogue: 0,${fmt(c1Start)},${fmt(c1End)},Default,,0,0,0,,SESSION FORTY SEVEN\n` +
    `Dialogue: 0,${fmt(c2Start)},${fmt(c2End)},Default,,0,0,0,,TIMELINE VERIFIED\n`;

  writeFileSync(outPath, ass, "utf8");
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  console.log("━".repeat(66));
  console.log(`SESSION 47 VERIFICATION — jobId: ${JOB_ID}`);
  console.log("━".repeat(66));
  console.log(`Repo root:    ${REPO_ROOT}`);
  console.log(`Faceless dir: ${FACELESS_DIR}`);
  console.log(`Test out:     ${TEST_OUT_DIR}`);
  console.log(`Orientation:  horizontal (1920x1080)`);
  console.log("");

  // ─── STEP 1: synthetic scene image (imagePaths[1]) ──────────
  console.log("🖼️  [1/4] Synthesizing 1920x1080 gradient scene image...");
  const sceneImagePath = `${FACELESS_DIR}/${JOB_ID}_scene_1.png`;
  synthesizeSceneImage(sceneImagePath);
  console.log(`   ✅ ${sceneImagePath}  (${(statSync(sceneImagePath).size / 1024).toFixed(0)}KB)\n`);

  // imagePaths[0] = null on purpose — assembleVideo's validSegments loop
  // deliberately skips index 0 (the hook is visualized by the Terminal Override
  // clip, not a Ken Burns scene). imagePaths[1] = the one real scene.
  const imagePaths: (string | null)[] = [null, sceneImagePath];

  // ─── STEP 2: synthetic silent audio track ───────────────────
  console.log("🔇 [2/4] Synthesizing 20s silent stereo MP3 (zero TTS burn)...");
  const audioPath = `${FACELESS_DIR}/${JOB_ID}_voiceover.mp3`;
  synthesizeSilentAudio(audioPath, 20.0);
  console.log(`   ✅ ${audioPath}  (${(statSync(audioPath).size / 1024).toFixed(0)}KB)\n`);

  // ─── STEP 3: static .ass caption file (post-TO) ─────────────
  console.log("📝 [3/4] Writing static .ass caption file (chunks @ 8.5-12.5s)...");
  const assPath = `${FACELESS_DIR}/${JOB_ID}_captions.ass`;
  writeStaticAssCaptions(assPath);
  const toDur = computeTerminalOverrideDuration(SEG0_DUR);
  const expectedSceneStart = BRAND_INTRO_DUR + toDur;
  console.log(
    `   ✅ BRAND_INTRO_DUR=${BRAND_INTRO_DUR.toFixed(1)}s + TO_DUR=${toDur.toFixed(1)}s → ` +
      `scene starts @ ${expectedSceneStart.toFixed(1)}s`
  );
  console.log(`   ✅ captions fire [8.5-10.0s] + [10.5-12.5s] — strictly after TO end\n`);

  // ─── STEP 4: assembleVideo (brand intro + TO + scene + captions) ──
  console.log("🎬 [4/4] Running assembleVideo (horizontal, with .ass captions)...");
  const videoPath = await assembleVideo(
    SCRIPT,
    audioPath,
    imagePaths,
    JOB_ID,
    "horizontal",
    SEGMENT_DURATIONS,
    assPath
  );
  console.log(`   ✅ ${videoPath}\n`);

  // ─── FIX 2: generateLongFormThumbnail on the RAW scene PNG ──
  console.log("🖼️  [FIX 2] Running generateLongFormThumbnail on RAW scene PNG (no subtitle burn-in)...");
  const thumbPath = await generateLongFormThumbnail(
    sceneImagePath,
    SCRIPT,
    JOB_ID,
    SCRIPT.brand
  );
  if (!thumbPath) {
    console.error("   ❌ Thumbnail generation returned null");
  } else {
    console.log(`   ✅ ${thumbPath}\n`);
  }

  // ─── Copy final artifacts to test-out/ ──────────────────────
  const finalMp4 = resolve(TEST_OUT_DIR, `${JOB_ID}.mp4`);
  const finalJpg = resolve(TEST_OUT_DIR, `${JOB_ID}.jpg`);
  const finalAss = resolve(TEST_OUT_DIR, `${JOB_ID}.ass`);
  copyFileSync(videoPath, finalMp4);
  if (thumbPath && existsSync(thumbPath)) copyFileSync(thumbPath, finalJpg);
  copyFileSync(assPath, finalAss);

  // ─── ffprobe the final video so we can sanity-check timing ──
  let finalDur = 0;
  try {
    const dur = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${finalMp4}"`,
      { timeout: 10_000, stdio: "pipe" }
    ).toString().trim();
    finalDur = parseFloat(dur) || 0;
  } catch { /* non-critical */ }

  const mp4KB = (statSync(finalMp4).size / 1024).toFixed(0);
  const jpgKB = existsSync(finalJpg) ? (statSync(finalJpg).size / 1024).toFixed(0) : "MISSING";

  console.log("━".repeat(66));
  console.log("✅ SESSION 47 VERIFICATION COMPLETE");
  console.log("━".repeat(66));
  console.log(`elapsed:              ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`final duration:       ${finalDur.toFixed(2)}s`);
  console.log(`expected floor:       ${(BRAND_INTRO_DUR + toDur + SEG1_DUR).toFixed(1)}s (pre-outro)`);
  console.log(`mp4:                  ${finalMp4}  (${mp4KB}KB)`);
  console.log(`jpg (thumb):          ${finalJpg}  (${jpgKB}KB)`);
  console.log(`ass (captions):       ${finalAss}`);
  console.log("");
  console.log("AUDIT CHECKLIST:");
  console.log(`  [ ] 0.0–3.0s    Brand Intro logo stinger visible`);
  console.log(`  [ ] 3.0–8.0s    Terminal Override green typewriter (Bebas Neue, fontsize 120)`);
  console.log(`  [ ] 8.0s+       Synthetic gradient scene + "SESSION FORTY SEVEN" caption`);
  console.log(`  [ ] captions NEVER overlap [0.0–8.0s]`);
  console.log(`  [ ] thumbnail shows clean gradient + title overlay (NO caption text burned in)`);
  console.log("━".repeat(66));
}

main().catch((err) => {
  console.error("\n❌ VERIFICATION RUN FAILED");
  console.error(err?.stack || err);
  process.exit(1);
});
