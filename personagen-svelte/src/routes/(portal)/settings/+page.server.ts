import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { user } = await locals.safeGetSession();

	const metadata = (user?.user_metadata || {}) as Record<string, unknown>;
	const preferences =
		metadata.preferences && typeof metadata.preferences === 'object'
			? (metadata.preferences as Record<string, unknown>)
			: {};

	return {
		profile: {
			displayName: typeof metadata.full_name === 'string' ? metadata.full_name : '',
			preferences: {
				emailAlerts: typeof preferences.emailAlerts === 'boolean' ? preferences.emailAlerts : null,
				pushNotifications:
					typeof preferences.pushNotifications === 'boolean' ? preferences.pushNotifications : null,
				weeklyReports:
					typeof preferences.weeklyReports === 'boolean' ? preferences.weeklyReports : null
			}
		}
	};
};
