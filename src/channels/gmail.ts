// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Gmail Channel
// Read, compose, and send emails via Gmail API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Channel, Message, ChannelType, SendOptions, Tool, ToolDefinition } from "../types";
import { randomUUID } from "crypto";

// Gmail channel is a placeholder — requires OAuth2 setup on user's machine
// In production, use googleapis npm package with proper auth

export class GmailChannel implements Channel {
  name: ChannelType = "gmail";
  private messageHandler?: (message: Message) => Promise<void>;
  private pollTimer?: NodeJS.Timeout;

  async initialize(): Promise<void> {
    console.log("ℹ️ Gmail channel initialized (requires OAuth2 credentials for full functionality)");
  }

  async sendMessage(chatId: string, text: string, options?: SendOptions): Promise<Message> {
    // chatId = email address for Gmail
    console.log(`📧 [Gmail → ${chatId}] ${text.slice(0, 100)}...`);
    // In production: use Gmail API to send
    return {
      id: randomUUID(),
      role: "assistant",
      content: text,
      timestamp: new Date(),
      channel: "gmail",
      chatId,
      userId: "gravity-claw"
    };
  }

  onMessage(handler: (message: Message) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async shutdown(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }
}

// ── Gmail Tool (expose to LLM) ──
export class GmailTool implements Tool {
  definition: ToolDefinition = {
    name: "gmail",
    description: "Read, search, compose, and send emails via Gmail.",
    parameters: {
      action: { type: "string", description: "Action: read, search, compose, send", enum: ["read", "search", "compose", "send"] },
      query: { type: "string", description: "Search query or email ID" },
      to: { type: "string", description: "Recipient email address" },
      subject: { type: "string", description: "Email subject" },
      body: { type: "string", description: "Email body" },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = String(args.action);

    switch (action) {
      case "read":
        return "Gmail API not configured. Set GMAIL_CREDENTIALS_PATH and GMAIL_TOKEN_PATH.";
      case "search":
        return "Gmail API not configured. Set GMAIL_CREDENTIALS_PATH and GMAIL_TOKEN_PATH.";
      case "compose":
        return `Draft composed:\nTo: ${args.to}\nSubject: ${args.subject}\nBody: ${String(args.body).slice(0, 200)}...`;
      case "send":
        return "Gmail API not configured. Cannot send without OAuth2 credentials.";
      default:
        return `Unknown action: ${action}`;
    }
  }
}
