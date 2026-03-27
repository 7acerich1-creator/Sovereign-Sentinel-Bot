import os
import argparse
import json
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage
from pathlib import Path

# Load environment
def init_env():
    if Path(".env").exists():
        load_dotenv(".env")
    elif Path("maven_crew/.env").exists():
        load_dotenv("maven_crew/.env")
    elif Path("../.env").exists():
        load_dotenv("../.env")

init_env()

def create_agent_mission(mission_text, workspace_path, model_name):
    """
    Core logic for 'agy agent create' using LangChain.
    """
    print(f"[AGY] Initializing Mission: '{mission_text[:50]}...'")
    
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print("[AGY] Mission Failure: No GEMINI_API_KEY or GOOGLE_API_KEY found.")
        return None

    # Clean model name
    clean_model_name = model_name.replace("models/", "")
    if "gpt-4o" in clean_model_name:
        clean_model_name = "gemini-3.1-pro-preview"

    # Initialize LLM via LangChain
    llm = ChatGoogleGenerativeAI(
        model=clean_model_name,
        google_api_key=api_key,
        temperature=0.2
    )

    system_prompt = """
    You are the Sovereign Synthesis Agent Architect. Your mission is to build a high-velocity, deterministic deliverable based on the provided mission.
    PROTOCOL: B.L.A.S.T. (Blueprint, Link, Architect, Stylize, Trigger)
    DESIGN LANGUAGE: Brutalist (High-contrast, raw sovereignty, no fluff, zero-friction).
    LEXICON: Simulation, Firmware Update, Escape Velocity, Protocol 77, Biological Drag.
    OUTPUT FORMAT: Return ONLY the raw code (e.g., Next.js/Tailwind). No backticks. No conversational text.
    """

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=f"MISSION: {mission_text}\nWORKSPACE: {workspace_path}")
    ]

    try:
        response = llm.invoke(messages)
        code_content = response.content

        # Write to workspace
        target_dir = Path(workspace_path) / "missions" / "vampire-scan"
        target_dir.mkdir(parents=True, exist_ok=True)
        
        target_file = target_dir / "page.tsx"
        with open(target_file, "w", encoding="utf-8") as f:
            f.write(code_content)

        print(f"[AGY] Mission Accomplished. Deliverable written to: {target_file}")
        return str(target_file)
    except Exception as e:
        print(f"[AGY] Mission Failure: {e}")
        return None

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command")
    agent_parser = subparsers.add_parser("agent")
    create_parser = agent_parser.add_subparsers(dest="subcommand").add_parser("create")
    create_parser.add_argument("--mission", required=True)
    create_parser.add_argument("--workspace", required=True)
    create_parser.add_argument("--model", default="gemini-3.1-pro-preview")
    args = parser.parse_args()
    if args.command == "agent" and args.subcommand == "create":
        create_agent_mission(args.mission, args.workspace, args.model)
