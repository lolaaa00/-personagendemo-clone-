import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import {
	ZernioClient,
	computeZernioAccountMeter,
	type ZernioAccountMeter
} from '$lib/server/social/zernio';
import { resolveZernioApiKeyForAgent } from '$lib/server/zernio-keys';
import { ALL_PLATFORM_KEYS } from '$lib/platforms';

// Platforms our connections table accepts — derived from the single platform
// registry, which the connections_platforms_expand migration keeps the DB
// CHECK constraint in step with.
const CONNECTABLE_PLATFORMS = new Set(ALL_PLATFORM_KEYS);

/** Maps a Zernio platform name onto our connections.platform vocabulary. */
function mapZernioPlatform(platform: string): string {
	const p = platform.toLowerCase();
	if (p === 'twitter') return 'x';
	return p;
}

/**
 * Ensures the persona has its own Zernio profile (the per-brand bucket that
 * isolates its connected accounts under the single shared key) and returns the
 * profileId. Provisions lazily — list-or-create by persona name — and persists
 * the id back onto the agent so it's stable across calls.
 */
async function ensureAgentProfileId(
	db: any,
	client: ZernioClient,
	agent: { id: string; name?: string | null; zernio_profile_id?: string | null }
): Promise<string | null> {
	if (agent.zernio_profile_id) return agent.zernio_profile_id;
	// Embed a short agent-id suffix so the profile name is unique even when two
	// personas share a display name — ensureProfile matches by name, so this
	// guarantees a 1:1 persona↔profile mapping rather than accidentally sharing
	// one bucket. The persona's real name still leads for dashboard readability.
	const base = (agent.name || 'Persona').trim();
	const profileName = `${base} · ${agent.id.slice(0, 8)}`;
	const profileId = await client.ensureProfile(profileName).catch(() => null);
	if (profileId) {
		// Supabase query builders are thenable but have NO `.catch` method, so
		// `.update(...).catch()` throws "catch is not a function" and took down
		// the whole connect flow. Await it and swallow via try/catch instead —
		// pinning the profile id is best-effort, not load-bearing for connect.
		try {
			await db.agents.update(agent.id, { zernio_profile_id: profileId });
		} catch {
			/* best-effort — the connection still proceeds without the pin */
		}
	}
	return profileId;
}

/**
 * Imports the persona's Zernio-connected accounts into `connections` as
 * provider='zernio' rows (idempotent upsert), scoped to the persona's own Zernio
 * profile so each persona only ever sees its own accounts. Writes live follower
 * counts when the key has analytics access. No-ops without a Zernio key. Best-effort.
 */
async function syncZernioAccounts(
	db: any,
	supabase: any,
	userId: string,
	agent: {
		id: string;
		name?: string | null;
		zernio_profile_id?: string | null;
		zernio_key_id?: string | null;
	},
	// Only provision a new Zernio profile when the caller is an explicit connect /
	// manual-sync action. check_status is a high-frequency poll — creating profiles
	// there would spin up empty profiles for never-connected personas and risk
	// double-creation under concurrent polls. Passive polls sync only if a profile
	// already exists.
	provision = false
): Promise<{ synced: string[]; skipped: string[] }> {
	const synced: string[] = [];
	const skipped: string[] = [];

	const apiKey = await resolveZernioApiKeyForAgent(supabase, userId, agent).catch(() => null);
	if (!apiKey) return { synced, skipped };

	const client = new ZernioClient(apiKey);
	const profileId = provision
		? await ensureAgentProfileId(db, client, agent)
		: agent.zernio_profile_id || null;

	// Require a resolved profile: NEVER fall back to the unscoped account list —
	// that would vacuum every account under the key into this one persona and
	// cross-contaminate every other persona's connections. Without a profile
	// (not yet provisioned, or provisioning failed), sync nothing.
	if (!profileId) {
		return { synced, skipped };
	}
	const { accounts } = await client.fetchAccounts({ profileId });
	const now = new Date().toISOString();

	for (const acc of accounts) {
		if (acc.isActive === false) continue;
		const plat = mapZernioPlatform(acc.platform);
		if (!CONNECTABLE_PLATFORMS.has(plat)) {
			skipped.push(acc.platform);
			continue;
		}
		const handle = acc.handle
			? acc.handle.startsWith('@')
				? acc.handle
				: `@${acc.handle}`
			: null;

		const { error: upErr } = await db.connections.upsert({
			user_id: userId,
			agent_id: agent.id,
			platform: plat as any,
			handle,
			followers: acc.followersCount ?? undefined,
			verified: true,
			status: 'active',
			provider: 'zernio',
			provider_account_id: acc.id,
			provider_metadata: {
				zernioPlatform: acc.platform,
				zernioProfileId: acc.profileId,
				displayName: acc.displayName,
				profilePicture: acc.profilePicture
			},
			last_error: null,
			last_checked_at: now,
			last_sync: now
		});
		if (upErr) {
			console.error(`[Accounts API] Failed to upsert Zernio connection for ${plat}:`, upErr);
		} else {
			synced.push(plat);
		}
	}

	return { synced, skipped };
}

/**
 * Live follower sync for a persona's connected accounts via Zernio follower-stats
 * (requires analytics access; degrades to a no-op otherwise). Updates the
 * `followers` column on matching connection rows. Best-effort.
 */
async function syncZernioFollowers(
	db: any,
	client: ZernioClient,
	agentId: string,
	profileId: string | null,
	conns: any[]
): Promise<void> {
	const zernioConns = conns.filter(
		(c) => String(c.provider || '').toLowerCase() === 'zernio' && c.provider_account_id
	);
	if (zernioConns.length === 0) return;

	const stats = await client.getFollowerStats(profileId ? { profileId } : undefined);
	if (stats.size === 0) return;

	for (const conn of zernioConns) {
		const followers = stats.get(String(conn.provider_account_id));
		if (typeof followers !== 'number' || followers === conn.followers) continue;
		const { error } = await db.connections
			.upsert({
				id: conn.id,
				user_id: conn.user_id,
				agent_id: agentId,
				platform: conn.platform,
				handle: conn.handle,
				followers,
				verified: true,
				status: 'active',
				last_checked_at: new Date().toISOString(),
				last_sync: new Date().toISOString()
			})
			.catch((e: any) => ({ error: e }));
		if (!error) conn.followers = followers;
	}
}

function computeDynamicMetrics(conns: any[]) {
	let totalFollowers = 0;
	let totalEngRate = 0;
	let connectedCount = 0;

	if (conns && conns.length > 0) {
		for (const conn of conns) {
			totalFollowers += conn.followers || 0;
			totalEngRate += conn.engagement_rate || 0;
			connectedCount++;
		}
	}

	const avgEngRate =
		connectedCount > 0 ? parseFloat((totalEngRate / connectedCount).toFixed(1)) : 0.0;

	let followersStr = '0';
	if (totalFollowers >= 1000000) {
		followersStr = (totalFollowers / 1000000).toFixed(1) + 'M';
	} else if (totalFollowers >= 1000) {
		followersStr = (totalFollowers / 1000).toFixed(1) + 'K';
	} else {
		followersStr = String(totalFollowers);
	}

	return {
		followers: followersStr,
		engagement_rate: avgEngRate
	};
}

/**
 * The pay-per-account billing meter, GLOBAL across the key (Zernio bills per
 * connected account, not per persona: 2 free, then $6/$3/$1 by volume). Read from
 * the full unscoped account list so the number reflects the user's real bill.
 * Best-effort — returns null on any failure so the UI just omits the meter.
 */
async function getAccountMeter(
	client: ZernioClient
): Promise<(ZernioAccountMeter & { hasAnalyticsAccess: boolean }) | null> {
	try {
		const { accounts, hasAnalyticsAccess } = await client.fetchAccounts({ includeOverLimit: true });
		return { ...computeZernioAccountMeter(accounts.length), hasAnalyticsAccess };
	} catch {
		return null;
	}
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as any;
	const { action, persona_id, platform } = body;

	if (!action) {
		return json({ success: false, error: 'Missing action' }, { status: 400 });
	}

	const db = createDbService(locals.supabase);

	const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	const isUuid = (id: string) => UUID_REGEX.test(id);

	try {
		if (action === 'check_status') {
			if (!persona_id) {
				return json({ success: false, error: 'Missing persona_id' }, { status: 400 });
			}
			if (!isUuid(persona_id)) {
				return json({ success: false, error: 'Invalid persona_id format (UUID required).' }, { status: 400 });
			}

			const { data: agent, error: agentCheckErr } = await db.agents.get(persona_id);
			if (agentCheckErr || !agent) {
				return json({ success: false, error: 'Agent not found' }, { status: 404 });
			}
			if (agent.user_id !== user.id) {
				return json({ success: false, error: 'Forbidden' }, { status: 403 });
			}

			// Best-effort: import the persona's Zernio accounts before reading status,
			// so connecting (in-app or in the Zernio dashboard) is all that's needed.
			try {
				await syncZernioAccounts(db, locals.supabase, user.id, agent);
			} catch (e) {
				console.warn('[Accounts API] Zernio account sync failed (continuing):', e);
			}

			const { data: conns, error } = await db.connections.listForAgent(persona_id);
			if (error) throw error;

			const apiKey = await resolveZernioApiKeyForAgent(locals.supabase, user.id, agent).catch(
				() => null
			);
			const client = apiKey ? new ZernioClient(apiKey) : null;

			// Live follower sync via Zernio (analytics-gated; no-op otherwise).
			if (client && conns) {
				try {
					await syncZernioFollowers(
						db,
						client,
						persona_id,
						agent.zernio_profile_id || null,
						conns
					);
				} catch (e) {
					console.warn('[Accounts API] Zernio follower sync failed (continuing):', e);
				}
			}

			// Build status for every connectable platform. Zernio-managed rows are
			// truth — their own provider verified them at connect time.
			const statusData: Record<string, any> = {};
			for (const p of CONNECTABLE_PLATFORMS) {
				const conn = conns?.find((c) => c.platform === p);
				if (conn) {
					const ownProvider = String(conn.provider || 'zernio').toLowerCase();
					// Legacy rows connected through a now-removed provider can't publish
					// or sync anymore — surface them as needing a Zernio reconnect rather
					// than showing a green "connected" that silently fails at publish time.
					const isLegacyProvider = ownProvider === 'composio' || ownProvider === 'blotato';
					const needsReauth = conn.status === 'reauth_required' || isLegacyProvider;
					statusData[p] = {
						connected: !needsReauth,
						configured: true,
						status: needsReauth ? 'reauth_required' : 'active',
						handle: conn.handle || '@connected',
						verified: !needsReauth,
						provider: isLegacyProvider ? 'zernio' : ownProvider,
						lastSync: conn.last_sync || conn.connected_at || new Date().toISOString(),
						lastError: isLegacyProvider
							? 'Linked through a retired provider — reconnect via Zernio to publish.'
							: needsReauth
								? conn.last_error || undefined
								: undefined,
						followers: conn.followers || 0,
						engagement_rate: conn.engagement_rate || 0
					};
				} else {
					statusData[p] = { connected: false, configured: true, status: 'disconnected' };
				}
			}

			// Keep agent connection count + dynamic stats current.
			if (conns) {
				try {
					const activeConns = conns.filter((conn) => {
						const prov = String(conn.provider || 'zernio').toLowerCase();
						if (prov === 'composio' || prov === 'blotato') return false; // retired
						return (
							conn.status !== 'revoked' &&
							conn.status !== 'reauth_required' &&
							conn.status !== 'error'
						);
					});
					const count = activeConns.length;
					let newStatus = agent.status;
					if (count === 0) newStatus = 'paused';
					else if (agent.status !== 'paused') newStatus = 'active';

					const { followers, engagement_rate } = computeDynamicMetrics(activeConns);
					await db.agents.update(persona_id, {
						connection_count: count,
						status: newStatus,
						followers,
						engagement_rate
					});
				} catch (err) {
					console.error('[Accounts API] Failed to update agent connection count/metrics:', err);
				}
			}

			// The pay-per-account meter (global across the key) + where to connect.
			const meter = client ? await getAccountMeter(client) : null;
			const connectHub = apiKey
				? { provider: 'zernio', url: 'https://zernio.com/dashboard' }
				: null;

			return json({ success: true, data: statusData, meter, connect_hub: connectHub });
		}

		if (action === 'sync_zernio') {
			if (!persona_id) {
				return json({ success: false, error: 'Missing persona_id' }, { status: 400 });
			}

			const { data: agent, error: agentErr } = await db.agents.get(persona_id);
			if (agentErr || !agent) {
				return json({ success: false, error: 'Agent not found' }, { status: 404 });
			}
			if (agent.user_id !== user.id) {
				return json({ success: false, error: 'Forbidden' }, { status: 403 });
			}

			const apiKey = await resolveZernioApiKeyForAgent(locals.supabase, user.id, agent);
			if (!apiKey) {
				return json(
					{
						success: false,
						error:
							'No Zernio API key available for this persona. Add one in Settings → API Keys, or fix its key assignment in the Zernio Key Manager.'
					},
					{ status: 400 }
				);
			}

			let synced: string[] = [];
			let skipped: string[] = [];
			try {
				// provision=true: manual sync is user-initiated, so create the persona's
				// Zernio profile if it doesn't exist yet.
				({ synced, skipped } = await syncZernioAccounts(db, locals.supabase, user.id, agent, true));
			} catch (e) {
				return json(
					{ success: false, error: `Failed to sync Zernio accounts: ${(e as Error).message}` },
					{ status: 502 }
				);
			}

			try {
				const { data: finalConns } = await db.connections.listForAgent(persona_id);
				const activeConns = (finalConns || []).filter(
					(c) => c.status !== 'revoked' && c.status !== 'reauth_required' && c.status !== 'error'
				);
				const count = activeConns.length;
				const { followers, engagement_rate } = computeDynamicMetrics(activeConns);
				await db.agents.update(persona_id, {
					connection_count: count,
					status: count > 0 && agent.status !== 'paused' ? 'active' : agent.status,
					followers,
					engagement_rate
				});
			} catch (err) {
				console.error('[Accounts API] Failed to update agent after Zernio sync:', err);
			}

			return json({ success: true, data: { synced, skipped, count: synced.length } });
		}

		if (action === 'initiate_connection') {
			if (!persona_id || !platform) {
				return json({ success: false, error: 'Missing persona_id or platform' }, { status: 400 });
			}
			if (!isUuid(persona_id)) {
				return json({ success: false, error: 'Invalid persona_id format (UUID required).' }, { status: 400 });
			}

			const { data: agent, error: agentErr } = await db.agents.get(persona_id);
			if (agentErr || !agent) {
				return json({ success: false, error: 'Agent not found' }, { status: 404 });
			}
			if (agent.user_id !== user.id) {
				return json({ success: false, error: 'Forbidden' }, { status: 403 });
			}

			const apiKey = await resolveZernioApiKeyForAgent(locals.supabase, user.id, agent).catch(
				() => null
			);
			if (!apiKey) {
				return json(
					{
						success: false,
						error: 'No Zernio API key available for this persona. Add one in Settings → API Keys, then connect platforms here.'
					},
					{ status: 400 }
				);
			}

			const origin = new URL(request.url).origin;
			const callbackUrl = `${origin}/personas/${persona_id}?tab=connections&connected=${encodeURIComponent(platform)}`;

			// Provision the persona's profile up-front so both the OAuth link and the
			// dashboard fallback can file the account under the correct bucket.
			const client = new ZernioClient(apiKey);
			// Provisioning the persona's profile is best-effort and must NOT block the
			// connect click: if Zernio is slow, proceed without the profile id (sync
			// re-files the account later) so the request returns well within the
			// proxy's timeout instead of being dropped as "Failed to fetch".
			const profileId = await Promise.race([
				ensureAgentProfileId(db, client, agent).catch(() => null),
				new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 10_000))
			]);
			const profileName = `${(agent.name || 'Persona').trim()} · ${agent.id.slice(0, 8)}`;

			// Hosted Zernio OAuth, filed under the persona's own profile. On success
			// Zernio bounces back to the Connections tab and check_status imports it.
			try {
				const authUrl = await client.getConnectUrl(platform, callbackUrl, profileId || undefined);
				return json({ success: true, data: { redirect_url: authUrl, provider: 'zernio' } });
			} catch (e) {
				console.warn(
					`[Accounts API] Zernio connect-link failed for ${platform} (${(e as Error).message}) — forwarding to dashboard.`
				);
				// Some platforms (e.g. Bluesky app-password, Telegram code flow) have no
				// hosted GET connect link. Forward to the dashboard, but tell the user to
				// pick THIS persona's profile — accounts connected under a different
				// profile won't import here (our sync is profile-scoped by design).
				return json({
					success: true,
					data: {
						redirect_url: 'https://zernio.com/dashboard/accounts',
						provider: 'zernio-dashboard',
						note: `${platform} connects in the Zernio dashboard. Select the profile "${profileName}" so it imports to this persona, then return and refresh.`
					}
				});
			}
		}

		if (action === 'disconnect') {
			if (!persona_id || !platform) {
				return json({ success: false, error: 'Missing persona_id or platform' }, { status: 400 });
			}
			if (!isUuid(persona_id)) {
				return json({ success: false, error: 'Invalid persona_id format (UUID required).' }, { status: 400 });
			}

			const { data: agent, error: agentErr } = await db.agents.get(persona_id);
			if (agentErr || !agent) {
				return json({ success: false, error: 'Agent not found' }, { status: 404 });
			}
			if (agent.user_id !== user.id) {
				return json({ success: false, error: 'Forbidden' }, { status: 403 });
			}

			// Also disconnect in Zernio so the account stops accruing its per-account
			// charge — under pay-per-account billing, a local-only hide would keep
			// costing money. Best-effort; the local delete proceeds regardless.
			try {
				const { data: existing } = await db.connections.listForAgent(persona_id);
				const target = (existing || []).find((c) => c.platform === platform);
				const apiKey = await resolveZernioApiKeyForAgent(locals.supabase, user.id, agent).catch(
					() => null
				);
				if (apiKey && target?.provider_account_id) {
					await new ZernioClient(apiKey).disconnectAccount(String(target.provider_account_id));
				}
			} catch (e) {
				console.warn('[Accounts API] Zernio account disconnect failed (continuing):', e);
			}

			const { error: delErr } = await db.connections.delete(persona_id, platform);
			if (delErr) throw delErr;

			try {
				const { data: finalConns } = await db.connections.listForAgent(persona_id);
				const count = finalConns?.length || 0;
				let newStatus = agent.status;
				if (count === 0) newStatus = 'paused';
				else if (agent.status !== 'paused') newStatus = 'active';
				const { followers, engagement_rate } = computeDynamicMetrics(finalConns || []);
				await db.agents.update(persona_id, {
					connection_count: count,
					status: newStatus,
					followers,
					engagement_rate
				});
			} catch (err) {
				console.error('[Accounts API] Failed to update agent on disconnect:', err);
			}

			return json({ success: true });
		}

		return json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
	} catch (err) {
		console.error('[Accounts API] Error processing action:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
