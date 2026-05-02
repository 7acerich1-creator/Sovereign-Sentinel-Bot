// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Gemini Flash Text Helper
// Session 115 (2026-04-24) — Shared tiny-text generation for Yuki auto-reply
// and Yuki hook drops after the Anthropic credit crisis.
//
// Gemini 2.5 Flash Lite: ~$0.10/M input, $0.40/M output. For 1-3 sentence
// replies / single-sentence hooks this is effectively free (~$0.0001/call).
//
// MODEL CHOICE (verified live 2026-04-24, S115):
//   - `gemini-2.0-flash` → 404 "no longer available to new users" (deprecated)
//   - `gemini-2.5-flash` / `gemini-flash-latest` → 200 but burn ~380 tokens
//     on "thinking" before output; at 400-token budget they return MAX_TOKENS
//     with truncated/unparseable JSON. Unusable for this workload unless we
//     raise max_tokens to 1000+ (3x cost).
//   - `gemini-2.5-flash-lite` → 200, no thinking tokens, clean JSON output
//     at ~800ms latency. Correct default.
//
// Key resolution: GEMINI_API_KEY only.
// (S127 2026-05-01: GEMINI_IMAGEN_KEY fallback removed — Imagen path is dead,
// all image gen runs through RunPod. The env var is being purged from Railway.)
//
// Uses the native Gemini REST endpoint, NOT the OpenAI compat layer.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const GEMINI_MODEL = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash-lite";

function getGeminiKey(): string | null {
  return process.env.GEMINI_API_KEY || null;
}

export interface GeminiFlashResult {
  text: string;
  error?: string;
}

/**
 * Generate a short text completion via Gemini 2.0 Flash.
 * Never throws — returns {error, text:""} on any failure.
 */
export async function generateShortText(
  systemPrompt: string,
  userMessage: string,
  opts: { maxOutputTokens?: number; temperature?: number } = {}
): Promise<GeminiFlashResult> {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    return { text: "", error: "No Gemini key set (GEMINI_API_KEY)" };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    generationConfig: {
      maxOutputTokens: opts.maxOutputTokens ?? 400,
      temperature: opts.temperature ?? 0.8,
    },
    // Relax safety settings — these are short creator-voice replies, not harmful content.
    // Default thresholds can block benign comments that mention "manipulation", "trauma",
    // "dark patterns" etc. because they're brand-adjacent keywords.
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ],
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return { text: "", error: `Gemini ${resp.status}: ${errText.slice(0, 250)}` };
    }

    const data = (await resp.json()) as any;

    // Safety block returns empty candidates
    const candidate = data?.candidates?.[0];
    if (!candidate) {
      const blockReason = data?.promptFeedback?.blockReason || "no candidates";
      return { text: "", error: `Gemini blocked: ${blockReason}` };
    }

    const parts = candidate?.content?.parts || [];
    const text = parts.map((p: any) => p?.text || "").join("").trim();

    if (!text) {
      const finishReason = candidate?.finishReason || "unknown";
      return { text: "", error: `Gemini empty text (finishReason=${finishReason})` };
    }

    return { text };
  } catch (err: any) {
    return { text: "", error: `Gemini exception: ${err.message}` };
  }
}
