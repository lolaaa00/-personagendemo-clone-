import { createServerClient } from '@supabase/ssr';
import type { Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';

export function createSupabaseServerClient(cookies: Cookies) {
	return createServerClient(
		env.PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
		env.PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder',
		{
			cookies: {
				getAll: () => cookies.getAll(),
				setAll: (cookiesToSet) => {
					cookiesToSet.forEach(({ name, value, options }) => {
						cookies.set(name, value, { ...options, path: '/' });
					});
				}
			}
		}
	);
}
