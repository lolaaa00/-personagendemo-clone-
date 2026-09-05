import { createSupabaseServerClient } from '$lib/server/supabase';
import { createClient } from '@supabase/supabase-js';
import { redirect, type Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { building } from '$app/environment';
import { startScheduler } from '$lib/server/scheduler';
import { isApiKey, resolveApiKey, mintUserJwt } from '$lib/server/api-keys';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { installLifecycle } from '$lib/server/lifecycle';
import {
	enqueueActivity,
	requestContext,
	sessionHashOf,
	shouldLog,
	routeAction,
	outcomeFor,
	touchPresence
} from '$lib/server/activity';
import { activityLogEnabled } from '$lib/server/flags';
import { startSettingsRefresh } from '$lib/server/settings';

// SIGTERM/SIGINT → flush registered in-memory queues, then exit. Installed
// before the scheduler so a redeploy mid-tick still drains cleanly.
if (!building) installLifecycle();

// Platform switches (credits mode, activity log, pepper) live in the database
// and are flipped from the Admin Console: prime the cache now, refresh every
// 15 s. Until the first prime every switch reads as "off".
if (!building) startSettingsRefresh();

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

/**
 * Activity capture around the real handler. Fail-soft by design: any throw in
 * here is swallowed and the response is returned untouched — logging can never
 * cost a user a request. The session is only read from the memoised result the
 * route already produced (never a fresh network call), except on auth routes
 * where the login just happened and the session is new.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const t0 = Date.now();
	const requestId = crypto.randomUUID();
	event.locals.requestId = requestId;
	const logging = activityLogEnabled();
	if (logging) {
		try {
			event.locals.activityContext = requestContext(event.request);
		} catch {
			event.locals.activityContext = null;
		}
	}

	const response = await handleInner({ event, resolve });

	if (logging) {
		try {
			const routeId = event.route.id;
			const method = event.request.method;
			if (shouldLog(routeId, method, event.url.pathname)) {
				const status = response.status;
				const isAuthRoute = !!routeId && routeId.startsWith('/api/auth/');
				const sess = isAuthRoute
					? await event.locals.safeGetSession().catch(() => ({ session: null, user: null }))
					: memoisedSession(event) ?? { session: null, user: null };
				const userId = sess.user?.id ?? null;
				const sessionHash = sessionHashOf((sess.session as any)?.access_token ?? null);
				event.locals.activitySessionHash = sessionHash;
				const { action, meta } = routeAction(routeId!, method, status);
				enqueueActivity({
					action,
					userId,
					actorKind: userId ? ((event.locals as any).apiKeyAuth ? 'api_key' : 'user') : 'anonymous',
					routeId,
					method,
					statusCode: status,
					outcome: outcomeFor(status),
					durationMs: Date.now() - t0,
					requestId,
					sessionHash,
					context: event.locals.activityContext ?? null,
					meta: { ...meta, data: event.url.pathname.endsWith('/__data.json') || undefined }
				});
				if (userId) touchPresence(userId, routeId, event.locals.activityContext ?? null, sessionHash);
			}
		} catch (e) {
			console.warn('[activity] capture failed (ignored):', (e as Error).message);
		}
	}
	try {
		response.headers.set('x-request-id', requestId);
	} catch {
		/* immutable headers on some responses — fine */
	}
	return response;
};

/** Session result cached by the memoising wrapper below, if the route resolved it. */
function memoisedSession(event: Parameters<Handle>[0]['event']) {
	return (event.locals as any).__sessionMemo as { session: any; user: any } | undefined;
}

const handleInner: Handle = async ({ event, resolve }) => {
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
				(event.locals as any).__sessionMemo = { session: { access_token: token }, user };
				(event.locals as any).apiKeyAuth = true;
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

	// Memoised per request: the layout guard, the route, and the activity
	// capture all ask for the session; only the first call pays for getUser().
	// Auth routes (login/signup/logout) mutate the session mid-request, so the
	// memo is bypassed for them (they are the only routes that change it).
	let sessionMemo: Promise<{ session: any; user: any }> | null = null;
	const isAuthMutation = event.url.pathname.startsWith('/api/auth/');
	event.locals.safeGetSession = async () => {
		const compute = async () => {
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
		if (isAuthMutation) return compute();
		if (!sessionMemo) sessionMemo = compute();
		const result = await sessionMemo;
		(event.locals as any).__sessionMemo = result;
		return result;
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
