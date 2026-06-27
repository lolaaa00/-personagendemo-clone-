import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { checkConfigStatus } from '$lib/server/config-check';

export const load: LayoutServerLoad = async ({ locals }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');
	const allowDemoMode = privateEnv.ALLOW_DEMO_MODE === 'true';

	if (isPlaceholder && !allowDemoMode) {
		return { session: null, user: null, configStatus: checkConfigStatus(), allowDemoMode };
	}

	try {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) throw redirect(303, '/login');

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
