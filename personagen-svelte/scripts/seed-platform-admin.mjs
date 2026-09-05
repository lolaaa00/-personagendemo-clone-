#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Grant (or list / revoke) platform-admin authority by email.
//
//   node scripts/seed-platform-admin.mjs --list
//   node scripts/seed-platform-admin.mjs ops@example.com [more@example.com] [--note "why"]
//   node scripts/seed-platform-admin.mjs --revoke ops@example.com
//
// Writes public.platform_admins through the service role (the table has no
// user policies). Idempotent: granting twice is a no-op. This is the durable
// record; PLATFORM_ADMIN_EMAILS in the app env is only the bootstrap.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from 'node:fs';
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
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
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
const noteIdx = args.indexOf('--note');
const note = noteIdx >= 0 ? args[noteIdx + 1] : 'seed-platform-admin';
const emails = args.filter((a, i) => !a.startsWith('--') && i !== noteIdx + 1).map((e) => e.toLowerCase());

if (args.includes('--list')) {
	const rows = await pg(
		`SELECT u.email, pa.created_at, pa.note FROM public.platform_admins pa JOIN auth.users u ON u.id = pa.user_id ORDER BY pa.created_at`
	);
	if (!rows.length) console.log('(no platform admins)');
	for (const r of rows) console.log(`${r.email.padEnd(40)} since ${String(r.created_at).slice(0, 19)}  ${r.note ?? ''}`);
	process.exit(0);
}
if (emails.length === 0) {
	console.log('usage: seed-platform-admin.mjs --list | <email>... [--note "why"] | --revoke <email>...');
	process.exit(1);
}
for (const email of emails) {
	const users = await pg(`SELECT id FROM auth.users WHERE lower(email) = ${q(email)} LIMIT 1`);
	if (!users.length) {
		console.error(`no auth user with email ${email}`);
		process.exitCode = 1;
		continue;
	}
	const id = users[0].id;
	if (args.includes('--revoke')) {
		await pg(`DELETE FROM public.platform_admins WHERE user_id = ${q(id)}`);
		console.log(`revoked  ${email}`);
	} else {
		await pg(
			`INSERT INTO public.platform_admins (user_id, note) VALUES (${q(id)}, ${q(note)}) ON CONFLICT (user_id) DO NOTHING`
		);
		console.log(`admin    ${email}`);
	}
}
