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
