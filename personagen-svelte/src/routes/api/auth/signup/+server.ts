import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { email, password, full_name } = (await request.json()) as any;

	if (!email || !password) {
		return json({ error: 'Email and password required' }, { status: 400 });
	}

	if (password.length < 6) {
		return json({ error: 'Password must be at least 6 characters' }, { status: 400 });
	}

	const { data, error } = await locals.supabase.auth.signUp({
		email,
		password,
		options: {
			data: {
				full_name: full_name || ''
			}
		}
	});

	if (error) {
		// Supabase returns a generic message for duplicate emails
		if (
			error.message.toLowerCase().includes('already registered') ||
			error.message.toLowerCase().includes('already been registered') ||
			error.message.toLowerCase().includes('user already exists')
		) {
			return json({ error: 'An account with this email already exists' }, { status: 409 });
		}
		return json({ error: error.message }, { status: 400 });
	}

	// Supabase may return a user with identities=[] when email confirmation is required
	// and the user already exists — treat as duplicate
	if (data.user && data.user.identities && data.user.identities.length === 0) {
		return json({ error: 'An account with this email already exists' }, { status: 409 });
	}

	return json({ user: data.user, session: data.session });
};
