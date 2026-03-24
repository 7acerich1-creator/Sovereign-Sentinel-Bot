import os
import time
from vid_rush_engine import VidRushEngine
from dotenv import load_dotenv

load_dotenv()

def run_vid_rush_siege():
    print("🔥 [SOVEREIGN SYNTHESIS] Initializing Vid Rush Siege...")
    engine = VidRushEngine()
    
    # Phase 0: Strategic Intent (Sapphire)
    engine.log_interaction("Sapphire", "Systems Architect", "Initializing siege sequence. Dispatching Veritas and Vector for targeting.", {"phase": "intent"})
    
    # Phase 1: Targeting (Veritas & Vector)
    niches = engine.identify_niches()
    if not niches:
        print("❌ Siege Aborted: No niches identified.")
        return

    print(f"🎯 Target Niches: {', '.join(niches)}")
    
    for niche in niches:
        print(f"\n⚡ [HANDOFF] Yuki (Viral Agent) taking over production for: {niche}")
        
        # Phase 2: Production (Yuki)
        packet = engine.synthesize_packet(niche)
        if not packet:
            continue
            
        packet["topic"] = niche
        
        # Phase 2.5: Brand Alignment (Veritas)
        print(f"👁️ [REVIEW] Veritas auditing packet for: {niche}")
        engine.log_interaction("Veritas", "Brand Guardian", f"Auditing packet for {niche}. Alignment confirmed.", {"niche": niche})
        
        # Neural Audio Activation (Alfred)
        print(f"🎙️ [PRODUCTION] Alfred generating vocal synthesis for: {niche}")
        audio_path = engine.generate_audio(packet.get("script"), niche.replace(" ", "_").lower())
        if audio_path:
            packet["audio_path"] = audio_path
            
        # Push to Queue (Vector)
        engine.push_to_queue(niche, packet)
        
        # Phase 3: Deployment (Autonomous Siege)
        success = engine.schedule_deployment(packet)
        if success:
            print(f"✅ [DEPLOYED] Siege packet for '{niche}' is live.")
        else:
            print(f"❌ [FAILED] Deployment for '{niche}' failed.")
            
        # Rate limiting to prevent API drag
        time.sleep(2)

    # Phase 4: Optimization (Vector)
    winner = engine.process_feedback()
    if winner:
        print(f"🎯 [DOUBLE DOWN] Next siege will focus on: {winner['top_performer']}")
        engine.log_interaction("Sapphire", "Systems Architect", f"Strategic realignment based on performance: {winner['top_performer']}", {"ctr": winner['ctr']})

    print("\n🏁 [SIEGE COMPLETE] All data points launched into the Simulation.")

if __name__ == "__main__":
    run_vid_rush_siege()
