export interface Tenant {
	id: string;
	slug: string;
	name: string;
	gateway_url: string;
	config: TenantConfig;
	stripe_customer_id?: string;
}

export interface TenantConfig {
	branding: { name: string; tagline: string; logo_url?: string };
	pricing: PricingTier[];
	features: Record<string, boolean>;
}

export interface PricingTier {
	id: string;
	name: string;
	price: number;
	interval: 'monthly' | 'yearly';
	stripe_price_id: string;
	features: string[];
}

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

/** Modular autonomy — set per agent in persona-config */
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

export interface Connection {
	id: string;
	tenant_id: string;
	agent_id: string;
	platform: 'tiktok' | 'instagram' | 'youtube' | 'x' | 'facebook';
	handle: string;
	verified: boolean;
}

export interface Post {
	id: string;
	tenant_id: string;
	agent_id: string;
	content: PostContent;
	platforms: string[];
	status: 'draft' | 'scheduled' | 'published' | 'failed';
	type: string;
	scheduled_at?: string;
	published_at?: string;
	timezone: string;
	generation_source?: string;
	created_at: string;
}

export interface PostContent {
	text: string;
	hashtags: string[];
	media_url?: string;
	privacy: string;
}

export interface Blueprint {
	id: string;
	tenant_id: string;
	channel_name: string;
	niche: string;
	platform: string;
	score: number;
	layers: Record<string, unknown>;
	created_at: string;
}

export interface BrandBrief {
	id: string;
	tenant_id: string;
	data: Record<string, unknown>;
	version: number;
}

export interface PMTicket {
	id: string;
	tenant_id: string;
	title: string;
	description: string;
	status: 'backlog' | 'in_progress' | 'review' | 'done';
	priority: 'low' | 'medium' | 'high' | 'urgent';
	assignee_agent_id?: string;
	due_date?: string;
	position: number;
}

export interface InboxThread {
	id: string;
	tenant_id: string;
	agent_id: string;
	thread_id: string;
	platform: string;
	messages: unknown[];
	status: 'pending' | 'approved' | 'ignored';
}

// ═══════════════════════════════════════
// Gemini Managed Agent Types
// ═══════════════════════════════════════

export interface AgentChatMessage {
	id: string;
	role: 'user' | 'agent' | 'system';
	content: string;
	tool_calls?: AgentToolCall[];
	timestamp: string;
}

export interface AgentToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
	result?: unknown;
	status: 'pending' | 'executing' | 'completed' | 'failed';
}

export interface AgentSession {
	id: string;
	agent_id: string;
	environment_id?: string;
	messages: AgentChatMessage[];
	created_at: string;
	updated_at: string;
}

// API action types
export type ApiAction = string;

export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
}
