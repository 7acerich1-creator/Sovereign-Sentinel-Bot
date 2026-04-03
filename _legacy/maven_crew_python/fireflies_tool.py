import os
import json
import requests
from crewai.tools import BaseTool
from dotenv import load_dotenv

load_dotenv()

class FirefliesIngestorTool(BaseTool):
    name: str = "Fireflies Ingestor"
    description: str = (
        "Connects to Fireflies.ai API using the FIREFLIES_API_KEY and fetches "
        "the latest meeting transcripts. Returns a JSON string of transcripts."
    )

    def _run(self, query: str = None) -> str:
        try:
            api_key = os.getenv("FIREFLIES_API_KEY")
            if not api_key:
                return "Error: FIREFLIES_API_KEY not set in environment."

            url = "https://api.fireflies.ai/graphql"
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }

            # Query for the last 5 transcripts
            gql_query = """
            query {
              transcripts(limit: 5) {
                id
                title
                date
                summary {
                  keywords
                  action_items
                  overview
                }
                sentences {
                  text
                  speaker_name
                }
              }
            }
            """

            response = requests.post(url, headers=headers, json={'query': gql_query})
            response.raise_for_status()
            
            data = response.json()
            transcripts = data.get('data', {}).get('transcripts', [])
            
            if not transcripts:
                return "No transcripts found in Fireflies."

            return json.dumps(transcripts)
        except Exception as e:
            return f"Error fetching Fireflies transcripts: {e}"
