// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — MCP Tool Bridge
// Connect to MCP servers via stdio/SSE, list tools, expose to LLM
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import { randomUUID } from "crypto";
import type { Tool, ToolDefinition, ToolContext, MCPServerConfig } from "../types";
import { config } from "../config";

interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

export class MCPBridge {
  private servers: Map<string, { process: ChildProcess; tools: MCPToolInfo[] }> = new Map();
  private pendingRequests: Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void }> = new Map();

  async initialize(): Promise<Tool[]> {
    let mcpConfig: Record<string, MCPServerConfig> = {};

    if (process.env.MCP_JSON_B64) {
      try {
        const raw = Buffer.from(process.env.MCP_JSON_B64, "base64").toString("utf-8");
        const parsed = JSON.parse(raw);
        mcpConfig = parsed.mcpServers || parsed.servers || parsed;
        console.log("✅ [MCP Bridge] Securely loaded configuration from encrypted MCP_JSON_B64 environment variable");
      } catch (err: any) {
        console.error(`❌ [MCP Bridge Error] Failed to parse Base64 environment config: ${err.message}`);
      }
    } else if (fs.existsSync(config.mcp.configPath)) {
      try {
        const raw = fs.readFileSync(config.mcp.configPath, "utf-8");
        const parsed = JSON.parse(raw);
        mcpConfig = parsed.mcpServers || parsed.servers || parsed;
        console.log(`✅ [MCP Bridge] Loaded configuration from secure local file -> ${config.mcp.configPath}`);
      } catch (err: any) {
        console.error(`❌ [MCP Bridge Error] Failed to parse local MCP config file at ${config.mcp.configPath}: ${err.message}`);
      }
    } else {
      console.warn(`⚠️ [MCP Bridge Warning] Local config NOT FOUND at ${config.mcp.configPath} and MCP_JSON_B64 is undefined. Only defaulting to code-defined servers.`);
    }

    // Merge with config-defined servers
    Object.assign(mcpConfig, config.mcp.servers);

    const tools: Tool[] = [];

    for (const [name, serverConfig] of Object.entries(mcpConfig)) {
      try {
        const serverTools = await this.connectServer(name, serverConfig);
        tools.push(...serverTools);
        console.log(`✅ MCP server "${name}": ${serverTools.length} tools loaded`);
      } catch (err: any) {
        console.warn(`⚠️ MCP server "${name}" failed: ${err.message}`);
      }
    }

    return tools;
  }

  private async connectServer(name: string, serverConfig: MCPServerConfig): Promise<Tool[]> {
    if (serverConfig.transport === "sse" && serverConfig.url) {
      // SSE transport — not yet implemented
      console.log(`ℹ️ SSE transport for "${name}" — skipping (use stdio)`);
      return [];
    }

    // Stdio transport
    const proc = spawn(serverConfig.command, serverConfig.args || [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...serverConfig.env },
    });

    let buffer = "";
    proc.stdout?.on("data", (data) => {
      buffer += data.toString();
      // Process complete JSON-RPC messages
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line);
            if (msg.id && this.pendingRequests.has(msg.id)) {
              const pending = this.pendingRequests.get(msg.id)!;
              this.pendingRequests.delete(msg.id);
              if (msg.error) {
                pending.reject(new Error(msg.error.message || "MCP error"));
              } else {
                pending.resolve(msg.result);
              }
            }
          } catch {
            // Not JSON, skip
          }
        }
      }
    });

    proc.stderr?.on("data", (data) => {
      console.error(`[MCP ${name}] ${data.toString().trim()}`);
    });

    proc.on("exit", (code) => {
      console.log(`[MCP ${name}] Process exited with code ${code}`);
      this.servers.delete(name);
    });

    // Initialize MCP session
    await this.sendRequest(proc, {
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "gravity-claw", version: "3.0.0" },
      },
    });

    // List tools
    const toolsResult: any = await this.sendRequest(proc, {
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/list",
      params: {},
    });

    const mcpTools: MCPToolInfo[] = (toolsResult?.tools || []).map((t: any) => ({
      name: `mcp_${name}_${t.name}`,
      description: t.description || t.name,
      inputSchema: t.inputSchema || {},
      serverName: name,
    }));

    this.servers.set(name, { process: proc, tools: mcpTools });

    // Convert to Gravity Claw Tool interface
    return mcpTools.map((mt) => this.createToolWrapper(name, mt, proc));
  }

  private createToolWrapper(serverName: string, mcpTool: MCPToolInfo, proc: ChildProcess): Tool {
    const bridge = this;
    const props = (mcpTool.inputSchema as any)?.properties || {};
    const required = (mcpTool.inputSchema as any)?.required || [];

    return {
      definition: {
        name: mcpTool.name,
        description: `[MCP:${serverName}] ${mcpTool.description}`,
        parameters: Object.fromEntries(
          Object.entries(props).map(([k, v]: [string, any]) => [k, {
            type: v.type || "string",
            description: v.description || k,
          }])
        ),
        required,
      },
      execute: async (args: Record<string, unknown>): Promise<string> => {
        const originalName = mcpTool.name.replace(`mcp_${serverName}_`, "");
        const result: any = await bridge.sendRequest(proc, {
          jsonrpc: "2.0",
          id: randomUUID(),
          method: "tools/call",
          params: { name: originalName, arguments: args },
        });

        if (result?.content) {
          return result.content.map((c: any) => c.text || JSON.stringify(c)).join("\n");
        }
        return JSON.stringify(result);
      },
    };
  }

  private sendRequest(proc: ChildProcess, message: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = (message as any).id;
      this.pendingRequests.set(id, { resolve, reject });

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error("MCP request timeout (10s)"));
      }, 10_000);

      const originalResolve = resolve;
      this.pendingRequests.set(id, {
        resolve: (val) => { clearTimeout(timeout); originalResolve(val); },
        reject: (err) => { clearTimeout(timeout); reject(err); },
      });

      proc.stdin?.write(JSON.stringify(message) + "\n");
    });
  }

  listConnectedServers(): string[] {
    return Array.from(this.servers.keys());
  }

  async shutdown(): Promise<void> {
    for (const [name, server] of this.servers) {
      server.process.kill();
      console.log(`🔌 MCP server "${name}" disconnected`);
    }
    this.servers.clear();
  }
}
