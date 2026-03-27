import os
import json
import base64
from crewai.tools import BaseTool
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from dotenv import load_dotenv

load_dotenv()

class GmailIngestorTool(BaseTool):
    name: str = "Gmail Ingestor"
    description: str = (
        "Connects to Gmail using OAuth2 credentials from .env and fetches unread "
        "emails from the last 24 hours. Returns a JSON string of emails."
    )

    def _run(self, query: str = "label:unread") -> str:
        try:
            # Use credentials from .env (shared with Calendar sync)
            creds_data = {
                "client_id": os.getenv("GOOGLE_CLIENT_ID"),
                "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
                "refresh_token": os.getenv("GOOGLE_REFRESH_TOKEN"),
                "token_uri": "https://oauth2.googleapis.com/token",
            }
            
            if not all(creds_data.values()):
                return "Error: Missing Google OAuth2 credentials in .env."

            creds = Credentials.from_authorized_user_info(creds_data)
            service = build('gmail', 'v1', credentials=creds)

            # Fetch unread messages
            results = service.users().messages().list(userId='me', q=query, maxResults=10).execute()
            messages = results.get('messages', [])

            if not messages:
                return "No unread emails found."

            emails_list = []
            for msg in messages:
                m = service.users().messages().get(userId='me', id=msg['id']).execute()
                
                payload = m.get('payload', {})
                headers = payload.get('headers', [])
                
                subject = next((h['value'] for h in headers if h['name'] == 'Subject'), '(No Subject)')
                sender = next((h['value'] for h in headers if h['name'] == 'From'), '(Unknown Sender)')
                
                # Snippet is usually enough for synthesis
                snippet = m.get('snippet', '')
                
                emails_list.append({
                    "id": msg['id'],
                    "from": sender,
                    "subject": subject,
                    "snippet": snippet,
                    "timestamp": m.get('internalDate')
                })

            return json.dumps(emails_list)
        except Exception as e:
            return f"Error fetching Gmail: {e}"
