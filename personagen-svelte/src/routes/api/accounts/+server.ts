import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/private';
import { ComposioClient } from '$lib/server/social/composio';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json() as any;
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
				// Return default disconnected statuses for mock/fallback agents
				const platforms = ['tiktok', 'instagram', 'youtube', 'facebook'];
				const statusData: Record<string, any> = {};
				for (const p of platforms) {
					statusData[p] = { connected: false };
				}
				return json({ success: true, data: statusData });
			}

			const { data: conns, error } = await db.connections.listForAgent(persona_id);
			if (error) throw error;

			const platforms = ['tiktok', 'instagram', 'youtube', 'facebook'];
			const statusData: Record<string, any> = {};

			for (const p of platforms) {
				const conn = conns?.find((c) => c.platform === p);
				if (conn) {
					statusData[p] = {
						connected: true,
						handle: conn.handle || '@connected',
						verified: conn.verified ?? true,
						lastSync: conn.last_sync || conn.connected_at || new Date().toISOString()
					};
				} else {
					statusData[p] = { connected: false };
				}
			}

			return json({ success: true, data: statusData });
		}

		if (action === 'initiate_connection') {
			if (!persona_id || !platform) {
				return json({ success: false, error: 'Missing persona_id or platform' }, { status: 400 });
			}

			if (!isUuid(persona_id)) {
				console.log('[Accounts API] Non-UUID agent ID (dev bypass): Generating mock redirect URL');
				const redirectUrl = `${new URL(request.url).origin}/accounts?oauth_success=true&platform=${platform}&agentId=${persona_id}`;
				return json({
					success: true,
					data: {
						redirect_url: redirectUrl
					}
				});
			}

			// Fetch agent info
			const { data: agent, error: agentErr } = await db.agents.get(persona_id);
			if (agentErr || !agent) {
				return json({ success: false, error: 'Agent not found' }, { status: 404 });
			}

			// Call Composio directly to get the redirect URL
			let redirectUrl = null;
			try {
				const origin = new URL(request.url).origin;
				const callbackUrl = `${origin}/accounts`;
				const composio = new ComposioClient();
				redirectUrl = await composio.getOAuthLink(persona_id, platform, callbackUrl);
			} catch (e) {
				console.warn('[Accounts API] Failed calling Composio direct link API:', e);
				// If Composio key isn't configured, we can still fall back or generate a mock link
				// to allow testing local dashboard features without a live Composio token.
				const composioKey = env.COMPOSIO_API_KEY || '';
				const isDevBypass = !composioKey || composioKey.includes('placeholder') || composioKey.includes('change_me');
				if (isDevBypass) {
					console.log('[Accounts API] Dev bypass: Generating mock redirect URL');
					redirectUrl = `${new URL(request.url).origin}/accounts?oauth_success=true&platform=${platform}&agentId=${persona_id}`;
				}
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
				return json({ success: true });
			}

			const { error: delErr } = await db.connections.delete(persona_id, platform);
			if (delErr) throw delErr;

			// Recalculate connection count
			const { data: conns } = await db.connections.listForAgent(persona_id);
			const count = conns?.length || 0;

			// If no connections are left, pause the agent
			await db.agents.update(persona_id, {
				connection_count: count,
				status: count === 0 ? 'paused' : 'active'
			});

			return json({ success: true });
		}

		return json({ success: false, error: `Invalid action: ${action}` }, { status: 400 });
	} catch (err) {
		console.error('[Accounts API] Error processing action:', err);
		return json({ success: false, error: (err as Error).message }, { status: 500 });
	}
};
