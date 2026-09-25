// Configure GoTrue SMTP on the production Supabase compose service and (optionally) deploy the app —
// through EasyPanel's official MCP endpoint (Streamable HTTP, Bearer = a panel user API key).
//
//   PANEL_URL=https://zi1cc5.easypanel.host PANEL_KEY=<panel api key> \
//   SMTP_PASS=<resend key> node scripts/ops/panel-gotrue-smtp.mjs [--project l2g] [--sender noreply@monarchstack.com] [--deploy-app personagen-app] [--dry-run]
//
// What it does, in order:
//   1. search_procedures → confirms the env-update / deploy procedure names on THIS panel version.
//   2. inspectProject → finds the compose service whose env carries GOTRUE_ (the Supabase stack).
//   3. Merges GOTRUE_SMTP_* into that env (replacing any existing lines, keeping every other line).
//   4. execute_destructive updateComposeEnv → execute_destructive deployComposeService.
//   5. With --deploy-app: execute_destructive deployAppService for the app, then polls
//      https://honeyx.monarchstack.com/_app/version.json until the build fingerprint changes.
// Secrets are read from env only; nothing is written to disk or printed in full.
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry-run');
const PANEL_URL = (process.env.PANEL_URL || 'https://zi1cc5.easypanel.host').replace(/\/+$/, '');
const PANEL_KEY = process.env.PANEL_KEY || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const PROJECT = flag('--project', 'l2g');
const SENDER = flag('--sender', 'noreply@monarchstack.com');
const DEPLOY_APP = flag('--deploy-app', '');
const SMTP = {
	GOTRUE_SMTP_HOST: process.env.SMTP_HOST || 'smtp.resend.com',
	GOTRUE_SMTP_PORT: process.env.SMTP_PORT || '465',
	GOTRUE_SMTP_USER: process.env.SMTP_USER || 'resend',
	GOTRUE_SMTP_PASS: SMTP_PASS,
	GOTRUE_SMTP_ADMIN_EMAIL: SENDER,
	GOTRUE_SMTP_SENDER_NAME: process.env.SMTP_SENDER_NAME || 'PersonaGen'
};
if (!PANEL_KEY || !SMTP_PASS) {
	console.error('PANEL_KEY and SMTP_PASS are required (env). See the header for usage.');
	process.exit(2);
}

let rpcId = 0;
async function mcp(method, params) {
	const res = await fetch(`${PANEL_URL}/api/mcp`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${PANEL_KEY}` },
		body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`${method} → HTTP ${res.status}: ${text.slice(0, 300)}`);
	// Streamable HTTP may answer as JSON or as an SSE stream of JSON-RPC messages.
	const frames = text.startsWith('event:') || text.includes('\ndata:') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()) : [text];
	for (const f of frames) {
		try { const j = JSON.parse(f); if (j.id === rpcId) { if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 300)}`); return j.result; } } catch (e) { if (String(e.message).startsWith(method)) throw e; }
	}
	throw new Error(`${method}: no JSON-RPC result in response (${text.slice(0, 200)})`);
}
const tool = async (name, args2) => {
	const r = await mcp('tools/call', { name, arguments: args2 });
	const t = (r?.content || []).map((c) => c.text || '').join('\n');
	if (r?.isError) throw new Error(`${name} failed: ${t.slice(0, 400)}`);
	try { return JSON.parse(t); } catch { return t; }
};

await mcp('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'personagen-ops', version: '1' } });
const tools = await mcp('tools/list', {});
const names = (tools?.tools || []).map((t) => t.name);
console.log('panel MCP tools:', names.join(', '));

// 1. procedure names on this panel version
const found = await tool('search_procedures', { query: 'compose env deploy' });
const procText = typeof found === 'string' ? found : JSON.stringify(found);
const pick = (re, fallback) => (procText.match(re) || [])[0] || fallback;
const P_UPDATE_ENV = pick(/services\.compose\.updateEnv|updateComposeEnv/, 'updateComposeEnv');
const P_DEPLOY_COMPOSE = pick(/services\.compose\.deployService|deployComposeService/, 'deployComposeService');
const P_DEPLOY_APP = pick(/services\.app\.deployService|deployAppService/, 'deployAppService');
const P_INSPECT = pick(/projects\.inspectProject|inspectProject/, 'inspectProject');
console.log('procedures:', { P_INSPECT, P_UPDATE_ENV, P_DEPLOY_COMPOSE, P_DEPLOY_APP });

// 2. find the Supabase compose service by its env
const project = await tool('execute_query', { procedure: P_INSPECT, input: { projectName: PROJECT } });
const services = project?.services || project?.result?.services || [];
const supa = services.find((s) => /GOTRUE_/.test(s.env || '') || /supabase/i.test(s.name || ''));
if (!supa) { console.error('No Supabase-looking service in project', PROJECT, '— services:', services.map((s) => s.name)); process.exit(1); }
console.log(`Supabase service: ${supa.name} (${supa.type || 'compose'}), env lines: ${(supa.env || '').split('\n').filter(Boolean).length}`);

// 3. merge
const lines = (supa.env || '').split('\n');
const keep = lines.filter((l) => !/^GOTRUE_SMTP_(HOST|PORT|USER|PASS|ADMIN_EMAIL|SENDER_NAME)=/.test(l));
const merged = [...keep.filter((l, i, a) => !(l === '' && i === a.length - 1)), ...Object.entries(SMTP).map(([k, v]) => `${k}=${v}`)].join('\n') + '\n';
const before = lines.filter((l) => /^GOTRUE_SMTP_/.test(l)).map((l) => l.replace(/=(.+)$/, (m, v) => '=' + (/PASS/.test(l) ? '***' : v)));
console.log('existing GOTRUE_SMTP_* lines:', before.length ? before : '(none)');
console.log('will set:', Object.entries(SMTP).map(([k, v]) => `${k}=${k.endsWith('PASS') ? '***' : v}`).join('  '));
if (DRY) { console.log('dry run — nothing written'); process.exit(0); }

// 4. write + redeploy
await tool('execute_destructive', { procedure: P_UPDATE_ENV, input: { projectName: PROJECT, serviceName: supa.name, env: merged } });
console.log('env updated');
await tool('execute_destructive', { procedure: P_DEPLOY_COMPOSE, input: { projectName: PROJECT, serviceName: supa.name } });
console.log(`redeploy of ${supa.name} requested — GoTrue restarts with SMTP in ~1–2 min`);

// 5. app deploy + fingerprint
if (DEPLOY_APP) {
	const fp = 'https://honeyx.monarchstack.com/_app/version.json';
	const read = async () => { try { return (await (await fetch(fp, { cache: 'no-store' })).json()).version; } catch { return null; } };
	const v0 = await read();
	await tool('execute_destructive', { procedure: P_DEPLOY_APP, input: { projectName: PROJECT, serviceName: DEPLOY_APP } });
	console.log(`deploy of ${DEPLOY_APP} requested (fingerprint before: ${v0}); polling up to 12 min…`);
	for (let i = 0; i < 72; i++) {
		await new Promise((r) => setTimeout(r, 10000));
		const v = await read();
		if (v && v !== v0) { console.log(`LIVE: version.json ${v0} → ${v} after ${(i + 1) * 10}s`); process.exit(0); }
	}
	console.error('version.json did not change within 12 min — check the panel build log (actions.listActions).');
	process.exit(1);
}
