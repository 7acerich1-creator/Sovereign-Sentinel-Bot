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
// Per-LLM-call spend logging. Fire-and-forget, never blocks the loop.
import { logSpend } from "../tools/spend-logger";

// Persona-based system prompt generation is now handled by getSystemPrompt(persona)

export interface AgentIdentity {
  agentName: string;
  namespace: string;
  defaultNiche?: string;
}

export class AgentLoop {
  // Made public so the Sapphire DM block in index.ts can call switchPrimary()
  // on the underlying FailoverLLM for introspective routing.
  public llm: LLMProvider;
  private tools: Map<string, Tool>;
  private memoryProviders: MemoryProvider[];
  private llmProviders: Map<string, LLMProvider> = new Map();
  private pinecone: PineconeMemory | null = null;
  // S130h (2026-05-04): default identity is now a SENTINEL, not "veritas".
  // Before this change, every AgentLoop instance silently posed as veritas
  // until setIdentity was called. If setIdentity ever failed for any agent,
  // it would write to / recall from the wrong silo invisibly. The sentinel
  // makes that failure mode loud — any unconfigured agent shows up clearly
  // in logs as "_uninitialized" instead of impersonating Veritas.
  private identity: AgentIdentity = { agentName: "_uninitialized", namespace: "_orphan" };
  // Optional callback fired before each tool execution (per-message). Used by
  // Sapphire DM handler to send tool indicators to Telegram.
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

  // Set per-message tool observer. Cleared automatically after processMessage.
  setToolCallObserver(observer?: (name: string, args: Record<string, unknown>) => Promise<void> | void): void {
    this.toolCallObserver = observer;
  }

  // Per-message context budget overrides. Sapphire DMs use cap=6 to stop
  // 12K-token bloat. Reset to undefined after each processMessage.
  private contextOverrides?: { maxRecentMessages?: number; skipSemanticSearch?: boolean };
  setContextOverrides(opts?: { maxRecentMessages?: number; skipSemanticSearch?: boolean }): void {
    this.contextOverrides = opts;
  }

  // Per-message LLMOptions overrides. Used by the Sapphire DM lane to inject
  // Anthropic-native server tools (web_search_20250305), extended thinking
  // budget, and the interleaved-thinking beta header on every Anthropic call
  // this turn. Other providers ignore unknown options. The Sapphire DM call
  // site sets these before processMessage and clears them in finally so
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

  // Replace the entire tool set for a single message (used by Sapphire
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
   * Detect conversational messages that don't need tool access.
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

    // turn_id correlates all LLM calls within a single processMessage.
    // Multiple iterations of the agent loop share one turn_id; the dashboard
    // can sum them or display them separately.
    const turnId = randomUUID();

    // LIGHT MODE — tools disabled, single-pass text response.
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

    // DISPATCH MODE — bypass all memory loading for dispatch tasks.
    // Root cause of token bloat: buildContext() loads 20 messages × 3 providers
    // + 50 facts + 3 summaries + 9 search results + 3 Pinecone recalls = ~48 context
    // messages for a simple dispatch task that only needs the payload.
    // Dispatch tasks carry their own instructions — memory/history is pure waste.
    const isDispatch = message.metadata?.isDispatch === true;

    // 1. Build context from memory (SKIP conversation history for dispatch —
    // they carry their own payload), but still inject ACTIVE CROSS-CREW RULES
    // from the shared namespace so dispatched agents act under current rules.
    let context: LLMMessage[];
    if (isDispatch) {
      context = [];
      console.log(`⚡ [AgentLoop] DISPATCH MODE — skipping conversation history`);

      // S130g (2026-05-04): Hive-mind continuity for automated work.
      // Without this, when Veritas (or any agent) dispatches to Alfred/Yuki/etc,
      // the receiving agent had ZERO visibility into cross-crew rules persisted
      // in the `shared` namespace. The hive mind worked in DM mode but
      // collapsed during automated dispatches — defeating the whole point.
      // Cost: 1 Pinecone query per dispatch, top 2 results @ score >= 0.70.
      // Threshold 0.70 (vs DM mode 0.75) because dispatch directives are
      // shorter/more structured and may not match recall vectors as densely.
      // Own-namespace recall is intentionally skipped — dispatch payloads are
      // explicit instructions; the agent's own past chitchat isn't relevant.
      if (this.pinecone?.isReady() && message.content.length > 10) {
        try {
          // S130h: Also pull from legacy namespaces during dispatch-mode recall,
          // so pre-rename rules and patterns flow into automated work too.
          const { legacyNamespacesFor } = await import("./agent-namespaces");
          const legacyNs = legacyNamespacesFor(this.identity.agentName);

          const sharedQueries: Promise<any[]>[] = [];
          sharedQueries.push(
            this.identity.namespace === "shared"
              ? Promise.resolve([])
              : this.pinecone.queryRelevant(message.content, 2, "shared", 0.70)
          );
          // Add a small (top 1) legacy read so pre-rename rules also reach
          // dispatched work. Threshold 0.70 (matching shared) — dispatch
          // directives are short/structured, so we lower the bar slightly.
          for (const ns of legacyNs) {
            if (ns !== this.identity.namespace && ns !== "shared") {
              sharedQueries.push(this.pinecone.queryRelevant(message.content, 1, ns, 0.70));
            }
          }
          const results = await Promise.all(sharedQueries);
          const merged = results.flat();

          if (merged.length > 0) {
            const recallText = merged.map(
              (r, i) => `[${i + 1}] (${r.agent}/${r.type}, score: ${r.score.toFixed(2)}) ${r.content}`
            ).join("\n");
            context.push({
              role: "system",
              content: `[ACTIVE CROSS-CREW RULES — apply when executing this dispatch]\n${recallText}`,
            });
            console.log(`🔮 [Pinecone] Dispatch shared-recall: injected ${merged.length} active rules (scores: ${merged.map(r => r.score.toFixed(2)).join(", ")})`);
          } else {
            console.log(`⚡ [AgentLoop] DISPATCH MODE — no shared/legacy rules matched the directive`);
          }
        } catch (err: any) {
          console.error(`[Pinecone dispatch-recall] ${err.message} — proceeding without shared rules`);
        }
      }
    } else {
      console.log(`🧠 [AgentLoop] Building context for message: "${message.content.slice(0, 50)}"`);
      context = await this.buildContext(message);
      console.log(`🧠 [AgentLoop] Context built: ${context.length} messages`);

      // 1b. Pinecone semantic recall — inject relevant past intelligence.
      // Cross-namespace: query own namespace AND `shared` (cross-cutting insights
      // written by the insight-extractor when an agent's output applies beyond
      // its own lane), AND legacy namespaces (S130h transitional dual-read so
      // pre-rename data stays accessible). Weight own > shared > legacy.
      // Dedup by content prefix when merging so a vector that lives in two
      // namespaces (mid-migration) can't double-count.
      if (this.pinecone?.isReady() && message.content.length > 10) {
        try {
          // Resolve legacy namespaces this agent should also read from.
          // S130h: during the namespace rename transition (e.g. "hooks" → "alfred"),
          // pre-rename data lives in the old namespace. Pulling from both ensures
          // continuity until the legacy data ages out naturally.
          const { legacyNamespacesFor } = await import("./agent-namespaces");
          const legacyNs = legacyNamespacesFor(this.identity.agentName);

          const queries: Promise<any[]>[] = [
            this.pinecone.queryRelevant(message.content, 3, this.identity.namespace, 0.75),
          ];
          if (this.identity.namespace !== "shared") {
            queries.push(this.pinecone.queryRelevant(message.content, 2, "shared", 0.75));
          } else {
            queries.push(Promise.resolve([]));
          }
          // Add a small (top 1 each) read from any legacy namespace this agent has.
          for (const ns of legacyNs) {
            if (ns !== this.identity.namespace) {
              queries.push(this.pinecone.queryRelevant(message.content, 1, ns, 0.75));
            }
          }

          const results = await Promise.all(queries);
          const ownRecalls = results[0];
          const sharedRecalls = results[1];
          const legacyRecalls = results.slice(2).flat();

          // Merge: own first (higher weight), then shared, then legacy, dedup by content prefix.
          const seen = new Set<string>();
          const merged: typeof ownRecalls = [];
          for (const r of [...ownRecalls, ...sharedRecalls, ...legacyRecalls]) {
            const key = r.content.slice(0, 80);
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(r);
          }
          if (merged.length > 0) {
            const recallText = merged.map(
              (r, i) => `[${i + 1}] (${r.agent}/${r.type}, score: ${r.score.toFixed(2)}) ${r.content}`
            ).join("\n");
            context.push({
              role: "system",
              content: `[RELEVANT PAST INTELLIGENCE — from crew semantic memory]\n${recallText}`,
            });
            console.log(`🔮 [Pinecone] Injected ${merged.length} relevant memories (own=${ownRecalls.length}, shared=${sharedRecalls.length}, legacy=${legacyRecalls.length}, scores: ${merged.map(r => r.score.toFixed(2)).join(", ")})`);
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

    // CONVERSATIONAL DETECTION — strip tools for chat messages.
    // Gemini sees 35 tool schemas and compulsively calls them even on "hey what's up".
    // The system prompt says "don't use tools for conversation" but Gemini ignores it.
    // Fix: detect conversational messages and route to text-only mode (zero tools).
    // If the user actually needs a tool, they'll ask explicitly and hit the full path.
    const isConversational = !isDispatch && !isTextOnly && this.isConversationalMessage(message.content);

    let toolDefs: ToolDefinition[];
    if (isTextOnly || isConversational) {
      // LIGHT MODE — ship zero tools. LLM must return text.
      // Also used for conversational messages to prevent tool spam.
      toolDefs = [];
      console.log(`⚡ [AgentLoop] ${isConversational ? "CONVERSATIONAL" : "LIGHT"} MODE — 0 tools (text-only response)`);
    } else if (isDispatch) {
      // DISPATCH MODE — only include tools the agent actually needs.
      // Sending 33+ tool schemas (each 200-500 tokens) to every dispatch call
      // adds ~5-8K tokens of dead weight. Dispatch tasks have explicit
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
      // maxTokens 16384 — cost on flash-lite is fractions of a cent per long
      // reply; latency only increases when the model actually fills the
      // budget (rare). Removes ceiling for "deep/long reply" requests.
      // Merge per-message LLMOptions overrides (server tools, thinking, betas).
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

      // Fire-and-forget spend log — every iteration is a separate row.
      logSpend(response, {
        agentName: this.identity.agentName,
        channel: message.channel,
        chatId: message.chatId,
        turnId,
        iterationCount: iterations,
      });

      // Empty-response retry + diagnostic.
      // Symptom: Gemini returns finishReason=STOP|SAFETY|OTHER with content=""
      // and zero tool calls — usually the safety classifier silently zeroing
      // out introspective threads ("self-aware AI" cluster), sometimes a
      // token-exhaustion edge or a transient API blip. Old code surfaced
      // "⚠️ No response generated." which was both ugly and unhelpful for
      // diagnosis. New behavior: log finishReason + provider + usage,
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
          // Same overrides merge on the empty-response retry path.
          const retry = await activeLLM.generate(context, {
            systemPrompt: systemPrompt,
            tools: toolDefs.length > 0 ? toolDefs : undefined,
            maxTokens: 16384,
            ...(this.llmOptionsOverrides || {}),
          });
          console.log(`🔁 [AgentLoop] Retry — finishReason: ${retry.finishReason}, contentLen: ${retry.content?.length || 0}`);
          // Log the retry call's spend too — it's a separate billed call.
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

        // Strip hidden <thinking> blocks before returning to Telegram or saving to memory.
        if (finalResponse.includes("<thinking>")) {
          finalResponse = finalResponse.replace(/<thinking>[\s\S]*?<\/thinking>/i, "").trim();
        }

        // Skip memory save + Pinecone embed for dispatch tasks.
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

          // S130g (2026-05-04): Fire insight-extractor on DM turn completion.
          // Previously the extractor only ran on dispatch completions, which
          // meant rules the Architect dictated in real-time DM conversations
          // (the most strategically valuable kind — e.g. Veritas's
          // "legacy outliers are noise, post-reset outliers are signal" rule)
          // were persisted to the agent's own namespace + knowledge_nodes
          // but NEVER got promoted to `shared`, so other agents' next turns
          // couldn't recall them. This closes that gap. Per-turn cost is
          // ~$0.00003 (Gemini Flash); the extractor SKIPs non-novel turns
          // so chitchat doesn't pollute the shared store. Substantive
          // turns only — short fallbacks (under 100 chars) are skipped.
          if (finalResponse.length >= 100) {
            const agentKey = (this.identity.agentName || persona.name || "").toLowerCase();
            if (agentKey) {
              import("./insight-extractor")
                .then(({ extractAndStoreInsight }) =>
                  extractAndStoreInsight(agentKey, "dm_conversation", finalResponse)
                )
                .catch((err: any) =>
                  console.error(`[InsightExtractor] DM-turn extraction failed: ${err?.message}`)
                );
            }
          }
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
        // agentName populated from AgentLoop identity so tools that scope by
        // agent (memory, archival, etc.) can route correctly.
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

      // ─── FILING-TOOL TERMINATION (S130r, 2026-05-05; widened S130t, 2026-05-06) ───
      // Once an agent calls a "filing" tool (propose_task / file_briefing /
      // save_content_draft / crew_dispatch.dispatch), it should not call that
      // SAME filing tool again in the same turn — that's the double-file race
      // (Vector filed today's daily report twice, 26s apart, on dispatch).
      //
      // Additionally, in non-dispatch DM mode, after ANY filing event the
      // agent should stop iterating entirely and produce one final text
      // reply — that closes the "Yuki responds 'Yes' then drifts into
      // memetic_trigger_judge cycles" hijack pattern.
      //
      // Implementation: track which filing tools fired this turn; remove
      // them from the available tool surface for subsequent iterations.
      // In DM mode, strip ALL tools after first filing (force text reply).
      // In dispatch mode, strip only the filing tool that fired (so the
      // agent can still call crew_dispatch.complete to close the dispatch).
      const FILING_TOOLS = new Set([
        "propose_task",
        "file_briefing",
        "save_content_draft",
      ]);
      const filedThisTurn: string[] = [];
      for (const tc of response.toolCalls) {
        if (FILING_TOOLS.has(tc.name)) {
          filedThisTurn.push(tc.name);
        } else if (tc.name === "crew_dispatch") {
          try {
            const parsed =
              typeof (tc as any).arguments === "string"
                ? JSON.parse((tc as any).arguments)
                : (tc as any).arguments || (tc as any).input;
            if (parsed?.action === "dispatch") filedThisTurn.push("crew_dispatch_dispatch");
          } catch { /* ignore parse errors */ }
        }
      }

      if (filedThisTurn.length > 0) {
        if (!isDispatch && !isConversational && !isTextOnly) {
          // DM mode — strip everything to force final text reply
          console.log(
            `📮 [AgentLoop] REPLY MODE: filing tool detected (${filedThisTurn.join(", ")}, iter ${iterations}) — stripping all tools next iteration to force final text reply`
          );
          toolDefs = [];
        } else {
          // Dispatch / scheduled / other modes — only strip the specific
          // filing tools that fired, so the agent can't double-file but
          // can still call crew_dispatch.complete or other bookkeeping.
          const stripNames = new Set(
            filedThisTurn.filter((n) => n !== "crew_dispatch_dispatch")
          );
          if (stripNames.size > 0) {
            const before = toolDefs.length;
            toolDefs = toolDefs.filter((td) => !stripNames.has(td.name));
            console.log(
              `📮 [AgentLoop] DISPATCH MODE: filing tool fired (${[...stripNames].join(", ")}, iter ${iterations}) — removed from surface (${before}→${toolDefs.length}) to prevent double-file`
            );
          }
        }
      }
    }

    // Max iterations reached
    const lastAssistant = context.filter((m) => m.role === "assistant").pop();
    return lastAssistant?.content || "⚠️ Agent loop reached maximum iterations without a final response.";
  }

  private async buildContext(message: Message): Promise<LLMMessage[]> {
    const context: LLMMessage[] = [];

    // Use ONLY the first (primary) memory provider for context.
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

      // Load recent messages — default 15. Override via contextOverrides.
      const recentCap = this.contextOverrides?.maxRecentMessages ?? 15;
      let recent = await provider.getRecentMessages(message.chatId, recentCap);

      // ── HYDRATION PROTOCOL ──
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

    // Hard cap on retry loops. Track (toolName + JSON args) — if same call
    // signature repeats 2+ times in this message, refuse the third+ call.
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
        // Notify observer (Sapphire DM uses this to send tool indicators)
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
