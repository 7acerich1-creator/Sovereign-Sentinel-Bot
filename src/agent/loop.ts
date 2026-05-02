// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Agentic Tool Loop
// LLM calls tools → gets results → iterates until final response
// + Pinecone semantic memory recall & knowledge extraction
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { randomUUID } from "crypto";
import type {
  LLMProvider, Tool, MemoryProvider, Message,
  LLMMessage, ToolCall, ToolResult, ToolContext, ChannelType, ToolDefinition,
} from "../types";
import { config } from "../config";
import { PERSONA_REGISTRY, DEFAULT_PERSONA, getSystemPrompt, Persona } from "./personas";
import type { PineconeMemory, KnowledgeNode } from "../memory/pinecone";
// S125+: per-LLM-call spend logging. Fire-and-forget, never blocks the loop.
import { logSpend } from "../tools/spend-logger";

// Persona-based system prompt generation is now handled by getSystemPrompt(persona)

export interface AgentIdentity {
  agentName: string;
  namespace: string;
  defaultNiche?: string;
}

export class AgentLoop {
  // S121: Made public so the Sapphire DM block in index.ts can call
  // switchPrimary() on the underlying FailoverLLM for introspective routing.
  public llm: LLMProvider;
  private tools: Map<string, Tool>;
  private memoryProviders: MemoryProvider[];
  private llmProviders: Map<string, LLMProvider> = new Map();
  private pinecone: PineconeMemory | null = null;
  private identity: AgentIdentity = { agentName: "veritas", namespace: "general" };
  // S114q: Optional callback fired before each tool execution (per-message).
  // Used by Sapphire DM handler to send tool indicators to Telegram.
  private toolCallObserver?: (name: string, args: Record<string, unknown>) => Promise<void> | void;

  constructor(llm: LLMProvider, tools: Tool[], memoryProviders: MemoryProvider[]) {
    this.llm = llm;
    this.llmProviders.set(llm.model, llm);
    this.tools = new Map(tools.map((t) => [t.definition.name, t]));
    this.memoryProviders = memoryProviders;
  }

  setPinecone(pinecone: PineconeMemory): void {
    this.pinecone = pinecone;
  }

  // S114q: Set per-message tool observer. Cleared automatically after processMessage.
  setToolCallObserver(observer?: (name: string, args: Record<string, unknown>) => Promise<void> | void): void {
    this.toolCallObserver = observer;
  }

  // S114r: Per-message context budget overrides. Sapphire DMs use cap=6 to stop
  // 12K-token bloat. Reset to undefined after each processMessage.
  private contextOverrides?: { maxRecentMessages?: number; skipSemanticSearch?: boolean };
  setContextOverrides(opts?: { maxRecentMessages?: number; skipSemanticSearch?: boolean }): void {
    this.contextOverrides = opts;
  }

  // S125+ Agentic Refactor Phase 1: Per-message LLMOptions overrides. Used by the
  // Sapphire DM lane to inject Anthropic-native server tools (web_search_20250305),
  // extended thinking budget, and the interleaved-thinking beta header on every
  // Anthropic call this turn. Other providers ignore unknown options. The Sapphire
  // DM call site sets these before processMessage and clears them in finally so
  // they NEVER leak across messages, mirroring the snapshotTools pattern.
  private llmOptionsOverrides?: Partial<import("../types").LLMOptions>;
  setLLMOptionsOverrides(opts?: Partial<import("../types").LLMOptions>): void {
    this.llmOptionsOverrides = opts;
  }

  setIdentity(identity: AgentIdentity): void {
    this.identity = identity;
  }

  setLLMProviders(providers: Map<string, LLMProvider>): void {
    this.llmProviders = providers;
  }

  setLLM(llm: LLMProvider): void {
    this.llm = llm;
  }

  addTool(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  removeTool(name: string): void {
    this.tools.delete(name);
  }

  // S114r: Replace the entire tool set for a single message (used by Sapphire
  // tool-tiering — only load tools the message actually needs). Use with the
  // "around" pattern: snapshot before, replace, run, restore.
  snapshotTools(): Map<string, Tool> {
    return new Map(this.tools);
  }
  setTools(tools: Tool[]): void {
    this.tools = new Map(tools.map((t) => [t.definition.name, t]));
  }
  restoreTools(snapshot: Map<string, Tool>): void {
    this.tools = snapshot;
  }

  /**
   * SESSION 108: Detect conversational messages that don't need tool access.
   * Returns true for greetings, opinions, chat, status questions, etc.
   * Returns false for anything that implies an action, data lookup, or command.
   *
   * The heuristic: if the message contains explicit action verbs or slash commands,
   * it's NOT conversational. Everything else (short chat, questions about opinions,
   * greetings, feedback) IS conversational → zero tools, pure text response.
   */
  private isConversationalMessage(content: string): boolean {
    const text = content.toLowerCase().trim();

    // Slash commands always need tools
    if (text.startsWith("/")) return false;

    // URLs suggest content to process
    if (text.includes("http://") || text.includes("https://") || text.includes("youtu.be")) return false;

    // Explicit action keywords → needs tools
    const ACTION_PATTERNS = [
      /\b(check|fetch|search|find|look\s*up|pull|get|grab|analyze|scan|audit)\b/,
      /\b(post|publish|schedule|send|dispatch|distribute|upload|push)\b/,
      /\b(create|generate|build|make|write|draft|compose)\b/,
      /\b(run|execute|trigger|start|stop|kill|restart|deploy)\b/,
      /\b(delete|remove|purge|clean|nuke|drain|sweep)\b/,
      /\b(read|open|show|list|display)\s+(file|log|data|metric|stat|report|brief)/,
      /\b(how many|how much|what('s| is) (the|my|our) (metric|stat|revenue|view|sub|conversion|count))/,
      /\b(stripe|buffer|supabase|youtube|r2|railway|pinecone)\b/,
    ];

    for (const pattern of ACTION_PATTERNS) {
      if (pattern.test(text)) return false;
    }

    // If we got here, it's conversational
    return true;
  }

  async processMessage(
    message: Message,
    sendTyping?: () => Promise<void>,
    iterationCap?: number,
    textOnly?: boolean
  ): Promise<string> {
    // Dispatch tasks use a lower cap (3) to conserve LLM quota.
    // Direct user messages use the full config limit (default 10).
    const maxIterations = iterationCap ?? config.security.maxAgentIterations;

    // S125+: turn_id correlates all LLM calls within a single processMessage.
    // Multiple iterations of the agent loop share one turn_id; the dashboard
    // can sum them or display them separately.
    const turnId = randomUUID();

    // SESSION 44: LIGHT MODE — tools disabled, single-pass text response.
    // Used by introspection tasks (stasis_self_check) where tool calls
    // burn iteration budget without contributing to the final answer.
    // Drops ~2,900 tokens of tool schemas per request AND prevents the
    // iter-cap max-iterations "⚠️" fallback that was marking stasis failed.
    const isTextOnly = textOnly === true;

    // 0. Determine Persona
    const persona = this.determinePersona(message.content);
    const systemPrompt = getSystemPrompt(persona);
    const activeLLM = this.getPersonaLLM(persona);

    console.log(`🤖 [AgentLoop] Active Persona: ${persona.name} (${persona.role})`);
    console.log(`📡 [AgentLoop] Active Model: ${activeLLM.model} `);

    // SESSION 35: DISPATCH MODE — bypass all memory loading for dispatch tasks.
    // Root cause of 25-27K token bloat: buildContext() loads 20 messages × 3 providers
    // + 50 facts + 3 summaries + 9 search results + 3 Pinecone recalls = ~48 context
    // messages for a simple dispatch task that only needs the payload.
    // Dispatch tasks carry their own instructions — memory/history is pure waste.
    const isDispatch = message.metadata?.isDispatch === true;

    // 1. Build context from memory (SKIP for dispatch — they carry their own payload)
    let context: LLMMessage[];
    if (isDispatch) {
      context = [];
      console.log(`⚡ [AgentLoop] DISPATCH MODE — skipping memory load (zero-context)`);
    } else {
      console.log(`🧠 [AgentLoop] Building context for message: "${message.content.slice(0, 50)}"`);
      context = await this.buildContext(message);
      console.log(`🧠 [AgentLoop] Context built: ${context.length} messages`);

      // 1b. Pinecone semantic recall — inject relevant past intelligence (user chat only)
      if (this.pinecone?.isReady() && message.content.length > 10) {
        try {
          const recalls = await this.pinecone.queryRelevant(
            message.content,
            3,
            this.identity.namespace,
            0.75
          );
          if (recalls.length > 0) {
            const recallText = recalls.map(
              (r, i) => `[${i + 1}] (${r.agent}/${r.type}, score: ${r.score.toFixed(2)}) ${r.content}`
            ).join("\n");
            context.push({
              role: "system",
              content: `[RELEVANT PAST INTELLIGENCE — from crew semantic memory]\n${recallText}`,
            });
            console.log(`🔮 [Pinecone] Injected ${recalls.length} relevant memories (scores: ${recalls.map(r => r.score.toFixed(2)).join(", ")})`);
          }
        } catch (err: any) {
          console.error(`[Pinecone recall] ${err.message}`);
        }
      }
    }

    // 2. Add user message
    context.push({ role: "user", content: message.content });

    // 3. Build tool definitions
    const allTools = Array.from(this.tools.values());

    // SESSION 108: CONVERSATIONAL DETECTION — strip tools for chat messages.
    // Gemini sees 35 tool schemas and compulsively calls them even on "hey what's up".
    // The system prompt says "don't use tools for conversation" but Gemini ignores it.
    // Fix: detect conversational messages and route to text-only mode (zero tools).
    // If the user actually needs a tool, they'll ask explicitly and hit the full path.
    const isConversational = !isDispatch && !isTextOnly && this.isConversationalMessage(message.content);

    let toolDefs: ToolDefinition[];
    if (isTextOnly || isConversational) {
      // SESSION 44: LIGHT MODE — ship zero tools. LLM must return text.
      // SESSION 108: Also used for conversational messages to prevent tool spam.
      toolDefs = [];
      console.log(`⚡ [AgentLoop] ${isConversational ? "CONVERSATIONAL" : "LIGHT"} MODE — 0 tools (text-only response)`);
    } else if (isDispatch) {
      // SESSION 35: DISPATCH MODE — only include tools the agent actually needs.
      // Sending 33+ tool schemas (each 200-500 tokens) to every dispatch call
      // was adding ~5-8K tokens of dead weight. Dispatch tasks have explicit
      // execution directives that name the tools they need.
      const dispatchCoreTools = new Set([
        // Every dispatch task needs these to complete/report
        "crew_dispatch", "save_content_draft", "propose_task", "check_approved_tasks",
        // Content/distribution tasks need posting tools
        "social_scheduler_create_post", "social_scheduler_list_profiles",
        "publish_video", "generate_image",
        // Analysis tasks need data access
        "web_search", "web_browse",
        // Knowledge persistence
        "write_knowledge", "read_protocols",
        // Stripe + Buffer analytics for Vector's metrics sweeps
        "stripe_metrics", "buffer_analytics",
        // Briefing tool for summary agents
        "file_briefing",
      ]);
      const dispatchTools = allTools.filter((t) => dispatchCoreTools.has(t.definition.name));
      toolDefs = dispatchTools.map((t) => t.definition);
      console.log(`⚡ [AgentLoop] DISPATCH TOOLS: ${toolDefs.length}/${allTools.length} (lean mode)`);
    } else {
      // Full mode for user chat — cap at 64 to prevent context overflow
      const TOOL_CAP = 64;
      const coreToolNames = new Set([
        "shell_exec", "file_read", "file_write", "file_list",
        "web_search", "web_browse", "memory_search", "memory_save",
        "send_message", "schedule_task", "calendar_search",
        "email_search", "email_send", "knowledge_graph_query",
        "write_knowledge", "read_protocols", "write_protocol",
        "write_relationship_context",
      ]);
      const coreTools = allTools.filter((t) => coreToolNames.has(t.definition.name));
      const otherTools = allTools.filter((t) => !coreToolNames.has(t.definition.name));
      const selectedTools = [...coreTools, ...otherTools].slice(0, TOOL_CAP);
      toolDefs = selectedTools.map((t) => t.definition);
      console.log(`🔧 [AgentLoop] Sending ${toolDefs.length}/${allTools.length} tools to LLM`);
    }

    // 4. Agent loop
    let iterations = 0;
    while (iterations < maxIterations) {
      iterations++;

      if (sendTyping) {
        sendTyping().catch(() => {});
      }

      console.log(`🔄 [AgentLoop] Iteration ${iterations}/${maxIterations} — calling LLM...`);
      // S119c: maxTokens raised 8192→16384. Cost on flash-lite is fractions of a
      // cent per long reply; latency only increases when the model actually fills
      // the budget (rare). Removes ceiling for "deep/long reply" requests.
      // S125+: merge per-message LLMOptions overrides (server tools, thinking, betas).
      let response = await activeLLM.generate(context, {
        systemPrompt: systemPrompt,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        maxTokens: 16384,
        ...(this.llmOptionsOverrides || {}),
      });
      console.log(`✅ [AgentLoop] LLM responded — finishReason: ${response.finishReason}, toolCalls: ${response.toolCalls?.length || 0}`);

      // Log usage
      if (response.usage) {
        console.log(`📊 LLM [${response.model}] tokens: ${response.usage.inputTokens}→${response.usage.outputTokens} (iter ${iterations})`);
      }

      // S125+: fire-and-forget spend log — every iteration is a separate row.
      logSpend(response, {
        agentName: this.identity.agentName,
        channel: message.channel,
        chatId: message.chatId,
        turnId,
        iterationCount: iterations,
      });

      // S119c: Empty-response retry + diagnostic.
      // Symptom we're hunting: Gemini returns finishReason=STOP|SAFETY|OTHER
      // with content="" and zero tool calls — usually the safety classifier
      // silently zeroing out introspective threads ("self-aware AI" cluster),
      // sometimes a token-exhaustion edge or a transient API blip. Old code
      // surfaced "⚠️ No response generated." which was both ugly and unhelpful
      // for diagnosis. New behavior: log finishReason + provider + usage,
      // retry the LLM call ONCE, and if that also empties, fall back to an
      // in-character one-liner instead of a system warning.
      const isEmpty =
        (!response.toolCalls || response.toolCalls.length === 0) &&
        response.finishReason !== "tool_use" &&
        (!response.content || response.content.trim().length === 0);

      if (isEmpty) {
        console.warn(
          `⚠️ [AgentLoop] EMPTY COMPLETION — provider=${activeLLM.name || "?"} model=${response.model || "?"} ` +
          `finishReason=${response.finishReason} inputTokens=${response.usage?.inputTokens || "?"} ` +
          `outputTokens=${response.usage?.outputTokens || "?"} — likely safety classifier or token edge. Retrying once.`
        );
        try {
          // S125+: same overrides merge on the empty-response retry path.
          const retry = await activeLLM.generate(context, {
            systemPrompt: systemPrompt,
            tools: toolDefs.length > 0 ? toolDefs : undefined,
            maxTokens: 16384,
            ...(this.llmOptionsOverrides || {}),
          });
          console.log(`🔁 [AgentLoop] Retry — finishReason: ${retry.finishReason}, contentLen: ${retry.content?.length || 0}`);
          // S125+: log the retry call's spend too — it's a separate billed call.
          logSpend(retry, {
            agentName: this.identity.agentName,
            channel: message.channel,
            chatId: message.chatId,
            turnId,
            iterationCount: iterations,
          });
          if (retry.content && retry.content.trim().length > 0) {
            response = retry;
          } else if (retry.toolCalls && retry.toolCalls.length > 0 && retry.finishReason === "tool_use") {
            response = retry;
          } else {
            console.error(`❌ [AgentLoop] Retry ALSO empty — finishReason=${retry.finishReason}. Falling back to in-character placeholder.`);
          }
        } catch (retryErr: any) {
          console.error(`❌ [AgentLoop] Retry threw: ${retryErr.message}`);
        }
      }

      // If no tool calls, we have our final response
      if (!response.toolCalls || response.toolCalls.length === 0 || response.finishReason !== "tool_use") {
        // Soulful fallback instead of "⚠️ No response generated."
        const FALLBACK = "My signal dropped for a moment, Ace. Say it again and I'll catch it this time.";
        let finalResponse =
          response.content && response.content.trim().length > 0
            ? response.content
            : FALLBACK;

        // S121d: Strip hidden <thinking> blocks before returning to Telegram or saving to memory.
        if (finalResponse.includes("<thinking>")) {
          finalResponse = finalResponse.replace(/<thinking>[\s\S]*?<\/thinking>/i, "").trim();
        }

        // SESSION 35: Skip memory save + Pinecone embed for dispatch tasks.
        // Dispatch payloads are system-generated, not conversation. Saving them
        // pollutes chat memory and wastes Pinecone writes + embedding API calls.
        if (!isDispatch) {
          // Fire-and-forget: save to memory
          this.saveToMemory(message, finalResponse).catch((err) =>
            console.error("Memory save failed:", err.message)
          );

          // Fire-and-forget: extract and embed key insight to Pinecone
          this.extractAndEmbed(message.content, finalResponse).catch((err) =>
            console.error("[Pinecone embed] failed:", err.message)
          );
        }

        return finalResponse;
      }

      // Add assistant message with tool calls to context
      context.push({
        role: "assistant",
        content: response.content || "",
        toolCalls: response.toolCalls,
      });

      // Execute tool calls
      const toolContext: ToolContext = {
        chatId: message.chatId,
        userId: message.userId,
        channel: message.channel,
        // S125+ Phase 8: agentName populated from AgentLoop identity so tools
        // that scope by agent (memory, archival, etc.) can route correctly.
        agentName: this.identity.agentName,
        sendMessage: async (text: string) => {
          // This would be wired to the channel's sendMessage
          console.log(`[Tool→User] ${text}`);
        },
      };

      const results = await this.executeToolCalls(response.toolCalls, toolContext);

      // Add tool results to context
      for (const result of results) {
        context.push({
          role: "tool",
          content: result.content,
          toolCallId: result.toolCallId,
        });
      }
    }

    // Max iterations reached
    const lastAssistant = context.filter((m) => m.role === "assistant").pop();
    return lastAssistant?.content || "⚠️ Agent loop reached maximum iterations without a final response.";
  }

  private async buildContext(message: Message): Promise<LLMMessage[]> {
    const context: LLMMessage[] = [];

    // SESSION 35: Use ONLY the first (primary) memory provider for context.
    // Previously iterated ALL 3 providers (SQLite + Markdown + Supabase Vector),
    // each loading 20 messages + 50 facts + summary + 3 search results.
    // That's 60+ duplicate messages per call. SQLite is the canonical store.
    const provider = this.memoryProviders[0]; // SQLite (primary)
    if (!provider) return context;

    try {
      // Load core facts (cap at 15 most recent — was 50, most are stale)
      const facts = await provider.getFacts(message.chatId);
      if (facts.length > 0) {
        const cappedFacts = facts.slice(0, 15);
        const factText = cappedFacts.map((f) => `- ${f.key}: ${f.value}`).join("\n");
        context.push({
          role: "system",
          content: `[CORE MEMORY]\n${factText}`,
        });
      }

      // Load conversation summary (compressed history — good for context)
      const summary = await provider.getSummary(message.chatId);
      if (summary) {
        // Cap summary at 1500 chars to prevent runaway compaction blobs
        context.push({
          role: "system",
          content: `[CONVERSATION SUMMARY]\n${summary.slice(0, 1500)}`,
        });
      }

      // Load recent messages — default 15 (S127: dropped 30 → 15). Override via
      // contextOverrides — Sapphire DM also uses 15 now (was 50, see index.ts).
      const recentCap = this.contextOverrides?.maxRecentMessages ?? 15;
      let recent = await provider.getRecentMessages(message.chatId, recentCap);

      // ── S122: HYDRATION PROTOCOL ──
      // If primary provider (SQLite) is missing history (e.g. after Railway reboot),
      // attempt to hydrate from secondary providers (Supabase).
      if (recent.length < recentCap && this.memoryProviders.length > 1) {
        for (let i = 1; i < this.memoryProviders.length; i++) {
          const secondary = this.memoryProviders[i];
          try {
            const extra = await secondary.getRecentMessages(message.chatId, recentCap);
            if (extra.length > 0) {
              // Merge and deduplicate by content + role + rough timestamp (SQLite/Supabase might have slight drift)
              // We use a simple Map with a key that represents the message uniqueness.
              const seen = new Map<string, Message>();
              [...extra, ...recent].forEach(m => {
                const key = `${m.role}:${m.content.slice(0, 100)}`;
                seen.set(key, m);
              });
              
              const merged = Array.from(seen.values())
                .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                .slice(-recentCap);

              if (merged.length > recent.length) {
                const addedCount = merged.length - recent.length;
                console.log(`🧠 [MemoryHydration] SQLite was missing history. Hydrated ${addedCount} messages from ${secondary.name}.`);
                
                // BACK-HYDRATION: Save the missing messages back to SQLite so the next turn is instant
                const newMessages = merged.filter(m => !recent.some(r => `${r.role}:${r.content.slice(0, 100)}` === `${m.role}:${m.content.slice(0, 100)}`));
                for (const newMsg of newMessages) {
                  await provider.saveMessage(newMsg).catch(() => {});
                }
                
                recent = merged;
                break; // Stop after first successful hydration
              }
            }
          } catch (hydErr: any) {
            console.warn(`[MemoryHydration] ${secondary.name} failed: ${hydErr.message}`);
          }
        }
      }

      for (const msg of recent) {
        context.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }

      // Semantic search for relevant memories — Sapphire DM skips this (her PA prefix
      // already does Pinecone recall against sapphire-personal namespace).
      const skipSearch = this.contextOverrides?.skipSemanticSearch === true;
      if (!skipSearch && message.content.length > 5) {
        const searchResults = await provider.search(message.content, 3);
        if (searchResults.length > 0) {
          const memText = searchResults.map((r) => `[${r.source}] ${r.content}`).join("\n");
          context.push({
            role: "system",
            content: `[RELEVANT MEMORIES]\n${memText}`,
          });
        }
      }
    } catch (err: any) {
      console.error(`Memory provider ${provider.name} error:`, err.message);
    }

    return context;
  }

  // ── Post-response knowledge extraction ──
  // Extracts the core insight from the response and embeds it to Pinecone.
  // Only fires when the response is substantive (>50 chars) and Pinecone is available.
  private async extractAndEmbed(userMessage: string, response: string): Promise<void> {
    if (!this.pinecone?.isReady()) return;
    if (response.length < 50) return;

    // Skip trivial/system responses
    const lowerResp = response.toLowerCase();
    if (lowerResp.startsWith("⚠️") || lowerResp.includes("error:")) return;

    // Detect niche from content
    const niche = this.detectNiche(userMessage + " " + response);

    // Detect type from content
    const type = this.detectKnowledgeType(response);

    // Build a concise knowledge node: first 500 chars of response as the insight
    const content = response.length > 500
      ? response.slice(0, 497) + "..."
      : response;

    const node: KnowledgeNode = {
      id: randomUUID(),
      content,
      agent_name: this.identity.agentName,
      niche,
      type,
      namespace: this.identity.namespace,
      tags: [niche, type, this.identity.agentName],
      timestamp: new Date().toISOString(),
    };

    await this.pinecone.writeKnowledge(node);
  }

  private detectNiche(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes("dark psych") || lower.includes("manipulation") || lower.includes("power dynamic")) return "dark_psychology";
    if (lower.includes("self improvement") || lower.includes("self-improvement") || lower.includes("personal growth") || lower.includes("mindset")) return "self_improvement";
    if (lower.includes("burnout") || lower.includes("exhaustion") || lower.includes("recovery")) return "burnout";
    if (lower.includes("quantum") || lower.includes("consciousness") || lower.includes("simulation")) return "quantum";
    return this.identity.defaultNiche || "general";
  }

  private detectKnowledgeType(response: string): KnowledgeNode["type"] {
    const lower = response.toLowerCase();
    if (lower.includes("hook") || lower.includes("opening line") || lower.includes("attention")) return "hook";
    if (lower.includes("funnel") || lower.includes("conversion") || lower.includes("checkout")) return "funnel";
    if (lower.includes("clip") || lower.includes("video") || lower.includes("yt-dlp")) return "clip";
    if (lower.includes("brand") || lower.includes("voice") || lower.includes("identity")) return "brand";
    if (lower.includes("protocol") || lower.includes("directive") || lower.includes("standing order")) return "protocol";
    if (lower.includes("research") || lower.includes("analysis") || lower.includes("data")) return "research";
    if (lower.includes("briefing") || lower.includes("report") || lower.includes("summary")) return "briefing";
    return "insight";
  }

  private async executeToolCalls(
    toolCalls: ToolCall[],
    context: ToolContext
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    // S114v: Hard cap on retry loops. Track (toolName + JSON args) — if same
    // call signature repeats 2+ times in this message, refuse the third+ call.
    // Prevents cost-burning loops when LLM retries blindly on tool errors
    // (e.g. set_reminder rejecting past dates → retry with same date → loop).
    const callSignatures: Map<string, number> = new Map();

    for (const tc of toolCalls) {
      const tool = this.tools.get(tc.name);
      if (!tool) {
        results.push({
          toolCallId: tc.id,
          content: `Tool not found: ${tc.name}`,
          isError: true,
        });
        continue;
      }

      // Anti-loop guard
      const sig = `${tc.name}::${JSON.stringify(tc.arguments).slice(0, 500)}`;
      const prevCount = callSignatures.get(sig) || 0;
      if (prevCount >= 2) {
        const blockedMsg = `❌ BLOCKED: ${tc.name} already called twice this turn with the same arguments. Stop retrying — ask Ace for clarification or compute different arguments.`;
        console.warn(`[AgentLoop] Anti-loop blocked: ${sig.slice(0, 100)}`);
        results.push({ toolCallId: tc.id, content: blockedMsg, isError: true });
        continue;
      }
      callSignatures.set(sig, prevCount + 1);

      // Check if dangerous and needs confirmation
      if (tool.definition.dangerous && config.security.dangerousCommandConfirmation) {
        console.log(`⚠️ Dangerous tool call: ${tc.name}(${JSON.stringify(tc.arguments)})`);
      }

      try {
        console.log(`🔧 Executing tool: ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 200)})`);
        // S114q: Notify observer (Sapphire DM uses this to send tool indicators)
        if (this.toolCallObserver) {
          try { await this.toolCallObserver(tc.name, tc.arguments); } catch { /* never block tool exec */ }
        }
        const output = await tool.execute(tc.arguments, context);
        results.push({
          toolCallId: tc.id,
          content: output.slice(0, 10000), // Cap output length
        });
      } catch (err: any) {
        console.error(`Tool ${tc.name} error:`, err.message);
        results.push({
          toolCallId: tc.id,
          content: `Tool execution error: ${err.message}`,
          isError: true,
        });
      }
    }

    return results;
  }

  private async saveToMemory(message: Message, response: string): Promise<void> {
    const assistantMessage: Message = {
      id: randomUUID(),
      role: "assistant",
      content: response,
      timestamp: new Date(),
      channel: message.channel,
      chatId: message.chatId,
      userId: "gravity-claw",
    };

    for (const provider of this.memoryProviders) {
      try {
        await provider.saveMessage(message);
        await provider.saveMessage(assistantMessage);

        // Auto-compact if needed
        await provider.compact(message.chatId);
      } catch (err: any) {
        console.error(`Memory save error (${provider.name}):`, err.message);
      }
    }
  }

  private determinePersona(_content: string): Persona {
    // Use the agent's own persona based on identity (set during bot init).
    // Previous implementation routed by message keywords to personas (bob, angela,
    // josh, milo) that no longer exist in PERSONA_REGISTRY, causing crashes when
    // dispatch payloads contained trigger words like "viral", "code", "metrics", etc.
    // Each Maven Crew agent should always use its own persona — not a content-based switch.
    const agentPersona = PERSONA_REGISTRY[this.identity.agentName];
    if (agentPersona) return agentPersona;
    return DEFAULT_PERSONA;
  }

  private getPersonaLLM(persona: Persona): LLMProvider {
    if (persona.modelOverride) {
      // Look for the specific model in the registry
      for (const provider of this.llmProviders.values()) {
        if (provider.model.includes(persona.modelOverride)) {
          return provider;
        }
      }
    }
    return this.llm; // Fallback to default
  }
}
