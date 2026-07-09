import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export interface NotificationPreferences {
	emailAlerts: boolean;
	pushNotifications: boolean;
	weeklyReports: boolean;
}

const PREFERENCE_KEYS: Array<keyof NotificationPreferences> = [
	'emailAlerts',
	'pushNotifications',
	'weeklyReports'
];

export const GET: RequestHandler = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const metadata = (user.user_metadata || {}) as Record<string, unknown>;
	return json({
		success: true,
		displayName: typeof metadata.full_name === 'string' ? metadata.full_name : '',
		preferences: metadata.preferences && typeof metadata.preferences === 'object' ? metadata.preferences : null
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => ({}))) as any;
	const data: Record<string, unknown> = {};

	if (typeof body.displayName === 'string') {
		const displayName = body.displayName.trim();
		if (!displayName) {
			return json({ success: false, error: 'Display name cannot be empty' }, { status: 400 });
		}
		if (displayName.length > 120) {
			return json({ success: false, error: 'Display name is too long (max 120 characters)' }, { status: 400 });
		}
		// Same metadata key the signup flow writes (full_name) so both stay in sync.
		data.full_name = displayName;
	}

	if (body.preferences && typeof body.preferences === 'object') {
		const preferences: Partial<NotificationPreferences> = {};
		for (const key of PREFERENCE_KEYS) {
			if (typeof body.preferences[key] === 'boolean') {
				preferences[key] = body.preferences[key];
			}
		}
		const existing = (user.user_metadata?.preferences || {}) as Record<string, unknown>;
		data.preferences = { ...existing, ...preferences };
	}

	if (Object.keys(data).length === 0) {
		return json({ success: false, error: 'Nothing to update' }, { status: 400 });
	}

	const { data: updated, error } = await locals.supabase.auth.updateUser({ data });
	if (error) {
		return json({ success: false, error: error.message }, { status: 500 });
	}

	const metadata = (updated.user?.user_metadata || {}) as Record<string, unknown>;
	return json({
		success: true,
		displayName: typeof metadata.full_name === 'string' ? metadata.full_name : '',
		preferences: metadata.preferences ?? null
	});
};
