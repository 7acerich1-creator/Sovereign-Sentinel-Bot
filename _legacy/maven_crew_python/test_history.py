from vid_rush_engine import VidRushEngine

def test_history():
    engine = VidRushEngine()
    print("🧪 Testing Agent History Logging...")
    
    # Test logging for Yuki
    engine.log_interaction(
        agent_name="Yuki",
        role="Viral Agent",
        content="Test message: Pattern interrupt identified in the wealth niche.",
        metadata={"test": True}
    )
    
    print("✅ Test log sent. Checking if errors occurred in console above.")

if __name__ == "__main__":
    test_history()
