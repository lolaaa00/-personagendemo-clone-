import { createSupabaseServerClient } from '$lib/server/supabase';
import { createClient } from '@supabase/supabase-js';
import { redirect, type Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { building } from '$app/environment';
import { startScheduler } from '$lib/server/scheduler';
import { isApiKey, resolveApiKey, mintUserJwt } from '$lib/server/api-keys';
import { getServiceSupabase } from '$lib/server/service-supabase';

// Start the scheduler at server boot (adapter-node runs module-level code on
// startup), not lazily on first request — an idle deployment still publishes.
// Set RUN_SCHEDULER=false on web-only instances so only a dedicated worker
// publishes (the leader lease guards races too). startScheduler() itself no-ops
// on placeholder Supabase credentials. The `building` guard keeps prerendering
// from booting a scheduler (dynamic env is unavailable at build time anyway).
if (!building && privateEnv.RUN_SCHEDULER !== 'false') {
	try {
		startScheduler();
	} catch (e) {
		console.error('[Hooks] Scheduler failed to start at boot:', e);
	}
}

/**
 * Request-level auth gate. Every one of these also sits behind the (portal)
 * layout load, which redirects on a missing session — this list is the outer
 * layer, rejecting before any page load runs.
 *
 * Keep it in sync when adding a route under (portal): the layout guard alone
 * still protects a missing entry, but its catch block swallows auth errors and
 * returns a null session instead of redirecting, so a route that is only
 * guarded there degrades to a blank page rather than a clean bounce to /login.
 */
const PROTECTED_PREFIXES = [
	'/dashboard',
	'/calendar',
	'/generator',
	'/personas',
	'/brand-brief',
	'/settings',
	'/models',
	'/generations',
	'/favorites',
	'/guides',
	'/review',
	'/developer',
	'/admin'
];

export const handle: Handle = async ({ event, resolve }) => {
	// ── API-key auth (agentic controller) ────────────────────────────────────
	// A request carrying `Authorization: Bearer pg_live_…` authenticates as the
	// seat that owns the key. We mint a short-lived user JWT and build the
	// request's Supabase client with it, so RLS/roles apply exactly as for a
	// browser session. Cookie-based auth (the normal path) runs below untouched.
	const authHeader = event.request.headers.get('authorization') ?? '';
	const bearer = authHeader.toLowerCase().startsWith('bearer ')
		? authHeader.slice(7).trim()
		: '';

	if (bearer && isApiKey(bearer)) {
		const apiHandled = await (async () => {
			try {
				const resolved = await resolveApiKey(bearer);
				if (!resolved) return false;

				const { data: userData } = await getServiceSupabase().auth.admin.getUserById(
					resolved.userId
				);
				const user = userData?.user ?? null;
				if (!user) return false;

				const token = mintUserJwt(user.id, user.email ?? null);
				// A client whose every PostgREST call carries the minted user JWT →
				// auth.uid() = this seat inside RLS, identical to a real login.
				event.locals.supabase = createClient(
					env.PUBLIC_SUPABASE_URL ?? '',
					env.PUBLIC_SUPABASE_ANON_KEY ?? '',
					{
						global: { headers: { Authorization: `Bearer ${token}` } },
						auth: { persistSession: false, autoRefreshToken: false }
					}
				) as any;
				// Routes call locals.safeGetSession() — hand them the resolved seat
				// directly (there is no cookie session to read for a key request).
				event.locals.safeGetSession = async () => ({
					session: { access_token: token, token_type: 'bearer', user } as any,
					user
				});
				return true;
			} catch (e) {
				console.error('[Hooks] API-key auth failed:', e);
				return false;
			}
		})();

		if (apiHandled) {
			return resolve(event, {
				filterSerializedResponseHeaders(name) {
					return name === 'content-range' || name === 'x-supabase-api-version';
				}
			});
		}
		// Fall through to cookie auth on an unresolved/invalid key — the route's
		// own 401 then reports it cleanly rather than us guessing intent here.
	}

	event.locals.supabase = createSupabaseServerClient(event.cookies);

	event.locals.safeGetSession = async () => {
		try {
			const {
				data: { session }
			} = await event.locals.supabase.auth.getSession();
			if (!session) return { session: null, user: null };

			const {
				data: { user },
				error
			} = await event.locals.supabase.auth.getUser();
			if (error) return { session: null, user: null };

			return { session, user };
		} catch (e) {
			console.error('Supabase session error:', e);
			return { session: null, user: null };
		}
	};

	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	// Protect portal routes
	const isProtected = PROTECTED_PREFIXES.some((prefix) => event.url.pathname.startsWith(prefix));

	if (isProtected) {
		if (isPlaceholder) {
			return new Response(
				`<!DOCTYPE html>
				<html lang="en">
				<head>
					<meta charset="utf-8" />
					<title>Configuration Required - PersonaGen</title>
					<style>
						body {
							background-color: #0b0f19;
							color: #f3f4f6;
							font-family: system-ui, -apple-system, sans-serif;
							display: flex;
							align-items: center;
							justify-content: center;
							min-height: 100vh;
							margin: 0;
							padding: 1.5rem;
						}
						.card {
							background: rgba(255, 255, 255, 0.03);
							border: 1px solid rgba(255, 255, 255, 0.08);
							border-radius: 16px;
							padding: 2.5rem;
							max-width: 500px;
							width: 100%;
							box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
							backdrop-filter: blur(12px);
						}
						h1 {
							font-size: 1.5rem;
							margin-top: 0;
							color: #ef4444;
							font-weight: 700;
						}
						p {
							color: #9ca3af;
							line-height: 1.6;
							font-size: 0.95rem;
						}
						.code {
							background: #111827;
							padding: 0.75rem 1rem;
							border-radius: 8px;
							font-family: monospace;
							font-size: 0.85rem;
							color: #e5e7eb;
							border: 1px solid rgba(255, 255, 255, 0.05);
							margin: 1.5rem 0;
							word-break: break-all;
						}
						.footer {
							margin-top: 2rem;
							font-size: 0.8rem;
							color: #6b7280;
							text-align: center;
						}
					</style>
				</head>
				<body>
					<div class="card">
						<h1>Configuration Required</h1>
						<p>PersonaGen requires a configured Supabase database to run. Set real Supabase credentials in your environment variables.</p>
						<p>Missing or placeholder value for:</p>
						<div class="code">PUBLIC_SUPABASE_URL</div>
						<div class="footer">PersonaGen</div>
					</div>
				</body>
				</html>`,
				{
					status: 503,
					headers: { 'content-type': 'text/html; charset=utf-8' }
				}
			);
		}

		try {
			const { session } = await event.locals.safeGetSession();
			if (!session) throw redirect(303, '/login');
		} catch (e) {
			if ((e as any)?.status === 303) throw e;
			console.error('Auth guard error:', e);
		}
	}

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};
