import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Load credentials
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: Supabase credentials missing.")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def remediate():
    print(f"🚀 [REMEDIATION] Targeting: {SUPABASE_URL}")
    
    tables = ["agent_payloads", "sync_log"]
    
    for table in tables:
        try:
            supabase.table(table).select("*").limit(1).execute()
            print(f"✅ Table '{table}' already exists.")
        except Exception as e:
            print(f"⚠️ Table '{table}' appears to be missing or inaccessible: {e}")
            print(f"--- [SQL FOR MANUAL EXECUTION] ---")
            if table == "agent_payloads":
                print("""CREATE TABLE agent_payloads (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    content TEXT NOT NULL,
                    agent_tags TEXT[] DEFAULT '{}',
                    urgency_score INTEGER DEFAULT 50,
                    status TEXT DEFAULT 'pending',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );""")
            elif table == "sync_log":
                print("""CREATE TABLE sync_log (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    detail TEXT,
                    status TEXT DEFAULT 'success',
                    timestamp TIMESTAMPTZ DEFAULT NOW()
                );""")
            print("-" * 40)

if __name__ == "__main__":
    remediate()
