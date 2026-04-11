// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SESSION 47b — INGEST-IDEA: Manual Native Seed Injection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// The Architect's manual override channel into the Native Seed Generator pipeline.
//
// Wraps a raw thesis string in the EXACT same raw_idea payload format Alfred uses
// after the Session 47b pivot, and pushes it directly into the VidRush pipeline to
// trigger a full video cycle. Bypasses Telegram, bypasses Alfred, bypasses Whisper.
//
// Usage:
//   npx tsx scripts/ingest-idea.ts "The concept of biological drag in corporate environments"
//
// Optional flags:
//   --brand=ace_richie | --brand=containment_field   (default: ace_richie)
//   --brand=both                                       (run both sequentially)
//   --niche=dark_psychology|self_improvement|burnout|quantum   (override auto-detection)
//   --dry                                              (use dryrun mode — stubs all APIs)
//
// Examples:
//   npx tsx scripts/ingest-idea.ts "The corporate ladder is a Faraday cage"
//   npx tsx scripts/ingest-idea.ts "Quiet quitting is the body's rebellion against simulation parameters" --brand=both
//   npx tsx scripts/ingest-idea.ts "Narcissist gaslighting follows a 4-stage frequency lock" --niche=dark_psychology --dry
//
// Requires the same env vars as the live bot:
//   GROQ_API_KEY (for pipeline LLM), ANTHROPIC_API_KEY (failover),
//   ELEVENLABS_API_KEY or Edge TTS, GEMINI_IMAGEN_KEY, etc.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Load .env FIRST — before any module reads process.env.
import "dotenv/config";

import { createHash } from "crypto";
import { config } from "../src/config";
import { createProvider } from "../src/llm/providers";
import { FailoverLLM } from "../src/llm/failover";
import { executeFullPipeline } from "../src/engine/vidrush-orchestrator";
import type { LLMProvider } from "../src/types";
import type { Brand } from "../src/engine/faceless-factory";

// ── Argument parsing ──
const args = process.argv.slice(2);
const flags = new Set<string>();
const flagValues: Record<string, string> = {};
const positional: string[] = [];

for (const arg of args) {
  if (arg.startsWith("--")) {
    const eqIdx = arg.indexOf("=");
    if (eqIdx > 0) {
      flagValues[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
    } else {
      flags.add(arg.slice(2));
    }
  } else {
    positional.push(arg);
  }
}

const rawIdea = positional.join(" ").trim();

if (!rawIdea) {
  console.error("❌ Usage: npx tsx scripts/ingest-idea.ts \"<your thesis here>\" [--brand=ace_richie|containment_field|both] [--niche=...] [--dry]");
  console.error("");
  console.error("Example:");
  console.error("  npx tsx scripts/ingest-idea.ts \"The concept of biological drag in corporate environments\"");
  process.exit(1);
}

const brandFlag = (flagValues.brand || "ace_richie").toLowerCase();
const validBrands: Record<string, Brand[]> = {
  ace_richie: ["ace_richie"],
  containment_field: ["containment_field"],
  tcf: ["containment_field"],
  both: ["ace_richie", "containment_field"],
  dual: ["ace_richie", "containment_field"],
};
const brandsToRun: Brand[] | undefined = validBrands[brandFlag];
if (!brandsToRun) {
  console.error(`❌ Invalid --brand value: "${brandFlag}". Use ace_richie | containment_field | both`);
  process.exit(1);
}

const nicheOverride = flagValues.niche || undefined;
const dryRun = flags.has("dry") || flags.has("dryrun") || flags.has("dry-run");

// ── Build the same pipeline LLM the live bot uses ──
// Mirror src/index.ts buildTeamLLM(["groq", "anthropic"], 1) — Groq-first, Anthropic failover.
function buildPipelineLLM(): FailoverLLM {
  const llmTimeoutMs = parseInt(process.env.LLM_TIMEOUT_MS || "60000", 10);
  const chain: LLMProvider[] = [];

  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey && config.llm.providers.groq) {
    chain.push(createProvider("groq", groqKey, config.llm.providers.groq.model, config.llm.providers.groq.baseUrl));
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey && config.llm.providers.anthropic) {
    chain.push(createProvider("anthropic", anthropicKey, config.llm.providers.anthropic.model));
  }
  if (chain.length === 0) {
    console.error("❌ No LLM providers configured. Set GROQ_API_KEY and/or ANTHROPIC_API_KEY.");
    process.exit(1);
  }
  // primaryRetries=1 matches the live pipelineLLM in src/index.ts.
  return new FailoverLLM(chain, llmTimeoutMs, 1);
}

// ── Synthetic identifier (matches the bridge's hashing strategy) ──
const ideaHash = createHash("sha1").update(rawIdea).digest("hex").slice(0, 10);
const syntheticId = `raw_${ideaHash}`;

async function main() {
  const ideaPreview = rawIdea.length > 140 ? rawIdea.slice(0, 140) + "…" : rawIdea;
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🌱 NATIVE SEED INGESTION — Manual Override (Session 47b)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Synthetic ID:   ${syntheticId}`);
  console.log(`Brands:         ${brandsToRun!.join(" → ")}`);
  console.log(`Niche override: ${nicheOverride || "(auto-detect)"}`);
  console.log(`Mode:           ${dryRun ? "DRY RUN (no APIs burned)" : "LIVE"}`);
  console.log(`Seed:           "${ideaPreview}"`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");

  const llm = buildPipelineLLM();
  const totalStart = Date.now();
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < brandsToRun!.length; i++) {
    const brand = brandsToRun![i];
    const brandLabel = brand === "containment_field" ? "THE CONTAINMENT FIELD" : "ACE RICHIE";

    if (i > 0) {
      const cooldownMs = parseInt(process.env.PIPELINE_COOLDOWN_MS || "180000", 10);
      const cooldownSec = Math.round(cooldownMs / 1000);
      console.log(`\n⏳ Inter-brand cooldown: ${cooldownSec}s before ${brandLabel}...\n`);
      await new Promise(r => setTimeout(r, cooldownMs));
    }

    console.log(`\n--- ${brandLabel} PIPELINE (raw_idea) ---\n`);

    try {
      const result = await executeFullPipeline(
        syntheticId,
        llm,
        brand,
        async (step: string, detail: string) => {
          console.log(`  [${brandLabel}] ${step}: ${detail}`);
        },
        {
          rawIdea,                                  // ← The Native Seed Generator entry point
          niche: nicheOverride,                      // Optional override
          dryRun,
        }
      );

      console.log("");
      console.log(`✅ ${brandLabel} COMPLETE`);
      console.log(`   YouTube:    ${result.youtubeUrl || "(no upload)"}`);
      console.log(`   Clips:      ${result.clipCount}`);
      console.log(`   Buffer:     ${result.bufferScheduled} scheduled`);
      console.log(`   Duration:   ${result.duration.toFixed(1)}s`);
      if (result.errors.length > 0) {
        console.log(`   Issues:     ${result.errors.length}`);
        for (const e of result.errors) console.log(`     - ${e}`);
      }
      successCount++;
    } catch (err: any) {
      console.error(`\n❌ ${brandLabel} PIPELINE CRASHED: ${err.message}`);
      if (err.stack) console.error(err.stack.split("\n").slice(0, 5).join("\n"));
      failureCount++;
      // Continue to next brand even if this one failed.
    }
  }

  const totalSec = ((Date.now() - totalStart) / 1000).toFixed(1);
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`🌱 INGESTION COMPLETE — ${successCount} ok, ${failureCount} failed, ${totalSec}s total`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  process.exit(failureCount > 0 && successCount === 0 ? 1 : 0);
}

main().catch((err: any) => {
  console.error(`\n❌ ingest-idea fatal: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
