import os
import subprocess
from crewai.tools import BaseTool

class AgyAgentCreateTool(BaseTool):
    """
    Antigravity Agent Mission Orchestrator Tool.
    Executes the 'agy agent create' command to spawn a mission-focused sub-agent.
    """
    name: str = "Agy Agent Creator"
    description: str = (
        "Spawns a specialized sub-agent for a specific mission. "
        "Inputs: mission (string), workspace (string), model (string). "
        "Example: agy agent create --mission 'Build a high-converting landing page' --workspace '/path/to/project' --model 'gpt-4o'"
    )

    def _run(self, mission: str, workspace: str, model: str = "gpt-4o") -> str:
        # Resolve the path to the agy.py script (local to maven_crew)
        script_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "agy.py")
        )

        import sys
        command = [
            sys.executable, script_path,
            "agent", "create",
            "--mission", mission,
            "--workspace", workspace,
            "--model", model
        ]

        try:
            print(f"🤖 [TOOL] Executing Agy Agent Mission: {mission[:50]}...")
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                check=True
            )
            return f"Success: {result.stdout}"
        except subprocess.CalledProcessError as e:
            return f"Error executing mission: {e.stderr}"
        except Exception as e:
            return f"Unexpected Error: {e}"
