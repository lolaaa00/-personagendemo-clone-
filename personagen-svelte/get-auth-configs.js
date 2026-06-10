const apiKey = 'ak_cHHRKbh3CqAOmdIfXpJv';
const baseUrl = 'https://backend.composio.dev/api/v3.1';

async function run() {
	try {
		console.log('Fetching active Auth Configs from Composio...');
		const response = await fetch(`${baseUrl}/auth_configs`, {
			method: 'GET',
			headers: {
				'x-api-key': apiKey,
				'Content-Type': 'application/json'
			}
		});

		console.log('Status:', response.status);
		const data = await response.json();
		console.log('Response:', JSON.stringify(data, null, 2));
	} catch (err) {
		console.error('Error:', err);
	}
}

run();
