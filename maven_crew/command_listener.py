import os
import time
import json
from supabase import create_client, Client
from dotenv import load_dotenv

# Import the decoupled synthesis logic
from sovereign_crew import run_synthesis

# Load environment from maven_crew/ and root as fallback
load_dotenv()

# Supabase Configuration
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ ERROR: Supabase credentials missing from .env.")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def poll_command_queue():
    """
    Poll the command_queue for pending 'content_generation' commands.
    """
    print(f"📡 [SENTINEL] Sovereign Command Listener Active. Monitoring {SUPABASE_URL}...")
    
    while True:
        try:
            # 1. Fetch pending content_generation commands
            response = supabase.table("command_queue") \
                .select("*") \
                .eq("status", "Pending") \
                .execute()
            
            commands = response.data
            
            for cmd in commands:
                payload = cmd.get("payload", {})
                cmd_id = cmd.get("id")
                
                # Check if payload type is content_generation
                if payload.get("type") == "content_generation":
                    process_command(cmd_id, payload)
                else:
                    # Skip or log unknown types
                    print(f"⏩ Skipping unknown command type: {payload.get('type')}")
                    # Mark as Resolved to prevent infinite loops on unknown commands
                    supabase.table("command_queue").update({"status": "Resolved"}).eq("id", cmd_id).execute()

        except Exception as e:
            print(f"❌ [SENTINEL ERROR] Connection Glitch: {e}")
        
        time.sleep(10) # 10s heartbeat

def process_command(cmd_id, payload):
    """
    Execute the synthesis logic for a specific command.
    """
    content = payload.get("content")
    print(f"⚡ [EXECUTION] Processing Command {cmd_id}: {content[:50]}...")
    
    # 1. Mark as Executing
    supabase.table("command_queue").update({"status": "Executing"}).eq("id", cmd_id).execute()
    
    try:
        # 2. Trigger Synthesis
        print(f"🧠 [CREW] Launching Sovereign Synthesis...")
        result = run_synthesis(content)
        
        # 3. Mark as Resolved
        supabase.table("command_queue").update({"status": "Resolved"}).eq("id", cmd_id).execute()
        print(f"✅ [SUCCESS] Command {cmd_id} resolved. Output triggered to pipeline.")
        
        # 4. Optional: Log to agent_payloads if needed (though run_synthesis should handle its own outputs)
        
    except Exception as e:
        print(f"🛑 [GLITCH] Synthesis failure for command {cmd_id}: {e}")
        # Log to glitch_log
        supabase.table("glitch_log").insert({
            "severity": "Critical",
            "description": f"Command {cmd_id} Failed: {str(e)}",
            "resolution_steps": "Check CrewAI LLM connectivity and Make.com webhook status."
        }).execute()
        
        # Reset to Pending or mark as Resolved with error? Let's Resolve to prevent crash loops.
        supabase.table("command_queue").update({"status": "Resolved"}).eq("id", cmd_id).execute()

if __name__ == "__main__":
    poll_command_queue()
