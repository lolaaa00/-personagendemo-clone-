import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { getServiceSupabase } from '$lib/server/service-supabase';
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

	return json(
		{ status: healthy ? 'ok' : 'degraded', checks, ts: new Date().toISOString() },
		{ status: healthy ? 200 : 503 }
	);
};
