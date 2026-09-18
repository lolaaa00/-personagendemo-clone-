import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { loadRegistry } from '$lib/server/model-registry';
import { describeUsage, reconcileLedger } from '$lib/server/registry-usage';
import { isPlatformAdmin } from '$lib/server/platform-admin';
import { getServiceSupabase } from '$lib/server/service-supabase';

const LEDGER_WINDOW_DAYS = 30;

/** Model Manager — the registry rows (seeded from the wired catalog on first visit).
 *  Platform-admin only: the registry is a platform-level pricing surface.
 *
 *  Alongside the rows the page gets two truth layers so it can never describe a
 *  stack that is not running: `usage` (where the pipeline consults each row,
 *  computed by the pipeline's own resolvers) and `ledger` (what actually ran,
 *  platform-wide, from generation_events). The ledger layer fails soft: a read
 *  error leaves the page usable with the layer marked unavailable. */
export const load: PageServerLoad = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) throw redirect(303, '/login');
	// A designed 403, not a silent redirect — see admin/+page.server.ts for why.
	if (!(await isPlatformAdmin(locals.supabase, user))) {
		throw error(403, 'The Model Manager is a platform-operator surface.');
	}

	try {
		const rows = await loadRegistry(locals.supabase, user.id);
		const usage = describeUsage(rows);

		let ledger: ReturnType<typeof reconcileLedger> = {
			byRowId: {},
			unlisted: [],
			windowDays: LEDGER_WINDOW_DAYS
		};
		let ledgerError: string | null = null;
		try {
			const since = new Date(Date.now() - LEDGER_WINDOW_DAYS * 86_400_000).toISOString();
			// Platform-wide on purpose: the page is admin-only and the question is
			// "what did the platform run", not "what did this admin run".
			const { data, error } = await getServiceSupabase()
				.from('generation_events')
				.select('provider, model, operation, est_cost')
				.gte('created_at', since)
				.limit(20_000);
			if (error) throw error;
			ledger = reconcileLedger(rows, data ?? [], LEDGER_WINDOW_DAYS);
		} catch (e) {
			ledgerError = (e as Error).message;
			console.warn('[Models page] ledger reconciliation unavailable:', ledgerError);
		}

		return { rows, usage, ledger, ledgerError, loadError: null };
	} catch (e) {
		console.error('[Models page] Failed to load registry:', e);
		return {
			rows: [],
			usage: { byRowId: {}, consultedKinds: [], kindNotes: {} },
			ledger: { byRowId: {}, unlisted: [], windowDays: LEDGER_WINDOW_DAYS },
			ledgerError: null,
			loadError: 'Could not load the model registry. Generation still runs on the built-in catalog.'
		};
	}
};
