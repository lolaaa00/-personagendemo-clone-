/** Atomic welcome-credit admission, independent of optional activity logging. */
import { createHmac } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { getServiceSupabase } from './service-supabase';
import { logSystemActivity } from './activity';
import { getSettings } from './settings';

export type WelcomeResult = 'granted' | 'capped' | 'ineligible' | 'off' | 'failed';

function addressHash(address: string, pepper: string): string {
	return createHmac('sha256', pepper).update(address).digest('hex');
}

/** Atomically check eligibility/cap, record the claim, and grant the credit. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- injectable untyped Supabase client
export async function grantWelcomeCredit(
	newUserId: string,
	clientAddress: string | null,
	client?: any
): Promise<WelcomeResult> {
	const settings = getSettings();
	const credits = Number(settings.signup_credits ?? 0);
	if (!newUserId || credits <= 0) return 'off';
	const pepper = String(
		env.ACTIVITY_PEPPER ?? process.env.ACTIVITY_PEPPER ?? settings.activity_pepper ?? ''
	);
	if (!clientAddress || pepper.length < 32) {
		console.warn('[welcome] credit withheld: trusted client address or hashing pepper unavailable');
		return 'failed';
	}
	try {
		const svc = client ?? getServiceSupabase();
		const { data, error } = await svc.rpc('signup_credit_grant_atomic', {
			p_user: newUserId,
			p_credits: credits,
			p_hourly_cap: Math.max(0, Number(settings.signup_credits_hourly_cap ?? 0)),
			p_address_hash: addressHash(clientAddress, pepper)
		});
		if (error) {
			console.warn('[welcome] atomic grant failed:', error.message);
			return 'failed';
		}
		const result = String(data ?? 'failed');
		if (result === 'granted' || result === 'duplicate') return 'granted';
		if (result === 'capped') {
			logSystemActivity({
				userId: newUserId,
				action: 'billing.welcome.withheld',
				outcome: 'ok',
				meta: { reason: 'hourly cap' }
			});
			return 'capped';
		}
		if (result === 'address_ineligible') {
			logSystemActivity({
				userId: newUserId,
				action: 'billing.welcome.withheld',
				outcome: 'ok',
				meta: { reason: 'one per address per day' }
			});
			return 'ineligible';
		}
		return 'failed';
	} catch (error) {
		console.warn('[welcome] atomic grant failed:', (error as Error).message);
		return 'failed';
	}
}
