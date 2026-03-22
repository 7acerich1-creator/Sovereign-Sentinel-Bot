import gkeepapi
import json
import os
from crewai.tools import BaseTool
from dotenv import load_dotenv

load_dotenv()

class GoogleKeepIngestorTool(BaseTool):
    name: str = "Google Keep Ingestor"
    description: str = (
        "Connects to Google Keep using provided credentials and fetches all active notes. "
        "Returns a JSON string of notes."
    )

    def _run(self, query: str = None) -> str:
        try:
            keep = gkeepapi.Keep()
            username = os.getenv("GOOGLE_KEEP_USERNAME")
            password = os.getenv("GOOGLE_KEEP_PASSWORD")
            
            if not username or not password:
                return "Error: GOOGLE_KEEP_USERNAME or GOOGLE_KEEP_PASSWORD not set in environment."
                
            keep.login(username, password)
            notes_list = []
            for note in keep.all():
                if not note.archived and not note.trashed:
                    notes_list.append({
                        "id": note.id,
                        "title": note.title,
                        "content": note.text,
                        "labels": [label.name for label in note.labels],
                        "timestamp": note.timestamps.updated.isoformat()
                    })
            return json.dumps(notes_list)
        except Exception as e:
            return f"Error fetching Google Keep notes: {e}"
