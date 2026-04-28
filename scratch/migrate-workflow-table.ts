import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function migrate() {
  console.log("🚀 Starting Sapphire Workflow Migration...");

  // Create sapphire_workflow_steps table
  const { error: tableError } = await supabase.rpc('exec_sql', {
    sql_string: `
      CREATE TABLE IF NOT EXISTS sapphire_workflow_steps (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          plan_id UUID REFERENCES sapphire_plans(id) ON DELETE CASCADE,
          target_name TEXT NOT NULL,
          dependencies JSONB DEFAULT '[]',
          recipe TEXT,
          status TEXT DEFAULT 'stale',
          artifact JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Add status index for build performance
      CREATE INDEX IF NOT EXISTS idx_workflow_steps_plan_status ON sapphire_workflow_steps(plan_id, status);
    `
  });

  if (tableError) {
    // If rpc exec_sql is not available, we'll try a direct fetch to check existence
    console.warn("⚠️ RPC exec_sql might not be available. Checking table existence...");
    const { error: checkError } = await supabase.from('sapphire_workflow_steps').select('id').limit(1);
    if (checkError && checkError.code === '42P01') {
      console.error("❌ Table sapphire_workflow_steps does not exist and could not be created via RPC. Please create it manually in the Supabase SQL Editor.");
      console.log(`
SQL TO RUN:
CREATE TABLE sapphire_workflow_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_id UUID REFERENCES sapphire_plans(id) ON DELETE CASCADE,
    target_name TEXT NOT NULL,
    dependencies JSONB DEFAULT '[]',
    recipe TEXT,
    status TEXT DEFAULT 'stale',
    artifact JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
      `);
    } else {
      console.log("✅ Table sapphire_workflow_steps already exists or was created.");
    }
  } else {
    console.log("✅ Table sapphire_workflow_steps created successfully via RPC.");
  }
}

migrate();
