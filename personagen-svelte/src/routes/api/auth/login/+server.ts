import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { email, password } = (await request.json()) as any;

	if (!email || !password) {
		return json({ error: 'Email and password required' }, { status: 400 });
	}

	const { data, error } = await locals.supabase.auth.signInWithPassword({ email, password });

	if (error) {
		return json({ error: error.message }, { status: 401 });
	}

	return json({ user: data.user, session: data.session });
};
