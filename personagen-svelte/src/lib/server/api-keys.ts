import crypto from 'node:crypto';
import { env as privateEnv } from '$env/dynamic/private';
import { getServiceSupabase } from '$lib/server/service-supabase';

/**
 * Programmatic API keys — durable machine auth for an external controller.
 *
 * A key is an alternate credential for a real seat: presented as
 * `Authorization: Bearer pg_live_…`, the auth hook (hooks.server.ts) resolves
 * it to its user_id and mints a short-lived Supabase user JWT so the request
 * runs under that identity with all RLS/roles intact. Only the hash is stored.
 */

const KEY_PREFIX = 'pg_live_';

/** True for a token that is one of our API keys (vs a Supabase session JWT). */
export function isApiKey(token: string): boolean {
	return token.startsWith(KEY_PREFIX);
}

/** Generate a new key: returns the plaintext (shown once) + what we persist. */
export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
	const secret = crypto.randomBytes(24).toString('base64url');
	const plaintext = `${KEY_PREFIX}${secret}`;
	return {
		plaintext,
		hash: hashApiKey(plaintext),
		// Enough to recognise a key in the list without revealing it.
		prefix: plaintext.slice(0, KEY_PREFIX.length + 6)
	};
}

export function hashApiKey(plaintext: string): string {
	return crypto.createHash('sha256').update(plaintext).digest('hex');
}

export interface ResolvedApiKey {
	id: string;
	userId: string;
}

/**
 * Resolve a presented key to its owning seat, or null if unknown/revoked.
 * Runs under the service role (bypasses RLS) — this is request-time auth, before
 * any user identity exists. Touches last_used_at fire-and-forget.
 */
export async function resolveApiKey(plaintext: string): Promise<ResolvedApiKey | null> {
	if (!isApiKey(plaintext)) return null;
	const svc = getServiceSupabase();
	const { data, error } = await svc
		.from('api_keys')
		.select('id, user_id, revoked_at')
		.eq('key_hash', hashApiKey(plaintext))
		.maybeSingle();
	if (error || !data || data.revoked_at) return null;

	void svc
		.from('api_keys')
		.update({ last_used_at: new Date().toISOString() })
		.eq('id', data.id)
		.then(undefined, () => {});

	return { id: data.id, userId: data.user_id };
}

function b64url(input: string | Buffer): string {
	return Buffer.from(input).toString('base64url');
}

/**
 * Mint a short-lived Supabase-compatible user JWT (HS256, signed with the
 * project JWT secret). PostgREST validates it with the same secret, so RLS sees
 * auth.uid() = sub exactly as it would for a real login. Hand-rolled to avoid a
 * dependency — the token shape is the small, stable subset Supabase RLS reads.
 *
 * Requires SUPABASE_JWT_SECRET (Supabase dashboard → Project Settings → API →
 * JWT Secret). Throws if it's missing so the failure is loud, not a silent
 * unauthenticated fallthrough.
 */
export function mintUserJwt(userId: string, email: string | null, ttlSeconds = 600): string {
	const secret = privateEnv.SUPABASE_JWT_SECRET;
	if (!secret) {
		throw new Error(
			'SUPABASE_JWT_SECRET is not configured — API-key auth cannot mint a session. Add it from Supabase → Project Settings → API → JWT Secret.'
		);
	}
	const now = Math.floor(Date.now() / 1000);
	const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
	const payload = b64url(
		JSON.stringify({
			sub: userId,
			email: email ?? undefined,
			role: 'authenticated',
			aud: 'authenticated',
			iat: now,
			exp: now + ttlSeconds
		})
	);
	const signature = crypto
		.createHmac('sha256', secret)
		.update(`${header}.${payload}`)
		.digest('base64url');
	return `${header}.${payload}.${signature}`;
}
