// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Main Entry Point
// Sovereign Synthesis Sentinel — Full Agent Architecture
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { randomUUID } from "crypto";
import { config } from "./config";
import type { Message, Tool, MemoryProvider, LLMProvider, BotCore, ChannelType } from "./types";

// ── Memory ──
import { SqliteMemory } from "./memory/sqlite";
import { MarkdownMemory } from "./memory/markdown";
import { SupabaseVectorMemory } from "./memory/supabase-vector";
import { KnowledgeGraph, KnowledgeGraphTool } from "./memory/knowledge-graph";
import { SelfEvolvingMemory } from "./memory/self-evolving";

// ── LLM ──
import { createProvider } from "./llm/providers";
import { FailoverLLM } from "./llm/failover";

// ── Agent ──
import { AgentLoop } from "./agent/loop";
import { AgentSwarm, SwarmTool } from "./agent/swarm";
import { AgentComms, AgentCommsTool } from "./agent/comms";
import { MeshWorkflow, MeshTool } from "./agent/mesh";

// ── Channels ──
import { TelegramChannel } from "./channels/telegram";
import { MessageRouter } from "./channels/router";

// ── Tools ──
import { ShellTool } from "./tools/shell";
import { FileReadTool, FileWriteTool, FileListTool, FileDeleteTool, FileSearchTool } from "./tools/files";
import { WebSearchTool, WebFetchTool } from "./tools/search";
import { BrowserTool } from "./tools/browser";
import { Scheduler, SchedulerTool } from "./tools/scheduler";
import { WebhookServer } from "./tools/webhooks";
import { MCPBridge } from "./tools/mcp-bridge";
import { SkillsSystem, SkillsTool } from "./tools/skills";
import { MavenCrewTool } from "./tools/maven-crew";
import { SystemTool } from "./tools/system";
import { SocialSchedulerListProfilesTool, SocialSchedulerPostTool, SocialSchedulerPendingTool } from "./tools/social-scheduler";
import { logTask, updateTask } from "./tools/task-logger";
import { CrewDispatchTool, claimTasks, completeDispatch, dispatchTask, triggerPipelineHandoffs } from "./agent/crew-dispatch";

// ── Voice ──
import { transcribeAudio, downloadTelegramFile } from "./voice/transcription";
import { textToSpeech } from "./voice/tts";

// ── Proactive ──
import { ProactiveBriefings } from "./proactive/briefings";
import { HeartbeatSystem } from "./proactive/heartbeat";

// ── Plugins ──
import { PluginManager, MemoryTool, RecallTool } from "./plugins/system";

// ── UX ──
import { GroupManager } from "./ux/groups";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  console.log("⚡ GRAVITY CLAW v3.0 — Initializing...");
  console.log(`🔒 Security: Max ${config.security.maxAgentIterations} agent iterations`);

  // ── 1. Initialize Memory Providers ──
  const sqliteMemory = new SqliteMemory();
  await sqliteMemory.initialize();

  const markdownMemory = new MarkdownMemory("./memory");
  await markdownMemory.initialize();

  const supabaseMemory = new SupabaseVectorMemory();
  await supabaseMemory.initialize();

  const memoryProviders: MemoryProvider[] = [sqliteMemory, markdownMemory, supabaseMemory];
  console.log("# ✅ Environment validated");

  // Knowledge Graph
  const knowledgeGraph = new KnowledgeGraph();
  await knowledgeGraph.initialize();

  // Self-Evolving Memory
  const selfEvolvingMemory = new SelfEvolvingMemory();
  await selfEvolvingMemory.initialize();

  // ── 2. Initialize LLM Providers ──
  const llmProviders: LLMProvider[] = [];

  for (const providerName of config.llm.failoverOrder) {
    const providerConfig = config.llm.providers[providerName];
    if (providerConfig?.apiKey) {
      try {
        const provider = createProvider(
          providerName,
          providerConfig.apiKey,
          providerConfig.model,
          providerConfig.baseUrl
        );
        llmProviders.push(provider);
        console.log(`# ✅ Active model: ${providerConfig.model}`);
      } catch (err: any) {
        console.warn(`⚠️ LLM provider ${providerName} skipped: ${err.message}`);
      }
    }
  }

  if (llmProviders.length === 0) {
    console.error("❌ No LLM providers configured. Set at least one API key.");
    process.exit(1);
  }

  const failoverLLM = new FailoverLLM(llmProviders);

  // ── 3. Initialize Tools ──
  const tools: Tool[] = [
    // Core tools
    new ShellTool(),
    new FileReadTool(),
    new FileWriteTool(),
    new FileListTool(),
    new FileDeleteTool(),
    new FileSearchTool(),
    new WebSearchTool(),
    new WebFetchTool(),
    new BrowserTool(),

    // Memory tools
    new MemoryTool(memoryProviders),
    new RecallTool(memoryProviders),
    new KnowledgeGraphTool(knowledgeGraph),
  ];

  // MCP Bridge
  const mcpBridge = new MCPBridge();
  try {
    const mcpTools = await mcpBridge.initialize();
    tools.push(...mcpTools);
    if (mcpTools.length > 0) {
      console.log(`🔗 MCP: ${mcpTools.length} tools from ${mcpBridge.listConnectedServers().length} servers`);
    }
  } catch (err: any) {
    console.warn(`⚠️ MCP Bridge: ${err.message}`);
  }

  // Skills System
  const skillsSystem = new SkillsSystem("./skills");
  await skillsSystem.loadAll();
  tools.push(new SkillsTool(skillsSystem));

  // Maven Crew Bridge
  tools.push(new MavenCrewTool());

  // System Utilities
  tools.push(new SystemTool());

  // Social Scheduler (Buffer) — Vector's content distribution tools
  tools.push(new SocialSchedulerListProfilesTool());
  tools.push(new SocialSchedulerPostTool());
  tools.push(new SocialSchedulerPendingTool());

  // Scheduler
  const scheduler = new Scheduler();
  tools.push(new SchedulerTool(scheduler));

  // Agent Swarm
  const swarm = new AgentSwarm(failoverLLM, tools);
  tools.push(new SwarmTool(swarm));

  // Agent Comms (legacy in-memory — kept for backward compat)
  const comms = new AgentComms();
  tools.push(new AgentCommsTool(comms));

  // Crew Dispatch (Supabase-backed inter-agent routing — replaces AgentComms for cross-bot work)
  tools.push(new CrewDispatchTool("veritas"));

  // ── 4. Initialize Agent Loop ──
  const agentLoop = new AgentLoop(failoverLLM, tools, memoryProviders);
  const providersMap = new Map<string, LLMProvider>();
  llmProviders.forEach((p) => providersMap.set(p.model, p));
  agentLoop.setLLMProviders(providersMap);

  // Mesh Workflow
  const meshWorkflow = new MeshWorkflow(failoverLLM, agentLoop);
  const meshTool = new MeshTool(meshWorkflow);
  tools.push(meshTool);
  agentLoop.addTool(meshTool);

  // ── 5. Initialize Channels ──
  const telegram = new TelegramChannel();
  const router = new MessageRouter();

  // Group management — username updated after telegram.initialize() resolves getMe()
  const groupManager = new GroupManager("sovereign_bot", config.telegram.authorizedUserIds);

  // ── 6. Wire Message Handler ──
  const defaultChatId = String(config.telegram.authorizedUserIds[0]);

  router.onMessage(async (message: Message) => {
    try {
      console.log(`📥 [Handler] Message received — chatType: ${message.metadata?.chatType}, isGroup: ${message.metadata?.isGroup}, metadata: ${JSON.stringify(message.metadata)}`);
      // Group filtering
      const shouldResp = groupManager.shouldRespond(message);
      console.log(`📥 [Handler] shouldRespond: ${shouldResp}`);
      if (!shouldResp) {
        console.log(`🚫 [Handler] Message DROPPED by groupManager`);
        return;
      }

      // Strip bot mention from group messages
      if (message.metadata?.isGroup) {
        message.content = groupManager.stripMention(message.content);
      }

      // ── Voice message handling ──
      if (message.attachments?.some((a) => a.type === "voice" || a.type === "audio")) {
        const voiceAttachment = message.attachments.find((a) => a.type === "voice" || a.type === "audio");

        if (voiceAttachment?.url) {
          await telegram.sendTyping(message.chatId);

          try {
            const audioBuffer = await downloadTelegramFile(voiceAttachment.url);
            const transcription = await transcribeAudio(audioBuffer, voiceAttachment.mimeType);

            message.content = transcription;
            message.metadata = { ...message.metadata, originalType: "voice", transcription };

            await telegram.sendMessage(
              message.chatId,
              `🎙️ _Transcribed:_ ${transcription.slice(0, 200)}${transcription.length > 200 ? "..." : ""}`,
              { parseMode: "Markdown" }
            );
          } catch (err: any) {
            await telegram.sendMessage(message.chatId, `⚠️ Voice transcription failed: ${err.message}`);
            return;
          }
        }
      }

      // ── Command routing ──
      if (message.content.startsWith("/")) {
        const handled = await handleCommand(message);
        if (handled) return;
      }

      // ── Log task to Supabase command_queue ──
      const taskId = await logTask({
        command: message.content.slice(0, 500),
        agent_name: "veritas",
        chat_id: message.chatId,
        status: "in_progress",
      });

      // ── Send typing indicator ──
      console.log(`📥 [Handler] Sending typing indicator...`);
      await telegram.sendTyping(message.chatId);

      // ── Send immediate processing signal ──
      const processingMsg = await telegram.sendMessage(message.chatId, "⚡ _Veritas Processing..._", { parseMode: "Markdown" });
      const HANDLER_TIMEOUT_MS = 120_000;

      const response = await Promise.race([
        agentLoop.processMessage(
          message,
          () => telegram.sendTyping(message.chatId)
        ),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("Agent loop timed out after 120s")), HANDLER_TIMEOUT_MS)
        ),
      ]);

      // ── Update task status ──
      if (taskId) await updateTask(taskId, "completed", response.slice(0, 500));

      // ── Send response ──
      // Check if voice response was requested
      const wantsVoice = message.metadata?.originalType === "voice" && config.voice.elevenLabsApiKey;

      if (wantsVoice) {
        try {
          const audioBuffer = await textToSpeech(response);
          if (telegram.deleteMessage) {
            await telegram.deleteMessage(message.chatId, processingMsg.channelMessageId!);
          }
          await telegram.sendVoice!(message.chatId, audioBuffer);
        } catch (err: any) {
          console.error("TTS failed, sending text:", err.message);
          if (telegram.editMessage) {
            await telegram.editMessage(message.chatId, processingMsg.channelMessageId!, response, { parseMode: "Markdown" });
          } else {
            await telegram.sendMessage(message.chatId, response, { parseMode: "Markdown" });
          }
        }
      } else {
        if (telegram.editMessage) {
          await telegram.editMessage(message.chatId, processingMsg.channelMessageId!, response, { parseMode: "Markdown" });
        } else {
          await telegram.sendMessage(message.chatId, response, { parseMode: "Markdown" });
        }
      }

    } catch (err: any) {
      console.error("Message handling error:", err);
      try {
        await telegram.sendMessage(message.chatId, `⚠️ Processing error: ${err.message}`);
      } catch {
        // Last resort
      }
    }
  });

  // ── Command Handler ──
  async function handleCommand(message: Message): Promise<boolean> {
    const [cmd, ...args] = message.content.split(" ");
    const arg = args.join(" ");

    switch (cmd) {
      case "/start":
        await telegram.sendMessage(message.chatId,
          `⚡ *GRAVITY CLAW v3.0 — ONLINE*\n\n` +
          `Sovereign Frequency: *LOCKED*\n` +
          `Protocol 77: *ACTIVE*\n` +
          `LLM: *${failoverLLM.activeProvider || failoverLLM.listProviders()[0]}*\n` +
          `Memory: *${memoryProviders.map((m) => m.name).join(", ")}*\n` +
          `Tools: *${tools.length} loaded*\n\n` +
          `Commands:\n` +
          `/model [name] — Switch LLM provider\n` +
          `/models — List available providers\n` +
          `/memory — Show memory stats\n` +
          `/compact — Compress conversation history\n` +
          `/skills — List loaded skills\n` +
          `/schedule — List scheduled tasks\n` +
          `/mesh [goal] — Run mesh workflow\n` +
          `/swarm [goal] — Deploy agent swarm\n` +
          `/status — System status\n` +
          `/voice — Toggle voice responses`,
          { parseMode: "Markdown" }
        );
        return true;

      case "/model":
        if (!arg) {
          await telegram.sendMessage(message.chatId, `Current: ${failoverLLM.activeProvider || "auto"}\nUse /models to see available.`);
        } else {
          const switched = failoverLLM.switchPrimary(arg);
          await telegram.sendMessage(message.chatId,
            switched ? `🔀 Switched to: *${arg}*` : `⚠️ Provider "${arg}" not found. Use /models.`,
            { parseMode: "Markdown" }
          );
        }
        return true;

      case "/models":
        await telegram.sendMessage(message.chatId,
          `🧠 *Available LLM Providers:*\n${failoverLLM.listProviders().map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
          { parseMode: "Markdown" }
        );
        return true;

      case "/memory":
        const facts = await sqliteMemory.getFacts();
        const msgCount = sqliteMemory.getMessageCount(message.chatId);
        await telegram.sendMessage(message.chatId,
          `🧠 *Memory Status:*\n` +
          `SQLite: ${msgCount} messages, ${facts.length} facts\n` +
          `Markdown: Active\n` +
          `Supabase: ${config.memory.supabaseUrl ? "Connected" : "Not configured"}\n` +
          `Knowledge Graph: Active`,
          { parseMode: "Markdown" }
        );
        return true;

      case "/compact":
        await telegram.sendMessage(message.chatId, "🗜️ Compacting conversation history...");
        await sqliteMemory.compact(message.chatId);
        await telegram.sendMessage(message.chatId, "✅ Compaction complete.");
        return true;

      case "/skills":
        const skillList = skillsSystem.listSkills();
        if (skillList.length === 0) {
          await telegram.sendMessage(message.chatId, "No skills loaded. Add .md files to /skills directory.");
        } else {
          await telegram.sendMessage(message.chatId,
            `📚 *Loaded Skills:*\n${skillList.map((s) => `• ${s.name}: ${s.description}`).join("\n")}`,
            { parseMode: "Markdown" }
          );
        }
        return true;

      case "/schedule":
        const tasks = scheduler.list();
        if (tasks.length === 0) {
          await telegram.sendMessage(message.chatId, "No scheduled tasks.");
        } else {
          await telegram.sendMessage(message.chatId,
            `⏰ *Scheduled Tasks:*\n${tasks.map((t) => `${t.id} | ${t.name} | ${t.enabled ? "ACTIVE" : "PAUSED"}`).join("\n")}`,
            { parseMode: "Markdown" }
          );
        }
        return true;

      case "/status":
        await telegram.sendMessage(message.chatId,
          `📊 *SYSTEM STATUS — GRAVITY CLAW v3.0*\n\n` +
          `⚡ LLM: ${failoverLLM.activeProvider || failoverLLM.listProviders()[0]}\n` +
          `🧠 Memory Tiers: ${memoryProviders.length}\n` +
          `🔧 Tools: ${tools.length}\n` +
          `📡 MCP Servers: ${mcpBridge.listConnectedServers().length}\n` +
          `📚 Skills: ${skillsSystem.listSkills().length}\n` +
          `⏰ Scheduled: ${scheduler.list().length}\n` +
          `🔒 Security: ${config.security.maxAgentIterations} max iterations\n\n` +
          `*FREQUENCY: SOVEREIGN*`,
          { parseMode: "Markdown" }
        );
        return true;

      case "/mesh":
        if (!arg) {
          await telegram.sendMessage(message.chatId, "Usage: /mesh <goal>");
          return true;
        }
        // Run mesh as a regular message (let agent loop handle it)
        return false;

      case "/swarm":
        if (!arg) {
          await telegram.sendMessage(message.chatId, "Usage: /swarm <goal> [agents]");
          return true;
        }
        return false;

      default:
        // Unknown command — let agent loop handle it
        return false;
    }
  }

  // ── 7. Proactive Systems ──
  const briefings = new ProactiveBriefings(failoverLLM, memoryProviders, telegram, defaultChatId);
  const heartbeat = new HeartbeatSystem(telegram, defaultChatId);

  // In-memory guard to prevent briefings from firing every 60s during the matching hour
  const briefingFiredDates = { morning: "", evening: "" };

  // Schedule morning briefing
  scheduler.add({
    name: "Morning Briefing",
    intervalMs: 60_000, // Check every minute
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      const hour = new Date().getHours();
      const dateKey = new Date().toDateString();
      if (hour === config.scheduler.morningBriefingHour && briefingFiredDates.morning !== dateKey) {
        briefingFiredDates.morning = dateKey;
        console.log(`📋 Pulse 1: Morning briefing firing for ${dateKey}`);
        await briefings.morningBriefing();
      }
    },
  });

  // Schedule evening recap
  scheduler.add({
    name: "Evening Recap",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      const hour = new Date().getHours();
      const dateKey = new Date().toDateString();
      if (hour === config.scheduler.eveningRecapHour && briefingFiredDates.evening !== dateKey) {
        briefingFiredDates.evening = dateKey;
        console.log(`📋 Pulse 2: Evening recap firing for ${dateKey}`);
        await briefings.eveningRecap();
      }
    },
  });

  // Heartbeat with memory evolution
  heartbeat.addCheck({
    name: "Pulse 3: Memory Evolution",
    silent: true,
    check: async () => {
      // Run memory decay once per day
      const lastDecay = await sqliteMemory.getSummary("__last_decay");
      const today = new Date().toDateString();
      if (lastDecay === today) return null;

      const result = selfEvolvingMemory.reorganize();
      await sqliteMemory.saveSummary("__last_decay", today);
      return result;
    },
  });

  heartbeat.start();
  console.log("# Heartbeat: Running every 300s — SILENT mode");

  // ── 8. Webhook Server ──
  const webhookServer = new WebhookServer();

  webhookServer.register("/api/heartbeat", async (payload: any) => {
    const tag = payload?.tag || "system";
    const message = payload?.message || `⚡ Heartbeat received — ${tag}`;
    
    // Suppress Telegram notification for "system" tag as requested by Architect
    if (tag !== "system") {
      await telegram.sendMessage(defaultChatId, message, { parseMode: "Markdown" });
    }
    
    console.log(`📡 [Webhook] Heartbeat: ${message} (Telegram: ${tag !== "system" ? "SENT" : "SUPPRESSED"})`);
    return "delivered";
  });

  webhookServer.register("/api/notify", async (payload: any) => {
    const text = payload?.text || JSON.stringify(payload).slice(0, 1000);
    await telegram.sendMessage(defaultChatId, `🔔 *NOTIFICATION*\n${text}`, { parseMode: "Markdown" });
    return "delivered";
  });

  // ── Crew Dispatch webhook — external systems (Make.com) can push tasks to agents ──
  webhookServer.register("/api/dispatch", async (incoming: any) => {
    const { from_agent, to_agent, task_type, payload: taskPayload, data, priority, chat_id } = incoming as any;
    if (!to_agent) return "error: to_agent required";

    const id = await dispatchTask({
      from_agent: from_agent || "external",
      to_agent,
      task_type: task_type || "webhook_trigger",
      payload: taskPayload || data || incoming,
      priority: priority || 5,
      chat_id: chat_id || defaultChatId,
    });

    console.log(`📡 [Dispatch Webhook] ${from_agent || "external"} → ${to_agent} | type: ${task_type} | id: ${id}`);
    return id ? `dispatched:${id}` : "error: dispatch failed";
  });

  await webhookServer.start();

  // ── 9. Start Telegram (Veritas) ──
  await telegram.initialize();
  // Update Veritas GroupManager with real Telegram username from getMe()
  if (telegram.botUsername) {
    groupManager.setBotUsername(telegram.botUsername);
    console.log(`[Veritas] GroupManager updated to real username: @${telegram.botUsername}`);
  }
  console.log("# ✅ Vanguard is LIVE");

  // Register channel in router
  router.registerChannel(telegram);

  // ── 11. Multi-Bot Initialization (Maven Crew) ──
  const crewAgents = [
    { name: "sapphire", token: process.env.SAPPHIRE_TOKEN },
    { name: "alfred", token: process.env.ALFRED_TOKEN },
    { name: "yuki", token: process.env.YUKI_TOKEN },
    { name: "anita", token: process.env.ANITA_TOKEN },
    { name: "vector", token: process.env.VECTOR_TOKEN },
  ];

  const agentChannels: TelegramChannel[] = [];
  const activeBotHandles: string[] = ["Veritas"];

  // Stagger delay between bot inits to prevent simultaneous Anthropic rate-limit hits
  const BOT_INIT_STAGGER_MS = 4_000;

  // ── Map to hold each agent's AgentLoop + Channel for dispatch processing ──
  const agentLoops: Map<string, { loop: AgentLoop; channel: TelegramChannel }> = new Map();

  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    const supabase = (await import("@supabase/supabase-js")).createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    let botIndex = 0;
    for (const agentCfg of crewAgents) {
      const token = agentCfg.token;
      if (!token) continue;

      // Stagger: wait before initializing each subsequent bot
      if (botIndex > 0) {
        console.log(`⏳ Stagger delay: waiting ${BOT_INIT_STAGGER_MS / 1000}s before initializing ${agentCfg.name}...`);
        await new Promise((resolve) => setTimeout(resolve, BOT_INIT_STAGGER_MS));
      }
      botIndex++;

      try {
        console.log(`[BotInit] ${agentCfg.name} token: ${token.substring(0, 8)}...`);

        // Fetch personality from Supabase
        console.log(`[BotInit] Querying personality_config for agent_name = '${agentCfg.name}'`);
        const { data: personality, error } = await supabase
          .from("personality_config")
          .select("prompt_blueprint, agent_name")
          .eq("agent_name", agentCfg.name)
          .maybeSingle();

        if (error || !personality) {
          console.warn(`⚠️ Could not find personality for ${agentCfg.name} in Supabase`);
          if (error) console.error(`[BotInit] Supabase Error for ${agentCfg.name}:`, JSON.stringify(error, null, 2));
          else console.warn(`[BotInit] personality_config returned null for ${agentCfg.name}`);
          continue;
        }

        // Initialize Channel with token swapping trick (swap -> init -> swap back)
        const originalToken = config.telegram.botToken;
        (config.telegram as any).botToken = token;
        const agentChannel = new TelegramChannel();
        await agentChannel.initialize();
        (config.telegram as any).botToken = originalToken;

        // Wrap LLM for system prompt injection
        const blueprint = personality.prompt_blueprint;
        const injectedLLM: LLMProvider = {
          ...failoverLLM,
          generate: (messages, options) =>
            failoverLLM.generate(messages, { ...options, systemPrompt: blueprint }),
        };

        // Build per-agent tool set: shared tools + agent-specific CrewDispatchTool
        const agentTools = [...tools, new CrewDispatchTool(agentCfg.name)];

        // Initialize Agent Loop (Unique per bot)
        const agentBotLoop = new AgentLoop(injectedLLM, agentTools, memoryProviders);
        agentBotLoop.setLLMProviders(providersMap);

        // Store loop + channel reference for dispatch polling
        agentLoops.set(agentCfg.name, { loop: agentBotLoop, channel: agentChannel });

        // Group management for agent bot — use REAL Telegram username from getMe()
        const realBotUsername = agentChannel.botUsername || `${agentCfg.name}_SovereignBot`;
        const agentGroupManager = new GroupManager(realBotUsername, config.telegram.authorizedUserIds);
        console.log(`[BotInit] ${agentCfg.name} GroupManager username: @${realBotUsername}`);

        // Wire Handler (Isolated from MessageRouter)
        agentChannel.onMessage(async (message: Message) => {
          try {
            if (!agentGroupManager.shouldRespond(message)) return;
            if (message.metadata?.isGroup) message.content = agentGroupManager.stripMention(message.content);

            // Voice handling
            if (message.attachments?.some((a) => a.type === "voice" || a.type === "audio")) {
              const voiceAttachment = message.attachments.find((a) => a.type === "voice" || a.type === "audio");
              if (voiceAttachment?.url) {
                await agentChannel.sendTyping(message.chatId);
                const audioBuffer = await downloadTelegramFile(voiceAttachment.url);
                const transcription = await transcribeAudio(audioBuffer, voiceAttachment.mimeType);
                message.content = transcription;
                await agentChannel.sendMessage(message.chatId, `🎙️ _Transcribed:_ ${transcription.slice(0, 200)}...`, { parseMode: "Markdown" });
              }
            }

            // ── ALFRED: YouTube URL Pipeline Interceptor ──
            // Fires three parallel streams:
            //   1. Scenario E — DumplingAI transcript → dispatches back to Alfred via /api/dispatch
            //   2. Scenario F — OpusClip clip extraction → dispatches to Yuki via /api/dispatch
            //   3. Alfred's own LLM processes the URL with injected pipeline context
            const YOUTUBE_URL_RE = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/i;
            if (agentCfg.name === "alfred" && YOUTUBE_URL_RE.test(message.content)) {
              const match = message.content.match(YOUTUBE_URL_RE);
              const videoId = match?.[1];
              const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

              await agentChannel.sendTyping(message.chatId);
              await agentChannel.sendMessage(message.chatId,
                `🎯 _YouTube URL detected. Activating Vid Rush Pipeline..._\n` +
                `Video ID: \`${videoId}\`\n` +
                `📡 _Scenario E (Transcript) + Scenario F (OpusClip) firing in parallel..._`,
                { parseMode: "Markdown" }
              );

              // Fire Make.com webhooks in parallel — Scenario E (transcript) + Scenario F (OpusClip)
              const SCENARIO_E_WEBHOOK = process.env.MAKE_SCENARIO_E_WEBHOOK || "";
              const SCENARIO_F_WEBHOOK = process.env.MAKE_SCENARIO_F_WEBHOOK || "";
              const webhookPayload = {
                youtube_url: youtubeUrl,
                video_id: videoId,
                chat_id: String(message.chatId),
                triggered_by: "alfred",
              };

              const webhookFires: Promise<void>[] = [];

              if (SCENARIO_E_WEBHOOK) {
                webhookFires.push(
                  fetch(SCENARIO_E_WEBHOOK, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(webhookPayload),
                  }).then(() => console.log(`📡 [Alfred] Scenario E webhook fired for ${youtubeUrl}`))
                    .catch((err: any) => console.error(`[Alfred] Scenario E webhook error: ${err.message}`))
                );
              } else {
                console.warn("[Alfred] MAKE_SCENARIO_E_WEBHOOK not set — transcript pipeline skipped");
              }

              if (SCENARIO_F_WEBHOOK) {
                webhookFires.push(
                  fetch(SCENARIO_F_WEBHOOK, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      ...webhookPayload,
                      opusclip_api_key: process.env.OPUSCLIP_API_KEY || "",
                    }),
                  }).then(() => console.log(`📡 [Alfred] Scenario F webhook fired for ${youtubeUrl}`))
                    .catch((err: any) => console.error(`[Alfred] Scenario F webhook error: ${err.message}`))
                );
              } else {
                console.warn("[Alfred] MAKE_SCENARIO_F_WEBHOOK not set — OpusClip pipeline skipped");
              }

              // Fire all webhooks in parallel (don't block the main flow)
              Promise.all(webhookFires).catch(() => {});

              // Inject pipeline context into the message so Alfred's LLM processes it
              message.content = `[VID RUSH PIPELINE ACTIVATED] Content Factory triggered for: ${youtubeUrl}\n\n` +
                `Your task: Process this YouTube URL. Auto-detect the niche (dark psychology, self-improvement, burnout, or quantum physics). ` +
                `Extract 3 timestamped hooks: (1) 0:00 scroll-stopping opening, (2) ~30% escalation, (3) ~70% solution/reveal. ` +
                `Generate a cleaned transcript summary and 1 core transmission sentence. Apply Sovereign Synthesis lexicon. ` +
                `Use the crew_dispatch tool to send your outputs downstream: ` +
                `dispatch timestamped_hooks to yuki, cleaned_transcript to anita, and core_summary to sapphire.\n` +
                `NOTE: DumplingAI transcript (Scenario E) and OpusClip clips (Scenario F) are being processed in parallel via Make.com.\n` +
                `Original message: ${message.content}`;
            }

            // Log task to Supabase command_queue
            const agentTaskId = await logTask({
              command: message.content.slice(0, 500),
              agent_name: agentCfg.name,
              chat_id: message.chatId,
              status: "in_progress",
            });

            await agentChannel.sendTyping(message.chatId);
            const agentNameCap = agentCfg.name.charAt(0).toUpperCase() + agentCfg.name.slice(1);
            const processingMsg = await agentChannel.sendMessage(message.chatId, `⚡ _${agentNameCap} Processing..._`, { parseMode: "Markdown" });

            const response = await agentBotLoop.processMessage(message, () => agentChannel.sendTyping(message.chatId));

            // Update task status
            if (agentTaskId) await updateTask(agentTaskId, "completed", response.slice(0, 500));

            if (agentChannel.editMessage) {
              await agentChannel.editMessage(message.chatId, processingMsg.channelMessageId!, response, { parseMode: "Markdown" });
            } else {
              await agentChannel.sendMessage(message.chatId, response, { parseMode: "Markdown" });
            }
          } catch (err: any) {
            console.error(`[${agentCfg.name}] Handler error:`, err);
            await agentChannel.sendMessage(message.chatId, `⚠️ Error: ${err.message}`);
          }
        });

        agentChannels.push(agentChannel);
        activeBotHandles.push(agentCfg.name.charAt(0).toUpperCase() + agentCfg.name.slice(1));
      } catch (err: any) {
        console.error(`❌ Failed to initialize ${agentCfg.name} bot:`, err.message);
      }
    }

    // ── Dispatch Poller — checks Supabase crew_dispatch for pending tasks every 15s ──
    const DISPATCH_POLL_MS = 15_000;
    if (agentLoops.size > 0) {
      console.log(`📡 [CrewDispatch] Starting dispatch poller for ${agentLoops.size} agents (every ${DISPATCH_POLL_MS / 1000}s)`);

      setInterval(async () => {
        for (const [agentName, { loop: agentLoop, channel }] of agentLoops) {
          try {
            const tasks = await claimTasks(agentName, 3);
            if (tasks.length === 0) continue;

            for (const task of tasks) {
              console.log(`🔄 [DispatchPoller] ${agentName} processing dispatch ${task.id} (type: ${task.task_type})`);

              // Build a synthetic message from the dispatch payload
              const payloadStr = JSON.stringify(task.payload, null, 2);
              const dispatchMessage: Message = {
                id: `dispatch-${task.id}`,
                role: "user",
                content: `[DISPATCHED TASK from ${task.from_agent}]\nType: ${task.task_type}\nDispatch ID: ${task.id}\n\nPayload:\n${payloadStr}\n\n` +
                  `Process this task according to your role. When done, use crew_dispatch tool with action "complete" and task_id "${task.id}" to mark it done.`,
                timestamp: new Date(),
                channel: "telegram",
                chatId: task.chat_id || defaultChatId,
                userId: "dispatch-system",
                metadata: { isDispatch: true, dispatchId: task.id, fromAgent: task.from_agent },
              };

              try {
                const response = await agentLoop.processMessage(dispatchMessage);
                await completeDispatch(task.id, "completed", response.slice(0, 4000));

                // Auto-trigger pipeline handoffs if this agent has downstream routes
                try {
                  const handoffIds = await triggerPipelineHandoffs(
                    agentName,
                    { response, ...task.payload },
                    task.id,
                    task.chat_id || defaultChatId
                  );
                  if (handoffIds.length > 0) {
                    console.log(`🔗 [Pipeline] ${agentName} auto-dispatched ${handoffIds.length} downstream task(s)`);
                  }
                } catch (handoffErr: any) {
                  console.error(`[Pipeline] Handoff error for ${agentName}: ${handoffErr.message}`);
                }

                // Notify the originating chat that dispatch was processed
                if (task.chat_id) {
                  await channel.sendMessage(
                    task.chat_id,
                    `📡 _${agentName.charAt(0).toUpperCase() + agentName.slice(1)} completed dispatch from ${task.from_agent}: ${task.task_type}_`,
                    { parseMode: "Markdown" }
                  );
                }
              } catch (processErr: any) {
                console.error(`[DispatchPoller] ${agentName} failed on ${task.id}: ${processErr.message}`);
                await completeDispatch(task.id, "failed", processErr.message);
              }
            }
          } catch (pollErr: any) {
            // Silent — don't let polling errors crash anything
            console.error(`[DispatchPoller] ${agentName} poll error: ${pollErr.message}`);
          }
        }
      }, DISPATCH_POLL_MS);
    }
  }

  // ── 10. Memory heartbeat log ──
  console.log("\n━━━ GRAVITY CLAW v3.0 — FULLY ONLINE ━━━");
  console.log(`🧠 Memory: ${memoryProviders.map((m) => m.name).join(" + ")}`);
  console.log(`🔧 Tools: ${tools.length} loaded`);
  console.log(`🧬 LLM: ${failoverLLM.listProviders().join(" → ")}`);
  console.log(`📡 Channels: ${router.listChannels().join(", ")}`);
  console.log(`✅ Maven Crew ONLINE — [${activeBotHandles.join(", ")}]`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ── Graceful Shutdown ──
  const shutdown = async () => {
    console.log("🛑 GRAVITY CLAW shutting down...");
    heartbeat.stop();
    scheduler.shutdown();
    await webhookServer.shutdown();
    await mcpBridge.shutdown();
    await router.shutdownAll();
    
    // Shutdown agent channels
    for (const chan of agentChannels) {
      await chan.shutdown();
    }

    for (const provider of memoryProviders) {
      await provider.close();
    }
    knowledgeGraph.close();
    selfEvolvingMemory.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  process.on("uncaughtException", (err) => {
    console.error("💥 Uncaught Exception:", err);
  });

  process.on("unhandledRejection", (reason: any) => {
    console.error("💥 Unhandled Rejection:", reason);
  });
}

// ── Launch ──
main().catch((err) => {
  console.error("❌ Fatal startup error:", err);
  process.exit(1);
});
