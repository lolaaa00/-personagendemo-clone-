/**
 * BYOK secret reads go through the service role, and a decrypt failure is
 * visible — the two prerequisites of stage B of the column-grant migration,
 * plus the stage-B migration itself.
 *
 *   1. getUserApiKey / getZernioKeySecretById read (encrypted_value, iv,
 *      auth_tag) on the SERVICE client even when handed a user-scoped one,
 *      still filtered by user_id; without a service key they fall back to the
 *      caller's client (the credits.ts pattern), so nothing else in the suite
 *      changes.
 *   2. A ciphertext that will not open throws — unchanged, the resolvers'
 *      `.catch(() => null)` fallback is deliberate — and, first, stamps the
 *      row status='error' with a last_error that carries no fragment of the
 *      ciphertext, iv or tag. A good row writes nothing. A failing status write
 *      changes nothing about the thrown error.
 *   3. supabase/user_api_keys_secret_columns_migration.sql re-grants
 *      `authenticated` exactly the non-secret columns, derived from the CREATE
 *      TABLE (+ any ADD COLUMN) in client_bootstrap.sql rather than copied, so
 *      a new column fails here instead of silently dropping out of the grant.
 *      And no query in src/ reads a secret column outside the two service-
 *      routed readers, or uses select('*') on either table — the thing that
 *      would 42501 the moment stage B is applied.
 *
 * Every case below uses 'zernio' as its exemplar provider, and that choice is
 * load-bearing. Customer BYOK was withdrawn from the generation providers on
 * 2026-09-21 and getUserApiKey now returns null for them ahead of any query, so
 * an assertion written against 'openrouter' — as these were — would pass
 * without the service client, the decryption or the status write ever running.
 * Zernio is the one key a customer still brings, so it is the only provider for
 * which these tests can still fail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mockEnv: Record<string, string> = {
	USER_SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64')
};
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

/** What getServiceSupabase() hands back — a stub, or a throw (no key). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- stand-in for whatever getServiceSupabase() returns — the untyped client
const serviceRef: { current: (() => any) | null } = { current: null };
vi.mock('./service-supabase', () => ({
	getServiceSupabase: () => {
		if (!serviceRef.current) throw new Error('no service key in tests');
		return serviceRef.current();
	}
}));

const { getUserApiKey, encryptSecret, UNDECRYPTABLE_KEY_MESSAGE } = await import('./user-api-keys');
const { getZernioKeySecretById } = await import('./zernio-keys');

// ── stub client ──────────────────────────────────────────────────────────────

interface Call {
	table: string;
	op: 'select' | 'update';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the select list or update payload, whatever the builder was handed
	arg: any;
	filters: [string, string][];
}

interface StubOptions {
	/** Row returned by maybeSingle() (null = no row). */
	row?: Record<string, string> | null;
	/** What an awaited update chain resolves to, or a function that throws. */
	update?: { error: { message: string } | null } | (() => never);
}

function stubClient(opts: StubOptions = {}) {
	const calls: Call[] = [];
	const client = {
		calls,
		from(table: string) {
			const call: Call = { table, op: 'select', arg: null, filters: [] };
			calls.push(call);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- stand-in for the untyped Supabase builder
			const builder: any = {
				select(cols: string) {
					call.op = 'select';
					call.arg = cols;
					return builder;
				},
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the untyped builder accepts any payload
				update(payload: any) {
					call.op = 'update';
					call.arg = payload;
					return builder;
				},
				eq(col: string, val: string) {
					call.filters.push([col, val]);
					return builder;
				},
				maybeSingle: async () => ({ data: opts.row ?? null, error: null }),
				// The update chain is awaited directly — supabase-js builders are thenables.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- thenable signature of the untyped builder
				then(onOk: (v: any) => any, onErr: (e: any) => any) {
					try {
						const u = opts.update;
						const v = typeof u === 'function' ? u() : (u ?? { error: null });
						return Promise.resolve(v).then(onOk, onErr);
					} catch (e) {
						return Promise.reject(e).then(onOk, onErr);
					}
				}
			};
			return builder;
		}
	};
	return client;
}

const SECRET_COLS = ['encrypted_value', 'iv', 'auth_tag'];

/** Any 6-char window of a secret column value — the finest fragment we refuse. */
function fragmentsOf(row: Record<string, string>): string[] {
	const out: string[] = [];
	for (const c of SECRET_COLS) {
		const v = row[c];
		for (let i = 0; i + 6 <= v.length; i++) out.push(v.slice(i, i + 6));
	}
	return out;
}

const USER = 'user-1';
const PLAINTEXT = 'sk-or-v1-abcdef0123456789';

function goodRow() {
	return { ...encryptSecret(PLAINTEXT) };
}
function badRow() {
	const row = goodRow();
	// Flip one ciphertext byte so the GCM tag no longer verifies.
	const buf = Buffer.from(row.encrypted_value, 'base64');
	buf[0] ^= 0xff;
	row.encrypted_value = buf.toString('base64');
	return row;
}

beforeEach(() => {
	serviceRef.current = null;
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ── 1. which client reads ────────────────────────────────────────────────────

describe('secret reads happen on the service client', () => {
	it('getUserApiKey: reads the secret columns on the SERVICE client, never on the user client', async () => {
		const service = stubClient({ row: goodRow() });
		const user = stubClient({ row: goodRow() });
		serviceRef.current = () => service;

		await expect(getUserApiKey(user, USER, 'zernio')).resolves.toBe(PLAINTEXT);

		expect(user.calls, 'the user-scoped client must not be touched').toHaveLength(0);
		expect(service.calls).toHaveLength(1);
		const read = service.calls[0];
		expect(read.table).toBe('user_api_keys');
		expect(read.op).toBe('select');
		for (const c of SECRET_COLS) expect(read.arg).toContain(c);
		// Scoped by user — this changes which role reads, not who may see what.
		expect(read.filters).toEqual([
			['user_id', USER],
			['provider', 'zernio']
		]);
	});

	it('getZernioKeySecretById: same — service client, scoped by user_id AND id', async () => {
		const service = stubClient({ row: goodRow() });
		const user = stubClient({ row: goodRow() });
		serviceRef.current = () => service;

		await expect(getZernioKeySecretById(user, USER, 'key-9')).resolves.toBe(PLAINTEXT);

		expect(user.calls).toHaveLength(0);
		expect(service.calls).toHaveLength(1);
		expect(service.calls[0].table).toBe('zernio_keys');
		expect(service.calls[0].op).toBe('select');
		for (const c of SECRET_COLS) expect(service.calls[0].arg).toContain(c);
		expect(service.calls[0].filters).toEqual([
			['user_id', USER],
			['id', 'key-9']
		]);
	});

	it('without a service key it falls back to the caller client (tests, local dev)', async () => {
		const user = stubClient({ row: goodRow() });
		await expect(getUserApiKey(user, USER, 'zernio')).resolves.toBe(PLAINTEXT);
		expect(user.calls).toHaveLength(1);
		expect(user.calls[0].table).toBe('user_api_keys');
		expect(user.calls[0].filters[0]).toEqual(['user_id', USER]);
	});

	it('no row → null, and nothing is written', async () => {
		const service = stubClient({ row: null });
		serviceRef.current = () => service;
		await expect(getUserApiKey(stubClient(), USER, 'zernio')).resolves.toBeNull();
		expect(service.calls.map((c) => c.op)).toEqual(['select']);
	});
});

// ── 2. decrypt failure is visible ────────────────────────────────────────────

describe('a ciphertext that will not open', () => {
	it('throws AND stamps the row status=error with a secret-free last_error', async () => {
		const row = badRow();
		const service = stubClient({ row });
		serviceRef.current = () => service;

		await expect(getUserApiKey(stubClient(), USER, 'zernio')).rejects.toThrow(
			/authenticate|auth tag|Unsupported state/i
		);

		const writes = service.calls.filter((c) => c.op === 'update');
		expect(writes).toHaveLength(1);
		const w = writes[0];
		expect(w.table).toBe('user_api_keys');
		expect(w.arg.status).toBe('error');
		expect(w.arg.last_error).toBe(UNDECRYPTABLE_KEY_MESSAGE);
		expect(w.arg.last_error.length).toBeGreaterThan(20);
		expect(w.arg.last_error.length).toBeLessThan(120);
		// Scoped to the same row that was read.
		expect(w.filters).toEqual([
			['user_id', USER],
			['provider', 'zernio']
		]);
		// Not one 6-char window of ciphertext, iv or tag may appear in it.
		const frags = fragmentsOf(row);
		expect(frags.length).toBeGreaterThan(20);
		for (const f of frags) expect(w.arg.last_error).not.toContain(f);
		for (const c of SECRET_COLS) expect(w.arg).not.toHaveProperty(c);
	});

	it('zernio_keys: the stamp lands on the zernio row, scoped by user_id and id', async () => {
		const service = stubClient({ row: badRow() });
		serviceRef.current = () => service;
		await expect(getZernioKeySecretById(stubClient(), USER, 'key-9')).rejects.toThrow();
		const w = service.calls.find((c) => c.op === 'update')!;
		expect(w).toBeTruthy();
		expect(w.table).toBe('zernio_keys');
		expect(w.arg).toEqual({ status: 'error', last_error: UNDECRYPTABLE_KEY_MESSAGE });
		expect(w.filters).toEqual([
			['user_id', USER],
			['id', 'key-9']
		]);
	});

	it('a good ciphertext returns the plaintext and writes nothing', async () => {
		const service = stubClient({ row: goodRow() });
		serviceRef.current = () => service;
		await expect(getUserApiKey(stubClient(), USER, 'zernio')).resolves.toBe(PLAINTEXT);
		expect(service.calls).toHaveLength(1);
		expect(service.calls[0].op).toBe('select');
	});

	it('a failing status write does not change the thrown error (rejecting chain)', async () => {
		const service = stubClient({
			row: badRow(),
			update: () => {
				throw new Error('status write exploded');
			}
		});
		serviceRef.current = () => service;
		let caught: Error | null = null;
		try {
			await getUserApiKey(stubClient(), USER, 'zernio');
		} catch (e) {
			caught = e as Error;
		}
		expect(caught).toBeTruthy();
		expect(caught!.message).not.toContain('status write exploded');
		expect(caught!.message).toMatch(/authenticate|auth tag|Unsupported state/i);
		// The write was attempted, even though it failed.
		expect(service.calls.some((c) => c.op === 'update')).toBe(true);
	});

	it('a failing status write does not change the thrown error ({ error } result)', async () => {
		const service = stubClient({ row: badRow(), update: { error: { message: '42501 permission denied' } } });
		serviceRef.current = () => service;
		await expect(getUserApiKey(stubClient(), USER, 'zernio')).rejects.toThrow(
			/authenticate|auth tag|Unsupported state/i
		);
		expect(service.calls.some((c) => c.op === 'update')).toBe(true);
	});

	it('no encryption key configured at all → throws the config error and stamps NOTHING', async () => {
		// That is the deployment's fault, not this row's; "delete it and save it
		// again" would be the wrong advice to put in front of every user.
		const row = goodRow(); // encrypted while the key is still there
		const saved = mockEnv.USER_SECRETS_ENCRYPTION_KEY;
		mockEnv.USER_SECRETS_ENCRYPTION_KEY = '';
		try {
			const service = stubClient({ row });
			serviceRef.current = () => service;
			await expect(getUserApiKey(stubClient(), USER, 'zernio')).rejects.toThrow(
				/USER_SECRETS_ENCRYPTION_KEY is not configured/
			);
			expect(service.calls.map((c) => c.op)).toEqual(['select']);
		} finally {
			mockEnv.USER_SECRETS_ENCRYPTION_KEY = saved;
		}
	});
});

// ── 3. the stage-B migration ─────────────────────────────────────────────────

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
const BOOTSTRAP = 'supabase/client_bootstrap.sql';
const MIGRATION = 'supabase/user_api_keys_secret_columns_migration.sql';

function readRepoText(relPath: string): string {
	const text = readFileSync(resolve(repoRoot, relPath), 'utf8').replace(/\r\n/g, '\n');
	expect(text.trim().length, `${relPath} is empty — every assertion on it would pass vacuously`).toBeGreaterThan(200);
	return text;
}

/**
 * Every column of a table as the bootstrap defines it: the CREATE TABLE body
 * plus any later `ALTER TABLE public.<t> ADD COLUMN [IF NOT EXISTS] <c>`.
 * Derived, not copied — a column added later must show up here.
 */
function bootstrapColumnsOf(table: string): string[] {
	const sql = readRepoText(BOOTSTRAP);
	const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`);
	expect(start, `no CREATE TABLE for ${table} in ${BOOTSTRAP}`).toBeGreaterThanOrEqual(0);
	const body = sql.slice(start, sql.indexOf('\n);', start));
	const cols: string[] = [];
	for (const line of body.split('\n').slice(1)) {
		const m = line.match(/^\s*([a-z_]+)\s+(UUID|TEXT|TIMESTAMPTZ|BOOLEAN|INTEGER|BIGINT|JSONB|NUMERIC)/);
		if (m) cols.push(m[1]);
	}
	const added = sql.matchAll(
		new RegExp(`ALTER TABLE public\\.${table}\\s+ADD COLUMN(?: IF NOT EXISTS)?\\s+([a-z_]+)`, 'g')
	);
	for (const m of added) if (!cols.includes(m[1])) cols.push(m[1]);
	expect(cols.length, `parsed no columns for ${table}`).toBeGreaterThan(5);
	return cols;
}

describe('user_api_keys_secret_columns_migration.sql — stage B, live', () => {
	const sql = readRepoText(MIGRATION);
	const active = sql
		.split('\n')
		.filter((l) => !l.trim().startsWith('--'))
		.join('\n');

	it.each(['user_api_keys', 'zernio_keys'])(
		'%s: revokes table-wide SELECT then grants exactly the non-secret columns',
		(table) => {
			const all = bootstrapColumnsOf(table);
			for (const c of SECRET_COLS) expect(all, `${table} has no ${c}`).toContain(c);
			const expected = all.filter((c) => !SECRET_COLS.includes(c));

			const revoke = `REVOKE SELECT ON TABLE public.${table} FROM authenticated;`;
			expect(active).toContain(revoke);

			const m = active.match(
				new RegExp(`GRANT SELECT \\(([^)]*)\\) ON TABLE public\\.${table} TO authenticated;`)
			);
			expect(m, `no column-level GRANT for ${table}`).toBeTruthy();
			const granted = m![1].split(',').map((s) => s.trim());

			expect([...granted].sort()).toEqual([...expected].sort());
			expect(granted).toHaveLength(expected.length);
			for (const c of SECRET_COLS) expect(granted).not.toContain(c);

			// Order matters: the table-wide grant must be gone BEFORE the
			// column grant, or the column grant is a no-op inside the wider one.
			expect(active.indexOf(revoke)).toBeLessThan(active.indexOf(m![0]));
		}
	);

	it('keeps INSERT/UPDATE/DELETE as stage A left them, keeps service_role whole, reloads PostgREST', () => {
		expect(active).not.toMatch(/REVOKE\s+(ALL|INSERT|UPDATE|DELETE)/);
		expect(active).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE)/);
		expect(active).toContain('GRANT ALL ON TABLE public.user_api_keys TO service_role;');
		expect(active).toContain('GRANT ALL ON TABLE public.zernio_keys   TO service_role;');
		expect(active).toContain("NOTIFY pgrst, 'reload schema';");
		// Exactly one REVOKE and one column GRANT per table — nothing else touches SELECT.
		expect(active.match(/REVOKE SELECT ON TABLE/g)).toHaveLength(2);
		expect(active.match(/GRANT SELECT \(/g)).toHaveLength(2);
	});

	it('says the prerequisite is met, in the header', () => {
		expect(sql).toMatch(/PREREQUISITE IS NOW MET/);
		expect(sql).toContain('readStoredSecret');
	});
});

// ── 4. nothing in src/ would 42501 under stage B ─────────────────────────────

/** All .ts/.svelte source files under src/, specs excluded. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) sourceFiles(p, out);
		else if (/\.(ts|svelte)$/.test(name) && !/\.(spec|test)\.ts$/.test(name)) out.push(p);
	}
	return out;
}

describe('every query on the two secret tables survives stage B', () => {
	const files = sourceFiles(resolve(repoRoot, 'src'));
	expect(files.length).toBeGreaterThan(50);

	// The ONLY places allowed to name a secret column in a select-list: the two
	// readers that go through the service role.
	const SERVICE_READERS = ['src/lib/server/user-api-keys.ts', 'src/lib/server/zernio-keys.ts'].map((p) =>
		resolve(repoRoot, p)
	);

	/**
	 * Every LITERAL `.from('user_api_keys' | 'zernio_keys')` in src/ and the
	 * select-list of the chain that follows it: null = the chain has no
	 * .select at all (a DELETE, an UPDATE without RETURNING — fine), '*' =
	 * select('*') or a bare select() (both mean every column — would 42501).
	 * The two readers call `.from(table)` with a variable and are checked by
	 * source text below, not here.
	 */
	const sites: { file: string; table: string; select: string | null }[] = [];
	for (const file of files) {
		const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
		const re = /\.from\(['"](user_api_keys|zernio_keys)['"]\)/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text))) {
			// The chain ends at the first `;` — a select after that belongs to
			// the next statement.
			const chain = text.slice(m.index, text.indexOf(';', m.index));
			let select: string | null = null;
			const bare = chain.match(/\.select\(\s*\)/);
			const sel = chain.match(/\.select\(\s*(?:'([^']*)'|"([^"]*)"|([A-Z_]+))\s*\)/);
			if (bare) select = '*';
			else if (sel) {
				select = sel[1] ?? sel[2] ?? null;
				if (sel[3]) {
					// A named constant (KEY_META_COLUMNS) — resolve it in the same file.
					const c = text.match(new RegExp(`const ${sel[3]}\\s*=\\s*'([^']*)'`));
					select = c ? c[1] : `<${sel[3]}>`;
				}
				if (select === '') select = '*';
			}
			sites.push({ file, table: m[1], select });
		}
	}

	it('finds the query sites at all (both settings routes, both tables)', () => {
		expect(sites.length).toBeGreaterThanOrEqual(6);
		expect(sites.some((s) => s.file.endsWith(join('api', 'settings', 'api-keys', '+server.ts')))).toBe(true);
		expect(sites.some((s) => s.file.endsWith(join('api', 'settings', 'zernio-keys', '+server.ts')))).toBe(true);
		expect(sites.some((s) => s.table === 'user_api_keys' && s.select)).toBe(true);
		expect(sites.some((s) => s.table === 'zernio_keys' && s.select)).toBe(true);
		// The readers are NOT literal sites any more — that is the point.
		expect(sites.some((s) => SERVICE_READERS.includes(s.file))).toBe(false);
	});

	it('no select("*") / bare select() on either table anywhere in src/', () => {
		for (const s of sites) {
			expect(s.select, `${s.file}: select('*') / select() on ${s.table}`).not.toBe('*');
		}
	});

	it('no literal query site selects a secret column — only the service-routed readers do', () => {
		const secretSelects = sites.filter(
			(s) => s.select && SECRET_COLS.some((c) => s.select!.split(/\s*,\s*/).includes(c))
		);
		expect(
			secretSelects.map((s) => `${s.file}: ${s.select}`),
			'a secret column selected as `authenticated`'
		).toEqual([]);
		// …and every site that DOES select names only granted columns.
		const granted = new Set([...bootstrapColumnsOf('user_api_keys'), ...bootstrapColumnsOf('zernio_keys')]);
		for (const c of SECRET_COLS) granted.delete(c);
		const selecting = sites.filter((s) => s.select);
		expect(selecting.length).toBeGreaterThanOrEqual(4);
		for (const s of selecting) {
			for (const col of s.select!.split(/\s*,\s*/)) {
				expect(granted.has(col), `${s.file}: '${col}' is not a granted column`).toBe(true);
			}
		}
	});

	it('the service-routed readers select through secretReader(), not the passed client', () => {
		const text = readRepoText('src/lib/server/user-api-keys.ts');
		const fn = text.slice(text.indexOf('export async function readStoredSecret'));
		expect(fn).toMatch(/const db = secretReader\(supabase\);/);
		expect(fn).toMatch(/db\s*\.from\(table\)\s*\.select\(SECRET_COLUMNS\)/);
		expect(fn).not.toMatch(/supabase\s*\.from\(/);
		const z = readRepoText('src/lib/server/zernio-keys.ts');
		expect(z).not.toMatch(/\.select\(['"]encrypted_value/);
	});
});
