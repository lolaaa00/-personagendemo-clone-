import type { SupabaseClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════
// Row types — mirror the SQL migration
// ═══════════════════════════════════════

export interface ProfileRow {
	id: string;
	full_name: string | null;
	company: string | null;
	avatar_url: string | null;
	created_at: string;
	updated_at: string;
}

export interface AgentRow {
	id: string;
	user_id: string;
	name: string;
	handle: string;
	niche: string;
	status: 'active' | 'paused' | 'pending';
	soul: string;
	skills: string;
	tools: string;
	heartbeat: string;
	market: string;
	gradient: string;
	initial: string;
	engagement_rate: number;
	followers: string;
	connection_count: number;
	is_overseer?: boolean;
	supervisor_agent_id?: string | null;
	managed_by_overseer?: boolean;
	runtime_owner?: 'svelte-gemini' | 'hermes-gateway' | 'hermes-orchestrated';
	created_at: string;
	updated_at: string;
}

export interface AgentConfigRow {
	id: string;
	user_id: string;
	agent_id: string;
	soul: string;
	skills: string;
	tools: string;
	timezone: string;
	posts_per_day: number;
	active_hours_start: number;
	active_hours_end: number;
	autonomy_level: 'advisor' | 'semi_autonomous' | 'fully_autonomous';
	rss_url: string;
	rss_active: boolean;
	rss_last_polled_at: string | null;
	ugc_voice: string;
	ugc_character_ref: string | null;
	ugc_reference_kit: Record<string, string> | null;
	created_at: string;
	updated_at: string;
}

export interface PostRow {
	id: string;
	user_id: string;
	agent_id: string;
	content: string;
	platforms: string[];
	status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'partial';
	scheduled_date: string | null;
	scheduled_time: string | null;
	published_at: string | null;
	external_id?: string | null;
	analytics?: { views: number; likes: number; comments: number; shares: number } | null;
	publication_results?: Record<string, unknown> | null;
	token_usage?: number | null;
	token_cost?: number | null;
	created_at: string;
	updated_at: string;
}

export interface ConnectionRow {
	id: string;
	user_id: string;
	agent_id: string;
	platform: 'tiktok' | 'instagram' | 'youtube' | 'x' | 'facebook' | 'threads';
	handle: string | null;
	verified: boolean;
	connected_at: string;
	last_sync: string | null;
	followers?: number | null;
	engagement_rate?: number | null;
	status?: 'active' | 'stale' | 'reauth_required' | 'revoked' | 'error' | null;
	last_error?: string | null;
	last_checked_at?: string | null;
	provider?: 'composio' | 'zernio' | null;
	provider_account_id?: string | null;
	provider_metadata?: Record<string, unknown> | null;
}

export interface BlueprintRow {
	id: string;
	user_id: string;
	channel_name: string | null;
	channel_url: string | null;
	platform: string | null;
	score: number;
	layers: Record<string, unknown>;
	created_at: string;
}

export interface BrandBriefRow {
	id: string;
	user_id: string;
	data: Record<string, unknown>;
	version: number;
	created_at: string;
	updated_at: string;
}

export interface SubscriptionRow {
	id: string;
	user_id: string;
	plan: 'free' | 'starter' | 'pro' | 'enterprise';
	status: 'active' | 'canceled' | 'past_due' | 'trialing';
	current_period_end: string | null;
	created_at: string;
	updated_at: string;
}

export interface ProcessedRssItemRow {
	id: string;
	agent_id: string;
	item_guid: string;
	processed_at: string;
}

// ═══════════════════════════════════════
// Insert / Update partials
// ═══════════════════════════════════════

export type AgentInsert = Omit<AgentRow, 'id' | 'created_at' | 'updated_at'> & {
	id?: string;
};
export type AgentUpdate = Partial<Omit<AgentRow, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

export type AgentConfigInsert = Omit<
	AgentConfigRow,
	| 'id'
	| 'created_at'
	| 'updated_at'
	| 'rss_url'
	| 'rss_active'
	| 'rss_last_polled_at'
	| 'ugc_voice'
	| 'ugc_character_ref'
	| 'ugc_reference_kit'
> & {
	id?: string;
	rss_url?: string;
	rss_active?: boolean;
	rss_last_polled_at?: string | null;
	ugc_voice?: string;
	ugc_character_ref?: string | null;
	ugc_reference_kit?: Record<string, string> | null;
};
export type AgentConfigUpdate = Partial<
	Omit<AgentConfigRow, 'id' | 'user_id' | 'agent_id' | 'created_at' | 'updated_at'>
>;

export type PostInsert = Omit<PostRow, 'id' | 'created_at' | 'updated_at'> & { id?: string };
export type PostUpdate = Partial<Omit<PostRow, 'id' | 'user_id' | 'created_at' | 'updated_at'>>;

export type ConnectionInsert = Omit<ConnectionRow, 'id' | 'connected_at'> & { id?: string };

export type BlueprintInsert = Omit<BlueprintRow, 'id' | 'created_at'> & { id?: string };

export type BrandBriefInsert = Omit<BrandBriefRow, 'id' | 'created_at' | 'updated_at'> & {
	id?: string;
};

export type ProfileUpdate = Partial<Omit<ProfileRow, 'id' | 'created_at' | 'updated_at'>> & {
	id: string;
};

export type SubscriptionUpdate = Partial<
	Omit<SubscriptionRow, 'id' | 'created_at' | 'updated_at'>
> & { user_id: string };

// ═══════════════════════════════════════
// Post list joined type (includes agent embed)
// ═══════════════════════════════════════

export type PostWithAgent = PostRow & {
	agents: Pick<AgentRow, 'name' | 'handle' | 'gradient' | 'initial'>;
};

// ═══════════════════════════════════════
// Filter types
// ═══════════════════════════════════════

export interface PostListFilters {
	agent_id?: string;
	month?: number;
	year?: number;
}

// ═══════════════════════════════════════
// Database service factory
// ═══════════════════════════════════════

export function createDbService(supabase: SupabaseClient) {
	/**
	 * Upsert-as-merge: fetches the existing row (if any) and layers `data` on
	 * top of it before upserting. Postgres/PostgREST upsert-on-conflict treats
	 * any column absent from the payload as null/default, not "leave
	 * unchanged" — without this, a caller that saves one field (e.g. voice)
	 * silently wipes every other column the payload didn't mention (e.g. a
	 * generated avatar/reference kit). An explicit `null`/value in `data`
	 * still overrides `existing` as expected; only omitted keys are protected.
	 */
	async function mergeUpsert(
		table: string,
		data: Record<string, any>,
		onConflict: string,
		matchColumns: string[]
	) {
		let query = supabase.from(table).select('*');
		for (const col of matchColumns) query = query.eq(col, data[col]);
		const { data: existing } = await query.maybeSingle();

		return supabase
			.from(table)
			.upsert({ ...existing, ...data }, { onConflict })
			.select()
			.single();
	}

	return {
		// ── Agents ──────────────────────────────
		agents: {
			list: () => supabase.from('agents').select('*').order('created_at', { ascending: false }),

			get: (id: string) => supabase.from('agents').select('*').eq('id', id).single(),

			create: (data: AgentInsert) => supabase.from('agents').insert(data).select().single(),

			update: (id: string, data: AgentUpdate) =>
				supabase.from('agents').update(data).eq('id', id).select().single(),

			delete: (id: string) => supabase.from('agents').delete().eq('id', id)
		},

		// ── Agent Configs ───────────────────────
		agentConfigs: {
			get: (agentId: string) =>
				supabase.from('agent_configs').select('*').eq('agent_id', agentId).single(),

			upsert: (data: AgentConfigInsert) =>
				mergeUpsert('agent_configs', data, 'user_id,agent_id', ['agent_id'])
		},

		// ── Posts ────────────────────────────────
		posts: {
			list: (filters?: PostListFilters) => {
				let q = supabase.from('posts').select('*, agents(name, handle, gradient, initial)');

				if (filters?.agent_id) {
					q = q.eq('agent_id', filters.agent_id);
				}

				if (filters?.month && filters?.year) {
					const start = `${filters.year}-${String(filters.month).padStart(2, '0')}-01`;
					const endMonth = filters.month === 12 ? 1 : filters.month + 1;
					const endYear = filters.month === 12 ? filters.year + 1 : filters.year;
					const end = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;
					q = q.gte('scheduled_date', start).lt('scheduled_date', end);
				}

				return q.order('scheduled_date').order('scheduled_time');
			},

			get: (id: string) => supabase.from('posts').select('*').eq('id', id).single(),

			create: (data: PostInsert) => supabase.from('posts').insert(data).select().single(),

			update: (id: string, data: PostUpdate) =>
				supabase.from('posts').update(data).eq('id', id).select().single(),

			delete: (id: string) => supabase.from('posts').delete().eq('id', id)
		},

		// ── Connections ─────────────────────────
		connections: {
			listForAgent: (agentId: string) =>
				supabase.from('connections').select('*').eq('agent_id', agentId),

			upsert: (data: ConnectionInsert) =>
				mergeUpsert('connections', data, 'agent_id,platform', ['agent_id', 'platform']),

			delete: (agentId: string, platform: string) =>
				supabase.from('connections').delete().eq('agent_id', agentId).eq('platform', platform)
		},

		// ── Blueprints ──────────────────────────
		blueprints: {
			list: () => supabase.from('blueprints').select('*').order('created_at', { ascending: false }),

			get: (id: string) => supabase.from('blueprints').select('*').eq('id', id).single(),

			create: (data: BlueprintInsert) => supabase.from('blueprints').insert(data).select().single(),

			update: (id: string, data: Partial<BlueprintRow>) =>
				supabase.from('blueprints').update(data).eq('id', id).select().single(),

			delete: (id: string) => supabase.from('blueprints').delete().eq('id', id)
		},

		// ── Brand Briefs ────────────────────────
		brandBriefs: {
			// maybeSingle (not single): a brand-new user genuinely has zero rows
			// here, which must resolve to {data: null, error: null} — .single()
			// would return a PGRST116 error for that normal case, making it
			// indistinguishable from a real query failure to any caller that
			// only checks `data`.
			get: (userId?: string) => {
				let q = supabase.from('brand_briefs').select('*').order('updated_at', { ascending: false });
				if (userId) {
					q = q.eq('user_id', userId);
				}
				return q.limit(1).maybeSingle();
			},

			upsert: (data: BrandBriefInsert) => mergeUpsert('brand_briefs', data, 'user_id', ['user_id'])
		},

		// ── Profiles ────────────────────────────
		profiles: {
			get: () => supabase.from('profiles').select('*').single(),

			update: (data: ProfileUpdate) =>
				supabase.from('profiles').update(data).eq('id', data.id).select().single()
		},

		// ── Subscriptions ───────────────────────
		subscriptions: {
			get: () => supabase.from('subscriptions').select('*').single(),

			update: (data: SubscriptionUpdate) =>
				supabase.from('subscriptions').update(data).eq('user_id', data.user_id).select().single()
		},

		// ── Processed RSS Items ─────────────────
		processedRssItems: {
			hasBeenProcessed: (agentId: string, itemGuid: string) =>
				supabase
					.from('processed_rss_items')
					.select('id')
					.eq('agent_id', agentId)
					.eq('item_guid', itemGuid)
					.maybeSingle(),

			markAsProcessed: (agentId: string, itemGuid: string) =>
				supabase
					.from('processed_rss_items')
					.insert({ agent_id: agentId, item_guid: itemGuid })
					.select()
					.single()
		}
	};
}

export type DbService = ReturnType<typeof createDbService>;
