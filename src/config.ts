import dotenv from "dotenv";
dotenv.config();

export const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN!,
    authorizedUserId: parseInt(
      process.env.TELEGRAM_AUTHORIZED_USER_ID ||
        process.env.AUTHORIZED_USER_ID ||
        "8593700720",
      10
    ),
  },
  supabase: {
    url:
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "https://wzthxohtgojenukmdubz.supabase.co",
    anonKey:
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY!,
  },
  mavenCrew: {
    enabled: process.env.MAVEN_CREW_ENABLED !== "false",
    path: process.env.MAVEN_CREW_PATH || "./maven_crew",
  },
  makeIngestionWebhookUrl: process.env.MAKE_INGESTION_WEBHOOK_URL || "",
  missionControl: {
    apiUrl:
      process.env.VERCEL_MISSION_CONTROL_API_URL ||
      "https://mission-control-rho-jet.vercel.app/api/activity",
    apiKey: process.env.VERCEL_MISSION_CONTROL_API_KEY || "",
  },
  makeIngestion: {
    webhookUrl: process.env.MAKE_INGESTION_WEBHOOK_URL || "",
  },
  crewApi: {
    url: process.env.CREW_API_URL || "",
    key: process.env.CREW_API_KEY || "",
  },
};
