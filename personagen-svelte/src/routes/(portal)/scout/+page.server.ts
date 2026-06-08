import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
	const agentsRes = await fetch('/data/agents.json');
	const rawAgents: any[] = await agentsRes.json();

	const agents = rawAgents.map((a) => ({
		...a,
		niche: (a.niche || '').split(' & ')[0] || a.niche,
		engagement_rate: a.engagementRate || parseFloat(a.engagement) || 0,
		active: a.status === 'active',
		connection_count: a.connectionCount ?? 0,
		autonomy_level: a.autonomy_level ?? 'advisor'
	}));

	return { agents };
};
