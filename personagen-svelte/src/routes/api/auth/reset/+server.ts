import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Send a password-recovery email.
 *
 * A client QA audit filed UX-012: the sign-in form offered Email, Password,
 * Sign In and Sign up, and no way back in for someone who had forgotten their
 * password. There was no reset route anywhere in the product, so the finding
 * was not "add a link" — the link had nowhere to point.
 *
 * The recovery link lands on /api/auth/callback, which already exchanges a code
 * for a session; `next` carries the user to Settings → Profile, where
 * /api/settings/password already exists to set the new one. No new auth
 * surface, and nothing here can set a password on its own.
 */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const body = (await request.json().catch(() => ({}))) as { email?: string };
	const email = (body.email ?? '').trim();

	// Always answer the same way. Telling an anonymous caller whether an address
	// has an account turns this endpoint into a membership oracle, and the user
	// who really owns the address learns the outcome from their inbox.
	const sameAnswer = json({
		success: true,
		message: 'If that address has an account, a reset link is on its way.'
	});

	if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
		return json({ success: false, error: 'Enter a valid email address.' }, { status: 400 });
	}

	const redirectTo = `${url.origin}/api/auth/callback?next=${encodeURIComponent(
		'/settings?section=profile&reset=1'
	)}`;

	const { error } = await locals.supabase.auth.resetPasswordForEmail(email, { redirectTo });

	// A provider failure is logged for us and still answered identically to the
	// caller, for the same reason as above.
	if (error) console.error('[auth/reset] resetPasswordForEmail failed:', error.message);

	return sameAnswer;
};
