#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Re-key every stored BYOK secret from an OLD USER_SECRETS_ENCRYPTION_KEY to a
// NEW one.
//
//   node scripts/rotate-user-secrets.mjs --dry-run
//   node scripts/rotate-user-secrets.mjs --dry-run --new-key-env USER_SECRETS_ENCRYPTION_KEY_NEW
//   node scripts/rotate-user-secrets.mjs --commit
//   node scripts/rotate-user-secrets.mjs --dry-run --table zernio_keys
//
// One env secret, USER_SECRETS_ENCRYPTION_KEY, encrypts every provider API key
// the platform stores, in two tables:
//
//   public.user_api_keys   one row per (user, provider)
//   public.zernio_keys     extra per-persona Zernio accounts
//
// Those are the only two. They are the only tables in supabase/ carrying the
// (encrypted_value, iv, auth_tag) triple, and the only consumers of
// encryptSecret/decryptSecret in src/ (verified 2026-09-15).
//
// WHY THIS IS CAREFUL
//   A decrypt failure is currently SWALLOWED at the call sites —
//   generate.ts:364,368 and ai-client.ts:163,169 all do `.catch(() => null)`
//   and fall back to the platform's own provider key. So a half-finished
//   rotation does not raise an error: it quietly moves every affected user's
//   spend onto the platform's account. A partial rotation is therefore strictly
//   worse than no rotation, and this script is built so one cannot happen:
//
//     * every row is decrypted and round-trip verified IN MEMORY first;
//     * if ANY row fails to decrypt, nothing is written at all;
//     * all writes — both tables — ride in ONE transaction, so the run either
//       lands completely or leaves the database exactly as it was;
//     * --dry-run is the whole proof without the write, and a bare invocation
//       with neither --dry-run nor --commit refuses to do anything.
//
//   Resumable and idempotent: a row that no longer decrypts under the OLD key
//   but does under the NEW one is already rotated. It is counted and skipped,
//   never re-encrypted, so re-running after any interruption is safe and a
//   fully rotated database reports "nothing to do".
//
// ── CRYPTO MUST STAY IN STEP WITH src/lib/server/user-api-keys.ts ──────────
//   deriveKey / encryptSecretWith / decryptSecretWith below are a deliberate
//   line-for-line replica of getEncryptionKey / encryptSecret / decryptSecret
//   in src/lib/server/user-api-keys.ts:29-74. They CANNOT import it: that file
import {
	deriveKey,
	encryptSecretWith,
	decryptSecretWith,
	SECRET_TABLES,
	planRow
} from './lib/secret-rotation.mjs';
export { deriveKey, encryptSecretWith, decryptSecretWith, SECRET_TABLES, planRow };
//   is TypeScript under $lib and imports `$env/dynamic/private`, both of which
//   only exist inside the SvelteKit/Vite build — a plain .mjs run by node
//   resolves neither.
//
//   If the app's crypto ever changes, change it here in the same commit.
//   src/lib/server/user-secrets-rotation.spec.ts runs BOTH implementations
//   against the same inputs — all three key forms, plus cross-decryption in
//   both directions — and fails the build if they drift apart.
//
// Transport: the same `${PUBLIC_SUPABASE_URL}/pg/query` endpoint
// scripts/apply-migration.mjs uses, authenticated with the service-role key
// from .env (service_role bypasses RLS, so it sees every user's rows).
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 */

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');

// ── crypto — replica of src/lib/server/user-api-keys.ts:29-74 ───────────────

/**
 * Derive the 32-byte AES key from a raw secret.
 * Replica of getEncryptionKey() (user-api-keys.ts:29-49). The ORDER of the
 * three forms is load-bearing: a 44-char base64 string that decodes to 32
 * bytes is taken as base64 even though it is also ">= 32 characters", so
 * checking length first would derive a different key and break every row.
 *
 * @param {string | undefined | null} raw
 * @returns {Buffer}
 */
function loadEnv() {
	const envPath = join(appRoot, '.env');
	const out = { ...process.env };
	if (!existsSync(envPath)) return out;
	for (const line of readFileSync(envPath, 'utf8').split('\n')) {
		const m = line.match(/^\s*([\w_]+)\s*=\s*(.*)\s*$/);
		if (!m) continue;
		let v = m[2].trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
			v = v.slice(1, -1);
		if (!(m[1] in process.env)) out[m[1]] = v;
	}
	return out;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} query
 * @returns {Promise<any>}
 */
async function pgQuery(env, query) {
	const url = env.PUBLIC_SUPABASE_URL;
	const key = env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		throw new Error(
			'PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (env or personagen-svelte/.env)'
		);
	}
	const res = await fetch(`${url}/pg/query`, {
		method: 'POST',
		headers: {
			apikey: key,
			Authorization: `Bearer ${key}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ query })
	});
	const text = await res.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		data = text;
	}
	if (!res.ok) {
		const msg = typeof data === 'string' ? data : data?.message || data?.error || JSON.stringify(data);
		throw new Error(`pg/query ${res.status}: ${String(msg).slice(0, 500)}`);
	}
	return data;
}

/** @param {unknown} s */
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** First 8 characters of a uuid — enough to find the row, useless on its own. */
/** @param {unknown} id */
const idPrefix = (id) => String(id).slice(0, 8);

// ── the rotation ────────────────────────────────────────────────────────────

/**
 * Classify one row against the two keys, without writing.
 *   'pending'  decrypts under OLD  → needs re-encryption
 *   'rotated'  fails OLD, decrypts under NEW → a previous run already did it
 *   'failed'   decrypts under neither → the run must abort
 * On 'pending' the row is re-encrypted under NEW and verified to round-trip
 * back to the identical plaintext before it is ever considered writable.
 *
 * `codec` exists so the round-trip check below can actually be tested. With the
 * real crypto that branch is unreachable — AES-GCM always decrypts what it just
 * encrypted under the same key — so without an injectable codec the guarantee
 * "verified before written" would be an untested claim. The spec passes a
 * deliberately broken codec to prove the check fires.
 *
 * @param {{ encrypted_value: string, iv: string, auth_tag: string }} row
 * @param {string} oldKey
 * @param {string} newKey
 * @param {{ encrypt: typeof encryptSecretWith, decrypt: typeof decryptSecretWith }} [codec]
 * @returns {RowPlan}
 */
async function run({ dryRun, onlyTable }) {
	const env = loadEnv();

	// ── the two keys, never guessed ──────────────────────────────────────────
	const oldKeyName = 'USER_SECRETS_ENCRYPTION_KEY';
	const oldKey = env[oldKeyName];
	if (!oldKey) throw new Error(`${oldKeyName} is not set — that is the OLD key and it is required.`);

	const args = process.argv.slice(2);
	const newKeyArgIdx = args.indexOf('--new-key-env');
	const newKeyName = newKeyArgIdx >= 0 ? args[newKeyArgIdx + 1] : 'USER_SECRETS_ENCRYPTION_KEY_NEW';
	if (newKeyArgIdx >= 0 && !newKeyName) throw new Error('--new-key-env needs a variable name');
	if (newKeyName === oldKeyName) {
		throw new Error(
			`--new-key-env cannot be ${oldKeyName}: that variable holds the OLD key. The new key must live in its own variable so neither is ever guessed.`
		);
	}
	const newKey = env[newKeyName];
	if (!newKey) {
		throw new Error(
			`${newKeyName} is not set — that is the NEW key. Put it in the environment (not in .env next to the old one, and never on the command line, where it would show up in the process list) or pass --new-key-env <VAR>.`
		);
	}

	// Both must be *valid* before anything else happens, and they must differ.
	// Comparing derived keys catches "same key written two different ways".
	const oldDerived = deriveKey(oldKey);
	const newDerived = deriveKey(newKey);
	if (oldDerived.equals(newDerived)) {
		throw new Error(
			`${oldKeyName} and ${newKeyName} derive to the same AES key — there is nothing to rotate.`
		);
	}

	console.log(`old key  ${oldKeyName} (set, valid)`);
	console.log(`new key  ${newKeyName} (set, valid, differs)`);
	console.log(`mode     ${dryRun ? 'DRY RUN — nothing will be written' : 'COMMIT — will write'}`);
	console.log('');

	const tables = SECRET_TABLES.filter((t) => !onlyTable || t.table === onlyTable);
	if (onlyTable && tables.length === 0) {
		throw new Error(
			`--table ${onlyTable} is not a secret table. Known: ${SECRET_TABLES.map((t) => t.table).join(', ')}`
		);
	}

	const totals = { pending: 0, rotated: 0, failed: 0, rows: 0 };
	const updates = [];
	const failures = [];

	for (const { table, tagColumn, tagFallback } of tables) {
		const cols = ['id', 'encrypted_value', 'iv', 'auth_tag', tagColumn].filter(Boolean).join(', ');
		const rows = (await pgQuery(env, `SELECT ${cols} FROM public.${table} ORDER BY id`)) || [];
		console.log(`${table} — ${rows.length} row(s)`);

		for (const row of rows) {
			totals.rows++;
			const tag = tagColumn ? row[tagColumn] : tagFallback;
			const plan = planRow(row, oldKey, newKey);
			const label = `  ${idPrefix(row.id)}  ${String(tag).padEnd(12)}`;

			if (plan.state === 'failed') {
				totals.failed++;
				failures.push({ table, id: row.id, tag });
				console.log(`${label} FAILED   ${plan.reason || 'decrypts under neither key'}`);
				continue;
			}
			if (plan.state === 'rotated') {
				totals.rotated++;
				console.log(`${label} already rotated (skipped)`);
				continue;
			}
			totals.pending++;
			console.log(`${label} ok       decrypts + re-encrypts + verifies`);
			updates.push({ table, id: row.id, ...plan.reencrypted });
		}
		console.log('');
	}

	console.log(
		`totals   ${totals.rows} row(s) · ${totals.pending} to rotate · ${totals.rotated} already rotated · ${totals.failed} FAILED`
	);

	// ── the gate: all-or-nothing ─────────────────────────────────────────────
	if (totals.failed > 0) {
		for (const f of failures) console.error(`REFUSED  ${f.table} ${idPrefix(f.id)} (${f.tag})`);
		throw new Error(
			`${totals.failed} row(s) decrypt under neither key — NOTHING was written. A partial rotation would silently move those users onto the platform's provider key. Fix or delete those rows first (the owner can re-enter the key from Settings), then re-run.`
		);
	}

	if (updates.length === 0) {
		console.log('nothing to do — every row is already encrypted under the new key');
		return;
	}

	if (dryRun) {
		console.log(
			`\nDRY RUN complete · ${updates.length} row(s) would be rewritten · nothing was written.`
		);
		console.log('Every row above decrypted under the old key and round-tripped under the new one,');
		console.log('so a --commit run will succeed. Flip the env var only AFTER that run reports ok.');
		return;
	}

	// One transaction, both tables. Either the whole rotation lands or none of it.
	const stmts = updates.map(
		(u) =>
			`UPDATE public.${u.table} SET encrypted_value = ${q(u.encrypted_value)}, iv = ${q(u.iv)}, auth_tag = ${q(u.auth_tag)} WHERE id = ${q(u.id)};`
	);
	process.stdout.write(`\ncommit   ${stmts.length} row(s) in one transaction … `);
	await pgQuery(env, ['BEGIN;', ...stmts, 'COMMIT;'].join('\n'));
	console.log('ok');
	console.log(
		`\nDone. Every secret is now encrypted under ${newKeyName}.\n` +
			`NEXT, and not before: set ${oldKeyName} to that value in the deployment environment and restart.\n` +
			`Until you do, the app is still decrypting with the OLD key and every BYOK call will fail —\n` +
			`silently, onto the platform's own key. See docs/runbooks/rotate-user-secrets.md.`
	);
}

// ── main (only when executed directly, so the spec can import the crypto) ───
const isDirectRun =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
	const args = process.argv.slice(2);
	const flags = new Set(args.filter((a) => a.startsWith('--')));
	const tableIdx = args.indexOf('--table');
	try {
		const dryRun = flags.has('--dry-run');
		const commit = flags.has('--commit');
		if (dryRun === commit) {
			console.log(
				'usage: rotate-user-secrets.mjs (--dry-run | --commit) [--new-key-env <VAR>] [--table <name>]\n\n' +
					'  --dry-run   prove every row decrypts under the old key and round-trips under the\n' +
					'              new one, writing nothing. Always run this first.\n' +
					'  --commit    do the rotation, all rows in one transaction.\n' +
					'  --new-key-env  variable holding the NEW key (default USER_SECRETS_ENCRYPTION_KEY_NEW).\n' +
					'                 The OLD key is always USER_SECRETS_ENCRYPTION_KEY.\n' +
					'  --table     restrict to one of: ' + SECRET_TABLES.map((t) => t.table).join(', ') + '\n\n' +
					'Exactly one of --dry-run / --commit is required — a bare run never writes.'
			);
			process.exitCode = 1;
		} else {
			await run({ dryRun, onlyTable: tableIdx >= 0 ? args[tableIdx + 1] : null });
		}
	} catch (/** @type {any} */ e) {
		console.error('ERROR:', e.message);
		process.exitCode = 1;
	}
}
