import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomBytes } from 'node:crypto';
import { requirePlatformAdmin } from '$lib/server/platform-admin';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { getSettings, setSetting, settingsStatus, refreshSettings, SETTING_KEYS, type SettingKey } from '$lib/server/settings';
import { creditsMode, creditsSource, activityLogEnabled, activitySource, activityPepper } from '$lib/server/flags';
import { activityStats, logActivity } from '$lib/server/activity';
import MIGRATION_ORDER from '../../../../../supabase/migrations.json';

/**
 * Platform Controls — the switches, from the Admin Console.
 *
 *   GET  /api/admin/settings   effective values + where each comes from (env | database),
 *                              cache health, migration ledger, activity queue, recent history
 *   POST /api/admin/settings   { key: 'credits_mode'|'activity_log', value, note }
 *                              { key: 'activity_pepper', rotate: true, note }   (new secret generated server-side)
 *
 * Every change is validated in the database function, written to
 * platform_settings_history, and logged as admin.settings.changed. The pepper's
 * value is never returned — only whether it is set and when it last changed.
 */

export const GET: RequestHandler = async ({ locals }) => {
	const gate = await requirePlatformAdmin(locals);
	if (!gate.ok) return json({ success: false, error: gate.message }, { status: gate.status });

	await refreshSettings();
	const svc = getServiceSupabase();
	const [{ data: history }, { data: applied, error: ledgerErr }] = await Promise.all([
		svc.from('platform_settings_history').select('key, old_value, new_value, changed_by, note, changed_at').order('id', { ascending: false }).limit(50),
		svc.from('schema_migrations').select('name')
	]);
	const appliedSet = new Set((applied ?? []).map((r: any) => r.name));
	const pending = ledgerErr ? null : (MIGRATION_ORDER as [string, string][]).filter(([f]) => !appliedSet.has(f)).map(([f]) => f);
	const s = getSettings();
	return json({
		success: true,
		switches: {
			credits_mode: { effective: creditsMode(), stored: s.credits_mode, source: creditsSource() },
			activity_log: { effective: activityLogEnabled(), stored: s.activity_log, source: activitySource() },
			activity_pepper: { set: activityPepper().length >= 32, source: process.env.ACTIVITY_PEPPER ? 'env' : 'database' }
		},
		cache: settingsStatus(),
		migrations: { pending, applied: appliedSet.size, total: MIGRATION_ORDER.length },
		activity: activityStats(),
		history: history ?? []
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const gate = await requirePlatformAdmin(locals);
	if (!gate.ok) return json({ success: false, error: gate.message }, { status: gate.status });

	let body: any;
	try {
		body = await request.json();
	} catch {
		return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
	}
	const key = body?.key as SettingKey;
	const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 300) : '';
	if (!(SETTING_KEYS as readonly string[]).includes(key)) {
		return json({ success: false, error: `key must be one of ${SETTING_KEYS.join(' | ')}` }, { status: 400 });
	}
	if (!note) return json({ success: false, error: 'A note is required (it is the audit trail)' }, { status: 400 });

	let value: unknown;
	if (key === 'activity_pepper') {
		if (body.rotate !== true) return json({ success: false, error: 'The pepper can only be rotated (rotate: true), never set by hand' }, { status: 400 });
		value = randomBytes(32).toString('hex');
	} else if (key === 'credits_mode') {
		value = String(body.value ?? '').toLowerCase();
		if (!['off', 'shadow', 'enforce'].includes(value as string)) {
			return json({ success: false, error: 'credits_mode must be off | shadow | enforce' }, { status: 400 });
		}
	} else {
		value = body.value === true || body.value === 'true' || body.value === 'on';
	}

	const before = { ...getSettings() };
	try {
		await setSetting(key, value, gate.user.id, note);
	} catch (e) {
		return json({ success: false, error: (e as Error).message }, { status: 400 });
	}
	logActivity(locals, gate.user.id, {
		action: 'admin.settings.changed',
		actorKind: 'admin',
		meta: {
			key,
			from: key === 'activity_pepper' ? '(secret)' : String((before as any)[key]),
			to: key === 'activity_pepper' ? '(rotated)' : String(value),
			note
		}
	});
	const after = getSettings();
	return json({
		success: true,
		key,
		stored: key === 'activity_pepper' ? '(rotated)' : (after as any)[key],
		effective: key === 'credits_mode' ? creditsMode() : key === 'activity_log' ? activityLogEnabled() : undefined,
		source: key === 'credits_mode' ? creditsSource() : key === 'activity_log' ? activitySource() : undefined
	});
};
