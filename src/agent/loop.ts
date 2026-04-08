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

// Persona-based system prompt generation is now handled by getSystemPrompt(persona)

export interface AgentIdentity {
  agentName: string;
  namespace: string;
  defaultNiche?: string;
}

export class AgentLoop {
  private llm: LLMProvider;
  private tools: Map<string, Tool>;
  private memoryProviders: MemoryProvider[];
  private llmProviders: Map<string, LLMProvider> = new Map();
  private pinecone: PineconeMemory | null = null;
  private identity: AgentIdentity = { agentName: "veritas", namespace: "general" };

  constructor(llm: LLMProvider, tools: Tool[], memoryProviders: MemoryProvider[]) {
    this.llm = llm;
    this.llmProviders.set(llm.model, llm);
    this.tools = new Map(tools.map((t) => [t.definition.name, t]));
    this.memoryProviders = memoryProviders;
  }

  setPinecone(pinecone: PineconeMemory): void {
    this.pinecone = pinecone;
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

  async processMessage(
    message: Message,
    sendTyping?: () => Promise<void>,
    iterationCap?: number
  ): Promise<string> {
    // Dispatch tasks use a lower cap (3) to conserve LLM quota.
    // Direct user messages use the full config limit (default 10).
    const maxIterations = iterationCap ?? config.security.maxAgentIterations;

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

    let toolDefs: ToolDefinition[];
    if (isDispatch) {
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
      const response = await activeLLM.generate(context, {
        systemPrompt: systemPrompt,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        maxTokens: 8192,
      });
      console.log(`✅ [AgentLoop] LLM responded — finishReason: ${response.finishReason}, toolCalls: ${response.toolCalls?.length || 0}`);

      // Log usage
      if (response.usage) {
        console.log(`📊 LLM [${response.model}] tokens: ${response.usage.inputTokens}→${response.usage.outputTokens} (iter ${iterations})`);
      }

      // If no tool calls, we have our final response
      if (!response.toolCalls || response.toolCalls.length === 0 || response.finishReason !== "tool_use") {
        const finalResponse = response.content || "⚠️ No response generated.";

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

      // Load recent messages — 10 is enough for conversational continuity (was 20×3=60)
      const recent = await provider.getRecentMessages(message.chatId, 10);
      for (const msg of recent) {
        context.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }

      // Semantic search for relevant memories (keep at 3 — useful for user chat)
      if (message.content.length > 5) {
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

      // Check if dangerous and needs confirmation
      if (tool.definition.dangerous && config.security.dangerousCommandConfirmation) {
        console.log(`⚠️ Dangerous tool call: ${tc.name}(${JSON.stringify(tc.arguments)})`);
        // For now, proceed with warning logged
      }

      try {
        console.log(`🔧 Executing tool: ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 200)})`);
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
