import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Toggle a persona's favorite heart. Body: { value: boolean } */
export const POST: RequestHandler = async ({ request, params, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const { agentId } = params;
	const body = (await request.json().catch(() => ({}))) as any;
	const value = Boolean(body.value);

	try {
		// user_id scoping makes ownership implicit — a foreign id updates 0 rows.
		const { data, error } = await locals.supabase
			.from('agents')
			.update({ is_favorite: value })
			.eq('id', agentId)
			.eq('user_id', user.id)
			.select('id, is_favorite')
			.maybeSingle();
		if (error) throw error;
		if (!data) return json({ success: false, error: 'Persona not found' }, { status: 404 });
		return json({ success: true, data });
	} catch (err) {
		console.error('[Agent Favorite API] Error:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
