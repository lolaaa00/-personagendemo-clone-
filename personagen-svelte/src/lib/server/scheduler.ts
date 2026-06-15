import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { ComposioClient, isPlatformConfigured } from './social/composio';
import { GoogleGenAI } from '@google/genai';

let intervalId: NodeJS.Timeout | null = null;
let isRunning = false;
let lastAnalyticsSyncTime = 0;

function getServiceSupabase() {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !serviceKey) {
		throw new Error('[Scheduler] Supabase credentials not configured.');
	}
	return createClient(url, serviceKey);
}

interface RssItem {
	title: string;
	link: string;
	guid: string;
}

/**
 * Lightweight, Cloudflare compatible XML RSS parser
 */
export function parseRssFeed(xmlText: string): RssItem[] {
	const items: RssItem[] = [];

	// Try standard RSS <item> tags
	const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
	let match;
	while ((match = itemRegex.exec(xmlText)) !== null) {
		const content = match[1];

		const titleMatch = /<title>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/title>/i.exec(content);
		const linkMatch = /<link>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/link>/i.exec(content);
		const guidMatch = /<guid[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/guid>/i.exec(content);

		const title = (titleMatch ? titleMatch[1] || titleMatch[2] : '').trim();
		const link = (linkMatch ? linkMatch[1] || linkMatch[2] : '').trim();
		const guid = (guidMatch ? guidMatch[1] || guidMatch[2] : link).trim();

		if (title && link) {
			items.push({ title, link, guid });
		}
	}

	// Try Atom <entry> tags if no <item> found
	if (items.length === 0) {
		const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
		while ((match = entryRegex.exec(xmlText)) !== null) {
			const content = match[1];

			const titleMatch = /<title(?:[^>]*?)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/title>/i.exec(
				content
			);

			// For Atom: <link href="url"/> or <link>url</link>
			let link = '';
			const linkHrefMatch = /<link[^>]+href=["']([^"']+)["']/i.exec(content);
			if (linkHrefMatch) {
				link = linkHrefMatch[1];
			} else {
				const linkTextMatch = /<link>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/link>/i.exec(content);
				if (linkTextMatch) {
					link = (linkTextMatch[1] || linkTextMatch[2]).trim();
				}
			}

			const idMatch = /<id>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/id>/i.exec(content);

			const title = (titleMatch ? titleMatch[1] || titleMatch[2] : '').trim();
			const guid = (idMatch ? idMatch[1] || idMatch[2] : link).trim();

			if (title && link) {
				items.push({ title, link, guid });
			}
		}
	}

	return items;
}

/**
 * Call Gemini directly via @google/genai to spin RSS article content
 */
async function generateSpunPost(
	agent: { name: string; handle: string; niche: string; soul: string; skills: string },
	title: string,
	link: string,
	apiKey: string
): Promise<{ content: string; tokenUsage: number; tokenCost: number }> {
	const ai = new GoogleGenAI({ apiKey });
	const prompt = `Repurpose the following news/feed article into a unique, high-engaging, and ready-to-publish social media post tailored exactly in my voice.

Article Title: "${title}"
Article Link: ${link}

My Profile Name: ${agent.name}
My Profile Handle: ${agent.handle}
My Niche: ${agent.niche}
My Personality & Soul: ${agent.soul}
My Skills & Style: ${agent.skills}

Instructions:
1. Do not just summarize the article. Repurpose it to add my own perspective/voice.
2. Adapt it to be engaging for social media.
3. Keep it within typical social media post limits (less than 280 characters if posting to X, but write a clean, well-formatted piece with hooks, a concise body, and relevant hashtags).
4. Output ONLY the post body content itself. Do not include introductory text like "Here is your post:", markdown code fences, or any other explanations.`;

	const systemInstruction = `You are the AI avatar agent ${agent.name} (@${agent.handle}). Your personality is defined by: ${agent.soul}. Your writing style is defined by: ${agent.skills}. Repurpose/spin the input feed content into a single final post body in your own unique voice.`;

	const res = await ai.models.generateContent({
		model: 'gemini-3.5-flash',
		contents: [{ role: 'user', parts: [{ text: prompt }] }],
		config: {
			systemInstruction
		}
	});

	let postContent = res.text || '';
	postContent = postContent.trim();
	if (postContent.startsWith('```') && postContent.endsWith('```')) {
		postContent = postContent
			.replace(/^```[a-zA-Z]*\n/, '')
			.replace(/\n```$/, '')
			.trim();
	}

	// Calculate realistic token usage and cost based on Gemini 3.5 Flash pricing
	// 1 token ≈ 4 characters of English text. System instructions are also part of the input.
	const inputTokens = Math.floor((prompt.length + systemInstruction.length) / 4) + 150;
	const outputTokens = Math.floor(postContent.length / 4) + 30;
	const tokenUsage = inputTokens + outputTokens;

	// Gemini 1.5/3.5 Flash cost pricing structure:
	// Input: $0.075 / 1M tokens ($0.000000075 per token)
	// Output: $0.30 / 1M tokens ($0.000000300 per token)
	const tokenCost = inputTokens * 0.000000075 + outputTokens * 0.0000003;

	return {
		content: postContent,
		tokenUsage,
		tokenCost: Number(tokenCost.toFixed(6))
	};
}

/**
 * Polls configured active RSS feeds, spins new articles natively with Gemini, and schedules them.
 */
async function pollRssFeeds() {
	const supabase = getServiceSupabase();
	const apiKey = env.GEMINI_API_KEY;
	if (!apiKey) {
		console.warn('[Scheduler RSS] GEMINI_API_KEY is not configured. Skipping RSS polling.');
		return;
	}

	try {
		// Fetch active agent configs with rss_active = true and rss_url not empty
		const { data: configs, error: configErr } = await supabase
			.from('agent_configs')
			.select('*, agents(*)')
			.eq('rss_active', true)
			.neq('rss_url', '');

		if (configErr) {
			console.error('[Scheduler RSS] Error fetching active RSS configs:', configErr);
			return;
		}

		if (!configs || configs.length === 0) {
			return;
		}

		const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

		for (const config of configs) {
			const agent = config.agents;
			if (!agent) continue;

			// Check last polled timestamp (poll at most every 15 mins)
			const lastPolled = config.rss_last_polled_at ? new Date(config.rss_last_polled_at) : null;
			if (lastPolled && lastPolled > fifteenMinutesAgo) {
				continue;
			}

			console.log(
				`[Scheduler RSS] Polling RSS feed for agent ${agent.name} (${agent.id}): ${config.rss_url}`
			);

			try {
				// Update polled timestamp first
				await supabase
					.from('agent_configs')
					.update({ rss_last_polled_at: new Date().toISOString() })
					.eq('id', config.id);

				const response = await fetch(config.rss_url, {
					headers: {
						'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PersonaGenRSS/1.0'
					}
				});

				if (!response.ok) {
					throw new Error(`HTTP ${response.status}: ${response.statusText}`);
				}

				const xmlText = await response.text();
				const items = parseRssFeed(xmlText);

				console.log(`[Scheduler RSS] Found ${items.length} items in RSS feed.`);

				let processedAny = false;
				for (const item of items) {
					// Check if item has already been processed
					const { data: alreadyProcessed, error: procErr } = await supabase
						.from('processed_rss_items')
						.select('id')
						.eq('agent_id', agent.id)
						.eq('item_guid', item.guid)
						.maybeSingle();

					if (procErr) {
						console.error(`[Scheduler RSS] Error checking processed items:`, procErr);
						continue;
					}

					if (alreadyProcessed) {
						continue;
					}

					console.log(
						`[Scheduler RSS] Routing new RSS item to agent ${agent.name} chat: "${item.title}"`
					);

					// Fetch connected platforms
					const { data: connections } = await supabase
						.from('connections')
						.select('platform')
						.eq('agent_id', agent.id);

					const platforms =
						connections && connections.length > 0
							? connections.map((c) => c.platform)
							: ['instagram'];

					const appPort = env.PORT || '5678';
					const isDev = process.env.NODE_ENV !== 'production';
					const localApiUrl = `http://127.0.0.1:${isDev ? '5173' : appPort}/api/agent/${agent.id}/chat`;

					try {
						const res = await fetch(localApiUrl, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
							},
							body: JSON.stringify({
								userId: config.user_id,
								message: `[SYSTEM EVENT - NEW RSS ITEM]:
Title: "${item.title}"
Link: ${item.link}

Instructions: Analyze this RSS item. If it is relevant to your niche, execute the 'generate_content' tool to write a draft post for the platform(s): ${JSON.stringify(platforms)}. After running the tool, output a confirmation text and stop. Do not write a conversational reply to this event.`
							})
						});

						if (!res.ok) {
							const errText = await res.text();
							throw new Error(`HTTP ${res.status}: ${errText}`);
						}

						console.log(
							`[Scheduler RSS] Agent successfully completed run for RSS item: "${item.title}"`
						);
					} catch (chatErr) {
						console.error(`[Scheduler RSS] Agent chat event processing failed:`, chatErr);
						continue;
					}

					// Mark as processed
					const { error: markErr } = await supabase.from('processed_rss_items').insert({
						agent_id: agent.id,
						item_guid: item.guid
					});

					if (markErr) {
						console.error(`[Scheduler RSS] Error marking item as processed:`, markErr);
					}

					console.log(`[Scheduler RSS] Successfully scheduled post for RSS item "${item.title}"`);
					processedAny = true;
					break; // Only process one item per poll to prevent flood
				}

				if (!processedAny) {
					console.log(`[Scheduler RSS] No new items to process for agent ${agent.name}.`);
				}
			} catch (feedErr) {
				console.error(`[Scheduler RSS] Failed to process feed for agent ${agent.id}:`, feedErr);
			}
		}
	} catch (err) {
		console.error('[Scheduler RSS] Critical RSS loop error:', err);
	}
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
			.or(
				`scheduled_date.lt.${currentDateStr},and(scheduled_date.eq.${currentDateStr},scheduled_time.lte.${currentTimeStr})`
			);

		if (error) {
			console.error('[Scheduler] Error checking scheduled posts:', error);
			isRunning = false;
			return;
		}

		if (posts && posts.length > 0) {
			console.log(`[Scheduler] Found ${posts.length} due posts to publish.`);

			for (const post of posts) {
				console.log(`[Scheduler] Processing post ${post.id} for agent ${post.agent_id}`);

				const targetPlatforms: string[] = post.platforms || [];
				let publishCount = 0;
				let failureCount = 0;
				let skippedCount = 0;
				let lastExternalId: string | null = null;
				const errors: string[] = [];
				const publicationResults: Record<string, any> = {};

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

					if (!isPlatformConfigured(normalizedPlat)) {
						publicationResults[normalizedPlat] = {
							status: 'skipped',
							error: 'Platform is not configured'
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

					const publishRes = await composio.executePost(
						post.agent_id,
						normalizedPlat,
						post.content
					);
					if (publishRes.success) {
						console.log(`[Scheduler] Post ${post.id} successfully published to ${platform}.`);
						publishCount++;
						if (publishRes.externalId) {
							lastExternalId = publishRes.externalId;
						}
						publicationResults[normalizedPlat] = {
							status: 'published',
							external_id: publishRes.externalId || null,
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
							error: publishRes.error || 'Unknown Composio publish failure'
						};
					}
				}

				let finalStatus = publishCount > 0 ? 'published' : 'failed';
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
				}
			}
		}

		// Run RSS polling
		await pollRssFeeds();

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
		// Fetch published posts that have at least one external platform ID.
		const { data: posts, error } = await supabase
			.from('posts')
			.select('*')
			.eq('status', 'published')
			.not('external_id', 'is', null);

		if (error) {
			console.error('[Scheduler] Error fetching published posts for analytics sync:', error);
			return;
		}

		if (!posts || posts.length === 0) {
			console.log('[Scheduler] No published posts to sync analytics for.');
			return;
		}

		console.log(`[Scheduler] Syncing metrics for ${posts.length} published posts...`);

		for (const post of posts) {
			const publicationResults = post.publication_results || {};
			const platform =
				Object.keys(publicationResults).find((key) => publicationResults[key]?.external_id) ||
				(post.platforms && post.platforms[0]) ||
				'instagram';
			const externalId = publicationResults[platform]?.external_id || post.external_id;
			if (!externalId) continue;
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
