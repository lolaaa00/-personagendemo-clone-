import { json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { createSupabaseServiceClient } from '$lib/server/supabase';
import { grantWelcomeCredit } from '$lib/server/welcome-guard';
import { Throttle } from '$lib/server/throttle';

/**
 * Registration.
 *
 * The user is created with the SERVICE ROLE (auth.admin.createUser) rather
 * than the anon-key signUp() call. That is what lets the Supabase project run
 * with public signups disabled (GOTRUE_DISABLE_SIGNUP=true on self-hosted,
 * "Allow new users to sign up" off on hosted). With public signups enabled,
 * the Admin PIN gate below is decorative: the anon key ships in the browser
 * bundle, so anyone can POST straight to <supabase>/auth/v1/signup and get an
 * account without ever seeing this route. Creating the user server-side is
 * the half of the fix that lives in code; flipping the project setting is the
 * other half and must be done on the Supabase side.
 *
 * Falls back to the anon signUp() path when no service key is configured so a
 * misconfigured deployment degrades to the old behaviour instead of bricking
 * registration.
 */

// 10 PIN attempts per 15 minutes per client address. Fixed window, in-process
// (one container runs the app); bounded key count so a flood of addresses
// cannot grow memory without limit. Same primitive the billing routes use.
const signupPinLimiter = new Throttle(10, 15 * 60 * 1000);

function pinMatches(candidate: unknown, expected: string): boolean {
	if (typeof candidate !== 'string') return false;
	const a = Buffer.from(candidate);
	const b = Buffer.from(expected);
	// timingSafeEqual throws on length mismatch; a mismatch is simply "wrong".
	return a.length === b.length && timingSafeEqual(a, b);
}

function isDuplicateMessage(message: string): boolean {
	const m = message.toLowerCase();
	return (
		m.includes('already registered') ||
		m.includes('already been registered') ||
		m.includes('user already exists') ||
		m.includes('email address is already') ||
		m.includes('duplicate')
	);
}

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
	const { email, password, full_name, pin } = (await request.json()) as any;

	if (!email || !password) {
		return json({ error: 'Email and password required' }, { status: 400 });
	}

	// Validate Admin PIN if configured in env
	const adminPin = env.ADMIN_PIN || process.env.ADMIN_PIN;
	if (adminPin) {
		// Rate-limited before the comparison: the PIN is a short shared secret, so
		// without a ceiling it can be enumerated as fast as the network allows.
		// Only the PIN path is limited — with no PIN configured there is no secret
		// here to guess, and throttling open registration would be a bug.
		let clientIp = 'unknown';
		try {
			clientIp = getClientAddress();
		} catch {
			// adapter-node throws when it cannot determine the address (no
			// ADDRESS_HEADER behind a proxy). Everyone then shares one bucket,
			// which is stricter, never looser.
		}
		const gate = signupPinLimiter.check(`signup-pin:${clientIp}`);
		if (!gate.allowed) {
			return json(
				{ error: 'Too many registration attempts. Try again later.' },
				{ status: 429, headers: { 'Retry-After': String(gate.retryAfterSeconds) } }
			);
		}

		if (!pin) {
			return json({ error: 'Admin PIN is required for registration' }, { status: 400 });
		}
		if (!pinMatches(pin, adminPin)) {
			return json({ error: 'Invalid Admin PIN' }, { status: 400 });
		}
		// Correct PIN: clear the bucket so a legitimate admin who mistyped twice is
		// not left throttled behind their own successful attempt.
		signupPinLimiter.reset(`signup-pin:${clientIp}`);
	}

	if (password.length < 6) {
		return json({ error: 'Password must be at least 6 characters' }, { status: 400 });
	}

	let admin: ReturnType<typeof createSupabaseServiceClient> | null = null;
	try {
		admin = createSupabaseServiceClient();
	} catch {
		console.warn(
			'[signup] SUPABASE_SERVICE_ROLE_KEY missing — falling back to anon signUp(). ' +
				'The Admin PIN gate is only enforceable once public signups are disabled on the Supabase project.'
		);
	}

	if (!admin) {
		const { data, error } = await locals.supabase.auth.signUp({
			email,
			password,
			options: { data: { full_name: full_name || '' } }
		});
		if (error) {
			if (isDuplicateMessage(error.message)) {
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
	}

	// email_confirm mirrors the project's current auto-confirm behaviour: the
	// PIN is the admission control here, not a confirmation email.
	const { data: created, error: createError } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
		user_metadata: { full_name: full_name || '' },
		// The marker the welcome-credit trigger requires. It goes in APP metadata,
		// which only an admin call can write: a client POSTing to GoTrue directly
		// can put anything it likes in user_metadata (proven — a forged
		// app_metadata key lands there and is ignored) but cannot touch this.
		app_metadata: { invited: true }
	});

	if (createError) {
		if (createError.status === 422 || isDuplicateMessage(createError.message)) {
			return json({ error: 'An account with this email already exists' }, { status: 409 });
		}
		console.error('[signup] admin.createUser failed:', createError.message);
		return json({ error: createError.message }, { status: 400 });
	}

	// The welcome credit is granted HERE, not by the signup trigger. GoTrue
	// inserts the auth.users row and applies app_metadata afterwards, so the
	// trigger fires before the invited marker exists and can never see it — an
	// account created straight against GoTrue therefore gets nothing, which is
	// the point. Never fatal: an account with no credit is recoverable, a failed
	// registration is not.
	if (created.user?.id) await grantWelcomeCredit(created.user.id);

	// Establish the browser session through the cookie-backed client so the
	// redirect to /dashboard lands on an authenticated layout.
	const { data: signedIn, error: signInError } = await locals.supabase.auth.signInWithPassword({
		email,
		password
	});
	if (signInError) {
		console.error('[signup] user created but sign-in failed:', signInError.message);
		return json({ user: created.user, session: null, signInError: signInError.message });
	}

	return json({ user: created.user, session: signedIn.session });
};
