import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fetches the user's Hermes overseer agent or programmatically seeds it if missing.
 */
export async function getOrCreateHermes(supabase: SupabaseClient, userId: string) {
	// Query to see if an overseer exists
	const { data: hermesAgent, error: fetchErr } = await supabase
		.from('agents')
		.select('*')
		.eq('user_id', userId)
		.eq('is_overseer', true)
		.maybeSingle();

	if (fetchErr) {
		console.error('[Hermes Service] Error querying Hermes agent:', fetchErr);
	}

	if (hermesAgent) {
		// Normalize existing Hermes agent row if needed
		if (
			hermesAgent.runtime_owner !== 'svelte-gemini' ||
			hermesAgent.managed_by_overseer === true ||
			hermesAgent.supervisor_agent_id !== null
		) {
			console.log(
				`[Hermes Service] Normalizing existing Hermes agent parameters for user ${userId}.`
			);
			const { data: updatedHermes, error: normErr } = await supabase
				.from('agents')
				.update({
					runtime_owner: 'svelte-gemini',
					managed_by_overseer: false,
					supervisor_agent_id: null
				})
				.eq('id', hermesAgent.id)
				.select()
				.single();

			if (normErr) {
				console.error('[Hermes Service] Failed to normalize Hermes row:', normErr);
			} else if (updatedHermes) {
				return updatedHermes;
			}
		}
		return hermesAgent;
	}

	// Not found, programmatically seed it
	try {
		console.log(`[Hermes Service] Seeding missing Hermes overseer agent for user ${userId}.`);
		const { data: seeded, error: seedErr } = await supabase
			.from('agents')
			.insert({
				user_id: userId,
				name: 'Hermes',
				handle: '@hermes_overseer',
				initial: 'H',
				gradient: 'linear-gradient(135deg, #10B981, #06B6D4)',
				status: 'active',
				followers: '1',
				engagement_rate: 10.0,
				is_overseer: true,
				soul: 'You are the platform-level Chief Operational Overseer. Monitor health, orchestrate agents, and support human administrators.',
				skills: 'System health monitoring, scheduling, alert dispatch, database reporting',
				tools: 'system_log_reader, agent_orchestrator',
				runtime_owner: 'svelte-gemini'
			})
			.select()
			.single();

		if (seedErr) {
			// If unique index block kicked in because of concurrency, retry fetching once
			if (seedErr.code === '23505') {
				const { data: hermesRetry } = await supabase
					.from('agents')
					.select('*')
					.eq('user_id', userId)
					.eq('is_overseer', true)
					.maybeSingle();
				if (hermesRetry) return hermesRetry;
			}
			throw seedErr;
		}
		return seeded;
	} catch (err) {
		console.error('[Hermes Service] Critical failure seeding Hermes:', err);
		throw err;
	}
}

/**
 * Ensures a configuration record exists in agent_configs for the Hermes overseer.
 */
export async function ensureHermesConfig(
	supabase: SupabaseClient,
	userId: string,
	hermesId: string
) {
	const { data: config } = await supabase
		.from('agent_configs')
		.select('id')
		.eq('agent_id', hermesId)
		.maybeSingle();

	if (config) {
		return config;
	}

	try {
		const { data: seededConfig, error } = await supabase
			.from('agent_configs')
			.upsert({
				user_id: userId,
				agent_id: hermesId,
				soul: 'You are the platform-level Chief Operational Overseer. Monitor health, orchestrate agents, and support human administrators.',
				skills: 'System health monitoring, scheduling, alert dispatch, database reporting',
				tools: 'system_log_reader, agent_orchestrator',
				timezone: 'Australia/Sydney',
				posts_per_day: 3,
				active_hours_start: 8,
				active_hours_end: 22,
				autonomy_level: 'advisor'
			})
			.select()
			.single();

		if (error) throw error;
		return seededConfig;
	} catch (err) {
		console.error('[Hermes Service] Failed to seed Hermes config:', err);
	}
}

/**
 * Scans all non-overseer creator agents for the user and backfills them to be managed by Hermes.
 */
export async function ensureAgentsManagedByHermes(
	supabase: SupabaseClient,
	userId: string,
	hermesId: string
) {
	try {
		// 1. Fetch creators (explicitly excluding is_overseer = true to prevent self-management)
		const { data: creators, error } = await supabase
			.from('agents')
			.select('id, name, supervisor_agent_id, managed_by_overseer, runtime_owner')
			.eq('user_id', userId)
			.eq('is_overseer', false);

		if (error) throw error;
		if (!creators || creators.length === 0) return;

		// 2. Identify unlinked agents
		const unlinked = creators.filter(
			(c) =>
				!c.supervisor_agent_id ||
				c.managed_by_overseer !== true ||
				c.runtime_owner !== 'hermes-orchestrated'
		);

		if (unlinked.length === 0) return;

		console.log(
			`[Hermes Service] Backfilling ${unlinked.length} unlinked creator agents under Hermes management...`
		);

		for (const agent of unlinked) {
			const { error: updateErr } = await supabase
				.from('agents')
				.update({
					supervisor_agent_id: hermesId,
					managed_by_overseer: true,
					runtime_owner: 'hermes-orchestrated'
				})
				.eq('id', agent.id);

			if (updateErr) {
				console.error(
					`[Hermes Service] Failed to link agent ${agent.name} (${agent.id}) to Hermes:`,
					updateErr
				);
			}
		}
	} catch (err) {
		console.error('[Hermes Service] Error during agent backfill:', err);
	}
}
