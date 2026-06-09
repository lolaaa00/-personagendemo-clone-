

async function test() {
  const urls = [
    'https://honeyx.monarchstack.com/login',
    'https://l2g-supabase.zi1cc5.easypanel.host/auth/v1/health'
  ];

  for (const url of urls) {
    console.log(`Checking ${url}...`);
    try {
      const start = Date.now();
      const res = await fetch(url, { timeout: 10000 });
      console.log(`[${url}] Status: ${res.status} ${res.statusText} (${Date.now() - start}ms)`);
    } catch (err) {
      console.log(`[${url}] Error: ${err.message}`);
    }
  }
}

test();
