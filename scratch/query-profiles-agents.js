const url = "https://l2g-supabase.zi1cc5.easypanel.host";
const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.1-Z3xbVwy4ynR9JbanSbQYC7XcXPzWDdRFn9EVk19Qk";

async function query(table, select = "*") {
  const queryUrl = `${url}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  const res = await fetch(queryUrl, {
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json"
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to query ${table}: ${res.statusText} (${res.status})`);
  }
  return res.json();
}

async function run() {
  console.log("=== PROFILES ===");
  try {
    const profiles = await query("profiles", "id,full_name,company,avatar_url");
    console.log(JSON.stringify(profiles, null, 2));
  } catch (e) {
    console.error(e.message);
  }

  console.log("\n=== AGENTS ===");
  try {
    const agents = await query("agents", "id,name,handle,niche,status,is_overseer,runtime_owner");
    console.log(JSON.stringify(agents, null, 2));
  } catch (e) {
    console.error(e.message);
  }
}

run();
