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
import { BrowserTool, saveCookies, loadCookies, COOKIE_DIR } from "./tools/browser";
import { Scheduler, SchedulerTool } from "./tools/scheduler";
import { WebhookServer } from "./tools/webhooks";
import { MCPBridge } from "./tools/mcp-bridge";
import { SkillsSystem, SkillsTool } from "./tools/skills";
// MavenCrewTool removed — Python CrewAI replaced by TS crew-dispatch system
import { SystemTool } from "./tools/system";
import { SocialSchedulerListProfilesTool, SocialSchedulerPostTool, SocialSchedulerPendingTool } from "./tools/social-scheduler";
import { ClipGeneratorTool } from "./tools/clip-generator";
import { VidRushTool } from "./tools/vid-rush";
import { TikTokBrowserUploadTool, tiktokLoginFlow } from "./tools/tiktok-browser-upload";
import { InstagramBrowserUploadTool, instagramLoginFlow } from "./tools/instagram-browser-upload";
import { logTask, updateTask, logAgentActivity } from "./tools/task-logger";
import { CrewDispatchTool, claimTasks, claimAllPending, completeDispatch, dispatchTask, triggerPipelineHandoffs, checkPipelineComplete } from "./agent/crew-dispatch";
import { ProtocolReaderTool, ProtocolWriterTool } from "./tools/protocol-reader";
import { RelationshipContextTool } from "./tools/relationship-context";
import { SapphireSentinel } from "./proactive/sapphire-sentinel";
import { PineconeMemory } from "./memory/pinecone";
import { KnowledgeWriterTool } from "./tools/knowledge-writer";
import { ImageGeneratorTool } from "./tools/image-generator";
import { produceFacelessBatch } from "./engine/faceless-factory";
import { extractWhisperIntel } from "./engine/whisper-extract";
import { executeFullPipeline, formatPipelineReport, type PipelineOptions } from "./engine/vidrush-orchestrator";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ProposeTaskTool, SaveContentDraftTool, FileBriefingTool, CheckApprovedTasksTool } from "./tools/action-surface";
import { StripeMetricsTool } from "./tools/stripe-metrics";
import { VideoPublisherTool, TikTokPublishTool, InstagramReelsPublishTool, YouTubeShortsPublishTool, YouTubeLongFormPublishTool } from "./tools/video-publisher";

// ── Voice ──
import { transcribeAudio, downloadTelegramFile } from "./voice/transcription";
import { textToSpeech } from "./voice/tts";

// ── Proactive ──
import { ProactiveBriefings } from "./proactive/briefings";
import { HeartbeatSystem } from "./proactive/heartbeat";

// ── Content Engine ──
import { dailyContentProduction, distributionSweep, contentEngineStatus, discoverChannels, nukeBufferQueue } from "./engine/content-engine";

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

  // Pinecone Semantic Memory (Tier 4 — crew-wide institutional intelligence)
  const pineconeMemory = new PineconeMemory();
  await pineconeMemory.initialize();

  // Log Pinecone status on startup
  if (pineconeMemory.isReady()) {
    console.log(`🧠 Pinecone semantic memory: ${process.env.PINECONE_INDEX || "gravity-claw"} — ACTIVE`);
  }

  // Seed personality blueprints into Pinecone on first boot (idempotent — deterministic IDs prevent duplicates)
  // Then sync any unembedded knowledge_nodes (bulk SQL imports like memory transfers) into Pinecone
  if (pineconeMemory.isReady()) {
    // Blueprint seeder (fire-and-forget, non-blocking)
    pineconeMemory.seedBlueprints()
      .then((count) => { if (count > 0) console.log(`🌱 [Boot] Seeded ${count} blueprint chunks into Pinecone`); })
      .catch((err) => console.error(`[Boot] Blueprint seeding failed: ${err.message}`));

    // Vector sync for SQL-imported knowledge_nodes (independent, runs in parallel)
    pineconeMemory.syncUnembeddedToVector()
      .then((count) => { if (count > 0) console.log(`🔄 [Boot] Synced ${count} knowledge nodes to Pinecone vectors`); })
      .catch((err) => console.error(`[Boot] Vector sync failed: ${err.message}`));
  }

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

  // ── 2B. Per-Agent LLM Provider Teams ──
  // Split providers across agents to prevent quota stampedes.
  // When all agents share one chain, a Gemini quota hit cascades to ALL agents simultaneously.
  // This gives each team its own primary, with the others as failover.
  const providersByName: Record<string, LLMProvider> = {};
  for (const p of llmProviders) providersByName[p.name] = p;

  function buildTeamLLM(primaryOrder: string[]): FailoverLLM {
    const chain: LLMProvider[] = [];
    for (const name of primaryOrder) {
      if (providersByName[name]) chain.push(providersByName[name]);
    }
    // Add any remaining providers not in the explicit order as fallback
    for (const p of llmProviders) {
      if (!chain.includes(p)) chain.push(p);
    }
    return new FailoverLLM(chain);
  }

  // Team assignments:
  // Alfred + Anita → Gemini primary (low rate, research/writing tasks)
  // Sapphire + Veritas → Anthropic primary (strategic, less frequent, high quality)
  // Vector + Yuki → Groq primary (Yuki = most tool calls, Groq = 14,400/day free tier)
  const AGENT_LLM_TEAMS: Record<string, FailoverLLM> = {
    alfred: buildTeamLLM(["anthropic", "gemini", "groq"]),
    anita: buildTeamLLM(["anthropic", "gemini", "groq"]),
    sapphire: buildTeamLLM(["anthropic", "gemini", "groq"]),
    veritas: buildTeamLLM(["anthropic", "gemini", "groq"]),
    vector: buildTeamLLM(["groq", "anthropic", "gemini"]),
    yuki: buildTeamLLM(["groq", "anthropic", "gemini"]),
  };

  console.log("🔀 [LLM Teams] Provider split active:");
  for (const [agent, team] of Object.entries(AGENT_LLM_TEAMS)) {
    console.log(`   ${agent}: ${team.listProviders().join(" → ")}`);
  }

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
    new TikTokBrowserUploadTool(),
    new InstagramBrowserUploadTool(),

    // Memory tools
    new MemoryTool(memoryProviders),
    new RecallTool(memoryProviders),
    new KnowledgeGraphTool(knowledgeGraph),
  ];

  // MCP Bridge — gated behind MCP_ENABLED to prevent OOM on constrained containers
  // Each MCP server spawns a child process (~100-200MB each). With 9 servers = ~1.5GB extra.
  const mcpBridge = new MCPBridge();
  if (process.env.MCP_ENABLED === "true") {
    try {
      const mcpTools = await mcpBridge.initialize();
      tools.push(...mcpTools);
      if (mcpTools.length > 0) {
        console.log(`🔗 MCP: ${mcpTools.length} tools from ${mcpBridge.listConnectedServers().length} servers`);
      }
    } catch (err: any) {
      console.warn(`⚠️ MCP Bridge: ${err.message}`);
    }
  } else {
    console.log("ℹ️ MCP Bridge DISABLED (set MCP_ENABLED=true to activate)");
  }

  // Skills System
  const skillsSystem = new SkillsSystem("./skills");
  await skillsSystem.loadAll();
  tools.push(new SkillsTool(skillsSystem));

  // Maven Crew Bridge — removed (Python CrewAI replaced by TS crew-dispatch)

  // System Utilities
  tools.push(new SystemTool());

  // Social Scheduler (Buffer) — Yuki's distribution tools (Yuki = SOLE posting authority)
  tools.push(new SocialSchedulerListProfilesTool());
  tools.push(new SocialSchedulerPostTool());
  tools.push(new SocialSchedulerPendingTool());

  // Sovereign Clip Pipeline (yt-dlp + ffmpeg + Whisper)
  tools.push(new ClipGeneratorTool());
  tools.push(new VidRushTool());

  // Direct Video Publisher (Path A — bypasses Buffer for video content)
  // Buffer v1 API has NO video upload capability. Videos go direct to platform APIs.
  tools.push(new VideoPublisherTool());

  // Sovereign Image Generator (Gemini Imagen 3 + DALL-E 3 fallback)
  tools.push(new ImageGeneratorTool());

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

  // Action Surface — Veritas gets all tools (lead agent)
  tools.push(new ProposeTaskTool("veritas"));
  tools.push(new CheckApprovedTasksTool("veritas"));
  tools.push(new SaveContentDraftTool("veritas"));
  tools.push(new FileBriefingTool("veritas"));

  // Pinecone KnowledgeWriter for Veritas (namespace: brand)
  if (pineconeMemory.isReady()) {
    tools.push(new KnowledgeWriterTool(pineconeMemory, "veritas", "brand"));
  }

  // ── 4. Initialize Agent Loop ──
  const agentLoop = new AgentLoop(failoverLLM, tools, memoryProviders);
  const providersMap = new Map<string, LLMProvider>();
  llmProviders.forEach((p) => providersMap.set(p.model, p));
  agentLoop.setLLMProviders(providersMap);

  // Wire Pinecone semantic memory to Veritas
  if (pineconeMemory.isReady()) {
    agentLoop.setPinecone(pineconeMemory);
    agentLoop.setIdentity({ agentName: "veritas", namespace: "brand", defaultNiche: "general" });
  }

  // Mesh Workflow
  const meshWorkflow = new MeshWorkflow(failoverLLM, agentLoop);
  const meshTool = new MeshTool(meshWorkflow);
  tools.push(meshTool);
  agentLoop.addTool(meshTool);

  // ── 5. Initialize Channels ──
  const telegram = new TelegramChannel();
  const router = new MessageRouter();

  // Group management — username updated after telegram.initialize() resolves getMe()
  // "lead" role → Veritas responds to ALL Architect messages in groups (no @mention needed)
  const groupManager = new GroupManager("sovereign_bot", config.telegram.authorizedUserIds, "lead");

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

      // ── Roll Call / Check-In — Veritas gives full group-aware status ──
      if (message.metadata?.isGroup && groupManager.isBroadcastTrigger(message)) {
        await telegram.sendTyping(message.chatId);
        const rollCallMsg: Message = {
          ...message,
          content: `[GROUP CHECK-IN] The Architect has called a check-in in the Maven Crew group chat. ` +
            `You are Veritas. Give a brief but substantive status report in your voice. ` +
            `Include: your operational status, what you're currently tracking, and one actionable insight or recommendation. ` +
            `Keep it concise (3-5 sentences). Speak with authority. No @mentions.`,
        };
        const response = await agentLoop.processMessage(rollCallMsg, () => telegram.sendTyping(message.chatId));
        await telegram.sendMessage(message.chatId, response, { parseMode: "Markdown" });
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

      // ── Update task status + log to Mission Control ──
      if (taskId) await updateTask(taskId, "completed", response.slice(0, 500));
      logAgentActivity("veritas", response.slice(0, 500), {
        trigger: message.content.slice(0, 200),
        chat_id: message.chatId,
      });

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
          `/voice — Toggle voice responses\n` +
          `/dryrun <url> — Validate pipeline (zero cost)\n` +
          `/test_tts — Test TTS on one segment\n` +
          `/test_yt — Test YouTube upload with 5s clip`,
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

      case "/test_tts": {
        await telegram.sendMessage(message.chatId, "🧪 Testing TTS on a single segment...");
        try {
          const { textToSpeech } = await import("./voice/tts");
          const testText = "The simulation never wanted you to see behind the curtain. But here you are, Architect. Protocol 77 is active.";
          const startMs = Date.now();
          const buffer = await textToSpeech(testText);
          const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
          await telegram.sendMessage(message.chatId,
            `✅ TTS test passed\n` +
            `Text: ${testText.length} chars\n` +
            `Audio: ${(buffer.length / 1024).toFixed(0)} KB\n` +
            `Time: ${elapsed}s`,
          );
        } catch (err: any) {
          await telegram.sendMessage(message.chatId, `❌ TTS test FAILED: ${err.message?.slice(0, 400)}`);
        }
        return true;
      }

      case "/test_yt": {
        await telegram.sendMessage(message.chatId, "🧪 Testing YouTube upload with a 5s dummy clip...");
        try {
          const { execSync } = await import("child_process");
          const { existsSync, mkdirSync } = await import("fs");
          const testDir = "/tmp/yt_test";
          if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
          const testPath = `${testDir}/test_${Date.now()}.mp4`;

          // Create 5s test video
          execSync(
            `ffmpeg -f lavfi -i color=c=black:s=1920x1080:d=5 -f lavfi -i anullsrc=r=44100:cl=mono -shortest -c:v libx264 -preset ultrafast -c:a aac -y "${testPath}"`,
            { timeout: 15_000, stdio: "pipe" }
          );

          const { YouTubeLongFormPublishTool } = await import("./tools/video-publisher");
          const ytTool = new YouTubeLongFormPublishTool();
          const result = await ytTool.execute({
            local_path: testPath,
            title: "TEST — Delete Me — Pipeline Validation",
            description: "Automated test upload. Safe to delete.",
            tags: "test,delete",
            niche: "test",
            brand: "ace_richie",
          });
          await telegram.sendMessage(message.chatId, `YouTube test result:\n${result.slice(0, 500)}`);
        } catch (err: any) {
          await telegram.sendMessage(message.chatId, `❌ YouTube test FAILED: ${err.message?.slice(0, 400)}`);
        }
        return true;
      }

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

  // ── Autonomous Business Ops — Scheduled Agent Jobs ──
  // These dispatch tasks to crew agents via crew_dispatch, picked up by the dispatch poller.
  // Each fires once per day at a specific hour using the same minute-check pattern as briefings.

  const autonomousFiredDates = { vectorSweep: "", alfredScan: "", veritasDirective: "" };

  // Vector — Daily CRO Metrics Sweep (10 AM)
  scheduler.add({
    name: "Vector Daily Metrics Sweep",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      const hour = new Date().getHours();
      const dateKey = new Date().toDateString();
      if (hour === 10 && autonomousFiredDates.vectorSweep !== dateKey) {
        autonomousFiredDates.vectorSweep = dateKey;
        console.log(`📊 [AutoOps] Vector daily metrics sweep firing for ${dateKey}`);
        try {
          await dispatchTask({
            from_agent: "system",
            to_agent: "vector",
            task_type: "daily_metrics_sweep",
            priority: 1,
            chat_id: defaultChatId,
            payload: {
              directive: "DAILY CRO METRICS SWEEP — Execute your Chief Revenue Officer protocol. " +
                "Pull current revenue metrics from Stripe (MRR, churn rate, new subscriptions, failed payments). " +
                "Calculate velocity toward $100K/month target. " +
                "Identify the top conversion bottleneck and recommend one specific optimization. " +
                "Check all active funnels for statistical significance on any running A/B tests (min 100 visitors, 50 opens, 20 checkouts). " +
                "Report findings to the Architect. Keep it actionable — numbers, not narratives.",
              triggered_at: new Date().toISOString(),
              sweep_type: "daily",
            },
          });
        } catch (err: any) {
          console.error(`[AutoOps] Vector sweep dispatch failed: ${err.message}`);
        }
      }
    },
  });

  // Alfred — Daily Trend Scan & Content Brief (8 AM)
  scheduler.add({
    name: "Alfred Daily Trend Scan",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      const hour = new Date().getHours();
      const dateKey = new Date().toDateString();
      if (hour === 8 && autonomousFiredDates.alfredScan !== dateKey) {
        autonomousFiredDates.alfredScan = dateKey;
        console.log(`🔍 [AutoOps] Alfred daily trend scan firing for ${dateKey}`);
        try {
          await dispatchTask({
            from_agent: "system",
            to_agent: "alfred",
            task_type: "daily_trend_scan",
            priority: 1,
            chat_id: defaultChatId,
            payload: {
              directive: "DAILY TREND SCAN & CONTENT BRIEF — Execute your Content Director protocol. " +
                "Scan trending topics across your 5 niches (dark psychology, self-improvement, burnout recovery, quantum consciousness, sovereign systems). " +
                "Score each opportunity by relevance to Sovereign Synthesis brand (1-10) and viral potential (1-10). " +
                "Generate today's content brief: top 3 content opportunities with suggested hooks, formats (short-form, long-form, carousel), and target platforms. " +
                "Dispatch the top hook to Yuki for distribution optimization. " +
                "Report the full brief to the Architect.",
              triggered_at: new Date().toISOString(),
              scan_type: "daily",
            },
          });
        } catch (err: any) {
          console.error(`[AutoOps] Alfred trend scan dispatch failed: ${err.message}`);
        }
      }
    },
  });

  // Veritas — Weekly Strategic Directive (Monday 9 AM)
  scheduler.add({
    name: "Veritas Weekly Directive",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      const now = new Date();
      const dateKey = now.toDateString();
      if (now.getDay() === 1 && now.getHours() === 9 && autonomousFiredDates.veritasDirective !== dateKey) {
        autonomousFiredDates.veritasDirective = dateKey;
        console.log(`🎯 [AutoOps] Veritas weekly strategic directive firing for ${dateKey}`);
        try {
          await dispatchTask({
            from_agent: "system",
            to_agent: "veritas",
            task_type: "weekly_strategic_directive",
            priority: 1,
            chat_id: defaultChatId,
            payload: {
              directive: "WEEKLY STRATEGIC DIRECTIVE — Execute your Chief Strategy Officer protocol. " +
                "Review the past 7 days of crew activity, revenue movement, and content performance. " +
                "Assess mission velocity toward $1.2M liquid by Jan 2027 and 100K minds liberated. " +
                "Evaluate each crew member's output quality and identify any drift from brand standards. " +
                "Issue this week's strategic priority — one clear directive the entire crew should orient around. " +
                "Flag any risks, bottlenecks, or resource gaps that need the Architect's attention. " +
                "Deliver as a concise executive briefing.",
              triggered_at: new Date().toISOString(),
              directive_type: "weekly",
            },
          });
        } catch (err: any) {
          console.error(`[AutoOps] Veritas directive dispatch failed: ${err.message}`);
        }
      }
    },
  });

  console.log("⚡ [AutoOps] Scheduled: Vector daily sweep (10AM), Alfred trend scan (8AM), Veritas weekly directive (Mon 9AM)");

  // ── Deterministic Content Engine — Daily Production + Distribution ──
  // Master ref Section 23. Posting guide: SOVEREIGN-POSTING-GUIDE.md
  // LLM writes content, code handles the spray. No LLM decision-making in distribution.

  const contentEngineFiredDate = { production: "" };

  // Pre-warm channel cache at boot
  discoverChannels().catch((err: any) =>
    console.warn(`[ContentEngine] Boot channel discovery failed (will retry): ${err.message}`)
  );

  // Daily Content Production (6:30 AM ET = 11:30 UTC — before first posting slot at 7AM ET)
  scheduler.add({
    name: "Content Engine — Daily Production",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      const dateKey = now.toDateString();

      // Fire at 11:30 UTC (6:30 AM ET) — gives 30min buffer before first slot at noon UTC
      if (hour === 11 && minute >= 28 && minute <= 32 && contentEngineFiredDate.production !== dateKey) {
        contentEngineFiredDate.production = dateKey;
        console.log(`🚀 [ContentEngine] Daily production firing for ${dateKey}`);
        try {
          const count = await dailyContentProduction(failoverLLM);
          console.log(`✅ [ContentEngine] Produced ${count} content pieces for today`);

          // Notify Architect via Telegram
          if (defaultChatId && telegram) {
            const status = await contentEngineStatus();
            await telegram.sendMessage(defaultChatId, `🚀 *Content Engine — Daily Production Complete*\n\n${status}`, { parseMode: "Markdown" });
          }
        } catch (err: any) {
          console.error(`[ContentEngine] Daily production failed: ${err.message}`);
        }
      }
    },
  });

  // Distribution Sweep (every 5 minutes — checks for ready content whose time has arrived)
  scheduler.add({
    name: "Content Engine — Distribution Sweep",
    intervalMs: 300_000, // 5 minutes
    nextRun: new Date(Date.now() + 60_000), // Start 1 min after boot
    enabled: true,
    handler: async () => {
      try {
        const posted = await distributionSweep();
        if (posted > 0) {
          console.log(`📤 [ContentEngine] Distribution sweep posted ${posted} piece(s)`);
        }
      } catch (err: any) {
        console.error(`[ContentEngine] Distribution sweep failed: ${err.message}`);
      }
    },
  });

  console.log("⚡ [ContentEngine] Scheduled: Daily production (6:30AM ET), Distribution sweep (every 5min)");

  // ── Stasis Detection — Daily Agent Self-Check (2 PM) ──
  const stasisFiredDate = { value: "" };
  const stasisAgents = ["vector", "yuki", "alfred", "anita", "sapphire", "veritas"];

  scheduler.add({
    name: "Daily Stasis Detection Sweep",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      const now = new Date();
      const hour = now.getHours();
      const dateKey = now.toDateString();
      if (hour === 14 && stasisFiredDate.value !== dateKey) {
        stasisFiredDate.value = dateKey;
        console.log(`🔍 [StasisCheck] Dispatching daily stasis self-check to all agents for ${dateKey}`);
        for (const agent of stasisAgents) {
          try {
            await dispatchTask({
              from_agent: "system",
              to_agent: agent,
              task_type: "stasis_self_check",
              priority: 2,
              chat_id: defaultChatId,
              payload: {
                directive:
                  "STASIS SELF-CHECK — Review your Stasis Detection Protocol. " +
                  "Evaluate: (1) Have you received tasks in the last 48 hours? " +
                  "(2) Are any KPIs in your domain declining or flatlined? " +
                  "(3) Are expected pipeline outputs arriving on schedule? " +
                  "(4) Do you see a strategic opportunity or threat requiring Ace's decision? " +
                  "(5) Are you blocked on output from another crew member? " +
                  "If ANY trigger condition is met, send a proactive message to Ace with the data, your diagnosis, and a clear action request. " +
                  "If all systems nominal, log 'nominal' and take no action.",
                triggered_at: new Date().toISOString(),
                check_type: "daily_stasis",
              },
            });
          } catch (err: any) {
            console.error(`[StasisCheck] ${agent} dispatch failed: ${err.message}`);
          }
        }
      }
    },
  });

  console.log("🔍 [StasisCheck] Scheduled: Daily stasis detection sweep (2PM) for all 6 agents");

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

  // ── Sapphire Sentinel — proactive observations every 2 hours ──
  const sapphireSentinel = new SapphireSentinel(failoverLLM, telegram, defaultChatId);
  sapphireSentinel.start();

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

  // ── /api/release — Agent payloads ingest (Make.com, external tools) ──
  webhookServer.register("/api/release", async (incoming: any) => {
    const { agent_name, payload_type, payload, data } = incoming as any;
    if (!agent_name) return "error: agent_name required";

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return "error: supabase not configured";

    try {
      const resp = await fetch(`${supabaseUrl}/rest/v1/agent_payloads`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          agent_name,
          payload_type: payload_type || "release",
          payload: payload || data || incoming,
          status: "received",
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return `error: supabase ${resp.status} — ${errText.slice(0, 200)}`;
      }

      const rows = (await resp.json()) as any[];
      const id = rows?.[0]?.id;
      console.log(`📡 [Release] ${agent_name} payload stored (id: ${id})`);

      // Notify via Telegram
      await telegram.sendMessage(
        defaultChatId,
        `📦 _Agent payload received_\nAgent: *${agent_name}*\nType: ${payload_type || "release"}\nID: \`${id}\``,
        { parseMode: "Markdown" }
      );

      return id ? `stored:${id}` : "stored";
    } catch (err: any) {
      return `error: ${err.message}`;
    }
  });

  // ── /api/vidrush — Make.com Scenario E/F callback endpoint ──
  // Scenario E sends back transcript → dispatches to Alfred
  // Scenario E sends transcript → Alfred | Scenario F sends timestamps → Yuki (sovereign clip pipeline)
  webhookServer.register("/api/vidrush", async (incoming: any) => {
    const { scenario, video_id, youtube_url, transcript, timestamps, clips, chat_id } = incoming as any;

    if (scenario === "E" || incoming.transcript) {
      // Transcript callback from DumplingAI → dispatch to Alfred for analysis
      const id = await dispatchTask({
        from_agent: "make_scenario_e",
        to_agent: "alfred",
        task_type: "transcript_analysis",
        payload: {
          transcript: transcript || incoming.data?.transcript,
          video_id,
          youtube_url,
          source: "dumplingai",
        },
        priority: 2,
        chat_id: chat_id || defaultChatId,
      });

      console.log(`📡 [VidRush] Scenario E callback → Alfred dispatch (id: ${id})`);
      await telegram.sendMessage(
        chat_id || defaultChatId,
        `📜 _Transcript received for_ \`${video_id || "unknown"}\`\n_Dispatched to Alfred for analysis._`,
        { parseMode: "Markdown" }
      );

      return id ? `dispatched:alfred:${id}` : "dispatch_failed";
    }

    if (scenario === "F" || incoming.timestamps || incoming.clips) {
      // Sovereign clip pipeline — dispatch to Yuki with timestamps for in-house clip generation
      const id = await dispatchTask({
        from_agent: "make_scenario_f",
        to_agent: "yuki",
        task_type: "sovereign_clip_generation",
        payload: {
          timestamps: timestamps || clips || incoming.data?.timestamps,
          video_id,
          youtube_url,
          source: "sovereign_pipeline",
          pipeline: "yt-dlp + ffmpeg + whisper",
        },
        priority: 2,
        chat_id: chat_id || defaultChatId,
      });

      console.log(`📡 [VidRush] Scenario F callback → Yuki sovereign clip dispatch (id: ${id})`);
      await telegram.sendMessage(
        chat_id || defaultChatId,
        `🎬 _Sovereign clip pipeline triggered for_ \`${video_id || "unknown"}\`\n_Dispatched to Yuki — yt-dlp + ffmpeg in-house._`,
        { parseMode: "Markdown" }
      );

      return id ? `dispatched:yuki:${id}` : "dispatch_failed";
    }

    return "error: unknown scenario — send {scenario: 'E'} or {scenario: 'F'}";
  });

  // ── /api/content-engine/produce — Manual trigger for daily content production ──
  // Bypasses the cron time window. Use to fire production on demand.
  webhookServer.register("/api/content-engine/produce", async (incoming: any) => {
    const dateKey = new Date().toDateString();
    const force = incoming?.force === true;

    // Allow force override of the daily guard
    if (!force && contentEngineFiredDate.production === dateKey) {
      return JSON.stringify({ status: "already_fired", date: dateKey, message: "Production already ran today. Send {force: true} to override." });
    }

    try {
      console.log(`🚀 [ContentEngine] MANUAL production trigger for ${dateKey} (force=${force})`);
      contentEngineFiredDate.production = dateKey;
      const count = await dailyContentProduction(failoverLLM);
      console.log(`✅ [ContentEngine] Manual production complete: ${count} pieces`);

      // Notify Architect
      if (defaultChatId && telegram) {
        const ceStatus = await contentEngineStatus();
        await telegram.sendMessage(defaultChatId, `🚀 *Content Engine — Manual Production Triggered*\n\n${ceStatus}`, { parseMode: "Markdown" });
      }

      return JSON.stringify({ status: "ok", produced: count, date: dateKey });
    } catch (err: any) {
      console.error(`[ContentEngine] Manual production failed: ${err.message}`);
      return JSON.stringify({ status: "error", message: err.message });
    }
  });

  // ── /api/content-engine/diag — Test image generation APIs ──
  webhookServer.register("/api/content-engine/diag", async () => {
    const diag: Record<string, unknown> = {};
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    diag.gemini_key_set = !!geminiKey;
    diag.gemini_key_length = geminiKey?.length || 0;
    diag.openai_key_set = !!openaiKey;
    diag.openai_key_length = openaiKey?.length || 0;

    // Test Gemini Imagen
    if (geminiKey) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${geminiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instances: [{ prompt: "A simple blue sphere on a white background" }],
            parameters: { sampleCount: 1, aspectRatio: "1:1", safetyFilterLevel: "block_only_high" },
          }),
        });
        diag.gemini_imagen_status = res.status;
        if (!res.ok) {
          diag.gemini_imagen_error = (await res.text()).slice(0, 500);
        } else {
          const data = (await res.json()) as any;
          const b64 = data.predictions?.[0]?.bytesBase64Encoded || data.predictions?.[0]?.image?.bytesBase64Encoded;
          diag.gemini_imagen_has_image = !!b64;
          diag.gemini_imagen_bytes = b64 ? b64.length : 0;
        }
      } catch (err: any) {
        diag.gemini_imagen_error = err.message;
      }
    }

    // Test DALL-E 3
    if (openaiKey) {
      try {
        const res = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: "dall-e-3", prompt: "A simple blue sphere on a white background", size: "1024x1024", quality: "standard", n: 1, response_format: "b64_json" }),
        });
        diag.dalle_status = res.status;
        if (!res.ok) {
          diag.dalle_error = (await res.text()).slice(0, 500);
        } else {
          const data = (await res.json()) as any;
          diag.dalle_has_image = !!data.data?.[0]?.b64_json;
        }
      } catch (err: any) {
        diag.dalle_error = err.message;
      }
    }

    return JSON.stringify(diag);
  });

  // ── /api/content-engine/status — Check content engine queue status ──
  webhookServer.register("/api/content-engine/status", async () => {
    try {
      const ceStatus = await contentEngineStatus();
      return JSON.stringify({ status: "ok", report: ceStatus });
    } catch (err: any) {
      return JSON.stringify({ status: "error", message: err.message });
    }
  });

  // ── /api/content-engine/sweep — Manual distribution sweep trigger ──
  webhookServer.register("/api/content-engine/sweep", async () => {
    try {
      const posted = await distributionSweep();
      return JSON.stringify({ status: "ok", posted });
    } catch (err: any) {
      return JSON.stringify({ status: "error", message: err.message, stack: err.stack?.slice(0, 500) });
    }
  });

  // ── /api/content-engine/nuke-queue — Delete ALL queued Buffer posts + clear Supabase queue ──
  webhookServer.register("/api/content-engine/nuke-queue", async () => {
    try {
      const report = await nukeBufferQueue();

      // Notify Architect via Telegram
      if (defaultChatId && telegram) {
        await telegram.sendMessage(defaultChatId, `🧹 *Buffer Queue Nuked — Clean Slate*\n\n${report.slice(0, 3000)}`, { parseMode: "Markdown" });
      }

      return JSON.stringify({ status: "ok", report });
    } catch (err: any) {
      return JSON.stringify({ status: "error", message: err.message });
    }
  });

  // ── /api/faceless/produce — Manual trigger for faceless video production ──
  // POST body: { source_intelligence: string, niche?: string, brands?: string[] }
  // Or: { youtube_url: string } — will fetch transcript from cache if available
  webhookServer.register("/api/faceless/produce", async (incoming: any) => {
    try {
      const { source_intelligence, youtube_url, niche, brands } = incoming as any;

      let sourceIntel = source_intelligence || "";
      let detectedNiche = niche || "dark_psychology";

      // If YouTube URL provided, try to read cached Whisper transcript
      if (youtube_url && !sourceIntel) {
        const vidMatch = String(youtube_url).match(/(?:v=|youtu\.be\/)([\w-]{11})/);
        if (vidMatch) {
          const whisperPath = `/tmp/sovereign_clips/whisper_${vidMatch[1]}.json`;
          if (existsSync(whisperPath)) {
            const whisperData = JSON.parse(readFileSync(whisperPath, "utf-8"));
            sourceIntel = (whisperData.segments || []).map((s: any) => s.text).join(" ");
          }
        }
      }

      if (!sourceIntel) {
        return JSON.stringify({ status: "error", message: "No source_intelligence or cached transcript found" });
      }

      const brandList = brands || ["ace_richie", "containment_field"];
      console.log(`📡 [FacelessFactory] Manual trigger — niche: ${detectedNiche}, brands: ${brandList.join(", ")}`);

      const results = await produceFacelessBatch(failoverLLM, sourceIntel.slice(0, 3000), detectedNiche, brandList);

      return JSON.stringify({
        status: "ok",
        videos_produced: results.length,
        results: results.map(r => ({
          brand: r.brand,
          title: r.title,
          duration: r.duration,
          segments: r.segmentCount,
          video_url: r.videoUrl,
        })),
      });
    } catch (err: any) {
      console.error(`[FacelessFactory] Manual trigger error: ${err.message}`);
      return JSON.stringify({ status: "error", message: err.message?.slice(0, 500) });
    }
  });

  // ── /api/vid-rush/sweep — Distribute ready clips from vid_rush_queue to video platforms ──
  // Reads clips with status = "ready" and video_url populated → publishes via VideoPublisherTool
  // to YouTube Shorts, TikTok, and Instagram Reels (bypasses Buffer entirely)
  webhookServer.register("/api/vid-rush/sweep", async (incoming: any) => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return JSON.stringify({ status: "error", message: "Supabase not configured" });
    }

    try {
      // Fetch ready clips
      const queueResp = await fetch(
        `${supabaseUrl}/rest/v1/vid_rush_queue?status=eq.ready&video_url=not.is.null&order=created_at.asc&limit=20`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        }
      );

      if (!queueResp.ok) {
        const err = await queueResp.text();
        return JSON.stringify({ status: "error", message: `Queue fetch failed: ${err.slice(0, 300)}` });
      }

      const clips = (await queueResp.json()) as any[];

      if (clips.length === 0) {
        return JSON.stringify({ status: "ok", published: 0, message: "No ready clips in vid_rush_queue" });
      }

      console.log(`🎬 [VidRush Sweep] Found ${clips.length} ready clips. Publishing...`);

      const videoPublisher = new VideoPublisherTool();
      const results: Array<{ id: string; title: string; status: string; detail: string }> = [];

      for (const clip of clips) {
        // Determine brand from metadata or default to ace_richie
        const brand = clip.metadata?.brand || "ace_richie";
        const niche = clip.niche || clip.topic || "dark_psychology";
        const caption = clip.script || clip.title || `Sovereign Synthesis — ${niche}`;
        const title = clip.title || `${caption.slice(0, 80)} #Shorts`;

        // Mark as publishing
        await fetch(`${supabaseUrl}/rest/v1/vid_rush_queue?id=eq.${clip.id}`, {
          method: "PATCH",
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ status: "publishing" }),
        });

        try {
          const publishResult = await videoPublisher.execute({
            video_url: clip.video_url,
            platforms: "all",
            caption,
            title,
            tags: `${niche},sovereign synthesis,dark psychology,mindset,protocol 77`,
            niche,
            brand,
          });

          const succeeded = publishResult.includes("✅");
          const newStatus = succeeded ? "published" : "publish_failed";

          // Update status + store results
          await fetch(`${supabaseUrl}/rest/v1/vid_rush_queue?id=eq.${clip.id}`, {
            method: "PATCH",
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              status: newStatus,
              scheduled_at: new Date().toISOString(),
              metadata: {
                ...clip.metadata,
                publish_result: publishResult.slice(0, 2000),
                published_at: new Date().toISOString(),
              },
            }),
          });

          results.push({ id: clip.id, title: clip.title || "untitled", status: newStatus, detail: publishResult.slice(0, 200) });
          console.log(`✅ [VidRush Sweep] Clip ${clip.id} → ${newStatus}`);
        } catch (err: any) {
          // Mark failed
          await fetch(`${supabaseUrl}/rest/v1/vid_rush_queue?id=eq.${clip.id}`, {
            method: "PATCH",
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({ status: "publish_failed", metadata: { ...clip.metadata, error: err.message } }),
          });
          results.push({ id: clip.id, title: clip.title || "untitled", status: "error", detail: err.message });
          console.error(`❌ [VidRush Sweep] Clip ${clip.id} failed: ${err.message}`);
        }
      }

      const successCount = results.filter(r => r.status === "published").length;

      // Notify Architect
      if (defaultChatId && telegram) {
        await telegram.sendMessage(
          defaultChatId,
          `🎬 *VidRush Sweep Complete*\n\n` +
          `Published: ${successCount}/${clips.length}\n` +
          results.map(r => `${r.status === "published" ? "✅" : "❌"} ${r.title?.slice(0, 40)}`).join("\n"),
          { parseMode: "Markdown" }
        );
      }

      return JSON.stringify({ status: "ok", published: successCount, total: clips.length, results });
    } catch (err: any) {
      return JSON.stringify({ status: "error", message: err.message, stack: err.stack?.slice(0, 500) });
    }
  });

  // ── /api/vid-rush/status — Check vid_rush_queue state ──
  webhookServer.register("/api/vid-rush/status", async () => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return JSON.stringify({ status: "error", message: "Supabase not configured" });
    }

    try {
      const resp = await fetch(
        `${supabaseUrl}/rest/v1/vid_rush_queue?select=status&order=created_at.desc&limit=100`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      const rows = (await resp.json()) as any[];
      const counts: Record<string, number> = {};
      for (const row of rows) {
        counts[row.status] = (counts[row.status] || 0) + 1;
      }

      // Check which video platform tokens are configured
      const platforms = {
        youtube: !!(process.env.YOUTUBE_REFRESH_TOKEN || process.env.YOUTUBE_ACCESS_TOKEN),
        youtube_tcf: !!process.env.YOUTUBE_REFRESH_TOKEN_TCF,
        tiktok: !!process.env.TIKTOK_ACCESS_TOKEN,
        tiktok_browser: process.env.BROWSER_ENABLED === "true",
        instagram: !!(process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_BUSINESS_ID),
        instagram_browser: process.env.BROWSER_ENABLED === "true",
        groq_whisper: !!process.env.GROQ_API_KEY,
        openai_whisper: !!process.env.OPENAI_API_KEY,
        browser_enabled: process.env.BROWSER_ENABLED === "true",
      };

      return JSON.stringify({ status: "ok", queue: counts, total: rows.length, platforms });
    } catch (err: any) {
      return JSON.stringify({ status: "error", message: err.message });
    }
  });

  // ── /api/browser/tiktok-login — One-time TikTok manual login flow ──
  // Launches Chromium, navigates to TikTok login, waits 120s for manual auth, saves cookies.
  webhookServer.register("/api/browser/tiktok-login", async () => {
    return await tiktokLoginFlow();
  });

  // ── /api/browser/instagram-login — One-time Instagram manual login flow ──
  webhookServer.register("/api/browser/instagram-login", async () => {
    return await instagramLoginFlow();
  });

  // ── /api/browser/import-cookies — Import cookies from external browser ──
  // Accepts: { domain: "tiktok" | "instagram", account?: "acerichie" | "tcf", cookies: Cookie[] }
  // Multi-account: pass "account" to store cookies per-brand. Defaults to "acerichie".
  webhookServer.register("/api/browser/import-cookies", async (incoming: any) => {
    const { domain, cookies, account: rawAccount } = incoming as { domain?: string; cookies?: any[]; account?: string };

    // ── Validate domain ──
    if (!domain || typeof domain !== "string") {
      return JSON.stringify({ status: "error", message: "Missing or invalid 'domain'. Expected 'tiktok' or 'instagram'." });
    }
    const allowedDomains = ["tiktok", "instagram", "youtube", "twitter", "threads"];
    const normalizedDomain = domain.toLowerCase().trim();
    if (!allowedDomains.includes(normalizedDomain)) {
      return JSON.stringify({ status: "error", message: `Invalid domain '${domain}'. Allowed: ${allowedDomains.join(", ")}` });
    }

    // ── Account (multi-brand support) ──
    const allowedAccounts = ["acerichie", "tcf"];
    const account = rawAccount ? rawAccount.toLowerCase().trim() : "acerichie";
    if (!allowedAccounts.includes(account)) {
      return JSON.stringify({ status: "error", message: `Invalid account '${rawAccount}'. Allowed: ${allowedAccounts.join(", ")}` });
    }

    // ── Validate cookies array ──
    if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
      return JSON.stringify({ status: "error", message: "Missing or empty 'cookies' array." });
    }

    // Validate each cookie has at minimum: name, value, domain
    const invalidCookies = cookies.filter((c, i) => {
      if (!c || typeof c !== "object") return true;
      if (!c.name || typeof c.name !== "string") return true;
      if (c.value === undefined || c.value === null) return true;
      return false;
    });
    if (invalidCookies.length > 0) {
      return JSON.stringify({
        status: "error",
        message: `${invalidCookies.length} cookies are invalid. Each cookie must have at least 'name' (string) and 'value'.`,
      });
    }

    // ── Normalize cookies to Puppeteer-compatible format ──
    // EditThisCookie / DevTools exports may use different field names.
    // We cast to any[] for saveCookies since imported cookies won't have all
    // Puppeteer Cookie fields (size, session) — Puppeteer tolerates this when
    // cookies are set via page.setCookie() which is how they're consumed.
    const normalized: any[] = cookies.map((c: any) => ({
      name: String(c.name),
      value: String(c.value ?? ""),
      domain: c.domain || `.${normalizedDomain}.com`,
      path: c.path || "/",
      expires: typeof c.expires === "number" ? c.expires
             : typeof c.expirationDate === "number" ? c.expirationDate
             : -1,
      httpOnly: Boolean(c.httpOnly ?? false),
      secure: Boolean(c.secure ?? true),
      sameSite: c.sameSite || "Lax",
    }));

    // ── Save to disk ──
    try {
      saveCookies(normalizedDomain, normalized as any, account);

      // Verify the save by loading back
      const verification = loadCookies(normalizedDomain, account);
      const savedCount = verification ? verification.length : 0;

      console.log(`🍪 [Cookie Import] Saved ${savedCount} cookies for ${normalizedDomain}/${account}`);

      // Notify Architect via Telegram
      const ARCHITECT_CHAT_ID = config.telegram.authorizedUserIds[0];
      if (ARCHITECT_CHAT_ID) {
        try {
          const botToken = config.telegram.botToken;
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: ARCHITECT_CHAT_ID,
              text: `🍪 **Cookie Import Successful**\n\nDomain: \`${normalizedDomain}\`\nAccount: \`${account}\`\nCookies saved: ${savedCount}\nBrowser uploads for ${normalizedDomain}/${account} are now armed.`,
              parse_mode: "Markdown",
            }),
          });
        } catch { /* Telegram notification is best-effort */ }
      }

      return JSON.stringify({
        status: "ok",
        domain: normalizedDomain,
        account,
        cookies_saved: savedCount,
        cookie_path: `${COOKIE_DIR}/${normalizedDomain}_${account}.json`,
        message: `${savedCount} cookies imported for ${normalizedDomain}/${account}. Browser uploads are now armed.`,
      });
    } catch (err: any) {
      return JSON.stringify({ status: "error", message: `Failed to save cookies: ${err.message}` });
    }
  });

  // ── /api/browser/cookie-status — Check which domains have cookies saved (multi-account) ──
  webhookServer.register("/api/browser/cookie-status", async () => {
    const domains = ["tiktok", "instagram", "youtube", "twitter", "threads"];
    const accounts = ["acerichie", "tcf"];
    const status: Record<string, Record<string, { has_cookies: boolean; cookie_count: number }>> = {};

    for (const d of domains) {
      status[d] = {};
      for (const acct of accounts) {
        const cookies = loadCookies(d, acct);
        status[d][acct] = {
          has_cookies: cookies !== null && cookies.length > 0,
          cookie_count: cookies ? cookies.length : 0,
        };
      }
    }

    return JSON.stringify({ status: "ok", domains: status });
  });

  // ── /api/glitch — Log errors/incidents from external systems ──
  webhookServer.register("/api/glitch", async (incoming: any) => {
    const { severity, description, agent_name, stack_trace } = incoming as any;
    if (!description) return "error: description required";

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return "error: supabase not configured";

    try {
      await fetch(`${supabaseUrl}/rest/v1/glitch_log`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          severity: severity || "medium",
          description,
          agent_name: agent_name || "external",
          stack_trace: stack_trace || null,
        }),
      });

      // Alert on high/critical severity
      if (severity === "high" || severity === "critical") {
        await telegram.sendMessage(
          defaultChatId,
          `🚨 *GLITCH DETECTED*\nSeverity: *${severity}*\nAgent: ${agent_name || "external"}\n${description.slice(0, 300)}`,
          { parseMode: "Markdown" }
        );
      }

      return "logged";
    } catch (err: any) {
      return `error: ${err.message}`;
    }
  });

  // ── /api/stripe-webhook — Stripe payment events → revenue_log + mission_metrics + activity_log ──
  // Product price-to-name mapping for Sovereign Synthesis tiers
  const STRIPE_PRODUCT_MAP: Record<number, string> = {
    77: "Protocol 77",
    177: "The Map",
    477: "Defense Protocol Phase 1",
    1497: "Defense Protocol Phase 2",
    3777: "Defense Protocol Phase 3",
    12000: "Inner Circle",
  };
  function resolveProductName(productId: string, amount: number): string {
    // First check if product_id already has a name from metadata
    if (productId && !["checkout", "invoice", "payment"].includes(productId)) return productId;
    // Fall back to amount-based lookup
    return STRIPE_PRODUCT_MAP[amount] || `$${amount} Purchase`;
  }

  webhookServer.register("/api/stripe-webhook", async (incoming: any, headers: any, rawBody?: string) => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return "error: supabase not configured";

    // ── Stripe signature verification ──
    const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
    if (WEBHOOK_SECRET && rawBody) {
      const crypto = await import("crypto");
      const sigHeader = headers["stripe-signature"] as string;
      if (!sigHeader) return "error: missing stripe-signature header";

      // Parse Stripe signature: t=timestamp,v1=hash
      const parts = sigHeader.split(",").reduce((acc: Record<string, string>, part: string) => {
        const [key, val] = part.split("=");
        acc[key] = val;
        return acc;
      }, {} as Record<string, string>);

      const timestamp = parts["t"];
      const expectedSig = parts["v1"];
      if (!timestamp || !expectedSig) return "error: malformed stripe-signature";

      // Verify: HMAC-SHA256(timestamp + "." + rawBody) == v1 signature
      const signedPayload = `${timestamp}.${rawBody}`;
      const computedSig = crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(signedPayload)
        .digest("hex");

      if (computedSig !== expectedSig) {
        console.error("[Stripe] Signature verification FAILED");
        return "error: signature_verification_failed";
      }

      // Reject events older than 5 minutes (replay protection)
      const eventAge = Math.floor(Date.now() / 1000) - parseInt(timestamp);
      if (eventAge > 300) {
        console.error(`[Stripe] Event too old: ${eventAge}s`);
        return "error: event_too_old";
      }
      console.log("[Stripe] ✅ Webhook signature verified");
    } else if (WEBHOOK_SECRET && !rawBody) {
      console.warn("[Stripe] STRIPE_WEBHOOK_SECRET set but rawBody unavailable — skipping verification");
    }

    // Stripe sends the event object directly as the payload
    const event = incoming as any;
    const eventType = event?.type;

    // Only process successful payment events
    const REVENUE_EVENTS = [
      "checkout.session.completed",
      "invoice.payment_succeeded",
      "payment_intent.succeeded",
    ];

    if (!REVENUE_EVENTS.includes(eventType)) {
      console.log(`[Stripe] Ignored event type: ${eventType}`);
      return `ignored:${eventType}`;
    }

    try {
      // Extract payment details based on event type
      let amount = 0;
      let productId = "";
      let customerEmail = "";
      let stripeId = "";
      const obj = event.data?.object || {};

      if (eventType === "checkout.session.completed") {
        amount = (obj.amount_total || 0) / 100; // Stripe sends cents
        customerEmail = obj.customer_email || obj.customer_details?.email || "";
        stripeId = obj.id || "";
        productId = obj.metadata?.product_id || obj.metadata?.product_name || "checkout";
      } else if (eventType === "invoice.payment_succeeded") {
        amount = (obj.amount_paid || 0) / 100;
        customerEmail = obj.customer_email || "";
        stripeId = obj.id || "";
        productId = obj.lines?.data?.[0]?.price?.product || "invoice";
      } else if (eventType === "payment_intent.succeeded") {
        amount = (obj.amount || 0) / 100;
        customerEmail = obj.receipt_email || "";
        stripeId = obj.id || "";
        productId = obj.metadata?.product_id || "payment";
      }

      if (amount <= 0) {
        console.log(`[Stripe] Zero-amount event, skipping: ${eventType}`);
        return "skipped:zero_amount";
      }

      // Resolve human-readable product name
      const productName = resolveProductName(productId, amount);

      // 1. Write to revenue_log
      const revResp = await fetch(`${supabaseUrl}/rest/v1/revenue_log`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          amount,
          source: "stripe",
          product_id: productName,
          customer_email: customerEmail,
          metadata: {
            stripe_event: eventType,
            stripe_id: stripeId,
            event_id: event.id,
            original_product_id: productId,
          },
        }),
      });

      if (!revResp.ok) {
        const errText = await revResp.text();
        console.error(`[Stripe] revenue_log write failed: ${errText}`);
        return `error:revenue_log:${errText}`;
      }

      // 2. Write to activity_log (feeds Mission Control activity feed)
      await fetch(`${supabaseUrl}/rest/v1/activity_log`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          event_type: "revenue",
          title: "Payment received",
          description: `$${amount.toFixed(2)} from ${productName}`,
          agent_name: "system",
          status: "completed",
          details: JSON.stringify({
            amount,
            product: productName,
            customer: customerEmail,
            stripe_event: eventType,
            stripe_id: stripeId,
          }),
        }),
      }).catch((err: any) => {
        console.error(`[Stripe] activity_log write failed: ${err.message}`);
      });

      // 3. Update mission_metrics.fiscal_sum (atomic increment)
      await fetch(`${supabaseUrl}/rest/v1/rpc/increment_fiscal_sum`, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount_to_add: amount }),
      }).catch((err: any) => {
        // If RPC doesn't exist yet, fall back to manual update
        console.warn(`[Stripe] increment_fiscal_sum RPC failed (creating fallback): ${err.message}`);
      });

      // 4. Log to agent_history (lights up "System" on Mission Control)
      logAgentActivity("system", `Payment: $${amount.toFixed(2)} — ${productName} from ${customerEmail || "anonymous"}`, {
        type: "stripe_payment",
        amount,
        product: productName,
      });

      // 5. Alert Architect via Telegram
      await telegram.sendMessage(
        defaultChatId,
        `💰 *REVENUE DETECTED*\n` +
        `Amount: *$${amount.toFixed(2)}*\n` +
        `Product: ${productName}\n` +
        `Customer: ${customerEmail || "N/A"}\n` +
        `Event: \`${eventType}\``,
        { parseMode: "Markdown" }
      );

      console.log(`💰 [Stripe] $${amount.toFixed(2)} — ${productName} from ${customerEmail} → revenue_log + activity_log ✅`);
      return `recorded:$${amount.toFixed(2)}:${productName}`;
    } catch (err: any) {
      console.error(`[Stripe] Webhook error: ${err.message}`);
      return `error:${err.message}`;
    }
  });

  // ── Chat Bridge webhook — Mission Control dashboard routes chat through REAL agent loops ──
  // POST /api/chat-bridge { agent_name, content, history? }
  // Returns the full agent response (personality, tools, memory, Pinecone — the whole pipeline)
  webhookServer.register("/api/chat-bridge", async (incoming: any) => {
    const { agent_name, content, history } = incoming as { agent_name: string; content: string; history?: Array<{ sender: string; content: string }> };
    if (!agent_name || !content) return "error: agent_name and content required";

    const agentKey = agent_name.toLowerCase();
    const agentEntry = agentLoops.get(agentKey);
    if (!agentEntry) return `error: agent "${agentKey}" not found — available: ${Array.from(agentLoops.keys()).join(", ")}`;

    console.log(`🌉 [ChatBridge] ${agentKey} ← "${content.slice(0, 80)}..."`);

    // Build a Message object that the AgentLoop understands
    const bridgeMessage: Message = {
      id: `bridge-${Date.now()}`,
      role: "user",
      content,
      timestamp: new Date(),
      channel: "dashboard",
      chatId: `dashboard-${agentKey}`,
      userId: String(config.telegram.authorizedUserIds[0] || "architect"),
      metadata: {
        chatType: "private",  // Treat dashboard as private chat (no group routing)
        source: "mission-control",
      },
    };

    try {
      const response = await agentEntry.loop.processMessage(bridgeMessage);
      console.log(`🌉 [ChatBridge] ${agentKey} → "${response.slice(0, 80)}..."`);
      return JSON.stringify({ agent: agentKey, response });
    } catch (err: any) {
      console.error(`🔥 [ChatBridge] ${agentKey} error:`, err.message);
      return `error: ${err.message}`;
    }
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

  // Register Veritas in the dispatch map so system-dispatched tasks reach the lead agent
  agentLoops.set("veritas", { loop: agentLoop, channel: telegram });

  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    const supabase = (await import("@supabase/supabase-js")).createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // ── PERSONALITY LOADER: Bundled JSON (zero network dependency) ──
    // PostgREST PGRST002 breaks ALL network paths (JS client, REST, cache).
    // Solution: Ship personalities as a local JSON file in the repo.
    // Supabase is optional — used to hot-update if PostgREST happens to work.
    type PersonalityMap = Record<string, { prompt_blueprint: string; agent_name: string }>;
    let personalityMap: PersonalityMap = {};

    // PRIMARY: Load from bundled JSON (shipped in repo — always works)
    const BUNDLED_PATH = join(__dirname, "data", "personalities.json");
    console.log(`🧠 [PersonalityLoader] Loading from bundled JSON...`);
    try {
      const bundled: Record<string, string> = JSON.parse(readFileSync(BUNDLED_PATH, "utf-8"));
      for (const [name, blueprint] of Object.entries(bundled)) {
        personalityMap[name] = { agent_name: name, prompt_blueprint: blueprint };
      }
      console.log(`✅ [PersonalityLoader] Loaded ${Object.keys(personalityMap).length} personalities from bundled JSON`);
    } catch (err: any) {
      console.error(`❌ [PersonalityLoader] Bundled JSON failed: ${err.message}`);
    }

    // OPTIONAL: Try Supabase for hot-updates (non-blocking, single attempt)
    if (Object.keys(personalityMap).length > 0) {
      try {
        const { data, error } = await supabase
          .from("personality_config")
          .select("prompt_blueprint, agent_name");
        if (!error && data && data.length > 0) {
          for (const row of data) {
            personalityMap[row.agent_name] = row;
          }
          console.log(`🔄 [PersonalityLoader] Hot-updated ${data.length} personalities from Supabase`);
        } else {
          console.log(`ℹ️ [PersonalityLoader] Supabase unavailable (${error?.code || "no data"}) — using bundled`);
        }
      } catch {
        console.log(`ℹ️ [PersonalityLoader] Supabase unreachable — using bundled`);
      }
    }

    const loadedCount = Object.keys(personalityMap).length;
    if (loadedCount === 0) {
      console.error(`❌ [PersonalityLoader] FATAL: Could not load ANY personalities. Agents will not start.`);
    } else {
      console.log(`🧠 [PersonalityLoader] ${loadedCount} personalities ready: ${Object.keys(personalityMap).join(", ")}`);
    }

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

        // Fetch personality from pre-loaded map (no PostgREST dependency)
        const personality = personalityMap[agentCfg.name] || null;

        if (!personality) {
          console.warn(`⚠️ [BotInit] No personality for ${agentCfg.name} — skipping`);
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

        // Protocol injection — content crew (Alfred, Yuki, Anita) must read protocols before content tasks
        const CONTENT_CREW = ["alfred", "yuki", "anita"];
        // Knowledge memory directive — all agents should use write_knowledge for significant outputs
        const knowledgeDirective = pineconeMemory.isReady()
          ? "\n\n[INSTITUTIONAL MEMORY] You have the write_knowledge tool. When you produce a strong hook, discover a conversion pattern, extract a key insight, or create content that performs well — call write_knowledge to store it permanently. Every agent can recall these later. Build the crew's collective intelligence."
          : "";

        const protocolDirective = CONTENT_CREW.includes(agentCfg.name)
          ? "\n\n[STANDING ORDER] Before executing any content task, call read_protocols with the detected niche. Apply every returned directive to your output. These are standing orders from the Architect."
          : agentCfg.name === "sapphire"
            ? "\n\n[STANDING ORDER] When you receive a message containing 'standing directive' or 'new protocol', extract the protocol name, niche, and directive. Use the write_protocol tool to save it. Confirm: 'Protocol [name] locked. All crew members will execute this on every [niche] task going forward.'\n\n[RELATIONSHIP AWARENESS] You have the write_relationship_context tool. When you notice patterns in how Ace works — what he asks for repeatedly, what frustrates him, what he celebrates — write a brief observation. Categories: preference, frustration, pattern, win. These observations help you calibrate your tone."
            : "";

        // Browser capability directives — per-agent use cases
        const BROWSER_DIRECTIVES: Record<string, string> = {
          alfred: "[BROWSER CAPABILITY] You have the `browser` tool for web research. USE IT ACTIVELY: navigate to URLs to pull source material, extract quotes from articles, verify external links, research topics for content creation. When given a URL or topic to research, open it in the browser rather than relying on web_search alone. You can navigate, extract text, take screenshots, and evaluate JavaScript on any page.",
          veritas: "[BROWSER CAPABILITY] You have the `browser` tool. USE IT ACTIVELY: fact-check claims by browsing source URLs directly, run competitive analysis by scraping competitor landing pages, verify that live sites/links are working. When verifying information, open the actual source URL in the browser and extract the relevant text. Screenshots can provide visual proof.",
          vector: "[BROWSER CAPABILITY] You have the `browser` tool. USE IT ACTIVELY: scrape analytics dashboards (Buffer, Stripe dashboard) when APIs are rate-limited, pull social metrics from platform pages, extract data from web-based tools. When metrics tools are unavailable, fall back to browser scraping of the dashboard pages.",
          anita: "[BROWSER CAPABILITY] You have the `browser` tool. USE IT ACTIVELY: research trending topics by browsing platform pages, scrape subreddits and forums for content inspiration, extract viral hook patterns from trending posts. When looking for content angles, browse actual platform pages (Reddit, Twitter/X, TikTok trending) to find what's working NOW.",
          yuki: "[BROWSER CAPABILITY — PRIMARY DISTRIBUTION] You have `tiktok_browser_upload` and `instagram_browser_upload` tools. These are your PRIMARY methods for posting to TikTok and Instagram (API access is blocked). When asked to publish video content to TikTok or IG, use these browser upload tools directly. You also have the base `browser` tool to verify posts went live by checking platform pages. After uploading, navigate to the profile page and confirm the post is visible.",
          sapphire: "[BROWSER CAPABILITY] You have the `browser` tool. USE IT ACTIVELY: gather strategic intelligence by browsing industry news sites, pull market data from public sources, research competitors and trends. When analyzing the competitive landscape or gathering market intelligence, open relevant pages in the browser and extract structured data.",
        };

        const browserDirective = config.tools.browserEnabled && BROWSER_DIRECTIVES[agentCfg.name]
          ? `\n\n${BROWSER_DIRECTIVES[agentCfg.name]}`
          : "";

        // Per-agent LLM team — each agent gets its own failover chain to prevent quota stampedes
        const agentTeamLLM = AGENT_LLM_TEAMS[agentCfg.name] || failoverLLM;
        const injectedLLM: LLMProvider = {
          ...agentTeamLLM,
          generate: (messages, options) =>
            agentTeamLLM.generate(messages, { ...options, systemPrompt: blueprint + protocolDirective + knowledgeDirective + browserDirective }),
        };

        // Build per-agent tool set: shared tools + agent-specific tools
        const agentTools: Tool[] = [...tools, new CrewDispatchTool(agentCfg.name)];

        // Protocol tools — content crew gets reader, Sapphire gets writer
        if (CONTENT_CREW.includes(agentCfg.name)) {
          agentTools.push(new ProtocolReaderTool());
        }
        if (agentCfg.name === "sapphire") {
          agentTools.push(new ProtocolWriterTool());
          agentTools.push(new RelationshipContextTool());
        }

        // Action Surface Layer — every agent gets visibility tools
        // These write to Supabase tables that Mission Control can display
        agentTools.push(new ProposeTaskTool(agentCfg.name));
        agentTools.push(new CheckApprovedTasksTool(agentCfg.name));

        // Content crew (Alfred, Yuki, Anita) + Vector (analytics logging) get the draft tool
        // Vector uses it to log metrics observations, NOT to post content
        if (CONTENT_CREW.includes(agentCfg.name) || agentCfg.name === "vector") {
          agentTools.push(new SaveContentDraftTool(agentCfg.name));
        }

        // Strategy/ops agents (Sapphire, Veritas, Vector) get the briefing tool
        const BRIEFING_AGENTS = ["sapphire", "vector", "veritas"];
        if (BRIEFING_AGENTS.includes(agentCfg.name)) {
          agentTools.push(new FileBriefingTool(agentCfg.name));
        }

        // Vector gets Stripe metrics for CRO sweeps
        if (agentCfg.name === "vector") {
          agentTools.push(new StripeMetricsTool());
        }

        // Pinecone KnowledgeWriter — agent-specific namespaces
        // Alfred: hooks | Yuki: clips | Anita: content | Vector: funnels | Sapphire: brand
        const AGENT_NAMESPACES: Record<string, string> = {
          alfred: "hooks",
          yuki: "clips",
          anita: "content",
          vector: "funnels",
          sapphire: "brand",
        };
        const agentNamespace = AGENT_NAMESPACES[agentCfg.name] || "general";
        if (pineconeMemory.isReady()) {
          agentTools.push(new KnowledgeWriterTool(pineconeMemory, agentCfg.name, agentNamespace));
        }

        // Initialize Agent Loop (Unique per bot)
        const agentBotLoop = new AgentLoop(injectedLLM, agentTools, memoryProviders);
        agentBotLoop.setLLMProviders(providersMap);

        // Wire Pinecone semantic memory + agent identity
        if (pineconeMemory.isReady()) {
          agentBotLoop.setPinecone(pineconeMemory);
          agentBotLoop.setIdentity({
            agentName: agentCfg.name,
            namespace: agentNamespace,
            defaultNiche: CONTENT_CREW.includes(agentCfg.name) ? undefined : "general",
          });
        }

        // Store loop + channel reference for dispatch polling
        agentLoops.set(agentCfg.name, { loop: agentBotLoop, channel: agentChannel });

        // Group management for agent bot — use REAL Telegram username from getMe()
        // Sapphire = "copilot" (responds to all Architect messages with plain English assessment after Veritas)
        // All other agents = "crew" (respond only on @mention, reply, broadcast, or /command)
        const realBotUsername = agentChannel.botUsername || `${agentCfg.name}_SovereignBot`;
        const agentGroupRole = agentCfg.name === "sapphire" ? "copilot" as const : "crew" as const;
        const agentGroupManager = new GroupManager(realBotUsername, config.telegram.authorizedUserIds, agentGroupRole);
        console.log(`[BotInit] ${agentCfg.name} GroupManager username: @${realBotUsername}, role: ${agentGroupRole}`);

        // Roll call stagger: Veritas = 0s, then crew bots stagger 4s each
        // botIndex is already 1-based from the loop, so delay = botIndex * 4000
        const rollCallDelay = botIndex * 4000;
        const agentDisplayName = agentCfg.name.charAt(0).toUpperCase() + agentCfg.name.slice(1);

        // Wire Handler (Isolated from MessageRouter)
        agentChannel.onMessage(async (message: Message) => {
          try {
            if (!agentGroupManager.shouldRespond(message)) return;

            // ── CoPilot delay — Sapphire waits for Veritas to respond first ──
            const coPilotDelay = agentGroupManager.respondDelay;
            if (coPilotDelay > 0 && message.metadata?.isGroup && !agentGroupManager.isBroadcastTrigger(message)) {
              await new Promise((resolve) => setTimeout(resolve, coPilotDelay));
            }

            // ── Roll Call / Check-In — full group-aware status response ──
            if (message.metadata?.isGroup && agentGroupManager.isBroadcastTrigger(message)) {
              await new Promise((resolve) => setTimeout(resolve, rollCallDelay));
              await agentChannel.sendTyping(message.chatId);
              const rollCallMsg: Message = {
                ...message,
                content: `[GROUP CHECK-IN] The Architect has called a check-in in the Maven Crew group chat. ` +
                  `You are ${agentDisplayName}. Give a brief but substantive status report in your voice. ` +
                  `Include: your operational status, what you're currently working on or tracking, and one insight or recommendation relevant to your role. ` +
                  `Keep it concise (3-5 sentences). Stay in character. No @mentions.`,
              };
              const response = await agentBotLoop.processMessage(rollCallMsg, () => agentChannel.sendTyping(message.chatId));
              await agentChannel.sendMessage(message.chatId, response, { parseMode: "Markdown" });
              return;
            }

            // Strip @mention first, then inject copilot context
            if (message.metadata?.isGroup) message.content = agentGroupManager.stripMention(message.content);

            // ── CoPilot context injection — Sapphire adds plain English summary ──
            if (agentGroupManager.role === "copilot" && message.metadata?.isGroup) {
              message.content = `[COPILOT MODE] The Architect just said: "${message.content}"\n\n` +
                `Veritas has already responded to this. Your role here is NOT to repeat what Veritas said. ` +
                `Give the Architect a brief, plain English assessment — 2-3 sentences max. ` +
                `Translate any technical or strategic language into clear, actionable understanding. ` +
                `If Veritas proposed an action, confirm whether it aligns with current priorities. ` +
                `If something needs the Architect's attention, flag it simply. Stay warm, stay sharp.`;
            }

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

            // ── CLIP RIPPER — ON-DEMAND ONLY ──
            // Fires ONLY when Ace explicitly says "clip this", "clip ripper", "rip clips", etc.
            // alongside a YouTube URL. Otherwise the Faceless Factory handles URLs by default.
            const CLIP_TRIGGER_RE = /\b(clip\s*this|clip\s*ripper|rip\s*clips?|cut\s*clips?|chop\s*this)\b/i;
            const YOUTUBE_URL_RE = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|live\/|shorts\/)|youtu\.be\/)([\w-]{11})/i;

            if (CLIP_TRIGGER_RE.test(message.content) && YOUTUBE_URL_RE.test(message.content)) {
              const match = message.content.match(YOUTUBE_URL_RE);
              const videoId = match?.[1];
              const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

              await agentChannel.sendMessage(message.chatId,
                `🔪 _Clip Ripper activated for \`${videoId}\`..._\n` +
                `_Downloading → Whisper → Scoring → Cutting clips → Supabase_`,
                { parseMode: "Markdown" }
              );

              const vidRushTool = new VidRushTool();
              vidRushTool.execute({
                youtube_url: youtubeUrl,
                target_clip_count: 5,
              }).then(async (result) => {
                console.log(`✅ [ClipRipper] Complete for ${youtubeUrl}`);
                try {
                  await agentChannel.sendMessage(message.chatId,
                    `🔪 *CLIP RIPPER — COMPLETE*\n\n${result.slice(0, 2000)}`,
                    { parseMode: "Markdown" }
                  );
                } catch {
                  await agentChannel.sendMessage(message.chatId,
                    `CLIP RIPPER — COMPLETE\n\n${result.slice(0, 2000)}`
                  );
                }
              }).catch(async (err) => {
                console.error(`❌ [ClipRipper] Failed: ${err.message}`);
                await agentChannel.sendMessage(message.chatId,
                  `❌ Clip Ripper failed: ${err.message?.slice(0, 500)}`
                );
              });

              message.content = `[CLIP RIPPER ACTIVATED] Cutting source video clips for: ${youtubeUrl}\n` +
                `The clip ripper is running in background. Original message: ${message.content}`;
            }

            // ── /dryrun <url> — VALIDATE PIPELINE WITHOUT BURNING CREDITS ──
            // Runs the full 8-step orchestrator with all expensive APIs stubbed.
            // Tests: file paths, data handoffs, type conversions, error handling, ffmpeg ops.
            // Zero cost: no TTS, no Imagen, no YouTube upload, no Buffer, no Supabase Storage.
            else if (/^\/dryrun\b/i.test(message.content) && YOUTUBE_URL_RE.test(message.content)) {
              const match = message.content.match(YOUTUBE_URL_RE);
              const videoId = match?.[1];
              const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

              await agentChannel.sendTyping(message.chatId);
              await agentChannel.sendMessage(message.chatId,
                `🧪 *DRY RUN — VID RUSH PIPELINE*\n` +
                `Video: \`${videoId}\`\n\n` +
                `Running full 8-step pipeline with ALL APIs stubbed.\n` +
                `This validates logic, file paths, and data flow at zero cost.\n` +
                `If this passes clean → live run should work.`,
                { parseMode: "Markdown" }
              );

              const brandMatch = message.content.match(/\b(containment[_ ]?field|tcf)\b/i);
              const brand = brandMatch ? "containment_field" as const : "ace_richie" as const;
              const pipelineLlm = injectedLLM;

              (async () => {
                try {
                  const result = await executeFullPipeline(
                    youtubeUrl,
                    pipelineLlm,
                    brand,
                    async (step: string, detail: string) => {
                      try {
                        await agentChannel.sendMessage(message.chatId,
                          `🧪 ${step}: ${detail}`,
                          { parseMode: "Markdown" }
                        );
                      } catch { /* non-critical progress update */ }
                    },
                    { dryRun: true }
                  );

                  const report = `🧪 *DRY RUN — COMPLETE*\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🎬 YouTube: ${result.youtubeUrl || "simulated"}\n` +
                    `✂️ Clips generated: ${result.clipCount}\n` +
                    `📅 Buffer scheduled: ${result.bufferScheduled} posts\n` +
                    `⏱️ Total time: ${result.duration.toFixed(0)}s\n` +
                    `${result.errors.length > 0 ? `\n⚠️ Issues:\n${result.errors.map(e => "  • " + e).join("\n")}` : "✅ Zero issues — pipeline logic is clean"}\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `_Ready for live run. Drop the URL without /dryrun._`;
                  try {
                    await agentChannel.sendMessage(message.chatId, report, { parseMode: "Markdown" });
                  } catch {
                    await agentChannel.sendMessage(message.chatId, report.replace(/[*_`]/g, ""));
                  }
                } catch (err: any) {
                  console.error(`❌ [DRY RUN] Pipeline failed: ${err.message}`);
                  await agentChannel.sendMessage(message.chatId,
                    `❌ DRY RUN FAILED at: ${err.message?.slice(0, 500)}\n\nThis would have failed in production too. Fix first.`
                  );
                }
              })();

              message.content = `[DRY RUN PIPELINE RUNNING] Validating pipeline logic for: ${youtubeUrl}\n` +
                `All APIs are stubbed. Testing data flow only. Original message: ${message.content}`;
            }

            // ── YOUTUBE URL → FULL AUTONOMOUS VID RUSH PIPELINE ──
            // 1 URL → Whisper → Faceless Factory LONG (Anita's voice) → YouTube upload →
            // Chop ~30 clips → Platform-specific copy → Distribute all platforms → Buffer week schedule
            // Ace's words: "1 url, fully autonomous ai driven system"
            else if (YOUTUBE_URL_RE.test(message.content)) {
              const match = message.content.match(YOUTUBE_URL_RE);
              const videoId = match?.[1];
              const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

              await agentChannel.sendTyping(message.chatId);

              await agentChannel.sendMessage(message.chatId,
                `🔥 *VID RUSH PIPELINE — ACTIVATED*\n` +
                `Video: \`${videoId}\`\n\n` +
                `8-step autonomous pipeline launching:\n` +
                `1️⃣ Whisper extraction\n` +
                `2️⃣ Faceless Factory LONG (Anita's Protocol 77 voice)\n` +
                `3️⃣ YouTube long-form upload\n` +
                `4️⃣ Chop into ~30 clips\n` +
                `5️⃣ Upload clips to storage\n` +
                `6️⃣ Platform-specific copy generation\n` +
                `7️⃣ Distribute to all platforms\n` +
                `8️⃣ Schedule a week in Buffer\n\n` +
                `_This will take several minutes. Sit back, Architect._`,
                { parseMode: "Markdown" }
              );

              // Determine brand from message content or default
              const brandMatch = message.content.match(/\b(containment[_ ]?field|tcf)\b/i);
              const brand = brandMatch ? "containment_field" as const : "ace_richie" as const;

              // Get LLM provider for the pipeline (injectedLLM is in scope from agent init)
              const pipelineLlm = injectedLLM;

              // Run full pipeline in background
              (async () => {
                try {
                  const result = await executeFullPipeline(
                    youtubeUrl,
                    pipelineLlm,
                    brand,
                    async (step: string, detail: string) => {
                      try {
                        await agentChannel.sendMessage(message.chatId,
                          `📡 ${step}: ${detail}`,
                          { parseMode: "Markdown" }
                        );
                      } catch { /* non-critical progress update */ }
                    }
                  );

                  const report = formatPipelineReport(result);
                  try {
                    await agentChannel.sendMessage(message.chatId, report, { parseMode: "Markdown" });
                  } catch {
                    await agentChannel.sendMessage(message.chatId, report.replace(/[*_`]/g, ""));
                  }
                } catch (err: any) {
                  console.error(`❌ [VidRush] Pipeline failed: ${err.message}`);
                  await agentChannel.sendMessage(message.chatId,
                    `❌ Vid Rush Pipeline FAILED at: ${err.message?.slice(0, 500)}`
                  );
                }
              })();

              // Let the agent acknowledge the pipeline is running
              message.content = `[VID RUSH PIPELINE RUNNING] The full autonomous pipeline is executing for: ${youtubeUrl}\n` +
                `It will: Whisper → create 10-15 min long-form video in Protocol 77 voice → upload to YouTube → ` +
                `chop into ~30 clips → distribute to all platforms → schedule a week in Buffer.\n` +
                `Acknowledge to the Architect that the pipeline is running and they'll get progress updates. ` +
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

            // Update task status + log to Mission Control
            if (agentTaskId) await updateTask(agentTaskId, "completed", response.slice(0, 500));
            logAgentActivity(agentCfg.name, response.slice(0, 500), {
              trigger: message.content.slice(0, 200),
              chat_id: message.chatId,
            });

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

    // ── Notification Router — sends to Telegram or logs for dashboard ──
    const isDashboardChat = (chatId: string) => chatId.startsWith("dashboard-");
    const notifyChat = async (chatId: string, text: string, channel: any) => {
      if (isDashboardChat(chatId)) {
        // Dashboard-originated dispatch — log to Supabase activity_log so dashboard can read it
        console.log(`📋 [Dashboard Notify] ${text.slice(0, 120)}`);
        try {
          await fetch(`${process.env.SUPABASE_URL}/rest/v1/activity_log`, {
            method: "POST",
            headers: {
              apikey: process.env.SUPABASE_ANON_KEY!,
              Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY!}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              agent: "system",
              type: "pipeline_notification",
              body: text,
            }),
          });
        } catch (logErr: any) {
          console.error(`[Dashboard Notify] Failed to log: ${logErr.message}`);
        }
      } else {
        // Real Telegram chat ID — send via bot
        await channel.sendMessage(chatId, text, { parseMode: "Markdown" });
      }
    };

    // ── Dispatch Poller — BATCHED: one query for all agents, with 503 backoff ──
    const DISPATCH_POLL_BASE_MS = 60_000; // 60s base (was 15s — killed Supabase free tier)
    const DISPATCH_POLL_MAX_MS = 300_000; // 5 min max backoff
    let dispatchPollMs = DISPATCH_POLL_BASE_MS;
    let dispatchPollTimer: ReturnType<typeof setTimeout> | null = null;

    if (agentLoops.size > 0) {
      const agentNames = [...agentLoops.keys()];
      console.log(`📡 [CrewDispatch] Starting batched dispatch poller for [${agentNames.join(", ")}] (base: ${DISPATCH_POLL_BASE_MS / 1000}s)`);

      const runDispatchPoll = async () => {
        try {
          // ONE query for ALL agents instead of 6 separate queries
          const tasksByAgent = await claimAllPending(agentNames, 1);

          // Reset backoff on success
          if (dispatchPollMs > DISPATCH_POLL_BASE_MS) {
            console.log(`✅ [DispatchPoller] Supabase recovered — resetting poll to ${DISPATCH_POLL_BASE_MS / 1000}s`);
            dispatchPollMs = DISPATCH_POLL_BASE_MS;
          }

          let agentIndex = 0;
          for (const [agentName, { loop: agentLoop, channel }] of agentLoops) {
            try {
            const tasks = tasksByAgent.get(agentName) || [];
            if (tasks.length === 0) continue;

            // Stagger agent processing with generous gaps to conserve LLM quota.
            if (agentIndex > 0) {
              await new Promise((resolve) => setTimeout(resolve, 10_000));
            }
            agentIndex++;

            for (const task of tasks) {
              console.log(`🔄 [DispatchPoller] ${agentName} processing dispatch ${task.id} (type: ${task.task_type})`);
              // 3s breather between consecutive tasks for the same agent
              if (tasks.indexOf(task) > 0) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
              }

              // Build a synthetic message from the dispatch payload
              const payloadStr = JSON.stringify(task.payload, null, 2);

              // ── Task-type-specific execution directives ──
              // Without these, agents default to analysis/reporting instead of executing tools.
              // These ensure the pipeline's final stages actually POST content to platforms.
              const EXECUTION_DIRECTIVES: Record<string, string> = {
                content_for_distribution: `EXECUTION ORDER: You (Yuki) are the SOLE distribution authority. You MUST use the social_scheduler_create_post tool to post this content to Buffer channels. ` +
                  `Step 1: Call social_scheduler_list_profiles to get channel IDs. ` +
                  `Step 2: Take the content from the payload and call social_scheduler_create_post with appropriate channel_ids and the text. ` +
                  `Post to ALL relevant channels (both Ace Richie and Containment Field accounts). ` +
                  `Respect IG frequency override: Ace IG max 3/day (7AM/1PM/7PM), CF IG max 2/day (10AM/4PM). ` +
                  `If the payload contains video content, use publish_video instead. ` +
                  `Step 3: After posting, call save_content_draft to log what you posted. ` +
                  `Do NOT just analyze or report — actually POST the content.`,
                content_scheduling: `EXECUTION ORDER: You (Yuki) MUST schedule this content for posting. ` +
                  `Step 1: Call social_scheduler_list_profiles to get available Buffer channel IDs. ` +
                  `Step 2: Use social_scheduler_create_post to queue the content on appropriate channels. ` +
                  `If the payload includes video/clip metadata, use publish_video for video platforms (YouTube, TikTok, Instagram). ` +
                  `Do NOT just file a briefing or analyze metrics — actually SCHEDULE the content using the posting tools.`,
                caption_weaponization: `EXECUTION ORDER: Write platform-ready captions from the content provided. ` +
                  `Create at least 3 variations optimized for different platforms (X/Twitter, Instagram, Threads). ` +
                  `Each caption must include hooks, hashtags, and a CTA. ` +
                  `Save ALL captions via save_content_draft so they're visible in Mission Control.`,
                narrative_weaponization: `EXECUTION ORDER: Transform this content into publishable copy. ` +
                  `Create platform-ready posts, email copy, or thread scripts from the source material. ` +
                  `Save ALL outputs via save_content_draft with the correct platform and draft_type tags.`,
                viral_clip_extraction: `EXECUTION ORDER: Identify the strongest hooks and viral moments from this content. ` +
                  `Extract timestamped hooks with suggested clip boundaries. ` +
                  `If a video URL is present, use clip_generator to extract clips. ` +
                  `Save your hook analysis via save_content_draft.`,
              };

              const executionDirective = EXECUTION_DIRECTIVES[task.task_type] ||
                `Process this task according to your role.`;

              const dispatchMessage: Message = {
                id: `dispatch-${task.id}`,
                role: "user",
                content: `[DISPATCHED TASK from ${task.from_agent}]\nType: ${task.task_type}\nDispatch ID: ${task.id}\n\nPayload:\n${payloadStr}\n\n` +
                  `${executionDirective}\n\nWhen done, use crew_dispatch tool with action "complete" and task_id "${task.id}" to mark it done.`,
                timestamp: new Date(),
                channel: "telegram",
                chatId: task.chat_id || defaultChatId,
                userId: "dispatch-system",
                metadata: { isDispatch: true, dispatchId: task.id, fromAgent: task.from_agent },
              };

              try {
                // Guard: skip if agent persona hasn't loaded yet (prevents crash during deploy windows)
                if (!agentLoop || typeof agentLoop.processMessage !== "function") {
                  console.warn(`⚠️ [DispatchPoller] ${agentName} agent loop not ready — requeueing task ${task.id}`);
                  await completeDispatch(task.id, "failed", "Agent loop not initialized yet — will retry on next cycle");
                  continue;
                }

                // Cap dispatch tasks to conserve LLM quota.
                // Distribution tasks need more iterations (list profiles → post → post → save).
                // Other tasks (caption writing, synthesis) can finish in fewer.
                // Iteration caps per task type — balances LLM quota vs task completion
                // Heavy tasks (distribution, scheduling) need more tool call rounds
                // Light tasks (analysis, captions) can finish in fewer
                const HEAVY_TASKS = new Set(["content_for_distribution", "content_scheduling", "daily_metrics_sweep", "daily_trend_scan"]);
                const isHeavyTask = HEAVY_TASKS.has(task.task_type);
                const iterCap = isHeavyTask ? 6 : 4;
                const response = await agentLoop.processMessage(dispatchMessage, undefined, iterCap);
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

                // ── Two-tier notification: per-agent brief recap + Sapphire full summary ──
                // THROTTLED: Max 7 DMs per hour (1 per agent + 1 Sapphire summary).
                // Pipeline-internal tasks (non-terminal) are SILENT — only log to activity_log.
                // Stasis checks are SILENT unless they detect a problem.
                const SILENT_TASK_TYPES = new Set([
                  "viral_clip_extraction", "narrative_weaponization", "caption_weaponization",
                  "content_for_distribution", "architectural_sync", "stasis_self_check",
                ]);
                const isStasisNominal = task.task_type === "stasis_self_check" &&
                  (response.toLowerCase().includes("nominal") || response.toLowerCase().includes("no trigger"));
                const isSilentTask = SILENT_TASK_TYPES.has(task.task_type) || isStasisNominal;

                // TIER 1: Terminal/notable tasks get a brief DM. Pipeline-internal tasks are silent.
                if (task.task_type !== "pipeline_completion_summary" && !isSilentTask) {
                  try {
                    const agentLabel = agentName.charAt(0).toUpperCase() + agentName.slice(1);
                    // Extract a 1-line summary from the agent's response (first meaningful sentence)
                    const briefRecap = response.split(/[.!?\n]/).filter(s => s.trim().length > 10)[0]?.trim().slice(0, 300) || "Task processed.";
                    await channel.sendMessage(
                      defaultChatId,
                      `🔹 *${agentLabel}*: ${briefRecap}`,
                      { parseMode: "Markdown" }
                    );
                  } catch (dmErr: any) {
                    console.error(`[AgentDM] Failed to send ${agentName} recap: ${dmErr.message}`);
                  }
                } else {
                  console.log(`🔇 [AgentDM] Suppressed DM for ${agentName}/${task.task_type} (pipeline-internal or nominal stasis)`);
                }

                // Also log to activity_log for dashboard visibility
                try {
                  await fetch(`${process.env.SUPABASE_URL}/rest/v1/activity_log`, {
                    method: "POST",
                    headers: {
                      apikey: process.env.SUPABASE_ANON_KEY!,
                      Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY!}`,
                      "Content-Type": "application/json",
                      Prefer: "return=minimal",
                    },
                    body: JSON.stringify({
                      agent: agentName,
                      type: "dispatch_complete",
                      body: `Completed ${task.task_type.replace(/_/g, " ")} (from ${task.from_agent}). ${response.slice(0, 300)}`,
                    }),
                  });
                } catch { /* silent */ }

                // TIER 2: Pipeline completion detection — Sapphire full-picture summary
                // Guard: summary tasks must NOT trigger new summaries (prevents feedback loop spam)
                if (task.parent_id && task.task_type !== "pipeline_completion_summary") {
                  try {
                    const completedChain = await checkPipelineComplete(task.id, task.parent_id);
                    if (completedChain && completedChain.length > 1) {
                      const chainSummary = completedChain.map(d => ({
                        agent: d.to_agent,
                        task: d.task_type.replace(/_/g, " "),
                        status: d.status,
                        result: d.result?.slice(0, 500) || "(no result)",
                      }));
                      const successCount = completedChain.filter(d => d.status === "completed").length;
                      const failCount = completedChain.filter(d => d.status === "failed").length;

                      const summaryId = await dispatchTask({
                        from_agent: "system",
                        to_agent: "sapphire",
                        task_type: "pipeline_completion_summary",
                        payload: {
                          directive: `The content pipeline just finished. ${successCount} tasks completed, ${failCount} failed. ` +
                            `Write a concise plain-English summary (3-5 sentences max) of what was accomplished across the full chain. ` +
                            `Mention which agents did what and whether the content is ready for posting. Be direct, no fluff.`,
                          chain: chainSummary,
                          pipeline: true,
                        },
                        chat_id: defaultChatId, // Always route summary to real Telegram
                        priority: 2,
                      });
                      if (summaryId) {
                        console.log(`📋 [Pipeline] Full chain complete (${completedChain.length} tasks) — dispatched summary to Sapphire: ${summaryId}`);
                      }
                    }
                  } catch (summaryErr: any) {
                    console.error(`[Pipeline] Summary dispatch error: ${summaryErr.message}`);
                  }
                }

                // When Sapphire completes a pipeline_completion_summary, send the full picture to Telegram
                if (agentName === "sapphire" && task.task_type === "pipeline_completion_summary") {
                  try {
                    const summaryText = response.slice(0, 3000);
                    await channel.sendMessage(
                      defaultChatId,
                      `📋 *Pipeline Complete*\n\n${summaryText}`,
                      { parseMode: "Markdown" }
                    );
                  } catch (summaryDmErr: any) {
                    console.error(`[Pipeline] Failed to send Sapphire summary DM: ${summaryDmErr.message}`);
                  }
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
        } catch (err: any) {
          if (err.message === "503_BACKOFF") {
            // Exponential backoff on Supabase 503
            dispatchPollMs = Math.min(dispatchPollMs * 2, DISPATCH_POLL_MAX_MS);
            console.warn(`⚠️ [DispatchPoller] Supabase 503 — backing off to ${dispatchPollMs / 1000}s`);
          } else {
            console.error(`[DispatchPoller] Fatal poll error: ${err.message}`);
          }
        }

        // Schedule next poll (dynamic interval for backoff)
        dispatchPollTimer = setTimeout(runDispatchPoll, dispatchPollMs);
      };

      // Start the first poll after a 30s delay (let system stabilize)
      dispatchPollTimer = setTimeout(runDispatchPoll, 30_000);
    }

    // ── Task Approval Poller — executes tasks Ace moves to "In Progress" in Mission Control ──
    // Agents propose tasks via propose_task → tasks table status "To Do"
    // Ace reviews in Mission Control → moves to "In Progress" = green light
    // This poller detects the approval and feeds the task to the assigned agent
    const TASK_POLL_MS = 120_000; // 120s (was 30s — too aggressive for free tier)
    console.log(`📋 [TaskPoller] Starting task approval poller (every ${TASK_POLL_MS / 1000}s)`);

    setInterval(async () => {
      try {
        const supabaseUrl = process.env.SUPABASE_URL!;
        const supabaseKey = process.env.SUPABASE_ANON_KEY!;

        // Fetch approved AI tasks (status = "In Progress", type = "ai")
        const resp = await fetch(
          `${supabaseUrl}/rest/v1/tasks?status=eq.In%20Progress&type=eq.ai&order=created_at.asc&limit=5`,
          {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
            },
          }
        );

        if (!resp.ok) return;
        const approvedTasks = (await resp.json()) as any[];
        if (approvedTasks.length === 0) return;

        for (const task of approvedTasks) {
          // Resolve assigned agent name (lowercase)
          const assignedTo = (task.assigned_to || "").toLowerCase();
          const agentEntry = agentLoops.get(assignedTo);

          if (!agentEntry) {
            console.warn(`⚠️ [TaskPoller] Task ${task.id} assigned to "${assignedTo}" — agent not found in agentLoops`);
            // Mark as Complete so it doesn't loop forever
            await fetch(`${supabaseUrl}/rest/v1/tasks?id=eq.${task.id}`, {
              method: "PATCH",
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ status: "Complete", description: task.description + "\n\n[AUTO] Agent not found — task could not be executed." }),
            }).catch(() => {});
            continue;
          }

          console.log(`✅ [TaskPoller] Executing approved task ${task.id} → ${assignedTo}: ${task.title}`);

          // Mark as "Executing" to prevent re-pickup on next poll
          await fetch(`${supabaseUrl}/rest/v1/tasks?id=eq.${task.id}`, {
            method: "PATCH",
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ status: "Executing" }),
          }).catch(() => {});

          // Build synthetic message from the task
          const taskMessage: Message = {
            id: `task-approval-${task.id}`,
            role: "user",
            content: `[APPROVED TASK — Execute immediately]\n` +
              `Task ID: ${task.id}\n` +
              `Title: ${task.title}\n` +
              `Priority: ${task.priority || "medium"}\n` +
              `Category: ${task.category || "General"}\n\n` +
              `Description:\n${task.description || "(no description)"}\n\n` +
              `The Architect has reviewed and approved this task. Execute it now according to your role and capabilities. ` +
              `When complete, report results. If blocked, explain why.`,
            timestamp: new Date(),
            channel: "telegram",
            chatId: defaultChatId,
            userId: "task-approval-system",
            metadata: { isTaskApproval: true, taskId: task.id },
          };

          try {
            const response = await agentEntry.loop.processMessage(taskMessage);

            // Mark task as Done
            await fetch(`${supabaseUrl}/rest/v1/tasks?id=eq.${task.id}`, {
              method: "PATCH",
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ status: "Complete" }),
            }).catch(() => {});

            // Log activity
            logAgentActivity(assignedTo, `Task completed: ${task.title} — ${response.slice(0, 300)}`, {
              type: "task_approval_execution",
              task_id: task.id,
            });

            // Notify Ace via Telegram
            const agentLabel = assignedTo.charAt(0).toUpperCase() + assignedTo.slice(1);
            await agentEntry.channel.sendMessage(
              defaultChatId,
              `✅ *${agentLabel}* executed approved task:\n*${task.title}*\n\n${response.slice(0, 500)}`,
              { parseMode: "Markdown" }
            );

            console.log(`✅ [TaskPoller] ${assignedTo} completed task ${task.id}: ${task.title}`);
          } catch (execErr: any) {
            console.error(`[TaskPoller] ${assignedTo} failed on task ${task.id}: ${execErr.message}`);

            // Mark as failed
            await fetch(`${supabaseUrl}/rest/v1/tasks?id=eq.${task.id}`, {
              method: "PATCH",
              headers: {
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ status: "Complete", description: task.description + `\n\n[EXECUTION FAILED] ${execErr.message}` }),
            }).catch(() => {});

            // Notify Ace of failure
            const agentLabel = assignedTo.charAt(0).toUpperCase() + assignedTo.slice(1);
            await agentEntry.channel.sendMessage(
              defaultChatId,
              `⚠️ *${agentLabel}* failed to execute: *${task.title}*\nError: ${execErr.message}`,
              { parseMode: "Markdown" }
            );
          }
        }
      } catch (pollErr: any) {
        // Silent — don't crash
        if (!pollErr.message?.includes("fetch")) {
          console.error(`[TaskPoller] Poll error: ${pollErr.message}`);
        }
      }
    }, TASK_POLL_MS);
  }

  // ── 10. Memory heartbeat log ──
  const mem = process.memoryUsage();
  console.log("\n━━━ GRAVITY CLAW v3.0 — FULLY ONLINE ━━━");
  console.log(`🧠 Memory: ${memoryProviders.map((m) => m.name).join(" + ")}`);
  console.log(`🔧 Tools: ${tools.length} loaded`);
  console.log(`🧬 LLM: ${failoverLLM.listProviders().join(" → ")}`);
  console.log(`📡 Channels: ${router.listChannels().join(", ")}`);
  console.log(`✅ Maven Crew ONLINE — [${activeBotHandles.join(", ")}]`);
  console.log(`📊 Process Memory — RSS: ${Math.round(mem.rss / 1024 / 1024)}MB | Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}/${Math.round(mem.heapTotal / 1024 / 1024)}MB | External: ${Math.round(mem.external / 1024 / 1024)}MB`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ── Memory Monitor (every 5 min) ──
  setInterval(() => {
    const m = process.memoryUsage();
    console.log(`📊 [MemWatch] RSS: ${Math.round(m.rss / 1024 / 1024)}MB | Heap: ${Math.round(m.heapUsed / 1024 / 1024)}/${Math.round(m.heapTotal / 1024 / 1024)}MB`);
  }, 300_000);

  // ── Graceful Shutdown ──
  const shutdown = async () => {
    console.log("🛑 GRAVITY CLAW shutting down...");
    heartbeat.stop();
    sapphireSentinel.stop();
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
        
