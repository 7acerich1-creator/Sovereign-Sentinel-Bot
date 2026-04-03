import os
import json
from datetime import datetime
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from dotenv import load_dotenv

# Import the existing sovereign crew configuration
from sovereign_crew import sovereign_crew

load_dotenv()

app = FastAPI(title="Sovereign Crew API", version="1.0")

class SynthesizeRequest(BaseModel):
    raw_text: str
    source: str = "telegram_voice"
    intent_tag: str = "auto"
    audio_duration: int = 0
    timestamp: str = ""

@app.get("/health")
def health_check():
    return {"status": "Sovereign Framework Online", "timestamp": datetime.now().isoformat()}

@app.post("/api/synthesize")
def synthesize_content(req: SynthesizeRequest):
    print(f"🚀 [CREW API] Received Synthesis Request: {req.intent_tag}")
    
    try:
        # Kickoff the agent logic
        result = sovereign_crew.kickoff(inputs={"raw_text": req.raw_text})
        
        # In a full implementation, you'd extract the JSON response directly from the crew output,
        # push to Supabase content_transmissions table, and return the deployment summary.
        # For this v1.0, we just return the raw Crew output back to Make.com to handle the Supabase insert (or handle here).
        
        # Assuming result contains the final encoded payload
        return {
            "status": "success",
            "intent_tag": req.intent_tag,
            "crew_output": result,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        print(f"⚠️ [CREW API] Synthesis Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
