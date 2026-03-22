import { spawn } from "child_process";
import path from "path";
import { config } from "./config";

/**
 * Trigger the Maven Crew orchestrator as a Python subprocess.
 * Returns the stdout output from the crew run.
 */
export function runMavenCrew(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!config.mavenCrew.enabled) {
      resolve("⚠️ Maven Crew is disabled in config.");
      return;
    }

    const crewPath = path.resolve(__dirname, "..", config.mavenCrew.path);
    const scriptPath = path.join(crewPath, "maven_crew_orchestrator.py");

    const proc = spawn("python3", [scriptPath], {
      cwd: crewPath,
      env: { ...process.env },
      timeout: 300_000, // 5 min max
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout || "Maven Crew completed (no output).");
      } else {
        reject(
          new Error(
            `Maven Crew exited with code ${code}.\nSTDERR: ${stderr.slice(-500)}`
          )
        );
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn Maven Crew: ${err.message}`));
    });
  });
}

/**
 * Trigger the Sovereign Crew (content synthesis) with raw text input.
 */
export function runSovereignCrew(rawText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!config.mavenCrew.enabled) {
      resolve("⚠️ Maven Crew is disabled in config.");
      return;
    }

    const crewPath = path.resolve(__dirname, "..", config.mavenCrew.path);
    const scriptPath = path.join(crewPath, "sovereign_crew.py");

    const proc = spawn("python3", [scriptPath], {
      cwd: crewPath,
      env: { ...process.env, RAW_TEXT_INPUT: rawText },
      timeout: 300_000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout || "Sovereign Crew completed.");
      } else {
        reject(
          new Error(
            `Sovereign Crew exited with code ${code}.\nSTDERR: ${stderr.slice(-500)}`
          )
        );
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn Sovereign Crew: ${err.message}`));
    });
  });
}
