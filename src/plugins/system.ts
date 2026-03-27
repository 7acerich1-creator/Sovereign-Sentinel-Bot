// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Plugin System
// Trait-based: Provider, Channel, Tool, Memory. Swap via config.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Plugin, BotCore, Tool, MemoryProvider, LLMProvider, Channel, ChannelType } from "../types";

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private bot: BotCore;

  constructor(bot: BotCore) {
    this.bot = bot;
  }

  async register(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      console.warn(`⚠️ Plugin "${plugin.name}" already registered — replacing`);
      await this.unregister(plugin.name);
    }

    try {
      await plugin.initialize(this.bot);
      this.plugins.set(plugin.name, plugin);
      console.log(`🔌 Plugin loaded: ${plugin.name} v${plugin.version}`);
    } catch (err: any) {
      console.error(`❌ Plugin "${plugin.name}" failed to initialize: ${err.message}`);
    }
  }

  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) return;
    if (plugin.shutdown) await plugin.shutdown();
    this.plugins.delete(name);
    console.log(`🔌 Plugin unloaded: ${name}`);
  }

  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  listPlugins(): Array<{ name: string; version: string }> {
    return Array.from(this.plugins.values()).map((p) => ({
      name: p.name,
      version: p.version,
    }));
  }

  async shutdownAll(): Promise<void> {
    for (const [name, plugin] of this.plugins) {
      try {
        if (plugin.shutdown) await plugin.shutdown();
      } catch (err: any) {
        console.error(`Error shutting down plugin ${name}:`, err.message);
      }
    }
    this.plugins.clear();
  }
}

// ── Built-in Memory Tool (expose memory operations to LLM) ──
export class MemoryTool implements Tool {
  private providers: MemoryProvider[];

  constructor(providers: MemoryProvider[]) {
    this.providers = providers;
  }

  definition = {
    name: "remember_fact",
    description: "Store a fact, preference, or important information to persistent memory.",
    parameters: {
      key: { type: "string" as const, description: "Short key/name for the fact" },
      value: { type: "string" as const, description: "The fact/information to remember" },
      category: { type: "string" as const, description: "Category: identity, preferences, goals, general" },
    },
    required: ["key", "value"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const key = String(args.key);
    const value = String(args.value);
    const category = String(args.category || "general");

    for (const provider of this.providers) {
      try {
        await provider.saveFact(key, value, category);
      } catch (err: any) {
        console.error(`Memory save error (${provider.name}):`, err.message);
      }
    }
    return `Remembered: ${key} = ${value} [${category}]`;
  }
}

export class RecallTool implements Tool {
  private providers: MemoryProvider[];

  constructor(providers: MemoryProvider[]) {
    this.providers = providers;
  }

  definition = {
    name: "recall_memory",
    description: "Search memories and facts by keyword or topic.",
    parameters: {
      query: { type: "string" as const, description: "What to search for in memory" },
    },
    required: ["query"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query);
    const allResults: string[] = [];

    for (const provider of this.providers) {
      try {
        const facts = await provider.getFacts();
        const matchingFacts = facts.filter(
          (f) => f.key.toLowerCase().includes(query.toLowerCase()) ||
                 f.value.toLowerCase().includes(query.toLowerCase())
        );

        if (matchingFacts.length > 0) {
          allResults.push(`[${provider.name} — Facts]\n` +
            matchingFacts.map((f) => `${f.key}: ${f.value}`).join("\n"));
        }

        const searchResults = await provider.search(query, 3);
        if (searchResults.length > 0) {
          allResults.push(`[${provider.name} — Search]\n` +
            searchResults.map((r) => r.content).join("\n"));
        }
      } catch {
        // Non-critical
      }
    }

    return allResults.length > 0 ? allResults.join("\n\n") : "No memories found matching that query.";
  }
}
