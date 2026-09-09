#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// End-to-end smoke of the money path against a LIVE deployment, with a
// throwaway account that is created, driven through the real HTTP surface,
// and deleted at the end. Spend is one image post (≤ $0.09 of provider cost;
// $0 when the text-card renderer is available on the host).
//
//   node scripts/e2e-smoke.mjs [--base https://host] [--no-enforce-test] [--keep]
//
// What it proves, in order:
//   1. health + build version
//   2. signup trigger grants the welcome credit (platform_settings.signup_credits)
//   3. login through /api/auth/login sets a usable session
//   4. the portal renders the wallet pill as money; /billing renders the balance,
//      packs and the payments-closed state; checkout is refused while closed
//   5. persona creation; generate-post PREVIEW quotes retail credits that equal
//      Σ ceil(step × markup × 100) at the live markup
//   6. a real generation (deliver: review → stays a draft) records
//      generation_events with billed_user_id / key_source / credits and, in
//      shadow or enforce, debits the wallet once per event (idempotent)
//   7. non-admins get 403 on admin routes; a platform admin sees the markup
//   8. (optional) with credits_mode=enforce a thin wallet is refused with 402
//      + billingUrl before any row is created; the mode is restored after
//   9. cleanup leaves no rows behind
//
// Requires PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env (read-only
// checks go through /pg/query; the throwaway user goes through GoTrue admin).
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const env = { ...process.env };
const envPath = join(appRoot, '.env');
if (existsSync(envPath)) {
	for (const line of readFileSync(envPath, 'utf8').split('\n')) {
		const m = line.match(/^\s*([\w_]+)\s*=\s*(.*)\s*$/);
		if (!m) continue;
		let v = m[2].trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
		if (!(m[1] in process.env)) env[m[1]] = v;
	}
}
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = (opt('--base') || 'https://honeyx.monarchstack.com').replace(/\/$/, '');
const ENFORCE_TEST = !args.includes('--no-enforce-test');
const KEEP = args.includes('--keep');
const SB = env.PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB || !KEY) { console.error('PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1); }

const q = (s) => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
async function pg(query) {
	const r = await fetch(`${SB}/pg/query`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
	const t = await r.text();
	if (!r.ok) throw new Error(`pg/query ${r.status}: ${t.slice(0, 300)}`);
	try { return JSON.parse(t); } catch { return t; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── tiny cookie jar over fetch ───────────────────────────────────────────────
const jar = new Map();
function absorb(res) {
	const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
	for (const c of set) {
		const [pair] = c.split(';');
		const i = pair.indexOf('=');
		if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
	}
}
async function app(path, init = {}) {
	const headers = { 'Accept-Language': 'en-US,en;q=0.9', ...(init.headers || {}) };
	if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
	const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
	absorb(res);
	return res;
}
const postJson = (path, body) => app(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ── reporting ────────────────────────────────────────────────────────────────
const results = [];
function check(name, ok, detail = '') {
	results.push({ name, ok: !!ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
	return !!ok;
}
const ceilCredits = (usd, m) => Math.ceil(+(usd * m * 100).toFixed(6));

const stamp = Date.now();
const email = `e2e-${stamp}@personagen.test`;
const password = `E2e!${randomBytes(9).toString('base64url')}`;
let userId = null, agentId = null, postId = null, modeBefore = null, adminInserted = false;

async function main() {
	// 1. health
	const health = await (await fetch(`${BASE}/api/health`)).json();
	const version = await (await fetch(`${BASE}/_app/version.json`)).json();
	check('health ok', health.status === 'ok', `build ${version.version} · credits ${health.checks?.credits} · migrations ${health.checks?.migrations}`);

	const [{ markup, signup, mode }] = await pg(`select
		(select (value #>> '{}')::numeric from platform_settings where key='credit_markup') as markup,
		(select (value #>> '{}')::bigint from platform_settings where key='signup_credits') as signup,
		(select value #>> '{}' from platform_settings where key='credits_mode') as mode`);
	modeBefore = mode;
	console.log(`settings: credit_markup=${markup} signup_credits=${signup} credits_mode=${mode}`);

	// 2. throwaway user via GoTrue admin → welcome grant by trigger
	const cu = await fetch(`${SB}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: 'E2E Smoke' } }) });
	const cuBody = await cu.json();
	userId = cuBody.id;
	if (!check('throwaway user created', cu.ok && userId, email)) return;
	await sleep(500);
	const [w] = await pg(`select a.balance_credits, (select count(*)::int from credit_ledger l where l.user_id=a.user_id and l.kind='grant' and l.note like 'welcome%') as welcome_rows from credit_accounts a where a.user_id=${q(userId)}`) ?? [];
	check('welcome credit granted by signup trigger', w && Number(w.balance_credits) === Number(signup) && w.welcome_rows === 1, `balance=${w?.balance_credits} expected=${signup}`);

	// 3. login through the app
	const login = await postJson('/api/auth/login', { email, password });
	check('login via /api/auth/login', login.status === 200 && jar.size > 0, `HTTP ${login.status}, ${jar.size} cookie(s)`);
	check('request id header present', !!login.headers.get('x-request-id'));

	// 4. portal pill + billing page + closed checkout
	const dash = await app('/dashboard');
	const dashHtml = await dash.text();
	const expectMoney = `$${(Number(signup) / 100).toFixed(2)}`;
	check('portal renders the wallet pill as money', dash.status === 200 && dashHtml.includes('credit-pill') && dashHtml.includes(expectMoney), `HTTP ${dash.status}, contains ${expectMoney}: ${dashHtml.includes(expectMoney)}`);
	const bill = await app('/billing');
	const billHtml = await bill.text();
	const stripeOpen = !billHtml.includes('Coming soon');
	check('/billing renders balance, packs, payment state', bill.status === 200 && billHtml.includes(expectMoney) && billHtml.includes('Starter') && billHtml.includes('Brand'), `HTTP ${bill.status}, payments ${stripeOpen ? 'OPEN' : 'closed'}`);
	const co = await postJson('/api/billing/checkout', { packId: 'pack_10' });
	check(stripeOpen ? 'checkout returns a Stripe URL' : 'checkout refused while payments are closed (503)', stripeOpen ? co.status === 200 : co.status === 503, `HTTP ${co.status}`);
	const coBad = await postJson('/api/billing/checkout', { packId: 'nope' });
	check('checkout rejects an unknown pack', coBad.status === 400 || coBad.status === 503, `HTTP ${coBad.status}`);
	const wh = await postJson('/api/billing/webhook', {});
	check('unsigned webhook is refused', wh.status === 503 || wh.status === 400, `HTTP ${wh.status}`);

	// 5. persona + preview quote
	const ag = await postJson('/api/agents', { name: `E2E Smoke ${stamp}`, niche: 'testing', bio: 'Throwaway persona for the end-to-end smoke. Deleted at the end of the run.' });
	const agBody = await ag.json().catch(() => ({}));
	agentId = agBody.agent?.id ?? agBody.data?.id ?? agBody.id ?? null;
	if (!check('persona created', ag.ok && agentId, `HTTP ${ag.status}`)) return;
	const pv = await postJson(`/api/agent/${agentId}/generate-post`, { preview: true, media: 'image', still: 'graphic', refs: { character: false, product: false }, topic: 'e2e smoke' });
	const pvBody = await pv.json().catch(() => ({}));
	const steps = pvBody.preview?.steps ?? [];
	const expectedCredits = steps.reduce((s, x) => s + ceilCredits(Number(x.usd), Number(markup)), 0);
	check('preview quotes retail credits = Σ ceil(step × markup × 100)', pv.ok && steps.length > 0 && pvBody.preview.estimatedCredits === expectedCredits, `steps=${steps.map((s) => `${s.step}@$${s.usd}`).join(' + ')} → ${pvBody.preview?.estimatedCredits} credits (mode ${pvBody.preview?.creditsMode})`);

	// 5b. engine LLM action is metered: one llm event with retail credits and one debit
	const eng = await postJson('/api/engine?path=personagen-content-forge', { action: 'generate_profile', agent_id: agentId });
	const engBody = await eng.json().catch(() => ({}));
	await sleep(1500);
	const engEvents = await pg(`select provider, operation, est_cost, credits, key_source, (select count(*)::int from credit_ledger l where l.generation_event_id=e.id and l.kind='debit') as debits from generation_events e where e.user_id=${q(userId)} and e.agent_id is null and e.operation='llm' order by created_at desc limit 3`);
	const engOk = eng.ok && engEvents.length >= 1 && engEvents.every((e) => Number(e.credits) === ceilCredits(Number(e.est_cost), Number(markup)) && (mode === 'off' || e.debits === 1));
	check('engine LLM action is metered (event + debit)', engOk, `HTTP ${eng.status} ${engBody.error ?? ''} events=${engEvents.map((e) => `${e.provider}/${e.operation}→${e.credits}cr debits=${e.debits}`).join(' | ') || 'none'}`);

	// 6. real generation → draft; events attributed; wallet debited once per event
	const gen = await postJson(`/api/agent/${agentId}/generate-post`, { media: 'image', still: 'graphic', refs: { character: false, product: false }, topic: 'A short thank-you note to early testers', deliver: 'review' });
	const genBody = await gen.json().catch(() => ({}));
	postId = genBody.post_id ?? null;
	if (!check('generation accepted (202)', gen.status === 202 && postId, `HTTP ${gen.status} ${genBody.error ?? ''}`)) return;
	let post = null;
	for (let i = 0; i < 60; i++) {
		await sleep(5000);
		[post] = await pg(`select status, left(content::text, 200) as content from posts where id=${q(postId)}`) ?? [];
		if (post && post.status !== 'generating') break;
	}
	check('generation finished as a draft (deliver: review)', post && post.status === 'draft', `status=${post?.status}${post && post.status !== 'draft' ? ` content=${post.content}` : ''}`);
	const events = await pg(`select provider, operation, est_cost, credits, key_source, billed_user_id, (select count(*)::int from credit_ledger l where l.generation_event_id=e.id and l.kind='debit') as debits from generation_events e where e.post_id=${q(postId)} order by created_at`);
	const attributed = events.length > 0 && events.every((e) => e.billed_user_id === userId && e.key_source);
	const priced = events.every((e) => Number(e.credits) === ceilCredits(Number(e.est_cost), Number(markup)));
	check('events attributed to the billing account with retail credits', attributed && priced, events.map((e) => `${e.provider}/${e.operation} $${e.est_cost}→${e.credits}cr ${e.key_source} debits=${e.debits}`).join(' | '));
	const platformPaid = events.filter((e) => e.key_source === 'platform' && Number(e.credits) > 0);
	const debitedOnce = platformPaid.every((e) => e.debits === 1);
	const expectedDebit = platformPaid.reduce((s, e) => s + Number(e.credits), 0);
	const [wal] = await pg(`select balance_credits, (select coalesce(-sum(delta),0)::bigint from credit_ledger l where l.user_id=${q(userId)} and l.kind='debit') as debited from credit_accounts where user_id=${q(userId)}`);
	const shadowOrEnforce = mode === 'shadow' || mode === 'enforce';
	// The wallet must equal welcome − every debit written (post + engine steps), and
	// every platform-paid post event must carry exactly one debit.
	const ledgerConsistent = Number(wal.balance_credits) === Number(signup) - Number(wal.debited) && Number(wal.debited) >= expectedDebit;
	check(shadowOrEnforce ? 'wallet debited exactly once per platform-paid event' : 'credits off: no debit written', shadowOrEnforce ? debitedOnce && ledgerConsistent : Number(wal.balance_credits) === Number(signup), `balance ${wal.balance_credits} = ${signup} − ${wal.debited} (post events ${expectedDebit})`);
	const activity = await pg(`select count(*)::int as n, count(distinct action)::int as actions from user_activity_events where user_id=${q(userId)}`);
	check('activity log captured the session pseudonymously', activity[0].n > 0, `${activity[0].n} rows · ${activity[0].actions} distinct actions`);

	// 7. admin gating
	const adminNo = await app('/api/admin/settings');
	check('non-admin gets 403 on admin settings', adminNo.status === 403, `HTTP ${adminNo.status}`);
	await pg(`insert into platform_admins (user_id) values (${q(userId)}) on conflict do nothing`);
	adminInserted = true;
	const adminYes = await app('/api/admin/settings');
	const adminBody = await adminYes.json().catch(() => ({}));
	check('platform admin sees the controls incl. markup', adminYes.status === 200 && Number(adminBody.switches?.credit_markup?.effective) === Number(markup), `HTTP ${adminYes.status} markup=${adminBody.switches?.credit_markup?.effective} (${adminBody.switches?.credit_markup?.source}) migrations pending=${adminBody.migrations?.pending?.length}`);
	// Every switch an operator is told about must be READABLE and WRITABLE, not
	// merely present in the code. A key can be valid and still fall through the
	// write path to "Unsupported key" (that happened to the two persona switches
	// on 2026-09-08), so this exercises the operator's path: the GET reports it,
	// and the POST reaches validation rather than refusing the key. The invalid
	// value is deliberate — it is rejected before anything is written, so this
	// proves the path is live without changing a production setting.
	const switches = adminBody.switches ?? {};
	const readable = ['credits_mode', 'credit_markup', 'signup_credits', 'plans_enabled', 'persona_generator', 'persona_backbone', 'daily_platform_spend_usd', 'video_ingest'].filter((k) => switches[k] === undefined);
	check('every operator switch is reported by the console API', readable.length === 0, readable.length ? `missing: ${readable.join(', ')}` : `${Object.keys(switches).length} switches reported`);
	const writeProbe = await postJson('/api/admin/settings', { key: 'persona_backbone', value: '__invalid__', note: 'e2e: write path reachable (rejected by design)' });
	const writeBody = await writeProbe.json().catch(() => ({}));
	check('a switch write reaches validation instead of "Unsupported key"', writeProbe.status === 400 && /off \| shadow \| fill \| on/.test(String(writeBody.error ?? '')), `HTTP ${writeProbe.status} ${writeBody.error ?? ''}`);

	const adminUsers = await app('/api/admin/credits');
	const auBody = await adminUsers.json().catch(() => ({}));
	const me = (auBody.users ?? []).find((u) => u.id === userId || u.email === email);
	check('admin user list shows the throwaway wallet', adminUsers.status === 200 && me && Number(me.balance ?? me.balance_credits) === Number(wal.balance_credits), `balance=${me?.balance ?? me?.balance_credits}`);
	await pg(`delete from platform_admins where user_id=${q(userId)}`);
	adminInserted = false;

	// 8. enforce: a thin wallet is refused before any row is created
	if (ENFORCE_TEST) {
		const postsBefore = (await pg(`select count(*)::int as n from posts where agent_id=${q(agentId)}`))[0].n;
		await pg(`select credit_apply(${q(userId)}, 5, 'set', 'e2e: thin wallet for the enforce test', NULL)`);
		if (mode !== 'enforce') {
			await pg(`select platform_setting_set('credits_mode', '"enforce"'::jsonb, NULL, 'e2e smoke: temporary enforce for the 402 check')`);
			await sleep(17_000); // settings cache refresh interval + margin
		}
		const thin = await postJson(`/api/agent/${agentId}/generate-post`, { media: 'image', still: 'graphic', refs: { character: false, product: false }, topic: 'should be refused', deliver: 'review' });
		const thinBody = await thin.json().catch(() => ({}));
		const postsAfter = (await pg(`select count(*)::int as n from posts where agent_id=${q(agentId)}`))[0].n;
		check('enforce: thin wallet refused with 402 + billing link, no row created', thin.status === 402 && thinBody.code === 'INSUFFICIENT_CREDITS' && thinBody.billingUrl === '/billing' && postsAfter === postsBefore, `HTTP ${thin.status} ${thinBody.code ?? thinBody.error ?? ''}`);
		if (mode !== 'enforce') {
			await pg(`select platform_setting_set('credits_mode', ${q(JSON.stringify(mode))}::jsonb, NULL, 'e2e smoke: restore')`);
			await sleep(17_000);
			const [{ m }] = await pg(`select value #>> '{}' as m from platform_settings where key='credits_mode'`);
			check('credits_mode restored', m === mode, m);
		}
	}
}

async function cleanup() {
	if (KEEP) { console.log(`--keep: leaving ${email} (${userId}) in place`); return; }
	try {
		if (adminInserted) await pg(`delete from platform_admins where user_id=${q(userId)}`);
		if (modeBefore) {
			const [{ m }] = await pg(`select value #>> '{}' as m from platform_settings where key='credits_mode'`);
			if (m !== modeBefore) await pg(`select platform_setting_set('credits_mode', ${q(JSON.stringify(modeBefore))}::jsonb, NULL, 'e2e smoke: restore (cleanup)')`);
		}
		if (agentId) {
			await pg(`delete from posts where agent_id=${q(agentId)}`);
			await pg(`delete from agent_configs where agent_id=${q(agentId)}`);
			await pg(`delete from agents where id=${q(agentId)}`);
		}
		if (userId) {
			const del = await fetch(`${SB}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
			const left = await pg(`select (select count(*)::int from auth.users where id=${q(userId)}) as users, (select count(*)::int from credit_accounts where user_id=${q(userId)}) as wallets, (select count(*)::int from agents where user_id=${q(userId)}) as agents, (select count(*)::int from posts where user_id=${q(userId)}) as posts`);
			check('cleanup: throwaway user and rows removed', del.ok && Object.values(left[0]).every((n) => n === 0), JSON.stringify(left[0]));
		}
	} catch (e) {
		check('cleanup', false, e.message);
	}
}

try {
	await main();
} catch (e) {
	check('run', false, e.message);
} finally {
	await cleanup();
	const failed = results.filter((r) => !r.ok);
	console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${BASE}`);
	process.exit(failed.length ? 1 : 0);
}
