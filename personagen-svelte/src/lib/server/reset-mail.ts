import { env } from '$env/dynamic/private';
import { getServiceSupabase } from '$lib/server/service-supabase';

/**
 * Password-reset email sent by the APP, not by GoTrue's mailer.
 *
 * Why: the production Supabase stack is a compose template whose auth container
 * never re-renders from the panel's environment box (verified 2026-09-25: a
 * flag flipped in the box did not reach GoTrue even after a full stop/deploy),
 * so no SMTP setting placed there can ever take effect. Sending from here needs
 * only two things the app already controls: the service role (to mint a
 * recovery token hash) and a Resend key.
 *
 * Flow: `generateLink({type:'recovery'})` → we build our own link to
 * /api/auth/recover?token_hash=… → that route calls `verifyOtp` (which sets the
 * session cookies) and lands the reader on the set-a-new-password dialog. No
 * GoTrue redirect is involved, so SITE_URL / redirect allow-lists on the auth
 * container do not matter either.
 */

export const RESET_NEXT = '/settings?section=profile&reset=1#password';

/** The link the email carries: our own route, which verifies the token hash and signs the reader in. */
export function recoveryLink(origin: string, tokenHash: string, next: string = RESET_NEXT): string {
	const u = new URL('/api/auth/recover', origin);
	u.searchParams.set('token_hash', tokenHash);
	u.searchParams.set('next', next);
	return u.toString();
}

/** True when the app can send reset mail itself (a Resend key is configured). */
export function resetMailConfigured(): boolean {
	return !!(env.RESEND_API_KEY ?? process.env.RESEND_API_KEY);
}

export function resetMailSender(): string {
	return env.MAIL_FROM ?? process.env.MAIL_FROM ?? 'PersonaGen <noreply@l2gseo.com>';
}

export function resetMailBody(link: string): { subject: string; text: string; html: string } {
	const subject = 'Reset your PersonaGen password';
	const text = [
		'Someone asked to reset the password for this PersonaGen account.',
		'',
		`Set a new password: ${link}`,
		'',
		'The link works once and expires in an hour. If you did not ask for this, you can ignore this email — your password stays as it is.'
	].join('\n');
	const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f8fa;font-family:Segoe UI,Arial,sans-serif;color:#1b2230">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #dbe1e8;border-radius:12px;padding:28px">
<tr><td style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0f6e63;font-weight:700;padding-bottom:14px">PersonaGen</td></tr>
<tr><td style="font-size:20px;font-weight:700;padding-bottom:10px">Reset your password</td></tr>
<tr><td style="font-size:15px;line-height:1.5;padding-bottom:20px">Someone asked to reset the password for this PersonaGen account. If that was you, use the button below.</td></tr>
<tr><td style="padding-bottom:22px"><a href="${link}" style="display:inline-block;background:#0f6e63;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px">Set a new password</a></td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#5b6470">The link works once and expires in an hour. If you did not ask for this, ignore this email — your password stays as it is.<br><br>If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${link}</span></td></tr>
</table></td></tr></table></body></html>`;
	return { subject, text, html };
}

/**
 * Mints a recovery token for `email` and sends the reset email through Resend.
 * Returns 'no-account' when the address has no user (the caller answers
 * identically either way — this endpoint must not be a membership oracle).
 * Throws when the provider refuses, so the caller can log it.
 */
export async function sendResetMail(email: string, origin: string): Promise<'sent' | 'no-account'> {
	const key = env.RESEND_API_KEY ?? process.env.RESEND_API_KEY ?? '';
	const admin = getServiceSupabase();
	const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
	if (error) {
		if ((error as { code?: string }).code === 'user_not_found' || /not found/i.test(error.message)) return 'no-account';
		throw error;
	}
	const tokenHash = data?.properties?.hashed_token;
	if (!tokenHash) throw new Error('generateLink returned no token hash');
	const link = recoveryLink(origin, tokenHash);
	const body = resetMailBody(link);
	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ from: resetMailSender(), to: [email], ...body })
	});
	if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
	return 'sent';
}
