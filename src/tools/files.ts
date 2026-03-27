// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — File Operations Tool
// Read, write, create, delete, list, search files
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import * as fs from "fs";
import * as path from "path";
import type { Tool, ToolContext, ToolDefinition } from "../types";
import { config } from "../config";

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_OUTPUT = 8000;

function safePath(filePath: string): string {
  const resolved = path.resolve(config.tools.fileRootPath, filePath);
  if (!resolved.startsWith(path.resolve(config.tools.fileRootPath))) {
    throw new Error("Path traversal blocked — must stay within allowed root");
  }
  return resolved;
}

export class FileReadTool implements Tool {
  definition: ToolDefinition = {
    name: "read_file",
    description: "Read the contents of a file. Returns the text content.",
    parameters: {
      path: { type: "string", description: "Relative or absolute path to the file" },
      lines: { type: "number", description: "Max lines to read (default: all)" },
    },
    required: ["path"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = safePath(String(args.path));
    const maxLines = Number(args.lines) || 0;

    if (!fs.existsSync(filePath)) return `File not found: ${args.path}`;

    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) return `File too large: ${(stat.size / 1024).toFixed(0)}KB (max 1MB)`;

    let content = fs.readFileSync(filePath, "utf-8");
    if (maxLines > 0) {
      content = content.split("\n").slice(0, maxLines).join("\n");
    }
    return content.slice(0, MAX_OUTPUT);
  }
}

export class FileWriteTool implements Tool {
  definition: ToolDefinition = {
    name: "write_file",
    description: "Write content to a file. Creates the file if it doesn't exist.",
    parameters: {
      path: { type: "string", description: "Relative or absolute path to the file" },
      content: { type: "string", description: "Content to write" },
      append: { type: "boolean", description: "Append instead of overwrite (default: false)" },
    },
    required: ["path", "content"],
    dangerous: true,
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = safePath(String(args.path));
    const content = String(args.content);
    const append = Boolean(args.append);

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (append) {
      fs.appendFileSync(filePath, content);
      return `Appended ${content.length} chars to ${args.path}`;
    } else {
      fs.writeFileSync(filePath, content);
      return `Wrote ${content.length} chars to ${args.path}`;
    }
  }
}

export class FileListTool implements Tool {
  definition: ToolDefinition = {
    name: "list_files",
    description: "List files and directories at the given path.",
    parameters: {
      path: { type: "string", description: "Directory path (default: current directory)" },
      recursive: { type: "boolean", description: "List recursively (default: false)" },
    },
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const dirPath = safePath(String(args.path || "."));
    const recursive = Boolean(args.recursive);

    if (!fs.existsSync(dirPath)) return `Directory not found: ${args.path}`;

    const entries: string[] = [];

    function walk(dir: string, prefix = ""): void {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.startsWith(".") || item.name === "node_modules") continue;
        const fullPath = path.join(dir, item.name);
        const display = prefix + item.name + (item.isDirectory() ? "/" : "");
        entries.push(display);
        if (recursive && item.isDirectory() && entries.length < 200) {
          walk(fullPath, prefix + "  ");
        }
      }
    }

    walk(dirPath);
    return entries.join("\n").slice(0, MAX_OUTPUT) || "(empty directory)";
  }
}

export class FileDeleteTool implements Tool {
  definition: ToolDefinition = {
    name: "delete_file",
    description: "Delete a file. Requires confirmation for safety.",
    parameters: {
      path: { type: "string", description: "Path to the file to delete" },
    },
    required: ["path"],
    dangerous: true,
    confirmationRequired: true,
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = safePath(String(args.path));
    if (!fs.existsSync(filePath)) return `File not found: ${args.path}`;

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) return "Cannot delete directories with this tool. Use run_shell instead.";

    fs.unlinkSync(filePath);
    return `Deleted: ${args.path}`;
  }
}

export class FileSearchTool implements Tool {
  definition: ToolDefinition = {
    name: "search_files",
    description: "Search for files by name pattern or content. Returns matching file paths.",
    parameters: {
      pattern: { type: "string", description: "Filename pattern (glob) or text to search for" },
      path: { type: "string", description: "Directory to search in (default: current)" },
      content: { type: "boolean", description: "Search file contents instead of names (default: false)" },
    },
    required: ["pattern"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const pattern = String(args.pattern);
    const dirPath = safePath(String(args.path || "."));
    const searchContent = Boolean(args.content);

    const results: string[] = [];

    function walk(dir: string): void {
      if (results.length >= 50) return;
      try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.name.startsWith(".") || item.name === "node_modules" || item.name === "dist") continue;
          const fullPath = path.join(dir, item.name);

          if (item.isDirectory()) {
            walk(fullPath);
          } else if (searchContent) {
            try {
              const stat = fs.statSync(fullPath);
              if (stat.size < MAX_FILE_SIZE) {
                const text = fs.readFileSync(fullPath, "utf-8");
                if (text.includes(pattern)) {
                  results.push(path.relative(dirPath, fullPath));
                }
              }
            } catch { /* skip binary files */ }
          } else {
            if (item.name.includes(pattern) || item.name.match(new RegExp(pattern.replace(/\*/g, ".*"), "i"))) {
              results.push(path.relative(dirPath, fullPath));
            }
          }
        }
      } catch { /* permission denied */ }
    }

    walk(dirPath);
    return results.length > 0 ? results.join("\n") : "No matches found.";
  }
}
