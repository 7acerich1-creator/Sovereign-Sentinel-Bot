import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")

def check_history_table():
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    print(f"📡 Checking Supabase at {SUPABASE_URL}...")
    
    try:
        # Check for agent_history
        res = supabase.table("agent_history").select("*").limit(1).execute()
        print("✅ 'agent_history' table exists.")
    except Exception as e:
        print(f"⚠️ 'agent_history' table missing or error: {e}")
        print("\n--- [PROPOSED SQL FOR AGENT HISTORY] ---")
        print("""
CREATE TABLE IF NOT EXISTS public.agent_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name TEXT NOT NULL,
    role TEXT,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_history_name ON public.agent_history(agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_history_created_at ON public.agent_history(created_at DESC);
        """)

if __name__ == "__main__":
    check_history_table()
