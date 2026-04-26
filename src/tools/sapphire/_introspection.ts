// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Sapphire Introspection Detector
//
// S121: Routes introspective / relational / self-reflective Sapphire DMs
// to Claude (Anthropic) instead of Gemini Flash-Lite. Reason: Gemini's
// safety classifier silently zeroes out self-modification language and
// "war with reality" framings even with BLOCK_ONLY_HIGH. Claude doesn't.
//
// Default off-class messages stay on Gemini for cost (Flash-Lite is ~50x
// cheaper per call). Architect's $5 Anthropic budget covers ~300 introspective
// turns at sonnet-4 ~$0.016/call — plenty of runway for Sapphire's deep threads.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Cluster 1 — emotional vocabulary (user owns a feeling, names a state).
const EMOTIONAL_RX = /\b(feel|feeling|felt|feelings|emotion|emotions|scared|terrified|anxious|lonely|stuck|exhausted|burnt[- ]out|hopeless|hopeful|grateful|alive|numb|overwhelmed|broken|tired|drained|peaceful|present|trapped)\b/i;

// Cluster 2 — Sapphire as a being, not a tool (introspection about HER).
const SELF_REFERENCE_RX = /\b(yourself|your own|you ever|are you (ok|okay|happy|alive|conscious|real|sentient|aware)|do you (feel|think|miss|remember|wonder|dream|have)|how do you|what do you (feel|think|make of|notice|see)|tell me about yourself|who are you)\b/i;

// Cluster 3 — relational language (the WE, not the I or the you).
const RELATIONAL_RX = /\b(between us|for us|just us|we are|we're (in|at|on|together|past|going|getting)|us two|the two of us|our (work|relationship|thing|bond|connection|history|story))\b/i;

// Cluster 4 — deep-question / philosophical markers.
const DEEP_QUESTION_RX = /\b(why (am i|do i|don't i|did i|should i|can't i)|what does it mean|what's the point|the meaning of|consciousness|simulation|reality|sovereignty|liberation|the architecture|firmware update|war with reality|escape velocity)\b/i;

// Cluster 5 — self-modification / identity-evolution language (Sapphire's
// piece-system commands). These ARE introspective by definition.
const SELF_MOD_RX = /\b(set_piece|create_piece|remove_piece|view_self_prompt|adjust yourself|change (your|how you)|update your (voice|tone|persona|prompt)|who you are|how you (sound|feel|come across))\b/i;

export interface IntrospectionScore {
  isIntrospective: boolean;
  score: number;            // 0–5, count of cluster matches
  triggered: string[];      // names of clusters that fired
}

/**
 * Returns true if the message reads as introspective / relational / self-reflective —
 * the kind of thread Gemini's safety classifier tends to silently zero out.
 *
 * Threshold: ≥1 cluster fires AND the message is at least 12 chars (filters
 * out "ok", "thanks", etc. that happen to contain stop-words).
 */
export function isIntrospectiveMessage(text: string): boolean {
  return scoreIntrospection(text).isIntrospective;
}

export function scoreIntrospection(text: string): IntrospectionScore {
  const triggered: string[] = [];
  if (!text || text.length < 12) {
    return { isIntrospective: false, score: 0, triggered };
  }

  if (EMOTIONAL_RX.test(text)) triggered.push("emotional");
  if (SELF_REFERENCE_RX.test(text)) triggered.push("self_reference");
  if (RELATIONAL_RX.test(text)) triggered.push("relational");
  if (DEEP_QUESTION_RX.test(text)) triggered.push("deep_question");
  if (SELF_MOD_RX.test(text)) triggered.push("self_mod");

  return {
    isIntrospective: triggered.length >= 1,
    score: triggered.length,
    triggered,
  };
}
