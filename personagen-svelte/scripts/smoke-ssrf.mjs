#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Production probe: proves the SSRF guard on the engine's vision action
// (`read_appearance_from_image`) is LIVE on a deployed host, not just in unit
// tests. It creates a throwaway account through GoTrue admin, logs in through
// the real HTTP surface, posts internal/private image URLs to
// /api/engine?path=personagen-brand-brief, and expects a clean 400
// "Image URL rejected: …" before any provider or server-side fetch sees them.
//
// Why it exists: the guard sat uncalled for months while the vision action
// fetched whatever URL the client sent (orphan audit finding #1,
// docs/audit/orphan-problems-2026-09-05.md). A guard nobody exercises in
// production is indistinguishable from no guard.
//
// Spend: $0. The rejection path returns before a provider is called, and the
// URL guard runs BEFORE the handler's "No AI provider configured" gate, so the
// five hostile URLs must be rejected even on a host with no AI key at all. The
// public-URL check tolerates a missing provider (any non-rejection passes) and
// names that case in its detail line so the reader sees which path ran.
//
//   node scripts/smoke-ssrf.mjs [--base https://host] [--keep]
//
// Safe to run repeatedly: the account is deleted in `finally` and verified gone.
// Requires PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.
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
const KEEP = args.includes('--keep');
const SB = env.PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB || !KEY) { console.error('PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1); }

const ENGINE = '/api/engine?path=personagen-brand-brief';
const PUBLIC_IMAGE = 'https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png';
const REJECT_PREFIX = 'Image URL rejected:';
const NO_PROVIDER = 'No AI provider configured';

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
const admin = (path, init = {}) => fetch(`${SB}/auth/v1/admin/users${path}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });

// ── reporting ────────────────────────────────────────────────────────────────
const results = [];
function check(name, ok, detail = '') {
	results.push({ name, ok: !!ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
	return !!ok;
}
const clip = (s) => String(s ?? '').replace(/\s+/g, ' ').slice(0, 120);

// ── the probe itself ─────────────────────────────────────────────────────────
async function vision(imageUrl) {
	const res = await postJson(ENGINE, { action: 'read_appearance_from_image', ts: Date.now(), imageUrl });
	const body = await res.json().catch(() => ({}));
	return { status: res.status, error: typeof body.error === 'string' ? body.error : '', data: body.data };
}
const isRejected = (r) => r.status === 400 && r.error.startsWith(REJECT_PREFIX);
function detailFor(r) {
	const hint = r.status === 400 && r.error.startsWith(NO_PROVIDER) ? ' [host has no AI provider configured — the guard already ran and passed this URL; the provider gate answered]' : '';
	return `HTTP ${r.status} ${clip(r.error || JSON.stringify(r.data))}${hint}`;
}

const stamp = Date.now();
const email = `ssrf-${stamp}@personagen.test`;
const password = `Ssrf!${randomBytes(9).toString('base64url')}`;
let userId = null;

const HOSTILE = [
	['cloud metadata endpoint (169.254.169.254) rejected', 'http://169.254.169.254/latest/meta-data/', 'private/internal'],
	['localhost rejected', 'http://localhost/x.png', 'disallowed host'],
	['RFC1918 address (10.0.0.5, PostgREST port) rejected', 'http://10.0.0.5:8000/rest/v1/', 'private/internal'],
	['IPv6 loopback ([::1], Postgres port) rejected', 'http://[::1]:5432/', 'private/internal'],
	['non-http scheme (ftp://) rejected', 'ftp://example.com/x.png', 'Only http/https']
];

async function main() {
	// 1. health
	const hr = await fetch(`${BASE}/api/health`);
	const health = await hr.json().catch(() => ({}));
	const version = await fetch(`${BASE}/_app/version.json`).then((r) => r.json()).catch(() => ({}));
	const build = health.version ?? health.build ?? version.version ?? 'n/a';
	check('health ok', hr.status === 200, `HTTP ${hr.status} · status ${health.status ?? '?'} · build ${build}`);

	// 2. throwaway user + login → usable session
	const cu = await admin('', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: 'SSRF Smoke' } }) });
	const cuBody = await cu.json().catch(() => ({}));
	userId = cuBody.id ?? null;
	if (!check('throwaway user created', (cu.status === 200 || cu.status === 201) && userId, `HTTP ${cu.status} ${email}`)) return;
	const login = await postJson('/api/auth/login', { email, password });
	check('login via /api/auth/login', login.status === 200 && jar.size > 0, `HTTP ${login.status}, ${jar.size} cookie(s)`);
	const dash = await app('/dashboard');
	const loc = dash.headers.get('location') || '';
	check('session usable (portal does not bounce to /login)', dash.status === 200 && !loc.includes('/login'), `HTTP ${dash.status}${loc ? ` → ${loc}` : ''}`);

	// 3–7. hostile targets → clean 400 from the guard
	for (const [name, url, needle] of HOSTILE) {
		const r = await vision(url);
		check(name, isRejected(r) && r.error.includes(needle), detailFor(r));
	}

	// 8. a public image must NOT be rejected by the guard (whatever the provider path does next)
	const pub = await vision(PUBLIC_IMAGE);
	check('public image passes the guard', !isRejected(pub), detailFor(pub));

	// 9. the probe itself needs auth: no cookie → 401/403/redirect, never 200
	const anon = await fetch(`${BASE}${ENGINE}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read_appearance_from_image', ts: Date.now(), imageUrl: HOSTILE[0][1] }), redirect: 'manual' });
	const anonOk = anon.status === 401 || anon.status === 403 || (anon.status >= 300 && anon.status < 400);
	check('unauthenticated request is refused', anonOk && anon.status !== 200, `HTTP ${anon.status}${anon.headers.get('location') ? ` → ${anon.headers.get('location')}` : ''}`);
}

async function cleanup() {
	if (KEEP) { console.log(`--keep: leaving ${email} (${userId}) in place`); return; }
	if (!userId) return;
	try {
		const del = await admin(`/${userId}`, { method: 'DELETE' });
		const gone = await admin(`/${userId}`);
		const ok = del.ok && (gone.status === 404 || gone.status === 400);
		check('cleanup: throwaway user removed', ok, `delete HTTP ${del.status} · lookup HTTP ${gone.status}`);
		console.log(ok ? 'cleanup ok' : 'cleanup FAILED');
	} catch (e) {
		check('cleanup', false, e.message);
		console.log('cleanup FAILED');
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
