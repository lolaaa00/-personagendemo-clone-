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




// API action types
export type ApiAction = string;

export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
}
