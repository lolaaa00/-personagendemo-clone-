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
  for (const a of agents) {
    console.log(`- Agent: ${a.name} (id: ${a.id}), Handle: ${a.handle}, Followers: ${a.followers}, Engagement: ${a.engagement_rate}%, Overseer: ${a.is_overseer}`);
  }

  const { data: connections, error: connError } = await supabase.from('connections').select('*');
  if (connError) {
    console.error('Error fetching connections:', connError);
    return;
  }
  console.log(`\nFetched ${connections.length} connections:`);
  for (const c of connections) {
    console.log(`- Connection: agent_id=${c.agent_id}, platform=${c.platform}, handle=${c.handle}, verified=${c.verified}, connected_at=${c.connected_at}`);
  }
}
run();
