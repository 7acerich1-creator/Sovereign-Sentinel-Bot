import os
import sys
from dotenv import load_dotenv

# Ensure we can import from maven_crew
sys.path.append(os.path.join(os.getcwd(), 'maven_crew'))

from gmail_tool import GmailIngestorTool
from fireflies_tool import FirefliesIngestorTool

load_dotenv()

def verify_intake():
    print("🛰️ Starting Signal Verification...")
    
    # 1. Test Gmail
    print("\n[GMAIL] Testing Intake...")
    gmail = GmailIngestorTool()
    try:
        res = gmail._run(query="label:unread")
        print(f"[GMAIL] Response: {res[:200]}...")
    except Exception as e:
        print(f"[GMAIL] Failed: {e}")

    # 2. Test Fireflies
    print("\n[FIREFLIES] Testing Intake...")
    fireflies = FirefliesIngestorTool()
    try:
        res = fireflies._run()
        print(f"[FIREFLIES] Response: {res[:200]}...")
    except Exception as e:
        print(f"[FIREFLIES] Failed: {e}")

if __name__ == "__main__":
    verify_intake()
