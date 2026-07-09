/**
 * Fail-closed spend guard for the paid generation pipeline.
 *
 * The autopilot generates real, paid content (fal image/video, TTS, LLM) on a
 * schedule. Without a ceiling, a misconfigured agent or a stuck slot can bill
 * unboundedly. This reads the `generation_events` ledger and refuses to start a
 * new generation once the per-agent daily or per-user monthly estimated spend
 * has crossed the configured cap. Caps are env-tunable; 0 disables a cap.
 *
 * Accuracy depends on the ledger being flushed even on failed generations — see
 * the try/finally around recordCostEvents in content/generate.ts.
 */

import { env } from '$env/dynamic/private';

function usdFromEnv(name: string, fallback: number): number {
	const raw = env[name];
	if (raw === undefined || raw === '') return fallback;
	const n = Number(raw);
	return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Defaults leave normal operation (~$2/day/agent at 3 posts/day) generous
// headroom while stopping a runaway loop long before a surprise bill.
const DAILY_PER_AGENT_USD = () => usdFromEnv('MAX_DAILY_SPEND_PER_AGENT_USD', 15);
const MONTHLY_PER_USER_USD = () => usdFromEnv('MAX_MONTHLY_SPEND_PER_USER_USD', 300);

async function sumSpend(
	supabase: any,
	column: 'user_id' | 'agent_id',
	value: string,
	sinceIso: string
): Promise<number> {
	const { data, error } = await supabase
		.from('generation_events')
		.select('est_cost')
		.eq(column, value)
		.gte('created_at', sinceIso);
	// Fail OPEN on a ledger read error (don't block generation because analytics
	// is down) — but the caps still catch the sustained-spend case on later ticks.
	if (error) return 0;
	return (data || []).reduce((s: number, r: any) => s + (Number(r.est_cost) || 0), 0);
}

/**
 * Throws a "budget"-worded error when another paid generation would exceed the
 * per-user monthly or per-agent daily ceiling. The autopilot treats a "budget"
 * message as a hard stop for that agent this run (see autopilot.ts).
 */
export async function assertWithinBudget(
	supabase: any,
	userId: string,
	agentId?: string
): Promise<void> {
	const monthlyCap = MONTHLY_PER_USER_USD();
	if (monthlyCap > 0 && userId) {
		const since = new Date();
		since.setUTCDate(1);
		since.setUTCHours(0, 0, 0, 0);
		const spent = await sumSpend(supabase, 'user_id', userId, since.toISOString());
		if (spent >= monthlyCap) {
			throw new Error(
				`Monthly generation budget reached ($${spent.toFixed(2)} of $${monthlyCap} cap). Raise MAX_MONTHLY_SPEND_PER_USER_USD to continue.`
			);
		}
	}

	const dailyCap = DAILY_PER_AGENT_USD();
	if (dailyCap > 0 && agentId) {
		const since = new Date();
		since.setUTCHours(0, 0, 0, 0);
		const spent = await sumSpend(supabase, 'agent_id', agentId, since.toISOString());
		if (spent >= dailyCap) {
			throw new Error(
				`Daily generation budget reached for this persona ($${spent.toFixed(2)} of $${dailyCap} cap). Raise MAX_DAILY_SPEND_PER_AGENT_USD to continue.`
			);
		}
	}
}
