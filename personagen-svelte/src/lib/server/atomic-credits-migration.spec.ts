import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
	new URL('../../../supabase/atomic_credits_migration.sql', import.meta.url),
	'utf8'
);
const renewal = sql.slice(
	sql.indexOf('CREATE OR REPLACE FUNCTION public.subscription_renewal_atomic'),
	sql.indexOf('CREATE OR REPLACE FUNCTION public.signup_credit_grant_atomic')
);
const signup = sql.slice(
	sql.indexOf('CREATE OR REPLACE FUNCTION public.signup_credit_grant_atomic')
);

describe('atomic credit migration contract', () => {
	it('does not guess allocation for existing positive wallets', () => {
		expect(sql).toMatch(/included_balance_credits IS NULL AND balance_credits=0/);
		expect(sql).toContain('credit_classify_included');
		expect(renewal).toContain('INCLUDED_CREDIT_CLASSIFICATION_REQUIRED');
	});

	it('preserves purchased credit after included credit is spent', () => {
		expect(sql).toContain("p_kind='debit' AND p_delta<0");
		expect(sql).toContain('v_included:=GREATEST(0,v_included-(-p_delta))');
		expect(renewal).toContain('v_new:=v_balance-v_remaining+p_included');
	});

	it('makes exact invoice replay inert before any second wallet mutation', () => {
		const eventInsert = renewal.indexOf('INSERT INTO public.billing_webhook_events');
		const duplicateReturn = renewal.indexOf("'result','duplicate'");
		const walletUpdate = renewal.indexOf('UPDATE public.credit_accounts');
		expect(eventInsert).toBeGreaterThan(0);
		expect(duplicateReturn).toBeGreaterThan(eventInsert);
		expect(walletUpdate).toBeGreaterThan(duplicateReturn);
	});

	it('serializes renewal with concurrent spending and updates the period in the same transaction', () => {
		expect(renewal).toMatch(/subscriptions[\s\S]*FOR UPDATE/);
		expect(renewal).toMatch(/credit_accounts[\s\S]*FOR UPDATE/);
		expect(renewal).toContain('current_period_start=p_period_start');
		expect(sql).toMatch(/credit_apply[\s\S]*credit_accounts WHERE user_id=p_user FOR UPDATE/);
	});

	it('rejects out-of-order periods without touching the wallet', () => {
		const stale = renewal.indexOf('p_period_start<=v_sub.current_period_start');
		const wallet = renewal.indexOf('UPDATE public.credit_accounts');
		expect(stale).toBeGreaterThan(0);
		expect(wallet).toBeGreaterThan(stale);
	});

	it('serializes concurrent signup cap checks and is independent of activity rows', () => {
		expect(signup).toContain('pg_advisory_xact_lock');
		expect(signup).toContain('signup_credit_claims');
		expect(signup).not.toContain('user_activity_events');
	});
});
