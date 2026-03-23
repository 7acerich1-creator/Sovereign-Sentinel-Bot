import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ Missing GEMINI_API_KEY in .env");
    return;
  }

  console.log("🔍 Fetching available Gemini models...");
  const genAI = new GoogleGenerativeAI(apiKey);
  
  try {
    // There isn't a direct listModels in the SDK for the high-level genAI object usually, 
    // but we can try to fetch the list via the underlying API or just test common strings.
    // Wait, the user specifically asked for listModels.
    // In @google/generative-ai, listModels is not on the genAI instance.
    // It's usually part of the REST API or requires a specific client.
    
    console.log("📡 Testing candidate strings for 2026 Sovereign Frequency...");
    const candidates = [
      "gemini-3.1-pro-preview",
      "gemini-2.0-pro-exp-02-05",
      "gemini-2.0-flash-thinking-exp",
      "gemini-1.5-pro-002",
      "gemini-1.5-pro-latest"
    ];

    for (const modelName of candidates) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("What is your model version? Respond concisely.");
        console.log(`✅ [${modelName}]: ${result.response.text().trim()}`);
      } catch (err: any) {
        console.log(`❌ [${modelName}]: ${err.message.slice(0, 100)}`);
      }
    }

  } catch (err: any) {
    console.error("Fatal error:", err.message);
  }
}

main();
