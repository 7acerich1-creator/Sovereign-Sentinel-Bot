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
// AgentComms REMOVED (Session 26) — legacy in-memory message bus, fully replaced by Supabase crew-dispatch.
// Source file retained at ./agent/comms.ts for reference but no longer imported or instantiated.
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
import { injectYoutubeProtocolsIfNeeded } from "./agent/protocol-injection";
import { ProtocolReaderTool, ProtocolWriterTool } from "./tools/protocol-reader";
import { RelationshipContextTool } from "./tools/relationship-context";
import { SapphireSentinel } from "./proactive/sapphire-sentinel";
import { handleSapphirePACommand } from "./agent/sapphire-pa-commands";
import { PineconeMemory } from "./memory/pinecone";
import { KnowledgeWriterTool } from "./tools/knowledge-writer";
import { ImageGeneratorTool } from "./tools/image-generator";
import { produceFacelessBatch } from "./engine/faceless-factory";
import { extractWhisperIntel } from "./engine/whisper-extract";
import { executeFullPipeline, formatPipelineReport, type PipelineOptions } from "./engine/vidrush-orchestrator";
import { shutdownPodSession } from "./pod/session";
import { sweepStalePods } from "./pod/runpod-client";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { ProposeTaskTool, SaveContentDraftTool, FileBriefingTool, CheckApprovedTasksTool } from "./tools/action-surface";
import { StripeMetricsTool } from "./tools/stripe-metrics";
import { BufferAnalyticsTool } from "./tools/buffer-analytics";
import { YouTubeAnalyticsReaderTool, LandingAnalyticsReaderTool, EmailTrackingTool } from "./tools/analytics-readers";
import { VideoPublisherTool, TikTokPublishTool, InstagramReelsPublishTool, YouTubeShortsPublishTool, YouTubeLongFormPublishTool } from "./tools/video-publisher";
import { YouTubeUpdateMetadataTool, YouTubePinCommentTool, YouTubeCTAAuditTool } from "./tools/youtube-cta-tools";

// ── Voice ──
import { transcribeAudio, downloadTelegramFile } from "./voice/transcription";
import { textToSpeech } from "./voice/tts";

// ── Proactive ──
import { ProactiveBriefings } from "./proactive/briefings";
import { HeartbeatSystem } from "./proactive/heartbeat";
import { pollYouTubeComments } from "./proactive/youtube-comment-watcher";
import { pollNewShortsForPinnedComment } from "./proactive/yuki-shorts-pinner";
import { pollYouTubeStats } from "./proactive/youtube-stats-fetcher";
import { runHookDrops } from "./proactive/yuki-hook-dropper";
import { pollBlueskyReplies } from "./proactive/yuki-bluesky-replier";
import { runBlueskyHookDrops } from "./proactive/yuki-bluesky-hook-dropper";
import { handleInboundEmail, sendApprovedReply, getPendingReplies } from "./proactive/email-reply-handler";
import { runWeeklyNewsletterCycle } from "./proactive/anita-newsletter";
import { runMilestoneSync } from "./proactive/milestone-sync";
import { YouTubeCommentTool, postDiagnosticComment } from "./tools/youtube-comment-tool";

// ── Content Engine ──
import { dailyContentProduction, distributionSweep, draftAutoPublisher, fluxBatchImageGen, contentEngineStatus, discoverChannels, nukeBufferQueue } from "./engine/content-engine";
import { warmChannelCache } from "./engine/buffer-graphql";
import { drainBacklog } from "./engine/backlog-drainer";

// ── Brand Niche Allowlist (Phase 3 Task 3.2) ──
// Intake-layer guard: Alfred's seeds and the pipeline entry both consume these
// helpers to keep burnout-on-Sovereign-Synthesis (and sovereignty-on-TCF) from ever
// reaching the render layer. The S48 Brand Routing Matrix fixed RENDER; this
// fixes INTAKE. See src/data/shared-context.ts for the canonical allowlist.
import {
  SOVEREIGN_SYNTHESIS_NICHES,
  CONTAINMENT_FIELD_NICHES,
  normalizeNiche,
  isAllowedNiche,
  nicheAllowlistLine,
} from "./data/shared-context";

// ── Niche Cooldown (Phase 3 Task 3.5) ──
// 30-day hard / 14-day soft cooldown ledger. Alfred consumes the snapshot at
// directive-build time so he sees which niches are already spent; the bridge
// calls recordNicheRun AFTER a seed successfully enters the factory (so an
// aborted/rejected seed never burns a cooldown).
import {
  getNicheCooldownSnapshot,
  cooldownSummaryLine,
  recordNicheRun,
} from "./tools/niche-cooldown";

// ── Plugins ──
import { PluginManager, MemoryTool, RecallTool } from "./plugins/system";

// ── UX ──
import { GroupManager } from "./ux/groups";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Session 47e: Durable dup-fire guard for autonomous daily scans.
 *
 * The `autonomousFiredDates` map in main() is in-memory only — it resets on every
 * container restart. Combined with Session 47c's widened fire window for Alfred
 * (hour >= 15:05 UTC for the rest of the day), any Railway redeploy after 15:05 UTC
 * would re-fire the daily_trend_scan and produce a duplicate pipeline run.
 *
 * This helper queries the Supabase crew_dispatch table for any row matching
 * (to_agent, task_type) with created_at >= today's UTC midnight. If a row exists,
 * the scan already fired today and the scheduler must skip. Cross-restart durable
 * because it's reading from a persistent table, not process memory.
 *
 * Fail-open on Supabase errors: if the query fails, return false and let the
 * in-memory flag handle duplicates within the session. Worst case degrades to
 * pre-fix behavior (one potential dup per redeploy), not worse.
 */
async function hasAlreadyFiredToday(toAgent: string, taskType: string): Promise<boolean> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return false; // fail-open: no Supabase = no guard

  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const sinceIso = todayStart.toISOString();

    const url = `${supabaseUrl}/rest/v1/crew_dispatch` +
      `?to_agent=eq.${encodeURIComponent(toAgent)}` +
      `&task_type=eq.${encodeURIComponent(taskType)}` +
      `&created_at=gte.${encodeURIComponent(sinceIso)}` +
      `&select=id&limit=1`;

    const resp = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    if (!resp.ok) {
      console.warn(`[AutoOps] hasAlreadyFiredToday query failed: ${resp.status} ${resp.statusText}`);
      return false; // fail-open
    }

    const rows = (await resp.json()) as any[];
    return Array.isArray(rows) && rows.length > 0;
  } catch (err: any) {
    console.warn(`[AutoOps] hasAlreadyFiredToday error: ${err.message}`);
    return false; // fail-open
  }
}

async function main() {
  // SESSION 51: Graceful shutdown state — declared at main() scope
  // so both dispatch poller (inner block) and shutdown handler can access them.
  let shuttingDown = false;
  let activeDispatchCount = 0;
  let dispatchPollTimer: ReturnType<typeof setTimeout> | null = null;

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

  // SESSION 35: Gemini key audit
  const hasGeminiApi = !!process.env.GEMINI_API_KEY;
  const hasGeminiImagen = !!process.env.GEMINI_IMAGEN_KEY;
  const hasOpenAi = !!process.env.OPENAI_API_KEY;
  console.log(`🔑 [KEY AUDIT] GEMINI_API_KEY: ${hasGeminiApi ? "SET" : "NOT SET"} | GEMINI_IMAGEN_KEY: ${hasGeminiImagen ? "SET" : "NOT SET"} | OPENAI_API_KEY: ${hasOpenAi ? "SET" : "NOT SET"}`);
  if (!hasGeminiApi && !hasOpenAi) {
    console.warn(`⚠️ [KEY AUDIT] No embedding provider — Pinecone writes DISABLED (reads still work). Add GEMINI_API_KEY or OPENAI_API_KEY to enable.`);
  }
  if (!hasGeminiImagen) {
    console.warn(`⚠️ [KEY AUDIT] GEMINI_IMAGEN_KEY not set — Imagen 4 disabled, using Pollinations (free) for images.`);
  }

  // Knowledge Graph
  const knowledgeGraph = new KnowledgeGraph();
  await knowledgeGraph.initialize();

  // Self-Evolving Memory
  const selfEvolvingMemory = new SelfEvolvingMemory();
  await selfEvolvingMemory.initialize();

  // Pinecone Semantic Memory (Tier 4 — crew-wide institutional intelligence)
  const pineconeMemory = new PineconeMemory();
  await pineconeMemory.initialize();

  // ── S114p: Wire Pinecone into the business learning loop ──
  // Every successful crew_dispatch completion will now extract a 1-line
  // insight via Gemini Flash and write to that agent's namespace.
  try {
    const { setPineconeForExtraction } = await import("./agent/insight-extractor");
    setPineconeForExtraction(pineconeMemory);
    if (pineconeMemory.isReady()) {
      console.log("🧠 [InsightExtractor] Wired — every completed dispatch produces an insight");
    }
  } catch (e: any) {
    console.warn(`[InsightExtractor] Failed to wire: ${e.message}`);
  }

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
  // CRITICAL: Initialize ALL providers that have API keys, not just those in failoverOrder.
  // failoverOrder controls the ORDER, not which providers exist. An env var override of
  // LLM_FAILOVER_ORDER must never silently prevent a provider from being instantiated.
  // Bug history: Groq had a key but was excluded because LLM_FAILOVER_ORDER env var
  // (set before Groq was added) didn't list it. Pipeline ran without its free LLM.
  const llmProviders: LLMProvider[] = [];
  // First pass: initialize in failoverOrder sequence
  // SESSION 93: Gemini RE-ADMITTED to text-gen. Was excluded S29c due to Anita billing leak
  // (root cause: Supabase overwriting prompts, fixed commit 624fc28). Anthropic credits
  // exhausted — Gemini is now primary for all text-gen. Groq backup. Anthropic emergency only.
  for (const providerName of config.llm.failoverOrder) {
    const providerConfig = (config.llm.providers as Record<string, any>)[providerName];
    if (providerConfig?.apiKey) {
      try {
        const provider = createProvider(
          providerName,
          providerConfig.apiKey,
          providerConfig.model,
          providerConfig.baseUrl
        );
        llmProviders.push(provider);
        console.log(`# ✅ Active model: ${providerName} → ${providerConfig.model}`);
      } catch (err: any) {
        console.warn(`⚠️ LLM provider ${providerName} skipped: ${err.message}`);
      }
    }
  }

  // Second pass: catch any providers with keys that were NOT in failoverOrder.
  // SESSION 93: Gemini exclusion REMOVED. All providers with keys are eligible for text-gen.
  // GEMINI_IMAGEN_KEY is still a separate key read directly by faceless-factory/content-engine
  // for image gen — that's independent of the text-gen Gemini provider.
  for (const providerName of Object.keys(config.llm.providers)) {
    if (llmProviders.some(p => p.name === providerName)) continue; // Already initialized
    const providerConfig = (config.llm.providers as Record<string, any>)[providerName];
    if (providerConfig?.apiKey) {
      try {
        const provider = createProvider(
          providerName,
          providerConfig.apiKey,
          providerConfig.model,
          providerConfig.baseUrl
        );
        llmProviders.push(provider);
        console.log(`# ✅ Active model (not in failoverOrder): ${providerName} → ${providerConfig.model}`);
        console.warn(`⚠️ WARNING: ${providerName} has an API key but is NOT in LLM_FAILOVER_ORDER. Added as fallback. Update the env var to include it.`);
      } catch (err: any) {
        console.warn(`⚠️ LLM provider ${providerName} skipped: ${err.message}`);
      }
    }
  }

  // Log the complete chain for PFV-01 Layer 1 verification
  console.log(`# 🔗 LLM provider chain: [${llmProviders.map(p => p.name).join(", ")}] (${llmProviders.length} active)`);

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

  // LLM_TIMEOUT_MS env var lets Railway override per-call timeout without a code deploy.
  // Default 60s is too short for 6144-token Groq completions under rate limiting.
  // S95: Default bumped 60s → 120s to stop Gemini thinking-model timeouts.
  // Override via LLM_TIMEOUT_MS env var on Railway if needed.
  const llmTimeoutMs = parseInt(process.env.LLM_TIMEOUT_MS || "120000", 10);

  // Session 31: Dual Groq key distribution across agents AND pipelines.
  // GROQ_API_KEY = Key A (primary), GROQ_API_KEY_TCF = Key B (secondary).
  // Splits 30 RPM / 6000 TPM per key across agents to prevent rate limit stampedes.
  const groqTcfKey = process.env.GROQ_API_KEY_TCF;
  let groqProviderB: LLMProvider | null = null;
  if (groqTcfKey) {
    groqProviderB = createProvider("groq", groqTcfKey, config.llm.providers.groq.model, config.llm.providers.groq.baseUrl);
  }

  function buildTeamLLM(primaryOrder: string[], primaryRetries = 0, useGroqB = false): FailoverLLM {
    const chain: LLMProvider[] = [];
    for (const name of primaryOrder) {
      if (name === "groq" && useGroqB && groqProviderB) {
        chain.push(groqProviderB);
      } else if (providersByName[name]) {
        chain.push(providersByName[name]);
      }
    }
    return new FailoverLLM(chain, llmTimeoutMs, primaryRetries);
  }

  // SESSION 93: LLM ROUTING — GEMINI PRIMARY
  // Anthropic credits exhausted. Gemini is primary for ALL agents + pipelines.
  // Groq (free) is first fallback. Anthropic is emergency-only last resort.
  // useGroqB splits Groq Key B across TCF-branded agents to prevent rate stampedes.
  // 1 primaryRetry = Gemini gets a second chance on 429 before failover to Groq.
  const AGENT_LLM_TEAMS: Record<string, FailoverLLM> = {
    alfred: buildTeamLLM(["gemini", "groq", "anthropic"], 1, false),    // Gemini-first — dispatches + user chat
    anita: buildTeamLLM(["gemini", "groq", "anthropic"], 1, true),      // Gemini-first — dispatches + user chat
    sapphire: buildTeamLLM(["gemini", "groq", "anthropic"], 1),         // Gemini-first
    veritas: buildTeamLLM(["gemini", "groq", "anthropic"], 1),          // Gemini-first
    vector: buildTeamLLM(["gemini", "groq", "anthropic"], 1, false),    // Gemini-first — dispatches + user chat
    yuki: buildTeamLLM(["gemini", "groq", "anthropic"], 1, true),       // Gemini-first — dispatches + user chat
  };

  // SESSION 93: Pipeline LLMs — Gemini-first.
  // Anthropic credits exhausted. Gemini handles bulk pipeline work (script gen, social copy,
  // clip generation — 30-50+ calls per video). Groq free tier as first fallback.
  // Anthropic parked as emergency-only last resort.
  const pipelineLLM = buildTeamLLM(["gemini", "groq", "anthropic"], 1, false);     // Key A — SS pipeline
  const tcfPipelineLLM = buildTeamLLM(["gemini", "groq", "anthropic"], 1, true);   // Key B — TCF pipeline

  if (groqTcfKey) {
    console.log(`🔑 [LLM Teams] Session 93 routing: ALL agents+pipelines Gemini-first. Groq fallback. Anthropic emergency-only. Key A: pipeline. Key B: tcf-pipeline.`);
  } else {
    console.warn(`⚠️ [LLM Teams] GROQ_API_KEY_TCF not set — TCF pipeline shares Groq Key A with SS pipeline.`);
  }

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

  // YouTube CTA Optimization Tools (Session 50 — NORTH_STAR spine tools)
  // update_metadata: edit existing video descriptions/tags (inject CTAs)
  // pin_comment: post channel-owner comments with CTA links
  // cta_audit: weekly scan → propose optimizations → DM Architect → approve → execute
  tools.push(new YouTubeUpdateMetadataTool());
  tools.push(new YouTubePinCommentTool());
  tools.push(new YouTubeCTAAuditTool());

  // Sovereign Image Generator (Gemini Imagen 3 + DALL-E 3 fallback)
  tools.push(new ImageGeneratorTool());

  // Scheduler
  const scheduler = new Scheduler();
  tools.push(new SchedulerTool(scheduler));

  // Agent Swarm
  const swarm = new AgentSwarm(failoverLLM, tools);
  tools.push(new SwarmTool(swarm));

  // Crew Dispatch (Supabase-backed inter-agent routing — the ONLY agent-to-agent system)
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
  // CRITICAL: Veritas chat must use the Veritas team LLM (Anthropic-first), NOT failoverLLM (Groq-first).
  // failoverLLM has Groq at position #1, which competes with pipeline for rate limits and burns
  // the Architect's $10 Anthropic reserve when Groq 429s cascade through the chain.
  // AGENT_LLM_TEAMS.veritas = ["anthropic", "gemini", "groq"] — strategic brain, not pipeline grunt.
  const agentLoop = new AgentLoop(AGENT_LLM_TEAMS.veritas, tools, memoryProviders);
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

      // ── Session 47c: IDEA: prefix ingestion ──
      // If the message starts with "IDEA:", strip the prefix, treat the remainder as a raw
      // thesis, and feed it directly into the executeFullPipeline flow. Bypasses yt-dlp +
      // Whisper entirely. Dual-brand by default; single-brand via optional brand modifier.
      //
      // Patterns (case-insensitive):
      //   IDEA: <thesis>                → dual-brand (ACE + TCF)
      //   IDEA: ss only: <thesis>       → SOVEREIGN SYNTHESIS only
      //   IDEA: tcf only: <thesis>      → THE CONTAINMENT FIELD only
      const ideaPrefixMatch = message.content.match(/^\s*IDEA:\s*(?:(ace|ss|tcf)\s*only:\s*)?(.+)$/is);
      if (ideaPrefixMatch) {
        const ideaBrandHint = ideaPrefixMatch[1]?.toLowerCase(); // "ace"|"ss" | "tcf" | undefined
        const rawIdeaText = ideaPrefixMatch[2].trim();
        if (rawIdeaText.length < 10) {
          await telegram.sendMessage(message.chatId,
            "⚠️ IDEA text too short. Provide at least a one-sentence thesis after the `IDEA:` prefix.",
            { parseMode: "Markdown" }
          );
          return;
        }

        try {
          const ideaHash = require("crypto")
            .createHash("sha1")
            .update(rawIdeaText)
            .digest("hex")
            .slice(0, 10);
          const syntheticId = `raw_${ideaHash}`;
          const ideaPreview = rawIdeaText.length > 120 ? rawIdeaText.slice(0, 120) + "…" : rawIdeaText;
          const ideaMode = (ideaBrandHint === "ace" || ideaBrandHint === "ss") ? "SOVEREIGN SYNTHESIS only" : ideaBrandHint === "tcf" ? "THE CONTAINMENT FIELD only" : "Dual-brand";
          console.log(`🌱 [IDEA:] Manual native seed ingested [${syntheticId}] [${ideaMode}]: "${ideaPreview}"`);

          await telegram.sendMessage(message.chatId,
            `🌱 *NATIVE SEED INGESTED.* Assembling pipeline...\n\n` +
            `_"${ideaPreview}"_\n\n` +
            `${ideaMode} faceless factory engaging. Expect progress messages shortly.`,
            { parseMode: "Markdown" }
          );

          // Enqueue via pipeline queue — serializes with /pipeline runs and the Alfred auto-bridge.
          // Same loop + cooldown pattern as /pipeline and the bridge auto-trigger, but the brand
          // list is filtered by the IDEA: prefix hint so single-brand runs skip the other lane.
          const manualEnqueue = (globalThis as any).__enqueuePipeline;
          const allBrands: Array<"sovereign_synthesis" | "containment_field"> = ["sovereign_synthesis", "containment_field"];
          const manualBrands: Array<"sovereign_synthesis" | "containment_field"> = (ideaBrandHint === "ace" || ideaBrandHint === "ss")
            ? ["sovereign_synthesis"]
            : ideaBrandHint === "tcf"
            ? ["containment_field"]
            : allBrands;
          const queueTag = ideaBrandHint || "dual";
          const manualPos = manualEnqueue ? manualEnqueue(`idea-${syntheticId}-${queueTag}`, async () => {
            for (let bIdx = 0; bIdx < manualBrands.length; bIdx++) {
              const brand = manualBrands[bIdx];
              const brandLabel = brand === "containment_field" ? "THE CONTAINMENT FIELD" : "SOVEREIGN SYNTHESIS";

              if (bIdx > 0) {
                const cooldownMs = parseInt(process.env.PIPELINE_COOLDOWN_MS || "180000", 10);
                const cooldownSec = Math.round(cooldownMs / 1000);
                console.log(`⏳ [IDEA:] Inter-brand cooldown: ${cooldownSec}s...`);
                try {
                  await telegram.sendMessage(message.chatId, `⏳ Cooling down ${cooldownSec}s before ${brandLabel} pipeline...`);
                } catch { /* non-critical */ }
                await new Promise(r => setTimeout(r, cooldownMs));
              }

              try {
                await telegram.sendMessage(message.chatId, `--- ${brandLabel} PIPELINE (raw_idea) ---`);
              } catch { /* non-critical */ }

              try {
                const result = await executeFullPipeline(
                  syntheticId,
                  brand === "containment_field" ? tcfPipelineLLM : pipelineLLM,
                  brand,
                  async (step: string, detail: string) => {
                    try {
                      await telegram.sendMessage(message.chatId, `[${brandLabel}] ${step}: ${detail}`);
                    } catch { /* non-critical */ }
                  },
                  { rawIdea: rawIdeaText }
                );
                const report = formatPipelineReport(result);
                try {
                  await telegram.sendMessage(message.chatId, `${brandLabel} COMPLETE:\n${report}`, { parseMode: "Markdown" });
                } catch {
                  await telegram.sendMessage(message.chatId, `${brandLabel} COMPLETE:\n${report.replace(/[*_`]/g, "")}`);
                }
              } catch (pipeErr: any) {
                console.error(`❌ [IDEA:] ${brandLabel} Pipeline CRASHED: ${pipeErr.message}`);
                try {
                  await telegram.sendMessage(message.chatId,
                    `${brandLabel} Pipeline FAILED: ${pipeErr.message?.slice(0, 500)}`
                  );
                } catch { /* silent */ }
                // Continue to next brand even if one fails
              }
            }
          }) : 0;

          if (manualPos > 1) {
            try { await telegram.sendMessage(message.chatId, `⏳ Pipeline queued (position ${manualPos}). Will start after current run.`); } catch { /* non-critical */ }
          }
        } catch (ideaErr: any) {
          console.error(`❌ [IDEA:] Handler error: ${ideaErr.message}`);
          try {
            await telegram.sendMessage(message.chatId, `⚠️ IDEA ingestion failed: ${ideaErr.message?.slice(0, 400)}`);
          } catch { /* nothing */ }
        }
        return;
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
      const HANDLER_TIMEOUT_MS = 180_000; // Session 31: raised from 120s — Veritas multi-iteration loops with Anthropic at 22K tokens need more time

      const response = await Promise.race([
        agentLoop.processMessage(
          message,
          () => telegram.sendTyping(message.chatId)
        ),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("Agent loop timed out after 180s")), HANDLER_TIMEOUT_MS)
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
      // Voice replies work with ANY TTS provider (Edge TTS is free/always available)
      const wantsVoice = message.metadata?.originalType === "voice";

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

  // ── Session 47c: Alfred Native Seed Generator directive (shared) ──
  // Single source of truth for Alfred's daily scan directive. Used by both the 15:05 UTC
  // scheduler and the /alfred Telegram force-trigger command. Edit once, effect both.
  //
  // Phase 3 Task 3.3 (2026-04-15): DUAL-SEED CONTRACT.
  // Alfred now emits TWO brand-bound seeds per run, one per brand, each constrained
  // to the brand's niche allowlist (src/data/shared-context.ts). This closes the
  // Alfred-shared-seed cross-contamination bug where Sovereign Synthesis was producing
  // burnout-themed content (which belongs exclusively to The Containment Field).
  // S48 Brand Routing Matrix fixed RENDER layers; this fixes INTAKE.
  //
  // Phase 3 Task 3.5 (2026-04-15): COOLDOWN INJECTION.
  // This is now an async builder — at every dispatch it queries niche_last_run
  // and injects two per-brand cooldown summaries so Alfred can actively steer
  // AWAY from recently-used niches. Static-const the directive and Alfred would
  // be blind to the ledger, leading to same-niche-two-days-in-a-row drift.
  async function buildAlfredDailyScanDirective(): Promise<string> {
    // Query both brands in parallel; each call is graceful-degrading (returns
    // permissive "all fresh" snapshot if Supabase is unreachable).
    const [ssSnap, tcfSnap] = await Promise.all([
      getNicheCooldownSnapshot("sovereign_synthesis"),
      getNicheCooldownSnapshot("containment_field"),
    ]);
    const ssCooldownLine = cooldownSummaryLine(ssSnap);
    const tcfCooldownLine = cooldownSummaryLine(tcfSnap);
    return STATIC_ALFRED_DIRECTIVE_HEAD +
      "\n\nCOOLDOWN LEDGER (live — respect this, it is not advisory):\n" +
      `  • ${ssCooldownLine}\n` +
      `  • ${tcfCooldownLine}\n` +
      "  Rules: prefer `fresh` niches. Only use `relax` niches if every `fresh` slot for that brand is empty. " +
      "NEVER pick a `blocked` niche — the factory will reject it and the day's run will abstain. " +
      "If the only unblocked option for a brand is a repeat of the last 48h, pick a different niche from the `fresh` set.\n\n" +
      STATIC_ALFRED_DIRECTIVE_TAIL;
  }

  const STATIC_ALFRED_DIRECTIVE_HEAD =
    "DAILY DUAL-SEED GENERATION — You are the autonomous Native Seed Generator for the Sovereign Synthesis machine. " +
    "DO NOT search the web. DO NOT look for YouTube URLs. DO NOT cite competitors. " +
    "Your job is to PROJECT the Sovereign frequency outward, not to react to the simulation's noise.\n\n" +
    "BRAND SEPARATION IS NON-NEGOTIABLE. You generate TWO distinct theses today — one per brand — " +
    "each constrained to that brand's niche allowlist. A single shared thesis is a hard failure.\n\n" +
    "BRAND 1 — SOVEREIGN SYNTHESIS (@sovereign_synthesis)\n" +
    "  Voice: sovereign architect, builder of systems, wealth-frequency, authority. Never victim-coded.\n" +
    `  ${nicheAllowlistLine("sovereign_synthesis")}\n` +
    "  Allowed topics: architecture of the one-person empire, monk mode / frame control, sovereign wealth mechanics, " +
    "system mastery, the Firmware Update, escape velocity from consensus reality.\n" +
    "  FORBIDDEN for Sovereign Synthesis: burnout, manipulation-exposed, narcissist defense, dark psychology, recovery framing. " +
    "Those belong to Brand 2.\n\n" +
    "BRAND 2 — THE CONTAINMENT FIELD (@TheContainmentField)\n" +
    "  Voice: anonymous, dark-positioned, pattern-interrupt, exposes covert manipulation. Feeder channel.\n" +
    `  ${nicheAllowlistLine("containment_field")}\n` +
    "  Allowed topics: corporate burnout & the high-performer trapdoor, dark triad tactics, gray rock as frequency shield, " +
    "narcissist architecture, the burnout-to-sovereignty pivot (framed from inside the burnout, not the sovereignty side).\n" +
    "  FORBIDDEN for Containment Field: sovereignty gospel, wealth-frequency, 'you are the architect' language. " +
    "Those belong to Brand 1.";

  // The TAIL holds the OUTPUT CONTRACT + tool-usage contract. The async builder
  // inserts the live cooldown ledger between HEAD and TAIL so Alfred sees the
  // spend-state RIGHT after he's been reminded of each brand's lane.
  const STATIC_ALFRED_DIRECTIVE_TAIL =
    "EACH thesis must be a complete, standalone concept — thesis statement plus 1-2 sentence framing — " +
    "not a niche label, not a topic, not a list. Embed at least 3 keywords from that brand's niche lane so downstream " +
    "classification routes the right color grade and brand voice.\n\n" +
    "OUTPUT CONTRACT (mandatory — your response is parsed by regex; failure = pipeline halt):\n" +
    "1. A short brief to the Architect (2-4 sentences explaining why each thesis hits today and how the two contrast).\n" +
    "2. The hook line for each brand in 4-Part Copy Architecture (GLITCH → PIVOT → BRIDGE → ANCHOR). Label them [ACE] and [TCF].\n" +
    "3. Two final lines, each with format: `PIPELINE_IDEA_<BRAND>: <niche-tag> :: <thesis sentence>`\n" +
    "   • `PIPELINE_IDEA_SS: wealth-frequency :: <thesis>` — niche MUST be one of Sovereign Synthesis's allowed niches above.\n" +
    "   • `PIPELINE_IDEA_TCF: burnout :: <thesis>` — niche MUST be one of The Containment Field's allowed niches above.\n" +
    "   • The `::` separator is literal. No quotes, no markdown, no trailing punctuation after the thesis.\n\n" +
    "EXAMPLE (for shape only — do NOT copy the content):\n" +
    "  PIPELINE_IDEA_SS: architecture :: The one-person empire is not a hustle, it's a lattice — every system you build subtracts a boss from your life until there's only you and the code.\n" +
    "  PIPELINE_IDEA_TCF: burnout :: Your Monday dread isn't laziness — it's your nervous system correctly identifying the building as a Faraday cage disguised as a career.\n\n" +
    "If for any reason you cannot generate a thesis for one brand, write `PIPELINE_IDEA_SS: NONE` (or `_TCF: NONE`). " +
    "Both NONE means the autonomous scan abstains today — preferable to a contaminated seed.\n\n" +
    "CRITICAL — TOOL USAGE CONTRACT:\n" +
    "• DO NOT call the crew_dispatch tool. Your FINAL assistant text message IS your deliverable.\n" +
    "• The bridge parses PIPELINE_IDEA_SS and PIPELINE_IDEA_TCF from your final text response. " +
    "If you put them inside a crew_dispatch result field, they WILL be lost and the pipeline will not fire.\n" +
    "• You may call read_protocols ONCE if you need to refresh context, but after that your next output must be the final text containing both PIPELINE_IDEA_* lines.\n" +
    "• No tool calls in your final turn. Just the brief, the two 4-part hooks, and the two PIPELINE_IDEA_* lines.";

  // ── Command Handler ──
  async function handleCommand(message: Message): Promise<boolean> {
    const parts = message.content.split(/\s+/);
    const cmd = parts[0].replace(/@\w+$/i, "").toLowerCase(); // Strip @botname, normalize case
    const args = parts.slice(1);
    const arg = args.join(" ");
    console.log(`🔧 [handleCommand] cmd="${cmd}" arg="${arg.slice(0, 80)}"`);

    switch (cmd) {
      case "/start":
        await telegram.sendMessage(message.chatId,
          `⚡ *GRAVITY CLAW v3.0 — ONLINE*\n\n` +
          `Sovereign Frequency: *LOCKED*\n` +
          `Protocol 77: *ACTIVE*\n` +
          `Veritas Brain: *${AGENT_LLM_TEAMS.veritas.listProviders().join(" → ")}*\n` +
          `Pipeline LLM: *${failoverLLM.listProviders().join(" → ")}*\n` +
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
          `/pipeline <url> — Run full VidRush pipeline (LIVE)\n` +
          `/produce — Content Engine: generate drafts + FLUX images + distribute\n` +
          `/buffer_audit — Audit Buffer channels + purge failed posts\n` +
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
          `🧠 *LLM ROUTING:*\n` +
          `  Veritas (chat): ${AGENT_LLM_TEAMS.veritas.listProviders().join(" → ")}\n` +
          `  Sapphire: ${AGENT_LLM_TEAMS.sapphire.listProviders().join(" → ")}\n` +
          `  Anita (content): ${AGENT_LLM_TEAMS.anita.listProviders().join(" → ")}\n` +
          `  Alfred (trends): ${AGENT_LLM_TEAMS.alfred.listProviders().join(" → ")}\n` +
          `  Pipeline: ${failoverLLM.listProviders().join(" → ")}\n\n` +
          `🔧 Tools: ${tools.length}\n` +
          `📡 MCP Servers: ${mcpBridge.listConnectedServers().length}\n` +
          `📚 Skills: ${skillsSystem.listSkills().length}\n` +
          `⏰ Scheduled: ${scheduler.list().length}\n` +
          `🧠 Memory Tiers: ${memoryProviders.length}\n` +
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
            brand: "sovereign_synthesis",
          });
          await telegram.sendMessage(message.chatId, `YouTube test result:\n${result.slice(0, 500)}`);
        } catch (err: any) {
          await telegram.sendMessage(message.chatId, `❌ YouTube test FAILED: ${err.message?.slice(0, 400)}`);
        }
        return true;
      }

      case "/dryrun": {
        console.log(`🧪 [/dryrun] ENTERED. arg="${arg.slice(0, 100)}" content="${message.content.slice(0, 120)}"`);
        try {
          const YT_RE = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|live\/|shorts\/)|youtu\.be\/)([\w-]{11})/i;
          const ytMatch = arg.match(YT_RE) || message.content.match(YT_RE);
          if (!ytMatch) {
            await telegram.sendMessage(message.chatId, "Usage: /dryrun <youtube_url>");
            return true;
          }
          const dryVideoId = ytMatch[1];
          const dryYoutubeUrl = `https://www.youtube.com/watch?v=${dryVideoId}`;
          console.log(`🧪 [/dryrun] Parsed video: ${dryVideoId}`);

          // Send initial confirmation — plain text first to guarantee delivery
          try {
            await telegram.sendMessage(message.chatId,
              `🧪 *DRY RUN — VID RUSH PIPELINE*\nVideo: \`${dryVideoId}\`\n\nRunning full 8-step pipeline with ALL APIs stubbed.\nThis validates logic, file paths, and data flow at zero cost.`,
              { parseMode: "Markdown" }
            );
          } catch (mdErr: any) {
            console.error(`⚠️ [/dryrun] Markdown send failed, falling back to plain: ${mdErr.message}`);
            await telegram.sendMessage(message.chatId,
              `DRY RUN -- VID RUSH PIPELINE\nVideo: ${dryVideoId}\n\nRunning full 8-step pipeline with ALL APIs stubbed.`
            );
          }

          const dryBrandMatch = message.content.match(/\b(containment[_ ]?field|tcf)\b/i);
          const dryBrand = dryBrandMatch ? "containment_field" as const : "sovereign_synthesis" as const;

          // Session 40: Enqueue via pipeline queue — serializes with live runs
          const enqueue = (globalThis as any).__enqueuePipeline;
          const dryPosition = enqueue ? enqueue(`dryrun-${dryVideoId}`, async () => {
            try {
              console.log(`🧪 [/dryrun] Starting executeFullPipeline...`);
              const result = await executeFullPipeline(
                dryYoutubeUrl,
                pipelineLLM,  // Groq-first: free tier, won't burn paid credits
                dryBrand,
                async (step: string, detail: string) => {
                  try {
                    await telegram.sendMessage(message.chatId, `${step}: ${detail}`);
                  } catch { /* non-critical progress */ }
                },
                { dryRun: true }
              );

              console.log(`🧪 [/dryrun] Pipeline complete. Clips: ${result.clipCount}, errors: ${result.errors.length}`);
              const report =
                `DRY RUN -- COMPLETE\n` +
                `YouTube: ${result.youtubeUrl || "simulated"}\n` +
                `Clips generated: ${result.clipCount}\n` +
                `Buffer scheduled: ${result.bufferScheduled} posts\n` +
                `Total time: ${result.duration.toFixed(0)}s\n` +
                `${result.errors.length > 0 ? `\nIssues:\n${result.errors.map(e => "  - " + e).join("\n")}` : "Zero issues -- pipeline logic is clean"}\n\n` +
                `Ready for live run. Send /pipeline <url>`;
              await telegram.sendMessage(message.chatId, report);
            } catch (err: any) {
              console.error(`❌ [/dryrun] Pipeline CRASHED: ${err.message}\n${err.stack}`);
              try {
                await telegram.sendMessage(message.chatId,
                  `DRY RUN FAILED: ${err.message?.slice(0, 500)}\n\nThis would have failed in production too. Fix first.`
                );
              } catch (sendErr: any) {
                console.error(`❌ [/dryrun] Could not send failure msg: ${sendErr.message}`);
              }
            }
          }) : 0;

          if (dryPosition > 1) {
            try { await telegram.sendMessage(message.chatId, `⏳ Pipeline queue position: ${dryPosition}. Will start when current run finishes.`); } catch { /* non-critical */ }
          }

          return true;
        } catch (err: any) {
          console.error(`❌ [/dryrun] OUTER CATCH: ${err.message}\n${err.stack}`);
          try {
            await telegram.sendMessage(message.chatId, `dryrun command error: ${err.message?.slice(0, 400)}`);
          } catch { /* truly nothing we can do */ }
          return true;
        }
      }

      case "/pipeline": {
        console.log(`🔥 [/pipeline] ENTERED. arg="${arg.slice(0, 100)}"`);
        try {
          const YT_RE2 = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|live\/|shorts\/)|youtu\.be\/)([\w-]{11})/i;
          const ytMatch2 = arg.match(YT_RE2) || message.content.match(YT_RE2);
          if (!ytMatch2) {
            await telegram.sendMessage(message.chatId, "Usage: /pipeline <youtube_url>");
            return true;
          }
          const liveVideoId = ytMatch2[1];
          const liveYoutubeUrl = `https://www.youtube.com/watch?v=${liveVideoId}`;

          try {
            await telegram.sendMessage(message.chatId,
              `VID RUSH PIPELINE -- ACTIVATED\nVideo: ${liveVideoId}\n\n` +
              `8-step autonomous pipeline launching.\nThis will take several minutes. Sit back, Architect.`
            );
          } catch { /* guaranteed plain text fallback above */ }

          // Session 26: Dual-brand pipeline — every URL fires BOTH brands sequentially.
          // Sovereign Synthesis first (niche rotation, personal brand), then TCF (dark psych perspective).
          // Use "ss only" or "ace only" or "tcf only" to force single-brand.
          const onlySS = /\b(?:ace|ss)\s*only\b/i.test(message.content);
          const onlyTcf = /\btcf\s*only\b/i.test(message.content);
          const brands: Array<"sovereign_synthesis" | "containment_field"> = onlyTcf
            ? ["containment_field"]
            : onlySS
            ? ["sovereign_synthesis"]
            : ["sovereign_synthesis", "containment_field"];

          // Session 40: Enqueue via pipeline queue — serializes concurrent requests
          const pipelineEnqueue = (globalThis as any).__enqueuePipeline;
          const pipelinePos = pipelineEnqueue ? pipelineEnqueue(`pipeline-${liveVideoId}-${brands.join("+")}`, async () => {
            for (let bIdx = 0; bIdx < brands.length; bIdx++) {
              const brand = brands[bIdx];
              const brandLabel = brand === "containment_field" ? "THE CONTAINMENT FIELD" : "SOVEREIGN SYNTHESIS";

              // Inter-brand cooldown: even with a dedicated TCF Groq key, other shared resources
              // (TTS, image gen, Supabase) need breathing room between 50-min pipeline runs.
              // PIPELINE_COOLDOWN_MS env var overrides. Default raised to 180s (was 90s —
              // 90s was insufficient even before the dual-key fix).
              if (bIdx > 0) {
                const cooldownMs = parseInt(process.env.PIPELINE_COOLDOWN_MS || "180000", 10);
                const cooldownSec = Math.round(cooldownMs / 1000);
                console.log(`⏳ [Pipeline] Inter-brand cooldown: ${cooldownSec}s...`);
                try {
                  await telegram.sendMessage(message.chatId,
                    `⏳ Cooling down ${cooldownSec}s before ${brandLabel} pipeline...`
                  );
                } catch { /* non-critical */ }
                await new Promise(r => setTimeout(r, cooldownMs));
              }

              try {
                await telegram.sendMessage(message.chatId,
                  `--- ${brandLabel} PIPELINE ---`
                );
              } catch { /* non-critical */ }

              // Use brand-dedicated LLM: TCF gets its own Groq key (GROQ_API_KEY_TCF) to avoid
              // rate limit contention after Sovereign Synthesis burns through the primary Groq quota.
              const activePipelineLLM = brand === "containment_field" ? tcfPipelineLLM : pipelineLLM;

              try {
                const result = await executeFullPipeline(
                  liveYoutubeUrl,
                  activePipelineLLM,
                  brand,
                  async (step: string, detail: string) => {
                    try {
                      await telegram.sendMessage(message.chatId, `[${brandLabel}] ${step}: ${detail}`);
                    } catch { /* non-critical */ }
                  }
                );

                const report = formatPipelineReport(result);
                try {
                  await telegram.sendMessage(message.chatId, `${brandLabel} COMPLETE:\n${report}`, { parseMode: "Markdown" });
                } catch {
                  await telegram.sendMessage(message.chatId, `${brandLabel} COMPLETE:\n${report.replace(/[*_`]/g, "")}`);
                }
              } catch (err: any) {
                console.error(`❌ [/pipeline] ${brandLabel} Pipeline CRASHED: ${err.message}\n${err.stack}`);
                try {
                  await telegram.sendMessage(message.chatId,
                    `${brandLabel} Pipeline FAILED: ${err.message?.slice(0, 500)}`
                  );
                } catch { /* nothing */ }
                // Continue to next brand even if one fails
              }
            }
          }) : 0;

          if (pipelinePos > 1) {
            try { await telegram.sendMessage(message.chatId, `⏳ Pipeline queued (position ${pipelinePos}). A pipeline is already running — yours will start automatically when it finishes.`); } catch { /* non-critical */ }
          }

          return true;
        } catch (err: any) {
          console.error(`❌ [/pipeline] OUTER CATCH: ${err.message}`);
          try {
            await telegram.sendMessage(message.chatId, `pipeline command error: ${err.message?.slice(0, 400)}`);
          } catch { /* truly nothing */ }
          return true;
        }
      }

      case "/alfred": {
        // Session 47c: Force-trigger Alfred's daily_trend_scan from Telegram, bypassing
        // the autonomousFiredDates gate and the 15:05 UTC time window. Use when:
        //   • Railway redeployed during the normal fire window and the cron was skipped
        //   • Architect wants to trigger today's video on demand from phone
        //   • Debugging the Native Seed Generator flow
        //
        // Optional brand modifiers (same keywords as /pipeline):
        //   /alfred              → dual-brand (ACE + TCF, default)
        //   /alfred ss only      → SOVEREIGN SYNTHESIS only
        //   /alfred tcf only     → THE CONTAINMENT FIELD only
        //
        // Brand hint is passed to the bridge via payload.brand_override — the auto-pipeline
        // trigger reads it and filters the autoBrands array before fanning out.
        const alfredOnlySS = /\b(?:ace|ss)\s*only\b/i.test(message.content);
        const alfredOnlyTcf = /\btcf\s*only\b/i.test(message.content);
        const alfredBrandOverride: "sovereign_synthesis" | "containment_field" | undefined =
          alfredOnlySS ? "sovereign_synthesis" : alfredOnlyTcf ? "containment_field" : undefined;
        const alfredMode = alfredBrandOverride === "sovereign_synthesis" ? "SOVEREIGN SYNTHESIS only"
          : alfredBrandOverride === "containment_field" ? "THE CONTAINMENT FIELD only"
          : "Dual-brand";

        console.log(`⚡ [/alfred] Manual override — force-triggering daily_trend_scan [${alfredMode}]`);
        try {
          // Reset the fired-dates gate so if the 15:05 window still hits later, it won't double-fire.
          // (autonomousFiredDates persists in-memory only — this flip is enough.)
          autonomousFiredDates.alfredScan = new Date().toDateString();

          await telegram.sendMessage(message.chatId,
            `⚡ *ALFRED OVERRIDE ACTIVATED*\n\nScanning for native seed...\n\n` +
            `Alfred is generating today's thesis directly from the Sovereign Synthesis framework. ` +
            `When he emits PIPELINE_IDEA, the bridge will fan out into *${alfredMode}* executeFullPipeline. ` +
            `Expect pipeline progress messages in ~1-2 minutes.`,
            { parseMode: "Markdown" }
          );

          const dispatchId = await dispatchTask({
            from_agent: "system",
            to_agent: "alfred",
            task_type: "daily_trend_scan",
            priority: 1,
            chat_id: message.chatId,
            payload: {
              // Phase 3 Task 3.5: live cooldown ledger injected at dispatch time.
              directive: await buildAlfredDailyScanDirective(),
              triggered_at: new Date().toISOString(),
              scan_type: "manual_override",
              trigger_source: "telegram_/alfred",
              triggered_by: message.userId || "architect",
              // Session 47d: brand_override is consumed by the auto-pipeline bridge at
              // dispatch-poller time to filter autoBrands. Undefined → default dual-brand.
              brand_override: alfredBrandOverride,
            },
          });

          console.log(`✅ [/alfred] Dispatched daily_trend_scan task id=${dispatchId} override=${alfredBrandOverride || "dual"}`);
        } catch (err: any) {
          console.error(`❌ [/alfred] Dispatch failed: ${err.message}`);
          try {
            await telegram.sendMessage(message.chatId,
              `⚠️ /alfred dispatch failed: ${err.message?.slice(0, 400)}`
            );
          } catch { /* nothing */ }
        }
        return true;
      }

      // ── Phase 7 Task 7.5a: BATCH PRODUCER ──
      // /batch           → 6 videos (3 SS + 3 TCF), full production + distribution
      // /batch ss        → 3 Sovereign Synthesis videos only
      // /batch tcf       → 3 TCF videos only
      // /batch dry       → Script generation only, no pod
      // /batch 2         → 2 videos per brand (4 total)
      // /batch ss 2 dry  → 2 SS videos, dry run
      case "/batch": {
        try {
          const { produceBatch } = await import("./engine/batch-producer");

          // Parse args: brand filter, count, dry flag
          const argLower = arg.toLowerCase();
          const isDry = argLower.includes("dry");
          const ssOnly = /\b(?:ace|ss)\b/.test(argLower);
          const tcfOnly = /\btcf\b/.test(argLower);
          const countMatch = argLower.match(/\b(\d+)\b/);
          const perBrand = countMatch ? Math.min(parseInt(countMatch[1], 10), 5) : 3;

          let brands: Array<"sovereign_synthesis" | "containment_field">;
          if (ssOnly) brands = ["sovereign_synthesis"];
          else if (tcfOnly) brands = ["containment_field"];
          else brands = ["sovereign_synthesis", "containment_field"];

          const total = brands.length * perBrand;
          await telegram.sendMessage(message.chatId,
            `🔥 BATCH PRODUCER — ${total} videos\n` +
            `Brands: ${brands.map(b => b === "sovereign_synthesis" ? "Sovereign Synthesis" : "TCF").join(" + ")}\n` +
            `Per brand: ${perBrand}\n` +
            `Mode: ${isDry ? "DRY RUN (scripts only)" : "LIVE (full production)"}\n` +
            `\nStarting...`
          );

          // Enqueue via pipeline queue — serializes with other pipeline runs
          const enqueue = (globalThis as any).__enqueuePipeline;
          if (enqueue) {
            enqueue(`batch-${brands.join("+")}-${perBrand}`, async () => {
              await produceBatch(pipelineLLM, {
                perBrand,
                brands,
                dryRun: isDry,
                onProgress: async (msg) => {
                  try { await telegram.sendMessage(message.chatId, msg); } catch { /* non-critical */ }
                },
              });
            });
          } else {
            // No pipeline queue available — run directly
            await produceBatch(pipelineLLM, {
              perBrand,
              brands,
              dryRun: isDry,
              onProgress: async (msg) => {
                try { await telegram.sendMessage(message.chatId, msg); } catch { /* non-critical */ }
              },
            });
          }
        } catch (err: any) {
          await telegram.sendMessage(message.chatId,
            `❌ /batch failed: ${err.message?.slice(0, 400)}`
          );
        }
        return true;
      }

      // SESSION 105: /produce — trigger Content Engine cycle (generate drafts + FLUX images + distribute)
      case "/produce": {
        try {
          // /produce force — bypass date check and regenerate today's drafts
          const forceMode = (arg || "").trim().toLowerCase() === "force";
          await telegram.sendMessage(message.chatId,
            `🔄 /produce — firing Content Engine cycle...${forceMode ? " (FORCE MODE)" : ""}`);
          const { dailyContentProduction, distributionSweep, fluxBatchImageGen } = await import("./engine/content-engine");

          // Step 1: Generate new drafts
          await telegram.sendMessage(message.chatId, "📝 Step 1/3: Generating content drafts...");
          const drafted = await dailyContentProduction(failoverLLM, forceMode);
          await telegram.sendMessage(message.chatId, `✅ Drafts: ${drafted} new posts generated`);

          // Step 2: FLUX batch images for any drafts with image_prompt but no media_url
          await telegram.sendMessage(message.chatId, "🎨 Step 2/3: FLUX batch image generation...");
          const imaged = await fluxBatchImageGen();
          await telegram.sendMessage(message.chatId, `✅ Images: ${imaged} media_urls patched`);

          // Step 3: Distribute ready posts to Buffer + Facebook
          await telegram.sendMessage(message.chatId, "📡 Step 3/3: Distribution sweep...");
          const swept = await distributionSweep();
          await telegram.sendMessage(message.chatId,
            `✅ /produce complete.\n\n` +
            `📝 Drafted: ${drafted}\n🎨 Imaged: ${imaged}\n📡 Distributed: ${swept}`
          );
        } catch (err: any) {
          console.error(`❌ [/produce] ${err.message}\n${err.stack}`);
          await telegram.sendMessage(message.chatId,
            `❌ /produce failed: ${err.message?.slice(0, 400)}`
          );
        }
        return true;
      }

      // SESSION 105: Deterministic /flux-batch — no LLM, no tools, no Gemini burn.
      case "/flux-batch": {
        try {
          await telegram.sendMessage(message.chatId, "🎨 Running FLUX pod batch...");
          const { fluxBatchImageGen } = await import("./engine/content-engine");
          const patched = await fluxBatchImageGen();
          await telegram.sendMessage(message.chatId,
            patched > 0
              ? `✅ FLUX batch complete — ${patched} videos generated with hook text.`
              : `⏸️ No pending images found (all queue entries already have media_url).`
          );
        } catch (err: any) {
          console.error(`❌ [/flux-batch] ${err.message}\n${err.stack}`);
          await telegram.sendMessage(message.chatId, `❌ /flux-batch failed: ${err.message?.slice(0, 400)}`);
        }
        return true;
      }

      // SESSION 92: Manual backlog drain — replaces automatic sweep + boot drainer.
      // Single-pass, zero-retry. Pre-flight rate limit check. Full Telegram reporting.
      case "/drain": {
        try {
          const { getDailyCallCount, isBufferQuotaExhausted, bufferGraphQL, getBufferChannels } = await import("./engine/buffer-graphql");
          const { distributionSweep } = await import("./engine/content-engine");

          // ── Pre-flight: Check if Buffer is actually accepting calls ──
          if (isBufferQuotaExhausted()) {
            await telegram.sendMessage(message.chatId,
              `⏸️ Buffer quota still exhausted. Daily call count: ${getDailyCallCount()}/250.\n` +
              `Wait for the cooldown to expire, then try /drain again.`
            );
            return true;
          }

          // Probe Buffer with a lightweight query (1 call) to verify it's actually live
          try {
            await bufferGraphQL(`query Probe { organizations(input: { ids: ["${(await import("./engine/buffer-graphql")).BUFFER_ORG_ID}"] }) { id } }`);
          } catch (probeErr: any) {
            if (probeErr.message?.includes("quota") || probeErr.message?.includes("429") || probeErr.message?.includes("RATE_LIMIT")) {
              await telegram.sendMessage(message.chatId,
                `⏸️ Buffer rate limit still active. Probe failed: ${probeErr.message?.slice(0, 200)}\n\nTry again later.`
              );
              return true;
            }
            // Non-rate-limit error — might still work, continue cautiously
            console.warn(`[/drain] Probe returned non-rate error: ${probeErr.message?.slice(0, 200)}`);
          }

          const budgetBefore = getDailyCallCount();
          await telegram.sendMessage(message.chatId,
            `🔄 /drain starting...\nDaily budget used: ${budgetBefore}/250\n\n` +
            `Mode: single-pass, zero retry. Will stop immediately if Buffer says no.`
          );

          // ── Phase 1: Distribute any ready ContentEngine drafts ──
          let cePosted = 0;
          try {
            cePosted = await distributionSweep();
          } catch (ceErr: any) {
            console.warn(`[/drain] CE sweep error: ${ceErr.message?.slice(0, 200)}`);
          }

          // ── Phase 2: Drain R2 backlog clips ──
          let backlogPosted = 0;
          if (!isBufferQuotaExhausted()) {
            try {
              const { drainBacklog } = await import("./engine/backlog-drainer");
              // drainBacklog is self-contained — it checks budget, lists R2, posts clips
              // If it hits the limit it stops cleanly
              await drainBacklog();
              // Count is approximate — drainBacklog logs to console
              backlogPosted = getDailyCallCount() - budgetBefore - cePosted;
            } catch (blErr: any) {
              console.warn(`[/drain] Backlog drain error: ${blErr.message?.slice(0, 200)}`);
            }
          }

          const budgetAfter = getDailyCallCount();
          await telegram.sendMessage(message.chatId,
            `✅ /drain complete.\n\n` +
            `ContentEngine drafts posted: ${cePosted}\n` +
            `Backlog API calls used: ~${Math.max(0, backlogPosted)}\n` +
            `Daily budget: ${budgetAfter}/250 calls used\n` +
            `Remaining: ${250 - budgetAfter} calls`
          );
        } catch (err: any) {
          await telegram.sendMessage(message.chatId,
            `❌ /drain failed: ${err.message?.slice(0, 400)}`
          );
        }
        return true;
      }

      // SESSION 94: Rechop pipeline — generate native vertical shorts from
      // existing R2 long-forms that never got shorts (23 videos identified).
      // /rechop             → list unchopped videos + summary
      // /rechop all         → batch process ALL unchopped long-forms
      // /rechop <idx>       → rechop a specific video by index from the list
      // /rechop --force ... → bypass quality gate (include pre-XTTS videos)
      case "/rechop": {
        try {
          const { listR2LongForms, rechopVideo, rechopAll, rechopBatch, unmarkRechopped } = await import("./engine/rechop-pipeline");
          const forceMode = arg?.includes("--force") ?? false;
          const cleanArg = (arg || "").replace("--force", "").trim();

          if (cleanArg === "all") {
            // Batch mode — process ALL unchopped videos
            await telegram.sendMessage(message.chatId,
              `🔄 /rechop all — scanning R2 for unchopped long-forms...${forceMode ? " (⚠️ FORCE MODE — quality gate OFF)" : ""}`
            );
            const unchopped = await listR2LongForms({ onlyUnchopped: true, force: forceMode });
            if (unchopped.length === 0) {
              await telegram.sendMessage(message.chatId, "✅ All long-forms already have shorts. Nothing to rechop.");
              return true;
            }

            await telegram.sendMessage(message.chatId,
              `🎬 Found ${unchopped.length} unchopped long-forms. Starting batch rechop...\n\n` +
              `This will spin up a pod per video. Expect ~15-25 min per video.\n` +
              `Total estimate: ${unchopped.length * 20} min.`
            );

            const results = await rechopAll(
              pipelineLLM,
              async (step, detail) => {
                // Rate-limit progress updates to avoid Telegram spam
                if (step.startsWith("STEP") || step === "BATCH" || step === "COMPLETE" || step === "DONE") {
                  try { await telegram.sendMessage(message.chatId, `[Rechop] ${step}: ${detail}`); } catch {}
                }
              },
            );

            const totalRendered = results.reduce((a, r) => a + r.shortsRendered, 0);
            const totalFailed = results.reduce((a, r) => a + r.shortsFailed, 0);
            const errorVideos = results.filter(r => r.errors.length > 0);

            let summary = `✅ RECHOP BATCH COMPLETE\n\n` +
              `Videos processed: ${results.length}\n` +
              `Shorts rendered: ${totalRendered}\n` +
              `Shorts failed: ${totalFailed}\n`;
            if (errorVideos.length > 0) {
              summary += `\nErrors (${errorVideos.length} videos):\n` +
                errorVideos.map(r => `  ${r.videoKey.split("/").pop()}: ${r.errors[0]}`).join("\n");
            }
            summary += `\n\nRun /drain to distribute the new shorts.`;

            await telegram.sendMessage(message.chatId, summary.slice(0, 4000));

          } else if (cleanArg && /^[\d,\s]+$/.test(cleanArg)) {
            // Single or multiple videos by index: /rechop 0 or /rechop 1,2,3
            // SESSION 101: --force bypasses dedup and clears rechop entries for retry.
            const indices = cleanArg.split(/[,\s]+/).map(Number).filter((n) => !isNaN(n));
            const allVideos = await listR2LongForms({ force: forceMode }); // full list, stable indices

            const invalid = indices.filter((i) => i < 0 || i >= allVideos.length);
            if (invalid.length > 0) {
              await telegram.sendMessage(message.chatId, `Invalid index(es): ${invalid.join(", ")}. Range: 0-${allVideos.length - 1}`);
              return true;
            }

            let validIndices: number[];
            if (forceMode) {
              // --force: bypass dedup, clear rechop entries so they re-run
              validIndices = indices;
              for (const idx of indices) {
                await unmarkRechopped(allVideos[idx].jobId);
              }
              await telegram.sendMessage(message.chatId,
                `🔓 Force mode: cleared rechop status for ${indices.length} video(s). Re-running...`
              );
            } else {
              const unchopped = await listR2LongForms({ onlyUnchopped: true, force: forceMode });
              const unchoppedJobIds = new Set(unchopped.map(v => v.jobId));
              const alreadyDone = indices.filter((i) => !unchoppedJobIds.has(allVideos[i].jobId));
              if (alreadyDone.length > 0) {
                await telegram.sendMessage(message.chatId,
                  `⚠️ Index(es) ${alreadyDone.join(", ")} already rechopped — skipping. Use \`--force\` to retry.`
                );
              }
              validIndices = indices.filter((i) => unchoppedJobIds.has(allVideos[i].jobId));
            }
            if (validIndices.length === 0) {
              await telegram.sendMessage(message.chatId, "All selected videos already rechopped. Use `--force` to retry.");
              return true;
            }

            const selected = validIndices.map((i) => allVideos[i]);
            await telegram.sendMessage(message.chatId,
              `🎬 Rechopping ${selected.length} video(s) in ONE pod session:\n` +
              selected.map((v, i) => `  [${validIndices[i]}] ${v.brand} — ${v.jobId.slice(0, 45)} (${(v.sizeBytes / 1024 / 1024).toFixed(0)}MB)`).join("\n") +
              `\n\n🔥 Single pod = 1 cold-start, not ${selected.length}.`
            );

            // rechopBatch and rechopVideo already imported above

            let results;
            if (selected.length === 1) {
              // Single video — use rechopVideo directly (simpler, same pod behavior)
              const video = selected[0];
              try {
                const result = await rechopVideo(
                  video,
                  video.brand === "containment_field" ? tcfPipelineLLM : pipelineLLM,
                  async (step, detail) => {
                    try { await telegram.sendMessage(message.chatId, `[Rechop] ${step}: ${detail}`); } catch {}
                  },
                );
                results = [result];
              } catch (err: any) {
                results = [{
                  videoKey: video.key, brand: video.brand,
                  shortsRendered: 0, shortsFailed: 0, clipKeys: [],
                  errors: [`Fatal: ${err.message?.slice(0, 200)}`],
                }];
              }
            } else {
              // Multi-video — use rechopBatch for single pod session
              results = await rechopBatch(
                selected,
                (brand) => brand === "containment_field" ? tcfPipelineLLM : pipelineLLM,
                async (step, detail) => {
                  if (step.startsWith("PREP") || step.startsWith("RENDER") || step === "COMPLETE") {
                    try { await telegram.sendMessage(message.chatId, `[Rechop] ${step}: ${detail}`); } catch {}
                  }
                },
              );
            }

            const totalRendered = results.reduce((a: number, r: any) => a + r.shortsRendered, 0);
            const totalFailed = results.reduce((a: number, r: any) => a + r.shortsFailed, 0);
            let msg = `✅ Rechop complete — ${selected.length} video(s)\n\n` +
              `Shorts rendered: ${totalRendered}\n` +
              `Shorts failed: ${totalFailed}`;
            const errResults = results.filter((r: any) => r.errors.length > 0);
            if (errResults.length > 0) {
              msg += `\n\nErrors:\n${errResults.map((r: any) => `  ${r.videoKey.split("/").pop()}: ${r.errors[0]}`).join("\n")}`;
            }
            msg += `\n\nRun /drain to distribute.`;
            await telegram.sendMessage(message.chatId, msg.slice(0, 4000));

          } else {
            // Default: list ALL videos with STABLE indices.
            // Rechopped videos show as "(done)" — indices never shift.
            // Quality gate filters out pre-XTTS videos unless --force.
            await telegram.sendMessage(message.chatId, "🔍 Scanning R2 for long-forms...");
            const allVideos = await listR2LongForms({ force: forceMode });
            const unchopped = await listR2LongForms({ onlyUnchopped: true, force: forceMode });
            const unchoppedJobIds = new Set(unchopped.map(v => v.jobId));

            if (unchopped.length === 0) {
              const gateMsg = forceMode ? "" : "\n\n(Pre-XTTS videos hidden by quality gate. Use /rechop --force to see all.)";
              await telegram.sendMessage(message.chatId, `✅ All eligible long-forms have shorts. Nothing to rechop.${gateMsg}`);
              return true;
            }

            // SESSION 116: rebuilt list output. Old format crammed the full
            // jobId UUID into each line, mixed brands chronologically, and ran
            // unreadable on phone Telegram. New layout: group by brand, show
            // open work first with done count summarized, last 8 chars of
            // jobId only, fixed-width index column. Indices still stable.
            type RechopRow = { idx: number; v: typeof allVideos[number]; done: boolean };
            const indexed: RechopRow[] = allVideos.map((v, idx) => ({
              idx, v, done: !unchoppedJobIds.has(v.jobId),
            }));
            const ssRows = indexed.filter(r => r.v.brand === "sovereign_synthesis");
            const cfRows = indexed.filter(r => r.v.brand === "containment_field");

            const formatRow = (r: RechopRow): string => {
              const date = r.v.lastModified ? r.v.lastModified.toISOString().slice(0, 10) : "????-??-??";
              const sizeMB = (r.v.sizeBytes / 1024 / 1024).toFixed(0).padStart(3, " ");
              const tag = r.done ? "✅" : "▢ ";
              const idTail = r.v.jobId.length > 8 ? `…${r.v.jobId.slice(-8)}` : r.v.jobId;
              const idxStr = `[${String(r.idx).padStart(2, " ")}]`;
              return `  ${tag} ${idxStr} ${date}  ${sizeMB}MB  ${idTail}`;
            };

            const VISIBLE_PER_SECTION = 20;
            const sectionFor = (label: string, emoji: string, rows: RechopRow[]): string => {
              if (rows.length === 0) return "";
              const open = rows.filter(r => !r.done);
              const done = rows.filter(r => r.done);
              const visibleOpen = open.slice(0, VISIBLE_PER_SECTION);
              const hiddenOpen = open.length - visibleOpen.length;
              const lines = visibleOpen.length
                ? visibleOpen.map(formatRow).join("\n")
                : "   (none unchopped)";
              const overflow = hiddenOpen > 0 ? `\n   …+ ${hiddenOpen} more unchopped (use /rechop all)` : "";
              const doneSummary = done.length ? `\n   + ${done.length} already rechopped` : "";
              return `\n${emoji} ${label}  (${open.length} open / ${rows.length} total)\n${lines}${overflow}${doneSummary}`;
            };

            const list = sectionFor("SOVEREIGN SYNTHESIS", "🔴", ssRows)
              + sectionFor("CONTAINMENT FIELD", "🟣", cfRows);

            const ssUnchopped = ssRows.filter(r => !r.done).length;
            const cfUnchopped = cfRows.filter(r => !r.done).length;
            const gateNote = forceMode ? "" : "\n⚠️ Quality gate ON. Add --force to include pre-XTTS videos.";
            const msg =
              `📦 RECHOP QUEUE — ${unchopped.length} need shorts (${allVideos.length} total)\n` +
              `🔴 SS ${ssUnchopped} open  •  🟣 TCF ${cfUnchopped} open${gateNote}\n` +
              list + "\n\n" +
              `Commands\n` +
              `  /rechop all     — process ALL ${unchopped.length} remaining\n` +
              `  /rechop <N>     — one video by index above\n` +
              `  /rechop 1,2,3   — multi-video, one pod session\n` +
              `Indices are stable across runs.`;

            // Split if too long for Telegram
            if (msg.length > 4000) {
              await telegram.sendMessage(message.chatId, msg.slice(0, 4000));
              if (msg.length > 4000) {
                await telegram.sendMessage(message.chatId, msg.slice(4000, 8000));
              }
            } else {
              await telegram.sendMessage(message.chatId, msg);
            }
          }
        } catch (err: any) {
          await telegram.sendMessage(message.chatId,
            `❌ /rechop failed: ${err.message?.slice(0, 400)}`
          );
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

      case "/buffer_audit": {
        try {
          await telegram.sendMessage(message.chatId, "BUFFER AUDIT — scanning channels and purging failed posts...");

          const { SocialSchedulerListProfilesTool } = await import("./tools/social-scheduler");
          const listTool = new SocialSchedulerListProfilesTool();
          const channelsRaw = await listTool.execute();
          let channels: any[];
          try { channels = JSON.parse(channelsRaw); } catch { channels = []; }

          if (!Array.isArray(channels) || channels.length === 0) {
            await telegram.sendMessage(message.chatId, "No Buffer channels found.");
            return true;
          }

          // Detect duplicates by service+name
          const serviceMap = new Map<string, any[]>();
          for (const ch of channels) {
            const key = `${ch.service}`;
            if (!serviceMap.has(key)) serviceMap.set(key, []);
            serviceMap.get(key)!.push(ch);
          }

          const dupeLines: string[] = [];
          for (const [service, chs] of serviceMap) {
            if (chs.length > 1) {
              dupeLines.push(`${service}: ${chs.map((c: any) => `"${c.name}" (${c.id})`).join(", ")}`);
            }
          }

          // Purge all queued posts via existing nukeBufferQueue
          const nukeReport = await nukeBufferQueue();

          const report =
            `BUFFER AUDIT COMPLETE\n\n` +
            `Total channels: ${channels.length}\n` +
            `${channels.map((c: any) => `  ${c.service}: ${c.name} ${c.isQueuePaused ? "(PAUSED)" : ""}`).join("\n")}\n\n` +
            `${dupeLines.length > 0 ? `DUPLICATE CHANNELS DETECTED:\n${dupeLines.join("\n")}\n\n` : "No duplicate channels.\n\n"}` +
            `CLEANUP:\n${nukeReport}`;

          try {
            await telegram.sendMessage(message.chatId, report);
          } catch {
            await telegram.sendMessage(message.chatId, report.slice(0, 4000));
          }
        } catch (err: any) {
          await telegram.sendMessage(message.chatId, `Buffer audit failed: ${err.message?.slice(0, 400)}`);
        }
        return true;
      }

      // SESSION 92: One-shot rescue — upload rendered R2 videos to YouTube
      // when distribution was interrupted by a redeploy or crash. Remove after use.
      case "/rescue": {
        try {
          await telegram.sendMessage(message.chatId,
            `🚨 RESCUE MODE — uploading orphaned containment_field videos from R2 to YouTube...`
          );

          const { YouTubeLongFormPublishTool } = await import("./tools/video-publisher");
          const ytTool = new YouTubeLongFormPublishTool();
          const { mkdirSync, writeFileSync, existsSync } = await import("fs");

          const rescueDir = "/tmp/rescue-tcf";
          if (!existsSync(rescueDir)) mkdirSync(rescueDir, { recursive: true });

          const R2_BASE = "https://pub-0ae5dfb3341f45418f0d28e0a2d89c41.r2.dev";

          const rescueVideos = [
            {
              jobId: "job_98c2ce0dec094269",
              title: "Your Anxiety Is Someone Else's Business Model",
              niche: "dark_psychology",
              scheduleOffset: 0, // 14:25 UTC
            },
            {
              jobId: "job_e9ce94adb2be4ea6",
              title: "Why High Performers Burn Out First",
              niche: "burnout",
              scheduleOffset: 3, // 17:25 UTC
            },
            {
              jobId: "job_85690f5316bd4ab2",
              title: "Why You Over-Explain Everything",
              niche: "dark_psychology",
              scheduleOffset: 6, // 20:25 UTC
            },
          ];

          // Schedule times: today at 14:25, 17:25, 20:25 UTC
          // If it's already past those times, schedule for tomorrow
          const now = new Date();
          const baseHour = 14;
          const baseMinute = 25;

          const results: string[] = [];

          for (const video of rescueVideos) {
            try {
              const videoUrl = `${R2_BASE}/videos/containment_field/${video.jobId}.mp4`;
              const thumbUrl = `${R2_BASE}/thumbs/containment_field/${video.jobId}.jpg`;

              // Download thumbnail to local disk (YouTube API needs local file or buffer)
              let thumbPath: string | null = null;
              try {
                const thumbResp = await fetch(thumbUrl);
                if (thumbResp.ok) {
                  const thumbBuf = Buffer.from(await thumbResp.arrayBuffer());
                  thumbPath = `${rescueDir}/${video.jobId}_thumb.jpg`;
                  writeFileSync(thumbPath, thumbBuf);
                  console.log(`🖼️ [Rescue] Downloaded thumbnail: ${thumbPath} (${(thumbBuf.length / 1024).toFixed(0)}KB)`);
                }
              } catch (thumbErr: any) {
                console.warn(`[Rescue] Thumbnail download failed for ${video.jobId}: ${thumbErr.message?.slice(0, 150)}`);
              }

              // Calculate scheduled publish time
              const scheduleDate = new Date(now);
              scheduleDate.setUTCHours(baseHour + video.scheduleOffset, baseMinute, 0, 0);
              // If that time has already passed today, push to tomorrow
              if (scheduleDate.getTime() <= now.getTime()) {
                scheduleDate.setUTCDate(scheduleDate.getUTCDate() + 1);
              }
              const scheduledAt = scheduleDate.toISOString();

              // Build description — emergency angle template (same as orchestrator fallback)
              const description =
                `${video.title}\n\n` +
                `The patterns running your behavior weren't installed by accident.\n\n` +
                `🧬 Take the Diagnostic: https://sovereign-synthesis.com/diagnostic\n\n` +
                `🔗 The Protocol: https://sovereign-synthesis.com\n\n` +
                `#thecontainmentfield #darkpsychology #${video.niche.replace(/_/g, "")} #mindcontrol #awakenedminds`;

              const tags = `dark psychology,manipulation,${video.niche.replace(/_/g, " ")},containment field,sovereign synthesis`;

              await telegram.sendMessage(message.chatId,
                `📤 Uploading: "${video.title}"\n` +
                `Scheduled: ${scheduledAt}\n` +
                `Thumbnail: ${thumbPath ? "✅" : "❌ skipped"}`
              );

              const result = await ytTool.execute({
                video_url: videoUrl,
                title: video.title,
                description,
                tags,
                niche: video.niche,
                brand: "containment_field",
                thumbnail_path: thumbPath,
                scheduled_publish_at: scheduledAt,
              });

              results.push(`✅ ${video.title}: ${result.slice(0, 300)}`);
              await telegram.sendMessage(message.chatId, `✅ "${video.title}" — ${result.slice(0, 400)}`);
            } catch (vidErr: any) {
              results.push(`❌ ${video.title}: ${vidErr.message?.slice(0, 200)}`);
              await telegram.sendMessage(message.chatId, `❌ "${video.title}" FAILED: ${vidErr.message?.slice(0, 400)}`);
            }
          }

          await telegram.sendMessage(message.chatId,
            `🚨 RESCUE COMPLETE\n\n${results.join("\n\n")}`
          );
        } catch (err: any) {
          await telegram.sendMessage(message.chatId, `❌ /rescue failed: ${err.message?.slice(0, 400)}`);
        }
        return true;
      }

      // SESSION 109/110: /comment <videoId|URL> [brand] — post diagnostic link comment on a YouTube video
      case "/comment": {
        try {
          const rawArg = args[0];
          if (!rawArg) {
            await telegram.sendMessage(message.chatId, "Usage: /comment <videoId or YouTube URL> [sovereign_synthesis|containment_field]");
            return true;
          }
          // Extract video ID from full URLs or raw IDs
          let videoId = rawArg;
          const urlMatch = rawArg.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
          if (urlMatch) {
            videoId = urlMatch[1];
          } else if (rawArg.length > 11 && rawArg.includes("&")) {
            // Strip URL parameters like &lc=... if someone pasted partial URL params
            videoId = rawArg.split("&")[0];
          }
          const brand = (args[1] as "sovereign_synthesis" | "containment_field") || "sovereign_synthesis";
          console.log(`[/comment] videoId="${videoId}" brand="${brand}" rawArg="${rawArg.slice(0, 80)}"`);
          await telegram.sendMessage(message.chatId, `📝 Posting diagnostic comment on ${videoId} (${brand})...`);
          const result = await postDiagnosticComment(videoId, brand);
          if (result.success) {
            await telegram.sendMessage(message.chatId,
              `✅ Comment posted!\nhttps://www.youtube.com/watch?v=${videoId}&lc=${result.commentId}`
            );
          } else {
            await telegram.sendMessage(message.chatId, `❌ Failed: ${result.error}`);
          }
        } catch (err: any) {
          await telegram.sendMessage(message.chatId, `❌ /comment error: ${err.message?.slice(0, 400)}`);
        }
        return true;
      }

      // SESSION 109: /approve <replyId> — send an Anita-drafted email reply
      case "/approve": {
        try {
          const replyId = arg.trim();
          if (!replyId) {
            await telegram.sendMessage(message.chatId, "Usage: /approve <reply_id>");
            return true;
          }
          const result = await sendApprovedReply(replyId);
          if (result.sent) {
            await telegram.sendMessage(message.chatId, `✅ Reply sent for ${replyId}`);
          } else {
            await telegram.sendMessage(message.chatId, `❌ Send failed: ${result.error}`);
          }
        } catch (err: any) {
          await telegram.sendMessage(message.chatId, `❌ /approve error: ${err.message?.slice(0, 400)}`);
        }
        return true;
      }

      // SESSION 109: /edit <replyId> <text> — send a custom reply instead of Anita's draft
      case "/edit": {
        try {
          const editReplyId = args[0];
          const customText = args.slice(1).join(" ");
          if (!editReplyId || !customText) {
            await telegram.sendMessage(message.chatId, "Usage: /edit <reply_id> <your custom reply text>");
            return true;
          }
          const result = await sendApprovedReply(editReplyId, customText);
          if (result.sent) {
            await telegram.sendMessage(message.chatId, `✅ Custom reply sent for ${editReplyId}`);
          } else {
            await telegram.sendMessage(message.chatId, `❌ Send failed: ${result.error}`);
          }
        } catch (err: any) {
          await telegram.sendMessage(message.chatId, `❌ /edit error: ${err.message?.slice(0, 400)}`);
        }
        return true;
      }

      default:
        // Unknown command — let agent loop handle it
        return false;
    }
  }

  // ── 7. Proactive Systems ──
  // Briefings use Veritas team (Anthropic-first) — strategic summaries, not pipeline grunt work.
  // Low volume (2x/day, ~500 tokens each) so Anthropic cost is negligible (~$0.36/month).
  const briefings = new ProactiveBriefings(AGENT_LLM_TEAMS.veritas, memoryProviders, telegram, defaultChatId);
  const heartbeat = new HeartbeatSystem(telegram, defaultChatId);

  // SESSION 104: PAUSE_AUTONOMOUS env var — set to "true" to freeze ALL scheduled agent work.
  // Briefings, agent dispatches, content engine, stasis checks — everything stops.
  // The bot still responds to Telegram commands. Only scheduled autonomous ops pause.
  // Toggle via Railway env vars without redeploying code.
  const isAutonomousPaused = () => process.env.PAUSE_AUTONOMOUS === "true";

  // In-memory guard to prevent briefings from firing every 60s during the matching hour
  const briefingFiredDates = { morning: "", evening: "" };

  // ── Sapphire PA channel reference (populated once Sapphire's bot inits below) ──
  // Three scheduled jobs (reminder poll, morning brief, evening wrap) need to send
  // DMs as Sapphire — they look up this ref at fire time. Null until Sapphire boots.
  // Reference type intentionally `any` to avoid forward-declaration headaches.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sapphirePARef: { channel: any | null } = { channel: null };
  const sapphirePAFiredDates = { morningBrief: "", eveningWrap: "" };

  // ── SAPPHIRE PA — Calendar 24h-ahead lookahead (every 6 hours) ──
  // Scans the next 48h of calendar events on both accounts and creates
  // 24h-ahead reminders so Ace never gets surprised by tomorrow's commitments.
  scheduler.add({
    name: "Sapphire PA — Calendar Lookahead (6h)",
    intervalMs: 6 * 60 * 60 * 1000,
    nextRun: new Date(Date.now() + 5 * 60 * 1000), // First run 5min after boot
    enabled: true,
    handler: async () => {
      try {
        const { runCalendarLookahead } = await import("./proactive/sapphire-watchers");
        await runCalendarLookahead();
      } catch (e: any) {
        console.error(`[SapphireWatch] Calendar lookahead scheduling error: ${e.message}`);
      }
    },
  });

  // ── SAPPHIRE PA — Email Triage Poll (every 30 min) ──
  // Checks for high-priority unread emails on both accounts and DMs Ace
  // when something matches the priority filter (school, invites, urgent, etc.).
  scheduler.add({
    name: "Sapphire PA — Email Triage (30m)",
    intervalMs: 30 * 60 * 1000,
    nextRun: new Date(Date.now() + 7 * 60 * 1000), // First run 7min after boot
    enabled: true,
    handler: async () => {
      if (!sapphirePARef.channel) return;
      try {
        const { runEmailTriagePoll } = await import("./proactive/sapphire-watchers");
        await runEmailTriagePoll(sapphirePARef.channel);
      } catch (e: any) {
        console.error(`[SapphireWatch] Email triage scheduling error: ${e.message}`);
      }
    },
  });

  // ── SAPPHIRE PA — Reminder poller (every 60s) ──
  // Polls public.sapphire_reminders for due reminders, fires DMs through Sapphire.
  // Persists across Railway redeploys (state is in Supabase, not memory).
  scheduler.add({
    name: "Sapphire PA — Reminder Poll (60s)",
    intervalMs: 60_000,
    nextRun: new Date(Date.now() + 90_000), // First run 90s after boot
    enabled: true,
    handler: async () => {
      if (!sapphirePARef.channel) return;
      try {
        const { runReminderPoll } = await import("./proactive/sapphire-pa-jobs");
        await runReminderPoll(sapphirePARef.channel);
      } catch (e: any) {
        console.error(`[SapphirePA] Reminder poll error: ${e.message}`);
      }
    },
  });

  // ── SAPPHIRE PA — Morning Brief (16:00 UTC = 11 AM CDT) ──
  scheduler.add({
    name: "Sapphire PA — Morning Brief (11 AM CDT)",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      if (!sapphirePARef.channel || !defaultChatId) return;
      const now = new Date();
      const dateKey = now.toDateString();
      // Fire at exactly 16:00 UTC ± 2 minutes, once per UTC date
      if (now.getUTCHours() === 16 && now.getUTCMinutes() <= 2 && sapphirePAFiredDates.morningBrief !== dateKey) {
        sapphirePAFiredDates.morningBrief = dateKey;
        console.log(`🌅 [SapphirePA] Morning brief firing for ${dateKey}`);
        try {
          const { runMorningBrief } = await import("./proactive/sapphire-pa-jobs");
          await runMorningBrief(sapphirePARef.channel, defaultChatId);
        } catch (e: any) {
          console.error(`[SapphirePA] Morning brief error: ${e.message}`);
        }
      }
    },
  });

  // ── SAPPHIRE PA — Evening Wrap (06:15 UTC = 1:15 AM CDT next day) ──
  // 15-min offset from the daily 06:00 UTC landing-analytics fetch so they don't collide.
  scheduler.add({
    name: "Sapphire PA — Evening Wrap (1:15 AM CDT)",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      if (!sapphirePARef.channel || !defaultChatId) return;
      const now = new Date();
      const dateKey = now.toDateString();
      if (now.getUTCHours() === 6 && now.getUTCMinutes() >= 15 && now.getUTCMinutes() <= 17 && sapphirePAFiredDates.eveningWrap !== dateKey) {
        sapphirePAFiredDates.eveningWrap = dateKey;
        console.log(`🌙 [SapphirePA] Evening wrap firing for ${dateKey}`);
        try {
          const { runEveningWrap } = await import("./proactive/sapphire-pa-jobs");
          await runEveningWrap(sapphirePARef.channel, defaultChatId);
        } catch (e: any) {
          console.error(`[SapphirePA] Evening wrap error: ${e.message}`);
        }
      }
    },
  });

  // Schedule morning briefing (10:00 AM CDT = 15:00 UTC — first thing, before any agent dispatches)
  scheduler.add({
    name: "Morning Briefing",
    intervalMs: 60_000, // Check every minute
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      const dateKey = now.toDateString();
      if (hour === config.scheduler.morningBriefingHour && minute >= 0 && minute <= 2 && briefingFiredDates.morning !== dateKey) {
        briefingFiredDates.morning = dateKey;
        console.log(`📋 Pulse 1: Morning briefing firing for ${dateKey}`);
        await briefings.morningBriefing();
      }
    },
  });

  // Schedule evening recap (8:00 PM CDT = 01:00 UTC)
  scheduler.add({
    name: "Evening Recap",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      const dateKey = now.toDateString();
      if (hour === config.scheduler.eveningRecapHour && minute >= 0 && minute <= 2 && briefingFiredDates.evening !== dateKey) {
        briefingFiredDates.evening = dateKey;
        console.log(`📋 Pulse 2: Evening recap firing for ${dateKey}`);
        await briefings.eveningRecap();
      }
    },
  });

  // ── Autonomous Business Ops — Scheduled Agent Jobs ──
  // These dispatch tasks to crew agents via crew_dispatch, picked up by the dispatch poller.
  // Each fires once per day at a specific hour using the same minute-check pattern as briefings.

  const autonomousFiredDates = { ytStatsFetch: "", vectorSweep: "", alfredScan: "", veritasDirective: "", ctaAudit: "", landingAnalytics: "", yukiHookDrops14: "", yukiHookDrops22: "", facelessProduce: "", bskyHookDrops14: "", bskyHookDrops22: "" };

  // YouTube Analytics — Daily Stats Fetch (9:00 AM CDT = 14:00 UTC — before Alfred trend scan)
  // Calls the fetch-youtube-stats Supabase Edge Function to pull real video stats from
  // YouTube Data API v3 for both channels (Sovereign Synthesis + The Containment Field), calculate
  // outlier scores, and upsert into youtube_analytics table. No auth required.
  scheduler.add({
    name: "YouTube Analytics — Daily Stats Fetch",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      const dateKey = now.toDateString();
      if (hour === 14 && minute >= 0 && minute <= 2 && autonomousFiredDates.ytStatsFetch !== dateKey) {
        autonomousFiredDates.ytStatsFetch = dateKey;
        console.log(`📊 [AutoOps] YouTube stats fetch firing for ${dateKey}`);
        try {
          const resp = await fetch("https://wzthxohtgojenukmdubz.supabase.co/functions/v1/fetch-youtube-stats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          const data: any = await resp.json();
          if (data.success) {
            const summary = (data.results || []).map((r: any) => `${r.channel}: ${r.videos_processed} videos`).join(", ");
            console.log(`✅ [AutoOps] YouTube stats fetched: ${summary}`);
            if (defaultChatId && telegram) {
              await telegram.sendMessage(defaultChatId, `📊 *YouTube Analytics Updated*\n${summary}\nFetched at: ${data.fetched_at}`, { parseMode: "Markdown" });
            }
          } else {
            console.error(`[AutoOps] YouTube stats fetch returned failure:`, data);
          }
        } catch (err: any) {
          console.error(`[AutoOps] YouTube stats fetch failed: ${err.message}`);
        }
      }
    },
  });

  // Vector — Daily CRO Metrics Sweep (12:00 PM CDT = 17:00 UTC — after VidRush pipeline clears)
  scheduler.add({
    name: "Vector Daily Metrics Sweep",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      const dateKey = now.toDateString();
      if (hour === 17 && minute >= 0 && minute <= 2 && autonomousFiredDates.vectorSweep !== dateKey) {
        // Session 47e: Durable dup-fire guard (same pattern as Alfred). Vector's window is
        // narrow (17:00–17:02 UTC), so the risk is lower than Alfred's widened window, but
        // a redeploy landing inside those 3 minutes would still duplicate-fire without this.
        const alreadyFired = await hasAlreadyFiredToday("vector", "daily_metrics_sweep");
        if (alreadyFired) {
          autonomousFiredDates.vectorSweep = dateKey;
          console.log(`📊 [AutoOps] Vector already fired today (per Supabase) — skipping redeploy duplicate`);
          return;
        }
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
                "1) Use stripe_metrics (dashboard) to pull MRR, active subs, failed payments, new customers, and velocity toward $100K/month. " +
                "2) Use buffer_analytics (overview) to pull content reach, impressions, clicks, engagement rate across all channels. " +
                "3) Use buffer_analytics (top_posts) to identify top 5 performing posts and what made them work. " +
                "4) Use buffer_analytics (channel_breakdown) to compare channel performance — which platforms drive reach vs clicks. " +
                "5) Cross-reference: revenue signals (Stripe) vs content signals (Buffer) — is content driving conversions? " +
                "6) Identify the #1 bottleneck and recommend one specific optimization. " +
                "Report findings to the Architect via Telegram. Keep it actionable — numbers, not narratives. " +
                "Do NOT dispatch tasks to other agents — report directly.",
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

  // Alfred — Daily Trend Scan & Content Brief (10:05 AM CDT = 15:05 UTC — 5min after briefing)
  scheduler.add({
    name: "Alfred Daily Trend Scan",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      const dateKey = now.toDateString();
      // Session 47c: widened fire window. Previous 15:05–15:07 UTC slot was too narrow —
      // a redeploy anywhere in the day would miss the day entirely. Now any minute from
      // 15:05 UTC onward fires once per date, so a container restart at 14:59 still catches it.
      const afterFireTime = hour > 15 || (hour === 15 && minute >= 5);
      if (afterFireTime && autonomousFiredDates.alfredScan !== dateKey) {
        // Session 47e: Durable dup-fire guard. autonomousFiredDates is in-memory and resets
        // on every container restart, so without this check a Railway redeploy after 15:05 UTC
        // would produce a duplicate daily_trend_scan and a duplicate pipeline run. Query the
        // persistent crew_dispatch table to see if alfred/daily_trend_scan already fired today.
        const alreadyFired = await hasAlreadyFiredToday("alfred", "daily_trend_scan");
        if (alreadyFired) {
          autonomousFiredDates.alfredScan = dateKey; // cache result to skip the query on subsequent ticks
          console.log(`🔍 [AutoOps] Alfred already fired today (per Supabase) — skipping redeploy duplicate`);
        } else {
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
                // SESSION 47b — NATIVE SEED GENERATOR PIVOT.
                // Alfred no longer scrapes YouTube. The machine projects the Sovereign frequency
                // outward from its own core. Alfred generates ONE original thesis per day from
                // the Sovereign Synthesis framework and hands it to VidRush as a raw_idea. This
                // severs the pipeline's dependency on external URL availability and removes the
                // yt-dlp / Whisper failure surface entirely.
                // Session 47c: directive text lives at module-level buildAlfredDailyScanDirective()
                // so /alfred force-trigger and the 15:05 UTC scheduler emit identical payloads.
                // Phase 3 Task 3.5: live cooldown ledger injected per-dispatch (async build).
                directive: await buildAlfredDailyScanDirective(),
                triggered_at: new Date().toISOString(),
                scan_type: "daily",
              },
            });
          } catch (err: any) {
            console.error(`[AutoOps] Alfred trend scan dispatch failed: ${err.message}`);
          }
        }
      }
    },
  });

  // Veritas — Weekly Strategic Directive (Monday 12:10 PM CDT = 17:10 UTC — 10min after Vector)
  scheduler.add({
    name: "Veritas Weekly Directive",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const dateKey = now.toDateString();
      if (now.getUTCDay() === 1 && now.getUTCHours() === 17 && now.getUTCMinutes() >= 10 && now.getUTCMinutes() <= 12 && autonomousFiredDates.veritasDirective !== dateKey) {
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

  // ── Faceless Factory — Daily Video Production (16:00 UTC, alternating brands) ──
  // S115d: makes the 30-video A/B/C performance test progress autonomously.
  // Each fire pulls Alfred's most-recent daily_trend_scan result as source intelligence,
  // selects ONE brand by day-of-month parity (even=SS, odd=TCF), and produces ONE faceless
  // video. The aesthetic LRU rotation in pickNextAesthetic naturally cycles A→B→C across the
  // 30-day run, filling the Mission Control Aesthetic Performance grid with real data.
  scheduler.add({
    name: "Faceless Factory Daily Production",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const dateKey = now.toDateString();
      const inWindow = hour === 16; // any minute in 16:00 UTC hour
      if (!inWindow || autonomousFiredDates.facelessProduce === dateKey) return;

      // Persistent dup-fire guard — check niche_cooldown for any row created today.
      // Without this, a Railway redeploy at 16:30 UTC would re-fire the daily slot.
      try {
        const todayStart = new Date(now);
        todayStart.setUTCHours(0, 0, 0, 0);
        const checkRes = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/niche_cooldown?created_at=gte.${todayStart.toISOString()}&select=id&limit=1`,
          { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
        );
        const existing = await checkRes.json() as any[];
        if (Array.isArray(existing) && existing.length > 0) {
          autonomousFiredDates.facelessProduce = dateKey;
          console.log(`🎬 [FacelessAutonomy] Already fired today (niche_cooldown row exists) — skipping`);
          return;
        }
      } catch (err: any) {
        console.warn(`[FacelessAutonomy] Dup-fire guard query failed (continuing): ${err.message}`);
      }

      autonomousFiredDates.facelessProduce = dateKey;

      // Brand selection: even day-of-month → SS, odd → TCF
      const dayOfMonth = now.getUTCDate();
      const brand: "sovereign_synthesis" | "containment_field" =
        dayOfMonth % 2 === 0 ? "sovereign_synthesis" : "containment_field";

      // Pull Alfred's latest daily_trend_scan result for source intelligence
      let sourceIntel = "";
      const niche = brand === "sovereign_synthesis" ? "sovereignty" : "dark-psychology";
      try {
        const alfredRes = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/crew_dispatch?to_agent=eq.alfred&task_type=eq.daily_trend_scan&status=eq.completed&order=completed_at.desc&limit=1&select=result`,
          { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
        );
        const alfredRows = await alfredRes.json() as any[];
        if (alfredRows[0]?.result) {
          sourceIntel = String(alfredRows[0].result);
        }
      } catch (err: any) {
        console.warn(`[FacelessAutonomy] Could not fetch Alfred seed: ${err.message}`);
      }

      // Fallback: synthetic seed from brand + niche if Alfred unavailable
      if (!sourceIntel || sourceIntel.length < 200) {
        sourceIntel = `Generate a ${niche} thesis seed for ${brand}. Focus on the architecture of liberation from simulated systems. 90-second long-form. Single core insight, three reinforcing examples, one call to sovereignty.`;
      }

      console.log(`🎬 [FacelessAutonomy] Daily fire — brand=${brand} niche=${niche} (${dateKey})`);

      try {
        const { produceFacelessBatch } = await import("./engine/faceless-factory");
        const results = await produceFacelessBatch(pipelineLLM, sourceIntel.slice(0, 3000), niche, [brand]);
        console.log(`✅ [FacelessAutonomy] Produced ${results.length} videos for ${brand}`);
      } catch (err: any) {
        console.error(`❌ [FacelessAutonomy] Production failed: ${err.message}`);
      }
    },
  });

  console.log("⚡ [AutoOps] Scheduled: YT stats fetch (9:00AM CDT/14:00UTC), Alfred trend scan (10:05AM CDT/15:05UTC), Vector daily sweep (12:00PM CDT/17:00UTC), Veritas weekly directive (Mon 12:10PM CDT/17:10UTC), Faceless production (16:00UTC, alternating brands)");

  // ── Deterministic Content Engine — Daily Production + Distribution ──
  // Master ref Section 23. Posting guide: SOVEREIGN-POSTING-GUIDE.md
  // LLM writes content, code handles the spray. No LLM decision-making in distribution.

  const contentEngineFiredDate = { production: "" };

  // SESSION 89: Pre-warm shared channel cache at boot (1 API call, shared by all consumers)
  warmChannelCache();

  // SESSION 105: Backlog drainer — fixed daily at 20:00 UTC (3:00 PM CDT).
  // Was boot-relative (fired every deploy, burned Buffer quota). Now once/day on a clock.
  // Manual /drain still works for immediate triggers.
  const drainFiredDate = { key: "" };
  scheduler.add({
    name: "Backlog Drainer — Daily 20:00 UTC",
    intervalMs: 60_000, // check every minute
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      const dateKey = now.toDateString();
      // Fire at 20:00 UTC — 1.5h after ContentEngine production (18:30), giving drafts time to generate
      if (hour === 20 && minute >= 0 && minute <= 4 && drainFiredDate.key !== dateKey) {
        drainFiredDate.key = dateKey;
        console.log("🔄 [AutoDrain] Daily backlog drain firing (20:00 UTC)...");
        try {
          await drainBacklog();
        } catch (err: any) {
          console.error(`[AutoDrain] Fatal: ${err.message?.slice(0, 300)}`);
        }
      }
    },
  });

  // Daily Content Production (1:30 PM CDT = 18:30 UTC — after Vector sweep + Veritas clear)
  scheduler.add({
    name: "Content Engine — Daily Production",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      const dateKey = now.toDateString();

      // Fire at 18:30 UTC (1:30 PM CDT) — after Vector sweep and Veritas weekly have cleared
      if (hour === 18 && minute >= 28 && minute <= 32 && contentEngineFiredDate.production !== dateKey) {
        contentEngineFiredDate.production = dateKey;
        console.log(`🚀 [ContentEngine] Daily production firing for ${dateKey}`);
        try {
          // Session 34: ContentEngine uses Anita's team (now Anthropic-first).
          // Agents switched to Anthropic-first in Session 34 to stop Groq quota exhaustion.
          // ContentEngine generates 12 posts/day — ~18K tokens total, costs ~$0.05/day on Anthropic.
          const count = await dailyContentProduction(AGENT_LLM_TEAMS.anita);
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

  // SESSION 105: Distribution sweep — fixed 2x daily at 12:00 UTC + 19:00 UTC.
  // Was boot-relative (fired every deploy). Now clock-based: morning sweep (12:00 UTC / 7AM CDT)
  // catches overnight drafts, evening sweep (19:00 UTC / 2PM CDT) catches daily production output.
  // Capped at 6 drafts/sweep × ~5 channels = ~30 API calls/sweep. 2 sweeps/day = ~60 max.
  const sweepFiredSlots = { morning: "", evening: "" };
  scheduler.add({
    name: "Content Engine — Distribution Sweep (2x daily)",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      const dateKey = now.toDateString();

      let shouldFire = false;
      if (hour === 12 && minute >= 0 && minute <= 4 && sweepFiredSlots.morning !== dateKey) {
        sweepFiredSlots.morning = dateKey;
        shouldFire = true;
      } else if (hour === 19 && minute >= 0 && minute <= 4 && sweepFiredSlots.evening !== dateKey) {
        sweepFiredSlots.evening = dateKey;
        shouldFire = true;
      }

      if (shouldFire) {
        try {
          const posted = await distributionSweep();
          if (posted > 0) {
            console.log(`📤 [ContentEngine] Distribution sweep posted ${posted} piece(s)`);
          }
        } catch (err: any) {
          console.error(`[ContentEngine] Distribution sweep failed: ${err.message}`);
        }
      }
    },
  });

  console.log("⚡ [ContentEngine] Scheduled: Production 18:30 UTC, Sweep 12:00+19:00 UTC, Drain 20:00 UTC.");

  // SESSION 104: Draft Auto-Publisher — promotes agent content_drafts to distribution queue.
  // Runs every 4h. Picks up social-type drafts (caption, social_post, post, tweet, hook)
  // with pending_review status older than 2h and inserts them into content_engine_queue.
  // Non-social drafts (email, blog, landing_page) are left for manual review.
  scheduler.add({
    name: "Draft Auto-Publisher (4h)",
    intervalMs: 4 * 60 * 60 * 1000, // 4 hours
    nextRun: new Date(Date.now() + 10 * 60 * 1000), // First run 10 min after boot
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      try {
        const promoted = await draftAutoPublisher();
        if (promoted > 0) {
          console.log(`📤 [DraftPublisher] Auto-promoted ${promoted} draft(s) to distribution queue`);
        }
      } catch (err: any) {
        console.error(`[DraftPublisher] Auto-publish sweep failed: ${err.message}`);
      }
    },
  });

  // SESSION 104: FLUX Pod Batch — generate images for Content Engine queue entries.
  // SESSION 115 (2026-04-24): Cadence 3d → 1d. Content Engine generates 24/day
  // (12 per brand), FLUX caps at 50/run. At 3-day cadence, 72 needed but only 50
  // processed = 22-row backlog grows every cycle. Distribution sweep marks the
  // image-missing rows as "partial" and they loop forever. Daily cadence keeps
  // the queue clean (24 generated, 24 processed, zero overflow).
  scheduler.add({
    name: "FLUX Pod Batch Image Gen (daily)",
    intervalMs: 24 * 60 * 60 * 1000, // 1 day
    nextRun: new Date(Date.now() + 30 * 60 * 1000), // First run 30 min after boot
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      try {
        const patched = await fluxBatchImageGen();
        if (patched > 0) {
          console.log(`🎨 [FluxBatch] Patched ${patched} queue entries with FLUX images`);
        }
      } catch (err: any) {
        console.error(`[FluxBatch] Batch image generation failed: ${err.message}`);
      }
    },
  });

  // ── CTA Audit — Weekly Monday 10:00 AM CDT = 15:00 UTC (after YT stats fetch at 14:00) ──
  // Scans top-performing videos for missing sovereign-landing CTAs.
  // Writes proposals to cta_audit_proposals, DMs Architect on Telegram.
  scheduler.add({
    name: "YouTube CTA Audit — Weekly Monday",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      const dateKey = now.toDateString();
      if (now.getUTCDay() === 1 && hour === 15 && minute >= 0 && minute <= 2 && autonomousFiredDates.ctaAudit !== dateKey) {
        autonomousFiredDates.ctaAudit = dateKey;
        console.log(`📋 [AutoOps] CTA audit firing for ${dateKey}`);
        try {
          const ctaTool = new YouTubeCTAAuditTool();
          const result = await ctaTool.execute({ brand: "sovereign_synthesis", top_n: "5" });
          console.log(`✅ [AutoOps] CTA audit complete: ${result.slice(0, 200)}`);
        } catch (err: any) {
          console.error(`[AutoOps] CTA audit failed: ${err.message}`);
        }
      }
    },
  });

  console.log("📋 [CTAAudit] Scheduled: Weekly Monday 10:00AM CDT / 15:00 UTC");

  // ── Landing Analytics — Daily 1:00 AM CDT = 06:00 UTC ──
  // Calls fetch-landing-analytics Edge Function for Vercel Web Analytics.
  // Requires VERCEL_API_TOKEN + VERCEL_PROJECT_ID as Supabase Edge Function secrets.
  scheduler.add({
    name: "Landing Analytics — Daily Fetch",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      const dateKey = now.toDateString();
      if (hour === 6 && minute >= 0 && minute <= 2 && autonomousFiredDates.landingAnalytics !== dateKey) {
        autonomousFiredDates.landingAnalytics = dateKey;
        console.log(`🌐 [AutoOps] Landing analytics fetch firing for ${dateKey}`);
        try {
          const resp = await fetch("https://wzthxohtgojenukmdubz.supabase.co/functions/v1/fetch-landing-analytics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          const data: any = await resp.json();
          if (data.status === "ok") {
            console.log(`✅ [AutoOps] Landing analytics: ${data.rows_written} rows written`);
            if (defaultChatId && telegram) {
              await telegram.sendMessage(defaultChatId,
                `🌐 *Landing Analytics Updated*\nPage views (24h): ${data.sample?.page_views || 0}\nVisitors: ${data.sample?.visitors || 0}\nRows: ${data.rows_written}`,
                { parseMode: "Markdown" });
            }
          } else {
            console.error(`[AutoOps] Landing analytics returned error:`, data);
          }
        } catch (err: any) {
          console.error(`[AutoOps] Landing analytics fetch failed: ${err.message}`);
        }
      }
    },
  });

  console.log("🌐 [LandingAnalytics] Scheduled: Daily 1:00AM CDT / 06:00 UTC");

  // ── YouTube Comment Alert Layer — poll both channels every 5 min ──
  // Session 58 (2026-04-14). Response to the @noemicsafordi signal that waited
  // 2 days because no monitoring layer existed. See
  // src/proactive/youtube-comment-watcher.ts and memory/project_first_audience_signal.md.
  scheduler.add({
    name: "YouTube Comment Alert Poll",
    intervalMs: 5 * 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (!defaultChatId || !telegram) return;
      try {
        // S117: route comment alerts to Yuki's DM (she owns social presence).
        // agentLoops is populated during multi-bot init (later in this file);
        // by the time the cron fires (5 min after boot at earliest), Yuki's
        // channel is wired. Falls back to primary `telegram` if not.
        const yukiChannel = agentLoops.get("yuki")?.channel;
        await pollYouTubeComments(telegram, defaultChatId, { alertChannel: yukiChannel });
      } catch (err: any) {
        console.error(`[YTCommentWatcher] poll failed: ${err.message}`);
      }
    },
  });

  console.log("🟡 [YTCommentWatcher] Scheduled: every 5min, alerts → Yuki (S117)");

  // ── Anita Weekly Newsletter — Sunday 14:00 UTC (9 AM CDT) ───────────────
  // S117 (2026-04-25). Per Ace: Anita gets autonomy (no per-email approval)
  // capped at 3 emails/week. Weekly newsletter compounds prior ideas via
  // semantic memory in `content` Pinecone namespace + the newsletter_ideas
  // graph in Supabase. See src/proactive/anita-newsletter.ts.
  const newsletterFiredKeys: Set<string> = new Set();
  scheduler.add({
    name: "Anita Weekly Newsletter",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      // Sunday = 0, target hour 14:00 UTC
      if (now.getUTCDay() !== 0 || now.getUTCHours() !== 14) return;
      const fireKey = `newsletter-${now.toISOString().slice(0, 10)}`;
      if (newsletterFiredKeys.has(fireKey)) return;
      newsletterFiredKeys.add(fireKey);
      try {
        const anitaChannel = agentLoops.get("anita")?.channel;
        const result = await runWeeklyNewsletterCycle({
          alertChannel: anitaChannel || telegram,
          alertChatId: defaultChatId,
          dryRun: false,
        });
        console.log(`[AnitaNewsletter] Cycle ended: ${result.status} — ${result.details}`);
      } catch (err: any) {
        console.error(`[AnitaNewsletter] Cycle failed: ${err.message}`);
      }
    },
  });

  console.log("📧 [AnitaNewsletter] Scheduled: Sunday 14:00 UTC weekly (S117)");

  // ── Milestone Sync — every 6h, offset 30 min from YT stats fetcher ────
  // S117 (2026-04-25). Patches channel_milestones.current_value from live
  // data sources (YT Data API for subs, youtube_analytics for watch_hours
  // + video views, initiates for cross-traffic leads). Auto-flips status
  // to 'achieved' and activates next sub-milestone when target reached.
  // First run 4 min after boot so the YT stats fetcher gets a head start.
  scheduler.add({
    name: "Milestone Sync",
    intervalMs: 6 * 60 * 60_000,
    nextRun: new Date(Date.now() + 4 * 60_000),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      try {
        const vectorChannel = agentLoops.get("vector")?.channel;
        await runMilestoneSync({
          alertChannel: vectorChannel || telegram,
          alertChatId: defaultChatId,
        });
      } catch (err: any) {
        console.error(`[MilestoneSync] sweep failed: ${err.message}`);
      }
    },
  });

  console.log("🎯 [MilestoneSync] Scheduled: every 6h (S117) — patches channel_milestones live");

  // ── Yuki Shorts Pinner — auto-post diagnostic comment on every new Short ──
  // S117 (2026-04-25). Closes the engagement gap on Shorts: the comment
  // watcher only sees REPLIES to existing comments, not new uploads. This
  // cron polls search.list?order=date for both channels every 5 min, filters
  // to videos ≤ 60s (Shorts), and posts a Yuki-generated diagnostic comment
  // as the channel owner via commentThreads.insert. Dedup via Supabase
  // yuki_short_comments_posted. See src/proactive/yuki-shorts-pinner.ts.
  scheduler.add({
    name: "Yuki Shorts Pinner",
    intervalMs: 30 * 60_000,  // S117e: 5min -> 30min so YT API quota stays manageable
    nextRun: new Date(Date.now() + 60_000), // offset 1 min from comment poll to spread load
    enabled: true,
    handler: async () => {
      try {
        await pollNewShortsForPinnedComment();
      } catch (err: any) {
        console.error(`[YukiShorts] poll failed: ${err.message}`);
      }
    },
  });

  console.log("🟣 [YukiShorts] Scheduled: every 5min, auto-pin diagnostic on new Shorts");

  // ── Yuki Hook Dropper — twice/day outbound consciousness hooks on subscribed channels ──
  // Session 115 (2026-04-24). Drops a single-sentence brand-voiced reframe on
  // the freshest upload of the highest-leverage channels Ace's two channels
  // are subscribed to. Hard cap 5 drops per brand per run. See
  // src/proactive/yuki-hook-dropper.ts.
  scheduler.add({
    name: "Yuki Hook Drops — 14:00 UTC / 9:00 AM CDT",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      const dateKey = now.toDateString();
      if (hour === 14 && minute >= 0 && minute <= 2 && autonomousFiredDates.yukiHookDrops14 !== dateKey) {
        autonomousFiredDates.yukiHookDrops14 = dateKey;
        console.log(`🟡 [YukiHookDropper] morning run firing for ${dateKey}`);
        try {
          const ss = await runHookDrops("sovereign_synthesis");
          const cf = await runHookDrops("containment_field");
          if (defaultChatId && telegram) {
            await telegram.sendMessage(defaultChatId,
              `🟡 *Yuki Hook Drops — 9 AM CDT*\n\n` +
              `*Sovereign Synthesis:* ${ss.posted} posted (${ss.attempted} attempted, ${ss.errors} errors)\n` +
              `*Containment Field:* ${cf.posted} posted (${cf.attempted} attempted, ${cf.errors} errors)`,
              { parseMode: "Markdown" });
          }
        } catch (err: any) {
          console.error(`[YukiHookDropper] morning run failed: ${err.message}`);
        }
      }
    },
  });

  scheduler.add({
    name: "Yuki Hook Drops — 22:00 UTC / 5:00 PM CDT",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      const dateKey = now.toDateString();
      if (hour === 22 && minute >= 0 && minute <= 2 && autonomousFiredDates.yukiHookDrops22 !== dateKey) {
        autonomousFiredDates.yukiHookDrops22 = dateKey;
        console.log(`🟡 [YukiHookDropper] evening run firing for ${dateKey}`);
        try {
          const ss = await runHookDrops("sovereign_synthesis");
          const cf = await runHookDrops("containment_field");
          if (defaultChatId && telegram) {
            await telegram.sendMessage(defaultChatId,
              `🟡 *Yuki Hook Drops — 5 PM CDT*\n\n` +
              `*Sovereign Synthesis:* ${ss.posted} posted (${ss.attempted} attempted, ${ss.errors} errors)\n` +
              `*Containment Field:* ${cf.posted} posted (${cf.attempted} attempted, ${cf.errors} errors)`,
              { parseMode: "Markdown" });
          }
        } catch (err: any) {
          console.error(`[YukiHookDropper] evening run failed: ${err.message}`);
        }
      }
    },
  });

  console.log("🟡 [YukiHookDropper] Scheduled: 14:00 UTC + 22:00 UTC (9 AM + 5 PM CDT) across both YT channels");

  // ── Yuki Bluesky Reply Watcher — 5min poll, mirrors YouTube cadence ──
  // Session 115 (2026-04-25). Polls notifications via AT Protocol,
  // dedupes against bluesky_replies_seen, drafts plain-Ace voice via
  // Gemini Flash, posts via createRecord.
  scheduler.add({
    name: "Yuki Bluesky Reply Poll",
    intervalMs: 5 * 60_000,
    nextRun: new Date(Date.now() + 60_000), // first run 60s after boot
    enabled: true,
    handler: async () => {
      try {
        await pollBlueskyReplies();
      } catch (err: any) {
        console.error(`[YukiBskyReplier] poll failed: ${err.message}`);
      }
    },
  });

  console.log("🦋 [YukiBskyReplier] Scheduled: every 5min (Bluesky AT Protocol)");

  // ── Yuki Bluesky Hook Dropper — twice/day, offset 30min from YouTube ──
  // 14:30 UTC (9:30 AM CDT) and 22:30 UTC (5:30 PM CDT) so logging /
  // outbound API load is staggered from the YouTube hook drops at :00.
  scheduler.add({
    name: "Yuki Bluesky Hook Drops — 14:30 UTC",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      const dateKey = now.toDateString();
      if (hour === 14 && minute >= 30 && minute <= 32 && autonomousFiredDates.bskyHookDrops14 !== dateKey) {
        autonomousFiredDates.bskyHookDrops14 = dateKey;
        console.log(`🦋 [YukiBskyHookDropper] morning run firing for ${dateKey}`);
        try {
          const ss = await runBlueskyHookDrops("sovereign_synthesis");
          const cf = await runBlueskyHookDrops("containment_field");
          if (defaultChatId && telegram) {
            await telegram.sendMessage(defaultChatId,
              `🦋 *Yuki Bluesky Hook Drops — 9:30 AM CDT*\n\n` +
              `*Sovereign Synthesis:* ${ss.posted} posted (${ss.attempted} attempted, ${ss.skipped} skipped, ${ss.errors} errors)\n` +
              `*Containment Field:* ${cf.posted} posted (${cf.attempted} attempted, ${cf.skipped} skipped, ${cf.errors} errors)`,
              { parseMode: "Markdown" });
          }
        } catch (err: any) {
          console.error(`[YukiBskyHookDropper] morning run failed: ${err.message}`);
        }
      }
    },
  });

  scheduler.add({
    name: "Yuki Bluesky Hook Drops — 22:30 UTC",
    intervalMs: 60_000,
    nextRun: new Date(),
    enabled: true,
    handler: async () => {
      if (isAutonomousPaused()) return;
      const now = new Date();
      const hour = now.getUTCHours();
      const minute = now.getUTCMinutes();
      const dateKey = now.toDateString();
      if (hour === 22 && minute >= 30 && minute <= 32 && autonomousFiredDates.bskyHookDrops22 !== dateKey) {
        autonomousFiredDates.bskyHookDrops22 = dateKey;
        console.log(`🦋 [YukiBskyHookDropper] evening run firing for ${dateKey}`);
        try {
          const ss = await runBlueskyHookDrops("sovereign_synthesis");
          const cf = await runBlueskyHookDrops("containment_field");
          if (defaultChatId && telegram) {
            await telegram.sendMessage(defaultChatId,
              `🦋 *Yuki Bluesky Hook Drops — 5:30 PM CDT*\n\n` +
              `*Sovereign Synthesis:* ${ss.posted} posted (${ss.attempted} attempted, ${ss.skipped} skipped, ${ss.errors} errors)\n` +
              `*Containment Field:* ${cf.posted} posted (${cf.attempted} attempted, ${cf.skipped} skipped, ${cf.errors} errors)`,
              { parseMode: "Markdown" });
          }
        } catch (err: any) {
          console.error(`[YukiBskyHookDropper] evening run failed: ${err.message}`);
        }
      }
    },
  });

  console.log("🦋 [YukiBskyHookDropper] Scheduled: 14:30 + 22:30 UTC (9:30 AM + 5:30 PM CDT)");

  // ── YouTube Analytics Stats — Fix B for the 30-Video A/B/C Test ──
  // S114 (2026-04-24). Existing fetch-youtube-stats edge function populates
  // views/likes/comments via Data API v3 + API key. CTR + retention need
  // YouTube Analytics API v2 + OAuth, which the bot has (via the same refresh
  // tokens used by the comment watcher). This task PATCHes ctr/retention/
  // impressions onto existing youtube_analytics rows. 6h cadence — Analytics
  // has ~24-48h reporting lag, polling more often is wasteful. See
  // src/proactive/youtube-stats-fetcher.ts.
  scheduler.add({
    name: "YouTube Analytics Stats Fetch",
    intervalMs: 6 * 60 * 60_000,
    nextRun: new Date(Date.now() + 60_000), // first run 1 min after boot
    enabled: true,
    handler: async () => {
      try {
        await pollYouTubeStats();
      } catch (err: any) {
        console.error(`[YTStatsFetcher] poll failed: ${err.message}`);
      }
    },
  });

  console.log("🟡 [YTStatsFetcher] Scheduled: every 6h, both YT channels via OAuth");

  // ── Stasis Detection — DISABLED Session 108 ──
  // Was dispatching stasis_self_check to ALL 6 agents daily = 6 API calls/day.
  // Every single response was "NOMINAL" — zero actionable output.
  // That's ~42 wasted API calls/week for nothing. KILLED.
  // If needed again, re-enable with `enabled: true` below.
  // const stasisFiredDate = { value: "" };
  // const stasisAgents = ["vector", "yuki", "alfred", "anita", "sapphire", "veritas"];

  // scheduler.add({
  //   name: "Daily Stasis Detection Sweep",
  //   intervalMs: 60_000,
  //   nextRun: new Date(),
  //   enabled: false,
  //   handler: async () => { /* DISABLED — see comment above */ },
  // });

  console.log("🔍 [StasisCheck] DISABLED (S108) — was 6 wasted API calls/day with zero value");

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
  // Sapphire uses her own team (Anthropic-first) — strategic observations, low volume (12x/day max).
  const sapphireSentinel = new SapphireSentinel(AGENT_LLM_TEAMS.sapphire, telegram, defaultChatId);
  sapphireSentinel.start();

  // ── 8. Webhook Server ──
  const webhookServer = new WebhookServer();

  // ── /api/sapphire/memory-audit ── (S114u)
  // Returns vector counts per namespace + sample matches against the namespaces
  // Sapphire reads from. Use to verify if seed memory (pool hall, egregore,
  // war with reality) is actually in Pinecone and which namespace.
  webhookServer.register("/api/sapphire/memory-audit", async (incoming: any) => {
    try {
      const { auditSapphireMemory } = await import("./tools/sapphire/_pinecone");
      const query = (incoming?.query && String(incoming.query)) || "Ace background life mission family pool hall egregore war reality";
      const result = await auditSapphireMemory(query);
      return JSON.stringify(result, null, 2);
    } catch (err: any) {
      return JSON.stringify({ error: err.message });
    }
  });

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
    const text = payload?.text || "";
    // SESSION 35: Guard against empty notifications — something was hitting this endpoint
    // with no payload at 00:30 UTC, producing "🔔 NOTIFICATION" with no content.
    if (!text || text === "{}" || text.trim().length === 0) {
      console.warn(`⚠️ [Notify] Empty notification payload received — suppressed. Raw: ${JSON.stringify(payload).slice(0, 200)}`);
      return "suppressed:empty";
    }
    await telegram.sendMessage(defaultChatId, `🔔 *NOTIFICATION*\n${text}`, { parseMode: "Markdown" });
    return "delivered";
  });

  // ── /api/release — Agent payloads ingest (external tools) ──
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
      // Manual trigger uses same Anita team as scheduled — Anthropic-first (Session 34).
      const count = await dailyContentProduction(AGENT_LLM_TEAMS.anita);
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

    // ── PFV-01 LAYER 1: Runtime chain verification ──
    // These report what's ACTUALLY loaded, not what config says should be loaded
    diag.llm_chain = failoverLLM.listProviders();
    diag.llm_chain_count = failoverLLM.listProviders().length;
    diag.pipeline_llm_chain = pipelineLLM.listProviders();
    diag.pipeline_llm_first = pipelineLLM.listProviders()[0] || "NONE";
    diag.groq_in_pipeline = pipelineLLM.listProviders().some(p => p.startsWith("groq"));
    diag.tcf_pipeline_llm_chain = tcfPipelineLLM.listProviders();
    diag.tcf_groq_dedicated = !!process.env.GROQ_API_KEY_TCF;

    // ── TTS chain verification ──
    diag.tts_chain = ["xtts"]; // SESSION 106: XTTS only. ElevenLabs + Edge purged.
    diag.xtts_server_url_set = !!process.env.XTTS_SERVER_URL;

    // ── API key status ──
    const geminiKey = process.env.GEMINI_IMAGEN_KEY;
    const geminiTextKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    diag.gemini_imagen_key_set = !!geminiKey;
    diag.gemini_imagen_key_length = geminiKey?.length || 0;
    diag.gemini_text_key_set = !!geminiTextKey;
    diag.gemini_keys_same = geminiKey === geminiTextKey;
    diag.openai_key_set = !!openaiKey;
    diag.openai_key_length = openaiKey?.length || 0;

    // Test Pollinations.ai (FREE primary)
    try {
      const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent("A simple blue sphere on white background")}?width=512&height=512&nologo=true&seed=${Date.now()}`;
      const pollRes = await fetch(pollUrl, { redirect: "follow" });
      diag.pollinations_status = pollRes.status;
      if (pollRes.ok) {
        const buf = Buffer.from(await pollRes.arrayBuffer());
        diag.pollinations_bytes = buf.length;
        diag.pollinations_ok = buf.length > 5000;
      }
    } catch (err: any) {
      diag.pollinations_error = err.message;
    }

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

  // ── /api/content-engine/flux-batch — Manual FLUX pod batch image generation trigger ──
  webhookServer.register("/api/content-engine/flux-batch", async () => {
    try {
      const patched = await fluxBatchImageGen();
      return JSON.stringify({ status: "ok", patched });
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

  // ── /api/inbound-email — Resend inbound email webhook ──
  // Session 109: Receives lead replies to nurture emails. Dispatches to Anita for
  // plain-English draft → Telegram approval → send via Resend.
  // Session 110: Updated to parse Resend's email.received webhook format.
  // Session 111: FIXED API endpoint. Correct endpoint is GET /emails/receiving/:email_id
  //   (NOT /received-emails/:email_id/content — that was a hallucinated URL).
  //   Response has { id, from, to, subject, text, html, headers, attachments, raw }.
  //   MX record REQUIRED on sovereign-synthesis.com pointing to Resend's inbound server.
  webhookServer.register("/api/inbound-email", async (incoming: any) => {
    if (!defaultChatId || !telegram) {
      return JSON.stringify({ status: "error", message: "Telegram not configured" });
    }
    try {
      // Parse Resend webhook format
      const eventType = incoming?.type;
      if (eventType && eventType !== "email.received") {
        // Ignore non-inbound events (bounced, delivered, etc.)
        console.log(`[InboundEmail] Ignoring event type: ${eventType}`);
        return JSON.stringify({ status: "ignored", event: eventType });
      }

      let payload: { from: string; to?: string; subject: string; text: string; html?: string };

      if (eventType === "email.received" && incoming?.data?.email_id) {
        // Resend webhook format — extract metadata from data, fetch full email from API
        const d = incoming.data;
        const emailId = d.email_id;
        // Webhook data.from can be string or array
        const fromAddr = typeof d.from === "string" ? d.from : (Array.isArray(d.from) ? d.from[0] : "");
        const toAddr = Array.isArray(d.to) ? d.to[0] : (d.to || "");
        const subject = d.subject || "(no subject)";

        // Fetch full email from Resend Received Emails API
        // Correct endpoint: GET https://api.resend.com/emails/receiving/:email_id
        // Returns { id, from, to, subject, text, html, headers, attachments, raw }
        let bodyText = "";
        const resendKey = process.env.RESEND_API_KEY;
        if (resendKey && emailId) {
          try {
            const contentResp = await fetch(
              `https://api.resend.com/emails/receiving/${emailId}`,
              { headers: { Authorization: `Bearer ${resendKey}` } }
            );
            if (contentResp.ok) {
              const emailData = (await contentResp.json()) as any;
              // text field has plain text body, html field has HTML body
              bodyText = emailData.text || "";
              // If no plain text, strip HTML
              if (!bodyText && emailData.html) {
                bodyText = emailData.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
              }
              console.log(`[InboundEmail] Fetched email ${emailId}: from=${emailData.from}, subject=${emailData.subject}, bodyLen=${bodyText.length}`);
            } else {
              const errText = await contentResp.text().catch(() => "");
              console.error(`[InboundEmail] Failed to fetch email ${emailId}: ${contentResp.status} ${errText.slice(0, 200)}`);
              bodyText = "(email body could not be retrieved)";
            }
          } catch (fetchErr: any) {
            console.error(`[InboundEmail] Email fetch error: ${fetchErr.message}`);
            bodyText = "(email body fetch failed)";
          }
        }

        payload = { from: fromAddr, to: toAddr, subject, text: bodyText };
      } else {
        // Direct/manual payload format: { from, to, subject, text }
        payload = incoming as any;
      }

      const result = await handleInboundEmail(payload, telegram, defaultChatId);
      return JSON.stringify(result);
    } catch (err: any) {
      console.error(`[InboundEmail] Webhook error: ${err.message}`);
      return JSON.stringify({ status: "error", message: err.message });
    }
  });

  // ── /api/email-tracking — Resend email tracking webhook ──
  // Session 111: Stores delivered/opened/clicked/bounced/complained events in Supabase.
  // Vector reads this data via the email_tracking tool.
  // Webhook must be configured in Resend with events: email.delivered, email.opened,
  // email.clicked, email.bounced, email.complained.
  webhookServer.register("/api/email-tracking", async (incoming: any) => {
    try {
      const eventType = incoming?.type;
      if (!eventType) {
        return JSON.stringify({ status: "ignored", reason: "no event type" });
      }

      // Map Resend event types to our simplified names
      const EVENT_MAP: Record<string, string> = {
        "email.delivered": "delivered",
        "email.opened": "opened",
        "email.clicked": "clicked",
        "email.bounced": "bounced",
        "email.complained": "complained",
      };

      const mappedType = EVENT_MAP[eventType];
      if (!mappedType) {
        console.log(`[EmailTracking] Ignoring event type: ${eventType}`);
        return JSON.stringify({ status: "ignored", event: eventType });
      }

      const d = incoming.data || {};
      const fromAddr = typeof d.from === "string" ? d.from : (Array.isArray(d.from) ? d.from[0] : "");
      const toAddr = Array.isArray(d.to) ? d.to[0] : (typeof d.to === "string" ? d.to : "");
      const subject = d.subject || "";
      const emailId = d.email_id || d.id || "";
      // For click events, Resend includes the clicked URL in data.click.link
      const linkUrl = d.click?.link || d.link || "";

      // Store in Supabase
      const sbUrl = process.env.SUPABASE_URL;
      const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
      if (sbUrl && sbKey) {
        const insertResp = await fetch(`${sbUrl}/rest/v1/email_events`, {
          method: "POST",
          headers: {
            apikey: sbKey,
            Authorization: `Bearer ${sbKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            event_type: mappedType,
            email_id: emailId,
            from_addr: fromAddr,
            to_addr: toAddr,
            subject,
            link_url: linkUrl || null,
            raw_payload: incoming,
          }),
        });
        if (!insertResp.ok) {
          const errText = await insertResp.text();
          console.error(`[EmailTracking] Supabase insert failed: ${insertResp.status} ${errText.slice(0, 200)}`);
        } else {
          console.log(`[EmailTracking] ${mappedType} event stored — to=${toAddr} subject="${subject.slice(0, 50)}"`);
        }
      }

      return JSON.stringify({ status: "stored", event: mappedType });
    } catch (err: any) {
      console.error(`[EmailTracking] Webhook error: ${err.message}`);
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

      const brandList = brands || ["sovereign_synthesis", "containment_field"];
      console.log(`📡 [FacelessFactory] Manual trigger — niche: ${detectedNiche}, brands: ${brandList.join(", ")}`);

      const results = await produceFacelessBatch(pipelineLLM, sourceIntel.slice(0, 3000), detectedNiche, brandList);

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
        // Determine brand from metadata or default to sovereign_synthesis
        const brand = clip.metadata?.brand || "sovereign_synthesis";
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
    const allowedDomains = ["tiktok", "instagram", "youtube", "threads"];
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
    const domains = ["tiktok", "instagram", "youtube", "threads"];
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

  // ── Crew Dispatch webhook — external systems can push tasks to agents ──
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
  console.log("# ✅ Gravity Claw is LIVE");

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

  if (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)) {
    const supabase = (await import("@supabase/supabase-js")).createClient(
      process.env.SUPABASE_URL,
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)!
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

    // S117: ddxfish pattern — for the 5 non-Sapphire crew bots, OVERRIDE the
    // static blueprint with the runtime-assembled prompt from per-bot pieces
    // libraries + bot_active_state selections. Sapphire keeps her own
    // per-turn assembler (sapphire-prompt-builder.ts). See
    // MAVEN-CREW-DIRECTIVES.md §1.3 + src/agent/crew-prompt-builder.ts.
    try {
      const { assembleCrewPrompt } = await import("./agent/crew-prompt-builder");
      const CREW_DDXFISH = ["veritas", "yuki", "alfred", "anita", "vector"] as const;
      for (const agent of CREW_DDXFISH) {
        try {
          const assembled = await assembleCrewPrompt(agent);
          if (assembled && assembled.length > 100 && personalityMap[agent]) {
            personalityMap[agent].prompt_blueprint = assembled;
            console.log(`🧬 [CrewPromptBuilder] ${agent}: assembled ${assembled.length} chars from pieces (overriding personalities.json)`);
          } else {
            console.warn(`⚠️ [CrewPromptBuilder] ${agent}: assembled prompt too short (${assembled.length} chars) — keeping personalities.json fallback`);
          }
        } catch (innerErr: any) {
          console.warn(`⚠️ [CrewPromptBuilder] ${agent} assembly failed: ${innerErr.message} — keeping personalities.json fallback`);
        }
      }
    } catch (err: any) {
      console.warn(`⚠️ [CrewPromptBuilder] Module import failed: ${err.message} — all crew bots use personalities.json`);
    }

    // SUPABASE HOT-UPDATE DISABLED — Session 28 root cause analysis:
    // The personality_config table still had the OLD 18-20K char bloated prompts.
    // Every boot cycle, lean bundled JSON (~1.6K) loaded first, then Supabase
    // overwrote it with the bloated versions. This caused Groq 413 → Gemini failover
    // on EVERY dispatch call, burning ~$12/day.
    // The bundled personalities.json is now the SOLE authority.
    // To hot-update prompts, edit personalities.json and redeploy.
    console.log(`🔒 [PersonalityLoader] Using bundled JSON only (Supabase hot-update disabled — bloated prompts in DB)`);

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

        // ── LEAN SYSTEM PROMPT INJECTION ──
        // Session 27 OVERHAUL: Personality prompts trimmed from ~18K to ~1.6K chars each.
        // Shared operational context extracted into a compact ~1.2K module.
        // Old prompts had identical 10-12K "Operational Awareness" blocks copy-pasted 6 times,
        // causing every Groq call to 413 and failover to Gemini ($62 bill in 5 days).
        // New architecture: lean identity + compact shared context = ~750 tokens total.
        // Detailed protocols retrieved on-demand via read_protocols (Supabase).
        const blueprint = personality.prompt_blueprint;

        // Import shared operational context (product ladder, task protocol, standing rules)
        const { SHARED_AGENT_CONTEXT } = await import("./data/shared-context");

        // Per-agent LLM team — each agent gets its own failover chain to prevent quota stampedes
        const agentTeamLLM = AGENT_LLM_TEAMS[agentCfg.name] || failoverLLM;
        const injectedLLM: LLMProvider = {
          ...agentTeamLLM,
          generate: (messages, options) =>
            agentTeamLLM.generate(messages, { ...options, systemPrompt: blueprint + "\n\n" + SHARED_AGENT_CONTEXT }),
        };

        // Build per-agent tool set: shared tools + agent-specific tools
        const agentTools: Tool[] = [...tools, new CrewDispatchTool(agentCfg.name)];

        // Content crew: agents that produce/distribute content and need protocol access
        const CONTENT_CREW = ["alfred", "anita", "yuki"];

        // Protocol tools — content crew gets reader, Sapphire gets writer
        if (CONTENT_CREW.includes(agentCfg.name)) {
          agentTools.push(new ProtocolReaderTool());
        }
        if (agentCfg.name === "sapphire") {
          agentTools.push(new ProtocolWriterTool());
          agentTools.push(new RelationshipContextTool());
          // ── Personal Assistant tool layer (Phase 3 / S114) ──
          // 16 tools: reminders × 3, gmail × 4, calendar × 3, notion × 4, facts × 2.
          // These power Sapphire's PA mode (DM with Ace about life/calendar/email).
          const { buildSapphirePATools } = await import("./tools/sapphire");
          for (const t of buildSapphirePATools()) agentTools.push(t);
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

        // S117: Memetic Trigger Judge — Yuki + Alfred quality gate before
        // posting/emitting. See MAVEN-CREW-DIRECTIVES.md §4.7 + §5.7.
        if (agentCfg.name === "yuki" || agentCfg.name === "alfred") {
          const { MemeticTriggerJudgeTool } = await import("./tools/memetic-trigger-judge");
          agentTools.push(new MemeticTriggerJudgeTool());
        }

        // Yuki gets the YouTube comment tool for engagement automation
        if (agentCfg.name === "yuki") {
          agentTools.push(new YouTubeCommentTool());
        }

        // Vector gets full CRO visibility: Stripe + Buffer + YouTube + Landing + Email
        if (agentCfg.name === "vector") {
          agentTools.push(new StripeMetricsTool());
          agentTools.push(new BufferAnalyticsTool());
          agentTools.push(new YouTubeAnalyticsReaderTool());
          agentTools.push(new LandingAnalyticsReaderTool());
          agentTools.push(new EmailTrackingTool()); // Session 111: email open/click/bounce tracking
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
        // Sapphire keeps write_knowledge for COO-mode brand intelligence (so the
        // business semantic memory keeps growing) — but her personality prompt
        // restricts it to crew/brand topics ONLY. Personal stuff (Ace's life)
        // goes through remember_fact → sapphire-personal namespace.
        // Two clean lanes, two distinct namespaces, zero contamination.
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

        // ── Sapphire PA channel reference for scheduled jobs ──
        // Reminder poll, morning brief, and evening wrap need this ref to send DMs as Sapphire.
        if (agentCfg.name === "sapphire") {
          sapphirePARef.channel = agentChannel;
          const authIds = config.telegram.authorizedUserIds.map(String).join(",");
          const paToolCount = agentTools.filter((t) => t.definition?.name?.startsWith?.("set_reminder")
            || t.definition?.name?.startsWith?.("gmail_")
            || t.definition?.name?.startsWith?.("calendar_")
            || t.definition?.name?.startsWith?.("notion_")
            || t.definition?.name === "remember_fact"
            || t.definition?.name === "recall_facts").length;
          console.log(`[SapphirePA] ARMED — channel ref set, ${paToolCount} PA tools wired, authorized=[${authIds}], default chat=${defaultChatId}`);
        }

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
            // ── EARLY VOICE TRANSCRIPTION (Sapphire DM only) ──
            // For Sapphire's PA mode we need transcripts BEFORE the command
            // intercept so voice-noted commands work too.
            if (agentCfg.name === "sapphire" && !message.metadata?.isGroup
                && message.attachments?.some((a) => a.type === "voice" || a.type === "audio")) {
              const voiceAttachment = message.attachments.find((a) => a.type === "voice" || a.type === "audio");
              if (voiceAttachment?.url) {
                try {
                  await agentChannel.sendTyping(message.chatId);
                  const audioBuffer = await downloadTelegramFile(voiceAttachment.url);
                  const transcription = await transcribeAudio(audioBuffer, voiceAttachment.mimeType);
                  message.content = transcription;
                  // Mark so the later voice block doesn't double-transcribe
                  (message as any).__sapphirePATranscribed = true;
                } catch (vErr: any) {
                  console.error(`[SapphirePA] Voice transcription failed: ${vErr.message}`);
                }
              }
            }

            // ── EARLY PDF ANALYSIS (Sapphire DM only) — Gap 2 ──
            // Sapphire receives a PDF document → run analyze_pdf → replace
            // message.content with the extracted text so the agent loop can act.
            if (agentCfg.name === "sapphire" && !message.metadata?.isGroup
                && message.attachments?.some((a) => a.type === "document")) {
              const docAttachment = message.attachments.find((a) => a.type === "document");
              const isPdf = docAttachment && (
                (docAttachment as any).mimeType === "application/pdf"
                || ((docAttachment as any).fileName && (docAttachment as any).fileName.toLowerCase().endsWith(".pdf"))
              );
              if (isPdf && docAttachment?.fileId) {
                try {
                  await agentChannel.sendTyping(message.chatId);
                  const { AnalyzePdfTool } = await import("./tools/sapphire");
                  const pdfTool = new AnalyzePdfTool();
                  const extraction = await pdfTool.execute({ file_id: docAttachment.fileId, focus: "all" });
                  const caption = (message.content && message.content !== "[Document]") ? message.content : "";
                  message.content = `[ACE SENT YOU A PDF. Here's what's in it]:\n${extraction}\n\n[ORIGINAL CAPTION]: ${caption || "(no caption)"}\n\n[INSTRUCTION]: Act on the PDF content. If it has dates/times → propose a calendar event. If it has tasks/deadlines → propose a reminder. If it's a note worth keeping → append to today's Notion page. If unclear what to do → ask Ace. Always confirm before acting.`;
                } catch (pdfErr: any) {
                  console.error(`[SapphirePA] PDF handler crashed: ${pdfErr.message}`);
                }
              }
            }

            // ── EARLY IMAGE VISION (Sapphire DM only) ──
            // Sapphire receives a photo → run Gemini 2.5 Flash vision → replace
            // message.content with extracted info so the agent loop can act on it
            // (create event, set reminder, append to Notion, etc.). Uses Sapphire's
            // OWN bot token to bypass the global-token bug in TelegramChannel.
            if (agentCfg.name === "sapphire" && !message.metadata?.isGroup
                && message.attachments?.some((a) => a.type === "image")) {
              const imageAttachment = message.attachments.find((a) => a.type === "image");
              if (imageAttachment?.fileId) {
                try {
                  await agentChannel.sendTyping(message.chatId);
                  const { analyzeSapphireImage } = await import("./agent/sapphire-pa-context");
                  const caption = message.content === "[Photo]" ? "" : message.content;
                  const vision = await analyzeSapphireImage(imageAttachment.fileId, caption);
                  if (vision.ok) {
                    message.content = `[ACE SENT YOU AN IMAGE. Here's what's in it]:\n${vision.description}\n\n[ORIGINAL CAPTION]: ${caption || "(no caption)"}\n\n[INSTRUCTION]: Act on the image content. If it has dates/times → propose a calendar event. If it has tasks → propose a reminder or note. If unclear what to do → ask Ace what he wants done with this. Always confirm what you'll do before doing it.`;
                  } else {
                    console.warn(`[SapphirePA] Vision failed: ${vision.error}`);
                    message.content = `[ACE SENT AN IMAGE but vision analysis failed: ${vision.error}. Tell him you couldn't read the image and ask him to describe what's in it.]\n\nOriginal caption: ${caption}`;
                  }
                } catch (imgErr: any) {
                  console.error(`[SapphirePA] Image handler crashed: ${imgErr.message}`);
                }
              }
            }

            // ── SAPPHIRE PERSONAL-ASSISTANT COMMAND INTERCEPT ──
            // Runs BEFORE the agent loop. Handles /auth_*, /voice_*, and pending
            // input states (auth code paste, Notion token paste). DM only — never
            // intercepts in group chats so Sapphire's COO role isn't disrupted.
            // Only the authorized user (Ace) can trigger any of these.
            if (agentCfg.name === "sapphire" && !message.metadata?.isGroup) {
              try {
                const handled = await handleSapphirePACommand(message, agentChannel);
                if (handled) return;
              } catch (paErr: any) {
                console.error(`[SapphirePA] Command intercept failed: ${paErr.message}`);
                // Fall through to agent loop on error
              }
            }

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

            // Voice handling (skip if Sapphire PA early-transcription already ran)
            if (!(message as any).__sapphirePATranscribed
                && message.attachments?.some((a) => a.type === "voice" || a.type === "audio")) {
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

            // ── SESSION 111: /comment — deterministic handler for ALL crew bots ──
            // Previously only existed in Veritas handleCommand(). Crew bots (especially Yuki)
            // bypassed it entirely, sending /comment to the LLM agent loop. Now handled here
            // deterministically — extracts videoId, calls postDiagnosticComment() directly.
            else if (/^\/comment\b/i.test(message.content)) {
              const commentArgs = message.content.replace(/^\/comment\s*/i, "").trim().split(/\s+/);
              const rawArg = commentArgs[0];
              if (!rawArg) {
                await agentChannel.sendMessage(message.chatId,
                  "Usage: /comment <videoId or YouTube URL> [sovereign_synthesis|containment_field]"
                );
                return;
              }
              let videoId = rawArg;
              const urlMatch = rawArg.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
              if (urlMatch) {
                videoId = urlMatch[1];
              } else if (rawArg.length > 11 && rawArg.includes("&")) {
                videoId = rawArg.split("&")[0];
              }
              const commentBrand = (commentArgs[1] as "sovereign_synthesis" | "containment_field") || "sovereign_synthesis";
              console.log(`[/comment@${agentCfg.name}] videoId="${videoId}" brand="${commentBrand}" rawArg="${rawArg.slice(0, 80)}"`);
              await agentChannel.sendMessage(message.chatId, `📝 Posting diagnostic comment on ${videoId} (${commentBrand})...`);
              try {
                const result = await postDiagnosticComment(videoId, commentBrand);
                if (result.success) {
                  await agentChannel.sendMessage(message.chatId,
                    `✅ Comment posted!\nVideo: https://youtube.com/watch?v=${videoId}\nComment ID: ${result.commentId}`
                  );
                } else {
                  await agentChannel.sendMessage(message.chatId,
                    `❌ Comment failed: ${result.error}`
                  );
                }
              } catch (err: any) {
                await agentChannel.sendMessage(message.chatId, `❌ Comment error: ${err.message}`);
              }
              return;
            }

            // ── /dryrun, /pipeline, /alfred commands are handled by Veritas handleCommand() ──
            // Crew bots should NOT run pipeline commands — redirect to Veritas
            // SESSION 80: Added /alfred — was being swallowed by crew bots instead of routing
            // to Veritas for Alfred's daily_trend_scan dispatch.
            else if (/^\/dryrun\b/i.test(message.content) || /^\/pipeline\b/i.test(message.content) || /^\/alfred\b/i.test(message.content)) {
              await agentChannel.sendMessage(message.chatId,
                `Pipeline commands (/dryrun, /pipeline, /alfred) run through Veritas. Send there instead.`
              );
              return; // Don't pass to agent loop
            }

            // ── YOUTUBE URL → Crew bots acknowledge but don't run pipeline ──
            else if (YOUTUBE_URL_RE.test(message.content) && !CLIP_TRIGGER_RE.test(message.content)) {
              // Only Veritas runs the full pipeline. Crew bots just note it.
              message.content = `[YouTube URL detected: ${message.content.match(YOUTUBE_URL_RE)?.[0]}] ` +
                `Pipeline commands go through Veritas. Acknowledge this if the Architect sent it here by mistake.`;
            }

            // ── SAPPHIRE PA MODE A INJECTION + SEMANTIC RECALL ──
            // Pass user message so the prefix can do semantic recall against
            // sapphire-personal Pinecone namespace and surface relevant facts.
            if (agentCfg.name === "sapphire" && !message.metadata?.isGroup) {
              try {
                const { buildPersonalContextPrefix } = await import("./agent/sapphire-pa-context");
                const userMsg = message.content; // capture before mutation
                const ctxPrefix = await buildPersonalContextPrefix(userMsg);
                message.content = `${ctxPrefix}\n${userMsg}`;
              } catch (ctxErr: any) {
                console.warn(`[SapphirePA] context build failed: ${ctxErr.message}`);
                message.content = `[CONTEXT: 1-on-1 DM from Ace. MODE A — Personal Assistant. Plain English. No sovereign tone.]\n\n${message.content}`;
              }
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

            // ── S114u: ddxfish snapshot/restore pattern — leak-proof tool tiering ──
            // Snapshot tools + observer + context state BEFORE the LLM call, restore in
            // finally so they NEVER leak across messages even if processMessage throws.
            let sapphireToolSnapshot: Map<string, any> | null = null;
            const isSapphireDM = agentCfg.name === "sapphire" && !message.metadata?.isGroup;
            if (isSapphireDM) {
              try {
                const { makeSapphireToolObserver } = await import("./agent/sapphire-tool-indicators");
                agentBotLoop.setToolCallObserver(makeSapphireToolObserver(agentChannel, message.chatId));

                // Tier the tool set to only what this message needs (~5K tokens vs 27 always)
                const { selectToolsForMessage } = await import("./tools/sapphire/_router");
                const hasAttachment = !!message.attachments?.length;
                // Match against ORIGINAL user text — strip context prefix that we injected
                const rawText = message.content
                  .replace(/^# IDENTITY[\s\S]*?(?=^[^#]|\Z)/m, "")
                  .replace(/^# LIVE STATE[\s\S]*?(?=^[^#]|\Z)/m, "")
                  .replace(/^URGENT ALERT[\s\S]*?\n\n/m, "")
                  .replace(/^\[CONTEXT:[\s\S]*?\]\s*/m, "")
                  .trim();
                const selection = selectToolsForMessage(rawText, hasAttachment);
                console.log(`[SapphirePA] Tool tiering — loaded [${selection.loadedTiers.join(",")}] = ${selection.toolCount} tools (~${selection.approxTokens} tokens, was 32)`);

                // Context budget cap — drop recent msg cap to 6, skip semantic search
                agentBotLoop.setContextOverrides({ maxRecentMessages: 6, skipSemanticSearch: true });

                // Snapshot full tool set so we can restore. Strip PA tools, replace with tier selection.
                sapphireToolSnapshot = agentBotLoop.snapshotTools();
                const allCurrent = Array.from(sapphireToolSnapshot.values());
                const PA_TOOL_NAMES = new Set([
                  "set_reminder","list_reminders","cancel_reminder",
                  "gmail_inbox","gmail_search","gmail_send","gmail_draft",
                  "calendar_list","calendar_create_event","calendar_reschedule",
                  "notion_create_page","notion_append_to_page","notion_search","notion_set_parent_page",
                  "remember_fact","recall_facts",
                  "analyze_pdf","research_brief",
                  "save_family_member","get_family",
                  "create_plan","approve_plan","advance_plan","record_step_result","cancel_plan",
                  "add_news_source","remove_news_source","list_news_sources",
                  "set_piece","remove_piece","create_piece","list_pieces","view_self_prompt",
                ]);
                const nonPATools = allCurrent.filter((t: any) => !PA_TOOL_NAMES.has(t.definition?.name));
                agentBotLoop.setTools([...nonPATools, ...selection.tools]);
              } catch (e: any) {
                console.warn(`[SapphirePA] Tool tiering setup failed: ${e.message} — falling back to full set`);
              }
            }

            // ── try/finally guarantees state restore even on processMessage throw ──
            let response: string;
            try {
              response = await agentBotLoop.processMessage(message, () => agentChannel.sendTyping(message.chatId));
            } finally {
              if (isSapphireDM) {
                agentBotLoop.setToolCallObserver(undefined);
                agentBotLoop.setContextOverrides(undefined);
                if (sapphireToolSnapshot) agentBotLoop.restoreTools(sapphireToolSnapshot);
              }
            }

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
              apikey: (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)!,
              Authorization: `Bearer ${(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)!}`,
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

    // ── Pipeline Lock + Concurrency Queue (Session 40) ──
    // Supabase free tier can't handle poller traffic + pipeline traffic simultaneously.
    // When pipeline is running, pollers skip their cycle entirely.
    // The queue serializes overlapping pipeline requests — only one runs at a time,
    // subsequent requests wait in FIFO order instead of being silently dropped.
    let pipelineRunning = false;

    const setPipelineRunning = (val: boolean) => {
      pipelineRunning = val;
      console.log(`🔒 [PipelineLock] Pipeline ${val ? "STARTED — pollers paused" : "ENDED — pollers resumed"}`);
    };

    // In-memory FIFO pipeline queue
    type PipelineJob = {
      label: string;
      run: () => Promise<void>;
    };
    const pipelineQueue: PipelineJob[] = [];
    let pipelineQueueProcessing = false;

    const processPipelineQueue = async () => {
      if (pipelineQueueProcessing) return; // already draining
      pipelineQueueProcessing = true;
      while (pipelineQueue.length > 0) {
        const job = pipelineQueue.shift()!;
        console.log(`🚀 [PipelineQueue] Starting: ${job.label} (${pipelineQueue.length} queued behind)`);
        setPipelineRunning(true);
        try {
          await job.run();
        } catch (err: any) {
          console.error(`❌ [PipelineQueue] ${job.label} CRASHED: ${err.message}`);
        } finally {
          setPipelineRunning(false);
        }
      }
      pipelineQueueProcessing = false;
      console.log(`✅ [PipelineQueue] Queue drained — all pipelines complete`);
    };

    /** Enqueue a pipeline job. Runs immediately if idle, queues if busy. */
    const enqueuePipeline = (label: string, run: () => Promise<void>): number => {
      pipelineQueue.push({ label, run });
      const position = pipelineQueue.length;
      console.log(`📥 [PipelineQueue] Enqueued: ${label} (position ${position})`);
      // Kick off processing (no-op if already running)
      processPipelineQueue();
      return position;
    };

    // Expose globally so /pipeline command and dispatch poller can access it
    (globalThis as any).__setPipelineRunning = setPipelineRunning;
    (globalThis as any).__isPipelineRunning = () => pipelineRunning;
    (globalThis as any).__enqueuePipeline = enqueuePipeline;

    // ── Dispatch Poller — BATCHED: one query for all agents, with 503 backoff ──
    const DISPATCH_POLL_BASE_MS = 60_000; // 60s base (was 15s — killed Supabase free tier)
    const DISPATCH_POLL_MAX_MS = 300_000; // 5 min max backoff
    let dispatchPollMs = DISPATCH_POLL_BASE_MS;
    // dispatchPollTimer hoisted to main() scope for shutdown access

    if (agentLoops.size > 0) {
      const agentNames = [...agentLoops.keys()];
      console.log(`📡 [CrewDispatch] Starting batched dispatch poller for [${agentNames.join(", ")}] (base: ${DISPATCH_POLL_BASE_MS / 1000}s)`);

      const runDispatchPoll = async () => {
        // SESSION 51: Respect shutdown flag — don't pick up new work while draining
        if (shuttingDown) {
          console.log(`🛑 [DispatchPoller] Skipped — container shutting down`);
          return; // No reschedule — we're done
        }

        // Skip if pipeline is running — Supabase needs all bandwidth for clip uploads
        if (pipelineRunning) {
          console.log(`⏸️ [DispatchPoller] Skipped — pipeline running`);
          dispatchPollTimer = setTimeout(runDispatchPoll, dispatchPollMs);
          return;
        }

        // SESSION 34: Primary-only mode REMOVED.
        // Session 33 added setPrimaryOnly(true) to prevent Anthropic spend on dispatch tasks.
        // ROOT CAUSE DISCOVERY (Session 34): This is why ALL agent tasks fail when Groq 429s.
        // Groq free tier = 1,000 req/day shared across the ENTIRE org. One VidRush pipeline
        // burns 30-50 calls. By 10 AM, daily quota is cooked. setPrimaryOnly blocks failover
        // to Anthropic, so every dispatch task (Alfred trend scan, Vector metrics sweep) dies.
        // FIX: Agents are now Anthropic-first (cheap, reliable). Groq reserved for pipelines only.
        // Anthropic dispatch cost: ~$0.003/call (700 tokens). Full failover chain stays active.

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
            // Session 41: Raised 10s→20s — Anthropic rate-limit window needs room
            // when 5 agents fire stasis_self_check in sequence. $0.003/call, stagger is free insurance.
            if (agentIndex > 0) {
              await new Promise((resolve) => setTimeout(resolve, 20_000));
            }
            agentIndex++;

            for (const task of tasks) {
              console.log(`🔄 [DispatchPoller] ${agentName} processing dispatch ${task.id} (type: ${task.task_type})`);
              // 3s breather between consecutive tasks for the same agent
              if (tasks.indexOf(task) > 0) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
              }

              // SESSION 51: Track in-flight dispatches for graceful shutdown
              activeDispatchCount++;

              // Build a synthetic message from the dispatch payload
              const payloadStr = JSON.stringify(task.payload, null, 2);

              // ── Session 44: LIGHT TASKS — introspection-only, zero tools, single pass ──
              // These tasks burn iter cap without producing useful tool calls. Stasis
              // self-check was max-iter-failing because the agent would call tools for
              // introspection data it couldn't actually retrieve, then hit iter 4 on
              // the completion crew_dispatch call without a final text response.
              // Light mode: tools=undefined, iterCap=1, strip "use crew_dispatch" tail.
              //
              // SESSION 51: STASIS TRAP OVERRIDE — if the dispatch payload contains
              // signals that require tool execution or memory extraction, override
              // LIGHT_TASKS and route to full agent loop. Prevents execution-heavy
              // tasks from being lobotomized by stasis_self_check's zero-tool mode.
              const LIGHT_TASKS = new Set(["stasis_self_check"]);
              let isLightTask = LIGHT_TASKS.has(task.task_type);

              // Override: payload inspection for tool-requiring signals
              if (isLightTask && task.payload) {
                const payloadCheck = JSON.stringify(task.payload).toLowerCase();
                const TOOL_REQUIRING_SIGNALS = [
                  "extract", "generate", "publish", "post", "schedule",
                  "analyze", "fetch", "search", "upload", "distribute",
                  "crew_dispatch", "social_scheduler", "publish_video",
                  "save_content_draft", "buffer", "stripe", "veritas",
                ];
                const requiresTools = TOOL_REQUIRING_SIGNALS.some((sig) => payloadCheck.includes(sig));
                if (requiresTools) {
                  isLightTask = false;
                  console.warn(`⚡ [DispatchRouter] STASIS OVERRIDE — task ${task.id} (${task.task_type}) payload requires tools. Routing to FULL agent loop.`);
                }
              }

              // ── Task-type-specific execution directives ──
              // Without these, agents default to analysis/reporting instead of executing tools.
              // These ensure the pipeline's final stages actually POST content to platforms.
              const EXECUTION_DIRECTIVES: Record<string, string> = {
                stasis_self_check: `STASIS SELF-CHECK — Respond with a SINGLE plain-text message. No tool calls. ` +
                  `Speak in your character voice. Review your role in the Sovereign Synthesis mission and ` +
                  `report ONE of: (a) "NOMINAL" + a one-line observation about the current phase, OR ` +
                  `(b) A single concrete concern, opportunity, or pivot recommendation Ace should see. ` +
                  `Keep it under 300 words. The system will auto-log your response — do NOT attempt to mark the task complete.`,
                content_for_distribution: `EXECUTION ORDER: You (Yuki) are the SOLE distribution authority. You MUST use the social_scheduler_create_post tool to post this content to Buffer channels. ` +
                  `Step 1: Call social_scheduler_list_profiles to get channel IDs. ` +
                  `Step 2: Take the content from the payload and call social_scheduler_create_post with appropriate channel_ids and the text. ` +
                  `Post to ALL relevant channels (both Sovereign Synthesis and Containment Field accounts). ` +
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
                  `Create at least 3 variations optimized for different platforms (Instagram, Threads, Bluesky). ` +
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

              // ── Session 43: Hard-inject Architect YouTube Growth Protocol directives ──
              // If this task is YouTube-related, prepend the relevant youtube_*_protocol
              // bytes directly into the task context. Strips the agent of the "choice"
              // to skip the protocol — it becomes part of the task payload itself.
              // No latency on non-YT tasks (injector short-circuits on isYoutubeTask check).
              let architectDirectives = "";
              try {
                architectDirectives = await injectYoutubeProtocolsIfNeeded(
                  agentName,
                  task.task_type,
                  task.payload
                );
                if (architectDirectives) {
                  console.log(`📡 [ProtocolInjection] ${agentName}/${task.task_type} — ${architectDirectives.length} chars injected`);
                }
              } catch (injErr: any) {
                console.warn(`[ProtocolInjection] Non-fatal error for ${agentName}/${task.task_type}: ${injErr.message?.slice(0, 200)}`);
              }

              // Session 47c: daily_trend_scan is heavy (iterCap=6) but the deliverable is the
              // PIPELINE_IDEA line in the final assistant text — the bridge parser regex-matches
              // the text response, not crew_dispatch tool payloads. Forcing crew_dispatch
              // completion here sinks Alfred's seed into a tool result field and the bridge
              // drops it. Treat it like a light task for completion purposes: no tail, auto-complete from text.
              const completionTail = isLightTask
                ? "" // Light tasks auto-complete from the text response; no crew_dispatch tail.
                : task.task_type === "daily_trend_scan"
                ? "" // Session 47c: Native Seed Generator emits PIPELINE_IDEA in final text, no dispatch tail.
                : `\n\nWhen done, use crew_dispatch tool with action "complete" and task_id "${task.id}" to mark it done.`;

              const dispatchMessage: Message = {
                id: `dispatch-${task.id}`,
                role: "user",
                content: `[DISPATCHED TASK from ${task.from_agent}]\nType: ${task.task_type}\nDispatch ID: ${task.id}\n\n` +
                  (architectDirectives ? `${architectDirectives}\n\n` : "") +
                  `Payload:\n${payloadStr}\n\n` +
                  `${executionDirective}${completionTail}`,
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
                // LIGHT tasks (Session 44): introspection — 1 pass, zero tools
                const HEAVY_TASKS = new Set(["content_for_distribution", "content_scheduling", "daily_metrics_sweep", "daily_trend_scan"]);
                const isHeavyTask = HEAVY_TASKS.has(task.task_type);
                const iterCap = isLightTask ? 1 : (isHeavyTask ? 6 : 4);
                const response = await agentLoop.processMessage(dispatchMessage, undefined, iterCap, isLightTask);

                // SESSION 33: Detect if the response is actually a failure — mark appropriately.
                // Prevents "completed" status on tasks where all LLM providers failed,
                // and blocks downstream handoffs from cascading error messages.
                const isErrorResponse = response.toLowerCase().includes("all llm providers failed") ||
                  response.startsWith("⚠️") ||
                  response.includes("SYSTEM STATUS: DEGRADED") ||
                  response.includes("completely broken");
                const dispatchStatus = isErrorResponse ? "failed" as const : "completed" as const;
                await completeDispatch(task.id, dispatchStatus, response.slice(0, 4000));

                if (isErrorResponse) {
                  console.warn(`🛑 [DispatchPoller] ${agentName} task ${task.task_type} produced error response — marked FAILED, skipping handoffs`);
                  continue; // Skip handoffs and auto-pipeline trigger
                }

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

                // ── AUTO-PIPELINE TRIGGER: Alfred's daily NATIVE SEEDS → VidRush ──
                // SESSION 47b — NATIVE SEED GENERATOR PIVOT.
                // Phase 3 Task 3.3 (2026-04-15) — DUAL-SEED CONTRACT.
                // Alfred emits TWO brand-bound seeds per run with format:
                //   PIPELINE_IDEA_SS: <niche> :: <thesis>
                //   PIPELINE_IDEA_TCF: <niche> :: <thesis>
                // The bridge parses both, validates each niche against the brand's allowlist
                // (shared-context.ts BRAND_NICHE_ALLOWLIST), and feeds each brand its OWN
                // seed + niche into executeFullPipeline. Closes the cross-contamination bug
                // where Sovereign Synthesis was receiving burnout-themed seeds (S48 matrix fixed
                // render, this fixes intake).
                if (agentName === "alfred" && task.task_type === "daily_trend_scan") {
                  try {
                    // Dual-brand regex parser. Niche + thesis separated by literal `::`.
                    // Each pattern is anchored to a line; greedy to end-of-line for thesis.
                    const ssMatch = response.match(/PIPELINE_IDEA_SS:\s*([^\r\n:]+?)\s*::\s*([^\r\n]+?)\s*$/m);
                    const tcfMatch = response.match(/PIPELINE_IDEA_TCF:\s*([^\r\n:]+?)\s*::\s*([^\r\n]+?)\s*$/m);

                    // Also tolerate "PIPELINE_IDEA_SS: NONE" (no thesis) to abstain per-brand.
                    const ssNoneMatch = response.match(/PIPELINE_IDEA_SS:\s*NONE\s*$/m);
                    const tcfNoneMatch = response.match(/PIPELINE_IDEA_TCF:\s*NONE\s*$/m);

                    type Seed = { brand: "sovereign_synthesis" | "containment_field"; niche: string; thesis: string };
                    const seeds: Seed[] = [];
                    const rejections: string[] = [];

                    // ── ACE seed ingest ──
                    if (ssMatch && !ssNoneMatch) {
                      const rawNiche = ssMatch[1].trim();
                      const thesis = ssMatch[2].trim();
                      const normalized = normalizeNiche(rawNiche);
                      if (thesis.length === 0) {
                        rejections.push(`SS: empty thesis`);
                      } else if (!isAllowedNiche("sovereign_synthesis", rawNiche)) {
                        rejections.push(`SS: niche "${rawNiche}" (normalized "${normalized}") not in Sovereign Synthesis allowlist [${SOVEREIGN_SYNTHESIS_NICHES.join("|")}]`);
                      } else {
                        seeds.push({ brand: "sovereign_synthesis", niche: normalized, thesis });
                      }
                    } else if (ssNoneMatch) {
                      console.log(`🔍 [AutoPipeline] Alfred abstained on Sovereign Synthesis (PIPELINE_IDEA_SS: NONE)`);
                    } else {
                      rejections.push(`SS: missing PIPELINE_IDEA_SS line`);
                    }

                    // ── TCF seed ingest ──
                    if (tcfMatch && !tcfNoneMatch) {
                      const rawNiche = tcfMatch[1].trim();
                      const thesis = tcfMatch[2].trim();
                      const normalized = normalizeNiche(rawNiche);
                      if (thesis.length === 0) {
                        rejections.push(`TCF: empty thesis`);
                      } else if (!isAllowedNiche("containment_field", rawNiche)) {
                        rejections.push(`TCF: niche "${rawNiche}" (normalized "${normalized}") not in Containment Field allowlist [${CONTAINMENT_FIELD_NICHES.join("|")}]`);
                      } else {
                        seeds.push({ brand: "containment_field", niche: normalized, thesis });
                      }
                    } else if (tcfNoneMatch) {
                      console.log(`🔍 [AutoPipeline] Alfred abstained on Containment Field (PIPELINE_IDEA_TCF: NONE)`);
                    } else {
                      rejections.push(`TCF: missing PIPELINE_IDEA_TCF line`);
                    }

                    // Session 47d: brand_override lets /alfred [ace only | tcf only] constrain
                    // the fan-out. Filter seeds after parse so forbidden combos still raise.
                    const brandOverrideRaw = (task.payload as any)?.brand_override;
                    const autoBrandOverride: "sovereign_synthesis" | "containment_field" | undefined =
                      brandOverrideRaw === "sovereign_synthesis" || brandOverrideRaw === "containment_field"
                        ? brandOverrideRaw
                        : undefined;
                    const activeSeeds = autoBrandOverride
                      ? seeds.filter(s => s.brand === autoBrandOverride)
                      : seeds;

                    if (rejections.length > 0) {
                      console.log(`⚠️ [AutoPipeline] Seed validation rejections: ${rejections.join(" | ")}`);
                      try {
                        await channel.sendMessage(
                          task.chat_id || defaultChatId,
                          `⚠️ *Alfred seed validation*\n${rejections.map(r => `• ${r}`).join("\n")}${activeSeeds.length > 0 ? `\n\nProceeding with ${activeSeeds.length} valid seed(s).` : `\n\nNo valid seeds — aborting auto-pipeline.`}`,
                          { parseMode: "Markdown" }
                        );
                      } catch { /* non-critical */ }
                    }

                    if (activeSeeds.length > 0) {
                      const autoMode = autoBrandOverride === "sovereign_synthesis" ? "SOVEREIGN SYNTHESIS only"
                        : autoBrandOverride === "containment_field" ? "THE CONTAINMENT FIELD only"
                        : `Dual-brand (${activeSeeds.length}/2)`;

                      // Synthetic queue key — hash of concatenated theses, deterministic per-run.
                      const runHash = require("crypto")
                        .createHash("sha1")
                        .update(activeSeeds.map(s => `${s.brand}:${s.niche}:${s.thesis}`).join("|"))
                        .digest("hex")
                        .slice(0, 10);
                      const syntheticRunId = `raw_${runHash}`;

                      const seedPreview = activeSeeds.map(s => {
                        const brandShort = s.brand === "sovereign_synthesis" ? "SS" : "TCF";
                        const t = s.thesis.length > 100 ? s.thesis.slice(0, 100) + "…" : s.thesis;
                        return `[${brandShort} · ${s.niche}] ${t}`;
                      }).join("\n\n");

                      console.log(`🌱 [AutoPipeline] Alfred generated ${activeSeeds.length} seed(s) [${autoMode}] [${syntheticRunId}]:\n${seedPreview}`);
                      try {
                        await channel.sendMessage(
                          task.chat_id || defaultChatId,
                          `🌱 *NATIVE SEEDS INGESTED* (${autoMode})\n\n${seedPreview}\n\nVidRush bypassing Whisper, feeding each brand its own seed into Faceless Factory...`,
                          { parseMode: "Markdown" }
                        );
                      } catch { /* non-critical */ }

                      // Pipeline queue — serializes with manual /pipeline runs. Each brand
                      // gets its own executeFullPipeline call with its own rawIdea + niche.
                      const autoEnqueue = (globalThis as any).__enqueuePipeline;
                      const autoChatId = task.chat_id || defaultChatId;
                      const autoQueueTag = autoBrandOverride === "sovereign_synthesis" ? "ss"
                        : autoBrandOverride === "containment_field" ? "tcf"
                        : "dual";
                      const autoPos = autoEnqueue ? autoEnqueue(`auto-${syntheticRunId}-${autoQueueTag}`, async () => {
                        for (let bIdx = 0; bIdx < activeSeeds.length; bIdx++) {
                          const seed = activeSeeds[bIdx];
                          const brandLabel = seed.brand === "containment_field" ? "THE CONTAINMENT FIELD" : "SOVEREIGN SYNTHESIS";

                          // Per-brand synthetic id derived from that brand's thesis — keeps
                          // downstream queue/dedupe working even though we have two theses.
                          const seedHash = require("crypto")
                            .createHash("sha1")
                            .update(`${seed.brand}:${seed.niche}:${seed.thesis}`)
                            .digest("hex")
                            .slice(0, 10);
                          const seedId = `raw_${seedHash}`;

                          // Inter-brand cooldown (same env var as manual pipeline: PIPELINE_COOLDOWN_MS)
                          if (bIdx > 0) {
                            const cooldownMs = parseInt(process.env.PIPELINE_COOLDOWN_MS || "180000", 10);
                            const cooldownSec = Math.round(cooldownMs / 1000);
                            console.log(`⏳ [AutoPipeline] Inter-brand cooldown: ${cooldownSec}s...`);
                            try {
                              await channel.sendMessage(autoChatId,
                                `⏳ Cooling down ${cooldownSec}s before ${brandLabel} pipeline...`
                              );
                            } catch { /* non-critical */ }
                            await new Promise(r => setTimeout(r, cooldownMs));
                          }

                          try {
                            await channel.sendMessage(autoChatId, `--- ${brandLabel} AUTO-PIPELINE (niche: ${seed.niche}) ---`);
                          } catch { /* non-critical */ }

                          try {
                            const result = await executeFullPipeline(
                              seedId, // Synthetic identifier; orchestrator ignores when rawIdea is set.
                              seed.brand === "containment_field" ? tcfPipelineLLM : pipelineLLM,
                              seed.brand,
                              async (step: string, detail: string) => {
                                try {
                                  await channel.sendMessage(autoChatId, `[${brandLabel}] ${step}: ${detail}`);
                                } catch { /* non-critical */ }
                              },
                              { rawIdea: seed.thesis, niche: seed.niche }
                            );

                            // Phase 3 Task 3.5: burn the cooldown AFTER successful factory entry.
                            // If executeFullPipeline throws, we never reach this line — so an
                            // aborted seed does not consume a 30-day slot. Fire-and-forget;
                            // cooldown persistence must NEVER block pipeline progress.
                            try {
                              await recordNicheRun({
                                brand: seed.brand,
                                niche: seed.niche,
                                thesis: seed.thesis,
                                jobId: (result as any)?.jobId ?? (result as any)?.uploadId ?? seedId,
                                source: "alfred_daily",
                              });
                              console.log(`🧊 [AutoPipeline] cooldown recorded: ${seed.brand}/${seed.niche}`);
                            } catch (cooldownErr: any) {
                              console.warn(`[AutoPipeline] cooldown record failed (non-fatal): ${cooldownErr?.message}`);
                            }

                            const report = formatPipelineReport(result);
                            try {
                              await channel.sendMessage(autoChatId, `${brandLabel} COMPLETE:\n${report}`, { parseMode: "Markdown" });
                            } catch {
                              await channel.sendMessage(autoChatId, `${brandLabel} COMPLETE:\n${report.replace(/[*_`]/g, "")}`);
                            }
                          } catch (pipeErr: any) {
                            console.error(`❌ [AutoPipeline] ${brandLabel} Pipeline CRASHED: ${pipeErr.message}`);
                            try {
                              await channel.sendMessage(
                                autoChatId,
                                `${brandLabel} Pipeline FAILED: ${pipeErr.message?.slice(0, 500)}`
                              );
                            } catch { /* silent */ }
                            // Continue to next brand even if one fails
                          }
                        }
                      }) : 0;
                      if (autoPos > 1) {
                        try { await channel.sendMessage(autoChatId, `⏳ Auto-pipeline queued (position ${autoPos}). Will start after current run.`); } catch { /* non-critical */ }
                      }
                    } else if (rejections.length === 0) {
                      console.log(`🔍 [AutoPipeline] Alfred scan complete — both brands abstained (NONE) or no PIPELINE_IDEA_* lines found`);
                    }
                  } catch (autoErr: any) {
                    console.error(`[AutoPipeline] Error checking Alfred response: ${autoErr.message}`);
                  }
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
              } finally {
                // SESSION 51: Always decrement in-flight counter
                activeDispatchCount = Math.max(0, activeDispatchCount - 1);
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

        // SESSION 34: setPrimaryOnly removed — agents are Anthropic-first now, no need to toggle.

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
      // Skip if pipeline is running — preserve Supabase bandwidth
      if (pipelineRunning) {
        console.log(`⏸️ [TaskPoller] Skipped — pipeline running`);
        return;
      }

      try {
        const supabaseUrl = process.env.SUPABASE_URL!;
        const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)!;

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
  const memNames = memoryProviders.map((m) => m.name).join(" + ");
  console.log("🧠 Memory: " + memNames);
  console.log("🔧 Tools: " + tools.length + " loaded");
  console.log("🧬 LLM: " + failoverLLM.listProviders().join(" → "));
  console.log("📡 Channels: " + router.listChannels().join(", "));
  console.log("✅ Maven Crew ONLINE — [" + activeBotHandles.join(", ") + "]");
  console.log("📊 Process Memory — RSS: " + Math.round(mem.rss / 1024 / 1024) + "MB | Heap: " + Math.round(mem.heapUsed / 1024 / 1024) + "/" + Math.round(mem.heapTotal / 1024 / 1024) + "MB | External: " + Math.round(mem.external / 1024 / 1024) + "MB");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ── Memory Monitor (every 5 min) ──
  setInterval(() => {
    const m = process.memoryUsage();
    console.log(`📊 [MemWatch] RSS: ${Math.round(m.rss / 1024 / 1024)}MB | Heap: ${Math.round(m.heapUsed / 1024 / 1024)}/${Math.round(m.heapTotal / 1024 / 1024)}MB`);
  }, 300_000);

  // ── Graceful Shutdown ──
  // SESSION 51: Railway sends SIGTERM before killing the container (~10s grace).
  // Set shuttingDown flag to prevent new dispatch pickups, then drain in-flight tasks.
  const shutdown = async () => {
    console.log("🛑 GRAVITY CLAW shutting down — draining queue...");
    shuttingDown = true;

    // Cancel the dispatch poll timer so no new polls fire
    if (dispatchPollTimer) {
      clearTimeout(dispatchPollTimer);
      dispatchPollTimer = null;
    }

    // Wait for in-flight dispatch tasks to complete (max 8s to stay within Railway's grace window)
    const DRAIN_TIMEOUT_MS = 8000;
    const drainStart = Date.now();
    while (activeDispatchCount > 0 && (Date.now() - drainStart) < DRAIN_TIMEOUT_MS) {
      console.log(`⏳ [Shutdown] Draining ${activeDispatchCount} in-flight dispatch task(s)...`);
      await new Promise((r) => setTimeout(r, 500));
    }
    if (activeDispatchCount > 0) {
      console.warn(`⚠️ [Shutdown] ${activeDispatchCount} task(s) still in-flight after ${DRAIN_TIMEOUT_MS / 1000}s — force exiting`);
    }

    heartbeat.stop();
    sapphireSentinel.stop();
    scheduler.shutdown();
    await webhookServer.shutdown();
    await mcpBridge.shutdown();
    await router.shutdownAll();

    // SESSION 75: Kill any warm GPU pod to prevent orphan charges.
    await shutdownPodSession();
    // Belt-and-suspenders: sweep any pod that somehow survived prior crashes.
    await sweepStalePods().catch((err) =>
      console.warn("⚠️ [Shutdown] sweepStalePods failed:", err instanceof Error ? err.message : err),
    );

    // Shutdown agent channels
    for (const chan of agentChannels) {
      await chan.shutdown();
    }

    for (const provider of memoryProviders) {
      await provider.close();
    }
    knowledgeGraph.close();
    selfEvolvingMemory.close();
    console.log("✅ [Shutdown] Queue drained, all systems closed. Exiting.");
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
