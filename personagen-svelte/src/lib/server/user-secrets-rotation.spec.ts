/**
 * BYOK secret hardening: the column-grant migration and the re-key script.
 *
 * Two things are proved here, and they are the two that cannot be checked by
 * reading the code:
 *
 *   1. supabase/user_api_keys_column_grants_migration.sql — the stage-B block
 *      names EXACTLY the three secret columns and re-grants EXACTLY the rest,
 *      with the column list derived from the CREATE TABLE statements rather
 *      than copied, so adding a column to either table fails this test instead
 *      of silently dropping that column out of the grant. It also proves the
 *      ACTIVE part of the file contains no column-level SELECT change at all —
 *      stage B is documentation until the server stops decrypting through the
 *      `authenticated` role, and applying the file today must not break BYOK.
 *
 *   2. scripts/rotate-user-secrets.mjs replicates the app's crypto exactly.
 *      The script cannot import src/lib/server/user-api-keys.ts (TypeScript,
 *      $lib, `$env/dynamic/private`), so the algorithm is duplicated, and a
 *      duplicate is only safe if something fails when it drifts. Both
 *      implementations are run against the same inputs, in both directions,
 *      for all three key-derivation forms.
 *
 *      Then the script is executed for real against a stub `/pg/query` server
 *      to prove --dry-run issues SELECTs and nothing else.
 */
import type { AddressInfo } from 'node:net';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFile, type ExecFileException } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The stored ciphertext triple, as both the app and the rotation script see it. */
interface EncryptedTriple {
	encrypted_value: string;
	iv: string;
	auth_tag: string;
}


import {
	deriveKey,
	encryptSecretWith,
	decryptSecretWith,
	planRow,
	SECRET_TABLES
} from '../../../scripts/lib/secret-rotation.mjs';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');

/**
 * Read a repo file as text, asserting it is actually there and non-trivial.
 * Without this every `expect(text).not.toMatch(...)` below would pass
 * vacuously the moment a path breaks or a file is emptied — the assertion
 * would be true of "" for the wrong reason.
 */
function readRepoText(relPath: string): string {
	const text = readFileSync(resolve(repoRoot, relPath), 'utf8');
	expect(text.trim().length, `${relPath} is empty — every assertion on it would pass vacuously`).toBeGreaterThan(200);
	return text;
}

const MIGRATION = 'supabase/user_api_keys_column_grants_migration.sql';
const SECRET_COLUMNS = ['encrypted_value', 'iv', 'auth_tag'];

/** Column names of a CREATE TABLE block, read from the table's own migration. */
function columnsOf(relPath: string, table: string): string[] {
	const sql = readRepoText(relPath);
	const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`);
	expect(start, `no CREATE TABLE for ${table} in ${relPath}`).toBeGreaterThanOrEqual(0);
	const body = sql.slice(start, sql.indexOf('\n);', start));
	const cols: string[] = [];
	for (const line of body.split('\n').slice(1)) {
		const m = line.match(/^\s*([a-z_]+)\s+(UUID|TEXT|TIMESTAMPTZ|BOOLEAN|INTEGER|BIGINT|JSONB)/);
		if (m) cols.push(m[1]);
	}
	expect(cols.length, `parsed no columns for ${table}`).toBeGreaterThan(5);
	return cols;
}

describe('user_api_keys_column_grants_migration.sql — stage B names exactly the secret columns', () => {
	const sql = readRepoText(MIGRATION);
	const stageB = sql.slice(sql.indexOf('-- BEGIN STAGE B'), sql.indexOf('-- END STAGE B'));
	// Un-comment the block the way a follow-up migration would.
	const stageBSql = stageB
		.split('\n')
		.slice(1)
		.map((l) => l.replace(/^--\s?/, ''))
		.join('\n');

	const tables = [
		{ table: 'user_api_keys', file: 'supabase/user_api_keys_migration.sql' },
		{ table: 'zernio_keys', file: 'supabase/zernio_key_manager_migration.sql' }
	];

	it('has a stage-B block at all', () => {
		expect(stageB).toContain('REVOKE SELECT');
		expect(stageBSql).toContain('NOTIFY pgrst');
	});

	it.each(tables)(
		'$table: re-grants every non-secret column and none of the secret three',
		({ table, file }) => {
			const all = columnsOf(file, table);
			// The three secret columns must really exist on the table, or this
			// test is guarding a spelling that no longer means anything.
			for (const c of SECRET_COLUMNS) expect(all, `${table} has no ${c}`).toContain(c);
			const expected = all.filter((c) => !SECRET_COLUMNS.includes(c));

			const m = stageBSql.match(
				new RegExp(`GRANT SELECT \\(([^)]*)\\) ON TABLE public\\.${table} TO authenticated;`)
			);
			expect(m, `no column-level GRANT for ${table}`).toBeTruthy();
			const granted = m![1].split(',').map((s) => s.trim());

			// Exactly the survivors — same set, no duplicates, nothing extra.
			expect([...granted].sort()).toEqual([...expected].sort());
			expect(granted).toHaveLength(expected.length);
			for (const c of SECRET_COLUMNS) expect(granted).not.toContain(c);

			// …and the table-wide grant is dropped first, which is the only way a
			// column-level grant can mean anything in Postgres.
			expect(stageBSql).toContain(`REVOKE SELECT ON TABLE public.${table} FROM authenticated;`);
		}
	);

	it('stage B is NOT active — applying this file today cannot break BYOK decryption', () => {
		// The server decrypts through `locals.supabase`, which connects as the
		// `authenticated` role, and the call sites swallow failures onto the
		// platform key. So the live SQL must contain no column-level SELECT
		// change whatsoever until that moves to service_role.
		const active = sql
			.split('\n')
			.filter((l) => !l.trim().startsWith('--'))
			.join('\n');
		expect(active).not.toMatch(/GRANT\s+SELECT\s*\(/);
		expect(active).not.toMatch(/REVOKE\s+SELECT\s+ON/);
		// What it MUST do: strip anon, and drop TRUNCATE from authenticated by
		// re-granting from zero.
		expect(active).toMatch(/REVOKE ALL ON TABLE public\.user_api_keys FROM anon, PUBLIC;/);
		expect(active).toMatch(/REVOKE ALL ON TABLE public\.zernio_keys\s+FROM anon, PUBLIC;/);
		expect(active).toMatch(/REVOKE ALL ON TABLE public\.user_api_keys FROM authenticated;/);
		expect(active).not.toMatch(/GRANT[^;]*TRUNCATE/);
	});

	it('covers both secret tables and no others', () => {
		expect(SECRET_TABLES.map((t) => t.table).sort()).toEqual(['user_api_keys', 'zernio_keys']);
		for (const { table } of SECRET_TABLES) expect(sql).toContain(`public.${table}`);
	});
});

// ── crypto parity ───────────────────────────────────────────────────────────

/**
 * The three forms getEncryptionKey() accepts, in the order it tests them.
 * `base64-32` is also 44 characters long, so it satisfies the passphrase branch
 * too — it is here precisely to catch a replica that reorders the checks, which
 * would derive a different key and silently fail to decrypt every stored row.
 */
const KEY_FORMS: [string, string][] = [
	['base64-32', Buffer.alloc(32, 7).toString('base64')],
	['hex-64', 'a'.repeat(64)],
	['passphrase>=32', 'x'.repeat(32)],
	['passphrase long', 'correct horse battery staple correct horse']
];

describe('rotate-user-secrets.mjs crypto is byte-identical to user-api-keys.ts', () => {
	it.each(KEY_FORMS)('%s: app encrypts → script decrypts', async (_form, rawKey) => {
		const { mockEnv } = await loadAppCrypto();
		mockEnv.USER_SECRETS_ENCRYPTION_KEY = rawKey;
		const app = await appCrypto();
		const plaintext = 'sk-live-not-a-real-key-0123456789';

		const sealed = app.encryptSecret(plaintext);
		// AES-GCM authenticates: if the derived keys differed by one byte this
		// throws rather than returning wrong plaintext.
		expect(decryptSecretWith(rawKey, sealed)).toBe(plaintext);
	});

	it.each(KEY_FORMS)('%s: script encrypts → app decrypts', async (_form, rawKey) => {
		const { mockEnv } = await loadAppCrypto();
		mockEnv.USER_SECRETS_ENCRYPTION_KEY = rawKey;
		const app = await appCrypto();
		const plaintext = 'fal-abcdef0123456789';

		const sealed = encryptSecretWith(rawKey, plaintext);
		expect(app.decryptSecret(sealed)).toBe(plaintext);
	});

	it.each(KEY_FORMS)('%s: derives a 32-byte key', (_form, rawKey) => {
		expect(deriveKey(rawKey)).toHaveLength(32);
	});

	it('rejects a too-short secret the same way the app does', async () => {
		const { mockEnv } = await loadAppCrypto();
		const short = 'tooshort';
		mockEnv.USER_SECRETS_ENCRYPTION_KEY = short;
		const app = await appCrypto();

		expect(() => deriveKey(short)).toThrow(/32/);
		expect(() => app.encryptSecret('x')).toThrow(/32/);
	});

	it('the three forms are genuinely different keys (so parity above is not trivial)', () => {
		const derived = KEY_FORMS.map(([, k]) => deriveKey(k).toString('hex'));
		expect(new Set(derived).size).toBe(KEY_FORMS.length);
	});
});

// The app module reads `$env/dynamic/private` at call time, so one mocked env
// object can be re-pointed between cases.
const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
async function loadAppCrypto() {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	return { mockEnv };
}
const appCrypto = () => import('./user-api-keys');

// ── planRow: the all-or-nothing classifier ──────────────────────────────────

describe('planRow classifies without ever writing', () => {
	const OLD = 'o'.repeat(32);
	const NEW = 'n'.repeat(32);

	it('a row under the old key is pending, and its re-encryption round-trips', () => {
		const row = encryptSecretWith(OLD, 'sk-secret');
		const plan = planRow(row, OLD, NEW);
		expect(plan.state).toBe('pending');
		const sealed = plan.reencrypted!;
		expect(decryptSecretWith(NEW, sealed)).toBe('sk-secret');
		// New ciphertext, new IV — not a copy.
		expect(sealed.encrypted_value).not.toBe(row.encrypted_value);
		expect(sealed.iv).not.toBe(row.iv);
	});

	it('a row already under the new key is skipped, not double-encrypted', () => {
		const row = encryptSecretWith(NEW, 'sk-secret');
		expect(planRow(row, OLD, NEW)).toEqual({ state: 'rotated' });
	});

	it('a row under neither key fails, so the run can refuse before writing', () => {
		const row = encryptSecretWith('z'.repeat(32), 'sk-secret');
		expect(planRow(row, OLD, NEW).state).toBe('failed');
	});

	it('a tampered auth tag fails rather than returning garbage', () => {
		const row = encryptSecretWith(OLD, 'sk-secret');
		const tampered = { ...row, auth_tag: Buffer.alloc(16, 1).toString('base64') };
		expect(planRow(tampered, OLD, NEW).state).toBe('failed');
	});

	// The round-trip check is unreachable with real AES-GCM, so these two drive
	// it with a broken codec. Without them, deleting the check would change
	// nothing that any test could see — and "every row is verified before it is
	// written" would be a comment rather than a guarantee.
	it('fails the row when the re-encryption decrypts to something else', () => {
		const row = encryptSecretWith(OLD, 'sk-secret');
		const brokenCodec = {
			encrypt: (_key: string, _value: string) => encryptSecretWith(NEW, 'a-different-secret'),
			decrypt: decryptSecretWith
		};
		const plan = planRow(row, OLD, NEW, brokenCodec);
		expect(plan.state).toBe('failed');
		expect(plan.reason).toBe('round-trip mismatch');
	});

	it('fails the row when the re-encryption cannot be decrypted back at all', () => {
		const row = encryptSecretWith(OLD, 'sk-secret');
		let calls = 0;
		const brokenCodec = {
			encrypt: encryptSecretWith,
			// first call (old key) succeeds; the verification read throws
			decrypt: (key: string, secret: EncryptedTriple) => {
				if (++calls > 1) throw new Error('cannot read it back');
				return decryptSecretWith(key, secret);
			}
		};
		const plan = planRow(row, OLD, NEW, brokenCodec);
		expect(plan.state).toBe('failed');
		expect(plan.reason).toBe('round-trip decrypt failed');
	});
});

// ── the script, actually executed ───────────────────────────────────────────

/** A stub `/pg/query` that records every statement it is asked to run. */
async function withStubPg(
	rows: Record<string, Array<Record<string, unknown>>>,
	fn: (baseUrl: string) => Promise<void>
): Promise<string[]> {
	const seen: string[] = [];
	const server = createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			const query = JSON.parse(body || '{}').query || '';
			seen.push(query);
			const table = Object.keys(rows).find((t) => query.includes(`public.${t}`));
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(query.trim().startsWith('SELECT') ? rows[table!] || [] : []));
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	const port = (server.address() as AddressInfo).port;
	try {
		await fn(`http://127.0.0.1:${port}`);
	} finally {
		server.close();
	}
	return seen;
}

function runScript(baseUrl: string, args: string[], env: Record<string, string>) {
	const script = resolve(repoRoot, 'scripts/rotate-user-secrets.mjs');
	return new Promise<{ code: number; stdout: string; stderr: string }>((res) => {
		execFile(
			process.execPath,
			[script, ...args],
			{
				cwd: repoRoot,
				env: {
					...process.env,
					PUBLIC_SUPABASE_URL: baseUrl,
					SUPABASE_SERVICE_ROLE_KEY: 'stub-service-key',
					...env
				}
			},
			(err: ExecFileException | null, stdout: string, stderr: string) =>
				res({ code: typeof err?.code === 'number' ? err.code : 0, stdout, stderr })
		);
	});
}

const OLD_KEY = 'old-passphrase-for-rotation-test-0';
const NEW_KEY = 'new-passphrase-for-rotation-test-1';
const PLAINTEXT = 'sk-or-v1-plaintext-that-must-never-be-printed';

function stubRows() {
	return {
		user_api_keys: [
			{
				id: '11111111-1111-1111-1111-111111111111',
				provider: 'openrouter',
				...encryptSecretWith(OLD_KEY, PLAINTEXT)
			}
		],
		zernio_keys: [
			{ id: '22222222-2222-2222-2222-222222222222', ...encryptSecretWith(OLD_KEY, PLAINTEXT) }
		]
	};
}

describe('rotate-user-secrets.mjs --dry-run writes nothing', () => {
	it('issues only SELECTs, and says so', async () => {
		let result!: { code: number; stdout: string; stderr: string };
		const seen = await withStubPg(stubRows(), async (baseUrl) => {
			result = await runScript(baseUrl, ['--dry-run'], {
				USER_SECRETS_ENCRYPTION_KEY: OLD_KEY,
				USER_SECRETS_ENCRYPTION_KEY_NEW: NEW_KEY
			});
		});

		expect(result.stderr).toBe('');
		expect(result.code).toBe(0);
		// The real proof: the database was only ever read.
		expect(seen.length).toBe(2);
		for (const s of seen) expect(s.trim().startsWith('SELECT')).toBe(true);
		expect(seen.join('\n')).not.toMatch(/UPDATE|INSERT|DELETE|BEGIN|COMMIT/);
		expect(result.stdout).toContain('DRY RUN complete');
		expect(result.stdout).toContain('nothing was written');
		expect(result.stdout).toContain('2 row(s) would be rewritten');
	});

	it('never prints a secret, a key, or a ciphertext', async () => {
		let result!: { code: number; stdout: string; stderr: string };
		const rows = stubRows();
		await withStubPg(rows, async (baseUrl) => {
			result = await runScript(baseUrl, ['--dry-run'], {
				USER_SECRETS_ENCRYPTION_KEY: OLD_KEY,
				USER_SECRETS_ENCRYPTION_KEY_NEW: NEW_KEY
			});
		});
		const out = result.stdout + result.stderr;
		expect(out).not.toContain(PLAINTEXT);
		expect(out).not.toContain(OLD_KEY);
		expect(out).not.toContain(NEW_KEY);
		expect(out).not.toContain(rows.user_api_keys[0].encrypted_value);
		// …but it does identify rows usefully: id prefix + provider.
		expect(out).toContain('11111111');
		expect(out).toContain('openrouter');
		// and never a full id
		expect(out).not.toContain('11111111-1111-1111-1111-111111111111');
	});

	it('refuses to do anything with neither --dry-run nor --commit', async () => {
		let result!: { code: number; stdout: string; stderr: string };
		const seen = await withStubPg(stubRows(), async (baseUrl) => {
			result = await runScript(baseUrl, [], {
				USER_SECRETS_ENCRYPTION_KEY: OLD_KEY,
				USER_SECRETS_ENCRYPTION_KEY_NEW: NEW_KEY
			});
		});
		expect(seen).toEqual([]);
		expect(result.code).toBe(1);
		expect(result.stdout).toContain('usage:');
	});

	it('refuses when the new key is missing rather than guessing', async () => {
		let result!: { code: number; stdout: string; stderr: string };
		const seen = await withStubPg(stubRows(), async (baseUrl) => {
			result = await runScript(baseUrl, ['--dry-run'], {
				USER_SECRETS_ENCRYPTION_KEY: OLD_KEY,
				USER_SECRETS_ENCRYPTION_KEY_NEW: ''
			});
		});
		expect(seen).toEqual([]);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain('USER_SECRETS_ENCRYPTION_KEY_NEW is not set');
	});

	it('refuses when old and new derive to the same key', async () => {
		let result!: { code: number; stdout: string; stderr: string };
		const seen = await withStubPg(stubRows(), async (baseUrl) => {
			result = await runScript(baseUrl, ['--dry-run'], {
				USER_SECRETS_ENCRYPTION_KEY: OLD_KEY,
				USER_SECRETS_ENCRYPTION_KEY_NEW: OLD_KEY
			});
		});
		expect(seen).toEqual([]);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain('nothing to rotate');
	});

	it('aborts without writing when one row decrypts under neither key', async () => {
		const rows = stubRows();
		rows.user_api_keys.push({
			id: '33333333-3333-3333-3333-333333333333',
			provider: 'fal_ai',
			...encryptSecretWith('a-third-key-nobody-has-anymore-xx', PLAINTEXT)
		});
		let result!: { code: number; stdout: string; stderr: string };
		const seen = await withStubPg(rows, async (baseUrl) => {
			result = await runScript(baseUrl, ['--commit'], {
				USER_SECRETS_ENCRYPTION_KEY: OLD_KEY,
				USER_SECRETS_ENCRYPTION_KEY_NEW: NEW_KEY
			});
		});
		// --commit, two perfectly good rows, and STILL nothing written.
		expect(seen.join('\n')).not.toMatch(/UPDATE|BEGIN|COMMIT/);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain('NOTHING was written');
		expect(result.stderr).toContain('33333333');
	});
});

describe('rotate-user-secrets.mjs --commit', () => {
	it('writes every row in ONE transaction, re-encrypted under the new key', async () => {
		let result!: { code: number; stdout: string; stderr: string };
		const seen = await withStubPg(stubRows(), async (baseUrl) => {
			result = await runScript(baseUrl, ['--commit'], {
				USER_SECRETS_ENCRYPTION_KEY: OLD_KEY,
				USER_SECRETS_ENCRYPTION_KEY_NEW: NEW_KEY
			});
		});
		expect(result.code).toBe(0);
		const writes = seen.filter((s) => s.includes('UPDATE'));
		expect(writes).toHaveLength(1); // one statement bundle, not one per row
		expect(writes[0].startsWith('BEGIN;')).toBe(true);
		expect(writes[0].trim().endsWith('COMMIT;')).toBe(true);
		expect(writes[0]).toContain('UPDATE public.user_api_keys');
		expect(writes[0]).toContain('UPDATE public.zernio_keys');

		// The ciphertext it wrote really does decrypt under the NEW key.
		const m = writes[0].match(
			/UPDATE public\.user_api_keys SET encrypted_value = '([^']*)', iv = '([^']*)', auth_tag = '([^']*)'/
		);
		expect(m).toBeTruthy();
		expect(
			decryptSecretWith(NEW_KEY, {
				encrypted_value: m![1],
				iv: m![2],
				auth_tag: m![3]
			})
		).toBe(PLAINTEXT);
		// And it tells the operator to flip the env var only now.
		expect(result.stdout).toContain('NEXT, and not before');
	});

	it('is idempotent: a second run over rotated rows writes nothing', async () => {
		const rows = {
			user_api_keys: [
				{
					id: '11111111-1111-1111-1111-111111111111',
					provider: 'openrouter',
					...encryptSecretWith(NEW_KEY, PLAINTEXT)
				}
			],
			zernio_keys: []
		};
		let result!: { code: number; stdout: string; stderr: string };
		const seen = await withStubPg(rows, async (baseUrl) => {
			result = await runScript(baseUrl, ['--commit'], {
				USER_SECRETS_ENCRYPTION_KEY: OLD_KEY,
				USER_SECRETS_ENCRYPTION_KEY_NEW: NEW_KEY
			});
		});
		expect(seen.join('\n')).not.toMatch(/UPDATE|BEGIN/);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain('already rotated');
		expect(result.stdout).toContain('nothing to do');
	});
});
