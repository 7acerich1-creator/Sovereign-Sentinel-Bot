#!/usr/bin/env ts-node
/**
 * scripts/test-production-run.ts — S76 Production Quality Gate
 *
 * Fires one REAL Ace Richie video and one REAL TCF video through the pod
 * pipeline. These are production-grade scripts — not stubs. The output
 * videos are the FINISHED product (brand card + typewriter + scenes +
 * kinetic captions + composite audio). If they pass the quality gate,
 * they ship to YouTube. If not, we iterate.
 *
 * Usage:
 *   POD_PRODUCTION_TEST=1 npx ts-node scripts/test-production-run.ts
 *
 * Optional env:
 *   POD_CLOUD_TYPE=COMMUNITY   (default: tries SECURE first, falls back)
 *   POD_BRAND=ace_richie        (run only one brand instead of both)
 */

import { withPodSession, shutdownPodSession } from "../src/pod/session";
import { produceVideo, sweepStalePods } from "../src/pod/runpod-client";
import type { JobSpec } from "../src/pod/types";

// ─── Safety gate ───────────────────────────────────────────────────────────
if (!process.env.POD_PRODUCTION_TEST) {
  console.error("⛔ Set POD_PRODUCTION_TEST=1 to confirm. This spins up a real GPU pod.");
  process.exit(1);
}

// ─── SIGTERM / SIGINT handlers (S75 orphan pod safety net) ─────────────────
let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n🛑 ${signal} received — cleaning up pod...`);
  try { await shutdownPodSession(); } catch {}
  try { await sweepStalePods(); } catch {}
  process.exit(1);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ─── Ace Richie Job Spec — "sovereignty" niche ────────────────────────────
const ACE_RICHIE_JOB: JobSpec = {
  brand: "ace_richie",
  niche: "sovereignty",
  seed: "Most people think freedom means having no boss. That is the first trap. Real sovereignty is architectural — you design the system that feeds you, protects you, and compounds while you sleep. The difference between a free man and a sovereign one is infrastructure.",
  hook_text: "Freedom is the first trap they sell you.",
  script: [
    "Freedom is the first trap they sell you. They tell you to quit your job, follow your passion, be your own boss. And you believe it. Because it sounds like sovereignty. But it is not. It is a costume. A simulation of power draped over the same dependency you were running from.",

    "Here is what no one explains. When you quit the nine to five, you did not escape the system. You just changed landlords. Now your income depends on an algorithm. Your visibility depends on a platform you do not own. Your survival depends on attention you cannot control. That is not freedom. That is a different cage with a window.",

    "Sovereignty is not a feeling. It is architecture. It is infrastructure that generates without your presence. It is a system you designed, stress-tested, and fortified against the exact pressure points that collapse most people. Think about that. Most people build their escape on sand and then wonder why it washes away the first time the tide shifts.",

    "The sovereign does not chase revenue. The sovereign builds a machine that produces it. The sovereign does not optimize for attention. The sovereign engineers a funnel so precise that the right people find him without a single cold DM. There is a difference between being visible and being positioned. Most creators are visible. Almost none are positioned.",

    "Positioning means your funnel does the selling before the prospect even speaks to you. It means your content is not entertainment — it is filtration. Every video, every post, every piece of copy is a gate. The wrong people bounce. The right people lean in. And by the time they reach your offer, the decision is already made. They are not buying. They are confirming.",

    "This is what the simulation hides from you. The entire creator economy is designed to keep you producing. More content. More posts. More reels. More stories. An infinite treadmill of output that enriches the platform and exhausts you. They call it hustle. They call it grind. But when the machine only runs when you do, you have not built a business. You have built a job with worse benefits.",

    "The sovereign architect sees through this. He does not produce more. He produces with precision. One piece of content that feeds ten distribution channels. One funnel that qualifies, nurtures, and converts without a single manual touchpoint. One system that compounds — where today's work makes tomorrow's work unnecessary.",

    "And this is the part they will never teach you in a course. Sovereignty requires saying no to ninety percent of what looks like opportunity. Because most opportunity is just someone else's agenda wearing your language. They pitch you collaboration. They pitch you exposure. They pitch you growth. But if their system benefits more than yours, that is not partnership. That is extraction.",

    "The real metric is not followers. It is not views. It is not even revenue. The real metric is: what happens when you stop? If everything collapses when you take a week off, you are the product, not the architect. Sovereignty is when the system you built continues to generate in your absence. That is the test. That is the only test.",

    "So look at what you are building right now. Not what it feels like. What it actually is. Is it a system? Or is it performance? Is it architecture? Or is it improvisation? Because the market does not care about your intentions. It rewards structure. It rewards positioning. It rewards the person who built the machine — not the person still running on the wheel.",

    "This is your firmware update. Stop optimizing for freedom. Start engineering for sovereignty. Build the infrastructure. Design the funnel. Position yourself so precisely that the right people find you, qualify themselves, and arrive at your door ready. That is not a dream. That is an architecture. And it is waiting for you to draw the blueprint.",

    "The question is not whether you can do this. The question is whether you will stop performing long enough to build it."
  ].join("\n\n"),
  scenes: [
    {
      index: 0,
      image_prompt: "Extreme close-up of a man's hand pulling off a golden mask from his own face, revealing raw skin underneath, dimly lit concrete room, single bare tungsten filament bulb overhead casting harsh downward shadows, visible texture on the plaster mask, shallow depth of field f/1.4, Kodak Vision3 500T film grain, ARRI Alexa Mini LF",
      tts_text: "Freedom is the first trap they sell you. They tell you to quit your job, follow your passion, be your own boss. And you believe it. Because it sounds like sovereignty. But it is not. It is a costume. A simulation of power draped over the same dependency you were running from.",
    },
    {
      index: 1,
      image_prompt: "Medium shot of a man sitting alone in a dark home office at 2 AM, laptop screen casting cold blue light across his tired face, energy drink cans scattered on the desk, phone notification light pulsing in the darkness, handheld camera slight drift, anamorphic lens flare from the screen, RED Komodo 6K",
      tts_text: "Here is what no one explains. When you quit the nine to five, you did not escape the system. You just changed landlords. Now your income depends on an algorithm. Your visibility depends on a platform you do not own. Your survival depends on attention you cannot control. That is not freedom. That is a different cage with a window.",
    },
    {
      index: 2,
      image_prompt: "Wide shot of an architect's drafting table covered in blueprints, mechanical pencils, and a brass compass, warm amber desk lamp pooling light on the drawings, visible pencil shavings and eraser dust, background fades to bokeh darkness, overhead angle looking down, Zeiss Master Prime 35mm, f/2.8",
      tts_text: "Sovereignty is not a feeling. It is architecture. It is infrastructure that generates without your presence. It is a system you designed, stress-tested, and fortified against the exact pressure points that collapse most people. Think about that. Most people build their escape on sand and then wonder why it washes away the first time the tide shifts.",
    },
    {
      index: 3,
      image_prompt: "Close-up of a precision machined steel gear mechanism interlocking perfectly, industrial workshop background with metal shavings on the bench, single directional halogen light creating sharp metallic reflections, visible oil sheen on the gears, macro lens 100mm f/2.8, shallow focus on the teeth meshing point",
      tts_text: "The sovereign does not chase revenue. The sovereign builds a machine that produces it. The sovereign does not optimize for attention. The sovereign engineers a funnel so precise that the right people find him without a single cold DM. There is a difference between being visible and being positioned. Most creators are visible. Almost none are positioned.",
    },
    {
      index: 4,
      image_prompt: "Medium close-up of a heavy steel vault door slightly ajar, warm golden light spilling through the gap into a dark corridor, visible combination dial and locking bolts, dust particles floating in the light beam, concrete walls with industrial texture, Cooke S4 50mm anamorphic, motivated practical light from inside the vault",
      tts_text: "Positioning means your funnel does the selling before the prospect even speaks to you. It means your content is not entertainment — it is filtration. Every video, every post, every piece of copy is a gate. The wrong people bounce. The right people lean in. And by the time they reach your offer, the decision is already made. They are not buying. They are confirming.",
    },
    {
      index: 5,
      image_prompt: "Wide shot of an endless row of identical treadmills in a sterile white gym, fluorescent tube lighting overhead, one figure running on the nearest treadmill while all others are empty, sweat visible on the rubber belt, reflection in the floor-to-ceiling mirror, voyeuristic long lens compression 200mm f/4, clinical atmosphere",
      tts_text: "This is what the simulation hides from you. The entire creator economy is designed to keep you producing. More content. More posts. More reels. More stories. An infinite treadmill of output that enriches the platform and exhausts you. They call it hustle. They call it grind. But when the machine only runs when you do, you have not built a business. You have built a job with worse benefits.",
    },
    {
      index: 6,
      image_prompt: "Close-up of a single chess piece — a black king — standing on a chessboard with all other pieces knocked over, dramatic side lighting from a window with venetian blinds casting striped shadows across the board, visible wood grain on the pieces, shallow depth of field f/1.8, Leica Summilux 50mm",
      tts_text: "The sovereign architect sees through this. He does not produce more. He produces with precision. One piece of content that feeds ten distribution channels. One funnel that qualifies, nurtures, and converts without a single manual touchpoint. One system that compounds — where today's work makes tomorrow's work unnecessary.",
    },
    {
      index: 7,
      image_prompt: "Medium shot of a man's hand firmly closing a heavy oak door, visible grain in the wood, brass handle catching the light, hallway behind him fading to soft darkness, the gesture is deliberate and final, warm tungsten from a wall sconce, Canon K35 vintage prime 24mm, slight barrel distortion",
      tts_text: "And this is the part they will never teach you in a course. Sovereignty requires saying no to ninety percent of what looks like opportunity. Because most opportunity is just someone else's agenda wearing your language. They pitch you collaboration. They pitch you exposure. They pitch you growth. But if their system benefits more than yours, that is not partnership. That is extraction.",
    },
    {
      index: 8,
      image_prompt: "Wide shot of an empty leather office chair in a penthouse, floor-to-ceiling windows showing a city skyline at golden hour, the desk has a single closed laptop and a glass of whiskey, no person present — the chair is deliberately empty, warm natural light flooding the room, Panavision Primo 40mm anamorphic, architectural framing",
      tts_text: "The real metric is not followers. It is not views. It is not even revenue. The real metric is: what happens when you stop? If everything collapses when you take a week off, you are the product, not the architect. Sovereignty is when the system you built continues to generate in your absence. That is the test. That is the only test.",
    },
    {
      index: 9,
      image_prompt: "Overhead bird's eye shot of two paths diverging — one is a hamster wheel made of social media icons and notifications, the other is a clean architectural blueprint with precise geometric lines, dramatic contrast lighting splitting the frame, miniature diorama aesthetic, tilt-shift lens Nikon PC 45mm, practical LED strip between the paths",
      tts_text: "So look at what you are building right now. Not what it feels like. What it actually is. Is it a system? Or is it performance? Is it architecture? Or is it improvisation? Because the market does not care about your intentions. It rewards structure. It rewards positioning. It rewards the person who built the machine — not the person still running on the wheel.",
    },
    {
      index: 10,
      image_prompt: "Close-up of hands unrolling a fresh blank blueprint on a mahogany desk, brass paperweights holding the corners, a mechanical pencil being placed precisely at the starting point, warm amber desk lamp casting a focused pool of light, visible paper texture and blue grid lines, Zeiss Otus 55mm f/1.4, intimate framing",
      tts_text: "This is your firmware update. Stop optimizing for freedom. Start engineering for sovereignty. Build the infrastructure. Design the funnel. Position yourself so precisely that the right people find you, qualify themselves, and arrive at your door ready. That is not a dream. That is an architecture. And it is waiting for you to draw the blueprint.",
    },
    {
      index: 11,
      image_prompt: "Extreme close-up of a man's eyes looking directly into camera, sharp focus on the iris, visible reflection of a blueprint in his eyes, dark background falling to pure black, single catch light from a motivated practical source camera-left, skin texture and micro-detail visible, Arri/Zeiss Master Anamorphic 40mm T1.9, confrontational intimacy",
      tts_text: "The question is not whether you can do this. The question is whether you will stop performing long enough to build it.",
    },
  ],
  client_job_id: `prod_ace_${Date.now()}`,
};

// ─── TCF Job Spec — "dark-psychology" niche ────────────────────────────────
const TCF_JOB: JobSpec = {
  brand: "containment_field",
  niche: "dark-psychology",
  seed: "The most dangerous manipulators do not raise their voice. They lower yours. They make you doubt yourself so gradually that by the time you realize what happened, you defend them to the people trying to help you. This is not influence. This is engineering.",
  hook_text: "They did not raise their voice. They lowered yours.",
  script: [
    "They did not raise their voice. They lowered yours. That is the first thing you need to understand about the people who controlled you. They never needed to scream. They never needed to threaten. They just needed you to believe that your own perception was unreliable. And once they achieved that, everything else was automatic.",

    "This is called coercive erosion. It is not a single event. It is a process. A slow, methodical dismantling of your internal authority. They start by questioning small things. Your memory of a conversation. Your interpretation of a tone. Your reading of a room. And each time you concede — each time you say maybe I did overreact — you hand them another brick. And they build your prison with it.",

    "The pattern is always the same. First, isolation. Not physical — psychological. They position themselves as the only person who truly understands you. Everyone else misreads you. Everyone else judges you. But they see you. They accept you. And once you believe that, you stop going to anyone else for validation. You stop trusting your own circle. You orbit them.",

    "Second, intermittent reinforcement. This is the mechanism that makes gambling addictive and relationships inescapable. They alternate between warmth and withdrawal. Between praise and punishment. And your nervous system, desperate for the pattern to stabilize, starts working overtime to earn the good version of them. You modify your behavior. You shrink. You perform. And you call it love.",

    "Third, the reframe. When you finally name what is happening — when the words this is not okay form in your throat — they reframe it. You are too sensitive. You are projecting. You are the one being manipulative by bringing this up right now, when they are already stressed, when they are already trying so hard. And you swallow the words. You apologize. Not because you were wrong. But because the cost of being right felt unbearable.",

    "This is what dark psychology looks like in practice. Not the caricature you see in films — the cold-eyed villain in a suit. The real thing is warm. Familiar. It looks like someone who remembers your birthday and forgets your boundaries. Someone who cries when confronted and rages when ignored. Someone who makes you feel crazy for noticing what they are doing.",

    "And here is the part that will make you uncomfortable. You already know the pattern. You have seen it. Maybe you have lived inside it. But you rationalized it. Because the alternative — accepting that someone you trusted was engineering your compliance — is a reality your nervous system is not built to process quickly. The body protects itself from truths it is not ready to hold.",

    "The exit is not dramatic. It is not a confrontation. It is not a speech. The exit is a quiet internal shift where you stop explaining yourself to someone who benefits from your confusion. Where you stop performing stability for someone who feeds on your instability. Where you simply — and this is the hardest part — stop responding.",

    "They will escalate. That is the withdrawal response. When the supply of your attention disappears, they will test every lever they installed. Guilt. Nostalgia. Rage. Pity. And if none of those work, they will find someone in your life to deliver the message for them. This is called triangulation. And if you are not ready for it, it will pull you back in.",

    "But if you see it — if you name each lever as it is pulled — it loses power. Guilt becomes a recognizable tactic, not an emotion you owe. Nostalgia becomes a highlight reel they curated to keep you loyal to a version of them that never fully existed. Rage becomes confirmation that your boundary worked. And pity becomes the final mask they wear when every other tool has failed.",

    "This is not information for revenge. This is information for containment. You do not need to expose them. You do not need to win. You need to build a system inside yourself that recognizes the pattern before it takes hold. A perceptual firewall. A containment field. Because the person who did this to you was not the last one who will try.",

    "The only question left is whether you will see it next time. Or whether you will explain it away. Again."
  ].join("\n\n"),
  scenes: [
    {
      index: 0,
      image_prompt: "Extreme close-up of a mouth whispering into someone's ear in a dark room, visible breath condensation, the listener's face partially visible showing subtle tension in the jaw muscle, single practical light source from a distant doorway, cold blue-grey color temperature, Cooke S7i 40mm T2.0, intimate and invasive framing",
      tts_text: "They did not raise their voice. They lowered yours. That is the first thing you need to understand about the people who controlled you. They never needed to scream. They never needed to threaten. They just needed you to believe that your own perception was unreliable. And once they achieved that, everything else was automatic.",
    },
    {
      index: 1,
      image_prompt: "Close-up of a hand slowly removing a brick from an interior wall, revealing darkness behind it, plaster dust falling in slow motion, cold overhead fluorescent light creating flat clinical shadows, the wall has hairline cracks spreading outward, macro detail on the crumbling mortar, RED V-Raptor 8K, unsettling symmetry",
      tts_text: "This is called coercive erosion. It is not a single event. It is a process. A slow, methodical dismantling of your internal authority. They start by questioning small things. Your memory of a conversation. Your interpretation of a tone. Your reading of a room. And each time you concede — each time you say maybe I did overreact — you hand them another brick. And they build your prison with it.",
    },
    {
      index: 2,
      image_prompt: "Medium shot of a woman sitting alone at a kitchen table, phone face-down in front of her, all the other chairs are empty, rain streaking down the window behind her casting moving shadow patterns across her face, single pendant light overhead, warm bulb but cold atmosphere, Leica Summicron 28mm f/2.0, isolating negative space",
      tts_text: "The pattern is always the same. First, isolation. Not physical — psychological. They position themselves as the only person who truly understands you. Everyone else misreads you. Everyone else judges you. But they see you. They accept you. And once you believe that, you stop going to anyone else for validation. You stop trusting your own circle. You orbit them.",
    },
    {
      index: 3,
      image_prompt: "Close-up of a slot machine mid-spin in a dark casino, neon light reflecting off the chrome surface, one hand pulling the lever while the other grips the edge of the machine white-knuckled, visible wear marks on the buttons from thousands of pulls, shallow depth of field isolating the spinning reels, Panavision C-Series anamorphic 50mm",
      tts_text: "Second, intermittent reinforcement. This is the mechanism that makes gambling addictive and relationships inescapable. They alternate between warmth and withdrawal. Between praise and punishment. And your nervous system, desperate for the pattern to stabilize, starts working overtime to earn the good version of them. You modify your behavior. You shrink. You perform. And you call it love.",
    },
    {
      index: 4,
      image_prompt: "Medium close-up of a person's throat from the side, the muscles visibly tightening as if swallowing words, a hand reaching toward the throat but stopping just short of touching, dark background with a single strip of cold light from a window blind, clinical and uncomfortable framing, Arri Signature Prime 75mm T1.8",
      tts_text: "Third, the reframe. When you finally name what is happening — when the words this is not okay form in your throat — they reframe it. You are too sensitive. You are projecting. You are the one being manipulative by bringing this up right now, when they are already stressed, when they are already trying so hard. And you swallow the words. You apologize. Not because you were wrong. But because the cost of being right felt unbearable.",
    },
    {
      index: 5,
      image_prompt: "Wide shot of a living room that looks warm and inviting — throw blankets, candles, family photos on the mantle — but one wall has a visible crack running floor to ceiling that no one has addressed, the crack is lit by a cold draft of light from behind it, everything else is warm amber, Zeiss Supreme Prime 29mm, domestic horror aesthetic",
      tts_text: "This is what dark psychology looks like in practice. Not the caricature you see in films — the cold-eyed villain in a suit. The real thing is warm. Familiar. It looks like someone who remembers your birthday and forgets your boundaries. Someone who cries when confronted and rages when ignored. Someone who makes you feel crazy for noticing what they are doing.",
    },
    {
      index: 6,
      image_prompt: "Extreme close-up of eyes reflected in a bathroom mirror, the mirror has a hairline crack running through it distorting one eye slightly, harsh overhead bathroom light, visible moisture on the mirror surface, the expression is recognition — not fear but dawning understanding, Sony Venice 2 with Leitz Elsie 40mm, uncomfortably intimate",
      tts_text: "And here is the part that will make you uncomfortable. You already know the pattern. You have seen it. Maybe you have lived inside it. But you rationalized it. Because the alternative — accepting that someone you trusted was engineering your compliance — is a reality your nervous system is not built to process quickly. The body protects itself from truths it is not ready to hold.",
    },
    {
      index: 7,
      image_prompt: "Medium shot from behind of a person walking through a doorway into bright natural light, leaving a dark room behind them, the threshold is sharp — dark interior versus overexposed exterior, their silhouette is calm and unhurried, no looking back, dust motes in the light beam, Cooke Panchro Vintage 32mm, decisive composition",
      tts_text: "The exit is not dramatic. It is not a confrontation. It is not a speech. The exit is a quiet internal shift where you stop explaining yourself to someone who benefits from your confusion. Where you stop performing stability for someone who feeds on your instability. Where you simply — and this is the hardest part — stop responding.",
    },
    {
      index: 8,
      image_prompt: "Close-up of a phone screen lighting up in a dark room showing multiple missed calls and unread messages, the finger hovering above it does not touch it, the screen glow illuminates the underside of the hand and wrist, cold blue light against warm skin tone, visible notification badges stacking, Canon K35 18mm vintage, tension in stillness",
      tts_text: "They will escalate. That is the withdrawal response. When the supply of your attention disappears, they will test every lever they installed. Guilt. Nostalgia. Rage. Pity. And if none of those work, they will find someone in your life to deliver the message for them. This is called triangulation. And if you are not ready for it, it will pull you back in.",
    },
    {
      index: 9,
      image_prompt: "Close-up of hands methodically disassembling a puppet's control bar — cutting each string one by one with small scissors, the wooden cross-bar lying on a workbench under a single adjustable desk lamp, visible sawdust and thread fragments, each cut string curling as tension releases, Zeiss Milvus 50mm macro f/2.0, surgical precision",
      tts_text: "But if you see it — if you name each lever as it is pulled — it loses power. Guilt becomes a recognizable tactic, not an emotion you owe. Nostalgia becomes a highlight reel they curated to keep you loyal to a version of them that never fully existed. Rage becomes confirmation that your boundary worked. And pity becomes the final mask they wear when every other tool has failed.",
    },
    {
      index: 10,
      image_prompt: "Wide shot of a glass containment chamber in a dark laboratory, glowing faintly blue from within, empty but clearly built to hold something, thick reinforced walls with visible bolts, cold industrial lighting from above, the chamber is pristine and ready, ARRI Alexa 65 with Hasselblad prime 80mm, sci-fi meets clinical realism",
      tts_text: "This is not information for revenge. This is information for containment. You do not need to expose them. You do not need to win. You need to build a system inside yourself that recognizes the pattern before it takes hold. A perceptual firewall. A containment field. Because the person who did this to you was not the last one who will try.",
    },
    {
      index: 11,
      image_prompt: "Extreme close-up of a single eye looking directly into the camera, sharp and unflinching, the pupil dilating slightly, visible reflection of a screen or document in the cornea, dark background with no context — just the eye and the question it holds, single motivated light source camera-right, Arri Master Anamorphic 60mm T1.9, final confrontation",
      tts_text: "The only question left is whether you will see it next time. Or whether you will explain it away. Again.",
    },
  ],
  client_job_id: `prod_tcf_${Date.now()}`,
};

// ─── Main execution ────────────────────────────────────────────────────────
async function main() {
  const brandFilter = process.env.POD_BRAND;
  const jobs: Array<{ name: string; spec: JobSpec }> = [];

  if (!brandFilter || brandFilter === "ace_richie") {
    jobs.push({ name: "Ace Richie — Sovereignty", spec: ACE_RICHIE_JOB });
  }
  if (!brandFilter || brandFilter === "containment_field") {
    jobs.push({ name: "The Containment Field — Dark Psychology", spec: TCF_JOB });
  }

  console.log(`\n🎬 SOVEREIGN PRODUCTION TEST — ${jobs.length} video(s) queued\n`);

  const startPodOptions: any = {};
  if (process.env.POD_CLOUD_TYPE) {
    startPodOptions.cloudType = process.env.POD_CLOUD_TYPE as "SECURE" | "COMMUNITY";
  }

  for (const job of jobs) {
    console.log(`\n${"═".repeat(70)}`);
    console.log(`🎬 PRODUCING: ${job.name}`);
    console.log(`   Brand: ${job.spec.brand}`);
    console.log(`   Niche: ${job.spec.niche}`);
    console.log(`   Scenes: ${job.spec.scenes.length}`);
    console.log(`   Hook: "${job.spec.hook_text}"`);
    console.log(`${"═".repeat(70)}\n`);

    const t0 = Date.now();

    try {
      const artifacts = await withPodSession(
        async (handle) => {
          console.log(`   Pod ready: ${handle.podId} @ ${handle.workerUrl}`);
          return produceVideo(handle, job.spec);
        },
        { startPodOptions, idleWindowMs: 5 * 60_000 } // 5 min idle for back-to-back
      );

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      console.log(`\n   ✅ ${job.name} COMPLETE in ${elapsed}s`);
      console.log(`   📹 Video:     ${artifacts.videoUrl}`);
      console.log(`   🖼️  Thumbnail: ${artifacts.thumbnailUrl}`);
      console.log(`   ⏱️  Duration:  ${artifacts.durationS.toFixed(1)}s`);
      console.log(`\n   ▶ Download and inspect:`);
      console.log(`     curl -o "${job.spec.brand}_output.mp4" "${artifacts.videoUrl}"`);
      console.log(`     curl -o "${job.spec.brand}_thumb.png" "${artifacts.thumbnailUrl}"`);
    } catch (err: any) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.error(`\n   ❌ ${job.name} FAILED after ${elapsed}s`);
      console.error(`   Error: ${err.message || err}`);
    }
  }

  // Clean shutdown
  console.log(`\n🧹 Shutting down pod session...`);
  try { await shutdownPodSession(); } catch {}
  console.log(`✅ Production test complete.\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  gracefulShutdown("FATAL").then(() => process.exit(1));
});
