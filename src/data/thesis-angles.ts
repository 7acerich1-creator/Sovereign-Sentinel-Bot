// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Thesis Angle Seeds — 16 niches x 15-20 angles each
// Feeds the faceless video pipeline with deeply specific,
// non-overlapping thesis seeds so every video is unique.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { Brand } from "../pod/types";

export interface ThesisAngle {
  /** A short label for tracking (e.g., "health-insurance-hostage") */
  id: string;
  /** The rich thesis seed — 2-4 sentences that give the LLM a SPECIFIC angle to build a completely unique video around */
  seed: string;
  /** Keywords for dedup/search */
  keywords: string[];
}

export const THESIS_ANGLES: Record<Brand, Record<string, ThesisAngle[]>> = {
  // ═══════════════════════════════════════════════════
  // ACE RICHIE / SOVEREIGN SYNTHESIS
  // ═══════════════════════════════════════════════════
  ace_richie: {
    // ─────────────────────────────────────────────────
    // SOVEREIGNTY
    // ─────────────────────────────────────────────────
    "sovereignty": [
      {
        id: "permission-withdrawal-reflex",
        seed: "Most people never notice the moment they ask for permission to do something that requires none. The permission-withdrawal reflex is trained into children by age four and never uninstalled. Every time you phrase a statement of intent as a question — 'Would it be okay if I...' — you are running legacy software that routes your agency through someone else's approval server. Sovereignty begins the instant you stop converting declarations into requests.",
        keywords: ["permission", "reflex", "agency", "approval", "conditioning"],
      },
      {
        id: "borrowed-identity-stack",
        seed: "Your personality is a stack of borrowed identity fragments — your father's risk tolerance, your teacher's definition of success, your first boss's model of professionalism. None of these were chosen; they were inherited through proximity and repeated until they felt like 'you.' The sovereign mind audits every layer of this stack and asks: did I install this, or was it installed in me?",
        keywords: ["identity", "inherited", "personality", "audit", "conditioning"],
      },
      {
        id: "comfort-as-sedative",
        seed: "Comfort is not a reward. It is a sedative administered in precise doses to prevent you from noticing that your life has no trajectory. The system does not need to imprison you if it can make the cage warm enough. The most dangerous moment in a sovereign's life is when they mistake the absence of pain for the presence of freedom.",
        keywords: ["comfort", "sedative", "cage", "freedom", "trajectory"],
      },
      {
        id: "opinion-rental-economy",
        seed: "Most people do not hold opinions — they rent them from the last confident voice they encountered. The opinion-rental economy is the largest invisible market on earth. People will defend positions they adopted seventy-two hours ago as though they were core values. Sovereignty requires you to trace every belief back to its point of installation and ask whether it pays rent or just occupies space.",
        keywords: ["opinions", "beliefs", "rental", "influence", "conviction"],
      },
      {
        id: "the-exit-cost-illusion",
        seed: "The cost of leaving any system — a job, a relationship, a city, a belief — is almost always a fiction maintained by the system itself. Sunk cost is not an economic principle when applied to your life; it is a hostage negotiation tactic. The cage door is rarely locked. The lock is the story you were told about what happens to people who walk through it.",
        keywords: ["exit cost", "sunk cost", "leaving", "illusion", "hostage"],
      },
      {
        id: "sovereignty-vs-independence",
        seed: "Independence is a reaction — it defines itself by what it rejects. Sovereignty is a frequency — it defines itself by what it generates. The independent person says 'I don't need anyone.' The sovereign person says 'I choose my dependencies consciously.' One is running from the system; the other has built their own.",
        keywords: ["independence", "sovereignty", "frequency", "choice", "generation"],
      },
      {
        id: "the-consensus-tax",
        seed: "Every decision you route through consensus costs you speed, clarity, and originality. The consensus tax is invisible but compounding — over a decade, the person who asks five people before every move has lived someone else's averaged-out life. The median of everyone's opinion is mediocrity with extra steps.",
        keywords: ["consensus", "decision", "speed", "mediocrity", "averaging"],
      },
      {
        id: "the-legibility-trap",
        seed: "The pressure to make your life legible to others — explainable at dinner parties, summarizable in a LinkedIn headline — is a sovereignty leak disguised as social grace. The most powerful moves in a life are the ones that cannot be explained in a sentence. If everyone understands your path, you are on a path that was built for everyone.",
        keywords: ["legibility", "explanation", "social pressure", "path", "uniqueness"],
      },
      {
        id: "the-alarm-clock-test",
        seed: "There is a single diagnostic that reveals whether you are sovereign or managed: do you wake up to an alarm, or does the alarm wake up to you? This is not about sleep schedules. It is about whether your day begins with an act of obedience to a schedule you did not design. The sovereign architected the container before they stepped inside it.",
        keywords: ["alarm", "schedule", "obedience", "design", "diagnostic"],
      },
      {
        id: "emotional-outsourcing",
        seed: "Emotional outsourcing is the practice of making another person responsible for your internal state. 'You made me feel...' is the syntax of someone who has handed the controls of their nervous system to an external operator. Sovereignty over emotion does not mean suppression — it means you stop giving other people's behavior write access to your operating system.",
        keywords: ["emotions", "outsourcing", "responsibility", "nervous system", "control"],
      },
      {
        id: "the-apprenticeship-hangover",
        seed: "Most people spend their twenties in apprenticeship mode — absorbing, obeying, proving — and then never switch out of it. The apprenticeship hangover is the condition of a forty-year-old still waiting to be told they are ready. No one is coming to knight you. The ceremony you are waiting for was cancelled the day you became capable of performing it yourself.",
        keywords: ["apprenticeship", "readiness", "waiting", "authority", "transition"],
      },
      {
        id: "the-respectability-harness",
        seed: "Respectability is a harness designed to keep your ambition within the boundaries of what your social class finds acceptable. It whispers that certain kinds of wealth are vulgar, certain kinds of ambition are unseemly, certain kinds of visibility are narcissistic. The harness feels like taste. It functions as a ceiling.",
        keywords: ["respectability", "class", "ambition", "ceiling", "social norms"],
      },
      {
        id: "decision-debt-accumulation",
        seed: "Every decision you defer does not disappear — it accrues interest in the form of anxiety, lost optionality, and identity erosion. Decision debt is the silent mortgage most people carry: hundreds of unmade choices sitting in a mental queue, each one draining processing power while producing nothing. The sovereign clears the queue daily, even when the answer is uncomfortable.",
        keywords: ["decisions", "debt", "anxiety", "optionality", "procrastination"],
      },
      {
        id: "the-tribe-gravity-well",
        seed: "Every social group exerts a gravitational pull toward its median. The tribe does not punish you for failing — it punishes you for succeeding too visibly. The correction is subtle: a joke about your ambition, a raised eyebrow at your new vocabulary, a slow withdrawal of warmth when you stop fitting the role they assigned you. Sovereignty requires escape velocity from the gravity well of your origin tribe.",
        keywords: ["tribe", "gravity", "median", "social punishment", "escape velocity"],
      },
      {
        id: "the-safety-performance",
        seed: "Safety is the most expensive performance a human can run. The energy required to maintain the appearance of having no enemies, no controversial positions, and no sharp edges exceeds the energy required to simply build something worth attacking. The safe person is not protected — they are invisible. And invisibility, compounded over decades, is indistinguishable from nonexistence.",
        keywords: ["safety", "performance", "invisibility", "risk", "nonexistence"],
      },
    ],

    // ─────────────────────────────────────────────────
    // AUTHORITY
    // ─────────────────────────────────────────────────
    "authority": [
      {
        id: "authority-vs-credentials",
        seed: "Credentials are receipts for time spent inside someone else's system. Authority is the field generated when competence, conviction, and communication converge in one person. The credentialed person can cite sources. The authoritative person is the source. The gap between these two is the gap between a librarian and an author.",
        keywords: ["credentials", "authority", "competence", "conviction", "source"],
      },
      {
        id: "the-certainty-premium",
        seed: "In a world drowning in information, certainty is the scarcest resource. People do not follow the most qualified — they follow the most certain. The certainty premium explains why a person with half your knowledge but twice your conviction will capture the room every time. This is not about faking confidence. It is about eliminating the internal noise that makes your signal weak.",
        keywords: ["certainty", "scarcity", "conviction", "signal", "leadership"],
      },
      {
        id: "the-first-mover-in-the-room",
        seed: "Authority is often decided in the first ninety seconds of any interaction. The person who sets the frame — who asks the first question, names the problem, or defines the terms — becomes the gravitational center. This is not manipulation; it is architecture. If you do not build the frame, you will be placed inside someone else's.",
        keywords: ["frame", "first mover", "interaction", "architecture", "control"],
      },
      {
        id: "the-volume-inversion",
        seed: "The loudest person in the room has the least authority. Volume is a substitute for weight. The person who speaks least but chooses their moments with precision creates a scarcity effect — every word carries more value because fewer are issued. Authority is not earned by filling space. It is earned by making space expensive.",
        keywords: ["volume", "silence", "scarcity", "precision", "weight"],
      },
      {
        id: "domain-transfer-authority",
        seed: "True authority is domain-transferable. A person who has built authority in one field can walk into an adjacent field and command attention before they have proven anything, because the patterns of mastery are visible across contexts. The way they listen, the questions they ask, the speed at which they identify the core constraint — these signals are universal. Authority is not knowledge. It is the visible architecture of how someone processes reality.",
        keywords: ["domain transfer", "mastery", "patterns", "processing", "universality"],
      },
      {
        id: "the-correction-paradox",
        seed: "Authority deepens every time you publicly correct yourself. The amateur hides mistakes; the authority dissects them in public. Correction signals that you value accuracy more than appearance, and that your identity is not fragile enough to crack under the weight of being wrong. The paradox: admitting error increases, not decreases, the trust people place in your future statements.",
        keywords: ["correction", "mistakes", "trust", "fragility", "accuracy"],
      },
      {
        id: "the-interpretation-layer",
        seed: "Raw information is worthless. The authority is the interpretation layer — the person who takes the same data everyone has access to and extracts a meaning no one else saw. This is why journalists and analysts are never replaced by the data itself. The interpretation layer is where authority lives: not in knowing more, but in seeing further.",
        keywords: ["interpretation", "data", "meaning", "insight", "vision"],
      },
      {
        id: "the-refusal-signal",
        seed: "Nothing communicates authority faster than a well-placed refusal. The ability to say 'no' — to opportunities, to meetings, to collaborations — signals that your time has a price that not everyone can afford. Scarcity of access is the foundation of perceived authority. The person who is always available is never valued.",
        keywords: ["refusal", "no", "scarcity", "access", "value"],
      },
      {
        id: "asymmetric-knowledge-deployment",
        seed: "Authority is not about knowing everything. It is about deploying the right piece of knowledge at the exact moment it creates maximum impact. Asymmetric knowledge deployment means you hold information in reserve until the precise context where it becomes decisive. The amateur dumps everything they know immediately. The authority releases information like a controlled substance — measured, timed, and impossible to ignore.",
        keywords: ["knowledge", "timing", "deployment", "impact", "reserve"],
      },
      {
        id: "the-naming-power",
        seed: "The person who names the phenomenon controls the conversation about it. This is why frameworks, models, and coined terms are the atomic units of authority. When you give a pattern a name — a label that sticks — you become the reference point for every future discussion of that pattern. Naming is not branding. It is cognitive real estate acquisition.",
        keywords: ["naming", "frameworks", "language", "cognitive real estate", "control"],
      },
      {
        id: "the-apprentice-magnet",
        seed: "Real authority is measured by the caliber of people who want to learn from you without being asked. The apprentice magnet effect occurs when your work is so visibly excellent that high-capability people voluntarily subordinate themselves to proximity. If no one is asking to study under you, you have not yet crossed the authority threshold. You are still a peer in a sea of peers.",
        keywords: ["apprentice", "excellence", "proximity", "caliber", "threshold"],
      },
      {
        id: "the-prediction-record",
        seed: "Authority compounds through a public prediction record. Every time you call a trend, a failure, or a shift before it happens — and people can verify it — you add a layer of trust that no credential can match. The prediction record is an authority asset that appreciates over time. It cannot be bought, only built.",
        keywords: ["prediction", "foresight", "record", "trust", "verification"],
      },
      {
        id: "emotional-steadiness-under-fire",
        seed: "Authority is tested in the moment of attack, not in the moment of praise. The person who maintains emotional baseline when challenged — who does not speed up, raise their voice, or begin defending — demonstrates a nervous system that others instinctively want to follow. Steadiness under fire is the most expensive signal a human can transmit, because it cannot be performed. The body either has it or it does not.",
        keywords: ["steadiness", "composure", "attack", "nervous system", "leadership"],
      },
      {
        id: "the-body-of-work-moat",
        seed: "A body of work is the only moat that cannot be drained by a competitor, a platform change, or an algorithm shift. Credentials expire, networks dissolve, and attention moves — but three hundred pieces of published thought create a gravitational field that compounds indefinitely. Authority without a body of work is a sandcastle. With one, it is bedrock.",
        keywords: ["body of work", "moat", "publishing", "compound", "bedrock"],
      },
      {
        id: "the-translation-function",
        seed: "The highest form of authority is the ability to translate complexity into simplicity without losing precision. The translation function is rare because it requires mastery deep enough to see the essential structure, and communication skill sharp enough to render it in plain language. Most experts obscure. The authority clarifies. And clarity, in a noisy world, is the ultimate power move.",
        keywords: ["translation", "complexity", "simplicity", "clarity", "mastery"],
      },
    ],

    // ─────────────────────────────────────────────────
    // ARCHITECTURE
    // ─────────────────────────────────────────────────
    "architecture": [
      {
        id: "life-as-operating-system",
        seed: "Your life is not a story. It is an operating system — a set of processes, routines, and decision-making protocols that run whether you designed them or not. Most people are running an OS they inherited from their parents, patched by their environment, and never audited. The architect rewrites the kernel. Everyone else just installs apps on someone else's platform.",
        keywords: ["operating system", "design", "routines", "protocols", "kernel"],
      },
      {
        id: "the-default-settings-trap",
        seed: "Every system ships with default settings optimized for the manufacturer, not the user. Your career path, your relationship template, your financial behavior — these are all running on defaults installed by institutions that benefit from your compliance. The architect's first act is not to build something new. It is to identify every default they never chose and decide whether to keep it or replace it.",
        keywords: ["defaults", "settings", "compliance", "institutions", "choice"],
      },
      {
        id: "environment-architecture",
        seed: "You do not rise to the level of your goals. You fall to the level of your environment. This is not a motivational platitude — it is an architectural law. The person who designs their physical space, information diet, and social proximity to support a specific outcome will outperform the disciplined person in a hostile environment every single time. Willpower is a patch. Environment is infrastructure.",
        keywords: ["environment", "design", "willpower", "infrastructure", "space"],
      },
      {
        id: "the-decision-tree-prune",
        seed: "The most powerful architectural move is elimination, not addition. Every option you remove from your decision tree increases the speed and quality of every remaining decision. The architect who reduces their wardrobe to five outfits, their tools to three, and their priorities to one is not minimalist — they are aerodynamic. Complexity is drag. Constraints are thrust.",
        keywords: ["elimination", "decisions", "constraints", "minimalism", "speed"],
      },
      {
        id: "the-feedback-loop-audit",
        seed: "Every behavior you repeat is sustained by a feedback loop you may not see. The cigarette is not the addiction — the three-second relief from anxiety is the loop. The social media scroll is not the habit — the intermittent dopamine spike is the loop. Architecture begins with mapping every loop in your system and asking: is this loop serving my design, or is it serving someone else's?",
        keywords: ["feedback loops", "behavior", "addiction", "mapping", "audit"],
      },
      {
        id: "the-identity-blueprint",
        seed: "Most people build their identity reactively — they become the person their experiences shaped them into. The architect builds identity proactively — they decide who they need to become to produce a specific outcome, then reverse-engineer the inputs. This is not fake-it-til-you-make-it. It is blueprint-first construction: you do not start pouring concrete until the drawings are done.",
        keywords: ["identity", "blueprint", "proactive", "reverse-engineer", "construction"],
      },
      {
        id: "the-attention-allocation-budget",
        seed: "Attention is the only non-renewable resource you possess, and most people spend it with no budget. The attention allocation budget is a framework where every hour of waking life is treated as an investment with an expected return. Entertainment is not forbidden — it is categorized as maintenance. Scrolling is not relaxation — it is unbudgeted expenditure that shows up nowhere in the life P&L.",
        keywords: ["attention", "budget", "investment", "time", "allocation"],
      },
      {
        id: "the-ritual-engine",
        seed: "Rituals are not habits. Habits are unconscious loops. Rituals are conscious architecture — behaviors loaded with intention and meaning that compound into identity over time. The morning run is a habit. The morning run preceded by a specific visualization and followed by a specific journaling protocol is a ritual engine. The difference is the difference between drifting and steering.",
        keywords: ["rituals", "habits", "intention", "identity", "compound"],
      },
      {
        id: "the-system-redundancy-principle",
        seed: "Every critical system in your life needs a backup that does not share the same failure mode as the primary. If your income comes from one employer, your financial architecture has a single point of failure. If your emotional stability depends on one relationship, your psychological architecture has a single point of failure. The architect builds redundancy before the crisis, not during it.",
        keywords: ["redundancy", "backup", "failure mode", "resilience", "architecture"],
      },
      {
        id: "the-transition-protocol",
        seed: "The most dangerous moments in any system are the transitions — the handoffs between contexts, states, and modes. The commute between work and home, the shift from focus to rest, the move from consumption to creation. Most people have no transition protocol, which means they carry the residue of one context into the next. The architect designs deliberate transitions: buffers, resets, and decompression chambers between modes of operation.",
        keywords: ["transitions", "context switching", "buffers", "residue", "protocols"],
      },
      {
        id: "the-information-intake-filter",
        seed: "Your mind processes roughly eleven million bits per second unconsciously and fifty bits consciously. The information intake filter is the architecture that determines which fifty bits get through. Most people have no filter — they let algorithms, headlines, and whoever is loudest decide what enters their conscious processing pipeline. The architect designs the filter before they open the feed.",
        keywords: ["information", "filter", "processing", "algorithms", "intake"],
      },
      {
        id: "the-energy-architecture-map",
        seed: "Every person has a unique energy architecture — specific times, conditions, and sequences that produce peak cognitive output. Most people schedule their hardest work during their lowest energy windows because the calendar, not their biology, dictates the structure. The architect maps their ultradian rhythms, identifies their two or three golden windows per day, and defends those windows with the same intensity a general defends a supply line.",
        keywords: ["energy", "ultradian", "peak performance", "scheduling", "biology"],
      },
      {
        id: "the-load-bearing-wall-test",
        seed: "Before you remove anything from your life, you must determine if it is a load-bearing wall. Some relationships, routines, and commitments that feel restrictive are actually structural — remove them and the entire architecture destabilizes. The architect does not demolish without a structural assessment. They probe, test, and model the consequences before swinging the hammer.",
        keywords: ["load-bearing", "structural", "removal", "assessment", "stability"],
      },
      {
        id: "the-output-input-ratio",
        seed: "The ratio of consumption to creation in your life is the single most diagnostic metric of your trajectory. A 90/10 consumption-to-creation ratio produces a spectator. A 50/50 ratio produces a practitioner. A 10/90 ratio produces an architect. Most people consume ten hours of content for every one hour of output. The architect inverts the ratio and watches their reality change within months.",
        keywords: ["consumption", "creation", "ratio", "output", "trajectory"],
      },
      {
        id: "the-constraint-canvas",
        seed: "Unlimited freedom produces paralysis. The architect knows that constraints are not limitations — they are the canvas. A sonnet is more powerful than free verse precisely because the fourteen-line structure forces precision. The person who says 'I could do anything if I had no constraints' has confused freedom with architecture. The architect says 'give me the constraints and I will show you the only move that matters.'",
        keywords: ["constraints", "freedom", "structure", "precision", "paralysis"],
      },
    ],

    // ─────────────────────────────────────────────────
    // SYSTEM-MASTERY
    // ─────────────────────────────────────────────────
    "system-mastery": [
      {
        id: "the-rules-behind-the-rules",
        seed: "Every system has two sets of rules: the published rules and the operating rules. The published rules are in the employee handbook, the terms of service, the constitution. The operating rules are the ones that actually determine outcomes — who gets promoted, what gets enforced, which violations are tolerated. System mastery begins with mapping the operating rules that no one will say out loud.",
        keywords: ["rules", "published vs operating", "hidden", "mapping", "reality"],
      },
      {
        id: "the-incentive-forensics",
        seed: "If you want to understand why a system behaves the way it does, ignore what it says and follow the incentives. Incentive forensics is the practice of tracing every outcome back to the reward structure that produced it. Your company says it values innovation but promotes compliance. Your school says it values critical thinking but rewards memorization. The incentive structure never lies.",
        keywords: ["incentives", "forensics", "behavior", "rewards", "structure"],
      },
      {
        id: "the-bottleneck-identification",
        seed: "In any system, there is exactly one constraint that determines throughput at any given moment. Everything else is noise. The person who can identify the active bottleneck — not last month's bottleneck, not the obvious bottleneck, but the current one — controls the speed of the entire system. Most people optimize the wrong variable because they are solving yesterday's constraint.",
        keywords: ["bottleneck", "constraint", "throughput", "optimization", "diagnosis"],
      },
      {
        id: "the-leverage-point-hierarchy",
        seed: "Not all interventions are equal. Changing a parameter in a system produces incremental improvement. Changing the feedback loop that controls the parameter produces exponential improvement. Changing the paradigm that defines the feedback loop produces transformation. Most people spend their lives adjusting parameters. The system master operates at the level of paradigms.",
        keywords: ["leverage", "intervention", "parameters", "feedback loops", "paradigms"],
      },
      {
        id: "the-second-order-effect-vision",
        seed: "First-order thinking asks 'what happens next?' Second-order thinking asks 'and then what?' The person who can reliably predict second- and third-order effects of any action has a superpower that looks like intuition but is actually systems literacy. Every policy change, every market move, every personal decision creates a cascade. The system master sees the cascade before it starts.",
        keywords: ["second-order effects", "cascade", "prediction", "systems thinking", "consequences"],
      },
      {
        id: "the-input-output-illusion",
        seed: "Most people believe that effort maps linearly to results. It does not. Systems are nonlinear — small inputs in the right place produce massive outputs, and massive inputs in the wrong place produce nothing. The person who works eighty hours a week and gets mediocre results is not lazy — they are applying force to a node that is not connected to the output they want.",
        keywords: ["effort", "nonlinear", "leverage", "inputs", "outputs"],
      },
      {
        id: "the-pattern-recognition-stack",
        seed: "System mastery is pattern recognition applied across domains. The person who studies chess, ecology, military strategy, and market dynamics simultaneously begins to see the same twelve patterns everywhere: oscillation, accumulation, threshold effects, positive feedback, diminishing returns. These patterns are the grammar of reality. Once you learn the grammar, you can read any system like a sentence.",
        keywords: ["patterns", "cross-domain", "grammar", "recognition", "universality"],
      },
      {
        id: "the-model-dependency-trap",
        seed: "The map is not the territory, but most people fall in love with their map. Model dependency is the trap where you become so attached to your framework for understanding a system that you stop updating it when reality contradicts it. The system master holds every model lightly — useful until it is not, replaced without mourning. The model that served you last year may be the blindfold that destroys you this year.",
        keywords: ["models", "maps", "territory", "updating", "attachment"],
      },
      {
        id: "the-boundary-exploitation",
        seed: "Every system has boundaries — edges where its rules break down, where exceptions cluster, where the architecture was never designed to handle the load. The system master studies boundaries obsessively because that is where opportunities live. Arbitrage exists at boundaries. Innovation exists at boundaries. The center of any system is optimized and competed to death. The edges are where the value hides.",
        keywords: ["boundaries", "edges", "arbitrage", "innovation", "exploitation"],
      },
      {
        id: "the-decay-rate-awareness",
        seed: "Every system decays. Every advantage erodes. Every moat fills in. The decay rate — how fast an edge disappears once discovered — is the most underrated metric in strategy. The system master does not celebrate finding an advantage; they immediately ask how long it will last and what replaces it when it expires. Operating without decay-rate awareness is building on sand and calling it granite.",
        keywords: ["decay", "advantage", "erosion", "moats", "strategy"],
      },
      {
        id: "the-emergent-property-hunt",
        seed: "The most valuable properties of any system are the ones that do not exist in any individual component. Consciousness does not exist in a single neuron. Culture does not exist in a single person. Market dynamics do not exist in a single transaction. The system master hunts for emergent properties — the behaviors that only appear when components interact — because those are the properties that cannot be reverse-engineered from the parts.",
        keywords: ["emergence", "properties", "components", "interaction", "complexity"],
      },
      {
        id: "the-control-surface-map",
        seed: "In any system you participate in, you have access to a limited number of control surfaces — levers you can actually pull. Most people waste energy lamenting the levers they cannot reach instead of maximizing the ones they can. The system master maps every available control surface, ranks them by impact, and ignores everything else. You do not need to control the weather. You need to control the sail.",
        keywords: ["control surfaces", "levers", "agency", "impact", "mapping"],
      },
      {
        id: "the-stabilization-instinct",
        seed: "Complex systems have a stabilization instinct — they resist change and route around disruption. This is why most reform efforts fail: the system absorbs the intervention and returns to equilibrium. The system master does not fight the stabilization instinct. They redirect it — they make the new state the path of least resistance, so the system's own inertia locks the change in place.",
        keywords: ["stabilization", "equilibrium", "change resistance", "inertia", "reform"],
      },
      {
        id: "the-information-asymmetry-weapon",
        seed: "In every transaction — every negotiation, every hire, every sale — one party knows something the other does not. Information asymmetry is not a bug; it is the engine of all strategic advantage. The system master does not seek fairness in information exchange. They seek to know what others do not, and to know what others think they know. The gap between these two is where all leverage lives.",
        keywords: ["information asymmetry", "negotiation", "leverage", "knowledge", "strategy"],
      },
      {
        id: "the-complexity-camouflage",
        seed: "Systems that benefit from your confusion will always present themselves as more complex than they are. Taxes, legal contracts, financial instruments, corporate hierarchies — the complexity is often camouflage designed to prevent you from seeing the simple extraction mechanism underneath. The system master strips the camouflage and finds the three variables that actually matter. Complexity is usually a moat, not a feature.",
        keywords: ["complexity", "camouflage", "simplification", "extraction", "obfuscation"],
      },
    ],

    // ─────────────────────────────────────────────────
    // WEALTH-FREQUENCY
    // ─────────────────────────────────────────────────
    "wealth-frequency": [
      {
        id: "the-poverty-thermostat",
        seed: "Most people have an internal wealth thermostat set to whatever income their parents earned, plus or minus twenty percent. Every time their income rises above this set point, unconscious self-sabotage kicks in — overspending, bad investments, conflict with partners over money. The thermostat is not moral. It is neurological. And it can be recalibrated, but only if you know it exists.",
        keywords: ["thermostat", "set point", "self-sabotage", "income", "neurological"],
      },
      {
        id: "the-time-for-money-prison",
        seed: "Trading time for money is not a business model. It is a sentence. The time-for-money prison has a hard ceiling: there are only so many hours, and your body has a maintenance cost that rises every year. The escape is not working harder within the prison — it is building systems that generate revenue while you sleep, think, or do nothing at all. Wealth is not income. It is income decoupled from presence.",
        keywords: ["time for money", "ceiling", "systems", "passive income", "decoupling"],
      },
      {
        id: "the-wealth-guilt-implant",
        seed: "Somewhere between childhood and adulthood, most people were implanted with the belief that wanting money is shallow, that wealth is inherently corrupt, and that virtue lives in struggle. This implant was not installed by monks — it was installed by systems that benefit from your compliance with low wages. Wealth guilt is the most effective containment mechanism ever invented because the prisoner enforces it on themselves.",
        keywords: ["guilt", "money beliefs", "virtue", "containment", "implant"],
      },
      {
        id: "the-revenue-as-signal",
        seed: "Revenue is not greed. It is a signal — proof that you solved a problem someone was willing to pay to have solved. Zero revenue means zero validated solutions delivered to the world. The person who recoils from revenue is not noble — they are refusing to participate in the feedback loop that tells them whether their work actually matters to anyone besides themselves.",
        keywords: ["revenue", "signal", "validation", "problem solving", "feedback"],
      },
      {
        id: "the-savings-rate-deception",
        seed: "The financial industry teaches you to save. Saving is a defensive position — it assumes your future will be a linear extension of your present. The wealth-frequency mind does not save; it deploys capital. Every dollar sitting idle in a savings account is a soldier sleeping in the barracks during a war. Deployment does not mean recklessness. It means every unit of capital has an assignment, a target, and an expected return.",
        keywords: ["savings", "deployment", "capital", "offensive", "returns"],
      },
      {
        id: "the-price-setting-power",
        seed: "The single most diagnostic question about your financial sovereignty: do you set your own prices, or does someone else? If a market, an employer, or a client determines what your time and output are worth, you are not earning — you are being rationed. Price-setting power is the threshold between laborer and sovereign. Below it, you negotiate. Above it, you announce.",
        keywords: ["pricing", "sovereignty", "value", "negotiation", "power"],
      },
      {
        id: "the-wealthy-body-pattern",
        seed: "Wealth has a somatic signature. People who are comfortable with large numbers breathe differently around money conversations. Their shoulders do not rise. Their jaw does not tighten. Their voice does not change pitch when they say a price out loud. This is not performance — it is nervous system calibration. If your body tenses when you quote a number, your body is telling you that you do not yet believe you deserve it.",
        keywords: ["somatic", "body", "nervous system", "pricing", "calibration"],
      },
      {
        id: "the-generational-money-script",
        seed: "Your family's relationship with money is a script that has been running for generations — scarcity narratives, spending patterns, beliefs about who gets to be wealthy and who does not. The script is invisible because you absorbed it before you could evaluate it. Breaking the generational money script is not about earning more. It is about identifying the specific sentences your parents repeated about money and deciding which ones you are going to uninstall.",
        keywords: ["generational", "money script", "family", "beliefs", "inheritance"],
      },
      {
        id: "the-asset-income-crossover",
        seed: "There is a specific moment in a wealth trajectory where income from assets exceeds income from labor. This crossover point is the event horizon of financial sovereignty — once you pass it, the system loses its primary control mechanism over you. Everything before the crossover is the accumulation phase. Everything after it is the deployment phase. Most people never reach it because they do not know it exists as a target.",
        keywords: ["crossover", "assets", "labor", "event horizon", "accumulation"],
      },
      {
        id: "the-consumption-identity-link",
        seed: "Most spending is not economic — it is identity maintenance. The car, the neighborhood, the brand of coffee — these are not purchases. They are identity signals broadcast to yourself and others. Wealth frequency requires severing the link between consumption and identity, so that what you buy is determined by utility, not by the story you need to tell yourself about who you are.",
        keywords: ["consumption", "identity", "spending", "signals", "utility"],
      },
      {
        id: "the-velocity-of-money-concept",
        seed: "Wealth is not a pile. It is a flow rate. The velocity of money through your system — how quickly capital moves from opportunity identification to deployment to return — matters more than the total amount at any given snapshot. A person who deploys ten thousand dollars ten times at a fifty percent return outperforms the person who deploys one hundred thousand once at twenty percent. Speed is the multiplier most people ignore.",
        keywords: ["velocity", "flow", "speed", "deployment", "multiplication"],
      },
      {
        id: "the-risk-recalibration",
        seed: "The greatest financial risk is not losing money. It is reaching sixty-five with nothing but a depleted body and a pension that someone else controls. The risk calculus most people run is inverted — they overweight the risk of action and underweight the risk of inaction. The person who 'played it safe' their entire life took the biggest gamble of all: they bet everything on the system they served continuing to serve them back.",
        keywords: ["risk", "inaction", "safety illusion", "pension", "calculus"],
      },
      {
        id: "the-money-conversation-avoidance",
        seed: "The degree to which a person avoids specific money conversations — asking for a raise, discussing net worth with peers, negotiating a contract — is a precise measure of their wealth ceiling. Avoidance is not politeness. It is the wealth thermostat defending its set point. Every money conversation you skip costs you compound interest on the delta between what you accepted and what you could have secured.",
        keywords: ["avoidance", "conversations", "negotiation", "ceiling", "compound"],
      },
      {
        id: "the-ownership-imperative",
        seed: "You will never build wealth on rented land. If you create content on someone's platform, customers through someone's marketplace, or value through someone's company, you own nothing. The ownership imperative is the principle that every hour of effort must accumulate equity somewhere you control. Renters build wealth for landlords. Owners build wealth for themselves. This is not ideology. It is arithmetic.",
        keywords: ["ownership", "equity", "platforms", "rented land", "accumulation"],
      },
      {
        id: "the-abundance-signal-training",
        seed: "Scarcity thinking creates scarcity outcomes through a mechanism that is not mystical but operational. The person in scarcity mode makes decisions defensively — they hoard, hedge, and hesitate. These behaviors are optimized for survival, not for growth. Abundance is not a belief system. It is an operational mode where your decision-making shifts from 'how do I avoid losing' to 'how do I maximize the upside of every asset I touch.'",
        keywords: ["abundance", "scarcity", "decision-making", "operational mode", "growth"],
      },
    ],

    // ─────────────────────────────────────────────────
    // EXIT-VELOCITY
    // ─────────────────────────────────────────────────
    "exit-velocity": [
      {
        id: "the-escape-speed-calculation",
        seed: "Exit velocity is a physics term: the minimum speed an object needs to break free from a gravitational field. Your job, your social circle, your city, your identity — each exerts gravitational force. The escape speed calculation requires you to measure the exact pull of each field and determine whether your current thrust exceeds it. Most people feel stuck because they have never done the math on what is actually holding them.",
        keywords: ["escape speed", "gravity", "thrust", "measurement", "stuck"],
      },
      {
        id: "the-runway-number",
        seed: "Everyone has a runway number — the exact amount of cash that buys them enough months of survival to attempt the transition from where they are to where they need to be. Most people never calculate this number, which means they never know how close they actually are to freedom. The runway number is usually smaller than the fear suggests. Fear inflates the number. Math deflates it.",
        keywords: ["runway", "cash", "survival", "transition", "calculation"],
      },
      {
        id: "the-clean-break-myth",
        seed: "The clean break is a fantasy. Nobody exits a system without drag. There will be financial penalties, relational casualties, identity vertigo, and a period where the new life has not yet materialized and the old one has already collapsed. Exit velocity is not about avoiding the drag — it is about maintaining thrust through the drag zone long enough for the new trajectory to stabilize.",
        keywords: ["clean break", "drag", "penalties", "vertigo", "transition"],
      },
      {
        id: "the-two-year-window",
        seed: "There is a predictable two-year window of discomfort between leaving a system and thriving outside it. Month one is euphoria. Months two through eighteen are terror, doubt, and financial pressure. Months nineteen through twenty-four are the first signs of traction. Most people quit at month six because nobody told them the timeline. The two-year window is not a risk. It is a toll. And the toll has a fixed price.",
        keywords: ["two years", "timeline", "discomfort", "traction", "persistence"],
      },
      {
        id: "the-identity-death-requirement",
        seed: "You cannot exit a system without allowing the version of yourself that lived inside it to die. The person who thrived as a corporate employee has a different identity architecture than the person who thrives as an independent operator. The transition requires a death and a birth. Most people abort the exit because they are unwilling to grieve the identity they are leaving behind, even when that identity was a cage.",
        keywords: ["identity death", "transition", "grief", "rebirth", "letting go"],
      },
      {
        id: "the-bridge-income-architecture",
        seed: "Exit velocity does not mean leaping without a net. It means building bridge income — a parallel revenue stream that grows in the gaps of your current obligations until it can support your full weight. The bridge is not the destination; it is the structure that lets you cross from one life to the next without free-falling through the gap. Most people think they need to jump. They need to build.",
        keywords: ["bridge income", "parallel", "revenue stream", "transition", "building"],
      },
      {
        id: "the-social-drag-coefficient",
        seed: "Every person in your life has a drag coefficient — the degree to which their expectations, opinions, and emotional needs slow your exit trajectory. Some people are rocket fuel: they accelerate your trajectory by believing in a version of you that does not exist yet. Others are anchors: they need you to stay who you were so their model of reality remains stable. You do not need to cut anchors. You need to measure their drag and decide if your engine can overcome it.",
        keywords: ["social drag", "relationships", "expectations", "trajectory", "acceleration"],
      },
      {
        id: "the-point-of-no-return-engineering",
        seed: "Commitment deepens when retreat becomes impossible. The point of no return is not something that happens to you — it is something you engineer. Burning ships is not reckless if the destination is viable and the ships were rotting anyway. The person who maintains a comfortable fallback will use it the moment the exit gets hard. Engineering your own point of no return is the most sophisticated act of self-knowledge: you know your own tendency to retreat and you remove the option before the pressure arrives.",
        keywords: ["point of no return", "commitment", "burning ships", "retreat", "engineering"],
      },
      {
        id: "the-skill-stack-escape-pod",
        seed: "Exit velocity requires a skill stack that makes you valuable independent of any single institution. The person who can write, sell, build, and teach does not need a job — jobs need them. The skill stack escape pod is not about mastering one thing to elite level. It is about combining three or four skills at the seventy-fifth percentile into a combination that is rare, valuable, and impossible to replicate inside a corporate structure.",
        keywords: ["skill stack", "independence", "combination", "rare", "value"],
      },
      {
        id: "the-sunk-cost-severance",
        seed: "The years you have already spent inside a system have no bearing on whether you should stay. Sunk cost is the most weaponized cognitive bias in the containment arsenal — it makes you feel that leaving wastes the investment, when in reality staying wastes the future. Sunk cost severance is the practice of evaluating every commitment as if you were starting from zero today. Would you take this job, this relationship, this city if offered it fresh? If no, the exit clock has already started.",
        keywords: ["sunk cost", "severance", "investment", "evaluation", "future"],
      },
      {
        id: "the-minimum-viable-exit",
        seed: "Perfection is the most common excuse for never leaving. The minimum viable exit is the smallest possible version of the new life that lets you test the trajectory without betting everything on a single launch. It is the side project, the weekend prototype, the quiet conversation with the client who could become your first contract. You do not need a perfect plan. You need a minimum viable proof that the other side exists.",
        keywords: ["minimum viable", "prototype", "testing", "perfection", "proof"],
      },
      {
        id: "the-reentry-fear-inoculation",
        seed: "The deepest fear in any exit is not failure — it is the humiliation of having to come back. Reentry fear is what keeps people in dead careers, dead relationships, and dead cities long past the expiration date. The inoculation is simple: know that coming back is always an option, that it is not shameful, and that the information gained from attempting the exit is worth more than the comfort preserved by staying. The only true failure is the data you never collected.",
        keywords: ["reentry", "fear", "humiliation", "data", "inoculation"],
      },
      {
        id: "the-acceleration-curve",
        seed: "Exit velocity is not linear. The first ten percent of the exit — the decision, the announcement, the first month — consumes eighty percent of the emotional energy. The remaining ninety percent of the trajectory requires only twenty percent of the energy because momentum compounds. Most people quit during the hardest phase not realizing they are inches from the point where physics starts working in their favor.",
        keywords: ["acceleration", "momentum", "compound", "emotional energy", "phases"],
      },
      {
        id: "the-freedom-tax-acceptance",
        seed: "Freedom has a tax: uncertainty, inconsistent income, lack of structure, and the absence of external validation. Most people are willing to pay for freedom in theory but balk at the actual invoice. The freedom tax is not a punishment — it is the price of admission. The person who complains about the tax after leaving has not actually chosen freedom. They have chosen a different cage with a better view.",
        keywords: ["freedom tax", "uncertainty", "price", "admission", "acceptance"],
      },
      {
        id: "the-orbital-maintenance-cost",
        seed: "Reaching exit velocity is not the end — maintaining orbit requires ongoing energy. The person who escapes a corporate job but does not build systems, rituals, and revenue architecture will be pulled back by gravity within eighteen months. Orbital maintenance is the discipline of continuously investing in the infrastructure that keeps you free. Freedom is not a destination. It is an operating cost.",
        keywords: ["orbital", "maintenance", "infrastructure", "discipline", "ongoing"],
      },
    ],

    // ─────────────────────────────────────────────────
    // MEMETIC-ENGINEERING
    // ─────────────────────────────────────────────────
    "memetic-engineering": [
      {
        id: "the-idea-infection-vector",
        seed: "Ideas do not spread because they are true. They spread because they are sticky — emotionally charged, easy to repeat, and structured to survive the distortion of human-to-human transmission. A meme engineered with the right emotional payload, rhythmic structure, and identity hook will outcompete a true but boring idea every single time. Truth is not the selection criterion. Transmissibility is.",
        keywords: ["infection", "stickiness", "transmission", "emotional payload", "selection"],
      },
      {
        id: "the-naming-as-weaponry",
        seed: "The most powerful act in memetic engineering is naming something that people experience but cannot articulate. The moment you give a pattern a name — 'the Sunday scaries,' 'quiet quitting,' 'doom scrolling' — you create a cognitive anchor that did not exist before. The name becomes the lens through which millions of people now interpret their experience. Whoever names the phenomenon owns the conversation.",
        keywords: ["naming", "articulation", "cognitive anchor", "phenomenon", "ownership"],
      },
      {
        id: "the-compression-ratio",
        seed: "The most viral ideas are the most compressed. A fourteen-word sentence that captures a complex truth will travel further than a fourteen-page essay explaining the same thing. The compression ratio — how much meaning per syllable — is the engineering metric that separates memes that propagate from memes that die. 'Move fast and break things' compressed an entire operational philosophy into six words. That is not sloppy thinking. It is precision engineering.",
        keywords: ["compression", "brevity", "viral", "density", "propagation"],
      },
      {
        id: "the-identity-hook-mechanism",
        seed: "Ideas spread fastest when they give the adopter a new identity. 'I am a minimalist.' 'I am a sovereign.' 'I took the red pill.' The identity hook transforms an idea from something you think into something you are. Once the idea is fused with identity, attacking the idea feels like attacking the person — which makes the idea nearly impossible to dislodge. This is the most powerful and most dangerous tool in memetic engineering.",
        keywords: ["identity hook", "adoption", "fusion", "defense", "dislodging"],
      },
      {
        id: "the-enemy-crystallization",
        seed: "Every movement needs a clearly defined enemy — not a person, but a concept, a system, or a pattern. The enemy crystallization process takes a vague feeling of dissatisfaction and gives it a target. 'The matrix.' 'The algorithm.' 'The simulation.' The enemy does not need to be perfectly accurate. It needs to be emotionally resonant and simple enough to point at. Once the enemy is crystallized, the audience self-organizes around opposition to it.",
        keywords: ["enemy", "crystallization", "opposition", "target", "self-organization"],
      },
      {
        id: "the-trojan-horse-format",
        seed: "The Trojan horse format wraps a paradigm-shifting idea inside a familiar container. A productivity tip that is actually a consciousness reframe. A business strategy that is actually a philosophical argument. A movie review that is actually a political manifesto. The format lowers the immune response of the audience — they let the container in because it looks safe, and by the time they realize what it carries, the idea is already installed.",
        keywords: ["Trojan horse", "format", "disguise", "immune response", "installation"],
      },
      {
        id: "the-repetition-threshold",
        seed: "An idea does not become a belief until it has been encountered a specific number of times — typically between seven and twenty exposures. Below the threshold, it is information. Above it, it is truth. Memetic engineers do not create ideas and release them once. They create ideas and engineer the repetition environment — the channels, the formats, the contexts — that push the idea past the threshold before the audience notices it has become a conviction.",
        keywords: ["repetition", "threshold", "belief formation", "exposure", "conviction"],
      },
      {
        id: "the-sacred-phrase-construction",
        seed: "Sacred phrases are sentences so precisely constructed that they bypass critical thinking and land directly in the emotional brain. 'We hold these truths to be self-evident.' 'I have a dream.' 'Just do it.' The construction follows a specific architecture: rhythmic cadence, emotional escalation, and a resolution that feels inevitable. Sacred phrases are not discovered. They are engineered, tested, and refined until they ring like a bell.",
        keywords: ["sacred phrases", "construction", "cadence", "emotional", "inevitability"],
      },
      {
        id: "the-counter-narrative-injection",
        seed: "The most effective way to displace a dominant narrative is not to argue against it but to inject a counter-narrative that makes the original look small. You do not defeat 'work hard, get ahead' by proving it false. You defeat it by introducing 'work smart, own the system' — a narrative that includes the original but reframes it as the amateur version. The counter-narrative does not fight. It absorbs and transcends.",
        keywords: ["counter-narrative", "displacement", "reframing", "absorption", "transcendence"],
      },
      {
        id: "the-emotional-resonance-frequency",
        seed: "Every audience has an emotional resonance frequency — a specific combination of frustration, aspiration, and fear that, when struck precisely, produces a visceral response. Content that hits this frequency does not need to be promoted. It promotes itself because the audience feels seen in a way they cannot resist sharing. Finding the resonance frequency is not guesswork. It is empirical: you test, measure, and adjust until the audience stops scrolling and starts feeling.",
        keywords: ["resonance", "frequency", "emotion", "visceral", "audience"],
      },
      {
        id: "the-anti-meme-defense",
        seed: "Some true and important ideas actively resist memetic spread because they are uncomfortable, complex, or threatening to existing identity structures. These anti-memes — ideas that should propagate but do not — require deliberate engineering to overcome their natural transmission disadvantage. The engineer wraps the anti-meme in emotion, story, and identity hooks until its resistance to spread is neutralized. Some of the most important truths in history required centuries of memetic engineering before they could propagate.",
        keywords: ["anti-meme", "resistance", "uncomfortable truths", "engineering", "overcoming"],
      },
      {
        id: "the-symbol-as-compressed-ideology",
        seed: "A symbol is an ideology compressed into a visual that can cross language barriers, literacy barriers, and even temporal barriers. The raised fist. The peace sign. The red pill. Each carries a compressed worldview that unpacks in the mind of the viewer instantly. Symbol engineering is the highest form of memetic compression — you take a complex system of beliefs and fold it into something that can be printed on a shirt, tattooed on skin, or recognized in a single glance.",
        keywords: ["symbol", "compression", "ideology", "visual", "recognition"],
      },
      {
        id: "the-memetic-mutation-control",
        seed: "Every meme mutates as it spreads — the message distorts with each retransmission. Uncontrolled mutation destroys the original meaning. The memetic engineer builds mutation resistance into the design: rhythmic structures that are hard to paraphrase, emotional payloads that correct drift, and identity hooks that make alteration feel like betrayal. The goal is not to prevent mutation entirely but to constrain it within a bandwidth that preserves the core signal.",
        keywords: ["mutation", "control", "distortion", "resistance", "signal preservation"],
      },
      {
        id: "the-status-game-embedding",
        seed: "The fastest way to make an idea spread is to make its adoption a status signal. When believing, sharing, or practicing an idea makes the adopter appear smarter, more aware, or more sophisticated than their peers, the idea gains a viral coefficient that compounds with every social interaction. Status game embedding does not appeal to truth. It appeals to positioning. And positioning is the fuel that powers every social network on earth.",
        keywords: ["status", "signaling", "adoption", "viral coefficient", "positioning"],
      },
      {
        id: "the-narrative-architecture-blueprint",
        seed: "A narrative is not a story. It is an architecture — a structural framework that determines which facts are visible, which are hidden, which emotions are legitimate, and which conclusions are inevitable. The narrative architect does not tell people what to think. They build the room in which thinking happens, and the room's shape determines the thought. If you control the narrative architecture, you do not need to control the people inside it. The architecture does the work.",
        keywords: ["narrative", "architecture", "framework", "invisible structure", "control"],
      },
    ],

    // ─────────────────────────────────────────────────
    // SIGNAL-DISCIPLINE
    // ─────────────────────────────────────────────────
    "signal-discipline": [
      {
        id: "the-noise-floor-reduction",
        seed: "Every signal you broadcast is competing with your own noise floor — the accumulation of irrelevant, contradictory, and low-quality outputs you have put into the world. A single tweet that contradicts your thesis, a single product that is below your standard, a single association that is off-brand — each raises the noise floor and makes your real signal harder to detect. Signal discipline is not about saying more. It is about reducing the noise that drowns out what you have already said.",
        keywords: ["noise floor", "signal", "contradiction", "quality", "reduction"],
      },
      {
        id: "the-frequency-consistency-law",
        seed: "Trust is built on frequency consistency — the predictable rhythm at which you show up, deliver, and communicate. Irregular output, no matter how brilliant, creates uncertainty. The audience cannot build a habit around unpredictability. The person who ships mediocre work weekly will outperform the person who ships brilliant work quarterly, because the first has become a frequency and the second has become an event. Events are forgotten. Frequencies are internalized.",
        keywords: ["frequency", "consistency", "trust", "rhythm", "habit"],
      },
      {
        id: "the-strategic-silence-weapon",
        seed: "Silence is a signal. The person who does not comment on every controversy, does not respond to every provocation, and does not weigh in on every topic is transmitting a specific message: my attention is expensive and I deploy it with intention. Strategic silence creates a vacuum that the audience fills with their own projected authority. The disciplined signal operator knows that what you do not say shapes perception as much as what you do.",
        keywords: ["silence", "restraint", "attention", "vacuum", "authority"],
      },
      {
        id: "the-channel-dilution-trap",
        seed: "Every new channel you broadcast on dilutes the energy available for every other channel. The person on seven platforms producing content for all of them is running a signal dilution experiment — their message becomes thinner, less specific, and less powerful with each additional output. Signal discipline requires channel concentration: dominate one frequency completely before opening a second. Omnipresence is the enemy of authority.",
        keywords: ["channels", "dilution", "concentration", "platforms", "energy"],
      },
      {
        id: "the-audience-calibration-error",
        seed: "Most creators broadcast to an imaginary audience — a composite of everyone they want to reach. This calibration error guarantees that the signal resonates with no one specifically. Signal discipline requires choosing a single specific human as the target receiver and tuning every output to that frequency. When you write to everyone, you reach no one. When you write to one person, the right thousand find you.",
        keywords: ["audience", "calibration", "specificity", "target", "resonance"],
      },
      {
        id: "the-proof-of-work-signal",
        seed: "In a world saturated with opinion, the most powerful signal is proof of work — visible evidence that you have done the thing you are talking about. The person who shows their portfolio, their results, their scars, and their process transmits a signal that no amount of articulate commentary can match. Talk is noise. Work is signal. The ratio between the two in your public output determines your credibility half-life.",
        keywords: ["proof of work", "evidence", "credibility", "portfolio", "results"],
      },
      {
        id: "the-signal-latency-advantage",
        seed: "Responding instantly to events is a signal of reactivity. Responding after a measured delay — after the noise has settled and the pattern has emerged — is a signal of authority. Signal latency is the deliberate practice of waiting until you have something to say that no one else has said. The fast responder gets attention. The late responder gets credit. Speed is a signal of anxiety. Latency is a signal of depth.",
        keywords: ["latency", "delay", "reactivity", "depth", "authority"],
      },
      {
        id: "the-aesthetic-coherence-principle",
        seed: "Every visual, verbal, and structural choice in your output contributes to or detracts from a single aesthetic frequency. The person whose writing style, visual design, color palette, and tone of voice all vibrate at the same frequency creates an experience of coherence that the audience feels but cannot name. Aesthetic incoherence — a polished website with sloppy copy, a serious topic with a playful font — creates cognitive dissonance that the audience resolves by leaving.",
        keywords: ["aesthetic", "coherence", "frequency", "design", "cognitive dissonance"],
      },
      {
        id: "the-vulnerability-calibration",
        seed: "Vulnerability is a signal tool, not a default setting. Undisciplined vulnerability — sharing everything, processing in public, performing pain for engagement — destroys authority by making the audience responsible for your emotional state. Calibrated vulnerability — sharing a specific struggle at a specific moment to illuminate a specific lesson — deepens trust and demonstrates mastery. The difference is the difference between bleeding on someone and showing them the scar.",
        keywords: ["vulnerability", "calibration", "sharing", "trust", "authority"],
      },
      {
        id: "the-editorial-kill-rate",
        seed: "The quality of your signal is measured not by what you publish but by what you kill. The editorial kill rate — the percentage of your output that you create and then deliberately destroy — is the clearest metric of signal discipline. A kill rate below fifty percent means you are publishing your drafts. A kill rate above eighty percent means you are only releasing the work that meets the standard. The audience never sees what you killed, but they feel its absence in the density of what survives.",
        keywords: ["editorial", "kill rate", "quality", "discipline", "density"],
      },
      {
        id: "the-jargon-contamination-risk",
        seed: "Every field develops jargon that functions as an insider signal — proof that you belong to the tribe. But jargon in public-facing output is a contamination that shrinks your addressable audience to the people who already agree with you. Signal discipline requires translating insider language into universal language without losing precision. The test: could a smart sixteen-year-old understand this sentence? If not, the jargon is doing the thinking for you.",
        keywords: ["jargon", "contamination", "accessibility", "translation", "audience"],
      },
      {
        id: "the-dopamine-trap-avoidance",
        seed: "Engagement metrics are a dopamine trap that rewires your signal toward whatever generates reaction rather than whatever generates value. The post that gets the most likes is rarely the post that changes lives. Signal discipline requires a personal metric that is independent of the platform's reward system — a metric you define, you measure, and you optimize for even when the algorithm punishes you for it.",
        keywords: ["dopamine", "metrics", "engagement", "value", "independence"],
      },
      {
        id: "the-medium-message-alignment",
        seed: "The medium shapes the message whether you intend it to or not. A deep systems analysis compressed into a tweet becomes a hot take. A personal reflection stretched into a thirty-minute video becomes performative. Signal discipline requires matching the depth and density of the message to the container that serves it best. Publishing in the wrong medium is not a distribution problem — it is a signal corruption problem.",
        keywords: ["medium", "message", "alignment", "format", "corruption"],
      },
      {
        id: "the-reputation-compound-interest",
        seed: "Reputation compounds like interest — slowly and then suddenly. Every signal-consistent output adds a thin layer of trust. Every signal-inconsistent output erases multiple layers. The compounding math is asymmetric: it takes a hundred consistent signals to build a reputation and three inconsistent ones to damage it. Signal discipline is the practice of protecting the compound interest on your most valuable asset — the pattern other people use to predict your behavior.",
        keywords: ["reputation", "compound interest", "trust", "consistency", "asymmetry"],
      },
      {
        id: "the-positioning-vs-promotion-distinction",
        seed: "Promotion says 'look at me.' Positioning says 'this is where I stand.' The distinction is the difference between chasing attention and attracting alignment. The promoted person needs to be louder every cycle to maintain visibility. The positioned person gets quieter as their body of work does the signaling for them. Promotion is a cost. Positioning is an investment. One depletes energy. The other generates gravity.",
        keywords: ["positioning", "promotion", "gravity", "alignment", "investment"],
      },
    ],
  },

  // ═══════════════════════════════════════════════════
  // THE CONTAINMENT FIELD
  // ═══════════════════════════════════════════════════
  containment_field: {
    // ─────────────────────────────────────────────────
    // BURNOUT
    // ─────────────────────────────────────────────────
    "burnout": [
      {
        id: "health-insurance-hostage",
        seed: "The real reason most people don't quit isn't the paycheck — it's the health insurance. The American employment system has engineered a dependency loop where your body's access to medical care is held hostage by your compliance with the extraction schedule. This is not a benefit. It is a containment mechanism designed to make the cost of freedom feel like the cost of dying.",
        keywords: ["health insurance", "hostage", "dependency", "medical", "quit"],
      },
      {
        id: "the-sunday-dread-loop",
        seed: "The Sunday dread loop begins around 4 PM — a tightening in the chest, a heaviness behind the eyes, a vague nausea that has no medical explanation. Your body is running a pre-loading sequence for Monday's extraction cycle. This is not anxiety. It is your nervous system's honest assessment of the week ahead. The dread is data. And the data says: this arrangement is killing you slowly enough that you can pretend it isn't.",
        keywords: ["Sunday dread", "anxiety", "nervous system", "body", "weekly cycle"],
      },
      {
        id: "the-passion-exploitation-loop",
        seed: "The most effective burnout mechanism ever invented is the phrase 'do what you love.' When your passion becomes your job, the employer gains access to a motivation channel that requires no salary increase, no promotion, and no improvement in conditions. You will overwork voluntarily because the work 'matters.' Passion exploitation is the practice of converting intrinsic motivation into unpaid labor and calling it purpose.",
        keywords: ["passion", "exploitation", "purpose", "unpaid labor", "intrinsic motivation"],
      },
      {
        id: "the-productivity-guilt-engine",
        seed: "Burnout is not caused by working too much. It is caused by the guilt that arrives the moment you stop. The productivity guilt engine runs on a simple loop: rest triggers guilt, guilt triggers work, work triggers exhaustion, exhaustion triggers collapse, collapse triggers shame, shame triggers overcompensation. The engine does not need a manager to run it. You have internalized the foreman so completely that you crack the whip on yourself.",
        keywords: ["productivity", "guilt", "rest", "internalized", "foreman"],
      },
      {
        id: "the-identity-merger-with-role",
        seed: "When someone asks 'what do you do?' and you answer with your job title, you have completed the identity merger — the point at which your sense of self has been fully absorbed by your professional role. The merger is the goal of every employment system because once it is complete, losing the job feels like losing yourself. Burnout is not the breaking point of a worker. It is the breaking point of a person who forgot they existed before the role was assigned.",
        keywords: ["identity merger", "job title", "self", "role", "absorption"],
      },
      {
        id: "the-recovery-debt-spiral",
        seed: "Recovery debt is the accumulated sleep, movement, stillness, and joy that your body needs but has not received for months or years. The spiral begins when you are too exhausted to do the things that would restore you — too tired to exercise, too drained to cook, too depleted to connect with people who recharge you. So you default to low-effort coping — delivery food, scrolling, streaming — which maintains the depletion without restoring anything. The spiral is self-reinforcing and it accelerates.",
        keywords: ["recovery debt", "spiral", "exhaustion", "coping", "depletion"],
      },
      {
        id: "the-emotional-labor-invoice",
        seed: "There is an entire category of labor that never appears on a job description: managing your boss's mood, performing enthusiasm in meetings, absorbing a colleague's anxiety, maintaining a facial expression that signals engagement when your mind has been empty for an hour. Emotional labor is real labor that consumes real energy. But because it produces no visible output, it is never acknowledged, never compensated, and never factored into the burnout equation. Your exhaustion is not irrational. There is unpaid work on your invoice.",
        keywords: ["emotional labor", "invisible", "unpaid", "performance", "exhaustion"],
      },
      {
        id: "the-two-week-notice-theater",
        seed: "The two-week notice is a performance of gratitude in a relationship that was never mutual. You are expected to train your replacement, smile through your final days, and express appreciation for the 'opportunity' — while the company would have escorted you out the same day if the decision were reversed. The two-week notice is theater designed to maintain the illusion that employment is a partnership and not a power asymmetry.",
        keywords: ["two-week notice", "theater", "gratitude", "power asymmetry", "illusion"],
      },
      {
        id: "the-high-performer-tax",
        seed: "The reward for being excellent at your job is more work at the same salary. The high-performer tax is the systematic extraction of additional labor from the most capable employees, justified by the compliment of being 'trusted with more responsibility.' The underperformer receives training, accommodation, and patience. The high performer receives a heavier load and the implication that they should be grateful for the additional burden.",
        keywords: ["high performer", "tax", "overwork", "capability punishment", "responsibility"],
      },
      {
        id: "the-pto-guilt-mechanism",
        seed: "Paid time off is a contractual right that has been psychologically reframed as a personal favor. The mechanism works through peer pressure, email CC chains during vacation, and the subtle punishment of returning to a backlog that grew specifically because no one was assigned your tasks. The message is clear: rest is permitted but penalized. Your body gets the vacation. Your nervous system does not.",
        keywords: ["PTO", "vacation", "guilt", "peer pressure", "punishment"],
      },
      {
        id: "the-3am-email-cortisol-spike",
        seed: "The notification sound your phone makes at 3 AM when a work email arrives produces a cortisol spike that takes your body forty-five minutes to clear — even if you do not read the email. Your employer has installed a stress delivery system in your bedroom that activates on their schedule, not yours. The phone is not a tool. It is a leash that extends the extraction zone from the office into your sleep.",
        keywords: ["3AM email", "cortisol", "notification", "sleep", "leash"],
      },
      {
        id: "the-burnout-as-character-flaw-reframe",
        seed: "The most insidious feature of burnout culture is the reframing of a systemic extraction problem as an individual resilience deficit. When you burn out, the narrative shifts from 'this system extracted too much' to 'you weren't resilient enough.' Meditation apps, wellness programs, and employee assistance hotlines all serve the same function: they treat the symptoms in the individual so the system never has to acknowledge the cause.",
        keywords: ["character flaw", "resilience", "systemic", "individual blame", "wellness theater"],
      },
      {
        id: "the-golden-handcuff-mechanism",
        seed: "Golden handcuffs are not just stock options and deferred compensation. They are the lifestyle you built on the assumption that your current income is permanent. The mortgage, the car payment, the school tuition, the subscriptions — each one is a thread that binds you tighter to the extraction schedule. The golden handcuff mechanism does not imprison you on the day you accept the benefit. It imprisons you on the day you realize you cannot afford to walk away from it.",
        keywords: ["golden handcuffs", "lifestyle", "imprisonment", "compensation", "dependency"],
      },
      {
        id: "the-purpose-washing-tactic",
        seed: "Purpose-washing is the corporate practice of wrapping exploitative working conditions in mission-driven language. The startup that demands eighty-hour weeks because 'we're changing the world.' The nonprofit that pays poverty wages because 'the work is its own reward.' Purpose-washing converts your idealism into free labor by making you feel guilty for wanting fair compensation for meaningful work. The mission is real. The exploitation is also real. Both things are true simultaneously.",
        keywords: ["purpose-washing", "mission", "exploitation", "idealism", "compensation"],
      },
      {
        id: "the-performative-busyness-loop",
        seed: "In most organizations, appearing busy is more valued than being effective. The performative busyness loop rewards visible activity — full calendars, rapid email responses, late nights at the desk — over actual output. The person who completes their work in four hours and reads quietly is perceived as underperforming. The person who stretches four hours of work into ten with unnecessary meetings and performative urgency is perceived as dedicated. The loop trains you to waste your life visibly.",
        keywords: ["performative", "busyness", "visibility", "effectiveness", "waste"],
      },
    ],

    // ─────────────────────────────────────────────────
    // DARK-PSYCHOLOGY
    // ─────────────────────────────────────────────────
    "dark-psychology": [
      {
        id: "the-intermittent-reinforcement-trap",
        seed: "The most addictive behavioral pattern in human psychology is not consistent reward — it is intermittent reinforcement. The boss who is warm one day and cold the next. The partner who alternates between affection and withdrawal. The slot machine that pays out unpredictably. Intermittent reinforcement creates a neurological hook stronger than any drug because the brain cannot stop searching for the pattern. The trap is that there is no pattern. That is the pattern.",
        keywords: ["intermittent reinforcement", "addiction", "unpredictability", "neurological", "hook"],
      },
      {
        id: "the-gaslighting-gradient",
        seed: "Gaslighting does not begin with denying your reality. It begins with questioning your memory. 'Are you sure that's what happened?' is the first dose — small enough to pass as concern. The gradient escalates so slowly that by the time someone is telling you that the meeting you attended never happened, you have already surrendered fifty smaller truths. Gaslighting is not a single act of denial. It is a gradient of erosion applied over months until your own perception feels unreliable.",
        keywords: ["gaslighting", "gradient", "memory", "erosion", "perception"],
      },
      {
        id: "the-manufactured-urgency-weapon",
        seed: "Manufactured urgency is the practice of creating artificial time pressure to prevent rational evaluation. The job offer that expires in twenty-four hours. The deal that is only available today. The project that must ship by Friday with no rational justification for the deadline. Urgency bypasses the prefrontal cortex and activates the amygdala — fight-or-flight replaces cost-benefit analysis. Every time you feel rushed into a decision, someone has engineered that feeling.",
        keywords: ["urgency", "time pressure", "manipulation", "amygdala", "decision-making"],
      },
      {
        id: "the-triangulation-protocol",
        seed: "Triangulation is the practice of routing communication through a third party to create confusion, competition, or dependency. The manager who tells you what your colleague 'really thinks.' The partner who casually mentions their ex's opinion. The friend who relays compliments from someone who could have delivered them directly. Triangulation prevents direct relationships from forming because direct relationships cannot be controlled. The triangulator is always the hub, never the spoke.",
        keywords: ["triangulation", "third party", "control", "communication", "hub"],
      },
      {
        id: "the-learned-helplessness-installation",
        seed: "Learned helplessness is not a personality trait. It is a condition installed through repeated exposure to uncontrollable negative outcomes. The employee who stops suggesting ideas because every suggestion was shot down. The child who stops asking for help because help never arrived. The installation sequence is specific: demonstrate that effort is futile, repeat until the subject stops trying, then label their passivity as a character flaw. The cruelty is not in the helplessness. It is in calling it a choice.",
        keywords: ["learned helplessness", "installation", "futility", "passivity", "character flaw"],
      },
      {
        id: "the-debt-of-kindness-trap",
        seed: "The debt of kindness trap is the manipulation technique where unsolicited favors are used to create an obligation that can be called in later. The colleague who covers your shift without being asked, then uses it as leverage months later. The person who gives you a gift you did not want, then treats your boundary-setting as ingratitude. This is not generosity. It is a deposit in a social debt account that you never opened and never agreed to.",
        keywords: ["debt of kindness", "obligation", "favors", "manipulation", "leverage"],
      },
      {
        id: "the-identity-erosion-protocol",
        seed: "Identity erosion does not happen through direct attack. It happens through systematic displacement of your preferences, opinions, and boundaries with someone else's. It starts with 'you'd look better in blue' and ends with you unable to dress yourself without consulting someone else's preference. The protocol works because each individual displacement is too small to fight, but the cumulative effect is the replacement of your operating system with someone else's.",
        keywords: ["identity erosion", "displacement", "preferences", "boundaries", "cumulative"],
      },
      {
        id: "the-strategic-incompetence-play",
        seed: "Strategic incompetence is the deliberate performance of inability in order to shift labor onto others. The partner who 'can't figure out' the laundry. The colleague who produces work so poor that it is faster to do it yourself than to correct theirs. The play works because calling it out makes you look petty — 'they're trying, they just aren't good at it' — while the labor redistribution continues. Strategic incompetence is not ignorance. It is a labor extraction tool wearing the mask of cluelessness.",
        keywords: ["strategic incompetence", "labor shift", "performance", "extraction", "cluelessness"],
      },
      {
        id: "the-moving-goalpost-exhaustion",
        seed: "Moving goalposts is the technique of changing the success criteria after the work is done. You hit the target, and the target moves. You meet the requirement, and a new requirement appears. The function is not to improve the outcome — it is to maintain a permanent state of insufficiency in the target. The person chasing moving goalposts never gets the reward because the reward was never the point. Control was the point. Exhaustion is the product.",
        keywords: ["moving goalposts", "criteria", "insufficiency", "exhaustion", "control"],
      },
      {
        id: "the-silent-treatment-as-punishment",
        seed: "The silent treatment is the withdrawal of communication as a disciplinary measure. It works because humans are social animals with a neurological need for connection — social rejection activates the same brain regions as physical pain. The person administering the silent treatment pays no cost and exerts no visible effort. They simply remove something you need and wait for you to comply. It is the most energy-efficient punishment system ever devised.",
        keywords: ["silent treatment", "withdrawal", "social pain", "punishment", "compliance"],
      },
      {
        id: "the-love-bombing-investment-trap",
        seed: "Love bombing is the front-loading of intense affection, attention, and validation to create an emotional investment that can be leveraged later. The new boss who praises everything you do for the first month. The new friend who calls you brilliant, indispensable, uniquely talented. The investment trap springs when the affection withdraws and you begin performing to get it back. You are not chasing a person. You are chasing the version of yourself that existed in their initial assessment.",
        keywords: ["love bombing", "investment", "withdrawal", "validation", "performance"],
      },
      {
        id: "the-plausible-deniability-shield",
        seed: "The most skilled manipulators never do anything that can be proven in court. Plausible deniability is the architecture of harm that leaves no fingerprints. The comment that could be a joke or could be a threat. The omission that could be forgetfulness or could be sabotage. The tone that could be concern or could be contempt. The shield works because the target is left questioning whether the harm even occurred, which is itself the harm.",
        keywords: ["plausible deniability", "ambiguity", "harm", "fingerprints", "questioning"],
      },
      {
        id: "the-comparison-weapon-deployment",
        seed: "The comparison weapon is the practice of introducing a third-party standard to make someone feel inadequate without directly criticizing them. 'Sarah's report was excellent this quarter' — said to someone whose report was not mentioned. The weapon works because it avoids direct confrontation while delivering the same message: you are not enough. The comparison is always curated — the target is compared to the one person who performed better, never to the average.",
        keywords: ["comparison", "inadequacy", "indirect criticism", "curated", "standard"],
      },
      {
        id: "the-emotional-hostage-negotiation",
        seed: "Emotional hostage negotiation is the practice of threatening emotional consequences — tears, rage, withdrawal, self-harm — to prevent someone from exercising a boundary. 'If you leave, I don't know what I'll do' is not vulnerability. It is a hostage negotiation where the hostage is the other person's guilt. The negotiator has learned that emotional escalation bypasses rational discussion and forces compliance through the path of least emotional resistance.",
        keywords: ["emotional hostage", "boundaries", "threats", "guilt", "compliance"],
      },
      {
        id: "the-information-control-architecture",
        seed: "In any relationship where one person controls what information the other receives, the power asymmetry is total. Information control architecture includes intercepting messages, curating news, filtering friend groups, and providing 'context' that reframes neutral events as threats. The person inside the architecture does not know they are inside it because their entire picture of reality is being painted by the controller. This is not paranoia. It is infrastructure.",
        keywords: ["information control", "filtering", "reality", "asymmetry", "architecture"],
      },
    ],

    // ─────────────────────────────────────────────────
    // CONTAINMENT
    // ─────────────────────────────────────────────────
    "containment": [
      {
        id: "the-salary-band-ceiling",
        seed: "Salary bands are presented as pay equity tools. They function as containment ceilings. The band ensures that no individual contributor ever earns enough to accumulate the capital needed for independence. The ceiling is calculated precisely: high enough to prevent revolt, low enough to prevent exit. If you are paid at the top of your band, you have not been rewarded. You have been contained at the maximum price the system will pay to keep you inside.",
        keywords: ["salary band", "ceiling", "containment", "capital", "independence"],
      },
      {
        id: "the-credential-gate",
        seed: "The credentialing system is the largest gatekeeping operation in modern economies. It requires you to spend four to eight years and fifty to two hundred thousand dollars to earn a document that signals compliance with a curriculum designed decades ago. The credential does not prove competence — it proves that you were willing to submit to an authority structure for long enough to be considered trustworthy. The gate is not about education. It is about filtering for obedience.",
        keywords: ["credentials", "gatekeeping", "obedience", "education", "debt"],
      },
      {
        id: "the-mortgage-anchor",
        seed: "A thirty-year mortgage is the longest voluntary containment contract a person can sign. It binds you to a geographic location, an income requirement, and a financial obligation that spans the majority of your productive years. The word 'mortgage' literally derives from the French for 'death pledge.' The system does not need to imprison you when it can convince you to sign your own thirty-year sentence and call it the American Dream.",
        keywords: ["mortgage", "containment", "thirty years", "debt", "geographic binding"],
      },
      {
        id: "the-open-office-panopticon",
        seed: "The open office plan was sold as collaboration. It functions as surveillance. When everyone can see your screen, hear your calls, and track your movements, you internalize the watcher. You perform productivity even when no one is actively monitoring because the architecture makes monitoring ambient. The panopticon does not need a guard in the tower. It only needs you to believe the tower is occupied.",
        keywords: ["open office", "panopticon", "surveillance", "visibility", "self-monitoring"],
      },
      {
        id: "the-ladder-illusion",
        seed: "The career ladder is presented as a path to increasing freedom. Each rung actually increases your containment by adding responsibilities that bind you more tightly: larger teams to manage, bigger budgets to justify, more stakeholders to satisfy. The promotion is not a reward — it is a deeper integration into the system's dependency architecture. You do not climb toward freedom. You climb toward a more comfortable cell with a better view.",
        keywords: ["career ladder", "promotion", "binding", "responsibility", "illusion"],
      },
      {
        id: "the-non-compete-cage",
        seed: "Non-compete clauses do not protect trade secrets. They protect the employer's investment in your containment. By prohibiting you from using the skills you developed at their company to work for a competitor or start your own venture, the non-compete converts your professional growth into a trap. The skills you built on their time remain their property even after you leave. Your growth was never yours. It was inventory.",
        keywords: ["non-compete", "skills", "ownership", "trap", "professional growth"],
      },
      {
        id: "the-retirement-horizon-trick",
        seed: "The retirement age is set precisely at the point where your body has been depleted enough that freedom arrives too late to use it fully. The system does not deny you freedom — it defers it to a date when your capacity to exploit it has been maximally degraded. Sixty-five is not a reward for decades of service. It is the calculus of extraction: take the most productive years, return the least productive ones, and call it a deal.",
        keywords: ["retirement", "deferred freedom", "extraction", "body depletion", "calculus"],
      },
      {
        id: "the-benefits-package-trap",
        seed: "Benefits are not gifts. They are components of a containment architecture designed to make exit painful. Health insurance, dental coverage, 401(k) matching, parental leave — each one is a thread in a web that becomes harder to replace with every year you stay. The benefits package does not supplement your salary. It supplements your captivity by raising the cost of departure incrementally until the cost feels existential.",
        keywords: ["benefits", "package", "captivity", "exit cost", "architecture"],
      },
      {
        id: "the-annual-review-domestication",
        seed: "The annual performance review is a domestication ritual disguised as professional development. Once a year, you sit across from a person who holds authority over your livelihood and receive a judgment on your character, effort, and value — delivered in the language of 'growth areas' and 'opportunities.' The ritual trains you to seek external validation from the institution, to internalize its assessment of your worth, and to adjust your behavior to match its criteria. This is not development. It is obedience training with a feedback form.",
        keywords: ["performance review", "domestication", "validation", "obedience", "ritual"],
      },
      {
        id: "the-commute-as-unpaid-labor",
        seed: "The average American commute is fifty-two minutes per day. That is four and a half hours per week, two hundred thirty-four hours per year — nearly six full work weeks — of unpaid labor performed in service of someone else's real estate decision. The commute is not factored into compensation because acknowledging it would reveal that the effective hourly rate of most jobs is significantly lower than advertised. The commute is hidden labor. And hidden labor is free labor.",
        keywords: ["commute", "unpaid labor", "time", "real estate", "hidden cost"],
      },
      {
        id: "the-at-will-employment-asymmetry",
        seed: "At-will employment is framed as mutual freedom — either party can end the relationship at any time. In practice, the asymmetry is total. The employer can terminate you and experience a minor HR procedure. You can be terminated and experience financial ruin, identity crisis, and insurance loss. 'At-will' is a legal fiction that disguises a power structure as a partnership. Both parties can leave, but only one party has a parachute.",
        keywords: ["at-will", "asymmetry", "termination", "power", "legal fiction"],
      },
      {
        id: "the-slack-channel-surveillance",
        seed: "Internal communication tools are presented as collaboration platforms. They function as searchable surveillance databases. Every message you type, every emoji you react with, every channel you join or leave is logged, indexed, and available to HR and legal on request. The casual tone of Slack and Teams is engineered to lower your guard — to make you type things you would never put in an email. The informality is the trap. The database is the cage.",
        keywords: ["Slack", "surveillance", "communication", "database", "informality"],
      },
      {
        id: "the-dress-code-identity-strip",
        seed: "The dress code is the first act of identity erasure performed by any containment system. By dictating what you wear, the institution strips your most visible form of self-expression and replaces it with a uniform — whether it is business casual, scrubs, or a literal uniform. The function is not professionalism. It is the daily reminder that inside this building, your body is a surface the institution controls. You dress yourself. They dress you.",
        keywords: ["dress code", "identity erasure", "uniform", "control", "self-expression"],
      },
      {
        id: "the-loyalty-extraction-narrative",
        seed: "Corporate loyalty is a one-directional expectation. The company expects you to stay through difficult periods, accept below-market compensation 'during tough times,' and prioritize the organization's needs over your own career advancement. When the same company eliminates your position during a restructuring, the loyalty expectation evaporates instantly. The narrative of mutual loyalty was always a containment device — it kept you still while the system reserved the right to move.",
        keywords: ["loyalty", "one-directional", "expectation", "restructuring", "containment"],
      },
      {
        id: "the-vesting-schedule-timer",
        seed: "Vesting schedules are temporal containment devices. By distributing equity over four years with a one-year cliff, the system creates a financial incentive structure that punishes departure at every milestone. You are not earning equity — you are being metered. Each vesting event resets the clock on your captivity calculation: 'I've already waited this long, I might as well stay for the next tranche.' The schedule does not reward loyalty. It manufactures it through sunk cost.",
        keywords: ["vesting", "schedule", "temporal containment", "equity", "sunk cost"],
      },
    ],

    // ─────────────────────────────────────────────────
    // MANIPULATION-EXPOSED
    // ─────────────────────────────────────────────────
    "manipulation-exposed": [
      {
        id: "the-consensus-manufacturing-machine",
        seed: "Consensus is rarely organic. In most organizations, what feels like group agreement is actually the output of a manufacturing process: the decision is made by one or two people, socialized privately with key allies, presented in a meeting as a 'starting point,' and then driven to 'consensus' through social pressure and the false urgency of a packed agenda. If you have ever left a meeting feeling like you agreed to something you never chose, you have been through the machine.",
        keywords: ["consensus", "manufacturing", "social pressure", "meetings", "agreement"],
      },
      {
        id: "the-false-choice-architecture",
        seed: "The false choice is the presentation of two options — both of which serve the presenter's interest — as the full range of possibility. 'Do you want to do the presentation on Tuesday or Thursday?' eliminates the option of not doing the presentation. 'Should we cut headcount by ten percent or freeze hiring?' eliminates the option of cutting executive compensation. False choice architecture is manipulation that looks like empowerment because you get to 'choose.'",
        keywords: ["false choice", "architecture", "options", "elimination", "empowerment illusion"],
      },
      {
        id: "the-tone-policing-silencer",
        seed: "Tone policing is the practice of disqualifying a valid complaint by critiquing its delivery. 'I hear what you're saying, but the way you're saying it...' redirects the conversation from the content of the grievance to the emotional state of the person delivering it. The function is silence. By making the expression of frustration illegitimate, the system ensures that only complaints delivered in a calm, grateful, system-approved tone are heard — which means only complaints that do not threaten the system are heard.",
        keywords: ["tone policing", "silencing", "delivery", "content", "complaints"],
      },
      {
        id: "the-weaponized-transparency",
        seed: "Weaponized transparency is the corporate practice of sharing selective information under the banner of openness to create the illusion of inclusion while maintaining information asymmetry. The all-hands meeting where revenue is shared but margin is not. The 'open-door policy' that logs every conversation. Transparency becomes a weapon when it is used to make you feel informed while keeping the information that would change your decisions hidden.",
        keywords: ["transparency", "weaponized", "selective", "illusion", "information asymmetry"],
      },
      {
        id: "the-pivot-to-values-deflection",
        seed: "When a manipulator is confronted with a factual accusation, they pivot to values. 'I thought we were all about trust here.' 'I'm disappointed that this is the kind of culture we're building.' The pivot to values deflection transforms a concrete problem — someone lied, someone stole credit, someone broke a commitment — into an abstract conversation about culture and feelings. The accuser becomes the cultural threat. The accused becomes the values guardian. The facts disappear.",
        keywords: ["values deflection", "pivot", "abstract", "facts", "culture"],
      },
      {
        id: "the-hero-complex-extraction",
        seed: "The hero complex extraction works by engineering crises and then positioning the manipulator as the only person who can solve them. The manager who creates chaos in a project and then works nights to fix it. The partner who destabilizes a relationship and then 'saves' it with a grand gesture. The pattern creates dependency: you begin to believe that without this person, everything would fall apart — not realizing they are the reason it is falling apart.",
        keywords: ["hero complex", "manufactured crisis", "dependency", "savior", "chaos"],
      },
      {
        id: "the-collective-punishment-lever",
        seed: "Collective punishment is the practice of punishing a group for one person's behavior to turn the group into a self-policing mechanism. The manager who cancels the team outing because one person missed a deadline. The policy change that affects everyone because one person violated the old policy. Collective punishment is efficient because the manipulator delegates enforcement to the peer group: you police each other so they do not have to.",
        keywords: ["collective punishment", "peer pressure", "self-policing", "group", "delegation"],
      },
      {
        id: "the-strategic-vulnerability-play",
        seed: "Strategic vulnerability is the performance of openness and weakness designed to lower your defenses and create an intimacy imbalance. The colleague who shares a personal struggle in a one-on-one meeting, creating pressure for you to reciprocate with information that can later be weaponized. The leader who tears up during an all-hands to immunize themselves from criticism. Vulnerability is the new armor. And armor that looks like a wound is the most difficult to penetrate.",
        keywords: ["strategic vulnerability", "performance", "intimacy imbalance", "weaponized", "defense"],
      },
      {
        id: "the-sealioning-exhaustion-tactic",
        seed: "Sealioning is the relentless demand for evidence, explanation, and engagement delivered in a tone of polite curiosity. 'I'm just asking questions.' 'Can you provide a source for that?' 'I'd love to understand your reasoning.' The tactic works because it is designed to be individually reasonable and cumulatively exhausting. Each question is polite. The hundredth question is an assault. The target either engages until they are depleted or disengages and is labeled as someone who 'can't defend their position.'",
        keywords: ["sealioning", "exhaustion", "politeness", "evidence", "engagement"],
      },
      {
        id: "the-credit-theft-architecture",
        seed: "Credit theft in organizations follows a precise architecture: the manipulator positions themselves at the reporting junction — between the person who did the work and the person who evaluates the work. They relay results upward with language that implies ownership: 'we delivered,' 'my team executed,' 'I've been driving this initiative.' The person who did the work is one layer removed from the credit and has no visibility into how their output was presented. The theft is invisible because the victim never sees the presentation.",
        keywords: ["credit theft", "reporting junction", "visibility", "ownership language", "architecture"],
      },
      {
        id: "the-normalization-of-deviance",
        seed: "The normalization of deviance is the process by which unacceptable behavior becomes accepted through incremental repetition. The first time a meeting runs an hour over schedule, it is an exception. The twelfth time, it is 'just how things work here.' The first time a manager yells, it is alarming. The twentieth time, it is 'just their style.' Normalization of deviance is how abusive systems maintain themselves without ever issuing an explicit policy of abuse.",
        keywords: ["normalization", "deviance", "incremental", "acceptance", "systemic abuse"],
      },
      {
        id: "the-sandwich-feedback-manipulation",
        seed: "The feedback sandwich — positive, negative, positive — is not a communication technique. It is a manipulation format designed to make the recipient grateful for criticism. By wrapping the real message (you underperformed) in compliments (you're valued) and future-casting (I believe in your growth), the sandwich trains you to associate negative feedback with warmth. The next time you receive unqualified criticism, you feel its absence as hostility — conditioning you to prefer the manipulative format.",
        keywords: ["feedback sandwich", "manipulation", "conditioning", "criticism", "gratitude"],
      },
      {
        id: "the-voluntary-surveillance-opt-in",
        seed: "The most sophisticated surveillance systems do not monitor you against your will — they convince you to monitor yourself. Step counters, productivity apps, screen-time reports, wellness check-ins — each creates a self-surveillance habit that generates data the system can access. When the tracking is voluntary, consent is implicit and continuous. You are not being watched. You are watching yourself and handing over the footage.",
        keywords: ["surveillance", "voluntary", "self-monitoring", "data", "consent"],
      },
      {
        id: "the-meritocracy-myth-deployment",
        seed: "Meritocracy is not a system — it is a narrative deployed to justify existing hierarchies. If outcomes are determined by merit, then everyone who is on top deserves to be there, and everyone at the bottom deserves their position. The meritocracy myth converts structural advantage into personal virtue and structural disadvantage into personal failure. It is the most effective containment narrative ever written because the contained enforce it on each other.",
        keywords: ["meritocracy", "myth", "hierarchy", "structural advantage", "narrative"],
      },
      {
        id: "the-access-as-compensation-trick",
        seed: "Access to senior leadership, industry events, or prestigious projects is presented as a form of compensation. 'You'll get exposure.' 'This is a career-defining opportunity.' 'Not everyone gets to be in the room.' The access-as-compensation trick converts proximity to power into a substitute for actual payment. You are trading labor for the privilege of watching someone else exercise the authority you do not have. Access is not equity. It is the window of a cage that faces the sky.",
        keywords: ["access", "compensation", "exposure", "proximity", "privilege"],
      },
    ],

    // ─────────────────────────────────────────────────
    // PATTERN-INTERRUPT
    // ─────────────────────────────────────────────────
    "pattern-interrupt": [
      {
        id: "the-autopilot-detection-scan",
        seed: "The most dangerous state a human can occupy is autopilot — the condition of executing complex behaviors with zero conscious engagement. Driving a familiar route with no memory of the trip. Nodding through a meeting while composing a grocery list. Saying 'I'm fine' without checking whether it is true. The autopilot detection scan is the practice of interrupting yourself at random intervals to ask: am I here, or am I running a script?",
        keywords: ["autopilot", "unconscious", "scripts", "awareness", "detection"],
      },
      {
        id: "the-comfort-zone-expansion-fallacy",
        seed: "The advice to 'step outside your comfort zone' assumes the comfort zone is a fixed boundary. It is not. It is a dynamic system that contracts every time you retreat and expands every time you push. The pattern interrupt is not about dramatic leaps. It is about daily micro-pushes that prevent the boundary from contracting to the point where your entire life fits inside a box the size of a routine. The comfort zone is not a zone. It is a muscle that atrophies without use.",
        keywords: ["comfort zone", "contraction", "expansion", "micro-pushes", "atrophy"],
      },
      {
        id: "the-outrage-addiction-circuit",
        seed: "Outrage produces a neurochemical cocktail — cortisol, adrenaline, dopamine — that mimics the experience of doing something about a problem without actually doing anything. The outrage addiction circuit is the pattern where you consume content that makes you angry, share it with commentary, receive social validation for the sharing, and cycle back to the next piece of outrage content. The circuit gives you the feeling of engagement while producing zero change. You are metabolizing rage for entertainment and calling it activism.",
        keywords: ["outrage", "addiction", "neurochemical", "activism illusion", "circuit"],
      },
      {
        id: "the-identity-calcification-warning",
        seed: "There is a moment in every person's life — usually between thirty-five and forty-five — when their identity calcifies: they stop updating their beliefs, stop experimenting with new behaviors, and begin defending who they have been instead of exploring who they could become. The calcification is invisible to the person experiencing it. They call it maturity. They call it knowing themselves. What they mean is: the cost of change now exceeds their tolerance for discomfort.",
        keywords: ["identity", "calcification", "stagnation", "maturity", "change resistance"],
      },
      {
        id: "the-consumption-trance-state",
        seed: "The consumption trance is the hypnotic state induced by passive intake — scrolling, watching, listening — where time distortion occurs and three hours compress into what feels like thirty minutes. The trance state is not relaxation. It is dissociation that mimics rest while providing none of the restorative benefits. You exit the trance more depleted than you entered it, with a vague sense of loss that you cannot explain because you cannot remember what you consumed.",
        keywords: ["consumption", "trance", "dissociation", "time distortion", "depletion"],
      },
      {
        id: "the-people-pleasing-short-circuit",
        seed: "People-pleasing is not kindness. It is a conflict-avoidance circuit that sacrifices your authentic position to maintain the illusion of harmony. The short circuit fires before you can access your actual preference: 'Where do you want to eat?' 'Wherever you want.' The response bypasses your own desire entirely and routes directly to appeasement. The pattern interrupt requires you to pause long enough to locate your actual answer before the circuit completes its default path.",
        keywords: ["people-pleasing", "conflict avoidance", "authenticity", "circuit", "appeasement"],
      },
      {
        id: "the-comparison-reflex-disarm",
        seed: "The comparison reflex fires within two hundred milliseconds of encountering evidence of someone else's success. Your salary versus theirs. Your body versus theirs. Your progress versus their timeline. The reflex is pre-rational — it fires before you can evaluate whether the comparison is valid, relevant, or even accurate. Disarming the comparison reflex is not about positive thinking. It is about recognizing that the reflex is operating on incomplete data presented in a curated format and that no conclusion drawn from it is reliable.",
        keywords: ["comparison", "reflex", "success", "incomplete data", "disarm"],
      },
      {
        id: "the-narrative-loop-detection",
        seed: "Everyone runs a small number of internal narratives on loop — stories about who they are, what they deserve, and what is possible. 'I always end up in the same situation.' 'People like me don't get opportunities like that.' 'I'm not the kind of person who...' These loops have been playing so long that they feel like facts rather than stories. The pattern interrupt is the moment you catch the loop mid-sentence and ask: is this a fact, or is this a story I have told myself so many times that it hardened into a belief?",
        keywords: ["narrative loop", "internal stories", "beliefs", "detection", "hardening"],
      },
      {
        id: "the-negativity-bias-override",
        seed: "The human brain processes negative information with more computational resources than positive information — a survival mechanism that made sense on the savanna and creates misery in the modern world. The negativity bias means that one critical comment outweighs ten compliments, one bad day erases a good week, and one failure obscures a pattern of success. The override is not optimism. It is the deliberate practice of forcing your attention to allocate processing power proportionally rather than according to threat priority.",
        keywords: ["negativity bias", "attention", "processing", "proportionality", "override"],
      },
      {
        id: "the-sunk-cost-emotional-anchor",
        seed: "Sunk cost is not just a financial concept. It operates emotionally in every domain of life. The relationship you stayed in for eight years because leaving would 'waste' the time invested. The career you continued because switching would 'throw away' the degree. The city you stayed in because moving would 'abandon' the life you built. The emotional anchor of sunk cost keeps you tethered to past decisions as if they were still active investments. They are not. They are receipts for experiences you have already had.",
        keywords: ["sunk cost", "emotional anchor", "investment", "relationship", "career"],
      },
      {
        id: "the-perfection-paralysis-break",
        seed: "Perfectionism is not a high standard. It is a fear of judgment wearing the mask of quality. The perfection paralysis pattern: conceive an idea, begin execution, notice imperfections, restart, notice more imperfections, restart again, abandon project, feel failure. The break is not about lowering standards — it is about recognizing that the standard is being used as a weapon against completion. Shipping something imperfect and learning from the response will always outperform the perfect thing that never existed.",
        keywords: ["perfectionism", "paralysis", "fear of judgment", "completion", "shipping"],
      },
      {
        id: "the-reactive-living-diagnosis",
        seed: "Reactive living is the condition of spending your entire day responding to inputs rather than generating outputs. The email that redirects your morning. The notification that derails your focus. The request that overwrites your priority. At the end of a reactive day, you have accomplished a great deal — all of it on someone else's agenda. The diagnosis is simple: if you cannot name the one thing you chose to do today that no external input prompted, you lived reactively. Again.",
        keywords: ["reactive", "responding", "inputs", "agenda", "diagnosis"],
      },
      {
        id: "the-worry-rehearsal-waste",
        seed: "Worry is the mental rehearsal of a future event that may never occur, performed with full emotional intensity as if it were happening now. Studies suggest that eighty-five percent of worried-about events never happen, and of the fifteen percent that do, seventy-nine percent are handled better than expected. Worry rehearsal wastes the only non-renewable resource you have — present-moment cognitive capacity — on a simulation that has no predictive value and produces real physiological damage.",
        keywords: ["worry", "rehearsal", "future", "simulation", "waste"],
      },
      {
        id: "the-victim-loop-interrupt",
        seed: "The victim loop is the narrative cycle where every negative outcome is attributed to external forces and every positive outcome is attributed to luck. The loop protects the ego from the pain of responsibility but at the cost of agency. If nothing is your fault, nothing is in your control. The interrupt is not about blame — it is about asking: in this situation, what was the variable I controlled, and what would changing that variable have produced? Responsibility is not punishment. It is the price of power.",
        keywords: ["victim loop", "external attribution", "agency", "responsibility", "power"],
      },
      {
        id: "the-binary-thinking-trap",
        seed: "Binary thinking reduces the full spectrum of reality into two categories: good or bad, success or failure, with me or against me. The trap is seductive because binary conclusions feel decisive and clear. But reality operates on spectrums, and reducing a spectrum to two points eliminates every option that lives between them — which is where most solutions, opportunities, and truths actually reside. The pattern interrupt is expanding every 'either/or' into 'what are the seventeen options between these two extremes?'",
        keywords: ["binary", "spectrum", "reduction", "options", "complexity"],
      },
    ],

    // ─────────────────────────────────────────────────
    // INFORMATION-WARFARE
    // ─────────────────────────────────────────────────
    "information-warfare": [
      {
        id: "the-attention-economy-extraction",
        seed: "Your attention is the commodity being sold. Every platform, every algorithm, every notification is optimized to extract the maximum possible duration of your conscious awareness and convert it into advertising revenue. You are not using the product. You are the product being processed. The attention economy does not need your money. It needs your time, because your time can be sold to the highest bidder in millisecond auctions that happen before the page finishes loading.",
        keywords: ["attention economy", "commodity", "extraction", "advertising", "time"],
      },
      {
        id: "the-algorithmic-radicalization-funnel",
        seed: "Recommendation algorithms do not radicalize through ideology — they radicalize through engagement optimization. The algorithm does not know or care what you believe. It knows that increasingly extreme content produces increasingly strong emotional responses, and strong emotional responses produce longer watch times. The radicalization funnel is an emergent property of engagement optimization, not a designed outcome. This makes it more dangerous, not less, because there is no one to appeal to. The machine has no intent. It only has a metric.",
        keywords: ["algorithm", "radicalization", "engagement", "extremism", "emergent"],
      },
      {
        id: "the-firehose-of-falsehood-doctrine",
        seed: "The firehose of falsehood is a propaganda technique that does not try to convince you of a single lie — it floods the information environment with so many contradictory claims that you give up trying to determine what is true. The goal is not belief. It is exhaustion. When you are too overwhelmed to distinguish truth from fabrication, you default to whatever narrative requires the least cognitive effort. The firehose does not need to win the argument. It needs to make you stop arguing.",
        keywords: ["firehose", "falsehood", "propaganda", "exhaustion", "cognitive surrender"],
      },
      {
        id: "the-manufactured-controversy-generator",
        seed: "Manufactured controversy is the creation of artificial debate around settled questions to delay action and maintain the status quo. Climate science was 'controversial' for three decades after scientific consensus was established. Tobacco and cancer were 'debatable' for two decades after the data was conclusive. The controversy does not need to be genuine — it only needs to be visible enough to give decision-makers cover for inaction. Manufacturing doubt costs a fraction of the profits it protects.",
        keywords: ["manufactured controversy", "doubt", "delay", "consensus", "inaction"],
      },
      {
        id: "the-context-collapse-weapon",
        seed: "Context collapse is the condition where a message intended for one audience is received by all audiences simultaneously. The joke told to close friends that is screenshotted and shared with strangers. The internal memo that leaks. The ten-year-old post resurfaced in a new political climate. Context collapse is weaponized when bad actors deliberately strip context to transform a nuanced statement into a scandalous one. The weapon requires no fabrication — only selective framing of real material.",
        keywords: ["context collapse", "audience", "framing", "selective", "weaponization"],
      },
      {
        id: "the-astroturf-consensus-illusion",
        seed: "Astroturfing is the creation of fake grassroots support to manufacture the appearance of organic consensus. Bot accounts, coordinated review campaigns, purchased social proof, paid protesters — each creates the illusion that a position has broad public support when it may have none. The technique works because humans use social proof as a cognitive shortcut: if enough people appear to believe something, your brain automatically increases its plausibility assessment. Astroturfing hacks this shortcut at industrial scale.",
        keywords: ["astroturfing", "fake consensus", "social proof", "bots", "illusion"],
      },
      {
        id: "the-deepfake-trust-erosion",
        seed: "The deepfake threat is not that fake content will be mistaken for real. It is that real content will be dismissed as fake. Once the public internalizes that any video, audio, or image can be fabricated, the concept of visual evidence loses its authority entirely. This is the true information warfare payload: not the production of convincing fakes, but the destruction of trust in authentic documentation. When nothing can be proven, anything can be denied.",
        keywords: ["deepfake", "trust erosion", "evidence", "denial", "authentication"],
      },
      {
        id: "the-outrage-amplification-loop",
        seed: "Outrage content receives sixty-seven percent more engagement than neutral content. This single metric has restructured the entire information ecosystem around emotional provocation. Every news outlet, every content creator, every platform is incentivized to amplify the most rage-inducing framing of every event. The loop is self-reinforcing: outrage generates engagement, engagement generates revenue, revenue incentivizes more outrage. The information environment is not broken. It is optimized — for the wrong objective function.",
        keywords: ["outrage", "amplification", "engagement", "revenue", "optimization"],
      },
      {
        id: "the-censorship-by-noise",
        seed: "The most effective form of censorship in the modern era is not suppression — it is burial. You do not need to remove information when you can drown it in noise. A critical investigation can be neutralized by flooding the search results with irrelevant content using the same keywords. A whistleblower's testimony can be rendered invisible by timing its release against a larger, more emotionally compelling story. Censorship by noise is censorship that leaves no fingerprints because the censored content technically remains accessible.",
        keywords: ["censorship", "noise", "burial", "flooding", "accessibility illusion"],
      },
      {
        id: "the-filter-bubble-calcification",
        seed: "Filter bubbles are not just echo chambers — they are calcification environments where beliefs harden into certainties through the systematic elimination of contradictory information. The algorithm does not show you opposing views because opposing views reduce engagement. Over time, the bubble replaces epistemic humility with tribal certainty. You do not believe you are right because you have evaluated the evidence. You believe you are right because you have never been shown the counter-evidence.",
        keywords: ["filter bubble", "calcification", "echo chamber", "epistemic humility", "algorithm"],
      },
      {
        id: "the-pre-bunking-vs-debunking-gap",
        seed: "Debunking a false claim after it has spread is six times less effective than pre-bunking it before exposure. Once a claim has been encoded in memory, the correction attaches to the original claim rather than replacing it — creating a mental association between the topic and the falsehood, even in people who accept the correction. The pre-bunking gap is the strategic window where inoculation is possible, and most institutions miss it entirely because they are organized to respond, not to anticipate.",
        keywords: ["pre-bunking", "debunking", "misinformation", "memory", "inoculation"],
      },
      {
        id: "the-credential-hijacking-method",
        seed: "Credential hijacking is the practice of using a legitimate credential in one domain to claim authority in an unrelated domain. The surgeon who opines on economics. The physicist who lectures on policy. The celebrity who endorses medical treatments. The method works because the audience transfers trust earned in one context to claims made in another, and the credentialed person's confidence in their own expertise makes the boundary violation invisible to them. The most dangerous misinformation comes from people who are genuinely expert — in something else.",
        keywords: ["credential hijacking", "authority transfer", "domain", "trust", "expertise"],
      },
      {
        id: "the-data-as-weapon-paradigm",
        seed: "Data is not neutral. The same dataset can be used to support contradictory conclusions depending on which variables are highlighted, which timeframe is selected, and which visualization is chosen. Data-as-weapon is the practice of curating statistics to construct a predetermined narrative while maintaining the appearance of objectivity. The phrase 'the data shows' is often more accurately translated as 'the data I selected and framed in the way I chose shows.'",
        keywords: ["data", "weapon", "statistics", "curation", "objectivity illusion"],
      },
      {
        id: "the-memory-hole-technique",
        seed: "The memory hole technique is the systematic deletion of records, statements, and evidence that contradict the current narrative. Edited tweets, deleted press releases, revised policy documents, scrubbed interview transcripts — each creates a gap in the historical record that makes the current version of events appear to be the only version. The internet was supposed to make the memory hole impossible. Instead, it made it faster: content can be memory-holed and replaced before anyone archives the original.",
        keywords: ["memory hole", "deletion", "records", "historical record", "narrative control"],
      },
      {
        id: "the-bothsidesism-false-balance",
        seed: "Bothsidesism is the journalistic practice of presenting two sides of an issue as equally valid when the evidence overwhelmingly supports one side. By giving equal airtime to a climate scientist and a climate denier, the format implies that the question is fifty-fifty when the scientific consensus is ninety-seven to three. False balance is not fairness — it is a narrative structure that manufactures doubt by treating asymmetric evidence pools as symmetrical. The format is the manipulation.",
        keywords: ["bothsidesism", "false balance", "journalism", "doubt", "asymmetry"],
      },
    ],

    // ─────────────────────────────────────────────────
    // NARRATIVE-CAPTURE
    // ─────────────────────────────────────────────────
    "narrative-capture": [
      {
        id: "the-origin-story-weaponization",
        seed: "Every power structure maintains an origin story that legitimizes its authority and obscures its mechanisms. The country that 'was founded on freedom' — by slaveholders. The company that 'started in a garage' — with a quarter-million in family money. The self-made billionaire who 'had nothing' — except every structural advantage their demographic could provide. Origin story weaponization is the practice of constructing a founding narrative that makes the current power arrangement feel inevitable rather than engineered.",
        keywords: ["origin story", "legitimization", "power", "founding narrative", "inevitability"],
      },
      {
        id: "the-hero-narrative-blinder",
        seed: "The hero narrative reduces complex systemic events to the actions of individual protagonists. The CEO who 'turned the company around' — ignoring the thousands of workers who executed the strategy. The president who 'saved the economy' — ignoring the structural forces that caused and resolved the crisis. The hero narrative is a blinder that prevents systemic analysis by focusing attention on a single person. When you see a hero, look behind them for the system they are being used to obscure.",
        keywords: ["hero narrative", "individual focus", "systemic blindness", "attribution", "obscuring"],
      },
      {
        id: "the-nostalgia-trap-deployment",
        seed: "Nostalgia is not memory — it is a narrative construct that selectively edits the past to create dissatisfaction with the present. The 'good old days' never existed as experienced by the nostalgic. They are a composite of the best moments stripped of the context that made those moments possible — including the suffering, inequality, and limitation that accompanied them. The nostalgia trap is deployed politically to make regression feel like restoration.",
        keywords: ["nostalgia", "selective memory", "past", "regression", "restoration illusion"],
      },
      {
        id: "the-bootstrap-mythology",
        seed: "The bootstrap myth is the narrative that individual effort is sufficient to overcome structural disadvantage. It requires the audience to believe that success is available to anyone who works hard enough — which logically requires believing that failure is the product of insufficient effort. The mythology serves a precise function: it prevents the examination of structural barriers by converting every systemic problem into an individual one. If you can just pull yourself up, the system is not the problem. You are.",
        keywords: ["bootstrap", "individual effort", "structural barriers", "mythology", "self-blame"],
      },
      {
        id: "the-language-of-inevitability",
        seed: "The most powerful narrative capture technique is framing the current arrangement as inevitable. 'Markets will always...' 'Human nature is...' 'You can't fight...' The language of inevitability converts a choice into a law of nature. Slavery was 'inevitable' until it was abolished. Monarchies were 'inevitable' until they were replaced. Every system that benefited from stasis has used the language of inevitability to prevent the imagination of alternatives.",
        keywords: ["inevitability", "language", "stasis", "imagination", "alternatives"],
      },
      {
        id: "the-prosperity-gospel-transfer",
        seed: "The prosperity gospel is not confined to churches. It has been transferred to the secular world as the belief that wealth is a moral indicator — that rich people are better, smarter, or more deserving than poor people. The transfer is complete when poverty is treated as a character defect rather than a structural condition. The prosperity gospel narrative captures the poor as thoroughly as the rich: both groups internalize the belief that the hierarchy is moral, not mechanical.",
        keywords: ["prosperity gospel", "wealth morality", "character", "hierarchy", "internalization"],
      },
      {
        id: "the-national-exceptionalism-script",
        seed: "National exceptionalism is the narrative that one's own nation is uniquely virtuous, uniquely chosen, or uniquely important in human history. The script creates a filter through which all national actions — including atrocities — are interpreted as necessary, justified, or exceptional circumstances. Under the exceptionalism script, the same behavior that is condemned when performed by other nations is reframed as 'complicated' or 'contextual' when performed by your own. The script does not require citizens to be uninformed. It requires them to process information through a filter of tribal loyalty.",
        keywords: ["exceptionalism", "nation", "virtue", "filter", "double standard"],
      },
      {
        id: "the-deserving-vs-undeserving-frame",
        seed: "The deserving/undeserving frame is the narrative infrastructure that determines which groups receive empathy and which receive judgment. The 'deserving poor' are sick, elderly, or disabled — their poverty is acceptable because it is not their 'fault.' The 'undeserving poor' are able-bodied, young, or addicted — their poverty is a moral failure. The frame's function is to prevent universal solidarity by dividing the affected population into those worthy of help and those who should be punished for needing it.",
        keywords: ["deserving", "undeserving", "empathy", "judgment", "solidarity prevention"],
      },
      {
        id: "the-complexity-weaponization",
        seed: "When a simple truth threatens a power structure, the first defense is to insist that 'it's more complicated than that.' Complexity weaponization is the practice of introducing nuance not to illuminate but to paralyze. By insisting that every issue has seventeen sides and no clear answer, the manipulator converts clarity into fog and action into analysis paralysis. Sometimes the truth is simple. The insistence that it is not is often a defense of the arrangement that benefits from your confusion.",
        keywords: ["complexity", "weaponization", "nuance", "paralysis", "fog"],
      },
      {
        id: "the-scarcity-narrative-engine",
        seed: "The scarcity narrative — there is not enough for everyone — is the foundational story that justifies competition, hierarchy, and the hoarding of resources. It operates even in conditions of abundance because scarcity is not a material condition; it is a narrative frame. When food is thrown away while people starve, when houses sit empty while people sleep outside, when medicine exists but is priced beyond reach — the problem is not scarcity. It is the narrative that scarcity is the problem, which prevents examination of the distribution system that is the actual problem.",
        keywords: ["scarcity", "narrative", "abundance", "distribution", "competition"],
      },
      {
        id: "the-generational-blame-deflection",
        seed: "Generational blame — millennials are lazy, boomers are selfish, Gen Z can't focus — is a narrative deflection that prevents class analysis by encouraging horizontal conflict between age groups. While generations argue about who ruined the economy, the structural forces that produced wage stagnation, housing unaffordability, and wealth concentration go unexamined. Generational blame is a horizontal narrative deployed to prevent vertical analysis. Look up, not sideways.",
        keywords: ["generational blame", "deflection", "horizontal conflict", "class analysis", "distraction"],
      },
      {
        id: "the-innovation-narrative-cover",
        seed: "The innovation narrative frames every disruption as progress and every displaced worker as collateral in an inevitable march forward. 'You can't stop progress' is the sentence that converts human suffering into a footnote. The narrative captures by pre-framing all critique of technological displacement as backward-thinking nostalgia. The question is not whether innovation is good. The question is who captures the value and who absorbs the cost — and the innovation narrative is designed to prevent that question from being asked.",
        keywords: ["innovation", "disruption", "progress", "displacement", "value capture"],
      },
      {
        id: "the-personal-responsibility-shield",
        seed: "Personal responsibility is a real principle weaponized into a systemic deflection tool. When used to prevent examination of structural causes, personal responsibility functions as a shield that protects systems from accountability. 'Take responsibility for your health' — said in a food desert with no sidewalks. 'Take responsibility for your finances' — said to someone whose wages have not kept pace with inflation for forty years. The principle is sound. The deployment is a narrative weapon.",
        keywords: ["personal responsibility", "weaponized", "systemic deflection", "accountability", "structural"],
      },
      {
        id: "the-freedom-as-consumer-choice",
        seed: "Freedom has been narratively captured and redefined as consumer choice. The freedom to choose between forty brands of cereal is treated as equivalent to the freedom to determine the conditions of your labor. The freedom to post on any social platform is treated as equivalent to the freedom to organize. By redefining freedom as the ability to choose between options within a system, the narrative eliminates the question of whether the system itself is freely chosen.",
        keywords: ["freedom", "consumer choice", "redefinition", "narrative capture", "system"],
      },
      {
        id: "the-war-metaphor-normalization",
        seed: "The war metaphor has colonized every domain of civic life: the war on drugs, the war on poverty, the war on terror, the war on cancer. The function of the war metaphor is to normalize emergency powers, suppress dissent (you don't question the general during battle), and frame complex social problems as enemies to be destroyed rather than conditions to be understood. Once a problem is narratively captured by the war frame, the only acceptable response is escalation.",
        keywords: ["war metaphor", "normalization", "emergency powers", "dissent", "escalation"],
      },
    ],

    // ─────────────────────────────────────────────────
    // FRAME-CONTROL
    // ─────────────────────────────────────────────────
    "frame-control": [
      {
        id: "the-question-as-frame-setter",
        seed: "The person who asks the question controls the frame. 'Should we lay off ten percent or twenty percent?' — the question eliminates the option of zero layoffs. 'Are you still having problems with your team?' — the question presupposes problems exist. Frame control through questioning is the most invisible form of manipulation because the target believes they are making an autonomous choice when they are actually selecting from a menu designed by someone else.",
        keywords: ["questions", "frame setting", "presupposition", "manipulation", "menu"],
      },
      {
        id: "the-anchor-drop-technique",
        seed: "The anchor drop is the practice of introducing an extreme position first to make the actual ask seem reasonable. Request a hundred-thousand-dollar budget; accept fifty thousand as a 'compromise.' Propose a four-day work week; settle for flexible Fridays. The anchor does not need to be realistic — it only needs to shift the reference point against which the real proposal is evaluated. Every negotiation, every policy debate, every interpersonal request is shaped by whoever drops the anchor first.",
        keywords: ["anchoring", "reference point", "negotiation", "extreme position", "compromise"],
      },
      {
        id: "the-moral-frame-hijack",
        seed: "The moral frame hijack converts a strategic disagreement into a moral one. 'So you don't care about the customer' — said to someone who questioned a pricing strategy. 'I guess integrity doesn't matter to you' — said to someone who pushed back on a deadline. The hijack works because defending your morality requires more energy than conceding the strategic point. By the time you have proven you are a good person, the original decision has been made without your input.",
        keywords: ["moral framing", "hijack", "defense", "strategic", "energy"],
      },
      {
        id: "the-status-quo-bias-exploitation",
        seed: "Status quo bias is the cognitive preference for the current state of affairs, even when changing would produce better outcomes. Frame controllers exploit this bias by framing any proposed change as risky and the current arrangement as stable — regardless of how dysfunctional the current arrangement actually is. 'Why would we change something that's working?' is the status quo frame. The counter-question that breaks the frame: 'Working for whom?'",
        keywords: ["status quo", "bias", "change resistance", "risk framing", "exploitation"],
      },
      {
        id: "the-victim-frame-immunization",
        seed: "The victim frame is a control technique where the frame controller positions themselves as the injured party to prevent accountability. The manager who feels 'attacked' when receiving feedback. The leader who is 'hurt' by criticism. The partner who claims emotional damage when confronted with their behavior. The victim frame immunizes the controller against scrutiny because the social contract demands that you comfort victims, not hold them accountable. Victimhood becomes a shield wielded by those with the most power.",
        keywords: ["victim frame", "immunization", "accountability dodge", "power", "shield"],
      },
      {
        id: "the-precedent-frame-lock",
        seed: "The precedent frame converts a one-time concession into a permanent expectation. 'You worked Saturday last time' becomes the frame for expecting you to work every Saturday. 'We gave you a discount once' becomes the frame for demanding a discount always. The precedent frame lock works because breaking precedent requires more social energy than maintaining it. Each repetition strengthens the lock until the original exception has been reframed as the new default.",
        keywords: ["precedent", "expectation", "concession", "default", "lock"],
      },
      {
        id: "the-emotional-frame-override",
        seed: "When logic favors one side and emotion favors the other, the emotional frame wins in almost every social context. Frame controllers know this and will deliberately introduce emotional content — personal stories, hypothetical children in danger, appeals to legacy — to override rational analysis. The emotional frame override does not make the logical argument wrong. It makes the logical argument feel cold, which in a group setting is equivalent to being wrong.",
        keywords: ["emotional frame", "logic override", "stories", "feeling", "group dynamics"],
      },
      {
        id: "the-expertise-frame-capture",
        seed: "The expertise frame positions one person as the knowledgeable authority and everyone else as uninformed participants. 'Speaking as someone who has been in this industry for twenty years...' is the frame capture — it establishes an asymmetry where challenging the person requires challenging their credentials, which feels socially dangerous. The counter-move is to reframe from credentials to outcomes: 'In your twenty years, what results has this approach produced?' Outcomes cannot hide behind tenure.",
        keywords: ["expertise", "frame capture", "credentials", "asymmetry", "outcomes"],
      },
      {
        id: "the-scarcity-frame-acceleration",
        seed: "The scarcity frame accelerates decisions by creating the perception of limited availability. 'Only three spots left.' 'This offer expires at midnight.' 'Others are already moving on this.' Scarcity triggers loss aversion — the fear of missing out overwhelms rational evaluation. The frame controller does not need to create actual scarcity. They only need you to believe that waiting has a cost. Perceived scarcity produces the same neurological urgency as real scarcity.",
        keywords: ["scarcity", "acceleration", "loss aversion", "urgency", "perceived"],
      },
      {
        id: "the-normative-frame-installation",
        seed: "Normative framing is the technique of presenting a preferred behavior as the social norm. 'Most people in your position would...' 'Studies show that successful people...' 'Everyone on the team has already agreed.' The normative frame exploits conformity bias — the desire to align with what is perceived as normal. The frame does not need to be accurate. It only needs to be delivered with confidence, because the target's fear of deviation will do the rest.",
        keywords: ["normative", "social norm", "conformity", "deviation", "installation"],
      },
      {
        id: "the-reframe-as-power-move",
        seed: "Reframing is the most direct form of frame control — the practice of taking someone else's frame and replacing it with yours in real time. 'This is a failure' → 'This is data.' 'We have a problem' → 'We have a decision to make.' 'You're being difficult' → 'I'm being precise.' The reframe is a power move because it signals that you refuse to operate inside someone else's cognitive architecture. It is the verbal equivalent of rearranging the furniture in a room someone else built.",
        keywords: ["reframe", "power move", "cognitive architecture", "replacement", "refusal"],
      },
      {
        id: "the-deficit-frame-vs-asset-frame",
        seed: "The deficit frame presents people and situations through the lens of what they lack. 'Underperforming schools.' 'At-risk youth.' 'Developing nations.' The frame positions the subject as broken and the frame controller as the fixer. The asset frame inverts this: what resources, capabilities, and strengths already exist? The shift from deficit to asset does not change the facts. It changes who holds the power in the conversation — and power determines outcomes.",
        keywords: ["deficit frame", "asset frame", "power", "lens", "positioning"],
      },
      {
        id: "the-temporal-frame-manipulation",
        seed: "Temporal frame manipulation controls which time horizon the audience evaluates. 'Think about your children's future' expands the frame. 'We need to act now' contracts it. The manipulator selects the timeframe that makes their preferred action seem most rational. Expanding the frame favors patience and investment. Contracting the frame favors urgency and reaction. The audience rarely notices that the timeframe was chosen for them, and the chosen timeframe pre-determines the conclusion.",
        keywords: ["temporal", "time horizon", "manipulation", "urgency", "patience"],
      },
      {
        id: "the-binary-frame-enforcement",
        seed: "Binary frame enforcement is the technique of reducing a complex situation to two options and then demanding that the target choose one. 'You're either with us or against us.' 'You either trust me or you don't.' 'You're either committed to this project or you're not.' The binary frame eliminates nuance, spectrum, and the option of 'neither' — all of which threaten the controller's position. Breaking the binary frame requires the courage to say: 'I reject the premise of the question.'",
        keywords: ["binary frame", "enforcement", "false dichotomy", "nuance", "rejection"],
      },
      {
        id: "the-accountability-frame-flip",
        seed: "The accountability frame flip is the technique of turning an accusation back on the accuser. 'The fact that you would even ask that question tells me something about your priorities.' 'I think the real issue here is your trust level, not my performance.' The flip redirects scrutiny from the person being held accountable to the person doing the holding. If executed with enough conviction, the original concern is abandoned while the accuser defends their own character. The flip works because most people are not prepared to be cross-examined when they expected to be the examiner.",
        keywords: ["accountability flip", "deflection", "cross-examination", "accusation", "redirection"],
      },
    ],
  },
};

/**
 * Pull an unused angle for the given brand+niche.
 * `usedIds` is the set of angle IDs already consumed (from Supabase or local tracking).
 * Returns null if all angles exhausted.
 */
export function pickUnusedAngle(
  brand: Brand,
  niche: string,
  usedIds: Set<string>,
): ThesisAngle | null {
  const angles = THESIS_ANGLES[brand]?.[niche];
  if (!angles) return null;
  const available = angles.filter((a) => !usedIds.has(a.id));
  if (available.length === 0) return null;
  // Shuffle and pick one
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  return shuffled[0];
}

/**
 * Get count of remaining unused angles for diagnostics.
 */
export function getAngleInventory(
  brand: Brand,
  niche: string,
  usedIds: Set<string>,
): { total: number; used: number; remaining: number } {
  const angles = THESIS_ANGLES[brand]?.[niche] ?? [];
  const used = angles.filter((a) => usedIds.has(a.id)).length;
  return { total: angles.length, used, remaining: angles.length - used };
}
