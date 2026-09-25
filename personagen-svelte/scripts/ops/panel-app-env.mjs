// Puts RESEND_API_KEY + MAIL_FROM onto the personagen-app service (keeping every other line) and deploys it.
// Run from personagen-svelte (values come from .env: PANEL_KEY, RESEND_API_KEY, MAIL_FROM):
//   node --env-file=.env --import ./scripts/ux/dns-fix.mjs scripts/ops/panel-app-env.mjs   (DRY=1 to preview)
// Talks to EasyPanel's official MCP endpoint; reads results from structuredContent (text is truncated at 20k).
const KEY = process.env.PANEL_KEY, URL = (process.env.PANEL_URL || 'https://zi1cc5.easypanel.host') + '/api/mcp'; let id = 0;
async function call(name, args) {
	const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) });
	const j = JSON.parse(await r.text());
	if (j.error) throw new Error(JSON.stringify(j.error));
	if (j.result?.structuredContent) return j.result.structuredContent;
	const text = (j.result?.content || []).map((c) => c.text || '').join('');
	if (j.result?.isError) throw new Error(text.slice(0, 300));
	try { return JSON.parse(text); } catch { return text; }
}
if (!KEY || !process.env.RESEND_API_KEY) { console.error('PANEL_KEY and RESEND_API_KEY are required (put them in .env).'); process.exit(2); }
const proj = await call('execute_query', { procedure: 'inspectProject', input: { projectName: 'l2g' } });
const app = proj.result.services.find((s) => s.name === 'personagen-app');
let env = app.env || '';
const set = { RESEND_API_KEY: process.env.RESEND_API_KEY, MAIL_FROM: process.env.MAIL_FROM || 'PersonaGen <noreply@l2gseo.com>' };
for (const [k, v] of Object.entries(set)) { const re = new RegExp(`^${k}=.*$`, 'm'); env = re.test(env) ? env.replace(re, `${k}=${v}`) : env.replace(/\n*$/, `\n${k}=${v}\n`); }
console.log('app env lines:', env.split('\n').filter(Boolean).length, '| RESEND_API_KEY set:', /^RESEND_API_KEY=re_/m.test(env), '|', (env.match(/^MAIL_FROM=.*$/m) || [''])[0]);
if (process.env.DRY) process.exit(0);
await call('execute_destructive', { procedure: 'updateAppEnv', input: { projectName: 'l2g', serviceName: 'personagen-app', env } });
console.log('app env updated');
const fp = async () => { try { return (await (await fetch('https://honeyx.monarchstack.com/_app/version.json', { cache: 'no-store' })).json()).version; } catch { return null; } };
const v0 = await fp();
await call('execute_destructive', { procedure: 'deployAppService', input: { projectName: 'l2g', serviceName: 'personagen-app' } });
console.log('app deploy requested; fingerprint before', v0, '— polling up to 10 min');
for (let k = 0; k < 60; k++) { await new Promise((r) => setTimeout(r, 10000)); const v = await fp(); if (v && v !== v0) { console.log(`LIVE: ${v0} → ${v} after ${(k + 1) * 10}s`); process.exit(0); } }
console.log('fingerprint unchanged after 10 min — check the panel build log');
process.exit(1);
