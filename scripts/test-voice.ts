// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 1a — TEST-VOICE: Voice Auditioning Harness
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Zero-waste isolation test. Renders ONE hardcoded Sovereign paragraph
// four ways so Ace can A/B/C/D the voice without burning a pipeline run:
//
//   1. ElevenLabs Adam Brooding — HIGH STABILITY  (stiff, controlled, weighty)
//   2. ElevenLabs Adam Brooding — HIGH EMOTION    (volatile, dramatic, raw)
//   3. ElevenLabs Adam Brooding — BALANCED        (current production default)
//   4. Edge TTS Andrew Multilingual (FREE fallback)
//
// Usage:
//   npx tsx scripts/test-voice.ts
//
// Output:
//   ./voice-test-out/elevenlabs_high_stability.mp3
//   ./voice-test-out/elevenlabs_high_emotion.mp3
//   ./voice-test-out/elevenlabs_balanced.mp3
//   ./voice-test-out/edge_andrew.mp3
//
// Requires env:
//   ELEVENLABS_API_KEY       (or ELEVENLABS_API_KEY_ALT — tried in that order)
//   edge-tts Python CLI on PATH for the Edge run (pip install edge-tts)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Load .env FIRST — before any module reads process.env. This is belt-and-suspenders:
// src/config.ts also calls dotenv.config(), but the explicit side-effect import here
// guarantees the .env file at repo root is loaded before anything else evaluates.
import "dotenv/config";

import { config } from "../src/config";
import { execSync } from "child_process";
import { mkdirSync, writeFileSync, existsSync, statSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

// ── THE AUDITION SCRIPT ──────────────────────────────────────────────
// A single paragraph in the Sovereign Synthesis frequency.
// Deliberately chosen to include: a Glitch hook, a pivot, rhythm shifts,
// and a closing weight line. If Adam Brooding can't sell this, the profile
// is wrong.
const AUDITION_TEXT = `
You were never broken. You were running legacy firmware. The old operating system was installed before you could consent — fear of failure, fear of standing out, fear of the crowd turning on you. And every day you left it running, it compounded. The glitch is not in you. The glitch is in the code you inherited. Today, you stop patching symptoms. Today, you rewrite the root file. One line at a time. Starting with this one.
`.trim();

const ELEVEN_VOICE_ID = "IRHApOXLvnW57QJPQH2P"; // Adam Brooding — Dark & Tough
const EDGE_VOICE = "en-US-AndrewMultilingualNeural";
const OUT_DIR = resolve("./voice-test-out");

// ── VOICE PROFILES ───────────────────────────────────────────────────
// These are the exact voice_settings objects sent to ElevenLabs.
// stability ↓ = more expressive / less monotone / more risk of wobble.
// style ↑   = more dramatic emphasis + vocal variation.
// similarity_boost = how tightly to lock to the source voice DNA.
interface VoiceProfile {
  name: string;
  filename: string;
  settings: {
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
  };
}

const PROFILES: VoiceProfile[] = [
  {
    name: "HIGH STABILITY (stiff / controlled)",
    filename: "elevenlabs_high_stability.mp3",
    settings: {
      stability: 0.85,
      similarity_boost: 0.80,
      style: 0.25,
      use_speaker_boost: true,
    },
  },
  {
    name: "HIGH EMOTION (volatile / dramatic)",
    filename: "elevenlabs_high_emotion.mp3",
    settings: {
      stability: 0.30,
      similarity_boost: 0.70,
      style: 0.85,
      use_speaker_boost: true,
    },
  },
  {
    name: "BALANCED (current production default)",
    filename: "elevenlabs_balanced.mp3",
    settings: {
      stability: 0.50,
      similarity_boost: 0.75,
      style: 0.60,
      use_speaker_boost: true,
    },
  },
];

// ── ELEVENLABS CALL (duplicated from tts.ts to isolate voice_settings) ──
async function callElevenLabs(
  apiKey: string,
  text: string,
  settings: VoiceProfile["settings"]
): Promise<Buffer> {
  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: text.slice(0, 5000),
        model_id: "eleven_multilingual_v2",
        voice_settings: settings,
      }),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── EDGE TTS CALL (Python CLI, matches production path) ────────────
// Cross-platform: uses os.tmpdir() which resolves to %TEMP% on Windows,
// /tmp on macOS/Linux, so the audition script runs anywhere.
function callEdge(text: string, outputPath: string): void {
  const ts = Date.now();
  const tmpInput = join(tmpdir(), `test_voice_input_${ts}.txt`);
  writeFileSync(tmpInput, text.slice(0, 10000));
  try {
    execSync(
      `edge-tts --voice "${EDGE_VOICE}" --rate="+0%" --file "${tmpInput}" --write-media "${outputPath}"`,
      { timeout: 90_000, stdio: "pipe" }
    );
  } finally {
    try { unlinkSync(tmpInput); } catch {}
  }
}

// ── MAIN ────────────────────────────────────────────────────────────
interface ResultRow {
  label: string;
  path: string;
  size: string;
  status: "OK" | "FAIL";
  error?: string;
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("PHASE 1a — VOICE AUDITION");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Script length: ${AUDITION_TEXT.length} chars / ~${AUDITION_TEXT.split(/\s+/).length} words`);
  console.log(`Output dir:    ${OUT_DIR}`);
  console.log();

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const apiKey =
    config.voice.elevenLabsApiKeyAlt ||
    config.voice.elevenLabsApiKey ||
    "";

  const results: ResultRow[] = [];

  // ── ElevenLabs runs ────────────────────────────────────
  if (!apiKey) {
    console.warn("⚠️  No ElevenLabs API key in env — skipping all 3 ElevenLabs profiles.");
    console.warn("    Set ELEVENLABS_API_KEY or ELEVENLABS_API_KEY_ALT to audition Adam Brooding.");
    for (const p of PROFILES) {
      results.push({
        label: `ElevenLabs ${p.name}`,
        path: join(OUT_DIR, p.filename),
        size: "—",
        status: "FAIL",
        error: "No ElevenLabs API key",
      });
    }
  } else {
    for (const profile of PROFILES) {
      const outPath = join(OUT_DIR, profile.filename);
      console.log(`→ ElevenLabs: ${profile.name}`);
      console.log(`  stability=${profile.settings.stability} style=${profile.settings.style} similarity=${profile.settings.similarity_boost}`);
      try {
        const buffer = await callElevenLabs(apiKey, AUDITION_TEXT, profile.settings);
        writeFileSync(outPath, buffer);
        const size = `${(buffer.length / 1024).toFixed(0)} KB`;
        console.log(`  ✅ ${size} → ${outPath}`);
        results.push({ label: `ElevenLabs ${profile.name}`, path: outPath, size, status: "OK" });
      } catch (err: any) {
        console.error(`  ❌ ${err.message}`);
        results.push({
          label: `ElevenLabs ${profile.name}`,
          path: outPath,
          size: "—",
          status: "FAIL",
          error: err.message,
        });
      }
      console.log();
    }
  }

  // ── Edge TTS run ───────────────────────────────────────
  const edgeOut = join(OUT_DIR, "edge_andrew.mp3");
  console.log(`→ Edge TTS: ${EDGE_VOICE}`);
  try {
    callEdge(AUDITION_TEXT, edgeOut);
    if (!existsSync(edgeOut)) throw new Error("Edge TTS produced no file");
    const size = `${(statSync(edgeOut).size / 1024).toFixed(0)} KB`;
    console.log(`  ✅ ${size} → ${edgeOut}`);
    results.push({ label: `Edge TTS Andrew Multilingual`, path: edgeOut, size, status: "OK" });
  } catch (err: any) {
    console.error(`  ❌ ${err.message}`);
    results.push({
      label: `Edge TTS Andrew Multilingual`,
      path: edgeOut,
      size: "—",
      status: "FAIL",
      error: err.message,
    });
  }
  console.log();

  // ── Summary table ──────────────────────────────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("AUDITION SUMMARY");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  for (const r of results) {
    const tag = r.status === "OK" ? "✅" : "❌";
    console.log(`${tag}  ${r.label.padEnd(48)}  ${r.size.padStart(8)}`);
    if (r.status === "OK") {
      console.log(`     ${r.path}`);
    } else if (r.error) {
      console.log(`     ERROR: ${r.error}`);
    }
  }
  console.log();
  const okCount = results.filter((r) => r.status === "OK").length;
  console.log(`Rendered ${okCount}/${results.length} samples.`);
  console.log(`Open them side-by-side in the ${OUT_DIR} directory and pick the profile that carries the Sovereign frequency.`);

  if (okCount === 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
