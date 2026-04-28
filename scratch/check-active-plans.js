const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: 'c:/Users/richi/Sovereign-Sentinel-Bot/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase URL or Key missing in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPlans() {
  const { data, error } = await supabase
    .from('sapphire_plans')
    .select('*')
    .neq('status', 'completed')
    .neq('status', 'cancelled');

  if (error) {
    console.error("Error fetching plans:", error.message);
    return;
  }

  if (data.length === 0) {
    console.log("No active plans found.");
  } else {
    console.log(`Found ${data.length} active plans:`);
    data.forEach(p => {
      console.log(`- [${p.id}] Goal: ${p.goal} (Status: ${p.status})`);
      console.log(`  Steps: ${JSON.stringify(p.steps)}`);
    });
  }
}

checkPlans();
