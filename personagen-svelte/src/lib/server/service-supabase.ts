import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

/**
 * Service-role Supabase client for background jobs (scheduler, autopilot).
 * Bypasses RLS — only use server-side, never expose to the client.
 */
export function getServiceSupabase(): SupabaseClient {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !serviceKey) {
		throw new Error('[Service Supabase] Supabase credentials not configured.');
	}
	return createClient(url, serviceKey);
}
