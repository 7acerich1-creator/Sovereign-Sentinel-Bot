const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config({ path: 'c:/Users/richi/Sovereign-Sentinel-Bot/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkReminders() {
  const { data, error } = await supabase
    .from('sapphire_reminders')
    .select('*')
    .eq('status', 'pending');

  if (error) {
    console.error("Error fetching reminders:", error.message);
    return;
  }

  if (data.length === 0) {
    console.log("No pending reminders found.");
  } else {
    console.log(`Found ${data.length} pending reminders:`);
    data.forEach(r => {
      console.log(`- [${r.id}] Message: ${r.message} (Fire at: ${r.fire_at})`);
    });
  }
}

checkReminders();
