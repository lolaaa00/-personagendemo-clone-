import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';

/**
 * Writes auth cookies for this request — and never throws.
 *
 * auth-js can emit an auth event AFTER SvelteKit has already sent the
 * response: a token refresh that settles late (the audit server saw it when
 * DNS to the auth host failed mid-request). `cookies.set` then throws "Cannot
 * use cookies.set(...) after the response has been generated", inside an
 * auth-js promise nobody awaits — an unhandled rejection that killed the
 * whole Node process, i.e. every user's requests, not just this one. Nothing
 * is lost by skipping it: the next request re-reads the cookies and refreshes.
 */
export function setAuthCookies(
	cookies: Pick<Cookies, 'set'>,
	cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>
): void {
	for (const { name, value, options } of cookiesToSet) {
		try {
			cookies.set(name, value, { ...(options ?? {}), path: '/' });
		} catch (err) {
			if (!/after the response has been generated/i.test(String((err as Error)?.message))) {
				console.warn('[supabase] could not set an auth cookie:', (err as Error)?.message);
			}
		}
	}
}

export function createSupabaseServerClient(cookies: Cookies) {
	return createServerClient(
		env.PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
		env.PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder',
		{
			cookies: {
				getAll: () => cookies.getAll(),
				setAll: (cookiesToSet) => setAuthCookies(cookies, cookiesToSet)
			}
		}
	);
}

export function createSupabaseServiceClient() {
	const supabaseUrl =
		env.PUBLIC_SUPABASE_URL || privateEnv.PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
	const serviceRoleKey = privateEnv.SUPABASE_SERVICE_ROLE_KEY;
	if (!serviceRoleKey) {
		throw new Error(
			'[Supabase Service Client] SUPABASE_SERVICE_ROLE_KEY is not configured in environment variables.'
		);
	}
	return createClient(supabaseUrl, serviceRoleKey, {
		auth: {
			persistSession: false,
			autoRefreshToken: false
		}
	});
}
