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
    failoverOrder: envList("LLM_FAILOVER_ORDER", ["gemini", "anthropic", "openai", "deepseek", "groq"]),
    maxIterations: envInt("LLM_MAX_ITERATIONS", 10),
    providers: {
      gemini: {
        apiKey: process.env.GEMINI_API_KEY || "",
        model: process.env.GEMINI_MODEL || "gemini-3.1-pro-preview",
        baseUrl: process.env.GEMINI_BASE_URL,
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
    pineconeApiKey: process.env.PINECONE_API_KEY,
    pineconeIndex: process.env.PINECONE_INDEX,
  },

  voice: {
    whisperApiKey: process.env.OPENAI_API_KEY || process.env.WHISPER_API_KEY,
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
    elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",
    openaiTtsModel: process.env.OPENAI_TTS_MODEL || "tts-1",
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
    morningBriefingHour: envInt("MORNING_BRIEFING_HOUR", 8),
    eveningRecapHour: envInt("EVENING_RECAP_HOUR", 21),
    heartbeatIntervalMs: envInt("HEARTBEAT_INTERVAL_MS", 300_000),
  },

  webhooks: {
    enabled: process.env.WEBHOOKS_ENABLED === "true",
    port: envInt("PORT", 0) || envInt("WEBHOOK_PORT", 3000),
  },

  vidRush: {
    makeScenarioEWebhook: process.env.MAKE_SCENARIO_E_WEBHOOK || "",
    makeScenarioFWebhook: process.env.MAKE_SCENARIO_F_WEBHOOK || "",
    bufferApiKey: process.env.BUFFER_API_KEY || "",
  },

  security: {
    maxAgentIterations: envInt("MAX_AGENT_ITERATIONS", 10),
    dangerousCommandConfirmation: process.env.DANGEROUS_COMMAND_CONFIRMATION !== "false",
    auditLogPath: process.env.AUDIT_LOG_PATH || "./.agent/logs",
  },
};
