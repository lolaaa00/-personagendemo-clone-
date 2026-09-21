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

	// `next` is how the password-recovery link reaches Settings → Profile. Only
	// same-origin paths are honoured: an absolute URL or a protocol-relative one
	// would make this an open redirect.
	const next = url.searchParams.get('next');
	const safeNext =
		typeof next === 'string' &&
		next.startsWith('/') &&
		!next.startsWith('//') &&
		!next.includes(String.fromCharCode(92))
			? next
			: '/dashboard';
	throw redirect(303, safeNext);
};
