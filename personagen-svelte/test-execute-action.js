import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.COMPOSIO_API_KEY;
if (!apiKey) throw new Error('COMPOSIO_API_KEY is required.');
const baseUrlV3_1 = 'https://backend.composio.dev/api/v3.1';

async function executeAction(actionSlug, userId, args = {}) {
	const url = `${baseUrlV3_1}/tools/execute/${actionSlug}`;
	console.log(`Executing ${actionSlug} for user ${userId}...`);
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'x-api-key': apiKey,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			user_id: userId,
			arguments: args
		})
	});
	console.log('Status:', response.status);
	const data = await response.json();
	console.log('Response:', JSON.stringify(data, null, 2));
	return data;
}

async function run() {
	const userId = '08229e1e-9a30-4f2f-89d4-0cf47eb72ade'; // Maybe agent's id in Composio

	// Test YouTube Get Channel Statistics
	try {
		await executeAction('YOUTUBE_GET_CHANNEL_STATISTICS', userId, {
			mine: true,
			part: 'snippet,statistics'
		});
	} catch (err) {
		console.error('YouTube error:', err);
	}

	// Test Instagram Get User Info
	try {
		await executeAction('INSTAGRAM_GET_USER_INFO', userId, {});
	} catch (err) {
		console.error('Instagram error:', err);
	}
}

run().catch(console.error);
