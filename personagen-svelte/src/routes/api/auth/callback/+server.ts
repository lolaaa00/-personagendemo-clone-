import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');

	if (!code) {
		throw redirect(303, '/login?error=auth');
	}

	try {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);

		if (error) {
			console.error('OAuth callback error:', error.message);
			throw redirect(303, '/login?error=auth');
		}
	} catch (e) {
		// Re-throw redirect responses
		if ((e as any)?.status === 303) throw e;
		console.error('OAuth callback unexpected error:', e);
		throw redirect(303, '/login?error=auth');
	}

	throw redirect(303, '/dashboard');
};
