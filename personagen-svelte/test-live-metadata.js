import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.COMPOSIO_API_KEY || 'ak_cHHRKbh3CqAOmdIfXpJv';
const baseUrl = 'https://backend.composio.dev/api/v3';

async function fetchUnredactedConnection(connectionId) {
  const response = await fetch(`${baseUrl}/connected_accounts/${connectionId}`, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    }
  });
  return await response.json();
}

async function testYouTube() {
  console.log('\n--- Testing Live YouTube API ---');
  const conn = await fetchUnredactedConnection('ca_7crHRyQlosJS');
  const accessToken = conn.params?.access_token || conn.data?.access_token;
  if (!accessToken) {
    console.error('No YouTube access token found.');
    return;
  }
  
  // Query channel snippet and statistics (subscribers)
  const ytUrl = 'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true';
  const response = await fetch(ytUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });
  
  console.log('YouTube API Status:', response.status);
  const data = await response.json();
  console.log('YouTube API Response:', JSON.stringify(data, null, 2));
}

async function testInstagram() {
  console.log('\n--- Testing Live Instagram API ---');
  const conn = await fetchUnredactedConnection('ca_yc2exahb_eJW');
  const accessToken = conn.params?.access_token || conn.data?.access_token;
  if (!accessToken) {
    console.error('No Instagram access token found.');
    return;
  }
  
  const igUrl = `https://graph.instagram.com/me?fields=id,username,account_type&access_token=${accessToken}`;
  const response = await fetch(igUrl, {
    method: 'GET'
  });
  
  console.log('Instagram API Status:', response.status);
  const data = await response.json();
  console.log('Instagram API Response:', JSON.stringify(data, null, 2));
}

async function run() {
  await testYouTube();
  await testInstagram();
}

run().catch(console.error);
