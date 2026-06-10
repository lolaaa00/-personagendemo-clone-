import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)\s*$/);
  if (match) {
    let val = match[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    env[match[1]] = val;
  }
});

const supabaseUrl = env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function run() {
  console.log('Listing available RPCs or running tests...');
  try {
    // Try a dummy RPC to see error message or response
    const { data, error } = await supabase.rpc('exec_sql', { sql: 'SELECT 1;' });
    if (error) {
      console.log('RPC error (exec_sql):', error.message);
    } else {
      console.log('RPC exec_sql exists! Result:', data);
    }
  } catch (err) {
    console.error('Catch error:', err);
  }
}

run();
