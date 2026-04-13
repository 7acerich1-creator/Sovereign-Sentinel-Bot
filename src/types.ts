// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Core Type System
// Trait-based plugin architecture interfaces
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── Message Types ──
export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: Date;
  channel: ChannelType;
  channelMessageId?: string | number;
  chatId: string;
  userId: string;
  metadata?: Record<string, unknown>;
  attachments?: Attachment[];
}

export interface Attachment {
  type: "image" | "audio" | "video" | "document" | "voice";
  url?: string;
  fileId?: string;
  mimeType?: string;
  size?: number;
  duration?: number;
  transcription?: string;
}

export type ChannelType = "telegram" | "gmail" | "webchat" | "api" | "dashboard";

// ── LLM Provider Interface ──
export interface LLMProvider {
  name: string;
  model: string;
  generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
  generateStream?(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<string>;
  countTokens?(text: string): Promise<number>;
}

export interface LLMMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  systemPrompt?: string;
  stopSequences?: string[];
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  model: string;
  finishReason: "stop" | "tool_use" | "max_tokens" | "error";
}

// ── Tool System ──
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  required?: string[];
  dangerous?: boolean;
  confirmationRequired?: boolean;
}

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  enum?: string[];
  items?: ToolParameter;
  default?: unknown;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;
}

export interface ToolContext {
  chatId: string;
  userId: string;
  channel: ChannelType;
  sendMessage: (text: string) => Promise<void>;
  requestConfirmation?: (prompt: string) => Promise<boolean>;
}

// ── Memory Interface ──
export interface MemoryProvider {
  name: string;
  initialize(): Promise<void>;
  saveMessage(message: Message): Promise<void>;
  getRecentMessages(chatId: string, limit?: number): Promise<Message[]>;
  saveFact(key: string, value: string, category?: string): Promise<void>;
  getFacts(chatId?: string): Promise<MemoryFact[]>;
  search(query: string, limit?: number): Promise<MemorySearchResult[]>;
  getSummary(chatId: string): Promise<string | null>;
  saveSummary(chatId: string, summary: string): Promise<void>;
  compact(chatId: string): Promise<void>;
  close(): Promise<void>;
}

export interface MemoryFact {
  key: string;
  value: string;
  category: string;
  createdAt: Date;
  updatedAt: Date;
  accessCount: number;
}

export interface MemorySearchResult {
  content: string;
  score: number;
  source: string;
  metadata?: Record<string, unknown>;
}

// ── Channel Interface ──
export interface Channel {
  name: ChannelType;
  initialize(): Promise<void>;
  sendMessage(chatId: string, text: string, options?: SendOptions): Promise<Message>;
  editMessage?(chatId: string, messageId: string | number, text: string, options?: SendOptions): Promise<void>;
  deleteMessage?(chatId: string, messageId: string | number): Promise<void>;
  sendVoice?(chatId: string, audioBuffer: Buffer, options?: SendOptions): Promise<void>;
  sendTyping?(chatId: string): Promise<void>;
  onMessage(handler: (message: Message) => Promise<void>): void;
  shutdown(): Promise<void>;
}

export interface SendOptions {
  parseMode?: "Markdown" | "HTML";
  replyToMessageId?: string | number;
  inlineKeyboard?: InlineButton[][];
}

export interface InlineButton {
  text: string;
  callbackData?: string;
  url?: string;
}

// ── Scheduler Interface ──
export interface ScheduledTask {
  id: string;
  name: string;
  cron?: string;
  intervalMs?: number;
  nextRun: Date;
  enabled: boolean;
  handler: () => Promise<void>;
}

// ── Agent Types ──
export interface AgentConfig {
  maxIterations: number;
  maxTokensPerTurn: number;
  systemPrompt: string;
  tools: Tool[];
  memoryProviders: MemoryProvider[];
  llmProvider: LLMProvider;
}

export interface AgentSession {
  id: string;
  chatId: string;
  userId: string;
  channel: ChannelType;
  messages: LLMMessage[];
  createdAt: Date;
  lastActivity: Date;
}

// ── Plugin Interface ──
export interface Plugin {
  name: string;
  version: string;
  initialize(bot: BotCore): Promise<void>;
  shutdown?(): Promise<void>;
}

export interface BotCore {
  config: GravityClawConfig;
  channels: Map<ChannelType, Channel>;
  tools: Map<string, Tool>;
  memoryProviders: MemoryProvider[];
  llmProviders: Map<string, LLMProvider>;
  activeLLM: LLMProvider;
  scheduler: { add(task: Omit<ScheduledTask, "id">): string; remove(id: string): void };
  agent: { processMessage(message: Message): Promise<string> };
}

// ── Config ──
export interface GravityClawConfig {
  telegram: {
    botToken: string;
    authorizedUserIds: number[];
  };
  llm: {
    defaultProvider: string;
    failoverOrder: string[];
    maxIterations: number;
    providers: Record<string, { apiKey: string; model: string; baseUrl?: string; imagenKey?: string }>;
  };
  memory: {
    sqlitePath: string;
    supabaseUrl?: string;
    supabaseKey?: string;
    supabaseServiceKey?: string;
    pineconeApiKey?: string;
    pineconeIndex?: string;
  };
  voice: {
    whisperApiKey?: string;
    elevenLabsApiKey?: string;
    elevenLabsApiKeyAlt?: string;
    elevenLabsVoiceId?: string;
    openaiTtsModel?: string;
  };
  gmail?: {
    credentialsPath?: string;
    tokenPath?: string;
  };
  tools: {
    shellEnabled: boolean;
    shellAllowlist: string[];
    fileRootPath: string;
    browserEnabled: boolean;
    searchProvider: "google" | "bing" | "duckduckgo";
    searchApiKey?: string;
  };
  mcp: {
    configPath: string;
    servers: Record<string, MCPServerConfig>;
  };
  scheduler: {
    morningBriefingHour: number;
    eveningRecapHour: number;
    heartbeatIntervalMs: number;
  };
  webhooks: {
    enabled: boolean;
    port: number;
  };
  vidRush: {
    bufferApiKey: string;
    bufferOrgId: string;
  };
  security: {
    maxAgentIterations: number;
    dangerousCommandConfirmation: boolean;
    auditLogPath: string;
  };
}

export interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  transport: "stdio" | "sse";
  url?: string;
}
