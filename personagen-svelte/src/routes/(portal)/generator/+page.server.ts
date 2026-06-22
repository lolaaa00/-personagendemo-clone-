import type { PageServerLoad } from './$types';
import { env as privateEnv } from '$env/dynamic/private';

export const load: PageServerLoad = async () => {
	const factoryUrl = privateEnv.FACTORY_URL ?? '';
	const factoryApiKey = privateEnv.FACTORY_API_KEY ?? '';
	const isFactoryConfigured = Boolean(
		factoryUrl &&
		!factoryUrl.includes('placeholder') &&
		factoryApiKey &&
		!factoryApiKey.includes('placeholder')
	);

	return {
		isFactoryConfigured
	};
};
