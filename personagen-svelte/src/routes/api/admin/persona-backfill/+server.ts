import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePlatformAdmin } from '$lib/server/platform-admin';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { logActivity } from '$lib/server/activity';
import { readPersonaProfileV2, serializePersonaProfileV2 } from '$lib/persona-contract/store';
import { leafPaths, getPath, type Obj } from '$lib/persona-contract/paths';
import { backfillTier1, TIER_1_DERIVED_LEAVES } from '$lib/server/persona/backfill';
import { hasV2OnlyLookAttributes, lookToPromptClause } from '$lib/persona-contract/look-prompt';
import {
	backfillTier2,
	hasReconcilableProse,
	reconciliationPrompt,
	tier2AlreadyDone
} from '$lib/server/persona/backfill-tier2';
import { resolveAiClient } from '$lib/server/ai-client';
import { meteredAiClient } from '$lib/server/metering';
import type { PersonaProfileV2 } from '$lib/persona-contract/schema';

/**
 * Persona Model v2 — the silent backfill, run as an operation rather than a script.
 *
 * WHY THIS IS AN ENDPOINT AND NOT A CLI. The action plan assumed
 * `scripts/backfill-persona-v2.ts` would import `backfillTier1` directly. It
 * cannot: every script in this repo runs under `node --experimental-strip-types`,
 * which resolves no `$lib` alias and requires explicit ESM extensions, and every
 * existing script is self-contained — none imports app library code, so there is
 * no pattern to copy. The two options recorded at the time were "relative
 * imports everywhere" (invasive, fights the SvelteKit convention) and
 * "add vite-node" (a new dependency on an ops path).
 *
 * Both are worse than putting the operation where the code already lives. The
 * app resolves its own aliases, already holds the service client, and — when
 * Tier 2 arrives — already holds the budget gate, the credit gate and the
 * generation-events ledger that P1.7 requires every paid backfill call to pass
 * through. A CLI would have to reimplement all of that or reach around it. So
 * the operation runs here, behind the platform-admin gate, and
 * `scripts/backfill-persona-v2.mjs` is a thin HTTP client like every other
 * script in this repo.
 *
 *   POST /api/admin/persona-backfill
 *     { mode: 'shadow' | 'fill', limit?: number, agentId?: string }
 *
 * `shadow` READS ONLY. It reports exactly what `fill` would write and changes
 * nothing, which is the whole point: the gate to `fill` is a shadow report with
 * zero contradictions, and a shadow run that could accidentally write would be
 * no gate at all.
 *
 * Tier 1 only. It is a pure function of data the profile already holds — no
 * sampling, no extraction, no model call, no spend — so this endpoint makes no
 * provider request and debits nothing. `tier` is accepted and validated so
 * Tier 2 can be added here later without a second route, but a request for any
 * tier above 1 is refused rather than silently downgraded: quietly doing less
 * than you were asked is how an operator concludes a backfill ran when it did not.
 */

/** Hard ceiling per request, so one call cannot walk an unbounded table. */
const MAX_LIMIT = 2000;
const DEFAULT_LIMIT = 500;
/** Per-agent detail is capped; the counts are always complete. */
const MAX_DETAIL = 200;

interface AgentRow {
	id: string;
	name: string | null;
	user_id: string;
	personas_profile: unknown;
	market?: unknown;
}

interface AgentOutcome {
	agentId: string;
	name: string | null;
	/** Leaf paths Tier 1 added, with the value it derived. */
	added: { path: string; value: unknown }[];
	/** True when the stored blob was v1 and reading it upgraded the shape. */
	upgraded: boolean;
	written: boolean;
	/** Tier 2 only: leaves read off the persona's own prose. */
	extracted?: string[];
	/** Tier 2 only: answer fields discarded because they were not real values. */
	rejected?: string[];
	/** Tier 2 only: why no model ran for this persona, when none did. */
	noModel?: string;
	error?: string;
}

/**
 * Leaves present in `after` that were absent in `before`, plus any whose value
 * moved. Tier 1 is only allowed to ADD or recompute its own derived leaves, so
 * anything outside `TIER_1_DERIVED_LEAVES` appearing here is a bug in the
 * backfill, not a finding about the persona — the caller reports it as such.
 */
function addedLeaves(
	before: PersonaProfileV2,
	after: PersonaProfileV2
): { path: string; value: unknown }[] {
	const b = before as unknown as Obj;
	const a = after as unknown as Obj;
	const out: { path: string; value: unknown }[] = [];
	for (const path of leafPaths(a)) {
		if (path.startsWith('meta.')) continue; // bookkeeping, not a persona fact
		const beforeValue = JSON.stringify(getPath(b, path) ?? null);
		const afterValue = JSON.stringify(getPath(a, path) ?? null);
		if (beforeValue !== afterValue) out.push({ path, value: getPath(a, path) });
	}
	return out;
}

/**
 * Parses a model's answer, tolerating the code fence it was told not to use.
 * Returns undefined rather than throwing: an unparseable answer is a persona
 * that gets no extraction, not a run that dies halfway through the table.
 */
function safeJson(text: string): unknown {
	const cleaned = text
		.trim()
		.replace(/^```(?:json)?/i, '')
		.replace(/```$/, '')
		.trim();
	const start = cleaned.indexOf('{');
	const end = cleaned.lastIndexOf('}');
	if (start < 0 || end <= start) return undefined;
	try {
		return JSON.parse(cleaned.slice(start, end + 1));
	} catch {
		return undefined;
	}
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const gate = await requirePlatformAdmin(locals);
	if (!gate.ok) return json({ success: false, error: gate.message }, { status: gate.status });

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

	const mode = body.mode === 'fill' ? 'fill' : body.mode === 'shadow' ? 'shadow' : null;
	if (!mode) {
		return json({ success: false, error: "mode must be 'shadow' or 'fill'" }, { status: 400 });
	}

	const tier = body.tier === undefined ? 1 : Number(body.tier);
	if (tier !== 1 && tier !== 2) {
		return json(
			{
				success: false,
				error: `tier ${tier} does not exist; tiers are 1 (free, derived) and 2 (paid, extraction)`
			},
			{ status: 400 }
		);
	}

	const limit = Math.min(
		MAX_LIMIT,
		Math.max(1, Number.isFinite(Number(body.limit)) ? Number(body.limit) : DEFAULT_LIMIT)
	);
	const agentId =
		typeof body.agentId === 'string' && body.agentId.trim() ? body.agentId.trim() : null;

	const svc = getServiceSupabase();
	let query = svc
		.from('agents')
		.select('id, name, user_id, personas_profile, market')
		.order('created_at', { ascending: true })
		.limit(limit);
	if (agentId) query = query.eq('id', agentId);

	const { data, error } = await query;
	if (error) {
		return json({ success: false, error: `agent read failed: ${error.message}` }, { status: 500 });
	}

	const rows = (data ?? []) as AgentRow[];
	const outcomes: AgentOutcome[] = [];
	const addedByPath: Record<string, number> = {};
	/** Anything Tier 1 touched that it has no business touching. */
	const violations: string[] = [];
	/**
	 * Personas whose PORTRAIT PROMPT this pass would change.
	 *
	 * Tier 1 is supposed to be invisible, and "invisible" has to include the
	 * images. The portrait builders pick the v2 appearance clause only when the
	 * look holds an attribute the v1 record cannot express, so the way a backfill
	 * could silently change a face is by flipping that condition — or by moving
	 * the clause for a look that already met it. Both are measured here rather
	 * than reasoned about, because "promptCues is not in that key list" is an
	 * argument, and an argument is not a report.
	 */
	const promptDrift: string[] = [];
	const startedAt = new Date().toISOString();
	let changed = 0;
	let written = 0;
	let failed = 0;

	for (const row of rows) {
		try {
			// readPersonaProfileV2 upgrades a v1 blob IN MEMORY. That upgrade is what
			// any ordinary save already performs, so it is not a change this backfill
			// invents — but it is reported separately, because "we upgraded 400
			// personas" and "we derived 12 fields" are different facts and an
			// operator deserves both.
			const before = readPersonaProfileV2(row);
			const upgraded = before.meta?.upgradedFrom === 1;

			let after = backfillTier1(before);
			let extracted: string[] | undefined;
			let rejected: string[] | undefined;
			let noModel: string | undefined;

			if (tier === 2 && !tier2AlreadyDone(before)) {
				// A persona with no prose has nothing to extract, so no call is made
				// and nothing is spent. Tier 2 still completes it by sampling under
				// the facts already on record.
				let answer: unknown;
				if (!hasReconcilableProse(before)) {
					noModel = 'no prose to read';
				} else {
					// The persona's OWNER pays, with their own key when they have one —
					// this is a paid generation like any other, not a platform freebie.
					const raw = await resolveAiClient(svc, row.user_id);
					const ai = meteredAiClient(raw, { supabase: svc, userId: row.user_id, agentId: row.id });
					if (!ai) {
						noModel = 'no AI provider configured for this persona’s owner';
					} else {
						// meteredAiClient gates on budget before the call and records +
						// debits the event after it, so this call cannot escape the
						// ledger or the wallet. A refusal is reported per persona and
						// does not abort the run.
						const text = await ai.generate(reconciliationPrompt(before));
						answer = safeJson(text);
						if (answer === undefined) noModel = 'the model did not return usable JSON';
					}
				}
				const result = backfillTier2(after, { answer, seed: before.meta?.seed, now: startedAt });
				after = result.profile;
				extracted = result.extracted;
				rejected = result.rejected;
			}

			const added = addedLeaves(before, after);

			const beforeUsesV2 = hasV2OnlyLookAttributes(before.look);
			const afterUsesV2 = hasV2OnlyLookAttributes(after.look);
			if (beforeUsesV2 !== afterUsesV2) {
				promptDrift.push(
					`${row.id}: appearance clause switches ${beforeUsesV2 ? 'v2→v1' : 'v1→v2'}`
				);
			} else if (afterUsesV2) {
				const age = after.creator?.age;
				const opts = typeof age === 'number' ? { age } : undefined;
				if (lookToPromptClause(before.look, opts) !== lookToPromptClause(after.look, opts)) {
					promptDrift.push(`${row.id}: v2 appearance clause text changed`);
				}
			}

			for (const leaf of added) {
				addedByPath[leaf.path] = (addedByPath[leaf.path] ?? 0) + 1;
				// The declared-leaf rule is TIER 1's. Tier 1 is a closed set of four
				// derived leaves, so anything outside it is a defect. Tier 2 writes
				// wherever the prose and the sampler reach, which is most of the
				// record by design — judging it by Tier 1's list reports the feature
				// as a fault, which is what the first run of this did.
				if (tier === 1 && !(TIER_1_DERIVED_LEAVES as readonly string[]).includes(leaf.path)) {
					violations.push(`${row.id}: ${leaf.path}`);
				}
			}

			let didWrite = false;
			if (added.length) {
				changed++;
				// Only agents Tier 1 actually has something to say about are written.
				// Rewriting a row to store an identical profile is churn, and churn in
				// a table is indistinguishable from a change when someone audits it.
				if (mode === 'fill') {
					const stored = serializePersonaProfileV2(after, 'stored');
					const { error: writeError } = await svc
						.from('agents')
						.update({ personas_profile: stored })
						.eq('id', row.id);
					if (writeError) throw new Error(writeError.message);
					didWrite = true;
					written++;
				}
			}

			if (outcomes.length < MAX_DETAIL) {
				outcomes.push({
					agentId: row.id,
					name: row.name,
					added,
					upgraded,
					written: didWrite,
					...(extracted?.length ? { extracted } : {}),
					...(rejected?.length ? { rejected } : {}),
					...(noModel ? { noModel } : {})
				});
			}
		} catch (err) {
			failed++;
			const message = err instanceof Error ? err.message : String(err);
			if (outcomes.length < MAX_DETAIL) {
				outcomes.push({
					agentId: row.id,
					name: row.name,
					added: [],
					upgraded: false,
					written: false,
					error: message
				});
			}
		}
	}

	logActivity(locals, gate.user.id, {
		action: 'admin.persona_backfill.run',
		outcome: failed ? 'error' : 'ok',
		// A shadow run wrote nothing, and the log says so. The difference between
		// an audit trail and a rumour is whether it records what did NOT happen.
		meta: {
			tier,
			mode,
			scanned: rows.length,
			changed,
			written,
			failed,
			violations: violations.length,
			promptDrift: promptDrift.length
		}
	});

	return json({
		success: true,
		data: {
			mode,
			tier,
			startedAt,
			finishedAt: new Date().toISOString(),
			scanned: rows.length,
			changed,
			written,
			failed,
			// Non-empty means the backfill wrote outside the leaves it declares.
			// That is a code defect and the report says so in those words.
			violations,
			// Non-empty means this pass would change what a portrait prompt says.
			// Tier 1 must never do that; it is a defect, not a finding.
			promptDrift,
			addedByPath,
			upgradedCount: outcomes.filter((o) => o.upgraded).length,
			extractedCount: outcomes.reduce((n, o) => n + (o.extracted?.length ?? 0), 0),
			rejectedCount: outcomes.reduce((n, o) => n + (o.rejected?.length ?? 0), 0),
			noModelCount: outcomes.filter((o) => o.noModel).length,
			detail: outcomes,
			detailTruncated: rows.length > MAX_DETAIL
		}
	});
};
