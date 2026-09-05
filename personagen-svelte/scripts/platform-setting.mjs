#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Read / set platform switches from the command line — the same
// platform_setting_set() path as the Admin Console (validated, history row).
//
//   node scripts/platform-setting.mjs --list
//   node scripts/platform-setting.mjs --as admin@example.com --note "why" credits_mode shadow
//   node scripts/platform-setting.mjs --as admin@example.com --note "why" activity_log on
//   node scripts/platform-setting.mjs --as admin@example.com --note "why" activity_pepper --rotate
//
// The pepper's value is never printed. Env vars of the same name on the host
// still override stored values — the console shows which one is in effect.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const URL_ = env.PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
	console.error('PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
	process.exit(1);
}
const q = (s) => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
async function pg(query) {
	const r = await fetch(`${URL_}/pg/query`, {
		method: 'POST',
		headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ query })
	});
	const t = await r.text();
	if (!r.ok) throw new Error(`pg/query ${r.status}: ${t.slice(0, 300)}`);
	try {
		return JSON.parse(t);
	} catch {
		return t;
	}
}

const args = process.argv.slice(2);
const opt = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : null;
};

if (args.includes('--list')) {
	const rows = await pg(
		`SELECT key, CASE WHEN key = 'activity_pepper' THEN '(secret, ' || length(value #>> '{}') || ' chars)' ELSE value::text END AS value, updated_at FROM public.platform_settings ORDER BY key`
	);
	for (const r of rows) console.log(`${r.key.padEnd(18)} ${String(r.value).padEnd(24)} ${String(r.updated_at).slice(0, 19)}`);
	process.exit(0);
}

const asEmail = (opt('--as') || '').toLowerCase();
const note = opt('--note');
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--as' && args[i - 1] !== '--note');
const [key, rawValue] = positional;
if (!asEmail || !note || !key) {
	console.log('usage: platform-setting.mjs --list | --as <admin email> --note "<why>" <key> <value> | activity_pepper --rotate');
	process.exit(1);
}
const admin = await pg(`SELECT u.id FROM auth.users u JOIN public.platform_admins pa ON pa.user_id = u.id WHERE lower(u.email) = ${q(asEmail)} LIMIT 1`);
if (!admin.length) {
	console.error(`${asEmail} is not a platform admin`);
	process.exit(1);
}
let valueJson;
if (key === 'activity_pepper') {
	if (!args.includes('--rotate')) {
		console.error('activity_pepper can only be rotated (--rotate)');
		process.exit(1);
	}
	valueJson = JSON.stringify(randomBytes(32).toString('hex'));
} else if (key === 'activity_log') {
	valueJson = JSON.stringify(rawValue === 'on' || rawValue === 'true');
} else if (key === 'credits_mode') {
	valueJson = JSON.stringify(String(rawValue).toLowerCase());
} else {
	console.error(`unknown key ${key}`);
	process.exit(1);
}
try {
	await pg(`SELECT public.platform_setting_set(${q(key)}, ${q(valueJson)}::jsonb, ${q(admin[0].id)}, ${q(note)})`);
	console.log(`${key} → ${key === 'activity_pepper' ? '(rotated)' : valueJson}`);
} catch (e) {
	console.error('FAILED:', e.message);
	process.exit(1);
}
