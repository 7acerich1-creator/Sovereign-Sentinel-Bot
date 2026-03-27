// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Skills System
// Markdown files defining new capabilities, loaded from /skills
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import * as fs from "fs";
import * as path from "path";
import type { Tool, ToolDefinition } from "../types";

interface Skill {
  name: string;
  description: string;
  instructions: string;
  triggers: string[];
  filePath: string;
}

export class SkillsSystem {
  private skills: Map<string, Skill> = new Map();
  private skillsDir: string;

  constructor(skillsDir = "./skills") {
    this.skillsDir = skillsDir;
  }

  async loadAll(): Promise<Skill[]> {
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
      console.log(`📁 Created skills directory: ${this.skillsDir}`);
      return [];
    }

    const files = fs.readdirSync(this.skillsDir).filter((f) => f.endsWith(".md"));

    for (const file of files) {
      try {
        const filePath = path.join(this.skillsDir, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const skill = this.parseSkillFile(content, filePath);
        this.skills.set(skill.name, skill);
      } catch (err: any) {
        console.warn(`⚠️ Failed to load skill ${file}: ${err.message}`);
      }
    }

    console.log(`📚 Loaded ${this.skills.size} skills from ${this.skillsDir}`);
    return Array.from(this.skills.values());
  }

  private parseSkillFile(content: string, filePath: string): Skill {
    // Parse YAML-like frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let name = path.basename(filePath, ".md");
    let description = "";
    let triggers: string[] = [];

    if (frontmatterMatch) {
      const fm = frontmatterMatch[1];
      const nameMatch = fm.match(/name:\s*(.+)/);
      const descMatch = fm.match(/description:\s*(.+)/);
      const triggerMatch = fm.match(/triggers:\s*\[([^\]]+)\]/);

      if (nameMatch) name = nameMatch[1].trim();
      if (descMatch) description = descMatch[1].trim();
      if (triggerMatch) triggers = triggerMatch[1].split(",").map((t) => t.trim().replace(/['"]/g, ""));
    }

    const instructions = frontmatterMatch
      ? content.slice(frontmatterMatch[0].length).trim()
      : content.trim();

    return { name, description, instructions, triggers, filePath };
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  findByTrigger(text: string): Skill | undefined {
    const lower = text.toLowerCase();
    for (const skill of this.skills.values()) {
      for (const trigger of skill.triggers) {
        if (lower.includes(trigger.toLowerCase())) return skill;
      }
    }
    return undefined;
  }

  getAllSkillContext(): string {
    if (this.skills.size === 0) return "";

    const lines = ["[AVAILABLE SKILLS]"];
    for (const skill of this.skills.values()) {
      lines.push(`- ${skill.name}: ${skill.description}`);
    }
    return lines.join("\n");
  }

  getSkillInstructions(name: string): string | null {
    const skill = this.skills.get(name);
    return skill?.instructions || null;
  }

  listSkills(): Array<{ name: string; description: string; triggers: string[] }> {
    return Array.from(this.skills.values()).map((s) => ({
      name: s.name,
      description: s.description,
      triggers: s.triggers,
    }));
  }
}

// ── Skills Tool (let LLM activate skills) ──
export class SkillsTool implements Tool {
  private skills: SkillsSystem;

  constructor(skills: SkillsSystem) {
    this.skills = skills;
  }

  definition: ToolDefinition = {
    name: "use_skill",
    description: "Activate a loaded skill to get specialized instructions for a task.",
    parameters: {
      name: { type: "string", description: "Skill name to activate" },
    },
    required: ["name"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const name = String(args.name);
    const instructions = this.skills.getSkillInstructions(name);
    if (!instructions) {
      const available = this.skills.listSkills().map((s) => s.name).join(", ");
      return `Skill "${name}" not found. Available: ${available}`;
    }
    return `[SKILL: ${name}]\n${instructions}`;
  }
}
