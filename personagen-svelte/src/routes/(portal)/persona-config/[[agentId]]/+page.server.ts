import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';

export const load: PageServerLoad = async ({ locals, params }) => {
	const agentId = params.agentId;

	// If a specific agent ID was provided, redirect directly to that persona
	if (agentId) {
		throw redirect(301, `/personas/${agentId}`);
	}

	// Otherwise redirect to the first active agent or the dashboard
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	if (!isPlaceholder && locals.supabase) {
		const db = createDbService(locals.supabase);
		const { data: agents } = await db.agents.list();
		const creators = (agents ?? []).filter((a: any) => !a.is_overseer);
		if (creators.length > 0) {
			const first = creators.find((a: any) => a.status === 'active') ?? creators[0];
			throw redirect(301, `/personas/${first.id}`);
		}
	}

	throw redirect(301, '/dashboard');
};
