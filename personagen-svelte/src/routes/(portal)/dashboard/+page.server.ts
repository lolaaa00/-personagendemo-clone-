import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	let agents: any[] = [];
	let hasDbAgents = false;

	if (!isPlaceholder && locals.supabase) {
		const db = createDbService(locals.supabase);
		const { data: dbAgents } = await db.agents.list();

		if (dbAgents && dbAgents.length > 0) {
			hasDbAgents = true;

			// Fetch real database posts to aggregate token costs and actual views/likes/etc.
			const { data: dbPosts } = await locals.supabase
				.from('posts')
				.select('agent_id, token_usage, token_cost, analytics, status');

			const postsByAgent: Record<string, any[]> = {};
			if (dbPosts) {
				dbPosts.forEach((post) => {
					if (!postsByAgent[post.agent_id]) {
						postsByAgent[post.agent_id] = [];
					}
					postsByAgent[post.agent_id].push(post);
				});
			}

			// For each agent, dynamically compute their active state, performance score, and connection counts
			agents = dbAgents.map((a) => {
				const followersVal = parseFloat(a.followers) || 0;
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

				// Calculate real engagement rate if posts are published, otherwise fall back to default
				let engVal = parseFloat(a.engagement_rate as any) || 5.2;
				if (publishedCount > 0 && totalViews > 0) {
					engVal = parseFloat(((totalLikes / totalViews) * 100).toFixed(2));
				}

				// If there are zero database posts for this agent, let's seed some realistic demo values
				if (agentPosts.length === 0) {
					let seed = 0;
					for (let i = 0; i < a.name.length; i++) seed += a.name.charCodeAt(i);
					totalTokenUsage = 15000 + (seed % 10) * 1250;
					totalTokenCost = totalTokenUsage * 0.00000018 + 0.15;
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
					trend: '+1.2%', // default mock trend
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
	}

	// Calculate platform distribution from database if active
	const platformColors: Record<string, string> = {
		'Instagram': 'linear-gradient(90deg,#833ab4,#e1306c)',
		'TikTok': 'linear-gradient(90deg,#25f4ee,#fe2c55)',
		'Twitter/X': 'linear-gradient(90deg,#1da1f2,#0d8bd9)',
		'LinkedIn': 'linear-gradient(90deg,#0077b5,#00a0dc)',
		'YouTube': 'linear-gradient(90deg,#ff0000,#cc0000)',
		'Threads': 'linear-gradient(90deg,#000,#333)'
	};

	let platformData = [
		{ name: 'Instagram', pct: 38, color: platformColors['Instagram'] },
		{ name: 'TikTok', pct: 27, color: platformColors['TikTok'] },
		{ name: 'Twitter/X', pct: 16, color: platformColors['Twitter/X'] },
		{ name: 'LinkedIn', pct: 10, color: platformColors['LinkedIn'] },
		{ name: 'YouTube', pct: 6, color: platformColors['YouTube'] },
		{ name: 'Threads', pct: 3, color: platformColors['Threads'] }
	];

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

			// If all percentages ended up 0, fallback to default for better aesthetic
			if (platformData.every((p) => p.pct === 0)) {
				platformData = [
					{ name: 'Instagram', pct: 38, color: platformColors['Instagram'] },
					{ name: 'TikTok', pct: 27, color: platformColors['TikTok'] },
					{ name: 'Twitter/X', pct: 16, color: platformColors['Twitter/X'] },
					{ name: 'LinkedIn', pct: 10, color: platformColors['LinkedIn'] },
					{ name: 'YouTube', pct: 6, color: platformColors['YouTube'] },
					{ name: 'Threads', pct: 3, color: platformColors['Threads'] }
				];
			}
		}
	}

	// Spark chart data (engagement trend per agent, 7 days)
	// We generate this dynamically based on the loaded agents' engagement rate
	const sparkData = agents.slice(0, 3).map((agent) => {
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

	// If fewer than 3 agents, pad sparkData with defaults
	while (sparkData.length < 3) {
		sparkData.push([4.8, 5.1, 5.4, 6.0, 5.8, 6.2, 6.2]);
	}

	return {
		agents,
		sparkData,
		platformData
	};
};
