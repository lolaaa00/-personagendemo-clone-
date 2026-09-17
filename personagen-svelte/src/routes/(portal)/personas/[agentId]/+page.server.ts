import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { resolvePersonaGender } from '$lib/server/content/generate';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { getAgentRole } from '$lib/server/workspaces';
import { capabilities } from '$lib/seat';

/** A persona id is a uuid. Anything else cannot name one. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async ({ locals, params }) => {
	// A malformed id used to reach Postgres, which rejected the uuid cast with
	// 22P02 — not PGRST116 — so the guard below treated a typo as a database
	// failure and returned 500 "Failed to load personas". A mistyped URL is not
	// a system fault, and the message named the plural collection on a
	// single-persona route, implying something was broken when nothing was.
	if (!UUID_RE.test(params.agentId)) throw error(404, 'Persona not found');

	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	if (!isPlaceholder && locals.supabase) {
		const db = createDbService(locals.supabase);
		const { user } = await locals.safeGetSession();

		// Post counts by status, as a COUNT query.
		//
		// The hero's "Posts" stat used to be derived from `feedPosts`, the list
		// the Content tab loads — and the feed is only fetched when the Content or
		// Studio tab is open. On every other tab that array is empty, so a persona
		// with three published posts reported "0 POSTS" in the one place the page
		// makes a quantitative claim about her, while the dashboard, the calendar
		// and /generations all showed her work. A count belongs in a count query,
		// not in whatever list happens to be in memory.
		const countFor = async (status: string) => {
			const { count } = await locals.supabase
				.from('posts')
				.select('id', { count: 'exact', head: true })
				.eq('agent_id', params.agentId)
				.is('deleted_at', null)
				.eq('status', status);
			return count ?? 0;
		};

		const [agentRes, supervisorsRes, configRes, briefsResult, role] = await Promise.all([
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
			user ? db.brandBriefs.list(user.id) : Promise.resolve({ data: [] as any[] }),
			// This seat's role on THIS persona — the function RLS itself enforces with.
			// The layout's seat is the account's highest membership seat, an upper
			// bound; a page about one persona must carry that persona's answer.
			user ? getAgentRole(locals.supabase, user.id, params.agentId) : Promise.resolve(null)
		]);

		const agent = agentRes.data;
		if (!agent) {
			// PGRST116 = .single() matched no rows → the agent doesn't exist (or
			// isn't ours) → 404, preserving the old find()-miss semantics. Any
			// other error is a real DB failure → 500, like the old list() guard.
			if (agentRes.error && (agentRes.error as any).code !== 'PGRST116') {
				throw error(500, 'Failed to load personas');
			}
			throw error(404, 'Persona not found');
		}

		const supervisors = supervisorsRes.data ?? [];
		const config = configRes.data;

		const [published, partial, draft, scheduled] = await Promise.all([
			countFor('published'),
			countFor('partial'),
			countFor('draft'),
			countFor('scheduled')
		]);
		const postCounts = {
			published: published + partial,
			queued: draft + scheduled
		};

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
			postCounts,
			brandBriefs: briefsResult.data ?? [],
			// Gender the server WILL use at generation time when the explicit
			// field is blank (inferred from the soul/name, else a pinned voice).
			// The Profile tab uses this to pre-fill the picker so what's shown
			// matches what generates — no more "why is my female persona voiced
			// as Adam".
			inferredGender: resolvePersonaGender(agent, config?.ugc_voice ?? null) ?? null,
			// Overrides the layout seat for this page. Never-brick: an unresolved role
			// (RPC hiccup) keeps yesterday's behaviour rather than hiding an owner's
			// own controls.
			seat: capabilities(role ?? 'owner')
		};
	}

	return { agent: null, supervisors: [], brandBriefs: [], inferredGender: null };
};
