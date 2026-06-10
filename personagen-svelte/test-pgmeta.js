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

const supabaseUrl = env.PUBLIC_SUPABASE_URL; // e.g. https://l2g-supabase.zi1cc5.easypanel.host
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

async function run() {
  console.log('Testing pg-meta /pg/query endpoint...');
  try {
    const url = `${supabaseUrl}/pg/query`;
    console.log('Sending request to URL:', url);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: 'SELECT 1 as test;'
      })
    });

    console.log('Status:', response.status);
    const text = await response.text();
    console.log('Response:', text);
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
