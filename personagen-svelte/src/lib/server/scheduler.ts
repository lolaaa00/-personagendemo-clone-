import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { ComposioClient } from './social/composio';

let intervalId: NodeJS.Timeout | null = null;
let isRunning = false;

function getServiceSupabase() {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !serviceKey) {
		throw new Error('[Scheduler] Supabase credentials not configured.');
	}
	return createClient(url, serviceKey);
}

/**
 * Polling loop iteration
 */
async function pollScheduledPosts() {
	if (isRunning) return;
	isRunning = true;

	try {
		const supabase = getServiceSupabase();
		const composio = new ComposioClient();

		const now = new Date();
		const currentDateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
		const currentTimeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS

		// Query scheduled posts that are due now or overdue
		const { data: posts, error } = await supabase
			.from('posts')
			.select('*')
			.eq('status', 'scheduled')
			.or(`scheduled_date.lt.${currentDateStr},and(scheduled_date.eq.${currentDateStr},scheduled_time.lte.${currentTimeStr})`);

		if (error) {
			console.error('[Scheduler] Error checking scheduled posts:', error);
			isRunning = false;
			return;
		}

		if (posts && posts.length > 0) {
			console.log(`[Scheduler] Found ${posts.length} due posts to publish.`);

			for (const post of posts) {
				console.log(`[Scheduler] Processing post ${post.id} for agent ${post.agent_id}`);

				// The platforms column is a text array in Supabase (e.g. ['instagram', 'tiktok'])
				const targetPlatforms: string[] = post.platforms || [];
				let publishCount = 0;
				let failureCount = 0;
				const errors: string[] = [];

				for (const platform of targetPlatforms) {
					// We only support managed platforms
					const normalizedPlat = platform.toLowerCase();
					if (!['instagram', 'tiktok', 'youtube', 'facebook'].includes(normalizedPlat)) {
						continue;
					}

					// Verify if agent has this connection connected in Supabase connections table
					const { data: conn } = await supabase
						.from('connections')
						.select('*')
						.eq('agent_id', post.agent_id)
						.eq('platform', normalizedPlat)
						.maybeSingle();

					if (!conn) {
						console.warn(`[Scheduler] Agent ${post.agent_id} has no connected account for platform "${platform}". Skipping.`);
						continue;
					}

					// Trigger publication via Composio
					const publishRes = await composio.executePost(post.agent_id, normalizedPlat, post.content);
					if (publishRes.success) {
						console.log(`[Scheduler] Post ${post.id} successfully published to ${platform}.`);
						publishCount++;
					} else {
						console.error(`[Scheduler] Post ${post.id} failed to publish to ${platform}:`, publishRes.error);
						failureCount++;
						errors.push(`${platform}: ${publishRes.error}`);
					}
				}

				// Update post status based on outcomes
				let finalStatus = 'published';
				let publishedAt: string | null = new Date().toISOString();

				if (publishCount === 0 && failureCount > 0) {
					finalStatus = 'failed';
					publishedAt = null;
				} else if (publishCount > 0 && failureCount > 0) {
					// Partial success
					finalStatus = 'published'; // Count as published but log errors
				}

				const { error: updateError } = await supabase
					.from('posts')
					.update({
						status: finalStatus,
						published_at: publishedAt
					})
					.eq('id', post.id);

				if (updateError) {
					console.error(`[Scheduler] Failed to update post ${post.id} status:`, updateError);
				}
			}
		}
	} catch (err) {
		console.error('[Scheduler] Critical loop error:', err);
	} finally {
		isRunning = false;
	}
}

/**
 * Starts the SvelteKit background scheduler loop.
 * Should be initialized once on server start (e.g. hooks.server.ts).
 */
export function startScheduler() {
	const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	if (isPlaceholder) {
		console.log('[Scheduler] Running in dev placeholder mode. Scheduler inactive.');
		return;
	}

	if (intervalId) {
		console.log('[Scheduler] Scheduler is already running.');
		return;
	}

	console.log('[Scheduler] Starting SvelteKit social posting scheduler worker (60s tick)...');
	
	// Run immediately once on startup, then trigger interval
	pollScheduledPosts();
	intervalId = setInterval(pollScheduledPosts, 60 * 1000);
}

/**
 * Stops the scheduler (useful for hot-reload or testing environments)
 */
export function stopScheduler() {
	if (intervalId) {
		clearInterval(intervalId);
		intervalId = null;
		console.log('[Scheduler] Scheduler stopped.');
	}
}
