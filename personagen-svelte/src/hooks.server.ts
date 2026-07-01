import { createSupabaseServerClient } from '$lib/server/supabase';
import { redirect, type Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { startScheduler } from '$lib/server/scheduler';

let schedulerStarted = false;

const PROTECTED_PREFIXES = [
	'/dashboard',
	'/calendar',
	'/generator',
	'/personas',
	'/brand-brief',
	'/settings'
];

export const handle: Handle = async ({ event, resolve }) => {
	// Start the scheduler once per instance. Set RUN_SCHEDULER=false on web-only
	// instances so only a dedicated worker publishes (the leader lock guards races too).
	if (!schedulerStarted && privateEnv.RUN_SCHEDULER !== 'false') {
		schedulerStarted = true;
		try {
			startScheduler();
		} catch (e) {
			console.error('[Hooks] Scheduler failed to start — will retry on next request:', e);
			schedulerStarted = false;
		}
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
