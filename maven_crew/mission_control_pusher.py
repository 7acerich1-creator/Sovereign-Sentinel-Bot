import requests
import json
import os
from crewai.tools import BaseTool
from dotenv import load_dotenv

load_dotenv()

class MissionControlPusherTool(BaseTool):
    name: str = "Mission Control Pusher"
    description: str = (
        "Pushes synthesized insights or actionable items to the Vercel "
        "Mission Control dashboard API."
    )

    def _run(self, data_json: str) -> str:
        try:
            url = os.getenv("VERCEL_MISSION_CONTROL_API_URL")
            api_key = os.getenv("VERCEL_MISSION_CONTROL_API_KEY")
            
            if not url:
                return "Error: VERCEL_MISSION_CONTROL_API_URL not set in environment."
                
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"

            payload = json.loads(data_json)
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()
            return f"Successfully pushed data to Mission Control: {response.text}"
        except Exception as e:
            return f"Error pushing to Mission Control: {e}"
