import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: agents, error } = await supabase.from('agents').select('*');
  if (error) {
    console.error('Error fetching agents:', error);
    return;
  }
  console.log(`Fetched ${agents.length} agents:`);
  const hermes = agents.find(a => a.is_overseer);
  console.log('Hermes agent ID:', hermes?.id);
  if (hermes) {
    const { data: config, error: configError } = await supabase
      .from('agent_configs')
      .select('*')
      .eq('agent_id', hermes.id)
      .maybeSingle();
      
    if (configError) {
      console.error('Config fetch error:', configError);
    } else {
      console.log('Hermes Config:', JSON.stringify(config, null, 2));
    }
  }
}
run();
