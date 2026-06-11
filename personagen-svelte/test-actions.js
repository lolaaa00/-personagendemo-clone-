import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.COMPOSIO_API_KEY;
if (!apiKey) throw new Error('COMPOSIO_API_KEY is required.');
const baseUrl = 'https://backend.composio.dev/api/v3';

async function run() {
  console.log('Querying Composio actions for YouTube and Instagram...');
  const response = await fetch(`${baseUrl}/actions?apps=youtube,instagram`, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    }
  });
  console.log('Status:', response.status);
  const data = await response.json();
  const actions = data.items || [];
  console.log(`Found ${actions.length} actions:`);
  for (const act of actions) {
    if (act.name.includes('GET') || act.name.includes('PROFILE') || act.name.includes('ACCOUNT') || act.name.includes('USER') || act.name.includes('METRIC') || act.name.includes('INFO')) {
      console.log(`- Action Name: ${act.name}, App: ${act.appName}, Description: ${act.description}`);
    }
  }
}

run().catch(console.error);
