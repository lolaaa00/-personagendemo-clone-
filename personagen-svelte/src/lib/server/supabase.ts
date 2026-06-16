import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { Cookies } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';

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
