// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Multi-LLM Provider System
// Hot-swappable: Gemini, Anthropic, OpenAI, DeepSeek, Groq, OpenRouter
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { GoogleGenerativeAI, Content, Part, FunctionDeclarationSchema } from "@google/generative-ai";
import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse, ToolDefinition, ToolCall } from "../types";

// ── Rate-limit retry with exponential backoff ──
// Retries on 429 (and 529 for Anthropic overload) up to 3 times
// with exponential backoff: 2s → 4s → 8s, plus jitter
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

async function fetchWithRetry(url: string, init: RequestInit, providerName: string): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const resp = await fetch(url, init);

    if (resp.status === 429 || resp.status === 529) {
      if (attempt === MAX_RETRIES) {
        // Final attempt — let the caller handle the error
        return resp;
      }
      // Parse Retry-After header if present (seconds), otherwise use exponential backoff
      const retryAfter = resp.headers.get("retry-after");
      const delayMs = retryAfter
        ? Math.min(parseInt(retryAfter, 10) * 1000, 30_000)
        : BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
      console.warn(`⏳ ${providerName} rate-limited (${resp.status}), retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delayMs / 1000)}s...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    return resp;
  }
  // Should never reach here, but satisfy TypeScript
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

    // Convert messages to Gemini format — including proper functionCall/functionResponse pairs
    const history: Content[] = [];
    const pendingToolCalls: Map<string, string> = new Map(); // toolCallId → functionName
    const messagesForHistory = chatMessages.slice(0, -1);

    for (const m of messagesForHistory) {
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        // Model turn with function calls — emit as functionCall parts
        const parts: Part[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const tc of m.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.arguments || {} } } as any);
          pendingToolCalls.set(tc.id, tc.name);
        }
        history.push({ role: "model", parts });
      } else if (m.role === "tool" && m.toolCallId) {
        // Tool result — emit as functionResponse part in a user turn
        const fnName = pendingToolCalls.get(m.toolCallId) || "unknown_function";
        pendingToolCalls.delete(m.toolCallId);
        // Gemini groups consecutive functionResponse parts into one user turn
        const lastEntry = history[history.length - 1];
        const responsePart = { functionResponse: { name: fnName, response: { result: m.content } } } as any;
        if (lastEntry && lastEntry.role === "user" && lastEntry.parts.some((p: any) => p.functionResponse)) {
          // Merge into existing functionResponse user turn
          lastEntry.parts.push(responsePart);
        } else {
          history.push({ role: "user", parts: [responsePart] });
        }
      } else {
        // Regular text message
        history.push({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content || "" }],
        });
      }
    }

    const lastMessage = chatMessages[chatMessages.length - 1];
    const chat = model.startChat({ history });

    // Gemini SDK retry — catches 429/RESOURCE_EXHAUSTED errors
    let result: any;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        result = await chat.sendMessage(lastMessage?.content || "");
        break; // Success — exit retry loop
      } catch (retryErr: any) {
        const msg = retryErr.message || "";
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

      return {
        content: response.text() || "",
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount || 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata?.totalTokenCount || 0,
        },
        model: this.model,
        finishReason: toolCalls.length > 0 ? "tool_use" : "stop",
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
    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
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

    try {
      const resp = await fetchWithRetry(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
          },
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

      return {
        content: textContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: data.usage?.input_tokens || 0,
          outputTokens: data.usage?.output_tokens || 0,
          totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
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
