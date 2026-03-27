import os
import json
from crewai import Agent, Task, Crew, Process
from crewai.tools import BaseTool
from dotenv import load_dotenv
from notion_client import Client
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI

# Import local tools
from google_keep_tool import GoogleKeepIngestorTool
from gmail_tool import GmailIngestorTool
from google_calendar_tool import GoogleCalendarIngestorTool
from fireflies_tool import FirefliesIngestorTool
from mission_control_pusher import MissionControlPusherTool
from clickup_tool import ClickUpTaskCreatorTool

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
# Switch to deepseek_llm to reduce "struggle" and leverage local MoE efficiency.
active_llm = gemini_llm # Set to deepseek_llm for local MoE optimization

# Initialize tools
keep_tool = GoogleKeepIngestorTool()
gmail_tool = GmailIngestorTool()
calendar_tool = GoogleCalendarIngestorTool()
fireflies_tool = FirefliesIngestorTool()
mc_pusher_tool = MissionControlPusherTool()
clickup_tool = ClickUpTaskCreatorTool()


# --- Notion Tool ---
class NotionDashboardUpdaterTool(BaseTool):
    name: str = "Notion Dashboard Updater"
    description: str = "Updates a Notion database with synthesized themes or actionable projects."

    def _run(self, database_id: str, content_json: str) -> str:
        try:
            notion = Client(auth=os.getenv("NOTION_API_KEY"))
            content = json.loads(content_json)
            response = notion.pages.create(
                parent={"database_id": database_id},
                properties={
                    "Name": {"title": [{"text": {"content": content.get("title", "New Idea")}}]}},
                children=[
                    {"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"type": "text", "text": {"content": content.get("description", "No description.")}}]}}
                ]
            )
            return f"Successfully updated Notion. Page ID: {response['id']}"
        except Exception as e:
            return f"Error updating Notion: {e}"

# --- Agents ---

ingestor_agent = Agent(
    role='Input Ingestor',
    goal='Fetch all new nodes from Google Keep, Gmail, Google Calendar, and Fireflies to supply the matrix.',
    backstory='Specialized in gathering raw data from the Architect\'s primary input channels (Keep, Email, Calendar, Meetings).',
    tools=[keep_tool, gmail_tool, calendar_tool, fireflies_tool],
    verbose=True,
    allow_delegation=False,
    llm=active_llm
)

synthesizer_agent = Agent(
    role='Identity Synthesizer',
    goal="Analyze inputs and generate tactical directives via the Sovereign Brain's native consciousness.",
    backstory='The core intelligence of Maven, responsible for turning biological drag into structured power.',
    tools=[keep_tool, gmail_tool, calendar_tool, fireflies_tool],
    verbose=True,
    allow_delegation=False,
    llm=active_llm
)

architect_agent = Agent(
    role='Matrix Architect',
    goal=(
        'Structure synthesized insights into Notion, push events to Mission Control, '
        'and create actionable tasks in ClickUp for Architect review.'
    ),
    backstory='Ensures all insights are organized and immediately actionable across every matrix endpoint.',
    tools=[NotionDashboardUpdaterTool(), mc_pusher_tool, clickup_tool],
    verbose=True,
    allow_delegation=False,
    llm=active_llm
)

# --- Tasks ---

ingest_task = Task(
    description="Fetch all new Google Keep notes, unread emails from the last 24h, upcoming calendar events, and recent Fireflies meeting transcripts.",
    agent=ingestor_agent,
    expected_output="A JSON structure of raw multi-channel inputs (Notes, Emails, Transcripts)."
)

synthesis_task = Task(
    description=(
        "Synthesize raw inputs into high-velocity tactical directives using the Sovereign Brain. "
        "Return a JSON object with two keys:\n"
        "  'themes': array of synthesized insight strings,\n"
        "  'actionable_tasks': array of objects, each with 'name', 'description', and 'urgency_score' (1-10)."
    ),
    agent=synthesizer_agent,
    expected_output=(
        "JSON: {\"themes\": [...], \"actionable_tasks\": [{\"name\": \"...\", "
        "\"description\": \"...\", \"urgency_score\": 8}, ...]}"
    ),
    context=[ingest_task]
)

integration_task = Task(
    description=(
        "Using the synthesis output, execute all three integration steps:\n"
        "1. Push each synthesized theme to the Mission Control dashboard via the Mission Control Pusher.\n"
        "2. Update the Notion dashboard with a summary of the synthesis cycle.\n"
        "3. Call the ClickUp Task Creator with the 'actionable_tasks' array from the synthesis output "
        "   so each task lands in the Architect's ClickUp list for review.\n\n"
        "All three steps must be completed and confirmed."
    ),
    agent=architect_agent,
    expected_output=(
        "Confirmation of: Mission Control push, Notion update, and ClickUp task creation "
        "with task IDs for each actionable item."
    ),
    context=[synthesis_task]
)

# --- Crew ---

maven_crew = Crew(
    agents=[ingestor_agent, synthesizer_agent, architect_agent],
    tasks=[ingest_task, synthesis_task, integration_task],
    process=Process.sequential,
    verbose=True
)

if __name__ == "__main__":
    print("🚀 Maven Crew: Initializing...")
    result = maven_crew.kickoff()
    print("\n\n########################")
    print("## MAVEN CREW OUTPUT ##")
    print("########################\n")
    print(result)
