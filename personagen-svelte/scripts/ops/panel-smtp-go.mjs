// One-shot: set the Supabase service SMTP env (SMTP_* + GOTRUE_SMTP_*), redeploy it, deploy personagen-app.
// Run from personagen-svelte:  PANEL_KEY=<panel api key> SMTP_PASS=<resend key> node scripts/ops/panel-smtp-go.mjs   (DRY=1 to preview)
// Reads the project through EasyPanel's official MCP (structuredContent, since text is truncated at 20k).
const KEY = process.env.PANEL_KEY, SMTP_PASS = process.env.SMTP_PASS, URL = 'https://zi1cc5.easypanel.host/api/mcp'; let id = 0;
async function call(name, args) { const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) }); const j = JSON.parse(await r.text()); if (j.error) throw new Error(JSON.stringify(j.error)); const text = (j.result?.content || []).map((c) => c.text || '').join(''); if (j.result?.isError) throw new Error(`${name}: ${text.slice(0, 300)}`); if (j.result?.structuredContent) return j.result.structuredContent; try { return JSON.parse(text); } catch { return text; } }
await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'go', version: '1' } } }) });
const proj = await call('execute_query', { procedure: 'inspectProject', input: { projectName: 'l2g' } });
const services = proj.result?.services || proj.services || [];
console.log('services:', services.map((s) => `${s.name}:${s.type}`).join(' '));
const supa = services.find((s) => /GOTRUE_/.test(s.env || '')) || services.find((s) => /supabase/i.test(s.name));
if (!supa) { console.error('no supabase service found'); process.exit(1); }
const env = supa.env || '';
const cur = env.split('\n').filter((l) => /^(GOTRUE_)?SMTP_/.test(l)).map((l) => /PASS/.test(l) ? l.replace(/=.*/, '=***') : l);
console.log(`service ${supa.name} (${supa.type}) env lines ${env.split('\n').length}; current SMTP lines:`, cur);
const vals = { SMTP_HOST: 'smtp.resend.com', SMTP_PORT: '465', SMTP_USER: 'resend', SMTP_PASS, SMTP_ADMIN_EMAIL: 'noreply@l2gseo.com', SMTP_SENDER_NAME: 'PersonaGen' };
const all = { ...vals, ...Object.fromEntries(Object.entries(vals).map(([k, v]) => ['GOTRUE_' + k, v])) };
const keep = env.split('\n').filter((l) => !/^(GOTRUE_)?SMTP_(HOST|PORT|USER|PASS|ADMIN_EMAIL|SENDER_NAME)=/.test(l));
while (keep.length && keep[keep.length - 1].trim() === '') keep.pop();
const merged = [...keep, ...Object.entries(all).map(([k, v]) => `${k}=${v}`)].join('\n') + '\n';
if (process.env.DRY) { console.log('DRY — would write', Object.keys(all).join(',')); process.exit(0); }
await call('execute_destructive', { procedure: 'updateComposeEnv', input: { projectName: 'l2g', serviceName: supa.name, env: merged } });
console.log('env updated');
await call('execute_destructive', { procedure: 'deployComposeService', input: { projectName: 'l2g', serviceName: supa.name } });
console.log('supabase redeploy requested');
const fp = async () => { try { return (await (await fetch('https://honeyx.monarchstack.com/_app/version.json', { cache: 'no-store' })).json()).version; } catch { return null; } };
const v0 = await fp();
await call('execute_destructive', { procedure: 'deployAppService', input: { projectName: 'l2g', serviceName: 'personagen-app' } });
console.log('personagen-app deploy requested; fingerprint before', v0);
