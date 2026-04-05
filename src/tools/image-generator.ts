// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sovereign Image Generator (Gap 4)
// Gemini Imagen 4 (PRIMARY) → Pollinations.ai (FREE fallback) → DALL-E 3 (fallback)
// Niche-aware prompt enhancement + Supabase logging
// Session 26: Imagen 4 promoted to primary for cinematic quality uplift
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { writeFileSync } from "fs";
import { config } from "../config";
import type { Tool, ToolDefinition } from "../types";

// ── Niche prompt prefixes ──
const NICHE_PREFIXES: Record<string, string> = {
  dark_psychology:
    "High contrast monochromatic, brutalist aesthetic, heavy shadows, single geometric element, cinematic, ",
  self_improvement:
    "Clean minimal, bright warm tones, forward momentum, architectural, ",
  burnout:
    "Muted desaturated palette, warm undertones, soft industrial, release energy, ",
  quantum:
    "Abstract geometric, deep blue shifted, high saturation, conceptual visualization, ",
  brand:
    "Sovereign Synthesis brand aesthetic, amber and teal accents, dark background, authoritative minimal, ",
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

    // ── STEP 1: Gemini Imagen 4 (PRIMARY — cinematic quality, $0.02-0.04/image) ──
    const geminiKey = config.llm.providers.gemini?.apiKey;
    if (geminiKey) {
      try {
        imageBuffer = await this.tryGeminiImagen(geminiKey, enhancedPrompt, aspectRatio);
        if (imageBuffer) source = "gemini_imagen_4";
      } catch (err: any) {
        console.warn(`[ImageGen] Gemini Imagen failed: ${err.message}`);
      }
    }

    // ── STEP 2: Fallback to Pollinations.ai (FREE, no auth) ──
    if (!imageBuffer) {
      try {
        const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt.slice(0, 2000))}?width=${dims.w}&height=${dims.h}&nologo=true&seed=${Date.now()}`;
        const res = await fetch(pollinationsUrl, { redirect: "follow" });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 5000) {
            imageBuffer = buf;
            source = "pollinations";
            console.log(`🎨 [ImageGen] Generated via Pollinations fallback (${(buf.length / 1024).toFixed(0)}KB)`);
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
          file_path: filePath,
          prompt: prompt.slice(0, 2000),
          status: "ready",
          metadata: { source, generated_at: new Date().toISOString() },
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
