import type { PageServerLoad } from './$types';
import { createDbService } from '$lib/server/db';
import { env } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { redirect } from '@sveltejs/kit';
import {
	getOrCreateHermes,
	ensureHermesConfig,
	ensureAgentsManagedByHermes
} from '$lib/server/hermes';

export const load: PageServerLoad = async ({ locals, params, fetch }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	let agents: any[] = [];
	let hermesAgent: any = null;

	if (!isPlaceholder && locals.supabase) {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) {
			throw redirect(303, '/login');
		}

		const db = createDbService(locals.supabase);

		// 1. Fetch creators/agents
		const { data: dbAgents, error: agentsErr } = await db.agents.list();
		if (dbAgents) {
			// Separate Hermes overseer and regular agents
			agents = dbAgents.filter((a) => !a.is_overseer);
			hermesAgent = dbAgents.find((a) => a.is_overseer) || null;
		}

		// 2. Fetch or Programmatically Seed Hermes Agent if missing
		try {
			hermesAgent = await getOrCreateHermes(locals.supabase, user.id);
			await ensureHermesConfig(locals.supabase, user.id, hermesAgent.id);
			await ensureAgentsManagedByHermes(locals.supabase, user.id, hermesAgent.id);

			// Refetch agents to include newly seeded/backfilled values
			const { data: dbAgents } = await db.agents.list();
			if (dbAgents) {
				agents = dbAgents.filter((a) => !a.is_overseer);
				if (!hermesAgent) {
					hermesAgent = dbAgents.find((a) => a.is_overseer) || null;
				}
			}
		} catch (err) {
			console.error('[Chat Server] Critical failure seeding/linking Hermes:', err);
		}
	}

	const allowDemo = privateEnv.ALLOW_DEMO_MODE === 'true';

	// If hermes is still null, generate a fallback
	if (!hermesAgent) {
		if (allowDemo) {
			hermesAgent = {
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
			};
		} else {
			hermesAgent = {
				id: 'empty-hermes-id',
				name: 'Hermes',
				handle: '@hermes_overseer',
				initial: 'H',
				gradient: 'linear-gradient(135deg, #10B981, #06B6D4)',
				status: 'active',
				is_overseer: true
			};
		}
	}

	// 4. Resolve currently selected agent
	const selectedAgentId = params.agentId || 'hermes';
	let selectedAgent = null;

	if (selectedAgentId === 'hermes' || selectedAgentId === hermesAgent.id) {
		selectedAgent = { ...hermesAgent, isHermes: true };
	} else {
		selectedAgent = agents.find((a) => String(a.id) === selectedAgentId) || null;
		if (!selectedAgent) {
			// If not found, default back to Hermes
			selectedAgent = { ...hermesAgent, isHermes: true };
		}
	}

	return {
		agents,
		hermesAgent,
		selectedAgentId,
		selectedAgent
	};
};
