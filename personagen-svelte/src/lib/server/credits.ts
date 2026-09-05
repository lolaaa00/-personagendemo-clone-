/**
 * Credits — the wallet layer on top of the generation_events receipt ledger.
 *
 * Unit: 1 credit = 1 cent of ESTIMATED provider cost. creditsFor() is the only
 * conversion; margin lives in what a Stripe pack costs, never here.
 *
 * Modes (flags.ts → CREDITS_ENFORCE):
 *   off      nothing here touches the database — today's behaviour
 *   shadow   debits are written (allow-negative) so the ledger is real, but
 *            assertCreditsAvailable() never throws
 *   enforce  fail-closed: insufficient credits block before the first paid
 *            call; a DB error during the gate is a block, never a pass
 *
 * Billing account: the workspace owner for a workspace persona, else the
 * persona's owner, else the actor. Debits are keyed to the generation event
 * (unique index) so a retried write can never charge twice.
 */

import { getServiceSupabase } from './service-supabase';
import { creditsMode, type CreditsMode } from './flags';

export const CREDITS_PER_USD = 100;

/** ceil(usd × 100); non-positive or non-finite → 0. */
export function creditsFor(usd: number): number {
	const n = Number(usd);
	if (!Number.isFinite(n) || n <= 0) return 0;
	// Round to 6 dp first so 0.0800000001-style float noise doesn't add a credit.
	return Math.ceil(+(n * CREDITS_PER_USD).toFixed(6));
}

export type KeySource = 'platform' | 'byo' | 'none';

/** Providers that bill a key; everything else (local, storage) is 'none'. */
const KEYED_PROVIDERS: Record<string, string> = {
	fal: 'fal_ai',
	openrouter: 'openrouter',
	gemini: 'gemini',
	firecrawl: 'firecrawl'
};

/**
 * Which key paid the provider for this actor. Mirrors the resolution order in
 * resolveImageKeys()/resolveAiClient(): a stored user key wins over the env
 * key. Reads only key METADATA (no decrypt). Unknown → 'platform' (charge) —
 * the safe direction for revenue; the ledger stays inspectable either way.
 */
export async function keySourceFor(
	supabase: any,
	userId: string,
	provider: string,
	cache?: Map<string, KeySource>
): Promise<KeySource> {
	const keyed = KEYED_PROVIDERS[provider];
	if (!keyed) return 'none';
	const k = `${userId}:${keyed}`;
	if (cache?.has(k)) return cache.get(k)!;
	let src: KeySource = 'platform';
	try {
		const { data } = await supabase
			.from('user_api_keys')
			.select('provider')
			.eq('user_id', userId)
			.eq('provider', keyed)
			.maybeSingle();
		if (data) src = 'byo';
	} catch {
		/* unknown → platform */
	}
	cache?.set(k, src);
	return src;
}

function serviceOr(supabase: any): any {
	try {
		return getServiceSupabase();
	} catch {
		return supabase;
	}
}

/** Workspace owner for a workspace persona, else the persona owner, else the actor. */
export async function resolveBillingAccount(
	supabase: any,
	agentId: string | null | undefined,
	actorId: string
): Promise<string> {
	if (!agentId) return actorId;
	try {
		const db = serviceOr(supabase);
		const { data: agent } = await db
			.from('agents')
			.select('user_id, workspace_id')
			.eq('id', agentId)
			.maybeSingle();
		if (!agent) return actorId;
		if (agent.workspace_id) {
			const { data: ws } = await db
				.from('workspaces')
				.select('owner_id')
				.eq('id', agent.workspace_id)
				.maybeSingle();
			if (ws?.owner_id) return ws.owner_id;
		}
		return agent.user_id || actorId;
	} catch {
		return actorId;
	}
}

export interface DebitRow {
	id: string;
	credits: number;
	provider: string;
	operation: string;
	model?: string | null;
	key_source: KeySource;
}

export interface DebitOutcome {
	mode: CreditsMode;
	attempted: number;
	debited: number;
	skippedDuplicate: number;
	failed: string[];
}

/**
 * One credit_apply() per platform-paid event, allow-negative (the money was
 * already spent; the wallet must reflect it even if it goes below zero — the
 * gate stops the NEXT generation). Duplicate-event debits are treated as
 * already applied. Returns an outcome; throws only in 'enforce' when a debit
 * failed for a reason other than duplication (the caller marks the job failed).
 */
export async function debitForEvents(
	supabase: any,
	args: {
		billedUserId: string;
		actorId: string;
		agentId?: string | null;
		postId?: string | null;
		rows: DebitRow[];
	}
): Promise<DebitOutcome> {
	const mode = creditsMode();
	const out: DebitOutcome = { mode, attempted: 0, debited: 0, skippedDuplicate: 0, failed: [] };
	if (mode === 'off') return out;
	const service = serviceOr(supabase);
	for (const r of args.rows) {
		if (r.key_source !== 'platform' || r.credits <= 0) continue;
		out.attempted++;
		const { error } = await service.rpc('credit_apply', {
			p_user: args.billedUserId,
			p_delta: -r.credits,
			p_kind: 'debit',
			p_note: `${r.provider}/${r.operation}${r.model ? ` ${r.model}` : ''}`,
			p_actor: args.actorId,
			p_event: r.id,
			p_post: args.postId ?? null,
			p_agent: args.agentId ?? null,
			p_stripe_event: null,
			p_waived: 0,
			p_allow_negative: true
		});
		if (!error) {
			out.debited += r.credits;
			continue;
		}
		if (error.code === '23505' || /duplicate key|idx_credit_ledger_debit_per_event/i.test(error.message ?? '')) {
			out.skippedDuplicate++;
			continue;
		}
		out.failed.push(`${r.id}: ${error.message ?? error.code ?? 'unknown'}`);
	}
	if (out.failed.length) {
		const msg = `[credits] ${out.failed.length}/${out.attempted} debit(s) FAILED for billed=${args.billedUserId}: ${out.failed.join('; ')}`;
		if (mode === 'enforce') throw new Error(`CREDIT_DEBIT_FAILED: ${msg}`);
		console.error(msg);
	}
	return out;
}

export class InsufficientCreditsError extends Error {
	code = 'INSUFFICIENT_CREDITS' as const;
	constructor(
		public balance: number,
		public required: number
	) {
		super(
			`Not enough credits: this generation needs about ${required} and the account has ${balance}. Add credits in Settings → Billing, or ask your workspace owner to.`
		);
		this.name = 'InsufficientCreditsError';
	}
}

/** True for the message text the gate throws (autopilot treats it as a hard stop). */
export function isCreditsError(err: unknown): boolean {
	return err instanceof InsufficientCreditsError || /INSUFFICIENT_CREDITS|Not enough credits/i.test(String((err as any)?.message ?? err));
}

/**
 * Gate. off → no-op. shadow → reads, logs a would-block, never throws.
 * enforce → throws InsufficientCreditsError when balance < required, and
 * throws on a DB error too (fail closed). Accounts in 'unmetered' mode pass.
 */
export async function assertCreditsAvailable(
	supabase: any,
	billedUserId: string,
	requiredCredits: number
): Promise<{ balance: number | null; mode: CreditsMode; wouldBlock: boolean }> {
	const mode = creditsMode();
	if (mode === 'off' || !billedUserId) return { balance: null, mode, wouldBlock: false };
	const service = serviceOr(supabase);
	const { data, error } = await service
		.from('credit_accounts')
		.select('balance_credits, billing_mode')
		.eq('user_id', billedUserId)
		.maybeSingle();
	if (error) {
		if (mode === 'enforce') {
			throw new Error(`CREDITS_UNAVAILABLE: could not read the credit balance (${error.message}). Generation is paused until billing is reachable.`);
		}
		console.error('[credits] balance read failed in shadow mode:', error.message);
		return { balance: null, mode, wouldBlock: false };
	}
	// No wallet yet = balance 0 (the wallet is created on first debit/grant).
	const balance = Number(data?.balance_credits ?? 0);
	if (data?.billing_mode === 'unmetered') return { balance, mode, wouldBlock: false };
	const required = Math.max(0, Math.ceil(requiredCredits || 0));
	const wouldBlock = balance < required && required > 0 ? true : balance <= 0 && required === 0 ? false : balance < required;
	if (!wouldBlock) return { balance, mode, wouldBlock: false };
	if (mode === 'enforce') throw new InsufficientCreditsError(balance, required);
	console.warn(`[credits] shadow: would block billed=${billedUserId} balance=${balance} required=${required}`);
	return { balance, mode, wouldBlock: true };
}
