import { json } from '@sveltejs/kit';
import { entitlementsFor, planRefusal } from '$lib/server/entitlements';
import { byokReason, isByokGated, providerById } from '$lib/providers';
import type { RequestHandler } from './$types';
import {
	encryptSecret,
	getUserApiKey,
	isSupportedProvider,
	maskApiKey,
	sanitizeKeyMetadata,
	type UserKeyProvider
} from '$lib/server/user-api-keys';

async function requireUser(locals: App.Locals) {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return null;
	return user;
}

async function testProviderKey(provider: UserKeyProvider, apiKey: string) {
	if (provider === 'zernio') {
		const res = await fetch('https://zernio.com/api/v1/accounts', {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: 'application/json'
			}
		});

		if (res.ok) return { status: 'valid' as const, error: null };
		const text = await res.text().catch(() => '');
		return {
			status: res.status === 401 || res.status === 403 ? ('invalid' as const) : ('error' as const),
			error: text ? `Zernio returned HTTP ${res.status}: ${text.slice(0, 180)}` : `Zernio returned HTTP ${res.status}`
		};
	}

	if (provider === 'gemini') {
		const res = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
			{ method: 'GET' }
		);
		if (res.ok) return { status: 'valid' as const, error: null };
		return { status: res.status === 400 || res.status === 403 ? ('invalid' as const) : ('error' as const), error: `Gemini returned HTTP ${res.status}` };
	}

	if (provider === 'firecrawl') {
		const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'] })
		});
		if (res.ok) return { status: 'valid' as const, error: null };
		return { status: res.status === 401 || res.status === 403 ? ('invalid' as const) : ('error' as const), error: `Firecrawl returned HTTP ${res.status}` };
	}

	if (provider === 'openrouter') {
		const res = await fetch('https://openrouter.ai/api/v1/models', {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: 'application/json'
			}
		});
		if (res.ok) return { status: 'valid' as const, error: null };
		return { status: res.status === 401 || res.status === 403 ? ('invalid' as const) : ('error' as const), error: `OpenRouter returned HTTP ${res.status}` };
	}

	if (provider === 'kie_ai') {
		const res = await fetch('https://api.kie.ai/api/v1/account/credits', {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: 'application/json'
			}
		});
		if (res.ok) return { status: 'valid' as const, error: null };
		return { status: res.status === 401 || res.status === 403 ? ('invalid' as const) : ('error' as const), error: `Kie AI returned HTTP ${res.status}` };
	}

	if (provider === 'fal_ai') {
		const res = await fetch('https://queue.fal.run/fal-ai/fast-sdxl/requests/test/status', {
			method: 'GET',
			headers: {
				Authorization: `Key ${apiKey}`,
				Accept: 'application/json'
			}
		});
		// A valid Fal key can still return 404 for a fake request ID; auth failures return 401/403.
		if (res.ok || res.status === 404) return { status: 'valid' as const, error: null };
		return { status: res.status === 401 || res.status === 403 ? ('invalid' as const) : ('error' as const), error: `Fal AI returned HTTP ${res.status}` };
	}

	return { status: 'error' as const, error: 'Unsupported provider' };
}

export const GET: RequestHandler = async ({ locals }) => {
	const user = await requireUser(locals);
	if (!user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

	const { data, error } = await locals.supabase
		.from('user_api_keys')
		.select('provider, masked_value, status, last_error, last_tested_at, updated_at')
		.eq('user_id', user.id)
		.order('provider');

	if (error) return json({ success: false, error: error.message }, { status: 500 });
	return json({ success: true, keys: (data || []).map(sanitizeKeyMetadata) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireUser(locals);
	if (!user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json()) as any;
	const action = body.action || 'save';
	const provider = String(body.provider || '').toLowerCase();

	// A provider the catalogue knows about but which can NEVER take a customer
	// key answers with the reason, not with a bare "unsupported" — an absence
	// that reads like an oversight is the thing the catalogue exists to end.
	const catalogued = providerById(provider);
	const cataloguedRefusal = catalogued ? byokReason(catalogued) : null;
	if (cataloguedRefusal) {
		return json({ success: false, error: cataloguedRefusal }, { status: 400 });
	}

	if (!isSupportedProvider(provider)) {
		return json({ success: false, error: 'Unsupported provider' }, { status: 400 });
	}

	// "Bring your own keys — generation at no charge" is an Agency line, and it
	// is already true mechanically: keySourceFor marks the event 'byo' and
	// charge() skips every non-platform row. Only the GENERATION providers are
	// gated — that set is DERIVED from the provider catalogue ($lib/providers),
	// which is also what the Settings page reads, so the two cannot disagree.
	// Zernio is how every plan publishes and Firecrawl is how briefs are
	// researched; gating those would break features Free is promised.
	if (action === 'save' && isByokGated(provider)) {
		const ent = await entitlementsFor(user.id);
		if (!ent.byok) return json(planRefusal('Bringing your own generation keys', ent.plan), { status: 403 });
	}

	try {
		if (action === 'save') {
			const apiKey = String(body.apiKey || '').trim();
			if (apiKey.length < 8) {
				return json({ success: false, error: 'API key is too short.' }, { status: 400 });
			}

			const encrypted = encryptSecret(apiKey);
			const masked = maskApiKey(apiKey);
			const { data, error } = await locals.supabase
				.from('user_api_keys')
				.upsert(
					{
						user_id: user.id,
						provider,
						...encrypted,
						...masked,
						status: 'untested',
						last_error: null,
						last_tested_at: null
					},
					{ onConflict: 'user_id,provider' }
				)
				.select('provider, masked_value, status, last_error, last_tested_at, updated_at')
				.single();

			if (error) throw error;
			return json({ success: true, key: sanitizeKeyMetadata(data) });
		}

		if (action === 'test') {
			const apiKey = await getUserApiKey(locals.supabase, user.id, provider);
			if (!apiKey) return json({ success: false, error: 'No saved key for this provider.' }, { status: 404 });

			const result = await testProviderKey(provider, apiKey);
			const { data, error } = await locals.supabase
				.from('user_api_keys')
				.update({
					status: result.status,
					last_error: result.error,
					last_tested_at: new Date().toISOString()
				})
				.eq('user_id', user.id)
				.eq('provider', provider)
				.select('provider, masked_value, status, last_error, last_tested_at, updated_at')
				.single();

			if (error) throw error;
			return json({ success: result.status === 'valid', key: sanitizeKeyMetadata(data), error: result.error });
		}

		return json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
	} catch (err) {
		console.error('[API Keys] Request failed:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};

// Retired providers no longer offered in the UI, but existing stored rows must
// remain deletable so users can clean them up.
const LEGACY_KEY_PROVIDERS = ['blotato', 'composio'];

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const user = await requireUser(locals);
	if (!user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json()) as any;
	const provider = String(body.provider || '').toLowerCase();
	if (!isSupportedProvider(provider) && !LEGACY_KEY_PROVIDERS.includes(provider)) {
		return json({ success: false, error: 'Unsupported provider' }, { status: 400 });
	}

	const { error } = await locals.supabase
		.from('user_api_keys')
		.delete()
		.eq('user_id', user.id)
		.eq('provider', provider);

	if (error) return json({ success: false, error: error.message }, { status: 500 });
	return json({ success: true });
};
