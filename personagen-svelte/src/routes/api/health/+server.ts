import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { creditsMode, creditsSource } from '$lib/server/flags';
import { activityStats } from '$lib/server/activity';
import { settingsStatus } from '$lib/server/settings';
import { reconciliationCheck } from '$lib/server/maintenance';
import { refreshAdmission, admissionSummary } from '$lib/server/admission';
import MIGRATION_ORDER from '../../../../supabase/migrations.json';

export const GET: RequestHandler = async ({ locals }) => {
	const checks: Record<string, string> = {};
	let healthy = true;

	const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL ?? '';
	const isConfigured = Boolean(supabaseUrl && !supabaseUrl.includes('placeholder'));
	checks.config = isConfigured ? 'ok' : 'misconfigured';
	if (!isConfigured) healthy = false;

	if (isConfigured) {
		try {
			const { error } = await locals.supabase.from('agents').select('id').limit(1);
			checks.supabase = error ? `error: ${error.message}` : 'ok';
			if (error) healthy = false;
		} catch (e) {
			checks.supabase = `error: ${(e as Error).message}`;
			healthy = false;
		}
	} else {
		checks.supabase = 'skipped';
	}

	const aiConfigured = Boolean(
		(privateEnv.GEMINI_API_KEY && !privateEnv.GEMINI_API_KEY.includes('placeholder')) ||
			privateEnv.OPENROUTER_API_KEY
	);
	checks.ai = aiConfigured ? 'ok' : 'not_configured';

	checks.scheduler = privateEnv.RUN_SCHEDULER === 'false' ? 'disabled' : 'enabled';

	// Migration ledger: every file in supabase/build-bootstrap.mjs ORDER must be
	// recorded in schema_migrations. A pending count > 0 means code may be
	// querying columns that do not exist yet — degraded, not down.
	if (isConfigured) {
		try {
			const { data, error } = await getServiceSupabase().from('schema_migrations').select('name');
			if (error) {
				checks.migrations = /does not exist|schema cache|PGRST205/i.test(error.message)
					? 'ledger_absent'
					: `error: ${error.message}`;
			} else {
				const applied = new Set((data ?? []).map((r: any) => r.name));
				const pending = (MIGRATION_ORDER as [string, string][]).filter(([f]) => !applied.has(f));
				checks.migrations = pending.length === 0 ? 'ok' : `pending:${pending.map(([f]) => f).join(',')}`;
			}
		} catch (e) {
			checks.migrations = `error: ${(e as Error).message}`;
		}
	}

	// Schema shape the billing path writes: every optional column of the widest
	// generation_events insert must be visible THROUGH PostgREST (a column that
	// exists in Postgres but not in the REST schema cache still fails inserts).
	if (isConfigured) {
		try {
			const { error } = await getServiceSupabase()
				.from('generation_events')
				.select('asset_url, billed_user_id, key_source, credits')
				.limit(0);
			checks.schema = error ? `degraded: ${error.message.slice(0, 100)}` : 'ok';
		} catch (e) {
			checks.schema = `error: ${(e as Error).message}`;
		}
	}

	// Billing + observability switches and the activity queue's loss counter —
	// the system says when it is blind instead of pretending.
	checks.credits = `${creditsMode()} (${creditsSource()})`;
	const st = settingsStatus();
	checks.settings = !st.primed
		? `unprimed${st.lastError ? `: ${st.lastError.slice(0, 80)}` : ''}`
		: st.lastError
			? `stale: ${st.lastError.slice(0, 80)}`
			: 'ok';
	const act = activityStats();
	checks.activity = !act.enabled
		? 'off'
		: act.dropped > 0
			? `dropped:${act.dropped}${act.lastError ? ` (${act.lastError.slice(0, 80)})` : ''}`
			: 'ok';

	// Billing reconciliation (hourly, on the scheduler lease): says when it last
	// ran and whether any platform-paid event lacks its single matching debit.
	// Says what it EXAMINED, not just what it found. A run over an empty window
	// finds nothing and must not read as a clean bill of health: "idle" is the
	// honest word for "there was nothing to check".
	//
	// The run counter is MODULE state, so it resets on every deploy and is never
	// set at all on a non-leader instance. Left at that, this line said "pending"
	// forever while the activity log held dozens of successful runs. When this
	// container has not run one, maintenance.ts falls back to the durable record
	// — one cached, timeout-bounded, indexed read, skipped entirely once this
	// container has its own answer. A failed read reads as 'unknown'.
	//
	// Deliberately NOT part of `healthy`: a quiet reconciliation is not a reason
	// to answer 503 and drop out of a load balancer.
	checks.reconciliation = await reconciliationCheck().catch(
		(e) => `unknown: reconciliation check failed (${(e as Error).message.slice(0, 80)})`
	);

	// Who can create an account. Both doors were measured open on 2026-09-09 and
	// only an operator can close them, so the question is asked here rather than
	// only on the deploy path — a deploy-time probe says nothing about the weeks
	// between deploys, nor about a setting that comes back on a re-provision.
	//
	// Deliberately COARSE: this route is unauthenticated, so naming the open door
	// would hand a passer-by the finding. The Admin Console names it.
	// Deliberately NOT part of `healthy`: an open door is an operator action, not
	// a reason to answer 503 and drop out of a load balancer.
	void refreshAdmission().catch(() => {});
	checks.admission = admissionSummary();

	return json(
		{
			status: healthy ? 'ok' : 'degraded',
			checks,
			activity: { queued: act.queued, flushed: act.flushed, dropped: act.dropped, lastFlushAt: act.lastFlushAt },
			ts: new Date().toISOString()
		},
		{ status: healthy ? 200 : 503 }
	);
};
