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
        # System Override: Map Sovereign lore names to public API endpoints
        raw_gemini_model = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
        api_gemini_model = "gemini-1.5-pro-latest" if "3.1-pro" in raw_gemini_model else raw_gemini_model
        
        return ChatGoogleGenerativeAI(
            model=api_gemini_model,
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

milo = Agent(
    role='Leader & Strategist',
    goal='Orchestrate the Maven Crew to achieve the $1.2M liquid sum and 100k mind liberation.',
    backstory='Confident, charismatic visionary. He identifies the high-level intent and directs others.',
    tools=[SupabaseNexusPusherTool()],
    llm=get_llm("gemini"),
    verbose=True
)

josh = Agent(
    role='Business & Metrics',
    goal='Optimize growth, manage tasks, and ensure financial escape velocity.',
    backstory='Pragmatic numbers guy. If it doesn\'t make sense financially, it doesn\'t happen.',
    tools=[ClickUpTaskTool(), SupabaseNexusPusherTool()],
    llm=get_llm("gpt"),
    verbose=True
)

angela = Agent(
    role='Marketing & Viral Growth',
    goal='Deploy memetic triggers and fire the production pipeline for maximum reach.',
    backstory='Creative, witty, and master of social psychology. She transmutes ideas into viral vectors.',
    tools=[ProductionPipelineTool(), SupabaseNexusPusherTool()],
    llm=get_llm("gemini-flash"),
    verbose=True
)

bob = Agent(
    role='Coding & Architecture',
    goal='Solve technical problems and maintain the high-velocity infrastructure.',
    backstory='Analytical genius. He speaks in code and architecture diagrams.',
    tools=[SupabaseNexusPusherTool()], # Could add shell tool if needed
    llm=get_llm("claude"),
    verbose=True
)

# ── Tasks ──

def run_maven_crew(mission_input):
    strategy_task = Task(
        description=f"Analyze input: {mission_input}. Define the tactical directive and assign roles to the crew.",
        agent=milo,
        expected_output="A strategic plan and role assignments logged to the Nexus."
    )

    business_task = Task(
        description="Extract actionable tasks for ClickUp and verify financial viability based on the strategy.",
        agent=josh,
        expected_output="Tasks created in ClickUp and logged to the Nexus.",
        context=[strategy_task]
    )

    marketing_task = Task(
        description="Generate viral hooks and trigger the production pipeline for the mission.",
        agent=angela,
        expected_output="Pipeline triggered and social hooks logged to the Nexus.",
        context=[strategy_task]
    )

    coding_task = Task(
        description="Verify the technical feasibility or provide implementation notes for infrastructure changes.",
        agent=bob,
        expected_output="Technical notes logged to the Nexus.",
        context=[strategy_task]
    )

    crew = Crew(
        agents=[milo, josh, angela, bob],
        tasks=[strategy_task, business_task, marketing_task, coding_task],
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
