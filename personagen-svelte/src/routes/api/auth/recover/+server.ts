import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Lands the password-reset email's link (see $lib/server/reset-mail).
 *
 * The link carries GoTrue's recovery token hash; `verifyOtp` turns it into a
 * session (the SSR client writes the cookies) and the reader continues to the
 * set-a-new-password dialog. A used or expired link goes back to the reset page
 * with a plain explanation instead of a generic sign-in error.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const tokenHash = url.searchParams.get('token_hash');
	if (!tokenHash) throw redirect(303, '/reset-password?error=expired');

	const { error } = await locals.supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
	if (error) {
		console.error('[auth/recover] verifyOtp failed:', error.message);
		throw redirect(303, '/reset-password?error=expired');
	}

	// Same-origin paths only — an absolute or protocol-relative `next` would make
	// this an open redirect (mirrors /api/auth/callback).
	const next = url.searchParams.get('next');
	const safeNext =
		typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.includes(String.fromCharCode(92))
			? next
			: '/settings?section=profile&reset=1#password';
	throw redirect(303, safeNext);
};
