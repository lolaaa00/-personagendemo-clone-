import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { encryptSecret, maskApiKey } from '$lib/server/user-api-keys';
import { getZernioKeySecretById } from '$lib/server/zernio-keys';
import { ZernioClient, computeZernioAccountMeter } from '$lib/server/social/zernio';

/**
 * Zernio Key Manager API — multiple Zernio accounts (one per agent email),
 * each stored as an encrypted zernio_keys row and assignable per persona.
 * Why: Zernio's 2-free-connected-accounts allowance is PER KEY, so each extra
 * key adds two free slots and isolates that persona's bill.
 */

const KEY_META_COLUMNS = 'id, label, masked_value, status, last_error, last_tested_at, updated_at, created_at';

async function requireUser(locals: App.Locals) {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) return null;
	return user;
}

function sanitizeKey(row: any) {
	return {
		id: row.id,
		label: row.label,
		masked_value: row.masked_value,
		status: row.status || 'untested',
		last_error: row.last_error || null,
		last_tested_at: row.last_tested_at || null,
		updated_at: row.updated_at || null
	};
}

/**
 * A key assignment change moves the persona to a DIFFERENT Zernio account, so
 * its profile id and connected accounts from the old account are meaningless
 * there: clear the profile (re-provisioned on next connect/sync) and flag the
 * old connections for reconnect instead of leaving a green "connected" that
 * would fail at publish time.
 */
async function invalidateAgentZernioState(supabase: any, userId: string, agentId: string) {
	await supabase
		.from('connections')
		.update({
			status: 'reauth_required',
			last_error:
				'Zernio key changed for this persona — reconnect this account under the new key.'
		})
		.eq('user_id', userId)
		.eq('agent_id', agentId)
		.eq('provider', 'zernio');
}

export const GET: RequestHandler = async ({ locals }) => {
	const user = await requireUser(locals);
	if (!user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

	const [keysRes, agentsRes] = await Promise.all([
		locals.supabase
			.from('zernio_keys')
			.select(KEY_META_COLUMNS)
			.eq('user_id', user.id)
			.order('created_at'),
		locals.supabase
			.from('agents')
			.select('id, name, handle, zernio_key_id')
			.eq('user_id', user.id)
			.order('created_at')
	]);

	if (keysRes.error) return json({ success: false, error: keysRes.error.message }, { status: 500 });
	if (agentsRes.error)
		return json({ success: false, error: agentsRes.error.message }, { status: 500 });

	return json({
		success: true,
		keys: (keysRes.data || []).map(sanitizeKey),
		agents: agentsRes.data || []
	});
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireUser(locals);
	if (!user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json()) as any;
	const action = body.action || 'save';

	try {
		if (action === 'save') {
			const label = String(body.label || '').trim().slice(0, 80);
			const apiKey = String(body.apiKey || '').trim();
			if (!label) return json({ success: false, error: 'A label is required (e.g. the Zernio account email).' }, { status: 400 });
			if (apiKey.length < 8) return json({ success: false, error: 'API key is too short.' }, { status: 400 });

			const encrypted = encryptSecret(apiKey);
			const masked = maskApiKey(apiKey);
			// Same label = same Zernio account being rotated → replace in place so
			// persona assignments (FK by id) survive the key rotation.
			const { data, error } = await locals.supabase
				.from('zernio_keys')
				.upsert(
					{
						user_id: user.id,
						label,
						...encrypted,
						...masked,
						status: 'untested',
						last_error: null,
						last_tested_at: null
					},
					{ onConflict: 'user_id,label' }
				)
				.select(KEY_META_COLUMNS)
				.single();

			if (error) throw error;
			return json({ success: true, key: sanitizeKey(data) });
		}

		if (action === 'test') {
			const id = String(body.id || '');
			// The ciphertext is read through the service role, scoped to this user —
			// locals.supabase is the `authenticated` role and (stage B) no longer
			// holds SELECT on the secret columns. A row that will not decrypt throws
			// here after stamping itself status='error', and the catch below reports it.
			const secret = await getZernioKeySecretById(locals.supabase, user.id, id);
			if (!secret) return json({ success: false, error: 'Key not found.' }, { status: 404 });

			// /accounts doubles as auth probe AND slot meter for this key.
			let status: 'valid' | 'invalid' | 'error' = 'valid';
			let lastError: string | null = null;
			let meter: ReturnType<typeof computeZernioAccountMeter> | null = null;
			try {
				const { accounts } = await new ZernioClient(secret).fetchAccounts({
					includeOverLimit: true
				});
				meter = computeZernioAccountMeter(accounts.length);
			} catch (e) {
				const msg = (e as Error).message || 'Zernio request failed';
				status = /HTTP 401|HTTP 403/.test(msg) ? 'invalid' : 'error';
				lastError = msg;
			}

			const { data, error } = await locals.supabase
				.from('zernio_keys')
				.update({ status, last_error: lastError, last_tested_at: new Date().toISOString() })
				.eq('user_id', user.id)
				.eq('id', id)
				.select(KEY_META_COLUMNS)
				.single();
			if (error) throw error;
			return json({ success: status === 'valid', key: sanitizeKey(data), meter, error: lastError });
		}

		if (action === 'assign') {
			const agentId = String(body.agent_id || '');
			const keyId = body.key_id ? String(body.key_id) : null;

			const { data: agent, error: agentErr } = await locals.supabase
				.from('agents')
				.select('id, user_id, zernio_key_id')
				.eq('id', agentId)
				.maybeSingle();
			if (agentErr) throw agentErr;
			if (!agent) return json({ success: false, error: 'Persona not found.' }, { status: 404 });
			if (agent.user_id !== user.id) return json({ success: false, error: 'Forbidden' }, { status: 403 });

			if (keyId) {
				const { data: keyRow } = await locals.supabase
					.from('zernio_keys')
					.select('id')
					.eq('user_id', user.id)
					.eq('id', keyId)
					.maybeSingle();
				if (!keyRow) return json({ success: false, error: 'Key not found.' }, { status: 404 });
			}

			if ((agent.zernio_key_id || null) === keyId) {
				return json({ success: true, changed: false });
			}

			// Different key = different Zernio account: the old profile id is invalid
			// there. Clear it so ensureAgentProfileId re-provisions under the new key.
			const { error: updErr } = await locals.supabase
				.from('agents')
				.update({ zernio_key_id: keyId, zernio_profile_id: null })
				.eq('id', agentId)
				.eq('user_id', user.id);
			if (updErr) throw updErr;

			await invalidateAgentZernioState(locals.supabase, user.id, agentId);
			return json({ success: true, changed: true });
		}

		return json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
	} catch (err) {
		console.error('[Zernio Keys] Request failed:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const user = await requireUser(locals);
	if (!user) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

	const body = (await request.json()) as any;
	const id = String(body.id || '');
	if (!id) return json({ success: false, error: 'Missing key id.' }, { status: 400 });

	try {
		// Revert assigned personas to the default key BEFORE deleting: the FK's
		// ON DELETE SET NULL would null zernio_key_id anyway, but their profile ids
		// and connections belong to the deleted key's Zernio account and must be
		// invalidated explicitly.
		const { data: assigned } = await locals.supabase
			.from('agents')
			.select('id')
			.eq('user_id', user.id)
			.eq('zernio_key_id', id);

		for (const a of assigned || []) {
			await locals.supabase
				.from('agents')
				.update({ zernio_key_id: null, zernio_profile_id: null })
				.eq('id', a.id)
				.eq('user_id', user.id);
			await invalidateAgentZernioState(locals.supabase, user.id, a.id);
		}

		const { error } = await locals.supabase
			.from('zernio_keys')
			.delete()
			.eq('user_id', user.id)
			.eq('id', id);
		if (error) throw error;

		return json({ success: true, unassigned: (assigned || []).length });
	} catch (err) {
		console.error('[Zernio Keys] Delete failed:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
