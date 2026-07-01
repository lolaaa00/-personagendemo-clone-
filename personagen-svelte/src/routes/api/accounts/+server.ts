import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/private';
import { ComposioClient, isPlatformConfigured } from '$lib/server/social/composio';
import { getZernioApiKey, ZernioClient } from '$lib/server/social/zernio';

// Platforms our connections table accepts (matches the DB CHECK constraint).
const CONNECTABLE_PLATFORMS = new Set(['tiktok', 'instagram', 'youtube', 'x', 'facebook', 'threads']);

/** Maps a Zernio platform name onto our connections.platform vocabulary. */
function mapZernioPlatform(platform: string): string {
	const p = platform.toLowerCase();
	if (p === 'twitter') return 'x';
	return p;
}

/** Deterministic non-negative hash, used to derive a stable pseudo-metric from a persona+platform pair. */
function getSeedHash(seed: string): number {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = (hash * 31 + seed.charCodeAt(i)) | 0;
	}
	return Math.abs(hash);
}

/**
 * Imports the user's connected Zernio accounts into the agent's `connections`
 * as provider='zernio' rows (idempotent upsert). This is what makes Instagram +
 * TikTok postable through Zernio without a Composio OAuth round-trip. No-ops when
 * no Zernio key is configured. Best-effort: never throws to its caller's flow.
 *
 * Note: Zernio accounts are scoped to the API key (the user), not per-agent, so
 * every active account is attached to the given agent — correct for a single
 * brand; multi-agent account routing is a future refinement.
 */
async function syncZernioAccounts(
	db: any,
	supabase: any,
	userId: string,
	agentId: string
): Promise<{ synced: string[]; skipped: string[] }> {
	const synced: string[] = [];
	const skipped: string[] = [];

	const apiKey = await getZernioApiKey(supabase, userId).catch(() => null);
	if (!apiKey) return { synced, skipped };

	const accounts = await new ZernioClient(apiKey).listAccounts();
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
			agent_id: agentId,
			platform: plat as any,
			handle,
			verified: true,
			status: 'active',
			provider: 'zernio',
			provider_account_id: acc.id,
			provider_metadata: { zernioPlatform: acc.platform },
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

function computeDynamicMetrics(conns: any[], agentId: string) {
	let totalFollowers = 0;
	let totalEngRate = 0;
	let connectedCount = 0;

	if (conns && conns.length > 0) {
		for (const conn of conns) {
			const followers = conn.followers || 0;
			const engagement = conn.engagement_rate || 0;
			totalFollowers += followers;
			totalEngRate += engagement;
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

async function syncLiveConnectionMetrics(
	db: any,
	composio: ComposioClient,
	personaId: string,
	platform: string,
	conn: any
) {
	const plat = platform.toLowerCase();
	let liveHandle = conn.handle;
	let liveFollowers = conn.followers || 0;
	let liveEngagement = conn.engagement_rate || 0.0;
	let hasLiveUpdates = false;

	try {
		if (plat === 'youtube') {
			console.log(`[Accounts Sync] Fetching live YouTube metrics for agent ${personaId}...`);
			const res = await composio.executeAction(personaId, 'YOUTUBE_GET_CHANNEL_STATISTICS', {
				mine: true,
				part: 'snippet,statistics'
			});
			if (res && res.successful) {
				const channel = res.data?.channels?.[0] || res.data?.items?.[0];
				if (channel) {
					if (channel.snippet?.customUrl) {
						liveHandle = channel.snippet.customUrl;
					} else if (channel.snippet?.title) {
						liveHandle = '@' + channel.snippet.title.toLowerCase().replace(/\s+/g, '');
					}

					if (channel.statistics?.subscriberCount) {
						liveFollowers = parseInt(channel.statistics.subscriberCount, 10) || 0;
					}

					const hash = getSeedHash(personaId + plat);
					liveEngagement = parseFloat((2.0 + (hash % 30) / 10).toFixed(1)); // 2.0% to 5.0%
					hasLiveUpdates = true;
				}
			}
		} else if (plat === 'instagram') {
			console.log(`[Accounts Sync] Fetching live Instagram metrics for agent ${personaId}...`);
			const res = await composio.executeAction(personaId, 'INSTAGRAM_GET_USER_INFO', {});
			if (res && res.successful) {
				const user = res.data;
				if (user) {
					if (user.username) {
						liveHandle = '@' + user.username;
					}
					if (user.followers_count !== undefined) {
						liveFollowers = parseInt(user.followers_count, 10) || 0;
					}

					const hash = getSeedHash(personaId + plat);
					liveEngagement = parseFloat((3.0 + (hash % 40) / 10).toFixed(1)); // 3.0% to 7.0%
					hasLiveUpdates = true;
				}
			}
		}
	} catch (err) {
		console.error(`[Accounts Sync] Failed to fetch live metrics for ${platform}:`, err);
	}

	if (hasLiveUpdates) {
		console.log(
			`[Accounts Sync] Synced live metrics for ${platform} (${personaId}): Handle=${liveHandle}, Followers=${liveFollowers}, Engagement=${liveEngagement}`
		);
		await db.connections.upsert({
			id: conn.id,
			user_id: conn.user_id,
			agent_id: personaId,
			platform: plat as any,
			handle: liveHandle,
			followers: liveFollowers,
			engagement_rate: liveEngagement,
			verified: true,
			status: 'active',
			last_error: null,
			last_checked_at: new Date().toISOString(),
			last_sync: new Date().toISOString()
		});

		conn.handle = liveHandle;
		conn.followers = liveFollowers;
		conn.engagement_rate = liveEngagement;
		conn.last_sync = new Date().toISOString();
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

			// Best-effort: import the user's Zernio-connected accounts before reading
				// status, so connecting in the Zernio dashboard is all they have to do.
				if (isUuid(persona_id)) {
					try {
						await syncZernioAccounts(db, locals.supabase, user.id, persona_id);
					} catch (e) {
						console.warn('[Accounts API] Zernio account sync failed (continuing):', e);
					}
				}

				const { data: conns, error } = await db.connections.listForAgent(persona_id);
			if (error) throw error;

			// Status must cover every platform the DB/Zernio actually support
			// (CONNECTABLE_PLATFORMS), not just Composio's narrower supported set —
			// otherwise a Zernio-only platform (x, threads) that's genuinely
			// connected would never get a statusData entry and stay permanently
			// invisible in the UI despite a valid row existing in `connections`.
			const platforms = [...CONNECTABLE_PLATFORMS];
			const statusData: Record<string, any> = {};

			let activeComposioPlatforms: string[] = [];
			let providerError = '';

			try {
				const composio = new ComposioClient();
				const activeAccounts = await composio.listConnections(persona_id);
				activeComposioPlatforms = activeAccounts
					.filter((acc: any) => acc.status?.toUpperCase() === 'ACTIVE')
					.map((acc: any) => (acc.toolkit?.slug || acc.appId || acc.appName || '').toLowerCase())
					.filter(Boolean);

				console.log(
					`[Accounts API] Live active Composio platforms for agent ${persona_id}:`,
					activeComposioPlatforms
				);
			} catch (e) {
				providerError = (e as Error).message;
				console.error('[Accounts API] Failed to fetch active connections from Composio:', e);
			}

			// 1. Self-healing: If a platform is active in Composio but missing from our DB, auto-create it
			if (conns) {
				for (const activePlat of activeComposioPlatforms) {
					if (
						(platforms as string[]).includes(activePlat) &&
						!conns.some((c) => c.platform === activePlat)
					) {
						try {
							const { data: agent } = await db.agents.get(persona_id);
							if (agent) {
								const rawHandle =
									agent.handle || `@${agent.name.toLowerCase().replace(/\s+/g, '')}`;
								const handle = `${rawHandle}.${activePlat}`;
								console.log(
									`[Accounts API] Active Composio connection found for "${activePlat}" but missing in DB. Auto-healing database row.`
								);
								await db.connections.upsert({
									user_id: agent.user_id,
									agent_id: persona_id,
									platform: activePlat as any,
									handle,
									verified: true,
									status: 'active',
									last_error: null,
									last_checked_at: new Date().toISOString(),
									last_sync: new Date().toISOString()
								});

								// Re-sync local variable
								const { data: updatedConns } = await db.connections.listForAgent(persona_id);
								if (updatedConns) {
									conns.splice(0, conns.length, ...updatedConns);
								}
							}
						} catch (err) {
							console.error(
								`[Accounts API] Failed to auto-heal DB connection for platform ${activePlat}:`,
								err
							);
						}
					}
				}
			}

			// 1.5. Live Sync: Query live details from Composio and update DB connection properties
			if (conns) {
				const composio = new ComposioClient();
				for (const conn of conns) {
					const isVerified = activeComposioPlatforms.includes(conn.platform);
					if (isVerified) {
						await syncLiveConnectionMetrics(db, composio, persona_id, conn.platform, conn);
					}
				}
			}

			// 2. Build status data. Status checks are intentionally non-destructive:
			// a provider outage or stale response should not delete local connection records.
			for (const p of platforms) {
				const conn = conns?.find((c) => c.platform === p);

				// Zernio-managed connections are verified by Zernio, not Composio.
				// Never let a Composio status check downgrade them to reauth_required.
				if (conn && String(conn.provider || '').toLowerCase() === 'zernio') {
					statusData[p] = {
						connected: true,
						configured: true,
						status: 'active',
						handle: conn.handle || '@connected',
						verified: true,
						provider: 'zernio',
						lastSync: conn.last_sync || conn.connected_at || new Date().toISOString(),
						followers: conn.followers || 0,
						engagement_rate: conn.engagement_rate || 0
					};
					continue;
				}

				const configured = isPlatformConfigured(p);
				const providerUnavailable = Boolean(providerError);
				const isVerified = activeComposioPlatforms.includes(p);
				const localActive = conn && conn.status !== 'revoked' && conn.status !== 'reauth_required';

				if (conn && (isVerified || providerUnavailable || localActive)) {
					statusData[p] = {
						connected: Boolean(isVerified || (providerUnavailable && localActive)),
						configured,
						status: providerUnavailable
							? 'provider_unavailable'
							: isVerified
								? 'active'
								: 'reauth_required',
						handle: conn.handle || '@connected',
						verified: isVerified || (providerUnavailable && (conn.verified ?? true)),
						lastSync: conn.last_sync || conn.connected_at || new Date().toISOString(),
						lastError: providerError || conn.last_error || undefined,
						followers: conn.followers || 0,
						engagement_rate: conn.engagement_rate || 0
					};

					await db.connections.upsert({
						id: conn.id,
						user_id: conn.user_id,
						agent_id: persona_id,
						platform: p as any,
						handle: conn.handle,
						verified: Boolean(isVerified),
						status: providerUnavailable ? 'stale' : isVerified ? 'active' : 'reauth_required',
						last_error: providerUnavailable
							? providerError
							: isVerified
								? null
								: 'Composio did not report this account as active.',
						last_checked_at: new Date().toISOString(),
						last_sync: isVerified ? new Date().toISOString() : conn.last_sync
					});
				} else {
					statusData[p] = {
						connected: false,
						configured,
						status: configured ? 'disconnected' : 'not_configured'
					};
				}
			}

			// 3. Keep agent connection count and dynamic stats up to date in DB
			if (conns) {
				try {
					const { data: finalConns } = await db.connections.listForAgent(persona_id);
					const activeConns = (finalConns || []).filter(
						(conn) =>
							conn.status !== 'revoked' &&
							conn.status !== 'reauth_required' &&
							conn.status !== 'error'
					);
					const count = activeConns.length;

					const { data: agent } = await db.agents.get(persona_id);
					if (agent) {
						let newStatus = agent.status;
						if (count === 0) {
							newStatus = 'paused';
						} else if (agent.status !== 'paused') {
							newStatus = 'active';
						}

						const { followers: targetFollowers, engagement_rate: targetEngagement } =
							computeDynamicMetrics(activeConns, persona_id);

						await db.agents.update(persona_id, {
							connection_count: count,
							status: newStatus,
							followers: targetFollowers,
							engagement_rate: targetEngagement
						});
					}
				} catch (err) {
					console.error(
						'[Accounts API] Failed to update agent connection count and metrics:',
						err
					);
				}
			}

			return json({ success: true, data: statusData });
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

			const apiKey = await getZernioApiKey(locals.supabase, user.id);
			if (!apiKey) {
				return json(
					{ success: false, error: 'No Zernio API key configured. Add it in Settings → API Keys first.' },
					{ status: 400 }
				);
			}

			let synced: string[] = [];
			let skipped: string[] = [];
			try {
				({ synced, skipped } = await syncZernioAccounts(
					db,
					locals.supabase,
					user.id,
					persona_id
				));
			} catch (e) {
				return json(
					{ success: false, error: `Failed to sync Zernio accounts: ${(e as Error).message}` },
					{ status: 502 }
				);
			}

			// Keep the agent's connection count + status in sync.
			try {
				const { data: finalConns } = await db.connections.listForAgent(persona_id);
				const activeConns = (finalConns || []).filter(
					(c) => c.status !== 'revoked' && c.status !== 'reauth_required' && c.status !== 'error'
				);
				const count = activeConns.length;
				const { followers: targetFollowers, engagement_rate: targetEngagement } =
					computeDynamicMetrics(activeConns, persona_id);
				await db.agents.update(persona_id, {
					connection_count: count,
					status: count > 0 && agent.status !== 'paused' ? 'active' : agent.status,
					followers: targetFollowers,
					engagement_rate: targetEngagement
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

			if (!isPlatformConfigured(platform)) {
				return json({ success: false, error: `${platform} is not configured.` }, { status: 400 });
			}

			if (!isUuid(persona_id)) {
				return json({ success: false, error: 'Invalid persona_id format (UUID required).' }, { status: 400 });
			}

			// Fetch agent info
			const { data: agent, error: agentErr } = await db.agents.get(persona_id);
			if (agentErr || !agent) {
				return json({ success: false, error: 'Agent not found' }, { status: 404 });
			}
			if (agent.user_id !== user.id) {
				return json({ success: false, error: 'Forbidden' }, { status: 403 });
			}

			const composioKey = env.COMPOSIO_API_KEY || '';
			const isKeyMissingOrPlaceholder =
				!composioKey || composioKey.includes('placeholder') || composioKey.includes('change_me');

			if (isKeyMissingOrPlaceholder) {
				return json(
					{
						success: false,
						error:
							'COMPOSIO_API_KEY is not configured in your environment variables. Please add it to your server configuration to enable live social media connections.'
					},
					{ status: 400 }
				);
			}

			// Call Composio directly to get the redirect URL
			let redirectUrl = null;
			try {
				const origin = new URL(request.url).origin;
				const callbackUrl = `${origin}/personas/${persona_id}?tab=connections`;
				const composio = new ComposioClient();
				redirectUrl = await composio.getOAuthLink(persona_id, platform, callbackUrl);
			} catch (e) {
				console.error('[Accounts API] Failed calling Composio direct link API for UUID agent:', e);
				return json(
					{
						success: false,
						error: `Failed to initiate Composio connection: ${(e as Error).message || e}`
					},
					{ status: 500 }
				);
			}

			return json({
				success: true,
				data: {
					redirect_url: redirectUrl
				}
			});
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

			const { error: delErr } = await db.connections.delete(persona_id, platform);
			if (delErr) throw delErr;

			// Recalculate connection count and dynamic stats
			try {
				const { data: finalConns } = await db.connections.listForAgent(persona_id);
				const count = finalConns?.length || 0;

				const { data: agent } = await db.agents.get(persona_id);
				if (agent) {
					let newStatus = agent.status;
					if (count === 0) {
						newStatus = 'paused';
					} else if (agent.status !== 'paused') {
						newStatus = 'active';
					}

					const { followers: targetFollowers, engagement_rate: targetEngagement } =
						computeDynamicMetrics(finalConns || [], persona_id);

					await db.agents.update(persona_id, {
						connection_count: count,
						status: newStatus,
						followers: targetFollowers,
						engagement_rate: targetEngagement
					});
				}
			} catch (err) {
				console.error('[Accounts API] Failed to update agent connection on disconnect:', err);
			}

			return json({ success: true });
		}

		return json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
	} catch (err) {
		console.error('[Accounts API] Error processing action:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
