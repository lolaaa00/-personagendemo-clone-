/**
 * A wallet for every account — and only the route may put money in it.
 *
 * Two halves of one defect, proven separately.
 *
 * The DATABASE half is asserted against the migration TEXT, because the thing
 * under test is a PL/pgSQL trigger body: there is no module to call, and the
 * only way an assertion here can bite is by reading what will actually run.
 * The dangerous mutation is not "the wallet is missing" — that fails loudly —
 * it is "the wallet arrives FUNDED", which looks like a fix and quietly
 * reopens the hole signup_invite_credit_guard and signup_welcome_grant_moves
 * were written to close: anyone with the browser's anon key can POST
 * /auth/v1/signup and make this trigger fire.
 *
 * The ROUTE half is asserted by driving the real handler through the real
 * platform-admin gate against a fake database that models the one thing that
 * makes a double-click safe: the unique partial index on
 * credit_ledger.stripe_event_id.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── the migration text ───────────────────────────────────────────────────────

const supabaseDir = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase');
const MIGRATION = 'wallet_for_every_account_migration.sql';
const sql = readFileSync(join(supabaseDir, MIGRATION), 'utf8');

/** The trigger body only: everything between the function's dollar quotes. */
const fnStart = sql.indexOf('AS $$');
const fnEnd = sql.indexOf('$$;', fnStart);
/**
 * Comments are prose. A test that counts what the trigger DOES must not count
 * what it talks about — the wallet INSERT is commented "deliberately not
 * credit_apply()", and a naive scan reads that as a second money path.
 */
const fn = sql.slice(fnStart, fnEnd).replace(/--[^\n]*/g, '');

/** The single statement that opens the wallet, isolated from the rest. */
const walletStart = fn.indexOf('INSERT INTO public.credit_accounts');
const walletStatement = fn.slice(walletStart, fn.indexOf(';', walletStart) + 1);

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('handle_new_user() — the migration text that will run', () => {
	it('was located: an empty slice would pass every assertion below', () => {
		expect(fnStart).toBeGreaterThan(-1);
		expect(fnEnd).toBeGreaterThan(fnStart);
		expect(fn.length).toBeGreaterThan(500);
		expect(walletStart).toBeGreaterThan(-1);
	});

	it('still creates the profile', () => {
		expect(fn).toContain('INSERT INTO public.profiles (id, full_name)');
		expect(fn).toContain("NEW.raw_user_meta_data->>'full_name'");
		expect(fn).toContain('ON CONFLICT (id) DO NOTHING');
	});

	it('still creates the free subscription', () => {
		expect(fn).toContain('INSERT INTO public.subscriptions (user_id, plan, status)');
		expect(fn).toContain("VALUES (NEW.id, 'free', 'active')");
	});

	it('opens a wallet for every account, guarded and idempotent', () => {
		expect(walletStatement).toContain('INSERT INTO public.credit_accounts');
		expect(walletStatement).toContain('VALUES (NEW.id)');
		expect(walletStatement).toContain('ON CONFLICT (user_id) DO NOTHING');
	});

	it('opens it EMPTY — the statement names user_id and nothing else', () => {
		// A funded wallet is the mutation this file exists to catch. Any column
		// beyond user_id in the opening INSERT is money the trigger minted.
		expect(walletStatement).toMatch(/INSERT INTO public\.credit_accounts\s*\(\s*user_id\s*\)/);
		expect(walletStatement).not.toMatch(/balance_credits/);
		expect(walletStatement).not.toMatch(/billing_mode/);
		expect(walletStatement).not.toMatch(/credit_apply/);
	});

	it('the wallet is opened OUTSIDE the money block, so it cannot be swallowed', () => {
		// The welcome-grant block ends in `EXCEPTION WHEN OTHERS ... RAISE WARNING`.
		// A wallet opened inside it would fail silently, which is the shape of the
		// original defect.
		const exceptionAt = fn.indexOf('EXCEPTION WHEN OTHERS');
		const guardAt = fn.indexOf('IF NOT v_require THEN');
		expect(exceptionAt).toBeGreaterThan(-1);
		expect(guardAt).toBeGreaterThan(-1);
		expect(walletStart).toBeLessThan(guardAt);
		expect(walletStart).toBeLessThan(exceptionAt);
	});

	it('funds nothing: the one credit_apply is the welcome grant, still behind its guard', () => {
		// Exactly one money path in the whole function, and it is the one
		// signup_welcome_grant_moves left behind for the deliberate
		// signup_credits_require_invite = false case.
		expect(occurrences(fn, 'credit_apply(')).toBe(1);
		const guardAt = fn.indexOf('IF NOT v_require THEN');
		expect(guardAt).toBeGreaterThan(-1);
		const guarded = fn.slice(guardAt, fn.indexOf('EXCEPTION WHEN OTHERS'));
		expect(guarded).toContain('credit_apply(');
		expect(guarded).toContain("'welcome credits (signup)'");
		// The shared idempotency key welcome-guard.ts also sends.
		expect(guarded).toContain("'welcome:' || NEW.id::text");
	});

	it('keeps the definer hardening the other migrations use', () => {
		expect(sql).toContain('CREATE OR REPLACE FUNCTION public.handle_new_user()');
		expect(sql).toContain('SECURITY DEFINER');
		expect(sql).toContain('SET search_path = public');
		expect(sql).toContain('REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;');
	});

	it('says out loud that the wallet is opened at zero, and why', () => {
		const header = sql.slice(0, fnStart);
		expect(header).toMatch(/ZERO/);
		expect(header).toMatch(/anon key/i);
	});

	it('backfills the wallet-less accounts at zero, repeatably', () => {
		const backfill = sql.slice(fnEnd);
		expect(backfill).toContain('FROM auth.users u');
		expect(backfill).toContain('WHERE NOT EXISTS (SELECT 1 FROM public.credit_accounts a WHERE a.user_id = u.id)');
		expect(backfill).toContain('ON CONFLICT (user_id) DO NOTHING');
		// No balance, and no ledger row: opening an account is not a transaction.
		expect(backfill).not.toMatch(/balance_credits\s*[,)]/);
		expect(backfill).not.toContain('credit_ledger');
	});

	it('is registered, so it actually ships', () => {
		// migrations-coverage.spec.ts owns the general rule; this is the specific
		// one, because an unregistered file is a fix that never runs.
		const order: Array<[string, string]> = JSON.parse(
			readFileSync(join(supabaseDir, 'migrations.json'), 'utf8')
		);
		expect(order.map(([f]) => f)).toContain(MIGRATION);
		const bootstrap = readFileSync(join(supabaseDir, 'client_bootstrap.sql'), 'utf8');
		expect(bootstrap).toContain(MIGRATION);
		expect(bootstrap.slice(bootstrap.indexOf(MIGRATION))).toContain('INSERT INTO public.credit_accounts');
	});
});

// ── the admin funding route ──────────────────────────────────────────────────

const audit = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }));
const db = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/service-supabase', () => ({ getServiceSupabase: () => db.current }));
vi.mock('$lib/server/activity', () => ({
	logActivity: (_l: unknown, actor: string, e: Record<string, unknown>) =>
		audit.events.push({ actor, ...e })
}));

const route = await import('../../routes/api/admin/credits/+server');

/**
 * The database, reduced to the two facts that matter: credit_apply moves the
 * balance, and credit_ledger.stripe_event_id is UNIQUE — a replayed key aborts
 * the function, so the balance change rolls back with the ledger row.
 */
function fakeDb() {
	const wallets = new Map<string, number>();
	const keys = new Set<string>();
	const applied: Array<Record<string, unknown>> = [];
	return {
		wallets,
		applied,
		balanceOf: (u: string) => wallets.get(u) ?? 0,
		rpc: async (fnName: string, args: Record<string, unknown>) => {
			if (fnName !== 'credit_apply') return { data: null, error: null };
			const key = (args.p_stripe_event as string) ?? null;
			if (key && keys.has(key)) {
				return {
					data: null,
					error: {
						code: '23505',
						message:
							'duplicate key value violates unique constraint "idx_credit_ledger_stripe_event"'
					}
				};
			}
			const user = args.p_user as string;
			const before = wallets.get(user) ?? 0;
			const delta = args.p_kind === 'set' ? Number(args.p_delta) - before : Number(args.p_delta);
			wallets.set(user, before + delta);
			if (key) keys.add(key);
			applied.push({ ...args, resolved_delta: delta });
			return { data: before + delta, error: null };
		},
		from: (table: string) => ({
			select: () => ({
				eq: (_col: string, value: string) => ({
					maybeSingle: async () =>
						table === 'credit_accounts'
							? { data: { balance_credits: wallets.get(value) ?? 0 }, error: null }
							: { data: null, error: null }
				})
			})
		})
	};
}

function locals(user: { id: string; email?: string } | null, admin: boolean) {
	return {
		supabase: {
			rpc: async (name: string) =>
				name === 'is_platform_admin' ? { data: admin, error: null } : { data: null, error: null }
		},
		safeGetSession: async () => (user ? { session: { user }, user } : { session: null, user: null })
	};
}

const ADMIN = locals({ id: 'admin-1', email: 'ops@example.com' }, true);
const MEMBER = locals({ id: 'user-2', email: 'client@example.com' }, false);

const post = (body: unknown, l: unknown = ADMIN) =>
	(route.POST as unknown as (e: unknown) => Promise<Response>)({
		request: new Request('http://t/api/admin/credits', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		locals: l
	});

let current: ReturnType<typeof fakeDb>;
beforeEach(() => {
	current = fakeDb();
	db.current = current;
	audit.events = [];
});

describe('POST /api/admin/credits — the supported way to fund an account', () => {
	it('refuses a signed-out caller', async () => {
		const res = await post({ userId: 'u1', op: 'grant', credits: 1000, note: 'n' }, locals(null, false));
		expect(res.status).toBe(401);
		expect(current.applied).toHaveLength(0);
	});

	it('refuses a signed-in non-admin', async () => {
		const res = await post({ userId: 'u1', op: 'grant', credits: 1000, note: 'n' }, MEMBER);
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({ success: false });
		// The gate runs before anything reaches the database.
		expect(current.applied).toHaveLength(0);
		expect(current.balanceOf('u1')).toBe(0);
	});

	it('grants through credit_apply, with the admin as actor and an idempotency key', async () => {
		const res = await post({
			userId: 'u1',
			op: 'grant',
			credits: 1000,
			note: 'pilot account',
			idempotencyKey: 'click-1'
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ success: true, balance_credits: 1000 });
		expect(current.applied[0]).toMatchObject({
			p_user: 'u1',
			p_delta: 1000,
			p_kind: 'grant',
			p_actor: 'admin-1',
			p_allow_negative: false
		});
		expect(String(current.applied[0].p_stripe_event)).toContain('click-1');
	});

	it('a repeated grant with the same key does not double-credit', async () => {
		const body = { userId: 'u1', op: 'grant', credits: 1000, note: 'pilot account', idempotencyKey: 'click-1' };
		await post(body);
		const second = await post(body);
		expect(second.status).toBe(200);
		expect(await second.json()).toMatchObject({ success: true, duplicate: true, balance_credits: 1000 });
		// One row reached the ledger; the balance never moved twice.
		expect(current.applied).toHaveLength(1);
		expect(current.balanceOf('u1')).toBe(1000);
	});

	it('a deliberate second grant, with its own key, still lands', async () => {
		await post({ userId: 'u1', op: 'grant', credits: 1000, note: 'pilot', idempotencyKey: 'click-1' });
		await post({ userId: 'u1', op: 'grant', credits: 1000, note: 'pilot', idempotencyKey: 'click-2' });
		expect(current.balanceOf('u1')).toBe(2000);
		expect(current.applied).toHaveLength(2);
	});

	it('a caller that sends no key still cannot double-click into a double grant', async () => {
		// The console predates the field; the server fingerprints the operation so
		// the old client is not left unprotected.
		const body = { userId: 'u1', op: 'grant', credits: 1000, note: 'same click' };
		await post(body);
		const second = await post(body);
		expect(await second.json()).toMatchObject({ duplicate: true });
		expect(current.balanceOf('u1')).toBe(1000);
	});

	it('audits both the grant and the collapsed repeat', async () => {
		const body = { userId: 'u1', op: 'grant', credits: 1000, note: 'pilot', idempotencyKey: 'k' };
		await post(body);
		await post(body);
		expect(audit.events).toHaveLength(2);
		expect(audit.events[0]).toMatchObject({
			actor: 'admin-1',
			action: 'admin.credits.granted',
			actorKind: 'admin',
			targetUserId: 'u1',
			creditsDelta: 1000
		});
		// The repeat is recorded as having moved nothing — it did not.
		expect(audit.events[1]).toMatchObject({ action: 'admin.credits.granted', creditsDelta: 0 });
		expect(audit.events[1].meta).toMatchObject({ duplicate: true });
	});

	it('bounds a single grant', async () => {
		const res = await post({ userId: 'u1', op: 'grant', credits: 10_000_001, note: 'oops' });
		expect(res.status).toBe(400);
		expect(current.balanceOf('u1')).toBe(0);
	});

	it('still requires a note, a known op and a positive grant', async () => {
		expect((await post({ userId: 'u1', op: 'grant', credits: 1000 })).status).toBe(400);
		expect((await post({ userId: 'u1', op: 'mint', credits: 1000, note: 'n' })).status).toBe(400);
		expect((await post({ userId: 'u1', op: 'grant', credits: -5, note: 'n' })).status).toBe(400);
		expect(current.applied).toHaveLength(0);
	});
});
