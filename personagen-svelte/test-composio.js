const apiKey = 'ak_E3uMv-JxpPJxpmyutBwR';
const baseUrl = 'https://backend.composio.dev/api/v3';

async function test() {
	try {
		console.log('Testing Composio Link API with new key and global fetch...');
		const response = await fetch(`${baseUrl}/connected_accounts/link`, {
			method: 'POST',
			headers: {
				'x-api-key': apiKey,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				user_id: 'test-agent-id',
				app_id: 'tiktok',
				callback_url: 'https://honeyx.monarchstack.com/persona-config'
			})
		});

		console.log('Status:', response.status);
		const text = await response.text();
		console.log('Response:', text);
	} catch (err) {
		console.error('Error:', err);
	}
}

test();
