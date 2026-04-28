const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config({ path: 'c:/Users/richi/Sovereign-Sentinel-Bot/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function updatePiece() {
  const value = "When Ace initiates a 'complex task' or multi-step goal: (1) Call `create_plan` IMMEDIATELY. (2) For EACH step, call `set_reminder` with a staggered schedule (e.g. +2m, +1h) so you return to execute them automatically. (3) Create a task page using `notion_create_page` with hub_name='📁 Complex Tasks'. (4) Log all outcomes to that page. (5) COMPLETION: Once the final step is done, you MUST send a proactive DM to Ace saying 'Ace, [Task Name] is completed successfully. Deliverables are in Notion.' Never stop a complex task halfway without a self-reminder set to resume.";
  
  console.log("Updating piece_extras_complex_task_protocol...");
  const { error } = await supabase.from('sapphire_known_facts').upsert({ 
    key: 'piece_extras_complex_task_protocol', 
    value, 
    category: 'preferences' 
  });
  
  if (error) console.error("Error:", error.message);
  else console.log("Success.");
}

updatePiece();
