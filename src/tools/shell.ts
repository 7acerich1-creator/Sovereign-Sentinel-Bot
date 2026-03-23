// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Shell Command Tool
// Execute commands with allowlists, confirmation, timeouts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { exec } from "child_process";
import type { Tool, ToolContext, ToolDefinition } from "../types";
import { config } from "../config";

const MAX_TIMEOUT = 30_000;
const MAX_OUTPUT = 8000;

export class ShellTool implements Tool {
  definition: ToolDefinition = {
    name: "run_shell",
    description: "Execute a shell command and return its output. Commands are checked against an allowlist for safety.",
    parameters: {
      command: { type: "string", description: "The shell command to execute" },
      timeout: { type: "number", description: "Timeout in milliseconds (default 30000)" },
    },
    required: ["command"],
    dangerous: true,
    confirmationRequired: true,
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const command = String(args.command || "");
    const timeout = Math.min(Number(args.timeout) || MAX_TIMEOUT, MAX_TIMEOUT);

    if (!config.tools.shellEnabled) {
      return "Shell commands are disabled in configuration.";
    }

    // Check command against allowlist
    const baseCommand = command.split(/\s+/)[0].replace(/^.*\//, ""); // Extract binary name
    if (!config.tools.shellAllowlist.includes(baseCommand)) {
      return `Command "${baseCommand}" is not in the allowlist. Allowed: ${config.tools.shellAllowlist.join(", ")}`;
    }

    // Check for dangerous patterns
    const dangerousPatterns = [/rm\s+-rf\s+\//, /mkfs/, /dd\s+if=/, /> \/dev\//, /chmod\s+777/];
    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return `Command blocked: matches dangerous pattern ${pattern}`;
      }
    }

    return new Promise((resolve) => {
      exec(command, { timeout, maxBuffer: 1024 * 1024, cwd: config.tools.fileRootPath }, (error, stdout, stderr) => {
        let output = "";
        if (stdout) output += stdout;
        if (stderr) output += `\nSTDERR: ${stderr}`;
        if (error) output += `\nExit code: ${error.code || "unknown"}`;
        resolve(output.slice(0, MAX_OUTPUT) || "(no output)");
      });
    });
  }
}
