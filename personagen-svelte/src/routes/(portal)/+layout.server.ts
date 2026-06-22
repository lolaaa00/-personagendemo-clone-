import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { createDbService } from '$lib/server/db';
import { checkConfigStatus } from '$lib/server/config-check';
import {
	getOrCreateHermes,
	ensureHermesConfig,
	ensureAgentsManagedByHermes
} from '$lib/server/hermes';

export const load: LayoutServerLoad = async ({ locals, fetch }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');
	const allowDemoMode = privateEnv.ALLOW_DEMO_MODE === 'true';

	if (isPlaceholder && !allowDemoMode) {
		return { session: null, user: null, configStatus: checkConfigStatus(), allowDemoMode };
	}

	try {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) throw redirect(303, '/login');

		// Core Hermes alignment checks
		try {
			const hermes = await getOrCreateHermes(locals.supabase, user.id);
			await ensureHermesConfig(locals.supabase, user.id, hermes.id);
			await ensureAgentsManagedByHermes(locals.supabase, user.id, hermes.id);
		} catch (err) {
			console.error('[Layout Server] Hermes alignment checks failed:', err);
		}

		return {
			session,
			user,
			configStatus: checkConfigStatus(),
			allowDemoMode
		};
	} catch (e) {
		// Re-throw SvelteKit redirects
		if ((e as any)?.status === 303) throw e;
		console.error('Portal layout auth error:', e);
		return {
			session: null,
			user: null,
			configStatus: checkConfigStatus(),
			allowDemoMode
		};
	}
};
