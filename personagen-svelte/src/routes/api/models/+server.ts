import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	loadRegistry,
	syncFromFal,
	probeModelSchema,
	parsePriceText,
	type RegistryKind
} from '$lib/server/model-registry';

const KINDS: RegistryKind[] = ['image_t2i', 'image_edit', 'video_i2v', 'tts'];

/** Model Manager API — list, sync, edit, set-default, probe. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as any;
	const { action } = body;
	if (!action) return json({ success: false, error: 'Missing action' }, { status: 400 });

	try {
		if (action === 'list') {
			const rows = await loadRegistry(locals.supabase, user.id);
			return json({ success: true, data: rows });
		}

		if (action === 'sync') {
			const result = await syncFromFal(locals.supabase, user.id);
			const rows = await loadRegistry(locals.supabase, user.id);
			return json({ success: true, sync: result, data: rows });
		}

		if (action === 'update') {
			const { model_id, patch } = body;
			if (!model_id || !patch || typeof patch !== 'object') {
				return json({ success: false, error: 'Missing model_id or patch' }, { status: 400 });
			}
			const clean: Record<string, unknown> = {};
			if (patch.price_usd !== undefined) {
				const v = Number(patch.price_usd);
				if (!Number.isFinite(v) || v < 0 || v > 1000) {
					return json(
						{ success: false, error: 'Price must be between 0 and 1000 USD' },
						{ status: 400 }
					);
				}
				clean.price_usd = +v.toFixed(4);
				clean.price_source = 'manual';
			}
			if (patch.quality !== undefined) {
				const q = Number(patch.quality);
				if (!Number.isInteger(q) || q < 1 || q > 10) {
					return json(
						{ success: false, error: 'Quality must be an integer 1–10' },
						{ status: 400 }
					);
				}
				clean.quality = q;
			}
			if (patch.latency_s !== undefined) {
				const l = Number(patch.latency_s);
				if (!Number.isInteger(l) || l < 0 || l > 3600) {
					return json({ success: false, error: 'Latency must be 0–3600 seconds' }, { status: 400 });
				}
				clean.latency_s = l;
			}
			if (patch.tier !== undefined) {
				if (!['budget', 'balanced', 'premium'].includes(patch.tier)) {
					return json({ success: false, error: 'Invalid tier' }, { status: 400 });
				}
				clean.tier = patch.tier;
			}
			if (patch.status !== undefined) {
				// The manager can only flip wired models between active/disabled.
				// Discovered rows stay available/quarantined until an adapter ships.
				if (!['active', 'disabled'].includes(patch.status)) {
					return json(
						{ success: false, error: 'Status can only be set to active or disabled' },
						{ status: 400 }
					);
				}
				const { data: row } = await locals.supabase
					.from('model_registry')
					.select('wired, is_default, price_usd')
					.eq('user_id', user.id)
					.eq('model_id', model_id)
					.maybeSingle();
				if (!row) return json({ success: false, error: 'Model not found' }, { status: 404 });
				if (!row.wired) {
					return json(
						{
							success: false,
							error:
								'This model is discovered but not wired yet — it cannot be enabled until its adapter ships.'
						},
						{ status: 400 }
					);
				}
				if (patch.status === 'disabled' && row.is_default) {
					return json(
						{
							success: false,
							error: 'This model is the default for its type — pick another default first.'
						},
						{ status: 400 }
					);
				}
				clean.status = patch.status;
			}
			if (Object.keys(clean).length === 0) {
				return json({ success: false, error: 'Nothing to update' }, { status: 400 });
			}
			const { data, error } = await locals.supabase
				.from('model_registry')
				.update(clean)
				.eq('user_id', user.id)
				.eq('model_id', model_id)
				.select('*')
				.maybeSingle();
			if (error) throw error;
			if (!data) return json({ success: false, error: 'Model not found' }, { status: 404 });
			return json({ success: true, data });
		}

		if (action === 'set_default') {
			const { model_id, kind } = body;
			if (!model_id || !KINDS.includes(kind)) {
				return json({ success: false, error: 'Missing model_id or invalid kind' }, { status: 400 });
			}
			const { data: row } = await locals.supabase
				.from('model_registry')
				.select('id, wired, status, kind')
				.eq('user_id', user.id)
				.eq('model_id', model_id)
				.maybeSingle();
			if (!row || row.kind !== kind) {
				return json({ success: false, error: 'Model not found for this kind' }, { status: 404 });
			}
			if (!row.wired || row.status !== 'active') {
				return json(
					{ success: false, error: 'Only an enabled, wired model can be the default.' },
					{ status: 400 }
				);
			}
			const { error: clearErr } = await locals.supabase
				.from('model_registry')
				.update({ is_default: false })
				.eq('user_id', user.id)
				.eq('kind', kind);
			if (clearErr) throw clearErr;
			const { data, error } = await locals.supabase
				.from('model_registry')
				.update({ is_default: true })
				.eq('id', row.id)
				.eq('user_id', user.id)
				.select('*')
				.single();
			if (error) throw error;
			return json({ success: true, data });
		}

		if (action === 'probe') {
			const { model_id } = body;
			if (!model_id) return json({ success: false, error: 'Missing model_id' }, { status: 400 });
			const { data: row } = await locals.supabase
				.from('model_registry')
				.select('id, kind, pricing_text, price_source, wired')
				.eq('user_id', user.id)
				.eq('model_id', model_id)
				.maybeSingle();
			if (!row) return json({ success: false, error: 'Model not found' }, { status: 404 });

			const probe = await probeModelSchema(model_id, row.kind);
			const patch: Record<string, unknown> = {
				probe,
				size_param: probe.sizeParam,
				multi_ref: probe.imageParam ? probe.imageIsArray : null,
				supports_audio: probe.audioParam != null,
				supports_duration: probe.durationParam != null
			};
			// A clean probe keeps a discovered row 'available'; an odd shape
			// quarantines it so the tile explains itself.
			if (!row.wired) patch.status = probe.ok ? 'available' : 'quarantined';
			// Opportunistic price refresh alongside the probe (manual wins).
			if (!row.wired && row.price_source !== 'manual') {
				const parsed = parsePriceText(row.pricing_text);
				if (parsed.usd != null) {
					patch.price_usd = parsed.usd;
					patch.price_source = 'parsed';
				}
			}
			const { data, error } = await locals.supabase
				.from('model_registry')
				.update(patch)
				.eq('id', row.id)
				.eq('user_id', user.id)
				.select('*')
				.single();
			if (error) throw error;
			return json({ success: true, data, probe });
		}

		return json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
	} catch (err) {
		console.error('[Models API] Error:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
