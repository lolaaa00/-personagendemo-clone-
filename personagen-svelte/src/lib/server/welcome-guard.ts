/**
 * Welcome-credit abuse guard by address — no PII.
 *
 * The signup trigger grants welcome credit to every new account (capped per
 * hour platform-wide). This closes the per-address hole: when a second
 * account is created from the same daily-salted IP hash within the same
 * activity day, the new account's welcome credit is taken back as an
 * audited adjustment. The user still gets an account; text posts stay free.
 *
 * Runs after the signup response is sent (hooks.server.ts), through the
 * service client; failures are logged and never affect the signup.
 */

import { getServiceSupabase } from './service-supabase';
import { logSystemActivity } from './activity';
import { getSettings } from './settings';

/** The note every welcome grant carries; maybeWithholdWelcome looks for it. */
const WELCOME_NOTE = 'welcome credits (signup)';

/**
 * Grant the welcome credit for an account the SIGNUP ROUTE created.
 *
 * This used to be the trigger's job alone. It cannot be: GoTrue writes the
 * auth.users row and only then applies app_metadata, so the trigger fires
 * before the invited marker exists and can never see it. Measured, not
 * assumed — an admin createUser with app_metadata lands the marker in
 * raw_app_meta_data and still left the wallet empty.
 *
 * So the gated route grants, which is the stronger arrangement anyway: an
 * account that never went through this route is never granted anything,
 * whatever it manages to put in its own metadata.
 *
 * The hourly cap is re-checked here because it moved with the grant. The
 * idempotency key means the trigger and this can never both land: whichever
 * runs first wins and the other is a no-op on the unique index.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Supabase client is untyped across this codebase; narrowing it here alone would be a fiction
export async function grantWelcomeCredit(newUserId: string, client?: any): Promise<'granted' | 'capped' | 'off' | 'failed'> {
	const s = getSettings();
	const credits = Number(s.signup_credits ?? 0);
	if (!newUserId || credits <= 0) return 'off';
	try {
		const svc = client ?? getServiceSupabase();
		const cap = Number(s.signup_credits_hourly_cap ?? 0);
		if (cap > 0) {
			const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
			const { count } = await svc
				.from('credit_ledger')
				.select('id', { count: 'exact', head: true })
				.eq('kind', 'grant')
				.like('note', 'welcome%')
				.gte('created_at', since);
			if (Number(count ?? 0) >= cap) {
				logSystemActivity({ userId: newUserId, action: 'billing.welcome.withheld', outcome: 'ok', meta: { reason: 'hourly cap', cap, recent: Number(count ?? 0) } });
				return 'capped';
			}
		}
		const { error } = await svc.rpc('credit_apply', {
			p_user: newUserId,
			p_delta: credits,
			p_kind: 'grant',
			p_note: WELCOME_NOTE,
			p_actor: null,
			p_event: null,
			p_post: null,
			p_agent: null,
			// Shared with the trigger: whoever lands first is the only one that does.
			p_stripe_event: `welcome:${newUserId}`,
			p_waived: 0,
			p_allow_negative: false
		});
		if (error && !/duplicate key|23505/.test(error.message ?? error.code ?? '')) {
			console.warn('[welcome] grant failed:', error.message);
			return 'failed';
		}
		return 'granted';
	} catch (e) {
		console.warn('[welcome] grant skipped:', (e as Error).message);
		return 'failed';
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Supabase client is untyped across this codebase; narrowing it here alone would be a fiction
export async function maybeWithholdWelcome(newUserId: string, ipHash: string | null, requestId: string | null, client?: any): Promise<'kept' | 'withheld' | 'skipped'> {
	if (!newUserId || !ipHash) return 'skipped';
	try {
		const svc = client ?? getServiceSupabase();
		const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
		let q = svc.from('user_activity_events').select('id', { count: 'exact', head: true }).eq('action', 'auth.signup').eq('ip_hash', ipHash).gte('occurred_at', since);
		if (requestId) q = q.neq('request_id', requestId);
		const { count, error } = await q;
		if (error || !(Number(count) >= 1)) return 'kept';

		const [{ data: grant }, { data: wallet }] = await Promise.all([
			svc.from('credit_ledger').select('delta').eq('user_id', newUserId).eq('kind', 'grant').like('note', 'welcome%').limit(1).maybeSingle(),
			svc.from('credit_accounts').select('balance_credits').eq('user_id', newUserId).maybeSingle()
		]);
		const granted = Number(grant?.delta ?? 0);
		const balance = Number(wallet?.balance_credits ?? 0);
		const take = Math.min(granted, balance);
		if (take <= 0) return 'kept';

		const { error: applyErr } = await svc.rpc('credit_apply', {
			p_user: newUserId,
			p_delta: -take,
			p_kind: 'adjustment',
			p_note: 'welcome credit withheld: another account was created from this address today',
			p_actor: null,
			p_event: null,
			p_post: null,
			p_agent: null,
			p_stripe_event: `welcome-withheld:${newUserId}`,
			p_waived: 0,
			p_allow_negative: false
		});
		if (applyErr && !/duplicate key|23505/.test(applyErr.message ?? applyErr.code ?? '')) {
			console.warn('[welcome-guard] adjustment failed:', applyErr.message);
			return 'kept';
		}
		logSystemActivity({ userId: newUserId, action: 'billing.welcome.withheld', outcome: 'ok', creditsDelta: -take, meta: { prior_signups_same_address: Number(count), withheld: take } });
		return 'withheld';
	} catch (e) {
		console.warn('[welcome-guard] skipped:', (e as Error).message);
		return 'skipped';
	}
}
