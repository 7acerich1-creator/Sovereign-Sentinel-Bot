import os
import json
import requests
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Path to the .env in the same directory
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

class SovereignIngestor:
    """
    Lightweight Content Engine for Sovereign Ascent.
    Fulfills the 'Maven' synthesis logic without the heavy CrewAI footprint.
    All secrets and Supabase functions target Sovereign_Ascent_Intake (wzthxohtgojenukmdubz).
    """
    def __init__(self):
        self.fireflies_key = os.getenv("FIREFLIES_API_KEY")
        self.mc_url = os.getenv("VERCEL_MISSION_CONTROL_API_URL")
        self.mc_key = os.getenv("VERCEL_MISSION_CONTROL_API_KEY")
        self.notion_key = os.getenv("NOTION_API_KEY")

    def fetch_fireflies(self):
        print("[INGESTION] Fetching Fireflies transcripts...")
        if not self.fireflies_key:
            print("[ERROR] FIREFLIES_API_KEY missing.")
            return []

        url = "https://api.fireflies.ai/graphql"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.fireflies_key}"
        }
        
        gql_query = """
        query {
          transcripts(limit: 3) {
            id
            title
            date
            summary {
              overview
              action_items
            }
          }
        }
        """
        try:
            response = requests.post(url, headers=headers, json={'query': gql_query})
            response.raise_for_status()
            data = response.json()
            return data.get('data', {}).get('transcripts', [])
        except Exception as e:
            print(f"[ERROR] Fireflies fetch failed: {e}")
            return []

    def push_to_mission_control(self, type, title, detail, status="success"):
        if not self.mc_url:
            print("[SKIP] Mission Control URL not configured.")
            return

        payload = {
            "type": type,
            "title": title,
            "detail": detail,
            "status": status,
            "timestamp": datetime.now().isoformat()
        }
        
        headers = {"Content-Type": "application/json"}
        if self.mc_key:
            headers["Authorization"] = f"Bearer {self.mc_key}"

        try:
            response = requests.post(self.mc_url, json=payload, headers=headers)
            response.raise_for_status()
            print(f"[SUCCESS] Pushed {title} to Mission Control.")
        except Exception as e:
            print(f"[ERROR] Mission Control push failed: {e}")

    def run_pulse(self):
        print(f"--- [SOVEREIGN PULSE] {datetime.now()} ---")
        
        # 1. Harvest Meeting Intel
        transcripts = self.fetch_fireflies()
        for t in transcripts:
            title = f"Meeting Intel: {t['title']}"
            overview = t.get('summary', {}).get('overview', 'No summary.')
            self.push_to_mission_control("intelligence", title, overview)

        # 2. Status Update
        self.push_to_mission_control(
            "system", 
            "🔱 Content Engine: ACTIVE", 
            "Sovereign Ingestor (v1.0) is monitoring all intake channels. Velocity accelerating."
        )

if __name__ == "__main__":
    engine = SovereignIngestor()
    engine.run_pulse()
