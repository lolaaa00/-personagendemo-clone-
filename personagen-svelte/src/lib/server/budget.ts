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
import { assertCreditsAvailable, resolveBillingAccount } from './credits';

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

// PostgREST silently truncates result sets at the server's max-rows setting
// (often 1000) — a truncated ledger read would silently UNDERCOUNT spend. An
// explicit high limit makes the ceiling ours and detectable: if we get exactly
// this many rows back, the sum may be short and we log it.
const LEDGER_ROW_LIMIT = 100000;

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
		.gte('created_at', sinceIso)
		.limit(LEDGER_ROW_LIMIT);
	// Fail OPEN on a ledger read error (don't block generation because analytics
	// is down) — but the caps still catch the sustained-spend case on later ticks.
	// Log LOUDLY so a broken ledger (= no budget enforcement) is diagnosable.
	if (error) {
		console.error(
			`[budget] generation_events ledger read FAILED for ${column}=${value} — failing OPEN (no spend cap enforced this call): ${
				error.message ?? JSON.stringify(error)
			}`
		);
		return 0;
	}
	const rows = data || [];
	if (rows.length >= LEDGER_ROW_LIMIT) {
		console.warn(
			`[budget] ledger returned ${rows.length} rows for ${column}=${value}, equal to the query limit — the spend sum may UNDERCOUNT (rows beyond the limit were truncated).`
		);
	}
	return rows.reduce((s: number, r: any) => s + (Number(r.est_cost) || 0), 0);
}

/**
 * Per-seat workspace cap: if this user generates against a workspace persona
 * as a MEMBER seat (owners never have a membership row, so they're never
 * capped here) and that seat has spend_limit_usd configured (Settings → Team),
 * their calendar-month spend across the workspace's personas must stay under
 * it. Fails OPEN on read errors, same policy as the env caps above.
 */
async function seatCapExceeded(
	supabase: any,
	userId: string,
	agentId: string,
	monthlySinceIso: string
): Promise<string | null> {
	try {
		const { data: agent } = await supabase
			.from('agents')
			.select('workspace_id')
			.eq('id', agentId)
			.maybeSingle();
		if (!agent?.workspace_id) return null;

		const { data: seat } = await supabase
			.from('workspace_members')
			.select('spend_limit_usd')
			.eq('workspace_id', agent.workspace_id)
			.eq('user_id', userId)
			.maybeSingle();
		const cap = Number(seat?.spend_limit_usd);
		if (!seat || seat.spend_limit_usd === null || !Number.isFinite(cap) || cap < 0) return null;

		const { data: wsAgents } = await supabase
			.from('agents')
			.select('id')
			.eq('workspace_id', agent.workspace_id);
		const wsAgentIds = (wsAgents ?? []).map((a: any) => a.id);
		if (wsAgentIds.length === 0) return null;

		const { data: rows, error } = await supabase
			.from('generation_events')
			.select('est_cost')
			.eq('user_id', userId)
			.in('agent_id', wsAgentIds)
			.gte('created_at', monthlySinceIso)
			.limit(LEDGER_ROW_LIMIT);
		if (error) {
			console.error(
				`[budget] seat-cap ledger read FAILED for user=${userId} — failing OPEN: ${error.message}`
			);
			return null;
		}
		const spent = (rows ?? []).reduce((s: number, r: any) => s + (Number(r.est_cost) || 0), 0);
		if (spent >= cap) {
			return `Your monthly generation budget for this workspace is used up ($${spent.toFixed(2)} of the $${cap.toFixed(2)} limit set by your workspace admin). Ask them to raise your limit in Settings → Team.`;
		}
		return null;
	} catch (e) {
		console.error('[budget] seat-cap check failed — failing OPEN:', (e as Error).message);
		return null;
	}
}

/**
 * Throws a "budget"-worded error when another paid generation would exceed the
 * per-user monthly or per-agent daily ceiling. The autopilot treats a "budget"
 * message as a hard stop for that agent this run (see autopilot.ts).
 */
export async function assertWithinBudget(
	supabase: any,
	userId: string,
	agentId?: string,
	/**
	 * Retail credits this run is expected to cost. Callers that can quote
	 * (generate-post's synchronous precheck) pass the real estimate so a thin
	 * wallet cannot start a $3.50 cinematic pack; the inner gate inside the
	 * generation path passes nothing and only rejects an empty wallet.
	 */
	requiredCredits: number = 1
): Promise<void> {
	const monthlyCap = MONTHLY_PER_USER_USD();
	const dailyCap = DAILY_PER_AGENT_USD();
	const checkMonthly = monthlyCap > 0 && !!userId;
	const checkDaily = dailyCap > 0 && !!agentId;

	const monthlySince = new Date();
	monthlySince.setUTCDate(1);
	monthlySince.setUTCHours(0, 0, 0, 0);
	const dailySince = new Date();
	dailySince.setUTCHours(0, 0, 0, 0);

	// The ledger sums are independent — run them concurrently rather than
	// serialising round-trips on the hot generation path.
	const [monthlySpent, dailySpent, seatCapMessage] = await Promise.all([
		checkMonthly
			? sumSpend(supabase, 'user_id', userId, monthlySince.toISOString())
			: Promise.resolve(0),
		checkDaily
			? sumSpend(supabase, 'agent_id', agentId!, dailySince.toISOString())
			: Promise.resolve(0),
		userId && agentId
			? seatCapExceeded(supabase, userId, agentId, monthlySince.toISOString())
			: Promise.resolve(null)
	]);

	if (seatCapMessage) {
		throw new Error(seatCapMessage);
	}

	if (checkMonthly && monthlySpent >= monthlyCap) {
		throw new Error(
			`Monthly generation budget reached ($${monthlySpent.toFixed(2)} of $${monthlyCap} cap). Raise MAX_MONTHLY_SPEND_PER_USER_USD to continue.`
		);
	}

	if (checkDaily && dailySpent >= dailyCap) {
		throw new Error(
			`Daily generation budget reached for this persona ($${dailySpent.toFixed(2)} of $${dailyCap} cap). Raise MAX_DAILY_SPEND_PER_AGENT_USD to continue.`
		);
	}

	// Credits gate (CREDITS_ENFORCE): the billing account must hold a positive
	// balance before any paid call starts. This is the inner, fail-closed check
	// that every generation path reaches; the synchronous precheck in
	// generate-post quotes the real estimate. No-op when credits are off; in
	// shadow it only records who WOULD be blocked. Runs after the USD caps so a
	// runaway loop is still stopped by them even with credits disabled.
	if (userId) {
		const billed = await resolveBillingAccount(supabase, agentId ?? null, userId);
		const need = Number.isFinite(requiredCredits) && requiredCredits > 1 ? Math.ceil(requiredCredits) : 1;
		await assertCreditsAvailable(supabase, billed, need);
	}
}
