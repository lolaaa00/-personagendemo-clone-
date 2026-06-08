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
			// For each agent, dynamically compute their active state, performance score, and connection counts
			agents = dbAgents.map((a) => {
				const followersVal = parseFloat(a.followers) || 0;
				const engVal = parseFloat(a.engagement_rate as any) || 0;
				const connCount = a.connection_count ?? 0;

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
					perf
				};
			});
		}
	}

	if (!hasDbAgents) {
		// Fallback to static JSON
		const agentsRes = await fetch('/data/agents.json');
		const rawAgents: any[] = await agentsRes.json();
		agents = rawAgents.map((a) => ({
			...a,
			niche: (a.niche || '').split(' & ')[0] || a.niche,
			engagementRate: a.engagementRate || parseFloat(a.engagement) || 0,
			engagement_rate: a.engagementRate || parseFloat(a.engagement) || 0,
			active: a.status === 'active',
			connection_count: a.connectionCount ?? 0,
			autonomy_level: a.autonomy_level ?? 'advisor'
		}));
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
