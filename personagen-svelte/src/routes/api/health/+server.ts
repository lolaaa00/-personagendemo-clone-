import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';

export const GET: RequestHandler = async ({ locals }) => {
	const checks: Record<string, string> = {};
	let healthy = true;

	const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL ?? '';
	const isConfigured = Boolean(supabaseUrl && !supabaseUrl.includes('placeholder'));
	checks.config = isConfigured ? 'ok' : 'misconfigured';
	if (!isConfigured) healthy = false;

	if (isConfigured) {
		try {
			const { error } = await locals.supabase.from('agents').select('id').limit(1);
			checks.supabase = error ? `error: ${error.message}` : 'ok';
			if (error) healthy = false;
		} catch (e) {
			checks.supabase = `error: ${(e as Error).message}`;
			healthy = false;
		}
	} else {
		checks.supabase = 'skipped';
	}

	const aiConfigured = Boolean(
		(privateEnv.GEMINI_API_KEY && !privateEnv.GEMINI_API_KEY.includes('placeholder')) ||
			privateEnv.OPENROUTER_API_KEY
	);
	checks.ai = aiConfigured ? 'ok' : 'not_configured';

	checks.scheduler = privateEnv.RUN_SCHEDULER === 'false' ? 'disabled' : 'enabled';

	return json(
		{ status: healthy ? 'ok' : 'degraded', checks, ts: new Date().toISOString() },
		{ status: healthy ? 200 : 503 }
	);
};
