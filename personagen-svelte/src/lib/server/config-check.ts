import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

export interface ConfigStatus {
	supabase: boolean;
	ai: boolean;
}

export function checkConfigStatus(): ConfigStatus {
	const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL ?? '';
	const supabaseAnonKey = publicEnv.PUBLIC_SUPABASE_ANON_KEY ?? '';
	const isSupabaseConfigured = Boolean(
		supabaseUrl &&
		!supabaseUrl.includes('placeholder') &&
		supabaseAnonKey &&
		!supabaseAnonKey.includes('placeholder')
	);

	// ponytail: check any AI provider (Gemini env OR OpenRouter env). User-stored keys checked at runtime.
	const geminiApiKey = privateEnv.GEMINI_API_KEY ?? '';
	const openRouterKey = privateEnv.OPENROUTER_API_KEY ?? '';
	const isAiConfigured = Boolean(
		(geminiApiKey && !geminiApiKey.includes('placeholder') && !geminiApiKey.includes('your-gemini')) ||
		(openRouterKey && openRouterKey.trim() !== '')
	);

	return {
		supabase: isSupabaseConfigured,
		ai: isAiConfigured
	};
}
