const url = "https://l2g-supabase.zi1cc5.easypanel.host";
const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.1-Z3xbVwy4ynR9JbanSbQYC7XcXPzWDdRFn9EVk19Qk";

async function query(table) {
  const queryUrl = `${url}/rest/v1/${table}?select=*`;
  const res = await fetch(queryUrl, {
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json"
    }
  });
  if (!res.ok) return null;
  return res.json();
}

async function run() {
  const tables = [
    "profiles",
    "agents",
    "agent_configs",
    "posts",
    "connections",
    "blueprints",
    "brand_briefs",
    "tickets",
    "subscriptions",
    "chat_messages",
    "agent_memories"
  ];
  
  for (const t of tables) {
    try {
      const data = await query(t);
      console.log(`Table: ${t} - Rows: ${data ? data.length : "error"}`);
      if (data && data.length > 0) {
        console.log(JSON.stringify(data.slice(0, 2), null, 2));
      }
    } catch (e) {
      console.log(`Table: ${t} - Error: ${e.message}`);
    }
  }
}

run();
