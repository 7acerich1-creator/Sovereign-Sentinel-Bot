// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Agentic Tool Loop
// LLM calls tools → gets results → iterates until final response
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { randomUUID } from "crypto";
import type {
  LLMProvider, Tool, MemoryProvider, Message,
  LLMMessage, ToolCall, ToolResult, ToolContext, ChannelType, ToolDefinition,
} from "../types";
import { config } from "../config";
import { PERSONA_REGISTRY, DEFAULT_PERSONA, getSystemPrompt, Persona } from "./personas";

// Persona-based system prompt generation is now handled by getSystemPrompt(persona)

export class AgentLoop {
  private llm: LLMProvider;
  private tools: Map<string, Tool>;
  private memoryProviders: MemoryProvider[];
  private llmProviders: Map<string, LLMProvider> = new Map();

  constructor(llm: LLMProvider, tools: Tool[], memoryProviders: MemoryProvider[]) {
    this.llm = llm;
    this.llmProviders.set(llm.model, llm);
    this.tools = new Map(tools.map((t) => [t.definition.name, t]));
    this.memoryProviders = memoryProviders;
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
    sendTyping?: () => Promise<void>
  ): Promise<string> {
    const maxIterations = config.security.maxAgentIterations;

    // 0. Determine Persona
    const persona = this.determinePersona(message.content);
    const systemPrompt = getSystemPrompt(persona);
    const activeLLM = this.getPersonaLLM(persona);

    console.log(`🤖 [AgentLoop] Active Persona: ${persona.name} (${persona.role})`);
    console.log(`📡 [AgentLoop] Active Model: ${activeLLM.model} `);

    // 1. Build context from memory
    console.log(`🧠 [AgentLoop] Building context for message: "${message.content.slice(0, 50)}"`);
    const context = await this.buildContext(message);
    console.log(`🧠 [AgentLoop] Context built: ${context.length} messages`);

    // 2. Add user message
    context.push({ role: "user", content: message.content });

    // 3. Build tool definitions — CAP at 64 to prevent LLM context overflow
    // 459 tools will choke most LLM providers
    const allTools = Array.from(this.tools.values());
    const TOOL_CAP = 64;
    const coreToolNames = new Set([
      // Built-in tools that should always be available
      "shell_exec", "file_read", "file_write", "file_list",
      "web_search", "web_browse", "memory_search", "memory_save",
      "send_message", "schedule_task", "calendar_search",
      "email_search", "email_send", "knowledge_graph_query",
    ]);
    // Prioritize core tools, then fill remaining slots
    const coreTools = allTools.filter((t) => coreToolNames.has(t.definition.name));
    const otherTools = allTools.filter((t) => !coreToolNames.has(t.definition.name));
    const selectedTools = [...coreTools, ...otherTools].slice(0, TOOL_CAP);
    const toolDefs: ToolDefinition[] = selectedTools.map((t) => t.definition);
    console.log(`🔧 [AgentLoop] Sending ${toolDefs.length}/${allTools.length} tools to LLM`);

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
        maxTokens: 4096,
      });
      console.log(`✅ [AgentLoop] LLM responded — finishReason: ${response.finishReason}, toolCalls: ${response.toolCalls?.length || 0}`);

      // Log usage
      if (response.usage) {
        console.log(`📊 LLM [${response.model}] tokens: ${response.usage.inputTokens}→${response.usage.outputTokens} (iter ${iterations})`);
      }

      // If no tool calls, we have our final response
      if (!response.toolCalls || response.toolCalls.length === 0 || response.finishReason !== "tool_use") {
        const finalResponse = response.content || "⚠️ No response generated.";

        // Fire-and-forget: save to memory
        this.saveToMemory(message, finalResponse).catch((err) =>
          console.error("Memory save failed:", err.message)
        );

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

    for (const provider of this.memoryProviders) {
      try {
        // Load core facts
        const facts = await provider.getFacts(message.chatId);
        if (facts.length > 0) {
          const factText = facts.map((f) => `- ${f.key}: ${f.value}`).join("\n");
          context.push({
            role: "system",
            content: `[CORE MEMORY]\n${factText}`,
          });
        }

        // Load conversation summary
        const summary = await provider.getSummary(message.chatId);
        if (summary) {
          context.push({
            role: "system",
            content: `[CONVERSATION SUMMARY]\n${summary}`,
          });
        }

        // Load recent messages
        const recent = await provider.getRecentMessages(message.chatId, 20);
        for (const msg of recent) {
          context.push({
            role: msg.role as "user" | "assistant",
            content: msg.content,
          });
        }

        // Semantic search for relevant memories
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
    }

    return context;
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

  private determinePersona(content: string): Persona {
    const text = content.toLowerCase();
    
    if (text.includes("bob") || text.includes("code") || text.includes("debug")) return PERSONA_REGISTRY.bob;
    if (text.includes("angela") || text.includes("marketing") || text.includes("viral")) return PERSONA_REGISTRY.angela;
    if (text.includes("josh") || text.includes("business") || text.includes("metrics") || text.includes("money")) return PERSONA_REGISTRY.josh;
    if (text.includes("milo") || text.includes("strategy") || text.includes("plan")) return PERSONA_REGISTRY.milo;

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
