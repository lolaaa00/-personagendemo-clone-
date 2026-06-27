import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

export interface ConfigStatus {
	supabase: boolean;
	ai: boolean;
	composio: boolean;
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

	const composioApiKey = privateEnv.COMPOSIO_API_KEY ?? '';
	const isComposioConfigured = Boolean(
		composioApiKey &&
		!composioApiKey.includes('placeholder') &&
		!composioApiKey.includes('change_me')
	);

	return {
		supabase: isSupabaseConfigured,
		ai: isAiConfigured,
		composio: isComposioConfigured
	};
}
