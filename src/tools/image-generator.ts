// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sovereign Image Generator (Gap 4)
// Gemini Imagen 4 (PRIMARY) → Pollinations.ai (fallback) → DALL-E 3 (fallback)
// Session 26: Imagen 4 REVERTED to fallback — Gemini billing $62+ with card declining.
// Niche-aware prompt enhancement + Supabase logging
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { writeFileSync } from "fs";
import { config } from "../config";
import type { Tool, ToolDefinition } from "../types";

// ── Niche × Brand prompt prefixes ──
// SESSION 35: Upgraded from generic one-liners to cinematic brand-aligned prompts.
// Matches the visual DNA in design-tokens.json:
// Ace Richie = gold (#d4a843) + teal (#00e5c7) on void (#0a0a0f), warm sovereign energy
// Containment Field = cold blue (#5A9CF5) + teal (#00e5c7) on void (#0a0a0f), clinical surveillance energy
// NO blood red for TCF. NO warm tones for TCF.
const NICHE_PREFIXES: Record<string, string> = {
  dark_psychology:
    "Cinematic noir photograph, deep shadows with single amber light source cutting through darkness, " +
    "silhouette against brutalist geometric structure, gold (#d4a843) and midnight blue palette, " +
    "volumetric haze, tension and revelation, photorealistic cinematic quality, dark void (#0a0a0f) background, " +
    "NO text NO words NO letters NO watermarks, ",
  self_improvement:
    "Golden hour cinematic photograph, figure ascending toward bright horizon, " +
    "warm amber (#d4a843) and teal (#00e5c7) sky, architectural grandeur, columns and open space, " +
    "elevation and breakthrough energy, sovereign and majestic, photorealistic, " +
    "NO text NO words NO letters NO watermarks, ",
  burnout:
    "Cinematic photograph of chains dissolving into golden particles, " +
    "figure walking from industrial space into open landscape at dawn, " +
    "muted grays transitioning to warm amber (#d4a843), liberation energy, " +
    "dark void (#0a0a0f) background, photorealistic cinematic quality, " +
    "NO text NO words NO letters NO watermarks, ",
  quantum:
    "Abstract cosmic photograph, human figure in field of geometric light patterns, " +
    "deep space indigo and electric gold (#d4a843), sacred geometry, observer effect, " +
    "reality bending at edges, teal (#00e5c7) accent refractions, cinematic, " +
    "NO text NO words NO letters NO watermarks, ",
  brand:
    "Sovereign Synthesis brand photograph, midnight void (#0a0a0f) background, " +
    "amber (#d4a843) and teal (#00e5c7) accent lighting, architectural sovereignty, " +
    "throne-like composition, gold geometric accents, sacred geometry elements, " +
    "master architect energy, photorealistic cinematic quality, " +
    "NO text NO words NO letters NO watermarks, ",
};

// ── Aspect ratio → DALL-E 3 size mapping ──
const DALLE_SIZE_MAP: Record<string, string> = {
  "16:9": "1792x1024",
  "9:16": "1024x1792",
  "1:1": "1024x1024",
};

export class ImageGeneratorTool implements Tool {
  definition: ToolDefinition = {
    name: "generate_image",
    description:
      "Generates a sovereign brand image using Gemini Imagen 4 (PRIMARY) with Pollinations.ai + DALL-E 3 fallback. " +
      "Enhances the prompt based on content niche for consistent visual identity. " +
      "Saves the image locally and logs to Supabase content_transmissions.",
    parameters: {
      prompt: {
        type: "string",
        description: "The image description / visual concept to generate",
      },
      niche: {
        type: "string",
        description:
          "Content niche: dark_psychology | self_improvement | burnout | quantum | brand",
      },
      style: {
        type: "string",
        description:
          "Output style: thumbnail | social_post | background | logo_element",
      },
      aspect_ratio: {
        type: "string",
        description: "Aspect ratio: 16:9 | 9:16 | 1:1 (default 9:16 for social)",
      },
    },
    required: ["prompt", "niche"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const prompt = String(args.prompt || "");
    const niche = String(args.niche || "brand");
    const style = String(args.style || "social_post");
    const aspectRatio = String(args.aspect_ratio || "9:16");

    if (!prompt) return "❌ prompt is required.";

    // Build enhanced prompt with niche prefix
    const prefix = NICHE_PREFIXES[niche] || NICHE_PREFIXES.brand;
    const enhancedPrompt = `${prefix}${prompt}`;

    const timestamp = Date.now();
    const filePath = `/tmp/sovereign_image_${timestamp}.png`;

    let source = "none";
    let imageBuffer: Buffer | null = null;

    // Determine Pollinations dimensions from aspect ratio
    const POLL_DIMS: Record<string, { w: number; h: number }> = {
      "16:9": { w: 1792, h: 1024 },
      "9:16": { w: 1024, h: 1792 },
      "1:1": { w: 1024, h: 1024 },
    };
    const dims = POLL_DIMS[aspectRatio] || POLL_DIMS["9:16"];

    // ── STEP 1: Gemini Imagen 4 (PRIMARY — highest quality) ──
    // Session 27: Restored as primary. Billing crisis was Anita text-gen, not image gen.
    // SESSION 35: Use ONLY imagenKey — apiKey is for embeddings, not image gen.
    // Old code used apiKey here = same "zero logs" ghost (wrong billing project).
    const geminiKey = config.llm.providers.gemini?.imagenKey;
    if (geminiKey) {
      try {
        imageBuffer = await this.tryGeminiImagen(geminiKey, enhancedPrompt, aspectRatio);
        if (imageBuffer) source = "gemini_imagen_4";
      } catch (err: any) {
        console.warn(`[ImageGen] Gemini Imagen failed: ${err.message}`);
      }
    }

    // ── STEP 2: Fallback to Pollinations.ai (FREE, unlimited) ──
    if (!imageBuffer) {
      try {
        const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt.slice(0, 2000))}?width=${dims.w}&height=${dims.h}&nologo=true&seed=${Date.now()}`;
        const res = await fetch(pollinationsUrl, { redirect: "follow" });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 5000) {
            imageBuffer = buf;
            source = "pollinations";
            console.log(`🎨 [ImageGen] Generated via Pollinations (fallback) (${(buf.length / 1024).toFixed(0)}KB)`);
          } else {
            console.warn(`[ImageGen] Pollinations returned tiny response: ${buf.length}B`);
          }
        } else {
          console.warn(`[ImageGen] Pollinations ${res.status}`);
        }
      } catch (err: any) {
        console.warn(`[ImageGen] Pollinations error: ${err.message}`);
      }
    }

    // ── STEP 3: Fallback to DALL-E 3 ──
    if (!imageBuffer) {
      const openaiKey = config.llm.providers.openai?.apiKey;
      if (openaiKey) {
        try {
          imageBuffer = await this.tryDalle3(openaiKey, enhancedPrompt, aspectRatio);
          if (imageBuffer) source = "dalle_3";
        } catch (err: any) {
          console.warn(`[ImageGen] DALL-E 3 failed: ${err.message}`);
        }
      }
    }

    if (!imageBuffer) {
      return "❌ Image generation failed — all 3 providers (Pollinations, Gemini, DALL-E) returned errors.";
    }

    // ── STEP 3: Save image ──
    writeFileSync(filePath, imageBuffer);
    console.log(`🎨 [ImageGen] Saved: ${filePath} (${source}, ${imageBuffer.length} bytes)`);

    // ── STEP 4: Log to Supabase content_transmissions ──
    await this.logToSupabase(niche, style, filePath, enhancedPrompt, source);

    return (
      `✅ Image generated successfully.\n` +
      `Source: ${source}\n` +
      `File: ${filePath}\n` +
      `Niche: ${niche}\n` +
      `Style: ${style}\n` +
      `Aspect Ratio: ${aspectRatio}\n` +
      `Enhanced Prompt: ${enhancedPrompt.slice(0, 300)}${enhancedPrompt.length > 300 ? "..." : ""}`
    );
  }

  // ── Gemini Imagen 3 via REST ──
  private async tryGeminiImagen(
    apiKey: string,
    prompt: string,
    aspectRatio: string
  ): Promise<Buffer | null> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio,
          safetyFilterLevel: "block_only_high",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[ImageGen] Gemini Imagen ${res.status}: ${errText.slice(0, 300)}`);
      return null;
    }

    const data = (await res.json()) as any;
    const b64 =
      data.predictions?.[0]?.bytesBase64Encoded ||
      data.predictions?.[0]?.image?.bytesBase64Encoded;

    if (!b64) {
      console.error("[ImageGen] Gemini Imagen returned no image data");
      return null;
    }

    return Buffer.from(b64, "base64");
  }

  // ── DALL-E 3 via OpenAI REST ──
  private async tryDalle3(
    apiKey: string,
    prompt: string,
    aspectRatio: string
  ): Promise<Buffer | null> {
    const size = DALLE_SIZE_MAP[aspectRatio] || "1024x1792";

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        size,
        quality: "standard",
        n: 1,
        response_format: "b64_json",
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[ImageGen] DALL-E 3 ${res.status}: ${errText.slice(0, 300)}`);
      return null;
    }

    const data = (await res.json()) as any;
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      // Fallback: try URL-based response
      const imageUrl = data.data?.[0]?.url;
      if (imageUrl) {
        const imgRes = await fetch(imageUrl);
        if (imgRes.ok) {
          const arrayBuf = await imgRes.arrayBuffer();
          return Buffer.from(arrayBuf);
        }
      }
      return null;
    }

    return Buffer.from(b64, "base64");
  }

  // ── Supabase content_transmissions logger ──
  private async logToSupabase(
    niche: string,
    style: string,
    filePath: string,
    prompt: string,
    source: string
  ): Promise<void> {
    const supabaseUrl = config.memory.supabaseUrl;
    const supabaseKey = config.memory.supabaseKey;
    if (!supabaseUrl || !supabaseKey) return;

    try {
      const resp = await fetch(`${supabaseUrl}/rest/v1/content_transmissions`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          type: "image",
          niche,
          style,
          prompt: prompt.slice(0, 2000),
          status: "ready",
          metadata: { source, local_path: filePath, generated_at: new Date().toISOString() },
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[ImageGen] Supabase log failed: ${resp.status} ${errText.slice(0, 200)}`);
      }
    } catch (err: any) {
      console.error(`[ImageGen] Supabase log error: ${err.message}`);
    }
  }
}
