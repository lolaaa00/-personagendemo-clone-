import { createSupabaseServerClient } from '$lib/server/supabase';
import { redirect, type Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { startScheduler } from '$lib/server/scheduler';

// Start the background social posting scheduler on server boot
startScheduler();


const PROTECTED_PREFIXES = [
	'/dashboard',
	'/calendar',
	'/scout',
	'/generator',
	'/pm',
	'/persona-config',
	'/inbox',
	'/intel-wizard',
	'/trends',
	'/channel-decoder',
	'/content-forge',
	'/brand-brief',
	'/agreement',
	'/settings'
];

export const handle: Handle = async ({ event, resolve }) => {
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

	// Dev mode: skip auth when Supabase has placeholder credentials
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	// Protect portal routes
	const isProtected = PROTECTED_PREFIXES.some((prefix) =>
		event.url.pathname.startsWith(prefix)
	);

	if (isProtected && !isPlaceholder) {
		try {
			const { session } = await event.locals.safeGetSession();
			if (!session) throw redirect(303, '/login');
		} catch (e) {
			// Re-throw SvelteKit redirects
			if ((e as any)?.status === 303) throw e;
			// Supabase connection failure — let them through to avoid a blank error page
			console.error('Auth guard error:', e);
		}
	}

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};
