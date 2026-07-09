import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { getZernioApiKey, ZernioClient } from './social/zernio';
import { publishToPlatform } from './social/publisher';
import { getServiceSupabase } from './service-supabase';
import { getLocalParts, runAutopilotDraftGeneration, zonedWallTimeToEpoch } from './autopilot';
import { acquireSchedulerLease } from './scheduler-lock';
import { ALL_PLATFORM_KEYS } from '$lib/platforms';

const DEFAULT_TZ = 'Australia/Sydney';

let intervalId: NodeJS.Timeout | null = null;
let isRunning = false;
let lastAnalyticsSyncTime = 0;
let lastAutopilotRunTime = 0;

// Transient provider failures (network blips, 5xx, rate limits) are retried on
// later ticks with spaced backoff instead of terminally failing the post.
// Permanent errors (bad credentials, unsupported content) fail immediately.
const MAX_PUBLISH_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 5 * 60 * 1000; // per attempt: 5min, 10min
// A post claimed (status='publishing') longer than this is presumed orphaned by
// a crashed/restarted process and is released back to 'scheduled'.
const CLAIM_LEASE_MS = 15 * 60 * 1000;

function isRetriableError(message: string): boolean {
	return /timed?\s?out|timeout|rate.?limit|too many requests|\b429\b|\b5\d\d\b|econnreset|econnrefused|etimedout|eai_again|fetch failed|network|socket|abort/i.test(
		message || ''
	);
}

// Derived from the single platform registry — publishable = connectable, since
// publishToPlatform routes everything through Zernio (the full registry breadth)
// and fails loudly per-platform when no connected account can serve a target.
const PUBLISHABLE_PLATFORMS = ALL_PLATFORM_KEYS;

/**
 * Publishes a single post to its target platforms via the configured provider.
 *
 * Exactly-once discipline (as close as providers allow):
 * 1. Atomically CLAIMS the row (status scheduled -> publishing) before any
 *    provider call — a concurrent tick or manual publish loses the claim and
 *    skips, so a post is never in two publish loops at once.
 * 2. Platforms already recorded 'published' in publication_results are never
 *    re-sent — a retry after a partial failure only touches the failed ones.
 * 3. Transient failures revert the post to 'scheduled' with a backoff window
 *    (publication_results._post.not_before) so a flaky minute self-heals
 *    instead of terminally failing an unattended autopilot slot.
 */
export async function publishSinglePost(supabase: any, post: any): Promise<boolean> {
	console.log(`[Scheduler] Publishing single post ${post.id} for agent ${post.agent_id}`);

	const targetPlatforms: string[] = post.platforms || [];
	let publishCount = 0;
	let failureCount = 0;
	let skippedCount = 0;
	let alreadyPublishedCount = 0;
	let retriableFailureCount = 0;
	let lastExternalId: string | null = null;
	const errors: string[] = [];
	const publicationResults: Record<string, any> = post.publication_results || {};
	const priorMeta = publicationResults._post || {};
	const attempts = (Number(priorMeta.attempts) || 0) + 1;

	// Seed 'publishing' markers ONLY for platforms not already published — a
	// prior partial success must never be stomped back to pending (that's what
	// caused re-posts of already-live content).
	for (const platform of targetPlatforms) {
		const normalizedPlat = platform.toLowerCase();
		if (
			PUBLISHABLE_PLATFORMS.includes(normalizedPlat) &&
			publicationResults[normalizedPlat]?.status !== 'published'
		) {
			publicationResults[normalizedPlat] = {
				status: 'publishing',
				started_at: new Date().toISOString()
			};
		}
	}
	publicationResults._post = { ...priorMeta, attempts, claimed_at: new Date().toISOString() };
	delete publicationResults._post.not_before;

	// Atomic claim: only the worker that flips scheduled -> publishing owns this
	// post. Zero rows updated = another worker (concurrent tick, manual publish,
	// second instance) already claimed it — bail without touching the provider.
	const { data: claimed, error: claimErr } = await supabase
		.from('posts')
		.update({ status: 'publishing', publication_results: publicationResults })
		.eq('id', post.id)
		.eq('status', 'scheduled')
		.select('id');

	if (claimErr) {
		// The atomic claim failed — almost always because posts_status_check doesn't
		// allow 'publishing' yet (post_status_publishing_migration.sql not applied).
		// FAIL CLOSED: skip this post rather than fall through and publish without a
		// claim guard, which lets two overlapping ticks both publish → duplicate
		// live posts. It retries next tick once the migration is applied.
		console.error(
			`[Scheduler] Atomic claim FAILED for post ${post.id} (${claimErr.message}) — apply post_status_publishing_migration.sql. Skipping to avoid an unguarded double-publish.`
		);
		return false;
	} else if (!claimed || claimed.length === 0) {
		console.log(`[Scheduler] Post ${post.id} already claimed by another worker — skipping.`);
		return false;
	}

	// One query for every platform this post targets, instead of one query per
	// platform inside the loop below — a 5-platform post used to cost 5 round
	// trips here alone.
	const normalizedPlatforms = targetPlatforms
		.map((p) => p.toLowerCase())
		.filter((p) => PUBLISHABLE_PLATFORMS.includes(p));
	const { data: connRows } = normalizedPlatforms.length
		? await supabase
				.from('connections')
				.select('*')
				.eq('agent_id', post.agent_id)
				.in('platform', normalizedPlatforms)
		: { data: [] as any[] };
	const connByPlatform: Map<string, any> = new Map(
		(connRows || []).map((c: any) => [c.platform, c])
	);

	for (const platform of targetPlatforms) {
		const normalizedPlat = platform.toLowerCase();
		if (!PUBLISHABLE_PLATFORMS.includes(normalizedPlat)) {
			publicationResults[normalizedPlat] = {
				status: 'skipped',
				error: 'Platform is not supported'
			};
			skippedCount++;
			continue;
		}

		// Never re-publish a platform that already succeeded (partial retry).
		if (post.publication_results?.[normalizedPlat]?.status === 'published') {
			alreadyPublishedCount++;
			continue;
		}

		const conn = connByPlatform.get(normalizedPlat);

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

		// A thrown error (vs a returned failure) must not unwind the whole loop —
		// that would abandon the row in 'publishing' until the lease reaper and
		// skip recording results for platforms already processed this run.
		const publishRes = await publishToPlatform({
			supabase,
			post,
			connection: conn,
			platform: normalizedPlat
		}).catch((err: Error) => ({
			success: false as const,
			provider: 'zernio' as const,
			error: err.message || 'Publish threw unexpectedly'
		}));

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
			const errMsg = publishRes.error || 'Unknown publish failure';
			if (isRetriableError(errMsg)) retriableFailureCount++;
			errors.push(`${platform}: ${errMsg}`);
			publicationResults[normalizedPlat] = {
				status: 'failed',
				provider: publishRes.provider,
				error: errMsg
			};

			// Auth-shaped failure → the CONNECTION is broken, not just this post.
			// Mark it reauth_required so (a) the UI surfaces "reconnect needed"
			// instead of silent per-post failures, and (b) subsequent posts skip
			// this platform (connection-status guard above) rather than burning
			// retries against a dead token.
			if (/\b401\b|unauthoriz|token.{0,20}(expired|invalid|revoked)|expired.{0,10}token|re-?auth|invalid_grant|OAuthException/i.test(errMsg)) {
				const { error: reauthErr } = await supabase
					.from('connections')
					.update({
						status: 'reauth_required',
						last_error: errMsg.slice(0, 300),
						last_checked_at: new Date().toISOString()
					})
					.eq('agent_id', post.agent_id)
					.eq('platform', normalizedPlat);
				if (!reauthErr) {
					console.warn(
						`[Scheduler] Marked ${normalizedPlat} connection for agent ${post.agent_id} as reauth_required (auth failure during publish).`
					);
				}
			}
		}
	}

	const totalPublished = publishCount + alreadyPublishedCount;

	// Retry path: every failure this run was transient (network/5xx/rate limit)
	// and we still have attempts left → put the post back in the scheduled pool
	// with a backoff window instead of terminally failing it. Platforms that
	// succeeded stay recorded as published and are skipped on the retry tick.
	const shouldRetry =
		failureCount > 0 && retriableFailureCount === failureCount && attempts < MAX_PUBLISH_ATTEMPTS;

	let finalStatus: string;
	if (shouldRetry) {
		finalStatus = 'scheduled';
		publicationResults._post = {
			...publicationResults._post,
			attempts,
			not_before: new Date(Date.now() + attempts * RETRY_BACKOFF_MS).toISOString(),
			last_error: errors.join('; ')
		};
		console.log(
			`[Scheduler] Post ${post.id}: ${failureCount} transient failure(s), attempt ${attempts}/${MAX_PUBLISH_ATTEMPTS} — retrying after backoff.`
		);
	} else if (totalPublished > 0 && failureCount > 0) {
		finalStatus = 'partial';
	} else if (totalPublished > 0) {
		finalStatus = 'published';
	} else {
		finalStatus = 'failed';
	}

	if (totalPublished === 0 && failureCount === 0 && skippedCount === 0) {
		finalStatus = 'failed';
		publicationResults._post = {
			...publicationResults._post,
			status: 'failed',
			error: 'No target platforms were provided'
		};
	}

	// Preserve prior publish evidence on retries: published_at keeps its first
	// value, external_id is never nulled out by a later run that published
	// nothing new, and synced analytics are only zero-seeded once.
	const publishedAt: string | null =
		post.published_at || (totalPublished > 0 ? new Date().toISOString() : null);

	const finalUpdate: Record<string, any> = {
		status: finalStatus,
		published_at: publishedAt,
		publication_results: publicationResults
	};
	if (lastExternalId) finalUpdate.external_id = lastExternalId;
	// analytics intentionally left untouched: it stays NULL until the analytics
	// sync stores REAL platform numbers. Zero-seeding would display as "0 views"
	// — a claim about performance we haven't actually measured.

	const { error: updateError } = await supabase.from('posts').update(finalUpdate).eq('id', post.id);

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

	try {
		const supabase = getServiceSupabase();

		// Only the elected leader publishes/runs autopilot — prevents multiple running
		// instances (other hosts, dev servers + prod) from double-posting to live accounts.
		if (!(await acquireSchedulerLease(supabase))) {
			return;
		}

		const nowMs = Date.now();

		// Release orphaned claims: a post stuck in 'publishing' past its lease was
		// claimed by a process that died mid-publish. Put it back in the pool —
		// the per-platform published guard prevents re-sending anything that was
		// recorded as published before the crash.
		const { data: stale } = await supabase
			.from('posts')
			.select('id, publication_results')
			.eq('status', 'publishing');
		for (const p of stale || []) {
			const claimedAt = Date.parse(p.publication_results?._post?.claimed_at || '');
			// Only reap a claim we can PROVE is stale (finite timestamp past the
			// lease). The old `!claimedAt` also fired on Date.parse('') === NaN,
			// which could yank an in-flight publish and cause a duplicate post.
			if (Number.isFinite(claimedAt) && nowMs - claimedAt > CLAIM_LEASE_MS) {
				console.warn(`[Scheduler] Releasing orphaned publishing claim on post ${p.id}.`);
				await supabase
					.from('posts')
					.update({ status: 'scheduled' })
					.eq('id', p.id)
					.eq('status', 'publishing');
			}
		}

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
			// Resolve each post's timezone + active-hours window from its agent's
			// config (default Sydney, 8am–8pm) — one fetch serves both the wall-clock
			// due check and the publish-window enforcement below.
			const agentIds = [...new Set(duePosts.map((p: any) => p.agent_id))];
			const cfgByAgent = new Map<
				string,
				{ timezone: string; active_hours_start: number; active_hours_end: number }
			>();
			const { data: cfgs } = await supabase
				.from('agent_configs')
				.select('agent_id, timezone, active_hours_start, active_hours_end')
				.in('agent_id', agentIds);
			for (const c of cfgs || []) {
				cfgByAgent.set(c.agent_id, {
					timezone: c.timezone || DEFAULT_TZ,
					active_hours_start: c.active_hours_start ?? 8,
					active_hours_end: c.active_hours_end ?? 20
				});
			}
			const cfgFor = (agentId: string) =>
				cfgByAgent.get(agentId) || {
					timezone: DEFAULT_TZ,
					active_hours_start: 8,
					active_hours_end: 20
				};

			// Scheduled publishing respects the agent's active-hours window: a due
			// post outside it (e.g. a 3am slot) is DEFERRED — left 'scheduled', no
			// attempt counted — and fires on the first tick inside the window.
			// Manual "publish now" (publishPostById) is exempt: explicit user intent.
			const enforceActiveHours = env.PUBLISH_ENFORCE_ACTIVE_HOURS !== 'false';

			duePosts = duePosts.filter((p: any) => {
				// Respect the retry backoff window set after a transient failure.
				const notBefore = Date.parse(p.publication_results?._post?.not_before || '');
				if (notBefore && notBefore > nowMs) return false;
				const cfg = cfgFor(p.agent_id);
				if (
					p.scheduled_date &&
					zonedWallTimeToEpoch(p.scheduled_date, p.scheduled_time || '00:00:00', cfg.timezone) >
						nowMs
				) {
					return false; // not due yet (no date → publish now)
				}
				if (enforceActiveHours) {
					const { hour } = getLocalParts(cfg.timezone);
					const startH = cfg.active_hours_start;
					const endH = cfg.active_hours_end;
					// End hour is inclusive (autopilot books slots at endH:00). An
					// inverted window (end < start) means overnight, e.g. 22 → 6.
					const inWindow =
						endH >= startH
							? hour >= startH && hour <= endH
							: hour >= startH || hour <= endH;
					if (!inWindow) {
						console.log(
							`[Scheduler] Deferring post ${p.id}: agent-local hour ${hour} is outside active window ${startH}–${endH} (${cfg.timezone}).`
						);
						return false;
					}
				}
				return true;
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
 * Periodically syncs live performance metrics for all published posts via Zernio's
 * per-post analytics (GET /v1/analytics?postId=…). Analytics is bundled on every
 * Zernio account, so this is the single metrics source. Never stores synthetic
 * numbers — a null response leaves a post's analytics untouched.
 */
export async function syncPostAnalytics() {
	console.log('[Scheduler] Syncing post analytics...');
	const supabase = getServiceSupabase();

	// Resolve + cache one Zernio client per user_id (keys are per-user). null marks
	// a user with no key so we don't re-query it for every one of their posts.
	const clientByUser = new Map<string, ZernioClient | null>();
	const getClient = async (userId: string): Promise<ZernioClient | null> => {
		if (clientByUser.has(userId)) return clientByUser.get(userId)!;
		const key = await getZernioApiKey(supabase, userId).catch(() => null);
		const client = key ? new ZernioClient(key) : null;
		clientByUser.set(userId, client);
		return client;
	};

	try {
		// Published posts from the last 7 days with at least one external platform ID.
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
				// external_id is the Zernio post _id captured at publish time — exactly
				// what GET /analytics?postId= expects.
				const externalId = publicationResults[platform]?.external_id || post.external_id;
				if (!externalId || !post.user_id) continue;

				// Skip posts published through a retired provider — their external_id is
				// not a Zernio post id, so a Zernio analytics lookup would 404. Legacy
				// pre-consolidation posts simply keep whatever analytics they had.
				const pubProvider = String(publicationResults[platform]?.provider || '').toLowerCase();
				if (pubProvider === 'composio' || pubProvider === 'blotato') continue;

				try {
					const client = await getClient(post.user_id);
					if (!client) continue;

					const metrics = await client.fetchPostMetrics(String(externalId));
					// Real metrics or nothing — a null leaves analytics untouched.
					if (!metrics) continue;

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
