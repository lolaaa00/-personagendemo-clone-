import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

export interface ConfigStatus {
	supabase: boolean;
	gemini: boolean;
	composio: boolean;
	accountFactory: boolean;
	mailService: boolean;
	internalApiSecret: boolean;
	mcpHermes: boolean;
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

	const geminiApiKey = privateEnv.GEMINI_API_KEY ?? '';
	const isGeminiConfigured = Boolean(
		geminiApiKey &&
		!geminiApiKey.includes('placeholder') &&
		!geminiApiKey.includes('your-gemini')
	);

	const composioApiKey = privateEnv.COMPOSIO_API_KEY ?? '';
	const isComposioConfigured = Boolean(
		composioApiKey &&
		!composioApiKey.includes('placeholder') &&
		!composioApiKey.includes('change_me')
	);

	const factoryUrl = privateEnv.FACTORY_URL ?? '';
	const factoryApiKey = privateEnv.FACTORY_API_KEY ?? '';
	const isFactoryConfigured = Boolean(
		factoryUrl &&
		!factoryUrl.includes('placeholder') &&
		factoryApiKey &&
		!factoryApiKey.includes('placeholder')
	);

	const mailHost = privateEnv.SMTP_HOST || privateEnv.MAIL_PORT || '';
	const isMailConfigured = Boolean(mailHost && !mailHost.includes('placeholder'));

	const internalSecret = privateEnv.INTERNAL_API_SECRET || '';
	const isInternalSecretConfigured = Boolean(internalSecret && !internalSecret.includes('placeholder'));

	const isMcpHermesConfigured = Boolean(privateEnv.HERMES_GATEWAY_URL && privateEnv.HERMES_API_KEY);

	return {
		supabase: isSupabaseConfigured,
		gemini: isGeminiConfigured,
		composio: isComposioConfigured,
		accountFactory: isFactoryConfigured,
		mailService: isMailConfigured,
		internalApiSecret: isInternalSecretConfigured,
		mcpHermes: isMcpHermesConfigured
	};
}
