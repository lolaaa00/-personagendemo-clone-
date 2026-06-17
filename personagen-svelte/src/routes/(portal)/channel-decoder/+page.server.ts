import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	let agents: any[] = [];
	let hasDb = false;

	if (!isPlaceholder && locals.supabase) {
		const db = createDbService(locals.supabase);
		const { data: dbAgents } = await db.agents.list();

		if (dbAgents && dbAgents.length > 0) {
			hasDb = true;
			const creators = dbAgents.filter((a) => !a.is_overseer);
			agents = creators.map((a) => ({
				id: a.id,
				name: a.name,
				handle: a.handle || `@${a.name.toLowerCase().replace(/\s+/g, '')}`
			}));
		}
	}

	if (!hasDb) {
		// Fallback static agents
		const agentsRes = await fetch('/data/agents.json');
		const rawAgents: any[] = await agentsRes.json();
		agents = rawAgents.map((a) => ({
			id: a.id,
			name: a.name,
			handle: a.handle || `@${a.name.toLowerCase().replace(/\s+/g, '')}`
		}));
	}

	return {
		agents
	};
};
