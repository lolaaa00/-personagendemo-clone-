import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';

export const load: any = async ({ locals, fetch }: any) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');
	const allowDemo = privateEnv.ALLOW_DEMO_MODE === 'true';

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
		agents = [];
	}

	return {
		agents
	};
};
