const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config({ path: 'c:/Users/richi/Sovereign-Sentinel-Bot/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function forceActivate() {
  // Get current active_extras
  const { data: row } = await supabase
    .from('sapphire_known_facts')
    .select('value')
    .eq('key', 'active_extras')
    .single();

  const current = row?.value || "";
  if (!current.includes('complex_task_protocol')) {
    const next = current ? `${current},complex_task_protocol` : "complex_task_protocol";
    console.log(`Updating active_extras: [${current}] -> [${next}]`);
    await supabase.from('sapphire_known_facts').upsert({ key: 'active_extras', value: next, category: 'preferences' });
    console.log("Success.");
  } else {
    console.log("Protocol already active in DB.");
  }
}

forceActivate();
