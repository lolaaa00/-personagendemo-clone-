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

async function run() {
  console.log('Fetching OpenAPI spec from PostgREST...');
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`
      }
    });
    if (!res.ok) {
      console.error('Fetch failed:', res.status, res.statusText);
      return;
    }
    const spec = await res.json();
    console.log('\n--- Paths in PostgREST Spec ---');
    const paths = Object.keys(spec.paths || {});
    paths.forEach(p => {
      console.log(p);
    });
  } catch (err) {
    console.error('Error fetching spec:', err);
  }
}

run();
