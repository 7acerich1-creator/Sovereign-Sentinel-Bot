// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 1b — TEST-IMAGEN: Metaphor-First Cinematic Audition (v2)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Session 46 rewrite — v1 sent the same literal "weathered man at kitchen table"
// prompt three times and Imagen 4 collapsed it into generic stock slop (sad
// man drinking coffee). That's the failure mode: Imagen 4 has a gravity well
// toward boring literal interpretations when you give it literal subjects.
//
// v2 pushes HARD in the opposite direction:
//   • Documentary realism (suit in crowd / empty boardroom / burned document) — tangible human stakes
//   • Extreme macro + texture instead of mid-shots
//   • Aggressive chiaroscuro — deep void blacks + stark amber volumetric
//   • Explicit ARRI Alexa 65 + anamorphic lens flare + Kodak Vision3 500T grain
//   • Hardened no-text negative prompt
//
// Each variant is a DIFFERENT visual thesis so Ace can A/B/C them and pick
// the direction that actually stops the scroll.
//
// Usage:
//   npx tsx scripts/test-imagen.ts
//
// Output:
//   ./imagen-test-out/imagen4_variant_1_suit_in_crowd.png
//   ./imagen-test-out/imagen4_variant_2_empty_boardroom.png
//   ./imagen-test-out/imagen4_variant_3_burned_document.png
//
// Requires env (loaded via dotenv):
//   GEMINI_IMAGEN_KEY   (or GEMINI_API_KEY as legacy fallback)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Load .env FIRST — before any module reads process.env.
import "dotenv/config";

import { config } from "../src/config";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";

const OUT_DIR = resolve("./imagen-test-out");

// ── UNIVERSAL NEGATIVE PROMPT ───────────────────────────────────────
// Ban the stock-photo failure modes explicitly. This is the "what Imagen
// keeps doing that we don't want" list — expanded from v1 to include the
// specific generic-slop signatures that appeared in v1 output.
const NEGATIVE_BAN = [
  // Stock-photo failure modes (v1 slop signatures)
  "no stock photography",
  "no generic mundane scenes",
  "no sad man drinking coffee",
  "no corporate headshot",
  "no lifestyle photography",
  "no wide environmental shots of people in rooms",
  // AI-art failure modes
  "no silhouettes",
  "no abstract representations",
  "no sacred geometry",
  "no generic digital art",
  "no AI-art gradient smoothness",
  "no plastic skin",
  "no symmetrical perfection",
  "no cartoon",
  "no illustration",
  "no 3D render look",
  "no Midjourney fever dream",
  "no neon cyberpunk cliché",
  // Text / UI pollution
  "NO text",
  "NO letters",
  "NO words",
  "NO writing",
  "NO watermarks",
  "NO signage",
  "NO UI overlays",
  "NO HUD elements",
  "NO subtitles",
  "NO captions",
].join(", ");

// ── CINEMATIC BASE STYLE ────────────────────────────────────────────
// Every variant gets this prefix. Forces the camera/film/lighting DNA
// on every single call so Imagen 4 can't drift back toward DSLR stock.
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
  "16:9 landscape aspect ratio, " +
  "prestige cinema still frame, not photography";

// ── THE THREE VARIANTS ──────────────────────────────────────────────
// Each variant is a DIFFERENT metaphor. Not the same scene three ways —
// three different visual theses. The point of auditioning is to compare
// distinct directions, not pick between cosmetic tweaks of the same idea.
interface Variant {
  id: number;
  slug: string;
  name: string;
  metaphor: string;
  scene: string;
}

const VARIANTS: Variant[] = [
  {
    id: 1,
    slug: "suit_in_crowd",
    name: "THE ISOLATED OPERATOR — Tailored Suit in a Blurred Crowd",
    metaphor: "Sovereignty inside the simulation — walking through the noise untouched",
    scene:
      "Medium-long lens shot at 85mm, a single man in a perfectly tailored charcoal three-piece suit " +
      "walking directly toward camera through a dense, fast-moving rush-hour crowd on a dimly lit " +
      "city street or train platform, the crowd rendered as heavy motion blur streaks — ghosts of " +
      "commuters, shoulders, briefcases, phones — while the central figure is in razor focus, " +
      "face intentionally obscured or turned three-quarters away so identity is never revealed, " +
      "tangible fabric weave visible on the suit lapel, a wristwatch catching a glint, " +
      "stark amber-gold (#d4a843) volumetric key light raking from frame-left through atmospheric " +
      "haze and cigarette smoke, deep crushed obsidian black in the negative space, " +
      "heavy chiaroscuro with the subject's face half in shadow, documentary realism in the " +
      "cinematography of Succession and Michael Clayton, " +
      "the feeling is quiet predatory calm inside chaos, isolation as power, not sadness, " +
      "absolutely NO text, NO signage, NO logos, NO brand names visible anywhere in the frame.",
  },
  {
    id: 2,
    slug: "empty_boardroom",
    name: "THE ROOM AFTER THE DECISION — Pristine Dimly Lit Boardroom",
    metaphor: "The architecture of power — the moment after the contract is signed",
    scene:
      "Wide cinematic interior of a pristine, empty corporate boardroom at 4am, " +
      "a single long polished walnut table with twelve unoccupied Eames executive chairs, " +
      "one chair at the head of the table pushed slightly back as if someone just stood up, " +
      "a single crystal tumbler of amber whiskey and a closed leather folio left on the table, " +
      "floor-to-ceiling windows behind the table showing a blurred nightscape of a financial " +
      "district skyline far below, windows rain-streaked, " +
      "the room illuminated only by a single warm amber-gold (#d4a843) pendant light hanging " +
      "low over the center of the table and practical city glow bleeding in, " +
      "deep chiaroscuro — corners of the room dissolving into crushed void black, " +
      "tangible wood grain on the table surface rendered in forensic macro detail where the " +
      "light catches it, reflections of the pendant in the polished surface, " +
      "the cinematography of Oppenheimer and The Godfather Part II, " +
      "the feeling is aftermath, revelation, consequence — power that has already been exercised, " +
      "absolutely NO text on the folio, NO writing on documents, NO logos, NO signage anywhere.",
  },
  {
    id: 3,
    slug: "burned_document",
    name: "THE EVIDENCE — Hands Holding a Burned Document",
    metaphor: "The old contract destroyed — the moment the legacy firmware is overwritten",
    scene:
      "Extreme close-up of a pair of weathered masculine hands, skin rendered with forensic " +
      "pore and knuckle detail, holding the charred remnant of a single sheet of thick cotton " +
      "paper — edges blackened and still glowing cherry-red at the burn line, curls of smoke " +
      "rising in volumetric amber-gold (#d4a843) god-rays, tiny embers drifting upward, " +
      "the remaining un-burned portion of the paper showing faint texture and watermark but " +
      "NO readable text, NO letters, NO words, NO writing of any kind, " +
      "a heavy signet ring on one finger catching a single specular amber highlight, " +
      "background is crushed obsidian void black with a narrow hard rim light from camera-right " +
      "carving the hands out of the darkness, " +
      "shot on an ARRI Alexa 65 with extreme shallow depth of field — only the burn line and " +
      "the fingertips in razor focus, the rest dissolving into creamy bokeh, " +
      "the feeling is irreversible decision, evidence destroyed, a threshold crossed, " +
      "documentary realism in the cinematography of Oppenheimer and Tinker Tailor Soldier Spy, " +
      "tangible human stakes — no fantasy, no sci-fi, no abstraction, " +
      "absolutely NO readable text, NO captions, NO overlays anywhere in the frame.",
  },
];

const VARIANT_COUNT = VARIANTS.length;

// ── IMAGEN 4 CALL (mirrors faceless-factory.ts production path) ────
async function callImagen4(prompt: string, apiKey: string): Promise<Buffer> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: "16:9",
        safetyFilterLevel: "block_only_high",
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Imagen 4 ${resp.status}: ${errText.slice(0, 400)}`);
  }

  const data: any = await resp.json();
  const b64 =
    data?.predictions?.[0]?.bytesBase64Encoded ||
    data?.predictions?.[0]?.image?.bytesBase64Encoded;

  if (!b64) {
    throw new Error(
      `Imagen 4 response missing image bytes. Raw: ${JSON.stringify(data).slice(0, 400)}`
    );
  }

  return Buffer.from(b64, "base64");
}

// ── PROMPT ASSEMBLY ─────────────────────────────────────────────────
function buildPrompt(v: Variant): string {
  return `${v.scene}\n\nCAMERA & FILM: ${BASE_STYLE}.\n\nNEGATIVE: ${NEGATIVE_BAN}`;
}

// ── MAIN ────────────────────────────────────────────────────────────
interface ResultRow {
  variant: number;
  slug: string;
  name: string;
  path: string;
  size: string;
  status: "OK" | "FAIL";
  error?: string;
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("PHASE 1b v2 — METAPHOR-FIRST CINEMATIC AUDITION");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Output dir:    ${OUT_DIR}`);
  console.log(`Variants:      ${VARIANT_COUNT} (each a distinct visual thesis)`);
  console.log();
  console.log("VARIANT ROSTER:");
  for (const v of VARIANTS) {
    console.log(`  ${v.id}. ${v.name}`);
    console.log(`     Metaphor: ${v.metaphor}`);
  }
  console.log();

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const apiKey =
    config.llm.providers.gemini?.imagenKey ||
    config.llm.providers.gemini?.apiKey ||
    "";

  if (!apiKey) {
    console.error("❌ No Gemini/Imagen API key in env.");
    console.error("   Set GEMINI_IMAGEN_KEY (preferred) or GEMINI_API_KEY in .env");
    process.exit(1);
  }

  const results: ResultRow[] = [];

  for (const variant of VARIANTS) {
    const outPath = join(OUT_DIR, `imagen4_variant_${variant.id}_${variant.slug}.png`);
    console.log(`→ Variant ${variant.id}/${VARIANT_COUNT}: ${variant.name}`);
    console.log(`  Metaphor: ${variant.metaphor}`);
    const prompt = buildPrompt(variant);
    try {
      const buffer = await callImagen4(prompt, apiKey);
      writeFileSync(outPath, buffer);
      const size = `${(buffer.length / 1024).toFixed(0)} KB`;
      console.log(`  ✅ ${size} → ${outPath}`);
      results.push({
        variant: variant.id,
        slug: variant.slug,
        name: variant.name,
        path: outPath,
        size,
        status: "OK",
      });
    } catch (err: any) {
      console.error(`  ❌ ${err.message}`);
      results.push({
        variant: variant.id,
        slug: variant.slug,
        name: variant.name,
        path: outPath,
        size: "—",
        status: "FAIL",
        error: err.message,
      });
    }
    console.log();
  }

  // ── Summary table ──────────────────────────────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("AUDITION SUMMARY");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  for (const r of results) {
    const tag = r.status === "OK" ? "✅" : "❌";
    console.log(`${tag}  Variant ${r.variant} — ${r.name.padEnd(50)}  ${r.size.padStart(8)}`);
    if (r.status === "OK") {
      console.log(`     ${r.path}`);
    } else if (r.error) {
      console.log(`     ERROR: ${r.error}`);
    }
  }
  console.log();
  const okCount = results.filter((r) => r.status === "OK").length;
  console.log(`Rendered ${okCount}/${results.length} variants.`);
  console.log();
  console.log(`Open them in ${OUT_DIR} and verify:`);
  console.log(`  1. NO sad-man-drinking-coffee. NO stock photography. NO generic people in rooms.`);
  console.log(`  2. Deep void black backgrounds — NOT flat mid-grey AI shading.`);
  console.log(`  3. Volumetric amber/gold light beams with visible dust motes.`);
  console.log(`  4. Anamorphic lens flare horizontal streaks.`);
  console.log(`  5. Visible Kodak Vision3 500T film grain — NOT AI-smoothness.`);
  console.log(`  6. Extreme shallow DOF with creamy bokeh on the out-of-focus regions.`);
  console.log(`  7. Zero text, zero letters, zero signage anywhere in frame.`);
  console.log();
  console.log(`If ANY variant still comes back as generic stock, the failure mode is`);
  console.log(`either (a) Imagen safety filter rewriting the prompt, or (b) the metaphor`);
  console.log(`isn't extreme enough — escalate further.`);

  if (okCount === 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
