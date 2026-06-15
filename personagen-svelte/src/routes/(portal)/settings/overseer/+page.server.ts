import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';
import { getOrCreateHermes, ensureHermesConfig, ensureAgentsManagedByHermes } from '$lib/server/hermes';

export const load: PageServerLoad = async ({ locals }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) {
		throw redirect(303, '/login');
	}

	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	if (isPlaceholder || !locals.supabase) {
		// Mock Hermes for offline/dev bypass mode
		return {
			hermesAgent: {
				id: 'hermes-dev-bypass-id',
				name: 'Hermes',
				handle: '@hermes_overseer',
				initial: 'H',
				gradient: 'linear-gradient(135deg, #10B981, #06B6D4)',
				status: 'active',
				soul: 'You are the platform-level Chief Operational Overseer. Monitor health, orchestrate agents, and support human administrators.',
				skills: 'System diagnostics, team scheduling, autonomous recovery, user reports analysis',
				tools: 'system_log_reader, agent_orchestrator, slack_notifier, backup_scheduler',
				is_overseer: true
			},
			memories: [
				{
					id: 'm1',
					content: 'Maintain server CPU threshold alerts below 85% at all times.',
					memory_type: 'instruction',
					importance: 9,
					created_at: new Date().toISOString()
				},
				{
					id: 'm2',
					content: 'Hourly system heartbeat pacing is configured to run at minute :00.',
					memory_type: 'fact',
					importance: 7,
					created_at: new Date().toISOString()
				}
			]
		};
	}

	const db = createDbService(locals.supabase);

	// 1. Fetch or Programmatically Seed Hermes Agent
	let hermesAgent: any = null;
	try {
		hermesAgent = await getOrCreateHermes(locals.supabase, user.id);
		await ensureHermesConfig(locals.supabase, user.id, hermesAgent.id);
		await ensureAgentsManagedByHermes(locals.supabase, user.id, hermesAgent.id);
	} catch (err) {
		console.error('[Overseer Server] Critical failure seeding/linking Hermes:', err);
		return {
			hermesAgent: null,
			memories: [],
			managedCreators: [],
			agentsMissingConfig: [],
			error: 'Failed to resolve Hermes overseer'
		};
	}

	// 2. Fetch Memories and Creator Lists
	const [memoriesRes, creatorsRes, configsRes] = await Promise.all([
		db.agentMemories.listForAgent(hermesAgent.id),
		locals.supabase.from('agents').select('*').eq('user_id', user.id).eq('is_overseer', false),
		locals.supabase.from('agent_configs').select('agent_id').eq('user_id', user.id)
	]);

	const memories = memoriesRes.data ?? [];
	const dbAgents = creatorsRes.data ?? [];
	const configs = configsRes.data ?? [];

	const managedCreators = dbAgents.filter((a) => a.supervisor_agent_id === hermesAgent.id);
	const configuredIds = new Set(configs.map((c) => c.agent_id));
	const agentsMissingConfig = dbAgents.filter((a) => !configuredIds.has(a.id));

	return {
		hermesAgent,
		memories,
		managedCreators,
		agentsMissingConfig
	};
};

export const actions: Actions = {
	updateOverseer: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) {
			return fail(401, { error: 'Unauthorized' });
		}

		const formData = await request.formData();
		const name = formData.get('name')?.toString() || 'Hermes';
		const soul = formData.get('soul')?.toString() || '';
		const skills = formData.get('skills')?.toString() || '';
		const tools = formData.get('tools')?.toString() || '';
		const initial = formData.get('initial')?.toString() || 'H';
		const gradient =
			formData.get('gradient')?.toString() || 'linear-gradient(135deg, #10B981, #06B6D4)';

		const db = createDbService(locals.supabase);

		// Get Hermes' ID
		const { data: hermesAgent } = await locals.supabase
			.from('agents')
			.select('id')
			.eq('user_id', user.id)
			.eq('is_overseer', true)
			.maybeSingle();

		if (!hermesAgent) {
			return fail(404, { error: 'Hermes agent not found' });
		}

		const { error } = await db.agents.update(hermesAgent.id, {
			name,
			soul,
			skills,
			tools,
			initial,
			gradient
		});

		if (error) {
			console.error('[Overseer Actions] updateOverseer failure:', error);
			return fail(500, { error: error.message });
		}

		return { success: true };
	},

	addMemory: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) {
			return fail(401, { error: 'Unauthorized' });
		}

		const formData = await request.formData();
		const content = formData.get('content')?.toString() || '';
		const type = formData.get('memory_type')?.toString() || 'fact';
		const importance = parseInt(formData.get('importance')?.toString() || '5');

		if (!content.trim()) {
			return fail(400, { error: 'Memory guideline content is required' });
		}

		const db = createDbService(locals.supabase);

		// Get Hermes' ID
		const { data: hermesAgent } = await locals.supabase
			.from('agents')
			.select('id')
			.eq('user_id', user.id)
			.eq('is_overseer', true)
			.maybeSingle();

		if (!hermesAgent) {
			return fail(404, { error: 'Hermes agent not found' });
		}

		const { error } = await db.agentMemories.create({
			user_id: user.id,
			agent_id: hermesAgent.id,
			memory_type: type as any,
			content,
			importance,
			summary: null
		});

		if (error) {
			console.error('[Overseer Actions] addMemory failure:', error);
			return fail(500, { error: error.message });
		}

		return { success: true };
	},

	deleteMemory: async ({ request, locals }) => {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) {
			return fail(401, { error: 'Unauthorized' });
		}

		const formData = await request.formData();
		const id = formData.get('id')?.toString() || '';

		if (!id) {
			return fail(400, { error: 'Memory ID is required' });
		}

		const db = createDbService(locals.supabase);
		const { error } = await db.agentMemories.delete(id);

		if (error) {
			console.error('[Overseer Actions] deleteMemory failure:', error);
			return fail(500, { error: error.message });
		}

		return { success: true };
	}
};
