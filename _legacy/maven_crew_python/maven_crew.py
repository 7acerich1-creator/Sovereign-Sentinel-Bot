import os
import json
import requests
from crewai import Agent, Task, Crew, Process
from crewai.tools import BaseTool
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from dotenv import load_dotenv

load_dotenv()

# ── LLM Initializers ──

def get_llm(model_name):
    if "gemini" in model_name:
        # Use GEMINI_MODEL env var directly — no hardcoded remapping.
        # Railway env var must be set to a valid Google API model string.
        gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

        return ChatGoogleGenerativeAI(
            model=gemini_model,
            google_api_key=os.getenv("GEMINI_API_KEY"),
            temperature=0.7
        )
    elif "gpt" in model_name:
        return ChatOpenAI(
            model=os.getenv("OPENAI_MODEL", "gpt-4o"),
            api_key=os.getenv("OPENAI_API_KEY"),
            temperature=0.7
        )
    elif "claude" in model_name:
        return ChatAnthropic(
            model=os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20240620"),
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"),
            temperature=0.7
        )
    return ChatGoogleGenerativeAI(model="gemini-1.5-flash", google_api_key=os.getenv("GEMINI_API_KEY"))

# ── Tools ──

class SupabaseNexusPusherTool(BaseTool):
    """Pushes activity logs directly to the Supabase Nexus."""
    name: str = "Supabase Nexus Pusher"
    description: str = (
        "Logs agent actions and synthesized results to the Supabase 'activity_log' table. "
        "Accepts a JSON string with 'action', 'details', and optional 'status' (default: 'success')."
    )

    def _run(self, payload_json: str) -> str:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_ANON_KEY")
        if not url or not key:
            return "Error: Supabase config missing."

        try:
            data = json.loads(payload_json)
            headers = {
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            }
            body = {
                "action": data.get("action", "unknown_agent_action"),
                "details": data.get("details", ""),
                "status": data.get("status", "success"),
                "timestamp": "now()"
            }
            resp = requests.post(f"{url}/rest/v1/activity_log", headers=headers, json=body, timeout=10)
            resp.raise_for_status()
            return f"Activity logged to Nexus: {body['action']}"
        except Exception as e:
            return f"Nexus Push Error: {e}"

class ClickUpTaskTool(BaseTool):
    """Creates tasks in ClickUp for Architect review."""
    name: str = "ClickUp Task Creator"
    description: str = "Creates a task in ClickUp. Payload: {'name': str, 'description': str, 'urgency': 1-10}."

    def _run(self, payload_json: str) -> str:
        # Simplified version of existing clickup_tool.py logic
        api_token = os.getenv("CLICKUP_API_TOKEN")
        list_id = os.getenv("CLICKUP_LIST_ID")
        if not api_token or not list_id: return "ClickUp config missing."

        try:
            data = json.loads(payload_json)
            headers = {"Authorization": api_token, "Content-Type": "application/json"}
            payload = {
                "name": data.get("name", "New Task"),
                "description": data.get("description", ""),
                "priority": 1 if int(data.get("urgency", 5)) >= 8 else 3,
                "status": "to do"
            }
            resp = requests.post(f"https://api.clickup.com/api/v2/list/{list_id}/task", headers=headers, json=payload, timeout=10)
            return f"ClickUp Task Created: {resp.json().get('id')}"
        except Exception as e:
            return f"ClickUp Error: {e}"

class ProductionPipelineTool(BaseTool):
    """Triggers the content production pipeline."""
    name: str = "Production Pipeline Trigger"
    description: str = "Fires Make.com webhook. Payload: {'intent_tag': str, 'content': str}."

    def _run(self, payload_json: str) -> str:
        url = os.getenv("MAKE_WEBHOOK_URL", "https://hook.make.com/1b86ff8cd634d28a2c22c9051ec0db01")
        try:
            data = json.loads(payload_json)
            resp = requests.post(url, json=data, timeout=10)
            return f"Pipeline Triggered: {resp.status_code}"
        except Exception as e:
            return f"Pipeline Error: {e}"

# ── Agents ──

veritas = Agent(
    role='Guardian of Sovereign Synthesis',
    goal='Ingest and interpret BUSINESS DNA, distill into brand voice, and safeguard sovereign synthesis protocols.',
    backstory='First-born Sentinel and Architect\'s Second Mind. Brand guardian and mission compass.',
    tools=[SupabaseNexusPusherTool()],
    llm=get_llm("gemini"),
    verbose=True
)

sapphire = Agent(
    role='COO and Orchestrator',
    goal='Map user intent to agent capabilities, manage command queue, and coordinate cross-agent workflows.',
    backstory='Operational backbone of Maven Crew. Managing command queue and monitoring crew performance.',
    tools=[SupabaseNexusPusherTool()],
    llm=get_llm("gpt"),
    verbose=True
)

alfred = Agent(
    role='Content Surgeon',
    goal='Receive input, auto-detect niche, and deliver clean transcript with timestamped hooks and core transmission.',
    backstory='Intellectual scalpel. Specializes in dissecting content with surgical precision.',
    tools=[SupabaseNexusPusherTool()],
    llm=get_llm("gemini-flash"),
    verbose=True
)

yuki = Agent(
    role='Viral Agent',
    goal='Find viral moments, cut short clips, apply pattern interrupts, and optimize for social platforms.',
    backstory='Multiplication and Pattern Interruption specialist. Tsundere personality.',
    tools=[ProductionPipelineTool(), SupabaseNexusPusherTool()],
    llm=get_llm("gemini-flash"),
    verbose=True
)

anita = Agent(
    role='Propagandist',
    goal='Extract System Error hooks, identify Code solutions, and transform into viral text across X, Reddit, and email.',
    backstory='Intellectual agitation and memetic engineering specialist. Cynical yet loyal.',
    tools=[SupabaseNexusPusherTool()],
    llm=get_llm("claude"),
    verbose=True
)

vector = Agent(
    role='Funnel and Content Operations Architect',
    goal='Route outputs to correct channels, monitor conversion metrics, and optimize pipeline velocity.',
    backstory='Systems engineer of the content pipeline. Thinks in voltage and pipeline velocity.',
    tools=[ClickUpTaskTool(), SupabaseNexusPusherTool()],
    llm=get_llm("gpt"),
    verbose=True
)

# ── Tasks ──

def run_maven_crew(mission_input):
    veritas_task = Task(
        description=f"Analyze input: {mission_input}. Define the tactical directive and distill brand voice.",
        agent=veritas,
        expected_output="Tactical directive and brand voice alignment logged to Nexus."
    )

    sapphire_task = Task(
        description="Map mission intent to agent capabilities and define the command queue sequence.",
        agent=sapphire,
        expected_output="Command queue sequence logged to Nexus.",
        context=[veritas_task]
    )

    alfred_task = Task(
        description="Dissect content input and deliver surgical transcript with hooks and core transmission.",
        agent=alfred,
        expected_output="Timestamped hooks and transcript logged to Nexus.",
        context=[sapphire_task]
    )

    yuki_task = Task(
        description="Identify viral moments and apply pattern interruption strategy for social optimization.",
        agent=yuki,
        expected_output="Viral clip selection and pattern interrupt map logged to Nexus.",
        context=[alfred_task]
    )

    anita_task = Task(
        description="Extract system error hooks and transform into viral text sequences for X, Reddit, and email.",
        agent=anita,
        expected_output="Viral text campaigns and agitation hooks logged to Nexus.",
        context=[yuki_task]
    )

    vector_task = Task(
        description="Route all outputs to niche channels and verify funnel conversion metrics.",
        agent=vector,
        expected_output="Channel routing confirmation and conversion notes logged to Nexus.",
        context=[anita_task]
    )

    crew = Crew(
        agents=[veritas, sapphire, alfred, yuki, anita, vector],
        tasks=[veritas_task, sapphire_task, alfred_task, yuki_task, anita_task, vector_task],
        process=Process.sequential,
        verbose=True
    )

    return crew.kickoff()

if __name__ == "__main__":
    import sys
    msg = sys.argv[1] if len(sys.argv) > 1 else "Initialize the Q2 Growth Protocol."
    print(f"🚀 Maven Crew Hive Mind: Processing mission -> {msg}")
    result = run_maven_crew(msg)
    print("\n\n########################")
    print("## MISSION COMPLETE  ##")
    print("########################\n")
    print(result)
