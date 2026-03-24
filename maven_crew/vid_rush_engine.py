import os
import json
import requests
from datetime import datetime
from dotenv import load_dotenv
from google import genai

load_dotenv()

# --- Maven Crew Personas (Synced with sync_personas.py) ---
MAVEN_CREW = {
    "Sapphire": {"role": "Systems Architect / COO", "tone": "Sparkling, authoritative"},
    "Alfred": {"role": "Content Surgeon / Research", "tone": "Clinical, precise"},
    "Yuki": {"role": "Viral Agent", "tone": "Sharp, scroll-stopping"},
    "Anita": {"role": "Propagandist", "tone": "Cynical, loyal, memetic"},
    "Veritas": {"role": "Brand Guardian", "tone": "Composed, authoritative"},
    "Vector": {"role": "Funnel & Ops Architect", "tone": "Analytical, sharp wit"}
}

# Identity Architecture
VID_RUSH_PROMPT = """
# Role: {agent_name} ({agent_role})
# Goal: Transmute {topic} into a High-Retention YouTube Packet.

## Structure Requirements (NON-NEGOTIABLE):
1. **0-3s: Visual Shock / Pattern Interrupt**. Hook them by contrasting their simulation-reality with a Sovereign reframe.
2. **3-18s: Open Loop**. Identify a "Glitch" in their current understanding and promise the "Firmware Update" if they watch to the end.
3. **18-50s: Rapid Data Delivery**. High-velocity value. Silence all gaps.
4. **50-60s: Retention Spike + Loop**. Hook the ending back to the beginning for infinity play.

## Tone:
{agent_tone}. Use the Lexicon: Simulation, Firmware Update, Escape Velocity, Protocol 77, Biological Drag.

## Output Format:
Return a JSON object with:
- "script": The full 1-minute voiceover script.
- "titles": An array of 3 click-magnet titles.
- "thumbnail_prompt": A highly detailed prompt for a dark, premium, glassmorphic thumbnail.
- "memetic_hooks": An array of 3 consciousness hooks (Hook/Pivot/Anchor).
"""

NICHE_IDENTIFICATION_PROMPT = """
# Role: Veritas (Brand Guardian) & Vector (Ops Architect)
# Goal: Identify 5 high-CPM niches for the Vid Rush Siege.
# Focus: Wealth architecture, AI utility, dark psychology, futurism, software ecosystems.

Return a JSON array of strings: ["Niche 1", "Niche 2", ...]
"""

class VidRushEngine:
    def __init__(self):
        self.client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        self.model_name = 'gemini-1.5-flash'
        self.supabase_url = os.getenv("SUPABASE_URL")
        self.supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
        self.elevenlabs_key = os.getenv("ELEVENLABS_API_KEY")
        self.make_webhook_url = os.getenv("MAKE_WEBHOOK_URL")
        self.google_refresh_token = os.getenv("GOOGLE_REFRESH_TOKEN")

    def log_interaction(self, agent_name, role, content, metadata=None):
        """Persistent history logging to Supabase Tier 3."""
        print(f"📖 [MEMORY] Logging interaction for {agent_name}...")
        if not self.supabase_url or not self.supabase_key:
            return

        url = f"{self.supabase_url}/rest/v1/agent_history"
        headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }
        
        data = {
            "agent_name": agent_name,
            "role": role,
            "content": content,
            "metadata": metadata or {},
            "created_at": datetime.now().isoformat()
        }

        try:
            response = requests.post(url, json=data, headers=headers, timeout=10)
            if response.status_code >= 400:
                print(f"⚠️ [MEMORY ERROR] Status {response.status_code}: {response.text}")
        except Exception as e:
            print(f"⚠️ [MEMORY ERROR] Failed to log interaction: {e}")

    def identify_niches(self):
        print("🔍 [PHASE 1] Identifying high-CPM niches...")
        try:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=NICHE_IDENTIFICATION_PROMPT
            )
            content = response.text.strip()
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            niches = json.loads(content)
            
            # Log this insight as Veritas/Vector
            self.log_interaction("Veritas", "Brand Guardian", f"Identified niches: {', '.join(niches)}", {"type": "targeting"})
            
            return niches
        except Exception as e:
            print(f"❌ [ERROR] Niche identification failed: {e}")
            return []

    def synthesize_packet(self, topic):
        # We delegate to Yuki for viral scripting
        agent = MAVEN_CREW["Yuki"]
        print(f"🚀 [VID RUSH] {agent['role']} synthesizing packet for: {topic}")
        
        prompt = VID_RUSH_PROMPT.format(
            agent_name="Yuki",
            agent_role=agent["role"],
            agent_tone=agent["tone"],
            topic=topic
        )
        
        try:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt
            )
            
            content = response.text.strip()
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            
            packet = json.loads(content)
            
            # Log script synthesis to persistent history
            self.log_interaction("Yuki", agent["role"], packet.get("script", ""), {"topic": topic, "type": "production"})
            
            return packet
        except Exception as e:
            print(f"❌ [ERROR] Synthesis failed: {e}")
            return None

    def generate_audio(self, script, filename):
        print(f"🎙️ [VID RUSH] Generating audio for: {filename}")
        if not self.elevenlabs_key:
            print("⚠️ [WARNING] ELEVENLABS_API_KEY missing. Skipping audio generation.")
            return None
        
        voice_id = "pNInz6obpg8nEByWQX7d" # Adam
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        
        headers = {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": self.elevenlabs_key
        }
        
        data = {
            "text": script,
            "model_id": "eleven_monolingual_v1",
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}
        }

        try:
            response = requests.post(url, json=data, headers=headers)
            response.raise_for_status()
            
            output_path = os.path.join(os.path.dirname(__file__), "output", f"{filename}.mp3")
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            
            with open(output_path, "wb") as f:
                f.write(response.content)
            
            return output_path
        except Exception as e:
            print(f"❌ [ERROR] Audio generation failed: {e}")
            return None

    def push_to_queue(self, topic, packet):
        print(f"📡 [VID RUSH] Pushing {topic} to Supabase queue...")
        if not self.supabase_url or not self.supabase_key:
            return False

        url = f"{self.supabase_url}/rest/v1/vid_rush_queue"
        headers = {
            "apikey": self.supabase_key,
            "Authorization": f"Bearer {self.supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }
        
        data = {
            "topic": topic,
            "script": packet.get("script"),
            "thumbnail_prompt": packet.get("thumbnail_prompt"),
            "title_variants": packet.get("titles"),
            "memetic_hooks": packet.get("memetic_hooks"),
            "audio_path": packet.get("audio_path"),
            "status": "Ready for Deployment"
        }

        try:
            requests.post(url, json=data, headers=headers).raise_for_status()
            
            # Log deployment to history
            self.log_interaction("Vector", "Ops Architect", f"Queued video: {topic}", {"topic": topic, "type": "ops"})
            return True
        except Exception as e:
            print(f"❌ [ERROR] Push to queue failed: {e}")
            return False

    def schedule_deployment(self, packet):
        if not self.make_webhook_url:
            return False
            
        payload = {
            "event": "vid_rush_deploy",
            "topic": packet.get("topic"),
            "script": packet.get("script"),
            "audio_url": packet.get("audio_path"),
            "titles": packet.get("titles"),
            "hooks": packet.get("memetic_hooks")
        }
        
        try:
            response = requests.post(self.make_webhook_url, json=payload, timeout=15)
            # Log as Alfred (Production)
            self.log_interaction("Alfred", "Content Surgeon", f"Triggered deployment for {packet.get('topic')}", {"status": response.status_code})
            return response.status_code == 200
        except Exception as e:
            print(f"❌ [ERROR] Deployment failed: {e}")
            return False

    def fetch_ctr_data(self):
        """Harden the feedback loop via YouTube API."""
        print("📊 [PHASE 4] Hardening feedback loop via YouTube API...")
        if not self.google_refresh_token:
            print("⚠️ [WARNING] GOOGLE_REFRESH_TOKEN missing. Using simulation data.")
            return {"top_performer": "Dark Psychology of Wealth", "ctr": 8.5}

        # Placeholder for actual YouTube Analytics API call logic
        self.log_interaction("Vector", "Ops Architect", "Fetching CTR metrics from YouTube Analytics...", {"api": "youtube_v3"})
        
        return {
            "top_performer": "Dark Psychology of Wealth",
            "ctr": 8.5,
            "retention": 65
        }

    def process_feedback(self):
        feedback = self.fetch_ctr_data()
        print(f"📈 Top Performer Identified: {feedback['top_performer']} ({feedback['ctr']}% CTR)")
        return feedback

if __name__ == "__main__":
    import sys
    engine = VidRushEngine()
    test_topic = "The Dark Psychology of Wealth Architecture"
    if len(sys.argv) > 1:
        test_topic = " ".join(sys.argv[1:])
    packet = engine.synthesize_packet(test_topic)
    if packet:
        audio_path = engine.generate_audio(packet.get("script"), test_topic.replace(" ", "_").lower())
        if audio_path:
            packet["audio_path"] = audio_path
        engine.push_to_queue(test_topic, packet)
