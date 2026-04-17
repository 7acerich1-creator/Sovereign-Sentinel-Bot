#!/usr/bin/env npx ts-node
/**
 * scripts/test-thumbnail.ts — Standalone thumbnail test.
 *
 * Generates a sample thumbnail WITHOUT running the full pipeline.
 * Uses Imagen 4 for the base image + ffmpeg for text overlay.
 *
 * Usage (from repo root):
 *   GEMINI_IMAGEN_KEY=xxx npx ts-node scripts/test-thumbnail.ts
 *   GEMINI_IMAGEN_KEY=xxx npx ts-node scripts/test-thumbnail.ts "YOUR TEXT" "ace_richie"
 *   GEMINI_IMAGEN_KEY=xxx npx ts-node scripts/test-thumbnail.ts "DELETE IT" "containment_field" "a shattered clock face with golden light bleeding through the cracks"
 *
 * Output: ./test_thumbnail_output.jpg
 */

import { writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve as resolvePath } from "path";

const GEMINI_KEY = process.env.GEMINI_IMAGEN_KEY || "";
if (!GEMINI_KEY) {
  console.error("❌ Set GEMINI_IMAGEN_KEY env var to run this test.");
  process.exit(1);
}

// ── Args ──
const thumbnailText = (process.argv[2] || "QUANTUM RESET").toUpperCase().slice(0, 35);
const brand = (process.argv[3] || "ace_richie") as "ace_richie" | "containment_field";
const customVisual = process.argv[4] || "";

// ── Same prompts as the updated faceless-factory.ts ──
const POSITIVE_DIRECTIVE =
  "Photorealistic, tangible physical textures, real human skin with visible pores and imperfections, " +
  "practical motivated light sources, deep natural shadows, high dynamic range, " +
  "cinematic depth of field, film grain, raw documentary authenticity, " +
  "extreme contrast between light and dark, bold dramatic lighting";

const NEGATIVE_BAN = "no text, no words, no letters, no watermarks, no cartoon, no illustration, no 3D render";

const thumbStyle = brand === "containment_field"
  ? "Cinematic thumbnail image, DEEP BLACK background filling at least 50% of the frame, single dramatic subject with cold blue or white rim light, extreme contrast between light and shadow, volumetric haze, 16:9 landscape. The LEFT HALF of the frame should be predominantly dark/empty for text placement"
  : "Cinematic thumbnail image, DEEP BLACK background filling at least 50% of the frame, single dramatic subject with warm golden or amber rim light, extreme contrast, volumetric golden particles or atmospheric light rays, 16:9 landscape. The LEFT HALF of the frame should be predominantly dark/empty for text placement";

const defaultVisual = "dramatic volumetric light rays cutting through darkness, golden atmospheric particles suspended in a single beam of light, deep black negative space";
const thumbVisual = customVisual || defaultVisual;

const thumbPrompt = `${thumbStyle}. Subject: ${thumbVisual}. ${POSITIVE_DIRECTIVE}. ${NEGATIVE_BAN}.`;

async function main() {
  const basePath = resolvePath("./test_thumb_base.png");
  const finalPath = resolvePath("./test_thumbnail_output.jpg");

  console.log(`\n🎯 Thumbnail text: "${thumbnailText}"`);
  console.log(`🎨 Brand: ${brand}`);
  console.log(`📐 Prompt: ${thumbPrompt.slice(0, 200)}...`);

  // ── Generate base image via Imagen 4 ──
  console.log(`\n⏳ Generating base image via Imagen 4...`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt: thumbPrompt }],
      parameters: { sampleCount: 1, aspectRatio: "16:9", safetyFilterLevel: "block_only_high" },
    }),
  });

  let hasBase = false;
  if (res.ok) {
    const data = (await res.json()) as any;
    const b64 = data.predictions?.[0]?.bytesBase64Encoded || data.predictions?.[0]?.image?.bytesBase64Encoded;
    if (b64) {
      const buf = Buffer.from(b64, "base64");
      if (buf.length > 5000) {
        writeFileSync(basePath, buf);
        hasBase = true;
        console.log(`✅ Base image: ${(buf.length / 1024).toFixed(0)}KB`);
      }
    }
  }
  if (!res.ok) {
    console.error(`❌ Imagen 4 failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  // Fallback: dark gradient
  if (!hasBase) {
    console.log(`⚠️ Imagen 4 failed, using dark gradient fallback`);
    execSync(
      `ffmpeg -f lavfi -i "color=c=0x0a0a0f:s=1920x1080:d=1" -frames:v 1 -y "${basePath}"`,
      { timeout: 15_000, stdio: "pipe" }
    );
    hasBase = existsSync(basePath);
  }
  if (!hasBase) { console.error("❌ No base image."); process.exit(1); }

  // ── Text overlay ──
  const brandAssetsDir = resolvePath(__dirname, "..", "brand-assets");
  const fontPath = resolvePath(brandAssetsDir, "BebasNeue-Regular.ttf");
  const hasFont = existsSync(fontPath);
  const fontFilter = hasFont ? `fontfile='${fontPath}':` : "";

  const words = thumbnailText.split(/\s+/);
  let line1 = "", line2 = "";
  if (words.length <= 3) {
    line1 = words.join(" ");
  } else {
    const mid = Math.ceil(words.length / 2);
    line1 = words.slice(0, mid).join(" ");
    line2 = words.slice(mid).join(" ");
  }

  const escapeDT = (s: string) => s.replace(/'/g, "'\\''").replace(/:/g, "\\:");
  const accentColor = brand === "containment_field" ? "0x00e5c7" : "0xd4a843";

  // Dark plate + MASSIVE white text + accent bar
  const textPlate = `drawbox=x=0:y=ih*0.25:w=iw*0.65:h=ih*0.55:c=black@0.55:t=fill`;
  let textFilters = `${textPlate},drawtext=${fontFilter}text='${escapeDT(line1)}':fontsize=180:fontcolor=0xFFFFFF:borderw=8:bordercolor=0x000000:x=(w*0.05):y=(h*0.32)`;

  if (line2) {
    textFilters += `,drawtext=${fontFilter}text='${escapeDT(line2)}':fontsize=160:fontcolor=0xFFFFFF:borderw=8:bordercolor=0x000000:x=(w*0.05):y=(h*0.55)`;
  }
  textFilters += `,drawbox=x=iw*0.05:y=${line2 ? "ih*0.73" : "ih*0.55"}:w=iw*0.40:h=8:c=${accentColor}@0.9:t=fill`;

  console.log(`\n⏳ Rendering text overlay...`);
  try {
    execSync(
      `ffmpeg -i "${basePath}" -vf "${textFilters}" -q:v 2 -y "${finalPath}"`,
      { timeout: 30_000, stdio: "pipe" }
    );
    console.log(`\n✅ Thumbnail saved: ${finalPath}`);
    console.log(`   Open it and check: Is the text readable? Is the contrast high? Does it stop a scroll?`);
  } catch (err: any) {
    const stderr = err.stderr?.toString?.()?.slice(0, 500) || "";
    console.error(`❌ Text overlay failed: ${stderr}`);

    // If drawtext failed (common on static ffmpeg), output base image
    if (existsSync(basePath)) {
      execSync(`cp "${basePath}" "${finalPath}"`, { stdio: "pipe" });
      console.log(`⚠️ drawtext not available — base image saved without text overlay: ${finalPath}`);
    }
  }

  // Cleanup
  try { execSync(`rm -f "${basePath}"`, { stdio: "pipe" }); } catch {}
}

main().catch(err => { console.error(err); process.exit(1); });
