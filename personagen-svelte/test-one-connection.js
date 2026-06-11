import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.COMPOSIO_API_KEY;
if (!apiKey) throw new Error('COMPOSIO_API_KEY is required.');
const baseUrl = 'https://backend.composio.dev/api/v3';

async function run() {
  const connectionId = 'ca_7crHRyQlosJS'; // youtube connection
  console.log('Querying Composio single connection info for:', connectionId);
  const response = await fetch(`${baseUrl}/connected_accounts/${connectionId}`, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    }
  });
  console.log('Status:', response.status);
  const data = await response.json();
  console.log('Response:', JSON.stringify(data, null, 2));
}

run().catch(console.error);
