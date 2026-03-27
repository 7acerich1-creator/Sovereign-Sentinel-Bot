// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Agent-to-Agent Communication
// Multiple sessions with history, send, list
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { randomUUID } from "crypto";
import type { Tool, ToolDefinition } from "../types";

interface AgentMessage {
  from: string;
  to: string;
  content: string;
  timestamp: Date;
}

interface AgentSession {
  id: string;
  participants: string[];
  messages: AgentMessage[];
  createdAt: Date;
}

export class AgentComms {
  private sessions: Map<string, AgentSession> = new Map();

  createSession(participants: string[]): string {
    const id = randomUUID().slice(0, 8);
    this.sessions.set(id, {
      id,
      participants,
      messages: [],
      createdAt: new Date(),
    });
    return id;
  }

  send(sessionId: string, from: string, content: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.messages.push({ from, to: "broadcast", content, timestamp: new Date() });
  }

  getHistory(sessionId: string, limit = 20): AgentMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.messages.slice(-limit);
  }

  listSessions(): Array<{ id: string; participants: string[]; messageCount: number }> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      participants: s.participants,
      messageCount: s.messages.length,
    }));
  }

  deleteSession(id: string): boolean {
    return this.sessions.delete(id);
  }
}

export class AgentCommsTool implements Tool {
  private comms: AgentComms;

  constructor(comms: AgentComms) {
    this.comms = comms;
  }

  definition: ToolDefinition = {
    name: "agent_comms",
    description: "Communicate between agent sessions. Create sessions, send messages, view history.",
    parameters: {
      action: { type: "string", description: "Action: create, send, history, list", enum: ["create", "send", "history", "list"] },
      sessionId: { type: "string", description: "Session ID" },
      from: { type: "string", description: "Sender name" },
      content: { type: "string", description: "Message content" },
      participants: { type: "string", description: "Comma-separated participant names (for create)" },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    switch (String(args.action)) {
      case "create": {
        const parts = String(args.participants || "agent1,agent2").split(",").map((p) => p.trim());
        const id = this.comms.createSession(parts);
        return `Session created: ${id} — Participants: ${parts.join(", ")}`;
      }
      case "send": {
        this.comms.send(String(args.sessionId), String(args.from || "agent"), String(args.content));
        return "Message sent.";
      }
      case "history": {
        const msgs = this.comms.getHistory(String(args.sessionId));
        if (msgs.length === 0) return "No messages in session.";
        return msgs.map((m) => `[${m.from}] ${m.content}`).join("\n");
      }
      case "list": {
        const sessions = this.comms.listSessions();
        if (sessions.length === 0) return "No active sessions.";
        return sessions.map((s) => `${s.id}: ${s.participants.join(",")} (${s.messageCount} msgs)`).join("\n");
      }
      default:
        return "Unknown action.";
    }
  }
}
