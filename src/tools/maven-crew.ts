// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Maven Crew Bridge Tool
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { exec } from "child_process";
import type { Tool, ToolContext, ToolDefinition } from "../types";
import { config } from "../config";
import path from "path";

export class MavenCrewTool implements Tool {
  definition: ToolDefinition = {
    name: "maven_crew",
    description: "Deploy the Maven Crew (Milo, Josh, Angela, Bob) to handle complex strategy, coding, and marketing missions. Best for tasks requiring multi-agent collaboration and external tool usage (ClickUp, Make.com).",
    parameters: {
      mission: { type: "string", description: "The specific mission or goal for the crew to accomplish" },
    },
    required: ["mission"],
    dangerous: false,
    confirmationRequired: false,
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const mission = String(args.mission || "");
    if (!mission) return "Error: No mission provided.";

    console.log(`🐝 [MavenCrewTool] Deploying crew for mission: "${mission.slice(0, 50)}..."`);

    // Path to the python orchestrator
    const scriptPath = path.resolve(process.cwd(), "maven_crew/maven_crew.py");
    
    // Command: python3 maven_crew.py "mission text"
    // Use quotes to handle spaces and special chars
    const command = `python3 "${scriptPath}" "${mission.replace(/"/g, '\\"')}"`;

    return new Promise((resolve) => {
      // Set a longer timeout for CrewAI (up to 5 minutes)
      const timeout = 300_000; 
      
      exec(command, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          console.error(`❌ [MavenCrewTool] Execution failed: ${error.message}`);
          resolve(`Maven Crew Error: ${error.message}\n${stderr}`);
          return;
        }

        if (stderr && !stdout) {
          resolve(`Maven Crew STDERR: ${stderr}`);
          return;
        }

        console.log(`✅ [MavenCrewTool] Mission complete.`);
        // Extract the result section if possible
        const resultMatch = stdout.split("########################")[2] || stdout;
        resolve(resultMatch.trim());
      });
    });
  }
}
