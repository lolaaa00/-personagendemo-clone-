import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';
import { ALL_PLATFORM_KEYS, platformLabel, platformColor } from '$lib/platforms';

export const load: PageServerLoad = async ({ locals }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	let agents: any[] = [];
	let hasDbAgents = false;
	let postsThisWeek = 0;

	// Real state for the dashboard setup checklist — no step reads as done
	// because a page was visited, only because the thing exists. ENH-002.
	let setup: Record<string, boolean> | null = null;

	if (!isPlaceholder && locals.supabase) {
		const { session, user } = await locals.safeGetSession();
		if (user) {
			const [keys, briefs, conns, published] = await Promise.all([
				locals.supabase.from('user_api_keys').select('provider, status').eq('user_id', user.id),
				locals.supabase.from('brand_briefs').select('id').eq('user_id', user.id).limit(1),
				locals.supabase.from('connections').select('id').eq('user_id', user.id).limit(1),
				locals.supabase
					.from('posts')
					.select('id', { count: 'exact', head: true })
					.eq('user_id', user.id)
					.eq('status', 'published')
			]);
			const usable = (prov: string) =>
				(keys.data ?? []).some(
					(k: any) => k.provider === prov && k.status !== 'unset' && k.status !== 'invalid'
				);
			setup = {
				openrouter: usable('openrouter'),
				zernio: usable('zernio'),
				brief: (briefs.data ?? []).length > 0,
				connection: (conns.data ?? []).length > 0,
				published: (published.count ?? 0) > 0
			};
		}
		if (session && user) {
			const db = createDbService(locals.supabase);
			const { data: dbAgents } = await db.agents.list();

			if (dbAgents && dbAgents.length > 0) {
				hasDbAgents = true;

				// Fetch real database posts
				const { data: dbPosts } = await locals.supabase
					.from('posts')
					.select('agent_id, token_usage, token_cost, analytics, status, published_at, created_at')
					.is('deleted_at', null);

				const postsByAgent: Record<string, any[]> = {};
				if (dbPosts) {
					dbPosts.forEach((post) => {
						if (!postsByAgent[post.agent_id]) {
							postsByAgent[post.agent_id] = [];
						}
						postsByAgent[post.agent_id].push(post);
					});
				}

				// Calculate real weekly published posts
				const sevenDaysAgo = new Date();
				sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
				if (dbPosts) {
					const recentPosts = dbPosts.filter((p) => p.status === 'published');
					postsThisWeek = recentPosts.filter((p) => {
						const d = new Date(p.published_at || p.created_at);
						return d >= sevenDaysAgo;
					}).length;
				}

				// Week-over-week trend windows
				const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
				const nowMs = Date.now();
				const formatTrend = (pct: number) => `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;

				// Roster of creator agents
				const creators = dbAgents.filter((a) => !a.is_overseer);

				const creatorIds = creators.map((a) => a.id);
				const { data: configs } = creatorIds.length
					? await locals.supabase.from('agent_configs').select('agent_id, ugc_character_ref').in('agent_id', creatorIds)
					: { data: [] };
				const characterRefById = new Map((configs ?? []).map((c: any) => [c.agent_id, c.ugc_character_ref]));

				agents = creators.map((a) => {
					const agentPosts = postsByAgent[a.id] || [];

					let totalTokenUsage = 0;
					let totalTokenCost = 0;
					let totalViews = 0;
					let totalLikes = 0;
					let publishedCount = 0;

					agentPosts.forEach((p) => {
						if (p.token_usage) totalTokenUsage += p.token_usage;
						if (p.token_cost) totalTokenCost += parseFloat(p.token_cost);
						if (p.status === 'published' && p.analytics) {
							totalViews += p.analytics.views || 0;
							totalLikes += p.analytics.likes || 0;
							publishedCount++;
						}
					});

					let engVal = parseFloat(a.engagement_rate as any) || 0;
					if (publishedCount > 0 && totalViews > 0) {
						engVal = parseFloat(((totalLikes / totalViews) * 100).toFixed(2));
					}

					if (agentPosts.length === 0) {
						totalTokenUsage = 0;
						totalTokenCost = 0;
					}

					// Real week-over-week trend: views this 7 days vs prior 7 days,
					// falling back to published-post counts when no view data exists.
					let curViews = 0;
					let prevViews = 0;
					let curPosts = 0;
					let prevPosts = 0;
					agentPosts.forEach((p) => {
						if (p.status !== 'published') return;
						const ts = new Date(p.published_at || p.created_at).getTime();
						if (Number.isNaN(ts)) return;
						const age = nowMs - ts;
						if (age < 0) return;
						if (age < WEEK_MS) {
							curPosts++;
							curViews += p.analytics?.views || 0;
						} else if (age < 2 * WEEK_MS) {
							prevPosts++;
							prevViews += p.analytics?.views || 0;
						}
					});

					let trend = '—';
					if (prevViews > 0) {
						trend = formatTrend(((curViews - prevViews) / prevViews) * 100);
					} else if (prevPosts > 0) {
						trend = formatTrend(((curPosts - prevPosts) / prevPosts) * 100);
					}

					// No invented score. The old line was
					//   Math.min(99, Math.max(40, Math.round(70 + engVal * 2.5 + connCount * 4)))
					// which is floored at 70 by a constant: a persona created a minute
					// ago with no followers, no posts and no connections rendered 70/100
					// behind a three-quarters-full green bar, and the "Top Performers"
					// filter (perf >= 70) therefore returned every persona. It could not
					// report a problem even in principle.
					//
					// It also contradicted the rest of the product, which had already
					// learned this lesson: /brand-brief/intel says "It reports no
					// performance figures, because it measures nothing", and the post
					// drawer says "Stats pending first sync from the platform".
					//
					// What IS real is how many posts actually published, so that is what
					// is reported. A persona with none has nothing to show, and says so.
					// `publishedCount` above counts published posts that HAVE analytics,
					// which is what engagement is derived from. This counts posts that
					// actually went out, analytics or not — the fact a roster row can
					// honestly show.
					const publishedPosts = agentPosts.filter((p: any) => p.status === 'published').length;

					return {
						...a,
						niche: (a.niche || '').split(' & ')[0] || a.niche,
						engagementRate: engVal,
						engagement_rate: engVal,
						active: a.status === 'active',
						trend,
						publishedPosts,
						/** True only when there is measured platform data behind the
						 *  engagement figure. Without it the roster shows "—". */
						hasMetrics: publishedCount > 0 && totalViews > 0,
						ugc_character_ref: characterRefById.get(a.id) ?? null,
						total_token_usage: totalTokenUsage,
						total_token_cost: Number(totalTokenCost.toFixed(4)),
						total_views: totalViews,
						total_likes: totalLikes
					};
				});
			}
		}
	}

	if (!hasDbAgents) {
		agents = [];
		postsThisWeek = 0;
	}

	const barFor = (key: string) => {
		const c = platformColor(key);
		return `linear-gradient(90deg, ${c}, ${c})`;
	};

	let platformData = ALL_PLATFORM_KEYS.slice(0, 6).map((key) => {
		return { name: platformLabel(key), pct: 0, color: barFor(key) };
	});

	if (hasDbAgents && !isPlaceholder && locals.supabase) {
		const { data: conns } = await locals.supabase.from('connections').select('platform');
		if (conns && conns.length > 0) {
			const counts: Record<string, number> = {};
			conns.forEach((c) => {
				const key = String(c.platform ?? '').toLowerCase();
				if (!key) return;
				counts[key] = (counts[key] || 0) + 1;
			});

			const total = conns.length;
			// Only platforms this workspace actually connects. A fixed six padded
			// the card with zeroes and still omitted seven of the thirteen the
			// persona page offers.
			platformData = Object.keys(counts)
				.map((key) => ({
					name: platformLabel(key),
					pct: total ? Math.round((counts[key] / total) * 100) : 0,
					color: barFor(key)
				}))
				.sort((a, b) => b.pct - a.pct);
		}
	}

	// Engagement sparklines: built only from real analytics rows. Agents with no
	// measured views in the window are excluded — no synthetic fallback values.
	const sparkData: number[][] = [];
	const sparkAgents: any[] = [];

	if (hasDbAgents && locals.supabase) {
		const dbPosts = await locals.supabase
			.from('posts')
			.select('agent_id, status, analytics, published_at, created_at')
			.is('deleted_at', null);

		const postsByAgent: Record<string, any[]> = {};
		if (dbPosts.data) {
			dbPosts.data.forEach((post) => {
				if (!postsByAgent[post.agent_id]) {
					postsByAgent[post.agent_id] = [];
				}
				postsByAgent[post.agent_id].push(post);
			});
		}

		const dayArrays = Array.from({ length: 7 }, (_, i) => {
			const d = new Date();
			d.setDate(d.getDate() - (6 - i));
			return d.toISOString().split('T')[0];
		});

		for (const agent of agents) {
			if (sparkData.length >= 3) break;

			const agentPosts = postsByAgent[agent.id] || [];
			const publishedPosts = agentPosts.filter((p) => p.status === 'published' && p.analytics);

			let hasRealData = false;
			const dailyRates = dayArrays.map((dayStr) => {
				const dayPosts = publishedPosts.filter((p) => {
					const postDate = (p.published_at || p.created_at || '').split('T')[0];
					return postDate === dayStr;
				});

				let dayLikes = 0;
				let dayViews = 0;
				dayPosts.forEach((p) => {
					if (p.analytics) {
						dayLikes += p.analytics.likes || 0;
						dayViews += p.analytics.views || 0;
					}
				});

				if (dayViews > 0) {
					hasRealData = true;
					return parseFloat(((dayLikes / dayViews) * 100).toFixed(1));
				}
				return 0;
			});

			if (hasRealData) {
				sparkData.push(dailyRates);
				sparkAgents.push(agent);
			}
		}
	}

	return {
		agents,
		sparkData,
		sparkAgents,
		platformData,
		setup,
		postsThisWeek
	};
};
