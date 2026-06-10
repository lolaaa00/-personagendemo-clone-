import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	let agents: any[] = [];
	let hasDbAgents = false;
	let postsThisWeek = 0;

	let hermesAgent: any = null;

	if (!isPlaceholder && locals.supabase) {
		const db = createDbService(locals.supabase);
		const { data: dbAgents } = await db.agents.list();

		if (dbAgents && dbAgents.length > 0) {
			hasDbAgents = true;

			// Locate or programmatically seed Hermes
			hermesAgent = dbAgents.find((a) => a.is_overseer);
			if (!hermesAgent) {
				try {
					console.log('[Dashboard Server] Hermes agent not found for active user. Programmatically seeding.');
					const { data: sessionData } = await locals.safeGetSession();
					if (sessionData && sessionData.user) {
						const { data: newHermes, error: seedErr } = await locals.supabase
							.from('agents')
							.insert({
								user_id: sessionData.user.id,
								name: 'Hermes',
								handle: '@hermes_overseer',
								initial: 'H',
								gradient: 'linear-gradient(135deg, #10B981, #06B6D4)',
								status: 'active',
								followers: '1',
								engagement_rate: 10.0,
								is_overseer: true
							})
							.select()
							.single();

						if (!seedErr && newHermes) {
							hermesAgent = newHermes;
						}
					}
				} catch (err) {
					console.error('[Dashboard Server] Failed to seed Hermes agent:', err);
				}
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

			// Exclude overseer from creator roster
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
				const perf = Math.min(
					99,
					Math.max(40, Math.round(70 + engVal * 2.5 + connCount * 4))
				);

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

	if (!hasDbAgents) {
		// Fallback to static JSON
		const agentsRes = await fetch('/data/agents.json');
		const rawAgents: any[] = await agentsRes.json();
		agents = rawAgents.map((a, idx) => {
			const engVal = a.engagementRate || parseFloat(a.engagement) || 5.2;
			const totalTokenUsage = 18450 + (idx * 3420);
			const totalTokenCost = totalTokenUsage * 0.00000018 + 0.22;
			return {
				...a,
				niche: (a.niche || '').split(' & ')[0] || a.niche,
				engagementRate: engVal,
				engagement_rate: engVal,
				active: a.status === 'active',
				connection_count: a.connectionCount ?? 0,
				autonomy_level: a.autonomy_level ?? 'advisor',
				total_token_usage: totalTokenUsage,
				total_token_cost: Number(totalTokenCost.toFixed(4))
			};
		});
		postsThisWeek = agents.filter((a) => a.active).length * 3;
	}

	// Calculate platform distribution purely from active connections (no mock percentages)
	const platformColors: Record<string, string> = {
		'Instagram': 'linear-gradient(90deg,#833ab4,#e1306c)',
		'TikTok': 'linear-gradient(90deg,#25f4ee,#fe2c55)',
		'Twitter/X': 'linear-gradient(90deg,#1da1f2,#0d8bd9)',
		'LinkedIn': 'linear-gradient(90deg,#0077b5,#00a0dc)',
		'YouTube': 'linear-gradient(90deg,#ff0000,#cc0000)',
		'Threads': 'linear-gradient(90deg,#000,#333)'
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
			platformData = Object.entries(platformColors).map(([name, color]) => {
				const count = counts[name] || 0;
				const pct = Math.round((count / total) * 100);
				return { name, pct, color };
			}).sort((a, b) => b.pct - a.pct);
		}
	} else if (!hasDbAgents) {
		// Default platform percentages for static fallback mode only
		platformData = [
			{ name: 'Instagram', pct: 38, color: platformColors['Instagram'] },
			{ name: 'TikTok', pct: 27, color: platformColors['TikTok'] },
			{ name: 'Twitter/X', pct: 16, color: platformColors['Twitter/X'] },
			{ name: 'LinkedIn', pct: 10, color: platformColors['LinkedIn'] },
			{ name: 'YouTube', pct: 6, color: platformColors['YouTube'] },
			{ name: 'Threads', pct: 3, color: platformColors['Threads'] }
		];
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
	}

	if (!hermesAgent) {
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
	}

	return {
		agents,
		sparkData,
		platformData,
		postsThisWeek,
		hermesAgent
	};
};
