import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomBytes } from 'node:crypto';
import { requirePlatformAdmin } from '$lib/server/platform-admin';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { getSettings, setSetting, settingsStatus, refreshSettings, SETTING_KEYS, type SettingKey } from '$lib/server/settings';
import { creditsMode, creditsSource, activityLogEnabled, activitySource, activityPepper, creditMarkup, creditMarkupSource, personaGenerator, personaGeneratorSource, personaBackbone, personaBackboneSource } from '$lib/server/flags';
import { activityStats, logActivity } from '$lib/server/activity';
import MIGRATION_ORDER from '../../../../../supabase/migrations.json';
import { SUPPORTED_CURRENCIES, isSupportedCurrency, formatCredits, type FxRates } from '$lib/money';

/**
 * Display rates from the ECB via frankfurter.app (no key, no quota). Only the
 * currencies we can display are kept; USD is always 1. A response that lacks
 * the majors is rejected so a broken feed can never wipe the table.
 */
async function fetchFxRates(): Promise<FxRates> {
	const res = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${SUPPORTED_CURRENCIES.filter((c) => c !== 'USD').join(',')}`, {
		signal: AbortSignal.timeout(10_000),
		headers: { accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`frankfurter.app ${res.status}`);
	const body = (await res.json()) as { rates?: Record<string, number>; date?: string };
	const rates: Record<string, number> = { USD: 1 };
	for (const [k, v] of Object.entries(body.rates ?? {})) {
		if (isSupportedCurrency(k) && Number.isFinite(v) && v > 0) rates[k] = +Number(v).toFixed(6);
	}
	for (const must of ['EUR', 'GBP', 'AUD']) {
		if (!rates[must]) throw new Error(`rate feed missing ${must} — table left unchanged`);
	}
	return { base: 'USD', rates, updated_at: new Date().toISOString(), source: `frankfurter.app (ECB) ${body.date ?? ''}`.trim() };
}

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
			activity_pepper: { set: activityPepper().length >= 32, source: process.env.ACTIVITY_PEPPER ? 'env' : 'database' },
			signup_credits: { stored: s.signup_credits, usd: formatCredits(s.signup_credits, 'USD', s.fx_rates, 'en-US') },
			credit_markup: { effective: creditMarkup(), stored: s.credit_markup, source: creditMarkupSource() },
			daily_platform_spend_usd: { stored: s.daily_platform_spend_usd },
			signup_credits_hourly_cap: { stored: s.signup_credits_hourly_cap },
			signup_credits_require_invite: { stored: s.signup_credits_require_invite },
			plans_enabled: { stored: s.plans_enabled },
			persona_generator: { effective: personaGenerator(), stored: s.persona_generator, source: personaGeneratorSource() },
			persona_backbone: { effective: personaBackbone(), stored: s.persona_backbone, source: personaBackboneSource() },
			display_currency_default: { stored: s.display_currency_default, supported: SUPPORTED_CURRENCIES },
			fx_rates: {
				base: s.fx_rates.base,
				count: Object.keys(s.fx_rates.rates).length,
				updated_at: s.fx_rates.updated_at,
				source: s.fx_rates.source,
				sample: ['EUR', 'GBP', 'AUD', 'CAD', 'INR', 'JPY'].map((c) => ({ currency: c, rate: s.fx_rates.rates[c] ?? null }))
			}
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
	} else if (key === 'activity_log' || key === 'plans_enabled') {
		value = body.value === true || body.value === 'true' || body.value === 'on';
	} else if (key === 'signup_credits') {
		const n = Number(body.value);
		if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
			return json({ success: false, error: 'signup_credits must be an integer between 0 and 1,000,000 (100 = $1.00)' }, { status: 400 });
		}
		value = n;
	} else if (key === 'credit_markup') {
		const n = Number(body.value);
		if (!Number.isFinite(n) || n < 1 || n > 20) {
			return json({ success: false, error: 'credit_markup must be a number between 1 (at cost) and 20' }, { status: 400 });
		}
		value = +n.toFixed(2);
	} else if (key === 'daily_platform_spend_usd') {
		const n = Number(body.value);
		if (!Number.isFinite(n) || n < 0 || n > 100_000) {
			return json({ success: false, error: 'daily_platform_spend_usd must be between 0 (off) and 100,000' }, { status: 400 });
		}
		value = +n.toFixed(2);
	} else if (key === 'signup_credits_hourly_cap') {
		const n = Number(body.value);
		if (!Number.isInteger(n) || n < 0 || n > 10_000) {
			return json({ success: false, error: 'signup_credits_hourly_cap must be an integer between 0 (unlimited) and 10,000' }, { status: 400 });
		}
		value = n;
	} else if (key === 'persona_generator') {
		const v = String(body.value ?? '').toLowerCase();
		if (!['v1', 'v2'].includes(v)) return json({ success: false, error: 'persona_generator must be v1 | v2' }, { status: 400 });
		value = v;
	} else if (key === 'persona_backbone') {
		const v = String(body.value ?? '').toLowerCase();
		if (!['off', 'shadow', 'fill', 'on'].includes(v)) return json({ success: false, error: 'persona_backbone must be off | shadow | fill | on' }, { status: 400 });
		value = v;
	} else if (key === 'display_currency_default') {
		const c = String(body.value ?? 'auto').toUpperCase();
		if (c !== 'AUTO' && !isSupportedCurrency(c)) {
			return json({ success: false, error: `display_currency_default must be auto or one of ${SUPPORTED_CURRENCIES.join(', ')}` }, { status: 400 });
		}
		value = c === 'AUTO' ? 'auto' : c;
	} else if (key === 'fx_rates') {
		if (body.refresh !== true) return json({ success: false, error: 'fx_rates can only be refreshed (refresh: true) from the rate source' }, { status: 400 });
		try {
			value = await fetchFxRates();
		} catch (e) {
			return json({ success: false, error: `Rate refresh failed: ${(e as Error).message}` }, { status: 502 });
		}
	} else {
		return json({ success: false, error: 'Unsupported key' }, { status: 400 });
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
			from: key === 'activity_pepper' ? '(secret)' : key === 'fx_rates' ? String((before as any)[key]?.updated_at ?? 'seed') : String((before as any)[key]),
			to: key === 'activity_pepper' ? '(rotated)' : key === 'fx_rates' ? String((value as FxRates).source) : String(value),
			note
		}
	});
	const after = getSettings();
	return json({
		success: true,
		key,
		stored: key === 'activity_pepper' ? '(rotated)' : key === 'fx_rates' ? `${Object.keys((after as any).fx_rates.rates).length} rates · ${(after as any).fx_rates.source}` : (after as any)[key],
		effective: key === 'credits_mode' ? creditsMode() : key === 'activity_log' ? activityLogEnabled() : undefined,
		source: key === 'credits_mode' ? creditsSource() : key === 'activity_log' ? activitySource() : undefined
	});
};
