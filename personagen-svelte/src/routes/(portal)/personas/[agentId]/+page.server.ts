import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { resolvePersonaGender } from '$lib/server/content/generate';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';

export const load: PageServerLoad = async ({ locals, params }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	if (!isPlaceholder && locals.supabase) {
		const db = createDbService(locals.supabase);
		const { user } = await locals.safeGetSession();

		const [agentRes, supervisorsRes, configRes, briefsResult] = await Promise.all([
			// Single-row fetch instead of loading the whole roster (soul/skills/
			// market text of EVERY agent) just to .find() one. RLS scopes the
			// query to the owner, so "missing" and "not owned" both come back as
			// zero rows → 404 below, same as before.
			db.agents.get(params.agentId),
			// Lean supervisor projection: the page only uses supervisors as a
			// picker-level list (id + display fields) — never their soul/market.
			locals.supabase
				.from('agents')
				.select('id, name, handle, gradient, initial, is_overseer')
				.eq('is_overseer', true),
			db.agentConfigs.get(params.agentId),
			// Multi-brand: the Profile tab's brief picker lists every brief the
			// user has saved (e.g. "Just Kids Honey", "HoneyX Manly Plus").
			user ? db.brandBriefs.list(user.id) : Promise.resolve({ data: [] as any[] })
		]);

		const agent = agentRes.data;
		if (!agent) {
			// PGRST116 = .single() matched no rows → the agent doesn't exist (or
			// isn't ours) → 404, preserving the old find()-miss semantics. Any
			// other error is a real DB failure → 500, like the old list() guard.
			if (agentRes.error && (agentRes.error as any).code !== 'PGRST116') {
				throw error(500, 'Failed to load agents');
			}
			throw error(404, 'Agent not found');
		}

		const supervisors = supervisorsRes.data ?? [];
		const config = configRes.data;

		return {
			agent: {
				...agent,
				timezone: config?.timezone ?? 'Australia/Sydney',
				posts_per_day: config?.posts_per_day ?? 3,
				active_hours_start: config?.active_hours_start ?? 8,
				active_hours_end: config?.active_hours_end ?? 22,
				autonomy_level: config?.autonomy_level ?? 'advisor',
				rss_url: config?.rss_url ?? '',
				rss_active: config?.rss_active ?? false,
				rss_last_polled_at: config?.rss_last_polled_at ?? null,
				ugc_voice: config?.ugc_voice ?? 'Adam',
				ugc_character_ref: config?.ugc_character_ref ?? null,
				ugc_reference_kit: config?.ugc_reference_kit ?? {},
				brand_brief_id: config?.brand_brief_id ?? null
			},
			supervisors,
			brandBriefs: briefsResult.data ?? [],
			// Gender the server WILL use at generation time when the explicit
			// field is blank (inferred from the soul/name, else a pinned voice).
			// The Profile tab uses this to pre-fill the picker so what's shown
			// matches what generates — no more "why is my female persona voiced
			// as Adam".
			inferredGender: resolvePersonaGender(agent, config?.ugc_voice ?? null) ?? null
		};
	}

	return { agent: null, supervisors: [], brandBriefs: [], inferredGender: null };
};
