// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Multi-Channel Message Router
// Unified bus with per-channel formatting and routing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Channel, Message, ChannelType, SendOptions } from "../types";

type MessageHandler = (message: Message) => Promise<void>;

export class MessageRouter {
  private channels: Map<ChannelType, Channel> = new Map();
  private globalHandlers: MessageHandler[] = [];
  private channelFormatters: Map<ChannelType, (text: string) => string> = new Map();

  registerChannel(channel: Channel): void {
    this.channels.set(channel.name, channel);

    // Set up message forwarding from channel to router
    channel.onMessage(async (message) => {
      for (const handler of this.globalHandlers) {
        try {
          await handler(message);
        } catch (err: any) {
          console.error(`Router handler error (${channel.name}):`, err.message);
        }
      }
    });

    console.log(`📡 Channel registered: ${channel.name}`);
  }

  onMessage(handler: MessageHandler): void {
    this.globalHandlers.push(handler);
  }

  setFormatter(channel: ChannelType, formatter: (text: string) => string): void {
    this.channelFormatters.set(channel, formatter);
  }

  async send(channel: ChannelType, chatId: string, text: string, options?: SendOptions): Promise<void> {
    const ch = this.channels.get(channel);
    if (!ch) throw new Error(`Channel not found: ${channel}`);

    // Apply channel-specific formatting
    const formatter = this.channelFormatters.get(channel);
    const formattedText = formatter ? formatter(text) : text;

    await ch.sendMessage(chatId, formattedText, options);
  }

  async sendVoice(channel: ChannelType, chatId: string, audio: Buffer): Promise<void> {
    const ch = this.channels.get(channel);
    if (!ch?.sendVoice) throw new Error(`Channel ${channel} does not support voice`);
    await ch.sendVoice(chatId, audio);
  }

  async sendTyping(channel: ChannelType, chatId: string): Promise<void> {
    const ch = this.channels.get(channel);
    if (ch?.sendTyping) await ch.sendTyping(chatId);
  }

  async broadcast(text: string, options?: SendOptions): Promise<void> {
    // Send to all channels (for system-wide announcements)
    for (const [name, channel] of this.channels) {
      try {
        const formatter = this.channelFormatters.get(name);
        const formatted = formatter ? formatter(text) : text;
        // Would need a default chatId per channel — skip for now
        console.log(`[Broadcast → ${name}] ${formatted.slice(0, 100)}`);
      } catch {
        // Non-critical
      }
    }
  }

  getChannel(name: ChannelType): Channel | undefined {
    return this.channels.get(name);
  }

  listChannels(): ChannelType[] {
    return Array.from(this.channels.keys());
  }

  async shutdownAll(): Promise<void> {
    for (const [name, channel] of this.channels) {
      try {
        await channel.shutdown();
        console.log(`📴 Channel ${name} shut down`);
      } catch (err: any) {
        console.error(`Error shutting down ${name}:`, err.message);
      }
    }
  }
}
