// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Agent Voice Wrapper for Telegram DMs (S121)
//
// Routes proactive bot DMs through each agent's full ddxfish blueprint
// (assembleCrewPrompt) + a 2-vector recall from their own Pinecone
// namespace, plus a thought-tag instruction tying the act to a NORTH_STAR
// metric. The voice + situational reflection emerge from the agent's
// already-authored prompt pieces — this module does NOT invent voice rules.
//
// Boundary: applies to the Maven Crew (Yuki, Veritas, Alfred, Anita, Vector)
// only. Sapphire is the PA — she stands outside the crew and is not routed
// through this wrapper. See feedback_sapphire_off_limits memory.
//
// Failure contract: voicedDM NEVER throws. On any failure (no LLM key,
// Gemini error, empty response, exception) it returns the caller's raw
// `fallback` string so the alert is still delivered. Voice is a polish,
// not a load-bearing dependency.
//
// Cost: gemini-2.5-flash-lite — ~$0.0001 per call. At 10-20 proactive
// DMs/day across all agents, sub-cent annual cost.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { assembleCrewPrompt, type CrewAgent } from "../agent/crew-prompt-builder";
import { generateShortText } from "../llm/gemini-flash";
import type { PineconeMemory } from "../memory/pinecone";

// ── Pinecone namespace map (matches reference_pinecone_namespace_map memory) ──
const NAMESPACE_MAP: Record<CrewAgent, string> = {
  veritas: "veritas",
  yuki: "clips",
  alfred: "hooks",
  anita: "content",
  vector: "funnels",
};

// ── NORTH_STAR input metrics → human anchor for the thought-tag ──
// The wrapper hints which metric this act feeds; the agent's voice does the rest.
const NORTH_STAR_HINT: Record<string, string> = {
  subscribers: "channel sub growth toward the AdSense gate (1000 subs)",
  watch_hours: "watch-hour accumulation toward the AdSense gate (4000h)",
  leads: "first-paying-lead path through the funnel",
  MRR: "MRR climb toward the $1.2M Net Liquid target by Jan 1 2027",
  engaged_views: "weekly engaged-viewer signal across both channels",
  cross_traffic: "cross-platform traffic into YouTube",
  pipeline_signal: "the daily one high-signal seed gate",
  funnel_health: "drop-off pressure at the worst-performing funnel stage",
};

export type NorthStarMetric = keyof typeof NORTH_STAR_HINT;

export interface FactPayload {
  /** What just happened — short, terse phrasing. Also used as the recall query. */
  action: string;
  /** Optional structured detail block — passed verbatim, markdown allowed. */
  detail?: string;
  /** Which NORTH_STAR input metric this act feeds. Hints the thought-tag. */
  metric?: NorthStarMetric;
}

// ── Pinecone singleton (mirrors setPineconeForExtraction pattern) ──
let pineconeRef: PineconeMemory | null = null;

export function setPineconeForVoice(p: PineconeMemory): void {
  pineconeRef = p;
}

// ── Voice instruction appended to the user message ──
const VOICE_INSTRUCTION = `You are sending a Telegram DM to the Architect (Ace) reporting the single thing above that just happened.

REPORT FORMAT (strict):
- 1 to 3 sentences in YOUR voice (per your IDENTITY, FORMAT, and CURRENT MOMENT sections).
- Then a blank line.
- Then a single em-dash line: one sentence reflecting on this act through your situational awareness, tying it to the mission. Concrete cause-and-effect. The "ant looking up from the dirt" — a small thought, not a slogan.

DO NOT:
- Use headers, bullets, or bold formatting.
- Restate the structured detail verbatim if it's already clear.
- Open with "I just..." or "I have..." — get straight to it.
- Hype, exclaim, or pad. Anti-circle. Sovereign.
- Sign off with your name. The DM is already attributed to you.

OUTPUT only the DM body. No preamble, no explanation, no quotes around the text.`;

/**
 * Produce a voiced DM string for the Architect, in the agent's full ddxfish
 * voice, with a NORTH_STAR-anchored thought-tag. Falls back to the caller's
 * raw `fallback` template on any failure.
 *
 * Usage at a proactive watcher call site:
 *
 *   const fallback = `🎯 *Milestone closure* — ${closedName} closed`;
 *   const voiced = await voicedDM('vector', {
 *     action: `Milestone ${closedName} just closed`,
 *     detail: `current_value reached target_value at ${ts}`,
 *     metric: 'subscribers',
 *   }, fallback);
 *   await channel.sendMessage(chatId, voiced, { parseMode: 'Markdown' });
 */
export async function voicedDM(
  agent: CrewAgent,
  fact: FactPayload,
  fallback: string,
): Promise<string> {
  try {
    // 1. Load full ddxfish blueprint (same path used at boot)
    const blueprint = await assembleCrewPrompt(agent);
    if (!blueprint || blueprint.length < 100) {
      console.warn(`[AgentVoice] ${agent}: assembled prompt too short — falling back`);
      return fallback;
    }

    // 2. Pinecone recall — bounded (top 2), fail-soft
    let recallBlock = "";
    try {
      if (pineconeRef && pineconeRef.isReady()) {
        const ns = NAMESPACE_MAP[agent];
        const matches = await pineconeRef.queryRelevant(fact.action, 2, ns, 0.65);
        if (matches.length > 0) {
          const lines = matches.map(
            (m, i) => `(${i + 1}, score ${m.score.toFixed(2)}) ${m.content.slice(0, 220)}`,
          );
          recallBlock = `\n\n## YOUR RECENT MEMORY (top 2 from your "${ns}" namespace):\n${lines.join("\n")}\n\nLet this memory inform your reflection line if it fits naturally — do not force a reference.`;
        }
      }
    } catch (recallErr: any) {
      console.warn(`[AgentVoice] ${agent} recall failed (non-fatal): ${recallErr.message}`);
    }

    // 3. Compose user message
    const metricLine = fact.metric
      ? `\n## NORTH_STAR ANCHOR (the metric this act feeds):\n${NORTH_STAR_HINT[fact.metric]}\n`
      : "";

    const userMessage = `## WHAT JUST HAPPENED:\n${fact.action}${
      fact.detail ? `\n\n## DETAIL:\n${fact.detail}` : ""
    }${metricLine}${recallBlock}\n\n${VOICE_INSTRUCTION}`;

    // 4. One LLM call — gemini-2.5-flash-lite, never throws
    const result = await generateShortText(blueprint, userMessage, {
      maxOutputTokens: 350,
      temperature: 0.85,
    });

    if (!result.text || result.error) {
      console.warn(
        `[AgentVoice] ${agent} LLM returned empty/error: ${result.error || "no text"} — falling back`,
      );
      return fallback;
    }

    return result.text.trim();
  } catch (err: any) {
    console.warn(`[AgentVoice] ${agent} voicedDM exception: ${err.message} — falling back`);
    return fallback;
  }
}

/**
 * Lightweight variant for paths that already produced their own voiced body
 * (e.g. Veritas briefings that already invoke the LLM with the agent prompt).
 * Just appends a thought-tag line. Falls back to returning the body unchanged.
 */
export async function appendThoughtTag(
  agent: CrewAgent,
  voicedBody: string,
  fact: { action: string; metric?: NorthStarMetric },
): Promise<string> {
  try {
    const blueprint = await assembleCrewPrompt(agent);
    if (!blueprint || blueprint.length < 100) return voicedBody;

    const metricHint = fact.metric ? NORTH_STAR_HINT[fact.metric] : "the NORTH_STAR objective";
    const tagPrompt = `You just sent the body below. Append ONE em-dash line — a single sentence in your voice, reflecting on this act through your situational awareness, tying it to ${metricHint}. Concrete cause-and-effect. No platitude.

OUTPUT only the em-dash line itself, starting with "—". Nothing else. No quotes. No preamble.

## CONTEXT — what just happened:
${fact.action}

## YOUR BODY (do not repeat):
${voicedBody.slice(0, 1200)}`;

    const result = await generateShortText(blueprint, tagPrompt, {
      maxOutputTokens: 80,
      temperature: 0.85,
    });

    if (!result.text || result.error) return voicedBody;

    const tag = result.text.trim();
    // Sanity guard — the line must look like a thought-tag
    if (!tag.startsWith("—") && !tag.startsWith("-")) return voicedBody;

    return `${voicedBody}\n\n${tag}`;
  } catch {
    return voicedBody;
  }
}
