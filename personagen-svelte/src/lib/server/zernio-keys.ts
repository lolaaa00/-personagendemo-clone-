import { readStoredSecret } from '$lib/server/user-api-keys';
import { getZernioApiKey } from '$lib/server/social/zernio';

/**
 * Zernio Key Manager — per-persona Zernio API keys.
 *
 * The default architecture is ONE user-level Zernio key (user_api_keys
 * provider='zernio', else env ZERNIO_API_KEY) with one Zernio *profile* per
 * persona. This module layers optional EXTRA keys on top (zernio_keys table):
 * each extra key is a whole separate Zernio account (its own email, its own
 * 2-free-account slots, its own bill), assignable to personas via
 * agents.zernio_key_id.
 *
 * Resolution rule — deliberate, no silent fallback: a persona with an ASSIGNED
 * key resolves to that key or to null. Falling back to the default key when the
 * assigned one is missing/broken would provision profiles and publish under the
 * WRONG Zernio account (wrong bill, wrong social accounts), which is far worse
 * than a loud "no key" failure.
 */

/** Fields the resolver needs from an agent row. */
export interface AgentKeyRouting {
	zernio_key_id?: string | null;
	zernio_profile_id?: string | null;
}

/**
 * Decrypts one managed key by id. Null when the row doesn't exist. The
 * ciphertext is read through the service role (readStoredSecret), scoped by
 * user_id — never through the caller's `authenticated` client. A row that
 * will not decrypt is stamped status='error' and the error is rethrown.
 */
export async function getZernioKeySecretById(
	supabase: any,
	userId: string,
	keyId: string
): Promise<string | null> {
	return readStoredSecret(supabase, 'zernio_keys', { user_id: userId, id: keyId });
}

/**
 * The Zernio API key a persona publishes/connects through: its assigned managed
 * key when `zernio_key_id` is set, otherwise the user's default key. Pass
 * agent=null for user-level flows with no persona in play.
 */
export async function resolveZernioApiKeyForAgent(
	supabase: any,
	userId: string,
	agent: AgentKeyRouting | null | undefined
): Promise<string | null> {
	if (agent?.zernio_key_id) {
		return getZernioKeySecretById(supabase, userId, agent.zernio_key_id);
	}
	return getZernioApiKey(supabase, userId);
}

/**
 * One-query variant for callers that only hold an agent id (publisher,
 * analytics sync): fetches the agent's key routing and resolves the key.
 * Returns the profile id too — the same callers always need it next.
 */
export async function getAgentZernioRouting(
	supabase: any,
	userId: string,
	agentId?: string | null
): Promise<{ apiKey: string | null; profileId: string | null; keyRef: string }> {
	let agent: AgentKeyRouting | null = null;
	if (agentId) {
		const { data } = await supabase
			.from('agents')
			.select('zernio_key_id, zernio_profile_id')
			.eq('id', agentId)
			.maybeSingle();
		agent = data || null;
	}
	const apiKey = await resolveZernioApiKeyForAgent(supabase, userId, agent);
	// keyRef identifies WHICH key this routing resolved ('default' or a
	// zernio_keys id). Callers that create Zernio resources (publish!) must
	// persist it next to the resource id: each managed key is a separate Zernio
	// ACCOUNT, so any later read-back (publish verification, analytics,
	// unpublish) must use the creating key — re-deriving routing later silently
	// 403s if the persona's assignment changed in the meantime.
	return {
		apiKey,
		profileId: agent?.zernio_profile_id || null,
		keyRef: agent?.zernio_key_id || 'default'
	};
}

/** Resolves a persisted key_ref ('default' | zernio_keys id) back to a secret. */
export async function resolveZernioKeyByRef(
	supabase: any,
	userId: string,
	keyRef: string | null | undefined
): Promise<string | null> {
	if (keyRef && keyRef !== 'default') {
		return getZernioKeySecretById(supabase, userId, keyRef);
	}
	return getZernioApiKey(supabase, userId);
}
