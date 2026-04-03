import os
import json
from datetime import datetime, timedelta
from crewai.tools import BaseTool
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from dotenv import load_dotenv

load_dotenv()

class GoogleCalendarIngestorTool(BaseTool):
    name: str = "Google Calendar Ingestor"
    description: str = (
        "Connects to Google Calendar using OAuth2 credentials from .env and fetches "
        "upcoming events for the next 7 days. Returns a JSON string of events."
    )

    def _run(self, query: str = None) -> str:
        try:
            # Use credentials from .env
            creds_data = {
                "client_id": os.getenv("GOOGLE_CLIENT_ID"),
                "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
                "refresh_token": os.getenv("GOOGLE_REFRESH_TOKEN"),
                "token_uri": "https://oauth2.googleapis.com/token",
            }
            
            if not all(creds_data.values()):
                return "Error: Missing Google OAuth2 credentials in .env."

            creds = Credentials.from_authorized_user_info(creds_data)
            service = build('calendar', 'v3', credentials=creds)

            # Define time range: now to 7 days from now
            now = datetime.utcnow().isoformat() + 'Z'  # 'Z' indicates UTC time
            time_max = (datetime.utcnow() + timedelta(days=7)).isoformat() + 'Z'

            print(f"Fetching events from {now} to {time_max}...")
            
            events_result = service.events().list(
                calendarId='primary',
                timeMin=now,
                timeMax=time_max,
                maxResults=10, 
                singleEvents=True,
                orderBy='startTime'
            ).execute()
            
            events = events_result.get('items', [])

            if not events:
                return "No upcoming events found in Google Calendar."

            events_list = []
            for event in events:
                start = event['start'].get('dateTime', event['start'].get('date'))
                events_list.append({
                    "id": event.get('id'),
                    "summary": event.get('summary', '(No Summary)'),
                    "start": start,
                    "location": event.get('location', 'N/A'),
                    "link": event.get('htmlLink')
                })

            return json.dumps(events_list)
        except Exception as e:
            return f"Error fetching Google Calendar: {e}"
