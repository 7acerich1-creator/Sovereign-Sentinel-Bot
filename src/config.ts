// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Configuration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import dotenv from "dotenv";
import { GravityClawConfig } from "./types";
dotenv.config();

function envList(key: string, fallback: string[] = []): string[] {
  const val = process.env[key];
  return val ? val.split(",").map((s) => s.trim()) : fallback;
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

export const config: GravityClawConfig = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    veritas_token: process.env.VERITAS_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "",
    sapphire_token: process.env.SAPPHIRE_TOKEN || "",
    alfred_token: process.env.ALFRED_TOKEN || "",
    yuki_token: process.env.YUKI_TOKEN || "",
    anita_token: process.env.ANITA_TOKEN || "",
    vector_token: process.env.VECTOR_TOKEN || "",
    authorizedUserIds: envList(
      "TELEGRAM_AUTHORIZED_USER_IDS",
      [process.env.TELEGRAM_AUTHORIZED_USER_ID || process.env.AUTHORIZED_USER_ID || "8593700720"]
    ).map(Number),
  } as any,

  llm: {
    defaultProvider: process.env.LLM_DEFAULT_PROVIDER || "gemini",
    // SESSION 93: GEMINI PRIMARY. Anthropic credits exhausted — parked as emergency-only.
    // Gemini re-admitted to text-gen (was excluded S29c due to Anita billing leak,
    // root cause was Supabase overwriting prompts — fixed in S29c commit 624fc28).
    // Order: Gemini (primary, has API credit) → Groq (free backup) → Anthropic (emergency only).
    failoverOrder: envList("LLM_FAILOVER_ORDER", ["gemini", "groq", "anthropic"]),
    maxIterations: envInt("LLM_MAX_ITERATIONS", 10),
    providers: {
      gemini: {
        apiKey: process.env.GEMINI_API_KEY || "",
        // S95: Swapped from gemini-3.1-pro-preview ($2/$12 per 1M tokens) to
        // gemini-2.5-flash ($0.30/$2.50). Flash benchmarks HIGHER than Pro on
        // 6/6 evals and costs 75% less. Override via GEMINI_MODEL env var.
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        baseUrl: process.env.GEMINI_BASE_URL,
        // SESSION 35: GEMINI_IMAGEN_KEY must be set explicitly on Railway.
        // The old fallback to GEMINI_API_KEY was the "zero logs" ghost —
        // all Imagen/embedding calls silently used the old API project key
        // instead of the dedicated "vid rush gen-lang-client" key.
        // If GEMINI_IMAGEN_KEY is not set, imagenKey will be empty and
        // image gen will use Pollinations (free) instead.
        imagenKey: process.env.GEMINI_IMAGEN_KEY || "",
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY || "",
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY || "",
        model: process.env.OPENAI_MODEL || "gpt-4o",
        baseUrl: process.env.OPENAI_BASE_URL,
      },
      deepseek: {
        apiKey: process.env.DEEPSEEK_API_KEY || "",
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      },
      groq: {
        apiKey: process.env.GROQ_API_KEY || "",
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
      },
      openrouter: {
        apiKey: process.env.OPENROUTER_API_KEY || "",
        model: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4",
        baseUrl: "https://openrouter.ai/api/v1",
      },
    },
  },

  memory: {
    sqlitePath: process.env.SQLITE_PATH || "./gravity-claw.db",
    supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    pineconeApiKey: process.env.PINECONE_API_KEY,
    pineconeIndex: process.env.PINECONE_INDEX,
  },

  voice: {
    whisperApiKey: process.env.OPENAI_API_KEY || process.env.WHISPER_API_KEY,
    // SESSION 106: ElevenLabs + Edge TTS + OpenAI TTS PURGED. Everything is XTTS.
  },

  gmail: {
    credentialsPath: process.env.GMAIL_CREDENTIALS_PATH,
    tokenPath: process.env.GMAIL_TOKEN_PATH,
  },

  tools: {
    shellEnabled: process.env.SHELL_ENABLED !== "false",
    shellAllowlist: envList("SHELL_ALLOWLIST", [
      "ls", "cat", "head", "tail", "grep", "find", "wc", "date", "echo",
      "node", "npm", "npx", "python3", "pip", "git", "curl",
      "df", "du", "free", "uptime", "whoami", "pwd",
      "yt-dlp", "ffmpeg", "ffprobe", "whisper",
    ]),
    fileRootPath: process.env.FILE_ROOT_PATH || process.cwd(),
    browserEnabled: process.env.BROWSER_ENABLED === "true",
    searchProvider: (process.env.SEARCH_PROVIDER as "google" | "bing" | "duckduckgo") || "duckduckgo",
    searchApiKey: process.env.SEARCH_API_KEY,
  },

  mcp: {
    configPath: process.env.MCP_CONFIG_PATH || "./mcp.json",
    servers: {},
  },

  scheduler: {
    morningBriefingHour: envInt("MORNING_BRIEFING_HOUR", 15),  // 15 UTC = 10 AM CDT
    eveningRecapHour: envInt("EVENING_RECAP_HOUR", 1),        // 01 UTC = 8 PM CDT
    heartbeatIntervalMs: envInt("HEARTBEAT_INTERVAL_MS", 300_000),
  },

  webhooks: {
    enabled: process.env.WEBHOOKS_ENABLED === "true",
    port: envInt("PORT", 0) || envInt("WEBHOOK_PORT", 3000),
  },

  vidRush: {
    bufferApiKey: process.env.BUFFER_API_KEY || "",
    bufferOrgId: process.env.BUFFER_ORG_ID || "69c613a244dbc563b3e05050",
  },

  security: {
    maxAgentIterations: envInt("MAX_AGENT_ITERATIONS", 10),
    dangerousCommandConfirmation: process.env.DANGEROUS_COMMAND_CONFIRMATION !== "false",
    auditLogPath: process.env.AUDIT_LOG_PATH || "./.agent/logs",
  },
};
