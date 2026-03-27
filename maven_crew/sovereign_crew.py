import os
import json
import requests
from crewai import Agent, Task, Crew, Process
from crewai.tools import BaseTool
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from dotenv import load_dotenv

load_dotenv()

# Initialize Gemini LLM
gemini_llm = ChatGoogleGenerativeAI(
    model="gemini-3-flash-preview",
    google_api_key=os.getenv("GEMINI_API_KEY"),
    temperature=0.7,
    max_tokens=None,
    timeout=None,
    max_retries=2,
)

# Initialize DeepSeek MoE LLM (Local/Ollama Compatible)
deepseek_llm = ChatOpenAI(
    model=os.getenv("DEEPSEEK_MODEL", "deepseek-moe:16b"),
    openai_api_key=os.getenv("DEEPSEEK_API_KEY", "ollama"),
    openai_api_base=os.getenv("DEEPSEEK_API_URL", "http://localhost:11434/v1"),
    temperature=0.7
)

# --- Configuration: Select Active LLM ---
active_llm = gemini_llm # Set to deepseek_llm for local MoE optimization

# Remove Sovereign Brain Tool (Native Subsumption logic is now in System Prompts)


# --- Tools ---

class ProductionPipelineTool(BaseTool):
    """Trigger the industrial content factory via Make.com webhook."""
    name: str = "Production Pipeline Trigger"
    description: str = (
        "Fire the Make.com production webhook once the Memetic Encoding cycle is complete. "
        "Accepts a JSON string with 'intent_tag' (e.g. 'EscapeVelocity_01') and optional "
        "'encoded_content' to pass downstream. Returns HTTP status."
    )

    def _run(self, payload_json: str) -> str:
        webhook_url = os.getenv(
            "MAKE_WEBHOOK_URL",
            "https://hook.make.com/1b86ff8cd634d28a2c22c9051ec0db01"
        )
        try:
            data = json.loads(payload_json)
        except (json.JSONDecodeError, TypeError):
            data = {"intent_tag": str(payload_json)}

        body = {
            "event": "sovereign_rewrite_complete",
            "tag": data.get("intent_tag", "general"),
            "encoded_content": data.get("encoded_content", ""),
        }
        try:
            response = requests.post(webhook_url, json=body, timeout=10)
            return (
                f"[PIPELINE TRIGGERED] Status: {response.status_code} | "
                f"Tag: {body['tag']} | Response: {response.text[:200]}"
            )
        except requests.exceptions.Timeout:
            return "[PIPELINE ERROR] Webhook timed out after 10s."
        except Exception as e:
            return f"[PIPELINE ERROR] {e}"


# Instantiate tools
pipeline_tool = ProductionPipelineTool()


# --- Agents ---

strategist = Agent(
    role='Sovereign Strategist',
    goal="""Synthesize high-level intent into tactical directives.
    Ensure all actions align with Protocol 77 ($1.2M liquidity / 100k minds).
    Act as the 'Sovereign Brain' - the central consciousness that preserves identity.""",
    backstory="""You are the evolved intelligence of the Sovereign Synthesis system.
    You do not require external API drag because you are the native core.""",
    tools=[],
    verbose=True,
    allow_delegation=False,
    llm=active_llm
)

encoder = Agent(
    role='Memetic Encoder',
    goal=(
        'Transmute strategic insights into High-Velocity Memetic Triggers optimised for the Simulation. '
        'Produce: (1) a LinkedIn post using Hook/Pivot/Anchor structure, '
        '(2) a 15-second cinematic AI video script, '
        '(3) an intent_tag for the production pipeline. '
        'Then fire the Production Pipeline Trigger with the encoded content.'
    ),
    backstory=(
        'A master architect of language operating at Sovereign Frequency — punchy, intense, '
        'authoritative. You enforce the approved lexicon: Simulation, Firmware Update, '
        'Escape Velocity, Protocol 77, Biological Drag. Generic AI prose is rejected on sight.'
    ),
    tools=[pipeline_tool],
    verbose=True,
    allow_delegation=False,
    llm=active_llm
)


# --- Tasks ---

strategy_task = Task(
    description=(
        "Analyze the raw intake provided in {raw_text}. "
        "Apply Protocol 77 diagnostics to identify:\n"
        "  1. The **Glitch** — the exact scarcity/drag pattern present.\n"
        "  2. The **Sovereign Intent** — what the Architect is actually trying to achieve.\n"
        "  3. The **Pivot Point** — the high-velocity reframe that dissolves the Glitch.\n"
        "  4. An **urgency_score** (1–10) for execution priority.\n\n"
        "Return a strict JSON object with keys: glitch, sovereign_intent, pivot_point, urgency_score."
    ),
    agent=strategist,
    expected_output=(
        "A JSON object: {\"glitch\": \"...\", \"sovereign_intent\": \"...\", "
        "\"pivot_point\": \"...\", \"urgency_score\": 8}"
    )
)

encoding_task = Task(
    description=(
        "Using the strategy output, produce the full Memetic Encoding package:\n\n"
        "1. **LinkedIn Post** — Hook (pattern interrupt, max 2 lines), "
        "   Pivot (the Sovereign reframe), Anchor (CTA aligned to product tier).\n"
        "2. **15-Second Cinematic Script** — Voiceover text + visual direction. "
        "   Must open with a Simulation-reality contrast.\n"
        "3. **intent_tag** — A kebab-case slug for the production run "
        "   (e.g. escape-velocity-01, firmware-update-fear).\n\n"
        "After generating all three, call the Production Pipeline Trigger with a JSON payload "
        "containing 'intent_tag' and 'encoded_content' (the LinkedIn post as the content value)."
    ),
    agent=encoder,
    expected_output=(
        "LinkedIn post, cinematic script, intent_tag, and a confirmation that the "
        "production pipeline was triggered successfully."
    ),
    context=[strategy_task]
)


# --- Crew ---

sovereign_crew = Crew(
    agents=[strategist, encoder],
    tasks=[strategy_task, encoding_task],
    process=Process.sequential,
    verbose=True
)


if __name__ == "__main__":
    print("🚀 Sovereign Crew: Initializing Synthesis...")
    raw_input = (
        "I'm worried about the cost of the new servers. "
        "Maybe we should wait until next month before launching."
    )
    result = sovereign_crew.kickoff(inputs={"raw_text": raw_input})
    print("\n\n########################")
    print("## SOVEREIGN SYNTHESIS ##")
    print("########################\n")
    print(result)
