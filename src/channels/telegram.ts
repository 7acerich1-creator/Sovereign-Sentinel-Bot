// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Telegram Channel (grammY)
// Text, inline keyboards, voice, groups, rich media
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Bot, Context, InputFile, InlineKeyboard } from "grammy";
import { randomUUID } from "crypto";
import type { Channel, Message, SendOptions, ChannelType } from "../types";
import { config } from "../config";

export class TelegramChannel implements Channel {
  name: ChannelType = "telegram";
  private bot: Bot;
  private messageHandler?: (message: Message) => Promise<void>;
  private callbackHandler?: (chatId: string, data: string) => Promise<void>;
  public botUsername: string = "";  // Populated after initialize() via getMe()

  constructor() {
    this.bot = new Bot(config.telegram.botToken);
  }

  async initialize(): Promise<void> {
    // Raw update logger — fires for EVERY update before any filtering
    this.bot.use(async (ctx, next) => {
      console.log(`📨 RAW UPDATE received — type: ${ctx.update ? Object.keys(ctx.update).filter(k => k !== "update_id").join(",") : "unknown"}, from: ${ctx.from?.id} (${ctx.from?.first_name || "unknown"}), chat: ${ctx.chat?.id}, chatType: ${ctx.chat?.type}`);
      await next();
    });

    // Auth guard middleware
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId || !config.telegram.authorizedUserIds.includes(userId)) {
        console.log(`🚫 AUTH REJECTED — userId: ${userId}, authorized: [${config.telegram.authorizedUserIds.join(",")}]`);
        return;
      }
      console.log(`✅ AUTH PASSED — userId: ${userId}`);
      await next();
    });

    // Text messages
    this.bot.on("message:text", async (ctx) => {
      console.log(`💬 TEXT MESSAGE — from: ${ctx.from.id}, chat: ${ctx.chat.id}, text: "${ctx.message.text.slice(0, 50)}"`);
      if (!this.messageHandler) {
        console.log(`⚠️ NO MESSAGE HANDLER SET — dropping message`);
        return;
      }

      // Extract mention entities for robust group chat routing
      const mentionUsernames = (ctx.message.entities || [])
        .filter((e: any) => e.type === "mention")
        .map((e: any) => ctx.message.text.substring(e.offset + 1, e.offset + e.length).toLowerCase());

      // Detect if this is a reply to a message from this bot
      const replyToBotMessage = ctx.message.reply_to_message?.from?.id === this.bot.botInfo?.id;

      const message: Message = {
        id: randomUUID(),
        role: "user",
        content: ctx.message.text,
        timestamp: new Date(ctx.message.date * 1000),
        channel: "telegram",
        channelMessageId: ctx.message.message_id,
        chatId: String(ctx.chat.id),
        userId: String(ctx.from.id),
        metadata: {
          firstName: ctx.from.first_name,
          username: ctx.from.username,
          isGroup: ctx.chat.type !== "private",
          chatType: ctx.chat.type,
          mentionedUsernames: mentionUsernames,
          replyToBotMessage,
        },
      };

      await this.messageHandler(message);
    });

    // Voice messages
    this.bot.on("message:voice", async (ctx) => {
      if (!this.messageHandler) return;

      const voice = ctx.message.voice;
      const file = await ctx.getFile();

      const message: Message = {
        id: randomUUID(),
        role: "user",
        content: "[Voice Message]",
        timestamp: new Date(ctx.message.date * 1000),
        channel: "telegram",
        channelMessageId: ctx.message.message_id,
        chatId: String(ctx.chat.id),
        userId: String(ctx.from.id),
        attachments: [{
          type: "voice",
          fileId: voice.file_id,
          mimeType: voice.mime_type || "audio/ogg",
          duration: voice.duration,
          url: file.file_path ? `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}` : undefined,
        }],
      };

      await this.messageHandler(message);
    });

    // Audio messages
    this.bot.on("message:audio", async (ctx) => {
      if (!this.messageHandler) return;

      const audio = ctx.message.audio;
      const file = await ctx.getFile();

      const message: Message = {
        id: randomUUID(),
        role: "user",
        content: "[Audio File]",
        timestamp: new Date(ctx.message.date * 1000),
        channel: "telegram",
        channelMessageId: ctx.message.message_id,
        chatId: String(ctx.chat.id),
        userId: String(ctx.from.id),
        attachments: [{
          type: "audio",
          fileId: audio.file_id,
          mimeType: audio.mime_type || "audio/mpeg",
          duration: audio.duration,
          url: file.file_path ? `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}` : undefined,
        }],
      };

      await this.messageHandler(message);
    });

    // Photo messages
    this.bot.on("message:photo", async (ctx) => {
      if (!this.messageHandler) return;

      const photo = ctx.message.photo;
      const largest = photo[photo.length - 1];
      const file = await ctx.api.getFile(largest.file_id);

      const message: Message = {
        id: randomUUID(),
        role: "user",
        content: ctx.message.caption || "[Photo]",
        timestamp: new Date(ctx.message.date * 1000),
        channel: "telegram",
        channelMessageId: ctx.message.message_id,
        chatId: String(ctx.chat.id),
        userId: String(ctx.from.id),
        attachments: [{
          type: "image",
          fileId: largest.file_id,
          url: `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`,
        }],
      };

      await this.messageHandler(message);
    });

    // Document messages
    this.bot.on("message:document", async (ctx) => {
      if (!this.messageHandler) return;

      const doc = ctx.message.document;

      const message: Message = {
        id: randomUUID(),
        role: "user",
        content: ctx.message.caption || `[Document: ${doc.file_name || "unknown"}]`,
        timestamp: new Date(ctx.message.date * 1000),
        channel: "telegram",
        channelMessageId: ctx.message.message_id,
        chatId: String(ctx.chat.id),
        userId: String(ctx.from.id),
        attachments: [{
          type: "document",
          fileId: doc.file_id,
          mimeType: doc.mime_type,
          size: doc.file_size,
        }],
      };

      await this.messageHandler(message);
    });

    // Callback queries (inline keyboard buttons)
    this.bot.on("callback_query:data", async (ctx) => {
      await ctx.answerCallbackQuery();
      if (this.callbackHandler) {
        await this.callbackHandler(String(ctx.chat?.id || ctx.from.id), ctx.callbackQuery.data);
      }
    });

    // Error handling — verbose to catch polling failures
    this.bot.catch((err) => {
      console.error("🔥 TELEGRAM BOT ERROR:", err.message || err);
      if (err.error) console.error("🔥 Inner error:", err.error);
      if (err.ctx) console.error("🔥 Update context:", "from:", err.ctx.from?.id);
    });

    // Fetch bot identity BEFORE polling — needed for GroupManager
    try {
      const me = await this.bot.api.getMe();
      this.botUsername = me.username || "";
      console.log(`🤖 Bot identity: @${this.botUsername} (id: ${me.id})`);
    } catch (err: any) {
      console.error(`⚠️ getMe() failed — GroupManager will use fallback username: ${err.message}`);
    }

    // ── 409 DEFENSE: Kill any existing polling before we start ──
    // During Railway rolling deploys, old + new containers overlap for ~10s.
    // deleteWebhook clears the connection, then we delay to let the old container die.
    try {
      await this.bot.api.deleteWebhook({ drop_pending_updates: true });
      console.log(`🔒 [409 Defense] Cleared webhook/pending updates`);
    } catch (err: any) {
      console.warn(`⚠️ [409 Defense] deleteWebhook failed (non-fatal): ${err.message}`);
    }
    // Wait for old container to release the polling connection
    console.log(`⏳ [409 Defense] Waiting 12s for old container to die...`);
    await new Promise((resolve) => setTimeout(resolve, 12000));

    const startPolling = async (attempt = 1): Promise<void> => {
      try {
        await this.bot.start({
          drop_pending_updates: true,
          onStart: (info) => {
            console.log(`⚡ GRAVITY CLAW ONLINE — @${info.username} — Sovereign Frequency Locked`);
            console.log(`🔒 Authorized User IDs: ${config.telegram.authorizedUserIds.join(", ")}`);
            console.log(`📡 Long polling ACTIVE — drop_pending_updates: true`);
          },
        });
        // bot.start() resolved = polling loop ended unexpectedly
        console.error("⚠️ bot.start() RESOLVED — polling loop ended unexpectedly!");
        if (attempt < 5) {
          const delay = Math.min(attempt * 5000, 20000);
          console.log(`🔄 Restarting polling in ${delay / 1000}s (attempt ${attempt + 1}/5)...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return startPolling(attempt + 1);
        }
      } catch (err: any) {
        const is409 = err.message?.includes("409") || err.error_code === 409;
        if (is409 && attempt < 5) {
          const delay = Math.min(attempt * 5000, 20000);
          console.warn(`🔥 [409 Conflict] Attempt ${attempt}/5 — retrying in ${delay / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return startPolling(attempt + 1);
        }
        console.error(`🔥 bot.start() CRASHED (attempt ${attempt}):`, err.message || err);
        if (attempt < 5) {
          const delay = Math.min(attempt * 5000, 20000);
          console.log(`🔄 Restarting polling in ${delay / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return startPolling(attempt + 1);
        }
        console.error(`❌ Polling failed after 5 attempts. Bot is dead.`);
      }
    };

    // Fire-and-forget — don't block initialization
    startPolling().catch((err) => console.error("🔥 startPolling fatal:", err));
  }

  async sendMessage(chatId: string, text: string, options?: SendOptions): Promise<Message> {
    const opts: any = {};

    if (options?.parseMode) {
      opts.parse_mode = options.parseMode;
    }
    if (options?.replyToMessageId) {
      opts.reply_to_message_id = options.replyToMessageId;
    }
    if (options?.inlineKeyboard) {
      const kb = new InlineKeyboard();
      for (const row of options.inlineKeyboard) {
        for (const btn of row) {
          if (btn.url) {
            kb.url(btn.text, btn.url);
          } else if (btn.callbackData) {
            kb.text(btn.text, btn.callbackData);
          }
        }
        kb.row();
      }
      opts.reply_markup = kb;
    }

    // Telegram has a 4096 char limit — chunk if needed
    const chunks = text.match(/[\s\S]{1,4000}/g) || [text];
    let lastMsg: any;

    for (const chunk of chunks) {
      try {
        lastMsg = await this.bot.api.sendMessage(Number(chatId), chunk, opts);
      } catch (err: any) {
        // Retry without parse mode if markdown fails
        if (opts.parse_mode && err.message?.includes("parse")) {
          lastMsg = await this.bot.api.sendMessage(Number(chatId), chunk);
        } else {
          throw err;
        }
      }
    }

    return {
      id: randomUUID(),
      role: "assistant",
      content: text,
      timestamp: new Date(),
      channel: "telegram",
      channelMessageId: lastMsg.message_id,
      chatId: String(chatId),
      userId: "gravity-claw",
    };
  }

  async editMessage(chatId: string, messageId: string | number, text: string, options?: SendOptions): Promise<void> {
    const opts: any = {};
    if (options?.parseMode) {
      opts.parse_mode = options.parseMode;
    }
    if (options?.inlineKeyboard) {
      const kb = new InlineKeyboard();
      for (const row of options.inlineKeyboard) {
        for (const btn of row) {
          if (btn.url) {
            kb.url(btn.text, btn.url);
          } else if (btn.callbackData) {
            kb.text(btn.text, btn.callbackData);
          }
        }
        kb.row();
      }
      opts.reply_markup = kb;
    }

    try {
      await this.bot.api.editMessageText(Number(chatId), Number(messageId), text, opts);
    } catch (err: any) {
      if (options?.parseMode && err.message?.includes("parse")) {
        await this.bot.api.editMessageText(Number(chatId), Number(messageId), text);
      } else {
        console.warn(`⚠️ editMessage failed: ${err.message}`);
      }
    }
  }

  async deleteMessage(chatId: string, messageId: string | number): Promise<void> {
    try {
      await this.bot.api.deleteMessage(Number(chatId), Number(messageId));
    } catch (err: any) {
      console.warn(`⚠️ deleteMessage failed: ${err.message}`);
    }
  }

  async sendVoice(chatId: string, audioBuffer: Buffer, options?: SendOptions): Promise<void> {
    await this.bot.api.sendVoice(Number(chatId), new InputFile(audioBuffer, "response.ogg"));
  }

  async sendTyping(chatId: string): Promise<void> {
    try {
      await this.bot.api.sendChatAction(Number(chatId), "typing");
    } catch {
      // Non-critical
    }
  }

  onMessage(handler: (message: Message) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onCallback(handler: (chatId: string, data: string) => Promise<void>): void {
    this.callbackHandler = handler;
  }

  getBotInstance(): Bot {
    return this.bot;
  }

  async sendDirectMessage(userId: number, text: string, parseMode?: "Markdown" | "HTML"): Promise<void> {
    await this.bot.api.sendMessage(userId, text, parseMode ? { parse_mode: parseMode } : {});
  }

  async shutdown(): Promise<void> {
    await this.bot.stop();
    console.log("🛑 Telegram channel shut down");
  }
}
