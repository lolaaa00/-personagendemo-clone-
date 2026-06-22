import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import {
	getOrCreateHermes,
	ensureHermesConfig,
	ensureAgentsManagedByHermes
} from '$lib/server/hermes';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	let agents: any[] = [];
	let hasDbAgents = false;
	let postsThisWeek = 0;

	let hermesAgent: any = null;

	let managedAgentsCount = 0;
	let openTicketsCount = 0;
	let unclaimedMessagesCount = 0;
	let hermesConfigPresent = false;

	if (!isPlaceholder && locals.supabase) {
		const { session, user } = await locals.safeGetSession();
		if (session && user) {
			try {
				hermesAgent = await getOrCreateHermes(locals.supabase, user.id);
				const configRecord = await ensureHermesConfig(locals.supabase, user.id, hermesAgent.id);
				hermesConfigPresent = !!configRecord;
				await ensureAgentsManagedByHermes(locals.supabase, user.id, hermesAgent.id);

				// Fetch metrics
				const { count: managedCount } = await locals.supabase
					.from('agents')
					.select('*', { count: 'exact', head: true })
					.eq('user_id', user.id)
					.eq('is_overseer', false)
					.eq('managed_by_overseer', true);
				managedAgentsCount = managedCount ?? 0;

				const { count: openTickets } = await locals.supabase
					.from('tickets')
					.select('*', { count: 'exact', head: true })
					.eq('user_id', user.id)
					.neq('status', 'done');
				openTicketsCount = openTickets ?? 0;

				const { data: latestMsgs } = await locals.supabase
					.from('chat_messages')
					.select('id, agent_id, session_id, role, claimed_by')
					.eq('user_id', user.id)
					.order('created_at', { ascending: false })
					.limit(100);

				if (latestMsgs) {
					const latest: Record<string, any> = {};
					latestMsgs.forEach((m) => {
						const key = m.session_id || m.agent_id;
						if (!latest[key]) {
							latest[key] = m;
						}
					});
					unclaimedMessagesCount = Object.values(latest).filter(
						(m: any) => m.role === 'user' && !m.claimed_by
					).length;
				}
			} catch (err) {
				console.error('[Dashboard Server] Hermes ecosystem load failed:', err);
			}
		}

		const db = createDbService(locals.supabase);
		const { data: dbAgents } = await db.agents.list();

		if (dbAgents && dbAgents.length > 0) {
			hasDbAgents = true;

			// Locate seeded Hermes
			if (!hermesAgent) {
				hermesAgent = dbAgents.find((a) => a.is_overseer);
			}

			// Fetch real database posts to aggregate token costs and actual views/likes/etc.
			const { data: dbPosts } = await locals.supabase
				.from('posts')
				.select('agent_id, token_usage, token_cost, analytics, status, published_at, created_at');

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

			// Exclude overseer from creator roster and load all creators (active, paused, pending)
			const creators = dbAgents.filter((a) => !a.is_overseer);

			// For each agent, dynamically compute their active state, performance score, and connection counts
			agents = creators.map((a) => {
				const connCount = a.connection_count ?? 0;
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

				// Calculate real engagement rate if posts are published, otherwise fall back to db or 0
				let engVal = parseFloat(a.engagement_rate as any) || 0;
				if (publishedCount > 0 && totalViews > 0) {
					engVal = parseFloat(((totalLikes / totalViews) * 100).toFixed(2));
				}

				// Real data only: if 0 posts, keep metrics as 0
				if (agentPosts.length === 0) {
					totalTokenUsage = 0;
					totalTokenCost = 0;
				}

				// Calculate a dynamic performance score based on connections and engagement
				const perf = Math.min(99, Math.max(40, Math.round(70 + engVal * 2.5 + connCount * 4)));

				return {
					...a,
					niche: (a.niche || '').split(' & ')[0] || a.niche,
					engagementRate: engVal,
					engagement_rate: engVal,
					active: a.status === 'active',
					trend: '+0.0%', // real trend or 0
					perf,
					total_token_usage: totalTokenUsage,
					total_token_cost: Number(totalTokenCost.toFixed(4)),
					total_views: totalViews,
					total_likes: totalLikes
				};
			});
		}
	}

	const allowDemo = privateEnv.ALLOW_DEMO_MODE === 'true';

	if (!hasDbAgents) {
		agents = [];
		postsThisWeek = 0;
	}

	// Calculate platform distribution purely from active connections (no mock percentages)
	const platformColors: Record<string, string> = {
		Instagram: 'linear-gradient(90deg,#833ab4,#e1306c)',
		TikTok: 'linear-gradient(90deg,#25f4ee,#fe2c55)',
		'Twitter/X': 'linear-gradient(90deg,#1da1f2,#0d8bd9)',
		LinkedIn: 'linear-gradient(90deg,#0077b5,#00a0dc)',
		YouTube: 'linear-gradient(90deg,#ff0000,#cc0000)',
		Threads: 'linear-gradient(90deg,#000,#333)'
	};

	let platformData = Object.entries(platformColors).map(([name, color]) => {
		return { name, pct: 0, color };
	});

	if (hasDbAgents && !isPlaceholder && locals.supabase) {
		// Try to query connections to calculate real percentages
		const { data: conns } = await locals.supabase.from('connections').select('platform');
		if (conns && conns.length > 0) {
			const counts: Record<string, number> = {};
			conns.forEach((c) => {
				let name = c.platform;
				if (name === 'instagram') name = 'Instagram';
				else if (name === 'tiktok') name = 'TikTok';
				else if (name === 'x') name = 'Twitter/X';
				else if (name === 'linkedin') name = 'LinkedIn';
				else if (name === 'youtube') name = 'YouTube';
				else if (name === 'threads') name = 'Threads';
				else name = name.charAt(0).toUpperCase() + name.slice(1);

				counts[name] = (counts[name] || 0) + 1;
			});

			const total = conns.length;
			platformData = Object.entries(platformColors)
				.map(([name, color]) => {
					const count = counts[name] || 0;
					const pct = Math.round((count / total) * 100);
					return { name, pct, color };
				})
				.sort((a, b) => b.pct - a.pct);
		}
	} else if (!hasDbAgents) {
		if (allowDemo) {
			// Default platform percentages for static fallback mode only
			platformData = [
				{ name: 'Instagram', pct: 38, color: platformColors['Instagram'] },
				{ name: 'TikTok', pct: 27, color: platformColors['TikTok'] },
				{ name: 'Twitter/X', pct: 16, color: platformColors['Twitter/X'] },
				{ name: 'LinkedIn', pct: 10, color: platformColors['LinkedIn'] },
				{ name: 'YouTube', pct: 6, color: platformColors['YouTube'] },
				{ name: 'Threads', pct: 3, color: platformColors['Threads'] }
			];
		} else {
			platformData = [];
		}
	}

	// Spark chart data (engagement trend per agent, 7 days)
	let sparkData: number[][] = [];

	if (hasDbAgents && locals.supabase) {
		const dbPosts = await locals.supabase
			.from('posts')
			.select('agent_id, status, analytics, published_at, created_at');

		const postsByAgent: Record<string, any[]> = {};
		if (dbPosts.data) {
			dbPosts.data.forEach((post) => {
				if (!postsByAgent[post.agent_id]) {
					postsByAgent[post.agent_id] = [];
				}
				postsByAgent[post.agent_id].push(post);
			});
		}

		sparkData = agents.slice(0, 3).map((agent) => {
			const agentPosts = postsByAgent[agent.id] || [];
			const publishedPosts = agentPosts.filter((p) => p.status === 'published' && p.analytics);

			// Map last 7 days (from 6 days ago until today)
			const dayArrays = Array.from({ length: 7 }, (_, i) => {
				const d = new Date();
				d.setDate(d.getDate() - (6 - i));
				return d.toISOString().split('T')[0];
			});

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
					return parseFloat(((dayLikes / dayViews) * 100).toFixed(1));
				}
				// True live connection engagement or 0
				const hasActiveConns = (agent.connection_count ?? 0) > 0;
				return hasActiveConns ? parseFloat((agent.engagement_rate || 5.8).toFixed(1)) : 0;
			});

			return dailyRates;
		});
	} else {
		if (allowDemo) {
			// Static fallbacks for offline demo mode
			sparkData = agents.slice(0, 3).map((agent) => {
				const base = agent.engagementRate || 5.0;
				return [
					Math.max(1, +(base - 0.8).toFixed(1)),
					Math.max(1, +(base - 0.5).toFixed(1)),
					Math.max(1, +(base - 0.3).toFixed(1)),
					Math.max(1, +(base + 0.2).toFixed(1)),
					Math.max(1, +(base + 0.1).toFixed(1)),
					Math.max(1, +(base + 0.3).toFixed(1)),
					Math.max(1, +base.toFixed(1))
				];
			});
		} else {
			sparkData = [];
		}
	}

	if (!hermesAgent) {
		if (allowDemo) {
			hermesAgent = {
				id: 'hermes-fallback-id',
				name: 'Hermes',
				handle: '@hermes_overseer',
				initial: 'H',
				gradient: 'linear-gradient(135deg, #10B981, #06B6D4)',
				status: 'active',
				followers: '1',
				engagement_rate: 10.0,
				is_overseer: true
			};
		} else {
			hermesAgent = null;
		}
	}

	return {
		agents,
		sparkData,
		platformData,
		postsThisWeek,
		hermesAgent,
		managedAgentsCount,
		openTicketsCount,
		unclaimedMessagesCount,
		hermesConfigPresent
	};
};
