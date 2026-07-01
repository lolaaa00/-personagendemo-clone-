import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { ComposioClient } from './social/composio';
import { publishToPlatform } from './social/publisher';
import { getServiceSupabase } from './service-supabase';
import { runAutopilotDraftGeneration, zonedWallTimeToEpoch } from './autopilot';
import { acquireSchedulerLock } from './scheduler-lock';

const DEFAULT_TZ = 'Australia/Sydney';

let intervalId: NodeJS.Timeout | null = null;
let isRunning = false;
let lastAnalyticsSyncTime = 0;
let lastAutopilotRunTime = 0;

/**
 * Publishes a single post to its target platforms via the configured provider.
 */
export async function publishSinglePost(supabase: any, post: any): Promise<boolean> {
	console.log(`[Scheduler] Publishing single post ${post.id} for agent ${post.agent_id}`);

	const targetPlatforms: string[] = post.platforms || [];
	let publishCount = 0;
	let failureCount = 0;
	let skippedCount = 0;
	let lastExternalId: string | null = null;
	const errors: string[] = [];
	const publicationResults: Record<string, any> = post.publication_results || {};

	// Set initial status to 'publishing' so UI can give immediate feedback
	for (const platform of targetPlatforms) {
		const normalizedPlat = platform.toLowerCase();
		if (['instagram', 'tiktok', 'youtube', 'facebook'].includes(normalizedPlat)) {
			publicationResults[normalizedPlat] = {
				status: 'publishing',
				started_at: new Date().toISOString()
			};
		}
	}
	await supabase
		.from('posts')
		.update({
			status: 'scheduled',
			publication_results: publicationResults
		})
		.eq('id', post.id);

	for (const platform of targetPlatforms) {
		const normalizedPlat = platform.toLowerCase();
		if (!['instagram', 'tiktok', 'youtube', 'facebook'].includes(normalizedPlat)) {
			publicationResults[normalizedPlat] = {
				status: 'skipped',
				error: 'Platform is not supported'
			};
			skippedCount++;
			continue;
		}

		const { data: conn } = await supabase
			.from('connections')
			.select('*')
			.eq('agent_id', post.agent_id)
			.eq('platform', normalizedPlat)
			.maybeSingle();

		if (!conn) {
			console.warn(
				`[Scheduler] Agent ${post.agent_id} has no connected account for platform "${platform}". Skipping.`
			);
			publicationResults[normalizedPlat] = {
				status: 'skipped',
				error: 'No connected account'
			};
			skippedCount++;
			continue;
		}

		if (conn.status && conn.status !== 'active') {
			publicationResults[normalizedPlat] = {
				status: 'skipped',
				error: `Connection status is ${conn.status}`
			};
			skippedCount++;
			continue;
		}

		const publishRes = await publishToPlatform({
			supabase,
			post,
			connection: conn,
			platform: normalizedPlat
		});

		if (publishRes.success) {
			console.log(`[Scheduler] Post ${post.id} successfully published to ${platform}.`);
			publishCount++;
			if (publishRes.externalId) {
				lastExternalId = publishRes.externalId;
			}
			let permalink = publishRes.permalink || null;
			if (!permalink && publishRes.externalId) {
				if (normalizedPlat === 'instagram') {
					permalink = `https://www.instagram.com/p/${publishRes.externalId}/`;
				} else if (normalizedPlat === 'youtube') {
					permalink = `https://www.youtube.com/watch?v=${publishRes.externalId}`;
				} else if (normalizedPlat === 'facebook') {
					permalink = `https://www.facebook.com/${publishRes.externalId}`;
				} else if (normalizedPlat === 'tiktok') {
					permalink = `https://www.tiktok.com/video/${publishRes.externalId}`;
				}
			}
			publicationResults[normalizedPlat] = {
				status: 'published',
				provider: publishRes.provider,
				external_id: publishRes.externalId || null,
				permalink: permalink,
				published_at: new Date().toISOString()
			};
		} else {
			console.error(
				`[Scheduler] Post ${post.id} failed to publish to ${platform}:`,
				publishRes.error
			);
			failureCount++;
			errors.push(`${platform}: ${publishRes.error}`);
			publicationResults[normalizedPlat] = {
				status: 'failed',
				provider: publishRes.provider,
				error: publishRes.error || 'Unknown Composio publish failure'
			};
		}
	}

	let finalStatus: string = 'failed';
	if (publishCount > 0 && failureCount > 0) {
		finalStatus = 'partial';
	} else if (publishCount > 0) {
		finalStatus = 'published';
	}
	let publishedAt: string | null = publishCount > 0 ? new Date().toISOString() : null;

	if (publishCount === 0 && failureCount === 0 && skippedCount === 0) {
		finalStatus = 'failed';
		publicationResults._post = {
			status: 'failed',
			error: 'No target platforms were provided'
		};
	}

	const { error: updateError } = await supabase
		.from('posts')
		.update({
			status: finalStatus,
			published_at: publishedAt,
			external_id: lastExternalId,
			publication_results: publicationResults,
			analytics: { views: 0, likes: 0, comments: 0, shares: 0 }
		})
		.eq('id', post.id);

	if (updateError) {
		console.error(`[Scheduler] Failed to update post ${post.id} status:`, updateError);
		return false;
	}

	return publishCount > 0;
}

/**
 * Publishes a single post by ID directly (bypasses full background worker)
 */
export async function publishPostById(postId: string): Promise<boolean> {
	console.log(`[Scheduler] Manual publishing triggered for post ID: ${postId}`);
	const supabase = getServiceSupabase();
	const { data: post, error } = await supabase
		.from('posts')
		.select('*')
		.eq('id', postId)
		.maybeSingle();

	if (error || !post) {
		console.error(`[Scheduler] Post ${postId} not found:`, error);
		return false;
	}

	return await publishSinglePost(supabase, post);
}

/**
 * Polling loop iteration
 */
async function pollScheduledPosts() {
	if (isRunning) return;
	isRunning = true;

	// Only the elected leader publishes/runs autopilot — prevents multiple running
	// instances (dev servers + prod) from double-posting to live accounts.
	if (!acquireSchedulerLock()) {
		isRunning = false;
		return;
	}

	try {
		const supabase = getServiceSupabase();

		const nowMs = Date.now();
		// Prefilter in SQL by a timezone-safe upper bound (+2 days UTC), then decide
		// due-ness in JS using each agent's configured timezone. Drafts (status
		// !== 'scheduled') are excluded automatically — they await approval.
		const upperBound = new Date(nowMs + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
		const { data: posts, error } = await supabase
			.from('posts')
			.select('*')
			.eq('status', 'scheduled')
			.lte('scheduled_date', upperBound);

		if (error) {
			console.error('[Scheduler] Error checking scheduled posts:', error);
			isRunning = false;
			return;
		}

		let duePosts = posts || [];
		if (duePosts.length > 0) {
			// Resolve each post's timezone from its agent's config (default Sydney).
			const agentIds = [...new Set(duePosts.map((p: any) => p.agent_id))];
			const tzByAgent = new Map<string, string>();
			const { data: cfgs } = await supabase
				.from('agent_configs')
				.select('agent_id, timezone')
				.in('agent_id', agentIds);
			for (const c of cfgs || []) tzByAgent.set(c.agent_id, c.timezone || DEFAULT_TZ);

			duePosts = duePosts.filter((p: any) => {
				if (!p.scheduled_date) return true; // no date → publish now
				const tz = tzByAgent.get(p.agent_id) || DEFAULT_TZ;
				return zonedWallTimeToEpoch(p.scheduled_date, p.scheduled_time || '00:00:00', tz) <= nowMs;
			});
		}

		if (duePosts.length > 0) {
			console.log(`[Scheduler] Found ${duePosts.length} due posts to publish.`);
			for (const post of duePosts) {
				await publishSinglePost(supabase, post);
			}
		}

		// Run Post-Publication Analytics Sync! Throttled to avoid API/log spam.
		const nowTime = Date.now();
		let syncInterval = 4 * 60 * 60 * 1000; // Default: 4 hours
		if (env.ANALYTICS_SYNC_INTERVAL_MS) {
			const parsed = parseInt(env.ANALYTICS_SYNC_INTERVAL_MS, 10);
			if (!isNaN(parsed) && parsed > 0) {
				syncInterval = parsed;
			}
		}

		if (nowTime - lastAnalyticsSyncTime >= syncInterval) {
			lastAnalyticsSyncTime = nowTime;
			await syncPostAnalytics();
		}

		// Autopilot: top up drafts/scheduled posts for enabled agents. Throttled.
		let autopilotInterval = 60 * 60 * 1000; // Default: hourly
		if (env.AUTOPILOT_RUN_INTERVAL_MS) {
			const parsed = parseInt(env.AUTOPILOT_RUN_INTERVAL_MS, 10);
			if (!isNaN(parsed) && parsed > 0) {
				autopilotInterval = parsed;
			}
		}

		if (nowTime - lastAutopilotRunTime >= autopilotInterval) {
			lastAutopilotRunTime = nowTime;
			try {
				await runAutopilotDraftGeneration();
			} catch (autoErr) {
				console.error('[Scheduler] Autopilot run failed:', autoErr);
			}
		}
	} catch (err) {
		console.error('[Scheduler] Critical loop error:', err);
	} finally {
		isRunning = false;
	}
}

/**
 * Periodically syncs live performance metrics for all published posts
 */
export async function syncPostAnalytics() {
	console.log('[Scheduler] Syncing post analytics...');
	const supabase = getServiceSupabase();
	const composio = new ComposioClient();

	try {
		// Fetch published posts published in the last 7 days that have at least one external platform ID.
		const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
		const { data: posts, error } = await supabase
			.from('posts')
			.select('*')
			.eq('status', 'published')
			.not('external_id', 'is', null)
			.gte('published_at', sevenDaysAgo);

		if (error) {
			console.error('[Scheduler] Error fetching published posts for analytics sync:', error);
			return;
		}

		if (!posts || posts.length === 0) {
			console.log('[Scheduler] No published posts to sync analytics for.');
			return;
		}

		console.log(`[Scheduler] Syncing metrics for ${posts.length} published posts...`);

		// Process posts in parallel chunks (concurrency limit of 5 to avoid API rate limits)
		const CONCURRENCY_LIMIT = 5;
		const postQueue = [...posts];

		const worker = async () => {
			while (postQueue.length > 0) {
				const post = postQueue.shift();
				if (!post) continue;

				const publicationResults = post.publication_results || {};
				const platform =
					Object.keys(publicationResults).find((key) => publicationResults[key]?.external_id) ||
					(post.platforms && post.platforms[0]) ||
					'instagram';
				const externalId = publicationResults[platform]?.external_id || post.external_id;
				if (!externalId) continue;

				// This sync only knows how to query Composio. A Zernio-published post's
				// externalId means nothing to Composio's API (wrong provider entirely) —
				// calling it anyway would just burn a request on a guaranteed failure.
				// TODO: wire in Zernio's own analytics endpoint once verified against its
				// real API (no confirmed spec for it yet — Zernio isn't live in this
				// deployment either, so there's nothing to verify against right now).
				if (publicationResults[platform]?.provider === 'zernio') continue;

				try {
					const metrics = await composio.fetchPostMetrics(
						post.agent_id,
						platform,
						externalId,
						post.published_at!
					);

					const { error: updateErr } = await supabase
						.from('posts')
						.update({ analytics: metrics })
						.eq('id', post.id);

					if (updateErr) {
						console.error(`[Scheduler] Failed to update analytics for post ${post.id}:`, updateErr);
					} else {
						console.log(
							`[Scheduler] Synced metrics for post ${post.id}: Views=${metrics.views}, Likes=${metrics.likes}`
						);
					}
				} catch (postErr) {
					console.error(`[Scheduler] Error syncing metrics for post ${post.id}:`, postErr);
				}
			}
		};

		// Run workers in parallel
		const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, posts.length) }, worker);
		await Promise.all(workers);

		console.log('[Scheduler] Finished syncing post analytics.');
	} catch (err) {
		console.error('[Scheduler] Critical error in syncPostAnalytics:', err);
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
