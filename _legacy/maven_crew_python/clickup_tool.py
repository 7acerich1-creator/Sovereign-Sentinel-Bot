import os
import json
import requests
from crewai.tools import BaseTool
from dotenv import load_dotenv

load_dotenv()

CLICKUP_API_BASE = "https://api.clickup.com/api/v2"

# Priority map: urgency_score 1-10 → ClickUp priority (1=urgent, 2=high, 3=normal, 4=low)
def _score_to_priority(score: int) -> int:
    if score >= 9:
        return 1  # urgent
    elif score >= 7:
        return 2  # high
    elif score >= 4:
        return 3  # normal
    return 4      # low


class ClickUpTaskCreatorTool(BaseTool):
    """Push actionable tasks from synthesized directives into ClickUp for Architect review."""
    name: str = "ClickUp Task Creator"
    description: str = (
        "Create tasks in the Architect's ClickUp list directly from synthesized strategic directives. "
        "Accepts a JSON string with keys: 'tasks' (array of objects, each with 'name', 'description', "
        "and optional 'urgency_score' 1-10). Returns creation status for each task."
    )

    def _run(self, tasks_json: str) -> str:
        api_token = os.getenv("CLICKUP_API_TOKEN")
        list_id = os.getenv("CLICKUP_LIST_ID")

        if not api_token:
            return "[CLICKUP ERROR] CLICKUP_API_TOKEN not set in environment."
        if not list_id:
            return "[CLICKUP ERROR] CLICKUP_LIST_ID not set in environment."

        try:
            data = json.loads(tasks_json)
        except (json.JSONDecodeError, TypeError):
            return f"[CLICKUP ERROR] Invalid JSON input: {tasks_json}"

        tasks = data.get("tasks", [])
        if not tasks:
            # Treat as single task if top-level keys match
            if "name" in data:
                tasks = [data]
            else:
                return "[CLICKUP ERROR] No tasks found in payload."

        headers = {
            "Authorization": api_token,
            "Content-Type": "application/json"
        }

        results = []
        for task in tasks:
            task_name = task.get("name", "Untitled Sovereign Task")
            description = task.get("description", "")
            urgency = int(task.get("urgency_score", 5))
            priority = _score_to_priority(urgency)

            payload = {
                "name": task_name,
                "description": description,
                "priority": priority,
                "status": "to do",
                "tags": ["sovereign-synthesis", "architect-review"]
            }

            try:
                resp = requests.post(
                    f"{CLICKUP_API_BASE}/list/{list_id}/task",
                    headers=headers,
                    json=payload,
                    timeout=10
                )
                if resp.status_code in (200, 201):
                    task_id = resp.json().get("id", "unknown")
                    results.append(f"[CREATED] '{task_name}' → Task ID: {task_id} (Priority: {priority})")
                else:
                    results.append(
                        f"[FAILED] '{task_name}' → HTTP {resp.status_code}: {resp.text[:150]}"
                    )
            except requests.exceptions.Timeout:
                results.append(f"[TIMEOUT] '{task_name}' → ClickUp API timed out.")
            except Exception as e:
                results.append(f"[ERROR] '{task_name}' → {e}")

        return "\n".join(results)
