/** Database-backed regression tests for atomic wallet operations.
 *
 * Run only against a disposable database whose full client_bootstrap.sql has
 * already been applied:
 *   TEST_DATABASE_URL=postgresql://... npm run test:integration
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const databaseUrl = process.env.TEST_DATABASE_URL ?? '';
const createdUsers: string[] = [];
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

function sql(statement: string): string {
	return execFileSync(
		'psql',
		['-d', databaseUrl, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', statement],
		{ encoding: 'utf8', env: { ...process.env, PGCONNECT_TIMEOUT: '5' } }
	).trim();
}

function sqlAsync(statement: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			'psql',
			['-d', databaseUrl, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', statement],
			{ env: { ...process.env, PGCONNECT_TIMEOUT: '5' } }
		);
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => (stdout += chunk));
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `psql exited ${code}`))
		);
	});
}

function addUser(): string {
	const id = randomUUID();
	createdUsers.push(id);
	sql(`INSERT INTO auth.users
		(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
		VALUES ('${id}','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
		'${id}@atomic.test','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb)`);
	return id;
}

function prepareSubscription(user: string, subscription: string, balance = 0, included = 0): void {
	sql(`UPDATE public.subscriptions SET plan='studio',status='active',stripe_subscription_id='${subscription}',
		included_credits=4000,last_credit_period_start=NULL,current_period_start=NULL WHERE user_id='${user}';
		UPDATE public.credit_accounts SET balance_credits=${balance},included_balance_credits=${included} WHERE user_id='${user}'`);
}

function renew(subscription: string, invoice: string, start: string, end: string): string {
	return sql(`SELECT public.subscription_renewal_atomic('${subscription}','${invoice}','${start}','${end}',4000)->>'result'`);
}

afterEach(() => {
	if (databaseUrl && createdUsers.length) {
		sql(`DELETE FROM auth.users WHERE id IN (${createdUsers.map((id) => `'${id}'`).join(',')})`);
		createdUsers.length = 0;
	}
});

describe.skipIf(!databaseUrl)('atomic credits (isolated PostgreSQL)', () => {
	it('preserves purchased credit and makes the exact invoice replay inert', () => {
		const user = addUser();
		const sub = `sub_${user}`;
		prepareSubscription(user, sub);
		expect(renew(sub, `in_jan_${user}`, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toBe('applied');
		sql(`SELECT public.credit_apply('${user}',-4000,'debit','spend allowance');
			SELECT public.credit_apply('${user}',2000,'purchase','paid pack')`);
		expect(renew(sub, `in_feb_${user}`, '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z')).toBe('applied');
		expect(renew(sub, `in_feb_${user}`, '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z')).toBe('duplicate');
		expect(
			sql(`SELECT balance_credits||'|'||included_balance_credits FROM public.credit_accounts WHERE user_id='${user}'`)
		).toBe('6000|4000');
	});

	it('credits invoice.paid even when a subscription status event stored that period first', () => {
		const user = addUser();
		const sub = `sub_${user}`;
		prepareSubscription(user, sub);
		expect(renew(sub, `in_jan_${user}`, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toBe('applied');
		sql(`UPDATE public.subscriptions SET current_period_start='2026-02-01T00:00:00Z',current_period_end='2026-03-01T00:00:00Z' WHERE user_id='${user}'`);
		expect(renew(sub, `in_feb_${user}`, '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z')).toBe('applied');
		expect(
			sql(`SELECT last_credit_period_start::date FROM public.subscriptions WHERE user_id='${user}'`)
		).toBe('2026-02-01');
	});

	it('rejects a distinct older invoice after a newer period without touching the wallet', () => {
		const user = addUser();
		const sub = `sub_${user}`;
		prepareSubscription(user, sub);
		expect(renew(sub, `in_feb_${user}`, '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z')).toBe('applied');
		expect(renew(sub, `in_jan_late_${user}`, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toBe('stale');
		expect(
			sql(`SELECT balance_credits||'|'||included_balance_credits FROM public.credit_accounts WHERE user_id='${user}'`)
		).toBe('4000|4000');
	});

	it('records a one-time conservative legacy classification without erasing credit', () => {
		const user = addUser();
		sql(`UPDATE public.credit_accounts SET balance_credits=2000,included_balance_credits=NULL WHERE user_id='${user}'`);
		expect(
			sql(`SELECT public.credit_classify_included('${user}',0,'History unavailable; preserve all as purchased credit',NULL)`)
		).toBe('0');
		expect(
			sql(`SELECT balance_at_classification||'|'||included_credits||'|'||purchased_credits FROM public.credit_bucket_classifications WHERE user_id='${user}'`)
		).toBe('2000|0|2000');
		expect(
			sql(`DO $$ BEGIN
				BEGIN
					PERFORM public.credit_classify_included('${user}',2000,'Unsafe second classification must fail',NULL);
					RAISE EXCEPTION 'classification unexpectedly succeeded';
				EXCEPTION WHEN OTHERS THEN
					IF SQLERRM NOT LIKE '%already classified%' THEN RAISE; END IF;
				END;
			END $$;
			SELECT count(*) FROM public.credit_bucket_classifications WHERE user_id='${user}'`)
		).toBe('1');
	});

	it('serializes spending with renewal and expires only the actual included remainder', async () => {
		const user = addUser();
		const sub = `sub_${user}`;
		prepareSubscription(user, sub);
		expect(renew(sub, `in_jan_${user}`, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toBe('applied');
		const spending = sqlAsync(`BEGIN; SELECT public.credit_apply('${user}',-1000,'debit','concurrent spend'); SELECT pg_sleep(0.5); COMMIT`);
		await new Promise((resolve) => setTimeout(resolve, 100));
		const renewal = sqlAsync(`SELECT public.subscription_renewal_atomic('${sub}','in_feb_${user}','2026-02-01T00:00:00Z','2026-03-01T00:00:00Z',4000)->>'result'`);
		await expect(Promise.all([spending, renewal])).resolves.toBeTruthy();
		expect(
			sql(`SELECT balance_credits||'|'||included_balance_credits FROM public.credit_accounts WHERE user_id='${user}'`)
		).toBe('4000|4000');
	});

	it('admits only one of two concurrent signups from the same address', async () => {
		const first = addUser();
		const second = addUser();
		const address = 'a'.repeat(64);
		const [a, b] = await Promise.all([
			sqlAsync(`SELECT public.signup_credit_grant_atomic('${first}',1000,20,'${address}')`),
			sqlAsync(`SELECT public.signup_credit_grant_atomic('${second}',1000,20,'${address}')`)
		]);
		expect([a, b].sort()).toEqual(['address_ineligible', 'granted']);
		expect(
			sql(`SELECT sum(balance_credits) FROM public.credit_accounts WHERE user_id IN ('${first}','${second}')`)
		).toBe('1000');
	});

	it('keeps the hourly cap atomic for concurrent signups from different addresses', async () => {
		const first = addUser();
		const second = addUser();
		// Remove claims created by earlier tests so cap=1 means one of this pair.
		sql('TRUNCATE public.signup_credit_claims');
		const [a, b] = await Promise.all([
			sqlAsync(`SELECT public.signup_credit_grant_atomic('${first}',1000,1,'${'b'.repeat(64)}')`),
			sqlAsync(`SELECT public.signup_credit_grant_atomic('${second}',1000,1,'${'c'.repeat(64)}')`)
		]);
		expect([a, b].sort()).toEqual(['capped', 'granted']);
		expect(
			sql(`SELECT sum(balance_credits) FROM public.credit_accounts WHERE user_id IN ('${first}','${second}')`)
		).toBe('1000');
	});

	it('rolls back event, wallet, ledger, and period together on a database failure', () => {
		const user = addUser();
		const sub = `sub_${user}`;
		prepareSubscription(user, sub);
		const result = sql(`BEGIN;
			CREATE FUNCTION pg_temp.reject_renewal_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced ledger failure'; END $$;
			CREATE TRIGGER reject_renewal_ledger BEFORE INSERT ON public.credit_ledger FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_renewal_ledger();
			DO $$ BEGIN
				BEGIN PERFORM public.subscription_renewal_atomic('${sub}','in_fail_${user}','2026-01-01T00:00:00Z','2026-02-01T00:00:00Z',4000);
				EXCEPTION WHEN OTHERS THEN NULL; END;
			END $$;
			SELECT ca.balance_credits||'|'||ca.included_balance_credits||'|'||
				(SELECT count(*) FROM public.billing_webhook_events WHERE event_key='invoice:in_fail_${user}')||'|'||
				COALESCE((SELECT last_credit_period_start::text FROM public.subscriptions WHERE user_id='${user}'),'null')
			FROM public.credit_accounts ca WHERE ca.user_id='${user}';
			ROLLBACK`);
		expect(result).toBe('0|0|0|null');
	});

	it('exposes money RPCs to service_role but not tenant roles', () => {
		for (const signature of [
			'public.credit_apply(uuid,bigint,text,text,uuid,uuid,uuid,uuid,text,bigint,boolean)',
			'public.subscription_renewal_atomic(text,text,timestamp with time zone,timestamp with time zone,bigint)',
			'public.signup_credit_grant_atomic(uuid,bigint,bigint,text)'
		]) {
			expect(sql(`SELECT has_function_privilege('service_role','${signature}','EXECUTE')`)).toBe('t');
			expect(sql(`SELECT has_function_privilege('authenticated','${signature}','EXECUTE')`)).toBe('f');
			expect(sql(`SELECT has_function_privilege('anon','${signature}','EXECUTE')`)).toBe('f');
		}
	});
});
