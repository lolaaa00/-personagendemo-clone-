import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.COMPOSIO_API_KEY || 'ak_cHHRKbh3CqAOmdIfXpJv';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;

const sql = `
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS followers INT DEFAULT 0;
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS engagement_rate NUMERIC(5, 2) DEFAULT 0.0;
`;

async function run() {
  console.log('Adding followers and engagement_rate columns to public.connections table...');
  const url = `${supabaseUrl}/pg/query`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: sql
    })
  });

  console.log('Status:', response.status);
  const text = await response.text();
  console.log('Response:', text);
}

run().catch(console.error);
