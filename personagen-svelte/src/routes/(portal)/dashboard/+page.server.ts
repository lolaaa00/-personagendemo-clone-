import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';

export const load: PageServerLoad = async ({ locals }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	let agents: any[] = [];
	let hasDbAgents = false;
	let postsThisWeek = 0;

	if (!isPlaceholder && locals.supabase) {
		const { session, user } = await locals.safeGetSession();
		if (session && user) {
			const db = createDbService(locals.supabase);
			const { data: dbAgents } = await db.agents.list();

			if (dbAgents && dbAgents.length > 0) {
				hasDbAgents = true;

				// Fetch real database posts
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

				// Roster of creator agents
				const creators = dbAgents.filter((a) => !a.is_overseer);

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

					let engVal = parseFloat(a.engagement_rate as any) || 0;
					if (publishedCount > 0 && totalViews > 0) {
						engVal = parseFloat(((totalLikes / totalViews) * 100).toFixed(2));
					}

					if (agentPosts.length === 0) {
						totalTokenUsage = 0;
						totalTokenCost = 0;
					}

					const perf = Math.min(99, Math.max(40, Math.round(70 + engVal * 2.5 + connCount * 4)));

					return {
						...a,
						niche: (a.niche || '').split(' & ')[0] || a.niche,
						engagementRate: engVal,
						engagement_rate: engVal,
						active: a.status === 'active',
						trend: '+0.0%',
						perf,
						total_token_usage: totalTokenUsage,
						total_token_cost: Number(totalTokenCost.toFixed(4)),
						total_views: totalViews,
						total_likes: totalLikes
					};
				});
			}
		}
	}

	const allowDemo = privateEnv.ALLOW_DEMO_MODE === 'true';

	if (!hasDbAgents) {
		agents = [];
		postsThisWeek = 0;
	}

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
	} else if (!hasDbAgents && allowDemo) {
		platformData = [
			{ name: 'Instagram', pct: 38, color: platformColors['Instagram'] },
			{ name: 'TikTok', pct: 27, color: platformColors['TikTok'] },
			{ name: 'Twitter/X', pct: 16, color: platformColors['Twitter/X'] },
			{ name: 'LinkedIn', pct: 10, color: platformColors['LinkedIn'] },
			{ name: 'YouTube', pct: 6, color: platformColors['YouTube'] },
			{ name: 'Threads', pct: 3, color: platformColors['Threads'] }
		];
	}

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
				const hasActiveConns = (agent.connection_count ?? 0) > 0;
				return hasActiveConns ? parseFloat((agent.engagement_rate || 5.8).toFixed(1)) : 0;
			});

			return dailyRates;
		});
	} else if (!hasDbAgents && allowDemo) {
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
	}

	return {
		agents,
		sparkData,
		platformData,
		postsThisWeek
	};
};
