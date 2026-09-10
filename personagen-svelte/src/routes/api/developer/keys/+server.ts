import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateApiKey } from '$lib/server/api-keys';
import { entitlementsFor, planRefusal } from '$lib/server/entitlements';

/** List the caller's API keys (never the plaintext — only prefix + metadata). */
export const GET: RequestHandler = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}
	const { data, error } = await locals.supabase
		.from('api_keys')
		.select('id, label, key_prefix, last_used_at, revoked_at, created_at')
		.order('created_at', { ascending: false });
	if (error) return json({ success: false, error: error.message }, { status: 500 });
	return json({ success: true, keys: data ?? [] });
};

/**
 * Create a key. The plaintext is returned ONCE here and never stored — only its
 * hash is persisted. The key inherits the creating seat's workspace role, so an
 * admin's key can publish, a creator's key can only draft.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}
	// "API access" is an Agency line. Minting is gated; LISTING and REVOKING are
	// not, so a plan change never strands a key the user cannot see or turn off.
	const ent = await entitlementsFor(user.id);
	if (!ent.apiAccess) return json(planRefusal('API access', ent.plan), { status: 403 });

	const body = (await request.json().catch(() => ({}))) as { label?: string };
	const label = (body.label || '').trim();
	if (!label || label.length > 120) {
		return json({ success: false, error: 'Give the key a label (1–120 chars)' }, { status: 400 });
	}

	const { plaintext, hash, prefix } = generateApiKey();
	const { data, error } = await locals.supabase
		.from('api_keys')
		.insert({ user_id: user.id, label, key_hash: hash, key_prefix: prefix })
		.select('id, label, key_prefix, created_at')
		.single();
	if (error) return json({ success: false, error: error.message }, { status: 500 });

	return json({
		success: true,
		key: data,
		// Shown once — the client must copy it now; we can never display it again.
		plaintext
	});
};

/** Revoke a key (soft — keeps the audit row, stops it authenticating). */
export const DELETE: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}
	const body = (await request.json().catch(() => ({}))) as { id?: string };
	if (!body.id) return json({ success: false, error: 'Missing key id' }, { status: 400 });

	const { error, count } = await locals.supabase
		.from('api_keys')
		.update({ revoked_at: new Date().toISOString() }, { count: 'exact' })
		.eq('id', body.id)
		.is('revoked_at', null);
	if (error) return json({ success: false, error: error.message }, { status: 500 });
	if (!count) return json({ success: false, error: 'Key not found or already revoked' }, { status: 404 });
	return json({ success: true });
};
