import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	// 1. Authenticate user
	const { session } = await locals.safeGetSession();
	if (!session) {
		return json({ success: false, error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json();
	const { name, niche, platform, bio, handle, gradient, initial } = body;

	if (!name) {
		return json({ success: false, error: 'Missing name parameter' }, { status: 400 });
	}

	try {
		const agentHandle = handle || ('@' + name.toLowerCase().replace(/[^a-z0-9]/g, '_'));
		const defaultGradient = `linear-gradient(135deg, hsl(${Math.floor(Math.random() * 360)}, 70%, 55%), hsl(${Math.floor(Math.random() * 360)}, 80%, 50%))`;
		const agentGradient = gradient || defaultGradient;
		const agentInitial = initial || name.charAt(0).toUpperCase();

		const { data: newAgent, error: agentError } = await locals.supabase
			.from('agents')
			.insert({
				user_id: session.user.id,
				name: name,
				handle: agentHandle,
				niche: niche || 'Lifestyle',
				status: 'active',
				soul: bio || `Autonomous ${niche || 'lifestyle'} creator.`,
				gradient: agentGradient,
				initial: agentInitial
			})
			.select()
			.single();

		if (agentError) {
			console.error('[API Agents] Agent insertion failed:', agentError);
			return json({ success: false, error: agentError.message }, { status: 500 });
		}

		// Create default agent_configs row
		try {
			const { error: configError } = await locals.supabase
				.from('agent_configs')
				.insert({
					user_id: session.user.id,
					agent_id: newAgent.id,
					soul: bio || `Autonomous ${niche || 'lifestyle'} creator.`,
					skills: '',
					tools: '',
					timezone: 'Australia/Sydney',
					posts_per_day: 3,
					active_hours_start: 8,
					active_hours_end: 22,
					autonomy_level: 'advisor'
				});
			if (configError) throw configError;
		} catch (configErr) {
			console.error('[API Agents] Could not create agent_configs:', configErr);
		}

		return json({
			success: true,
			data: newAgent
		});
	} catch (err: any) {
		console.error('[API Agents] Critical error:', err);
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
