import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createClient } from '@supabase/supabase-js';
import { env as publicEnv } from '$env/dynamic/public';
import { getServiceSupabase } from '$lib/server/service-supabase';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Change the signed-in account's login email.
 *
 * This instance has no SMTP/mailer wired up (invites are copy-paste links for
 * the same reason), so Supabase's own confirm-by-email flow would dead-end in
 * a message that never arrives. Instead: the user types the new address twice
 * AND re-enters their current password; the password is verified with a real
 * sign-in attempt, then the change is applied immediately via the admin API.
 * This is exactly the flow that turns a provisioned placeholder address
 * (name@monarchstack.com) into the person's real one.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user || !user.email) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as {
		newEmail?: string;
		confirmEmail?: string;
		currentPassword?: string;
	};
	const newEmail = (body.newEmail || '').trim().toLowerCase();
	const confirmEmail = (body.confirmEmail || '').trim().toLowerCase();
	const currentPassword = body.currentPassword || '';

	if (!newEmail || !EMAIL_RE.test(newEmail)) {
		return json({ success: false, error: 'Enter a valid email address' }, { status: 400 });
	}
	if (newEmail !== confirmEmail) {
		return json({ success: false, error: 'The two email fields do not match' }, { status: 400 });
	}
	if (newEmail === user.email.toLowerCase()) {
		return json({ success: false, error: 'That is already your login email' }, { status: 400 });
	}
	if (!currentPassword) {
		return json({ success: false, error: 'Enter your current password to confirm the change' }, { status: 400 });
	}

	// Verify the password with a real sign-in attempt on a throwaway client
	// (locals.supabase holds the session cookie; signing in there would clobber it).
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const anonKey = publicEnv.PUBLIC_SUPABASE_ANON_KEY;
	if (!url || !anonKey) {
		return json({ success: false, error: 'Auth not configured' }, { status: 500 });
	}
	const probe = createClient(url, anonKey, { auth: { persistSession: false } });
	const { error: pwErr } = await probe.auth.signInWithPassword({
		email: user.email,
		password: currentPassword
	});
	if (pwErr) {
		return json({ success: false, error: 'Current password is incorrect' }, { status: 403 });
	}

	const svc = getServiceSupabase();
	const { error: updateErr } = await svc.auth.admin.updateUserById(user.id, {
		email: newEmail,
		email_confirm: true
	});
	if (updateErr) {
		const msg = /already.*(registered|exists|in use)/i.test(updateErr.message)
			? 'That email is already used by another account'
			: updateErr.message;
		return json({ success: false, error: msg }, { status: 409 });
	}

	// Keep the invite-derived roster email in sync so Settings → Team shows the
	// real address, not the retired placeholder.
	await svc
		.from('workspace_invites')
		.update({ email: newEmail })
		.eq('accepted_by', user.id)
		.eq('status', 'accepted');

	return json({
		success: true,
		email: newEmail,
		// The session token still carries the old email claim — a fresh login
		// with the new address picks everything up cleanly.
		note: 'Email updated. Log out and back in with the new address.'
	});
};
