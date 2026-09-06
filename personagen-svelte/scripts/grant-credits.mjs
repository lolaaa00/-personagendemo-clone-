#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Grant / set / adjust credits from the command line — same credit_apply()
// path as the admin panel, so every run is a ledger row with an actor and a
// note. Use this when the app is not deployed yet or for bulk provisioning.
//
//   node scripts/grant-credits.mjs --as admin@example.com --note "pilot cohort 1" \
//        --grant 5000 user1@x.com user2@x.com
//   node scripts/grant-credits.mjs --as admin@example.com --note "reset" --set 0 user@x.com
//   node scripts/grant-credits.mjs --as admin@example.com --note "undo" --adjust -500 user@x.com
//   node scripts/grant-credits.mjs --balances            list every wallet
//
// --as must be a platform admin (checked against platform_admins).
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

if (args.includes('--balances')) {
	const rows = await pg(
		`SELECT u.email, a.balance_credits, a.billing_mode, a.updated_at FROM public.credit_accounts a JOIN auth.users u ON u.id = a.user_id ORDER BY a.balance_credits DESC`
	);
	if (!rows.length) console.log('(no wallets yet)');
	for (const r of rows) console.log(`${r.email.padEnd(40)} ${String(r.balance_credits).padStart(9)} cr  ${r.billing_mode}  ${String(r.updated_at).slice(0, 19)}`);
	process.exit(0);
}

const asEmail = (opt('--as') || '').toLowerCase();
const note = opt('--note');
const kind = args.includes('--grant') ? 'grant' : args.includes('--set') ? 'set' : args.includes('--adjust') ? 'adjustment' : null;
const amount = Number(opt('--grant') ?? opt('--set') ?? opt('--adjust'));
// Consume option VALUES by position, not by value — otherwise an admin granting
// to their own address (same string as --as) silently drops themselves.
const valueOpts = new Set(['--as', '--note', '--grant', '--set', '--adjust']);
const targets = args
	.filter((a, i) => !a.startsWith('--') && !valueOpts.has(args[i - 1]))
	.map((e) => e.toLowerCase());

if (!asEmail || !note || !kind || !Number.isInteger(amount) || targets.length === 0) {
	console.log('usage: grant-credits.mjs --as <admin email> --note "<why>" (--grant N | --set N | --adjust ±N) <email>... | --balances');
	process.exit(1);
}

const admin = await pg(`SELECT u.id FROM auth.users u JOIN public.platform_admins pa ON pa.user_id = u.id WHERE lower(u.email) = ${q(asEmail)} LIMIT 1`);
if (!admin.length) {
	console.error(`${asEmail} is not a platform admin (see scripts/seed-platform-admin.mjs)`);
	process.exit(1);
}
const actor = admin[0].id;

for (const email of targets) {
	const users = await pg(`SELECT id FROM auth.users WHERE lower(email) = ${q(email)} LIMIT 1`);
	if (!users.length) {
		console.error(`skip     ${email}: no auth user`);
		process.exitCode = 1;
		continue;
	}
	try {
		const res = await pg(
			`SELECT public.credit_apply(${q(users[0].id)}, ${amount}, ${q(kind)}, ${q(note)}, ${q(actor)}, NULL, NULL, NULL, NULL, 0, ${kind === 'adjustment'}) AS balance`
		);
		console.log(`${kind.padEnd(10)} ${email.padEnd(40)} ${amount >= 0 ? '+' : ''}${amount}  → balance ${res[0]?.balance}`);
	} catch (e) {
		console.error(`FAILED   ${email}: ${e.message}`);
		process.exitCode = 1;
	}
}
