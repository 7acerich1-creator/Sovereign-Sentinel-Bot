/**
 * verify-state.ts — Sovereign Sentinel Bot Live State Verifier
 *
 * PURPOSE
 * -------
 * The master reference is a human-written markdown file that rots every time
 * a session forgets to update it. This script regenerates `LIVE_STATE.md` from
 * the code itself — the source files are the truth, nothing else.
 *
 * USAGE
 * -----
 *   npm run verify-state            # Regenerates LIVE_STATE.md
 *   npx ts-node scripts/verify-state.ts   # Same thing, no npm script needed
 *
 * PROTOCOL
 * --------
 * Every Claude / agent session MUST run this at session start before trusting
 * any "current state" claim. If LIVE_STATE.md is older than 24h, regenerate.
 * If the master reference contradicts LIVE_STATE, LIVE_STATE wins. Period.
 *
 * WHAT IT INSPECTS
 * ----------------
 * 1. TTS routing chain (src/voice/tts.ts) — which provider fires first
 * 2. Agent LLM teams (src/index.ts) — per-agent provider order
 * 3. Pipeline LLM routing (src/index.ts) — Ace + TCF
 * 4. Critical Railway env vars (presence, not values — never leak secrets)
 * 5. Git commit SHA + branch + dirty status
 * 6. Package metadata (version, engines)
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * - Does NOT call any APIs (no credit burn)
 * - Does NOT read actual env var values (only reports SET / UNSET)
 * - Does NOT try to interpret or summarize — it quotes the source
 *
 * WHY STATIC
 * ----------
 * A parser can drift. A regex can be wrong. A direct quote of the source file
 * cannot lie — if the quote looks different from what the master ref claims,
 * the master ref is wrong. End of debate.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(REPO_ROOT, "LIVE_STATE.md");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function safeRead(relPath: string): string | null {
  const abs = path.join(REPO_ROOT, relPath);
  try {
    return fs.readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
}

function safeExec(cmd: string): string {
  try {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
  } catch (err: any) {
    return `ERROR: ${err.message?.slice(0, 120) ?? "unknown"}`;
  }
}

/**
 * Extract lines from a file between two regex anchors (inclusive).
 * Returns null if start anchor isn't found. Used to pull the literal
 * source of a routing block so we quote the code, not a summary of it.
 */
function extractBlock(
  content: string,
  startRegex: RegExp,
  endRegex: RegExp,
  maxLines = 40
): string | null {
  const lines = content.split("\n");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startRegex.test(lines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  const endLimit = Math.min(startIdx + maxLines, lines.length);
  for (let i = startIdx + 1; i < endLimit; i++) {
    if (endRegex.test(lines[i])) {
      return lines.slice(startIdx, i + 1).join("\n");
    }
  }
  // No end anchor found within maxLines — return what we have
  return lines.slice(startIdx, endLimit).join("\n");
}

function envStatus(name: string): string {
  const v = process.env[name];
  if (v === undefined) return "UNSET";
  if (v === "") return "EMPTY";
  // Never print the actual value for anything that looks like a secret
  if (/KEY|TOKEN|SECRET|PASSWORD|COOKIE/i.test(name)) return "SET (redacted)";
  // Boolean-ish flags — safe to show
  if (/^(true|false|0|1)$/i.test(v)) return `SET = ${v}`;
  return `SET (${v.length} chars)`;
}

function header(title: string): string {
  return `\n## ${title}\n`;
}

function codeBlock(lang: string, body: string): string {
  return "```" + lang + "\n" + body + "\n```\n";
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Inspectors
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function inspectGit(): string {
  const sha = safeExec("git rev-parse HEAD");
  const branch = safeExec("git rev-parse --abbrev-ref HEAD");
  const dirtyRaw = safeExec("git status --porcelain");
  const dirty = dirtyRaw.length > 0 ? `DIRTY (${dirtyRaw.split("\n").length} files)` : "CLEAN";
  const lastCommit = safeExec('git log -1 --pretty=format:"%h %s (%cr)"');

  return (
    header("Git State") +
    `- **Branch:** \`${branch}\`\n` +
    `- **HEAD:** \`${sha}\`\n` +
    `- **Working tree:** ${dirty}\n` +
    `- **Last commit:** ${lastCommit}\n`
  );
}

function inspectTts(): string {
  const src = safeRead("src/voice/tts.ts");
  if (!src) {
    return header("TTS Routing") + `⚠️ Could not read \`src/voice/tts.ts\`.\n`;
  }

  const chainBlock = extractBlock(
    src,
    /const chain: TTSProvider\[\] = \[\]/,
    /for \(const provider of chain\)/,
    30
  );

  const voiceIdMatch = src.match(/const voiceId = config\.voice\.elevenLabsVoiceId \|\| "([^"]+)"/);
  const voiceId = voiceIdMatch ? voiceIdMatch[1] : "(not found)";

  const edgeVoiceMatch = src.match(/const EDGE_VOICE = "([^"]+)"/);
  const edgeVoice = edgeVoiceMatch ? edgeVoiceMatch[1] : "(not found)";

  const forceElevenLabs = envStatus("FORCE_ELEVENLABS");
  const elKey = envStatus("ELEVENLABS_API_KEY");
  const elKeyAlt = envStatus("ELEVENLABS_API_KEY_ALT");

  // Determine actual runtime priority based on the chain logic + env vars
  // Rule from tts.ts lines 41-51: edge is always pushed; elevenlabs is first only if FORCE_ELEVENLABS=true
  let runtimePriority: string;
  const elAvailable = elKey !== "UNSET" || elKeyAlt !== "UNSET";
  if (process.env.FORCE_ELEVENLABS === "true" && elAvailable) {
    runtimePriority = "**elevenlabs → edge → openai** (FORCE_ELEVENLABS=true)";
  } else if (elAvailable) {
    runtimePriority = "**edge → elevenlabs → openai** (FORCE_ELEVENLABS unset/false — Edge fires first)";
  } else {
    runtimePriority = "**edge → openai** (no ElevenLabs key available)";
  }

  let out = header("TTS Routing — src/voice/tts.ts");
  out += `### Runtime Priority (computed from env vars + code)\n${runtimePriority}\n\n`;
  out += `### Voice Identifiers\n`;
  out += `- **ElevenLabs voice ID (source-coded default):** \`${voiceId}\`\n`;
  out += `- **Edge TTS voice (source-coded):** \`${edgeVoice}\`\n\n`;
  out += `### Environment\n`;
  out += `- \`FORCE_ELEVENLABS\`: ${forceElevenLabs}\n`;
  out += `- \`ELEVENLABS_API_KEY\`: ${elKey}\n`;
  out += `- \`ELEVENLABS_API_KEY_ALT\`: ${elKeyAlt}\n\n`;
  out += `### Source Block (verbatim quote of the chain assembly)\n`;
  if (chainBlock) {
    out += codeBlock("typescript", chainBlock);
  } else {
    out += `⚠️ Could not extract chain block from src/voice/tts.ts — the file structure may have changed. Read the file manually.\n`;
  }
  return out;
}

function inspectLlmTeams(): string {
  const src = safeRead("src/index.ts");
  if (!src) {
    return header("Agent LLM Teams") + `⚠️ Could not read \`src/index.ts\`.\n`;
  }

  const teamsBlock = extractBlock(
    src,
    /const AGENT_LLM_TEAMS: Record<string, FailoverLLM> = \{/,
    /^\s*\};/,
    20
  );

  const pipelineBlock = extractBlock(
    src,
    /const pipelineLLM = buildTeamLLM/,
    /const tcfPipelineLLM = buildTeamLLM/,
    5
  );

  const failoverOrder = envStatus("LLM_FAILOVER_ORDER");
  const anthropicKey = envStatus("ANTHROPIC_API_KEY");
  const groqKey = envStatus("GROQ_API_KEY");
  const groqKeyTcf = envStatus("GROQ_API_KEY_TCF");
  const geminiKey = envStatus("GEMINI_API_KEY");
  const openaiKey = envStatus("OPENAI_API_KEY");

  let out = header("Agent LLM Teams — src/index.ts");
  out += `### Environment\n`;
  out += `- \`LLM_FAILOVER_ORDER\`: ${failoverOrder}\n`;
  out += `- \`ANTHROPIC_API_KEY\`: ${anthropicKey}\n`;
  out += `- \`GROQ_API_KEY\`: ${groqKey}\n`;
  out += `- \`GROQ_API_KEY_TCF\`: ${groqKeyTcf}\n`;
  out += `- \`GEMINI_API_KEY\`: ${geminiKey}\n`;
  out += `- \`OPENAI_API_KEY\`: ${openaiKey}\n\n`;

  out += `### AGENT_LLM_TEAMS block (verbatim)\n`;
  if (teamsBlock) {
    out += codeBlock("typescript", teamsBlock);
  } else {
    out += `⚠️ Could not extract AGENT_LLM_TEAMS from src/index.ts — read manually.\n`;
  }

  out += `### Pipeline LLMs (verbatim)\n`;
  if (pipelineBlock) {
    out += codeBlock("typescript", pipelineBlock);
  } else {
    out += `⚠️ Could not extract pipeline LLM lines from src/index.ts — read manually.\n`;
  }
  return out;
}

function inspectCriticalEnvVars(): string {
  const groups: Record<string, string[]> = {
    "Database & Memory": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PINECONE_API_KEY"],
    "Telegram": ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
    "Content Pipeline": [
      "BUFFER_ACCESS_TOKEN",
      "YOUTUBE_COOKIES_BASE64",
      "YOUTUBE_OAUTH_REFRESH_TOKEN",
      "TIKTOK_ACCESS_TOKEN",
      "INSTAGRAM_ACCESS_TOKEN",
    ],
    "Stripe & Revenue": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    "Webhook Bridge": ["MC_WEBHOOK_URL", "WEBHOOK_SHARED_SECRET"],
  };

  let out = header("Critical Environment Variables (presence only)");
  out += `> Only SET / UNSET status is shown. Secret values are never printed.\n\n`;
  for (const [group, names] of Object.entries(groups)) {
    out += `**${group}**\n`;
    for (const name of names) {
      out += `- \`${name}\`: ${envStatus(name)}\n`;
    }
    out += "\n";
  }
  return out;
}

function inspectPackage(): string {
  const raw = safeRead("package.json");
  if (!raw) return header("Package") + `⚠️ package.json not found.\n`;
  try {
    const pkg = JSON.parse(raw);
    return (
      header("Package") +
      `- **Name:** \`${pkg.name}\`\n` +
      `- **Version:** \`${pkg.version}\`\n` +
      `- **Node engine:** \`${pkg.engines?.node ?? "(unspecified)"}\`\n`
    );
  } catch {
    return header("Package") + `⚠️ Could not parse package.json.\n`;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function main(): void {
  // Lazy-load dotenv so the script works even when dotenv isn't installed
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("dotenv").config({ path: path.join(REPO_ROOT, ".env") });
  } catch {
    // dotenv optional — in Railway prod, env vars come from the platform
  }

  const timestamp = new Date().toISOString();

  let md = "";
  md += "# LIVE_STATE.md — Sovereign Sentinel Bot\n\n";
  md += "> **⚡ AUTO-GENERATED.** Do not edit by hand. Run `npm run verify-state` to regenerate.\n";
  md += "> This file is the single source of truth for current runtime state. If the master\n";
  md += "> reference contradicts this file, **this file wins** — the master reference only holds\n";
  md += "> invariants, not live values.\n\n";
  md += `**Last verified:** \`${timestamp}\`\n`;
  md += `**Generator:** \`scripts/verify-state.ts\`\n`;

  md += inspectGit();
  md += inspectPackage();
  md += inspectTts();
  md += inspectLlmTeams();
  md += inspectCriticalEnvVars();

  md += "\n---\n\n";
  md += "## Session-Start Cross-Check Protocol\n\n";
  md += "Every session must run this check against the master reference before trusting any\n";
  md += "\"current state\" claim:\n\n";
  md += "1. Read `SOVEREIGN-SENTINEL-BOT_MASTER-REFERENCE.md`\n";
  md += "2. Read this file (`LIVE_STATE.md`)\n";
  md += "3. If this file is older than 24h → run `npm run verify-state` first\n";
  md += "4. If the master reference's routing/credit claims contradict this file → **this file wins**\n";
  md += "5. Flag the contradiction and patch the master reference before continuing work\n\n";
  md += "This protocol exists because session-authored references rot, and code does not.\n";

  fs.writeFileSync(OUTPUT_PATH, md, "utf-8");
  console.log(`✅ LIVE_STATE.md regenerated at ${OUTPUT_PATH}`);
  console.log(`   ${md.split("\n").length} lines written.`);
}

main();
