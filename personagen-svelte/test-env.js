import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load .env manually
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

async function checkTable(tableName) {
  try {
    const { data, error } = await supabase.from(tableName).select('*').limit(1);
    if (error) {
      console.log(`❌ Table [${tableName}] error: ${error.message} (code: ${error.code})`);
    } else {
      console.log(`✅ Table [${tableName}] exists! Columns:`, data.length > 0 ? Object.keys(data[0]) : '(empty table)');
    }
  } catch (err) {
    console.log(`❌ Table [${tableName}] catch error:`, err.message);
  }
}

async function run() {
  console.log('--- DB Schema Diagnostic ---');
  await checkTable('profiles');
  await checkTable('agents');
  await checkTable('agent_configs');
  await checkTable('posts');
  await checkTable('connections');
  await checkTable('blueprints');
  await checkTable('brand_briefs');
  await checkTable('tickets');
  await checkTable('subscriptions');
  await checkTable('processed_rss_items');
  await checkTable('chat_messages');
  await checkTable('agent_memories');
  console.log('----------------------------');
}

run();
