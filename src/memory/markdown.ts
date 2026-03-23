// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Markdown Memory
// Human-readable .md files, git-friendly persistence
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import * as fs from "fs";
import * as path from "path";
import type { MemoryProvider, MemoryFact, MemorySearchResult, Message } from "../types";

export class MarkdownMemory implements MemoryProvider {
  name = "markdown";
  private dir: string;

  constructor(dir = "./memory") {
    this.dir = dir;
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    console.log(`✅ Markdown Memory initialized at ${this.dir}`);
  }

  async saveMessage(message: Message): Promise<void> {
    const logFile = path.join(this.dir, `chat_${message.chatId}.md`);
    const entry = `\n## ${message.role} — ${message.timestamp.toISOString()}\n${message.content}\n`;
    fs.appendFileSync(logFile, entry);
  }

  async getRecentMessages(chatId: string, limit = 20): Promise<Message[]> {
    const logFile = path.join(this.dir, `chat_${chatId}.md`);
    if (!fs.existsSync(logFile)) return [];

    const content = fs.readFileSync(logFile, "utf-8");
    const blocks = content.split(/\n## /).filter(Boolean).slice(-limit);

    return blocks.map((block) => {
      const firstLine = block.split("\n")[0];
      const roleMatch = firstLine.match(/^(user|assistant|system)/);
      const timeMatch = firstLine.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/);
      return {
        id: "",
        role: (roleMatch?.[1] || "user") as "user" | "assistant",
        content: block.split("\n").slice(1).join("\n").trim(),
        timestamp: timeMatch ? new Date(timeMatch[0]) : new Date(),
        channel: "telegram" as const,
        chatId,
        userId: "",
      };
    });
  }

  async saveFact(key: string, value: string, category = "general"): Promise<void> {
    const factsFile = path.join(this.dir, "facts.md");
    let content = fs.existsSync(factsFile) ? fs.readFileSync(factsFile, "utf-8") : "# Core Memory Facts\n\n";

    // Update or append
    const pattern = new RegExp(`^- \\*\\*${key}\\*\\*:.*$`, "m");
    const entry = `- **${key}**: ${value} _(${category})_`;

    if (pattern.test(content)) {
      content = content.replace(pattern, entry);
    } else {
      content += `${entry}\n`;
    }

    fs.writeFileSync(factsFile, content);
  }

  async getFacts(): Promise<MemoryFact[]> {
    const factsFile = path.join(this.dir, "facts.md");
    if (!fs.existsSync(factsFile)) return [];

    const content = fs.readFileSync(factsFile, "utf-8");
    const facts: MemoryFact[] = [];

    const lines = content.split("\n");
    for (const line of lines) {
      const match = line.match(/^- \*\*(.+?)\*\*: (.+?)(?: _\((.+?)\)_)?$/);
      if (match) {
        facts.push({
          key: match[1],
          value: match[2],
          category: match[3] || "general",
          createdAt: new Date(),
          updatedAt: new Date(),
          accessCount: 0,
        });
      }
    }
    return facts;
  }

  async search(query: string, limit = 5): Promise<MemorySearchResult[]> {
    const results: MemorySearchResult[] = [];
    const queryLower = query.toLowerCase();

    const files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(this.dir, file), "utf-8");
      if (content.toLowerCase().includes(queryLower)) {
        // Find matching sections
        const sections = content.split(/\n## /).filter((s) => s.toLowerCase().includes(queryLower));
        for (const section of sections.slice(0, limit)) {
          results.push({
            content: section.slice(0, 500),
            score: 1,
            source: `markdown:${file}`,
          });
        }
      }
    }
    return results.slice(0, limit);
  }

  async getSummary(chatId: string): Promise<string | null> {
    const summaryFile = path.join(this.dir, `summary_${chatId}.md`);
    if (!fs.existsSync(summaryFile)) return null;
    return fs.readFileSync(summaryFile, "utf-8");
  }

  async saveSummary(chatId: string, summary: string): Promise<void> {
    const summaryFile = path.join(this.dir, `summary_${chatId}.md`);
    fs.writeFileSync(summaryFile, summary);
  }

  async compact(): Promise<void> {
    // Markdown memory doesn't auto-compact (human-readable by design)
  }

  async close(): Promise<void> {
    // Nothing to close
  }
}
