export interface Agent {
	id: string;
	tenant_id: string;
	name: string;
	handle: string;
	niche: string;
	status: 'active' | 'paused' | 'pending';
	active: boolean;
	soul: string;
	skills: string;
	tools: string;
	heartbeat: string;
	market: string;
	gradient: string;
	initial: string;
	engagement_rate: number;
	followers: string;
	config: Record<string, unknown>;
	connection_count?: number;
	/** User-configurable autonomy level */
	autonomy_level: AutonomyLevel;
	is_overseer?: boolean;
	supervisor_agent_id?: string | null;
	managed_by_overseer?: boolean;
	runtime_owner?: 'svelte-gemini' | 'hermes-gateway' | 'hermes-orchestrated';
}

/** Modular autonomy — set per agent in the persona's Profile tab */
export type AutonomyLevel = 'advisor' | 'semi_autonomous' | 'fully_autonomous';

export const AUTONOMY_LABELS: Record<
	AutonomyLevel,
	{ label: string; description: string; icon: string }
> = {
	advisor: {
		label: 'Advisor',
		description: 'Suggests content and strategies. User approves everything.',
		icon: '💡'
	},
	semi_autonomous: {
		label: 'Semi-Autonomous',
		description: 'Generates and schedules drafts. User approves publishing.',
		icon: '⚡'
	},
	fully_autonomous: {
		label: 'Fully Autonomous',
		description: 'Publishes, monitors, and responds with guardrails.',
		icon: '🚀'
	}
};

// API action types
export type ApiAction = string;

export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
}
