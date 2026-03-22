import TelegramBot from "node-telegram-bot-api";
import * as http from "http";
import { config } from "./config";
import {
  getSystemStatus,
  pushIntent,
  getRecentGlitches,
  calibratePersonality,
  logGlitch,
  logSyncActivity,
} from "./supabase";
import { brainQuery, synthesizeGlitches } from "./gemini";
import { runMavenCrew, runSovereignCrew } from "./maven";

// ── Initialize Bot (Long-Polling) ──
const bot = new TelegramBot(config.telegram.botToken, { polling: true });

const AUTHORIZED = config.telegram.authorizedUserId;

console.log("⚡ GRAVITY CLAW ONLINE — Sovereign Frequency Locked");
console.log(`🔒 Authorized User ID: ${AUTHORIZED}`);

// ── Auth Guard ──
function isAuthorized(msg: TelegramBot.Message): boolean {
  return msg.from?.id === AUTHORIZED;
}

function reject(msg: TelegramBot.Message): void {
  // Silent ignore per protocol — no response to unauthorized users
}

// ── Heartbeat ──
setInterval(() => {
  console.log(`💓 Heartbeat — ${new Date().toISOString()}`);
}, 60_000);

// ── Sovereign Pulse System (3x Daily Auto-Messages) ──
// Sends directly to your Telegram user ID as a chat
const PULSE_HOURS = [8, 13, 21]; // 8 AM, 1 PM, 9 PM (uses Railway TZ env)
const firedPulses = new Set<string>();

async function sendMorningPulse() {
  try {
    const s = await getSystemStatus();
    const glitches = await getRecentGlitches(3);
    const glitchLine =
      glitches.length > 0
        ? `\n⚠️ ${glitches.length} anomalies detected — run /glitch`
        : `\n✅ Zero anomalies. System clean.`;

    const brain = await brainQuery(
      `Generate a short, powerful morning sovereign activation message for the Architect.
       Current revenue: $${s.revenue.toLocaleString()} of $1.2M target (${s.progress}%).
       Active habits: ${s.activeHabits}. Minds liberated: ${s.liberationCount}.
       Keep it under 200 words. Be direct, sovereign, no filler. End with a tactical directive for today.`
    );

    await bot.sendMessage(
      AUTHORIZED,
      `☀️ *MORNING PULSE — SOVEREIGN ACTIVATION*\n\n` +
        `💰 Revenue: $${s.revenue.toLocaleString()} / $1,200,000 (${s.progress}%)\n` +
        `🔥 Habits: ${s.activeHabits} active | 🌍 Liberated: ${s.liberationCount}` +
        glitchLine +
        `\n\n━━━ *TRANSMISSION* ━━━\n${brain}`,
      { parse_mode: "Markdown" }
    );
    console.log("☀️ Morning pulse sent");
  } catch (err: any) {
    console.error("Morning pulse failed:", err.message);
  }
}

async function sendMiddayPulse() {
  try {
    const s = await getSystemStatus();
    const brain = await brainQuery(
      `Generate a short midday momentum check for the Architect.
       Revenue: $${s.revenue.toLocaleString()} of $1.2M. Pending commands: ${s.pendingCommands}.
       Give a sharp reality check — are we on pace? What needs to happen in the next 4 hours?
       Under 150 words. Zero filler.`
    );

    await bot.sendMessage(
      AUTHORIZED,
      `⚡ *MIDDAY PULSE — MOMENTUM CHECK*\n\n` +
        `📋 Pending Commands: ${s.pendingCommands}\n` +
        `📈 Progress: ${s.progress}%\n\n` +
        `${brain}`,
      { parse_mode: "Markdown" }
    );
    console.log("⚡ Midday pulse sent");
  } catch (err: any) {
    console.error("Midday pulse failed:", err.message);
  }
}

async function sendEveningPulse() {
  try {
    const s = await getSystemStatus();
    const glitches = await getRecentGlitches(5);
    const brain = await brainQuery(
      `Generate a short evening debrief for the Architect.
       Revenue: $${s.revenue.toLocaleString()} of $1.2M (${s.progress}%).
       ${glitches.length} glitches today. Active habits: ${s.activeHabits}.
       Summarize the day's frequency, call out any Biological Drag to override tomorrow,
       and set one sovereign intent for the morning. Under 150 words.`
    );

    await bot.sendMessage(
      AUTHORIZED,
      `🌙 *EVENING PULSE — SOVEREIGN DEBRIEF*\n\n` +
        `💰 End-of-day: $${s.revenue.toLocaleString()} / $1,200,000\n` +
        `🔻 Glitches: ${glitches.length} | 🔥 Habits: ${s.activeHabits}\n\n` +
        `${brain}`,
      { parse_mode: "Markdown" }
    );
    console.log("🌙 Evening pulse sent");
  } catch (err: any) {
    console.error("Evening pulse failed:", err.message);
  }
}

// Check every minute if it's time to fire a pulse
setInterval(() => {
  const now = new Date();
  const hour = now.getHours();
  const dateKey = `${now.toDateString()}-${hour}`;

  if (PULSE_HOURS.includes(hour) && !firedPulses.has(dateKey)) {
    firedPulses.add(dateKey);

    // Clean old keys (keep set from growing forever)
    for (const key of firedPulses) {
      if (!key.startsWith(now.toDateString())) firedPulses.delete(key);
    }

    if (hour === 8) sendMorningPulse();
    else if (hour === 13) sendMiddayPulse();
    else if (hour === 21) sendEveningPulse();
  }
}, 60_000);

// ── /start ──
bot.onText(/\/start/, (msg) => {
  if (!isAuthorized(msg)) return reject(msg);
  bot.sendMessage(
    msg.chat.id,
    `⚡ *GRAVITY CLAW v2.0 — ONLINE*\n\n` +
      `Sovereign Frequency: *LOCKED*\n` +
      `Protocol 77: *ACTIVE*\n\n` +
      `Commands:\n` +
      `/status — System resonance check\n` +
      `/intent [command] — Inject sovereign intent\n` +
      `/glitch — Recent anomalies\n` +
      `/brain [query] — Cognitive engine query\n` +
      `/calibrate [slider] [value] — Personality adjustment\n` +
      `/maven — Trigger Maven Crew harvest\n` +
      `/synthesize [text] — Sovereign Crew content engine`,
    { parse_mode: "Markdown" }
  );
  logSyncActivity("SYSTEM", "Sentinel Reactive", "Gravity Claw /start command executed by Architect");
});

// ── /status ──
bot.onText(/\/status/, async (msg) => {
  if (!isAuthorized(msg)) return reject(msg);

  try {
    const s = await getSystemStatus();
    const response =
      `📊 *SYSTEM STATUS — PROTOCOL 77*\n\n` +
      `💰 Revenue: $${s.revenue.toLocaleString()} / $${s.target.toLocaleString()}\n` +
      `📈 Progress: ${s.progress}%\n` +
      `🔥 Active Habits: ${s.activeHabits}\n` +
      `${s.habits.map((h) => `  → ${h}`).join("\n")}\n` +
      `🌍 Minds Liberated: ${s.liberationCount.toLocaleString()}\n` +
      `📋 Pending Commands: ${s.pendingCommands}\n\n` +
      `*FREQUENCY: SOVEREIGN*`;

    bot.sendMessage(msg.chat.id, response, { parse_mode: "Markdown" });
    logSyncActivity("STATUS", "System Resonance Check", `Revenue: $${s.revenue.toLocaleString()} | Progress: ${s.progress}%`);
  } catch (err: any) {
    bot.sendMessage(msg.chat.id, `⚠️ Status check failed: ${err.message}`);
    logGlitch("Minor", `Status check failure: ${err.message}`);
  }
});

// ── /intent [command] ──
bot.onText(/\/intent (.+)/, async (msg, match) => {
  if (!isAuthorized(msg)) return reject(msg);
  const command = match?.[1];
  if (!command) return;

  try {
    const result = await pushIntent(command, String(msg.from?.id));
    bot.sendMessage(
      msg.chat.id,
      `✅ *INTENT INJECTED*\n\n` +
        `Command: \`${command}\`\n` +
        `Queue ID: \`${result?.id}\`\n` +
        `Status: *Pending*`,
      { parse_mode: "Markdown" }
    );
    logSyncActivity("INTENT", "Sovereign Intent Injected", `Command: ${command}`);
  } catch (err: any) {
    bot.sendMessage(msg.chat.id, `⚠️ Intent injection failed: ${err.message}`);
  }
});

// ── /glitch ──
bot.onText(/\/glitch/, async (msg) => {
  if (!isAuthorized(msg)) return reject(msg);

  try {
    const glitches = await getRecentGlitches();
    if (glitches.length === 0) {
      bot.sendMessage(msg.chat.id, "✅ *No anomalies detected.* System clean.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const lines = glitches.map(
      (g, i) =>
        `${i + 1}. [${g.severity}] ${g.description}\n   🕐 ${new Date(g.detected_at).toLocaleString()}`
    );

    // Also get AI synthesis of the glitches
    const synthesis = await synthesizeGlitches(glitches);

    bot.sendMessage(
      msg.chat.id,
      `🔻 *GLITCH LOG — Last ${glitches.length}*\n\n${lines.join("\n\n")}\n\n` +
        `━━━ *SYNTHESIS* ━━━\n${synthesis}`,
      { parse_mode: "Markdown" }
    );
  } catch (err: any) {
    bot.sendMessage(msg.chat.id, `⚠️ Glitch retrieval failed: ${err.message}`);
  }
});

// ── /brain [query] ──
bot.onText(/\/brain (.+)/, async (msg, match) => {
  if (!isAuthorized(msg)) return reject(msg);
  const query = match?.[1];
  if (!query) return;

  bot.sendChatAction(msg.chat.id, "typing");

  try {
    const response = await brainQuery(query);
    // Telegram has a 4096 char limit — chunk if needed
    const chunks = response.match(/[\s\S]{1,4000}/g) || [response];
    for (const chunk of chunks) {
      await bot.sendMessage(msg.chat.id, `🧠 *SOVEREIGN BRAIN*\n\n${chunk}`, {
        parse_mode: "Markdown",
      });
    }
  } catch (err: any) {
    bot.sendMessage(msg.chat.id, `⚠️ Brain query failed: ${err.message}`);
  }
});

// ── /calibrate [slider] [value] ──
bot.onText(/\/calibrate (\w+) ([\d.]+)/, async (msg, match) => {
  if (!isAuthorized(msg)) return reject(msg);
  const slider = match?.[1];
  const value = parseFloat(match?.[2] || "0");

  if (!slider || isNaN(value) || value < 0 || value > 1) {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ Usage: `/calibrate [slider_name] [0.0-1.0]`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  try {
    await calibratePersonality(slider, value);
    bot.sendMessage(
      msg.chat.id,
      `🎛️ *CALIBRATION COMPLETE*\n\n` +
        `Slider: \`${slider}\`\n` +
        `Value: \`${value}\`\n` +
        `Agent: gravity-claw`,
      { parse_mode: "Markdown" }
    );
  } catch (err: any) {
    bot.sendMessage(msg.chat.id, `⚠️ Calibration failed: ${err.message}`);
  }
});

// ── /maven — Trigger Maven Crew ──
bot.onText(/\/maven/, async (msg) => {
  if (!isAuthorized(msg)) return reject(msg);

  bot.sendMessage(msg.chat.id, "🚀 *Triggering Maven Crew harvest...*", {
    parse_mode: "Markdown",
  });

  try {
    const output = await runMavenCrew();
    const trimmed = output.slice(-3500); // last 3500 chars to stay in limit
    bot.sendMessage(
      msg.chat.id,
      `✅ *MAVEN CREW — COMPLETE*\n\n\`\`\`\n${trimmed}\n\`\`\``,
      { parse_mode: "Markdown" }
    );
  } catch (err: any) {
    bot.sendMessage(
      msg.chat.id,
      `⚠️ Maven Crew failure:\n${err.message.slice(-500)}`
    );
    logGlitch("Critical", `Maven Crew crash: ${err.message.slice(0, 200)}`);
    logSyncActivity("MAVEN", "Protocol Failure", `Maven Crew crash: ${err.message.slice(0, 50)}`, "error");
  }
});

// ── /synthesize [text] — Sovereign Crew content engine ──
bot.onText(/\/synthesize (.+)/s, async (msg, match) => {
  if (!isAuthorized(msg)) return reject(msg);
  const rawText = match?.[1];
  if (!rawText) return;

  bot.sendMessage(
    msg.chat.id,
    "🔮 *Sovereign Crew activated — encoding in progress...*",
    { parse_mode: "Markdown" }
  );

  try {
    const output = await runSovereignCrew(rawText);
    const trimmed = output.slice(-3500);
    bot.sendMessage(
      msg.chat.id,
      `✅ *SOVEREIGN SYNTHESIS — COMPLETE*\n\n\`\`\`\n${trimmed}\n\`\`\``,
      { parse_mode: "Markdown" }
    );
  } catch (err: any) {
    bot.sendMessage(
      msg.chat.id,
      `⚠️ Sovereign Crew failure:\n${err.message.slice(-500)}`
    );
    logGlitch("Minor", `Sovereign Crew error: ${err.message.slice(0, 200)}`);
  }
});

// ── /override — Trigger Production Pipeline (Make.com) ──
bot.onText(/\/override (.+)?/s, async (msg, match) => {
  if (!isAuthorized(msg)) return reject(msg);
  
  const payloadUrl = process.env.MAKE_PRODUCTION_WEBHOOK_URL || "https://hook.make.com/1b86ff8cd634d28a2c22c9051ec0db01";
  const intentTag = match?.[1] || "reality-override-default";
  
  bot.sendMessage(msg.chat.id, "🚀 *FIRING PRODUCTION PIPELINE...*", { parse_mode: "Markdown" });

  try {
    const response = await fetch(payloadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        trigger: "telegram_command",
        intent_tag: intentTag,
        timestamp: new Date().toISOString()
      })
    });
    
    if (response.ok) {
      bot.sendMessage(msg.chat.id, `✅ *MAKE.COM PIPELINE TRIGGERED*\n\nTag: \`${intentTag}\`\nAwaiting heartbeat confirmation.`, { parse_mode: "Markdown" });
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err: any) {
    bot.sendMessage(msg.chat.id, `⚠️ Pipeline trigger failed: ${err.message}`);
    logGlitch("Critical", `Make.com trigger failure: ${err.message}`);
  }
});

// ── Voice Memo Handler — Auto-forward to Make.com Factory ──
bot.on("voice", async (msg) => {
  if (!isAuthorized(msg)) return reject(msg);

  const webhookUrl = process.env.MAKE_INGESTION_WEBHOOK_URL;
  if (!webhookUrl) {
    bot.sendMessage(
      msg.chat.id,
      "⚠️ *MAKE_INGESTION_WEBHOOK_URL not configured.*\nVoice pipeline offline. Set the env var and redeploy.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  bot.sendMessage(msg.chat.id, "🔊 *VOICE MEMO CAPTURED — Firing to Content Factory...*", {
    parse_mode: "Markdown",
  });

  try {
    // 1. Get the downloadable file link from Telegram
    const fileId = msg.voice!.file_id;
    const fileLink = await bot.getFileLink(fileId);

    // 2. POST payload to Make.com Ingestion Webhook
    const payload = {
      source: "telegram_voice",
      audio_url: fileLink,
      file_id: fileId,
      duration_seconds: msg.voice!.duration || 0,
      mime_type: msg.voice!.mime_type || "audio/ogg",
      intent_tag: "auto",
      architect_id: String(msg.from?.id),
      timestamp: new Date().toISOString(),
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      bot.sendMessage(
        msg.chat.id,
        `✅ *VOICE MEMO → FACTORY*\n\n` +
          `Duration: ${payload.duration_seconds}s\n` +
          `File ID: \`${fileId.slice(0, 20)}...\`\n` +
          `Pipeline: Auphonic → Whisper → CrewAI → Supabase\n\n` +
          `You'll get a heartbeat when synthesis completes.`,
        { parse_mode: "Markdown" }
      );
    } else {
      throw new Error(`Make.com returned HTTP ${response.status}`);
    }
  } catch (err: any) {
    bot.sendMessage(
      msg.chat.id,
      `⚠️ *Voice pipeline error:* ${err.message}\n\nFallback: Use \`/synthesize [text]\` to encode manually.`,
      { parse_mode: "Markdown" }
    );
    logGlitch("Critical", `Voice→Make.com pipeline failure: ${err.message}`);
  }
});

// ── Audio Message Handler (voice notes sent as audio files) ──
bot.on("audio", async (msg) => {
  if (!isAuthorized(msg)) return reject(msg);

  const webhookUrl = process.env.MAKE_INGESTION_WEBHOOK_URL;
  if (!webhookUrl) {
    bot.sendMessage(msg.chat.id, "⚠️ Voice pipeline offline. MAKE_INGESTION_WEBHOOK_URL not set.", { parse_mode: "Markdown" });
    return;
  }

  try {
    const fileId = msg.audio!.file_id;
    const fileLink = await bot.getFileLink(fileId);

    const payload = {
      source: "telegram_voice",
      audio_url: fileLink,
      file_id: fileId,
      duration_seconds: msg.audio!.duration || 0,
      mime_type: msg.audio!.mime_type || "audio/mpeg",
      intent_tag: "auto",
      architect_id: String(msg.from?.id),
      timestamp: new Date().toISOString(),
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      bot.sendMessage(msg.chat.id, `✅ *AUDIO FILE → FACTORY*\nPipeline engaged. Heartbeat incoming.`, { parse_mode: "Markdown" });
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err: any) {
    bot.sendMessage(msg.chat.id, `⚠️ Audio pipeline error: ${err.message}`, { parse_mode: "Markdown" });
    logGlitch("Minor", `Audio→Make.com failure: ${err.message}`);
  }
});

// ── Catch-all: Forward unrecognized messages to brain ──
bot.on("message", async (msg) => {
  if (!isAuthorized(msg)) return reject(msg);

  // Skip if it's a command we already handle
  if (msg.text?.startsWith("/")) return;

  // Treat as brain query
  bot.sendChatAction(msg.chat.id, "typing");
  try {
    const response = await brainQuery(msg.text || "");
    const chunks = response.match(/[\s\S]{1,4000}/g) || [response];
    for (const chunk of chunks) {
      await bot.sendMessage(msg.chat.id, chunk);
    }
  } catch (err: any) {
    bot.sendMessage(msg.chat.id, `⚠️ ${err.message}`);
  }
});

// ── Webhook Engine (Heartbeat / Mission Control Integration) ──
const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/heartbeat") {
    let body = "";
    req.on("data", chunk => { body += chunk.toString(); });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const { message, tag } = payload;
        const finalMsg = message || `⚡ *HEARTBEAT RECEIVED*\n\nTag: \`${tag || 'unknown'}\`\n✅ Mission Control Pipeline Success.`;
        
        await bot.sendMessage(AUTHORIZED, finalMsg, { parse_mode: "Markdown" });
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", delivered: true }));
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", error: err.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌐 Gravity Claw Webhook Engine listening on port ${PORT}`);
});

// ── Graceful Shutdown ──
process.on("SIGINT", () => {
  console.log("🛑 Gravity Claw shutting down...");
  server.close();
  bot.stopPolling();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("🛑 Gravity Claw received SIGTERM — shutting down...");
  bot.stopPolling();
  process.exit(0);
});

// ── Uncaught Error Handling ──
process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught Exception:", err);
  logGlitch("Critical", `Uncaught exception: ${err.message}`).catch(() => {});
});

process.on("unhandledRejection", (reason: any) => {
  console.error("💥 Unhandled Rejection:", reason);
  logGlitch("Minor", `Unhandled rejection: ${String(reason)}`).catch(() => {});
});
