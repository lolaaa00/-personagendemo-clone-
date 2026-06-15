import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.COMPOSIO_API_KEY;
if (!apiKey) throw new Error('COMPOSIO_API_KEY is required.');
const baseUrl = 'https://backend.composio.dev/api/v3';

async function run() {
	console.log('Querying ALL Composio active connections...');
	const response = await fetch(`${baseUrl}/connected_accounts`, {
		method: 'GET',
		headers: {
			'x-api-key': apiKey,
			'Content-Type': 'application/json'
		}
	});
	console.log('Status:', response.status);
	const data = await response.json();
	const activeConns = (data.items || []).filter((c) => c.status === 'ACTIVE');
	console.log(
		`Found ${activeConns.length} ACTIVE connections out of ${data.items?.length || 0} total:`
	);
	for (const c of activeConns) {
		console.log(
			`- Connection ID: ${c.id}, Status: ${c.status}, Platform/Slug: ${c.toolkit?.slug}, User/Agent ID in Composio: ${c.user_id}, Handle/WordID: ${c.word_id}`
		);
		console.log(
			'  Connection Metadata/Params:',
			JSON.stringify(c.connectionParams || c.metadata || c.data || {}, null, 2)
		);
	}
}

run().catch(console.error);
