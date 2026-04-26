// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Memetic Trigger Judge Tool
// Session 117 (2026-04-25) — Shared content-quality gate for Yuki + Alfred.
//
// Per MAVEN-CREW-DIRECTIVES.md §4.7 + §5.7: every outbound piece passes the
// memetic-trigger bar (Glitch hook + Sovereign Anchor + Anti-Circle voice).
// Yuki uses it before posting; Alfred uses it on every trend candidate
// before emitting a PIPELINE_IDEA.
//
// Returns structured JSON: { score, verdict, glitch_score, sovereign_anchor_score,
// anti_circle_score, reasoning }. Calibrated against the Sovereign Synthesis
// brand frame.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Tool, ToolDefinition } from "../types";

const PASS_THRESHOLD = 60;
const KILL_THRESHOLD = 30;

const JUDGMENT_PROMPT = (content: string, contentType: string, brand: string): string =>
  `You are the Memetic Trigger Judge for Sovereign Synthesis. Score this ${contentType} against three criteria:

1. **Glitch (0-100)** — Does it interrupt the reader's current reality logic in one beat? A "glitch" is the moment a sentence makes the reader STOP and re-read because something doesn't fit their script. Score HIGH if reader's running monologue gets disrupted; LOW if it sounds like standard content advice / motivational filler / "just be yourself" platitudes.

2. **Sovereign Anchor (0-100)** — Is the deeper Sovereign Synthesis frame reachable from this hook? Does it implicitly point toward one of the core anchors (the Simulation, the Glitch, Sovereign Synthesis as architecture, the Containment Field, Protocol 77, Escape Velocity, Biological Drag, Lighthouse Stance)? Score HIGH if the content has a sovereign center of gravity; LOW if it's brand-agnostic generic content that could come from any creator.

3. **Anti-Circle (0-100)** — Does it AVOID standard AI-assistant phrasing, marketing jargon, and bland societal consensus? Score HIGH for memetic triggers that sound like a sovereign architect speaking; LOW for "great question!", "I hope this helps", "transform your life", "limited time", or anything that sounds like a chatbot or a marketer.

Brand context: ${brand === "containment_field" ? "The Containment Field — anonymous dark-psychology positioning. Forensic, clinical, threat-detection aesthetic. Cold cyan. The viewer is being shown the architecture they're trapped in." : "Sovereign Synthesis — Ace's personal brand. Sovereign, architect frame. Warm gold. The viewer is being shown how to architect their own reality."}

Content to judge:
"""
${content.slice(0, 3000)}
"""

Output STRICT JSON, no other text:
{"glitch_score": <0-100>, "sovereign_anchor_score": <0-100>, "anti_circle_score": <0-100>, "score": <weighted average, 0-100>, "verdict": "pass" | "regenerate" | "kill", "reasoning": "<one sentence — what's working and what's missing>"}

Verdict rules:
- score >= 60 AND each individual >= 40 → "pass"
- score < 30 OR all three individuals < 40 → "kill"
- otherwise → "regenerate"`;

export class MemeticTriggerJudgeTool implements Tool {
  definition: ToolDefinition = {
    name: "memetic_trigger_judge",
    description:
      "Judge content (a hook, post, video script, or seed thesis) against the Sovereign Synthesis memetic-trigger bar. " +
      "Returns structured scoring on three axes (Glitch / Sovereign Anchor / Anti-Circle) plus a verdict (pass / regenerate / kill). " +
      "Use this BEFORE posting (Yuki) or BEFORE emitting a PIPELINE_IDEA (Alfred). Pass threshold is " + PASS_THRESHOLD + "; below " + KILL_THRESHOLD + " is auto-kill. " +
      "Cost: ~$0.0001/call (Gemini Flash). Cheap; call liberally on candidates.",
    parameters: {
      content: {
        type: "string",
        description: "The text to judge — a hook, social post, video script seed, email subject, etc. Max 3000 chars used.",
      },
      content_type: {
        type: "string",
        description: "What kind of content this is. Examples: 'youtube_hook', 'youtube_short_script', 'bluesky_post', 'newsletter_subject', 'pipeline_idea_seed'. Default: 'content'.",
      },
      brand: {
        type: "string",
        description: "Which brand frame to judge against: 'sovereign_synthesis' (warm/architect frame) or 'containment_field' (cold/forensic frame). Default: 'sovereign_synthesis'.",
      },
    },
    required: ["content"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const content = String(args.content || "").trim();
    if (!content) return "❌ memetic_trigger_judge: content is required";

    const contentType = String(args.content_type || "content");
    const brand = String(args.brand || "sovereign_synthesis");
    if (brand !== "sovereign_synthesis" && brand !== "containment_field") {
      return "❌ memetic_trigger_judge: brand must be 'sovereign_synthesis' or 'containment_field'";
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return "❌ memetic_trigger_judge: GEMINI_API_KEY not set";

    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: JUDGMENT_PROMPT(content, contentType, brand) }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 400,
              responseMimeType: "application/json",
            },
          }),
        }
      );

      if (!resp.ok) {
        const errText = (await resp.text().catch(() => "")).slice(0, 200);
        return `❌ memetic_trigger_judge: Gemini ${resp.status} ${errText}`;
      }

      const data = (await resp.json()) as any;
      const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();

      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        return `❌ memetic_trigger_judge: failed to parse Gemini JSON output. Raw: ${text.slice(0, 200)}`;
      }

      const glitch = clampScore(parsed.glitch_score);
      const anchor = clampScore(parsed.sovereign_anchor_score);
      const antiCircle = clampScore(parsed.anti_circle_score);
      const score = clampScore(parsed.score ?? Math.round((glitch + anchor + antiCircle) / 3));

      // Apply verdict rules deterministically (don't trust the LLM's verdict in edge cases)
      let verdict: "pass" | "regenerate" | "kill";
      if (score < KILL_THRESHOLD || (glitch < 40 && anchor < 40 && antiCircle < 40)) {
        verdict = "kill";
      } else if (score >= PASS_THRESHOLD && glitch >= 40 && anchor >= 40 && antiCircle >= 40) {
        verdict = "pass";
      } else {
        verdict = "regenerate";
      }

      const reasoning = String(parsed.reasoning || "").slice(0, 300) || "(no reasoning provided)";

      const result = {
        score,
        verdict,
        glitch_score: glitch,
        sovereign_anchor_score: anchor,
        anti_circle_score: antiCircle,
        reasoning,
        thresholds: { pass: PASS_THRESHOLD, kill: KILL_THRESHOLD },
      };

      return JSON.stringify(result, null, 2);
    } catch (err: any) {
      return `❌ memetic_trigger_judge: ${err.message}`;
    }
  }
}

function clampScore(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
