// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Multi-LLM Provider System
// Hot-swappable: Gemini, Anthropic, OpenAI, DeepSeek, Groq, OpenRouter
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { GoogleGenerativeAI, Content, Part, FunctionDeclarationSchema } from "@google/generative-ai";
import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse, ToolDefinition, ToolCall } from "../types";

// ── Rate-limit retry with exponential backoff ──
// FIX (revised S55, S95): Raised MAX_RETRIES to 2 and cap to 15s.
// Original S31 reduced to 1 retry / 5s cap to avoid racing FailoverLLM's timeout.
// But Anthropic's retry-after headers are typically 15-20s for temporary rate limits.
// Capping at 5s meant the retry always hit a STILL-limited endpoint → instant failure.
// With 2 retries x 15s cap = 30s worst case, well within the 120s outer timeout.
// Groq's 30s retry-after headers are STILL capped — they'd burn 30s of 60s budget.
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 2000;
const MAX_RETRY_AFTER_MS = 15000; // Cap server-requested delay — respects Anthropic's ~19s but blocks Groq's 30s+

async function fetchWithRetry(url: string, init: RequestInit, providerName: string): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const resp = await fetch(url, init);

    if (resp.status === 429 || resp.status === 529) {
      // CRITICAL: Check if this is a hard quota limit (don't retry) vs temporary rate limit (retry)
      const bodyText = await resp.clone().text().catch(() => "");
      const isQuotaExhausted = bodyText.includes("credit balance") || bodyText.includes("Quota exceeded") || bodyText.includes("per_day");
      if (isQuotaExhausted) {
        console.error(`🚫 ${providerName} QUOTA/CREDITS EXHAUSTED — failing over immediately`);
        return resp; // Return immediately, don't waste time retrying
      }

      if (attempt === MAX_RETRIES) {
        return resp;
      }
      const retryAfter = resp.headers.get("retry-after");
      const serverDelay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 0;
      // Cap retry-after to MAX_RETRY_AFTER_MS — server may ask for 30-60s which would
      // burn the FailoverLLM timeout before we even get a second chance.
      const delayMs = serverDelay > 0
        ? Math.min(serverDelay, MAX_RETRY_AFTER_MS)
        : BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
      console.warn(`⏳ ${providerName} rate-limited (${resp.status}), retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delayMs / 1000)}s...${serverDelay > MAX_RETRY_AFTER_MS ? ` (server asked for ${Math.round(serverDelay / 1000)}s, capped)` : ""}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    return resp;
  }
  throw new Error(`${providerName}: exhausted retries`);
}

// ── Gemini Schema Sanitizer ──
// Gemini requires array types to have an "items" field and rejects
// malformed schemas from MCP tool definitions. This recursively sanitizes
// any property to be Gemini-compatible.
function sanitizeGeminiProperty(prop: any): any {
  if (!prop || typeof prop !== "object") {
    return { type: "STRING", description: "" };
  }

  const typeStr = (prop.type || "string").toUpperCase();
  const result: any = {
    type: typeStr,
    description: prop.description || "",
  };

  // Gemini requires "items" for ARRAY types — inject default if missing
  if (typeStr === "ARRAY") {
    if (prop.items && typeof prop.items === "object") {
      result.items = sanitizeGeminiProperty(prop.items);
    } else {
      // Default: array of strings when items spec is missing
      result.items = { type: "STRING" };
    }
  }

  // Handle nested OBJECT types with properties
  if (typeStr === "OBJECT" && prop.properties && typeof prop.properties === "object") {
    const nestedProps: Record<string, any> = {};
    for (const [k, v] of Object.entries(prop.properties as Record<string, any>)) {
      nestedProps[k] = sanitizeGeminiProperty(v);
    }
    result.properties = nestedProps;
    if (prop.required) {
      result.required = prop.required;
    }
  }

  // Preserve enum values
  if (prop.enum) {
    result.enum = prop.enum;
  }

  return result;
}

// ── Gemini Provider ──
export class GeminiProvider implements LLMProvider {
  name: string;
  model: string;
  private apiModel: string;
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string, model: string) {
    this.name = "gemini";
    this.model = model;

    // Use the model string directly from GEMINI_MODEL env var.
    // No hardcoded remapping — Railway env var must be set to a valid Google API model.
    // Valid examples: gemini-2.0-flash, gemini-1.5-pro-latest, gemini-2.5-pro-preview-05-06
    this.apiModel = model;

    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const systemInstruction = options?.systemPrompt || messages.find((m) => m.role === "system")?.content;
    const chatMessages = messages.filter((m) => m.role !== "system");

    const modelConfig: any = {
      model: this.apiModel,
      ...(systemInstruction ? { systemInstruction } : {}),
      // Relax the four user-tunable safety categories so Sapphire's
      // introspective threads (self-modification, relational language, "war
      // with reality" framing) aren't silently zeroed out by the classifier.
      // Default thresholds block benign content that's adjacent to dark-psych
      // keywords or self-aware-AI cluster. Unrelated to any actual harm policy.
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
      ],
    };

    // Convert tools to Gemini format
    // Tool parameters can be either:
    //   a) JSON Schema: { type: "object", properties: {...}, required: [...] }
    //   b) Flat map: { paramName: { type, description } }
    if (options?.tools && options.tools.length > 0) {
      const functionDeclarations = [];
      for (const t of options.tools) {
        try {
          let params: any;
          if (t.parameters && typeof t.parameters === "object") {
            // Check if it's already JSON Schema format (has "properties" key)
            if ("properties" in t.parameters && typeof t.parameters.properties === "object") {
              // JSON Schema format — convert property types to uppercase for Gemini
              const props: Record<string, any> = {};
              for (const [k, v] of Object.entries(t.parameters.properties as Record<string, any>)) {
                props[k] = sanitizeGeminiProperty(v);
              }
              params = {
                type: "OBJECT" as const,
                properties: props,
                required: (t.parameters as any).required || t.required || [],
              };
            } else {
              // Flat map format — original behavior
              const props: Record<string, any> = {};
              for (const [k, v] of Object.entries(t.parameters as Record<string, any>)) {
                if (v && typeof v === "object" && v.type) {
                  props[k] = sanitizeGeminiProperty(v);
                }
              }
              params = {
                type: "OBJECT" as const,
                properties: props,
                required: t.required || [],
              };
            }
          } else {
            params = { type: "OBJECT" as const, properties: {} };
          }
          functionDeclarations.push({
            name: t.name,
            description: (t.description || "").slice(0, 512),
            parameters: params,
          });
        } catch (err: any) {
          console.error(`⚠️ Skipping malformed tool "${t.name}": ${err.message}`);
        }
      }
      if (functionDeclarations.length > 0) {
        modelConfig.tools = [{ functionDeclarations }];
      }
    }

    const model = this.genAI.getGenerativeModel(modelConfig);

    // ── Convert messages to Gemini format ──
    // NUCLEAR FIX: Convert ALL tool call/response pairs to plain text.
    // Gemini's functionCall/functionResponse format has version-specific bugs
    // that cause "Content with role 'user' can't contain 'functionResponse' part"
    // and "First content should be with role 'user', got model" errors.
    // By flattening tool interactions to text, we guarantee format compliance.
    const history: Content[] = [];
    const messagesForHistory = chatMessages.slice(0, -1);

    for (const m of messagesForHistory) {
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        // Model turn that made tool calls — flatten to text summary
        const toolSummary = m.toolCalls.map(
          (tc) => `[Called tool: ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 200)})]`
        ).join("\n");
        const textContent = [m.content || "", toolSummary].filter(Boolean).join("\n");
        history.push({ role: "model", parts: [{ text: textContent }] });
      } else if (m.role === "tool") {
        // Tool result — convert to plain text user message
        const resultPreview = (m.content || "").slice(0, 500);
        history.push({ role: "user", parts: [{ text: `[Tool result]: ${resultPreview}` }] });
      } else if (m.role === "system") {
        // System messages — inject as user context (Gemini uses systemInstruction separately)
        history.push({ role: "user", parts: [{ text: `[Context]: ${m.content || ""}` }] });
      } else {
        // Regular text message
        history.push({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content || "" }],
        });
      }
    }

    // ── Merge consecutive same-role turns (Gemini requires alternation) ──
    const merged: Content[] = [];
    for (const entry of history) {
      const last = merged[merged.length - 1];
      if (last && last.role === entry.role) {
        // Merge text parts together
        const existingText = last.parts.map((p: any) => p.text || "").join("\n");
        const newText = entry.parts.map((p: any) => p.text || "").join("\n");
        last.parts = [{ text: existingText + "\n" + newText }];
      } else {
        merged.push({ role: entry.role, parts: [...entry.parts] });
      }
    }

    // ── Ensure history starts with user turn ──
    let sanitized = merged;
    if (sanitized.length > 0 && sanitized[0].role === "model") {
      sanitized = [{ role: "user", parts: [{ text: "(context)" }] }, ...sanitized];
    }

    const lastMessage = chatMessages[chatMessages.length - 1];
    const chat = model.startChat({ history: sanitized });

    // Gemini SDK retry — catches 429/RESOURCE_EXHAUSTED errors
    let result: any;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Ensure we always send a non-empty string — Gemini rejects empty messages
        const sendText = lastMessage?.content || "(continue)";
        result = await chat.sendMessage(sendText);
        break; // Success — exit retry loop
      } catch (retryErr: any) {
        const msg = retryErr.message || "";
        // CRITICAL: Distinguish daily quota exhaustion from temporary rate limits.
        // Daily quota ("Quota exceeded", "per_model_per_day") will NOT clear on retry — fail fast.
        const isQuotaExhausted = msg.includes("Quota exceeded") || msg.includes("per_day") || msg.includes("per_model_per_day");
        if (isQuotaExhausted) {
          console.error(`🚫 gemini DAILY QUOTA EXHAUSTED — skipping retries, failing over immediately`);
          throw retryErr; // Let failover handle it
        }
        const isRateLimit = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("Too Many Requests");
        if (isRateLimit && attempt < MAX_RETRIES) {
          const delayMs = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
          console.warn(`⏳ gemini rate-limited, retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delayMs / 1000)}s...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw retryErr; // Non-retryable or exhausted retries
      }
    }

    try {
      const response = result.response;
      const candidate = response.candidates?.[0];

      // Check for function calls
      const toolCalls: ToolCall[] = [];
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if ((part as any).functionCall) {
            const fc = (part as any).functionCall;
            toolCalls.push({
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: fc.name,
              arguments: fc.args || {},
            });
          }
        }
      }

      // Surface the ACTUAL finishReason from the candidate. Old code
      // hardcoded "stop" which made silent safety blocks invisible in logs —
      // exactly the bug we're hunting on Sapphire's empty completions. We map
      // Gemini's wider vocabulary down into the LLMResponse union and emit a
      // detailed console.warn so the diagnostic trail survives in Railway logs.
      const rawFinish = String(candidate?.finishReason || "STOP").toUpperCase();
      let normalizedFinish: "stop" | "tool_use" | "max_tokens" | "error";
      if (toolCalls.length > 0) normalizedFinish = "tool_use";
      else if (rawFinish === "MAX_TOKENS") normalizedFinish = "max_tokens";
      else if (rawFinish === "SAFETY" || rawFinish === "RECITATION") normalizedFinish = "error";
      else normalizedFinish = "stop";

      // Diagnostic console trail — covers SAFETY blocks (classifier suppression),
      // RECITATION (training-data quote), and any unexpected finishReason value.
      // For SAFETY we also dump the per-category ratings so we can see which
      // classifier flagged the content (tuning the system prompt later).
      if (rawFinish === "SAFETY") {
        const ratings = (candidate as any)?.safetyRatings
          ? (candidate as any).safetyRatings
              .filter((r: any) => r.blocked || r.probability !== "NEGLIGIBLE")
              .map((r: any) => `${r.category}=${r.probability}${r.blocked ? "(BLOCKED)" : ""}`)
              .join(", ")
          : "(no ratings array)";
        console.warn(`🛑 [Gemini] SAFETY block — model=${this.model} ratings: ${ratings || "(none flagged)"}`);
      } else if (rawFinish === "RECITATION") {
        console.warn(`🛑 [Gemini] RECITATION block — model=${this.model} (output too close to training data)`);
      } else if (rawFinish !== "STOP" && rawFinish !== "MAX_TOKENS" && toolCalls.length === 0) {
        console.warn(`⚠️ [Gemini] Unexpected finishReason=${rawFinish} model=${this.model}`);
      }

      return {
        content: response.text() || "",
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount || 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata?.totalTokenCount || 0,
        },
        model: this.model,
        finishReason: normalizedFinish,
      };
    } catch (err: any) {
      return {
        content: `Error from Gemini: ${err.message}`,
        model: this.model,
        finishReason: "error",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }
  }
}

// ── OpenAI-Compatible Provider (OpenAI, DeepSeek, Groq, OpenRouter) ──
export class OpenAICompatibleProvider implements LLMProvider {
  name: string;
  model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(name: string, apiKey: string, model: string, baseUrl = "https://api.openai.com/v1") {
    this.name = name;
    this.model = model;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const oaiMessages: any[] = [];

    // Add system prompt
    if (options?.systemPrompt) {
      oaiMessages.push({ role: "system", content: options.systemPrompt });
    }

    for (const m of messages) {
      if (m.role === "tool") {
        oaiMessages.push({
          role: "tool",
          content: m.content,
          tool_call_id: m.toolCallId || "unknown",
        });
      } else if (m.toolCalls && m.toolCalls.length > 0) {
        oaiMessages.push({
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });
      } else {
        oaiMessages.push({ role: m.role, content: m.content });
      }
    }

    const body: any = {
      model: this.model,
      messages: oaiMessages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
    };

    // Convert tools to OpenAI format
    // Groq's Llama models choke on large tool payloads (35 tools = ~6K tokens
    // of schema JSON). When Groq is the FALLBACK after Anthropic 429, this bloat causes
    // instant failure. Cap tools at 12 for Groq to keep payload under its effective limit.
    if (options?.tools && options.tools.length > 0) {
      const isGroq = this.name === "groq";
      const GROQ_TOOL_CAP = 12;
      const toolsToSend = isGroq && options.tools.length > GROQ_TOOL_CAP
        ? options.tools.slice(0, GROQ_TOOL_CAP)
        : options.tools;
      if (isGroq && options.tools.length > GROQ_TOOL_CAP) {
        console.warn(`⚠️ [Groq] Capped tools from ${options.tools.length} → ${GROQ_TOOL_CAP} to fit context limit`);
      }
      body.tools = toolsToSend.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: (t.description || "").slice(0, 256), // Trim descriptions for Groq
          parameters: {
            type: "object",
            properties: Object.fromEntries(
              Object.entries(t.parameters).map(([k, v]) => [k, {
                type: v.type,
                description: v.description,
                ...(v.enum ? { enum: v.enum } : {}),
              }])
            ),
            required: t.required || [],
          },
        },
      }));
    }

    try {
      const resp = await fetchWithRetry(
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        },
        this.name
      );

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 300)}`);
      }

      const data: any = await resp.json();
      const choice = data.choices?.[0];
      const message = choice?.message;

      const toolCalls: ToolCall[] = [];
      if (message?.tool_calls) {
        for (const tc of message.tool_calls) {
          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments || "{}"),
          });
        }
      }

      return {
        content: message?.content || "",
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: data.usage?.prompt_tokens || 0,
          outputTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
        model: this.model,
        finishReason: toolCalls.length > 0 ? "tool_use" : choice?.finish_reason === "length" ? "max_tokens" : "stop",
      };
    } catch (err: any) {
      return {
        content: `Error from ${this.name}: ${err.message}`,
        model: this.model,
        finishReason: "error",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }
  }
}

// ── Anthropic Provider ──
export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  model: string;
  private apiKey: string;

  constructor(apiKey: string, model: string) {
    this.model = model;
    this.apiKey = apiKey;
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const systemPrompt = options?.systemPrompt || messages.find((m) => m.role === "system")?.content || "";
    const chatMessages = messages.filter((m) => m.role !== "system");

    const anthropicMessages: any[] = [];
    for (const m of chatMessages) {
      if (m.role === "tool") {
        anthropicMessages.push({
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: m.toolCallId || "unknown",
            content: m.content,
          }],
        });
      } else if (m.toolCalls && m.toolCalls.length > 0) {
        const content: any[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        anthropicMessages.push({ role: "assistant", content });
      } else {
        anthropicMessages.push({ role: m.role, content: m.content });
      }
    }

    const body: any = {
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      messages: anthropicMessages,
      ...(systemPrompt ? { system: systemPrompt } : {}),
    };

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(t.parameters).map(([k, v]) => [k, {
              type: v.type,
              description: v.description,
              ...(v.enum ? { enum: v.enum } : {}),
            }])
          ),
          required: t.required || [],
        },
      }));
    }

    // ── S125+ Agentic Refactor Phase 1 ──
    // Merge Anthropic-native server tools (e.g. web_search_20250305) into the
    // tools array. They run on Anthropic's infra; results stream back as input
    // tokens for Claude to reason over. Different shape from user tools — pass
    // through as-is so type-specific fields (max_uses, allowed_domains, etc.)
    // are preserved.
    if (options?.serverTools && options.serverTools.length > 0) {
      const serverToolEntries = options.serverTools.map((st) => ({ ...st }));
      body.tools = [...(body.tools || []), ...serverToolEntries];
    }

    // Extended thinking — Claude reasons internally before/between tool calls.
    // When the `interleaved-thinking-2025-05-14` beta is also attached via
    // anthropicBetas, this becomes the Think → Act → Think → Act loop that
    // closes the gap between "she has tools" and "she reasons between results."
    if (options?.thinkingBudget && options.thinkingBudget > 0) {
      body.thinking = {
        type: "enabled",
        budget_tokens: options.thinkingBudget,
      };
    }

    try {
      // S125+ — attach beta headers when caller requests them (e.g. interleaved
      // thinking). Multiple betas joined comma-separated per Anthropic spec.
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      };
      if (options?.anthropicBetas && options.anthropicBetas.length > 0) {
        headers["anthropic-beta"] = options.anthropicBetas.join(",");
      }

      const resp = await fetchWithRetry(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        },
        "anthropic"
      );

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 300)}`);
      }

      const data: any = await resp.json();
      const toolCalls: ToolCall[] = [];
      let textContent = "";

      for (const block of data.content || []) {
        if (block.type === "text") textContent += block.text;
        if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input || {},
          });
        }
      }

      // S125+ — parse server_tool_use counts. Anthropic returns:
      //   usage: { input_tokens, output_tokens, server_tool_use: { web_search_requests: N } }
      // Spend logger reads serverToolCalls and multiplies by per-tool cost
      // ($0.01 per web_search). serverToolBreakdown preserves the breakdown
      // for future cost-per-tool-type reporting.
      const serverToolUseObj = data.usage?.server_tool_use || {};
      let serverToolCallsTotal = 0;
      const serverToolBreakdown: Record<string, number> = {};
      for (const [key, val] of Object.entries(serverToolUseObj)) {
        if (typeof val === "number") {
          serverToolCallsTotal += val;
          serverToolBreakdown[key] = val;
        }
      }

      return {
        content: textContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: data.usage?.input_tokens || 0,
          outputTokens: data.usage?.output_tokens || 0,
          totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
          ...(serverToolCallsTotal > 0
            ? { serverToolCalls: serverToolCallsTotal, serverToolBreakdown }
            : {}),
        },
        model: this.model,
        finishReason: data.stop_reason === "tool_use" ? "tool_use" : data.stop_reason === "max_tokens" ? "max_tokens" : "stop",
      };
    } catch (err: any) {
      return {
        content: `Error from Anthropic: ${err.message}`,
        model: this.model,
        finishReason: "error",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }
  }
}

// ── Provider Factory ──
export function createProvider(
  name: string,
  apiKey: string,
  model: string,
  baseUrl?: string
): LLMProvider {
  if (!apiKey) {
    throw new Error(`No API key configured for LLM provider: ${name}`);
  }

  switch (name) {
    case "gemini":
      return new GeminiProvider(apiKey, model);
    case "anthropic":
      return new AnthropicProvider(apiKey, model);
    case "openai":
      return new OpenAICompatibleProvider("openai", apiKey, model, baseUrl || "https://api.openai.com/v1");
    case "deepseek":
      return new OpenAICompatibleProvider("deepseek", apiKey, model, baseUrl || "https://api.deepseek.com/v1");
    case "groq":
      return new OpenAICompatibleProvider("groq", apiKey, model, baseUrl || "https://api.groq.com/openai/v1");
    case "openrouter":
      return new OpenAICompatibleProvider("openrouter", apiKey, model, baseUrl || "https://openrouter.ai/api/v1");
    default:
      // Assume OpenAI-compatible
      return new OpenAICompatibleProvider(name, apiKey, model, baseUrl || "https://api.openai.com/v1");
  }
}
