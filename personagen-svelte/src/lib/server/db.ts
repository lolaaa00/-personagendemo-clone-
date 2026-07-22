import type { SupabaseClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════
// Row types — mirror the SQL migration
// ═══════════════════════════════════════

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
	runtime_owner?: 'svelte-gemini' | 'hermes-daemon' | 'hermes-orchestrated';
	// Zernio profile that isolates this persona's connected social accounts.
	// Null until provisioned on first connect (api/accounts writes it,
	// publisher.ts reads it to route). See zernio_profile_routing_migration.sql.
	zernio_profile_id?: string | null;
	// Optional managed Zernio key (zernio_keys row) this persona routes through.
	// Null = the user's default key. Profile ids are per Zernio account, so
	// changing this clears zernio_profile_id. See zernio_key_manager_migration.sql.
	zernio_key_id?: string | null;
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
	/** Which of the user's brand briefs this persona generates for (null = newest-brief fallback). */
	brand_brief_id: string | null;
	created_at: string;
	updated_at: string;
}

export interface PostRow {
	id: string;
	user_id: string;
	agent_id: string;
	content: string;
	platforms: string[];
	// Full superset allowed by posts_status_check. 'generating' is the async
	// generate-post up-front state; 'rejected' is written by the review queue.
	status:
		| 'draft'
		| 'generating'
		| 'scheduled'
		| 'publishing'
		| 'published'
		| 'partial'
		| 'failed'
		| 'rejected';
	scheduled_date: string | null;
	scheduled_time: string | null;
	published_at: string | null;
	external_id?: string | null;
	analytics?: {
		views: number;
		likes: number;
		comments: number;
		shares: number;
		saves?: number;
		impressions?: number;
		reach?: number;
		clicks?: number;
		engagementRate?: number;
	} | null;
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
	// Validated by the DB CHECK constraint + CONNECTABLE_PLATFORMS (both derived
	// from $lib/platforms) — a TS union here would just be a third copy to drift.
	platform: string;
	handle: string | null;
	verified: boolean;
	connected_at: string;
	last_sync: string | null;
	followers?: number | null;
	engagement_rate?: number | null;
	status?: 'active' | 'stale' | 'reauth_required' | 'revoked' | 'error' | null;
	last_error?: string | null;
	last_checked_at?: string | null;
	// New connections are always 'zernio' (the single consolidated provider).
	// 'composio'/'blotato' remain only on legacy rows pending reconnect.
	provider?: 'zernio' | 'composio' | 'blotato' | null;
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
	/** Brand label for pickers — one user can run several brands, each with its own brief. */
	name: string;
	data: Record<string, unknown>;
	version: number;
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

// Everything but the row-identity keys is optional: db.agentConfigs.upsert
// goes through mergeUpsert (see below), which merges onto the existing row —
// any field genuinely can be omitted and will keep its current DB value
// rather than needing a caller-supplied default.
export type AgentConfigInsert = Partial<Omit<AgentConfigRow, 'id' | 'created_at' | 'updated_at'>> & {
	id?: string;
	user_id: string;
	agent_id: string;
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
	 * Upsert-as-merge, race-free for the common case: tries a plain UPDATE
	 * first. A real SQL UPDATE only ever touches the columns present in
	 * `data` — no read, no merge, no race window, and safe under concurrent
	 * writers touching different columns of the same row (each statement only
	 * SETs its own columns; Postgres's row lock serializes the rest).
	 *
	 * Falls back to read-merge-upsert ONLY when the row doesn't exist yet
	 * (UPDATE affected 0 rows) — upsert's actual job. That fallback still
	 * needs the merge: Postgres/PostgREST upsert-on-conflict treats any
	 * column absent from the payload as null/default, not "leave unchanged",
	 * so a first-creation payload that races with another creator (the row
	 * appears between our UPDATE and this upsert) must re-read and merge
	 * before writing, or it'd null out whatever the other writer just set.
	 */
	async function mergeUpsert(
		table: string,
		data: Record<string, any>,
		onConflict: string,
		matchColumns: string[]
	) {
		let updateQuery = supabase.from(table).update(data);
		for (const col of matchColumns) updateQuery = updateQuery.eq(col, data[col]);
		const { data: updated, error: updateError } = await updateQuery.select();

		if (updateError) return { data: null, error: updateError };
		if (updated && updated.length > 0) {
			return { data: updated[0], error: null };
		}

		let selectQuery = supabase.from(table).select('*');
		for (const col of matchColumns) selectQuery = selectQuery.eq(col, data[col]);
		const { data: existing } = await selectQuery.maybeSingle();

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

		// ── Brand Briefs (multi-brand: several briefs per user) ─────────
		brandBriefs: {
			// Newest-brief fallback: callers with no specific brief selected get
			// the most recently updated one. maybeSingle (not single): a
			// brand-new user genuinely has zero rows here, which must resolve to
			// {data: null, error: null} — .single() would return a PGRST116
			// error for that normal case, making it indistinguishable from a
			// real query failure to any caller that only checks `data`.
			get: (userId?: string) => {
				let q = supabase.from('brand_briefs').select('*').order('updated_at', { ascending: false });
				if (userId) {
					q = q.eq('user_id', userId);
				}
				return q.limit(1).maybeSingle();
			},

			getById: (id: string, userId: string) =>
				supabase.from('brand_briefs').select('*').eq('id', id).eq('user_id', userId).maybeSingle(),

			list: (userId: string) =>
				supabase
					.from('brand_briefs')
					.select('id, name, version, updated_at')
					.eq('user_id', userId)
					.order('updated_at', { ascending: false }),

			create: (data: BrandBriefInsert) =>
				supabase.from('brand_briefs').insert(data).select().single(),

			updateById: (id: string, userId: string, patch: Partial<Omit<BrandBriefRow, 'id' | 'user_id' | 'created_at'>>) =>
				supabase
					.from('brand_briefs')
					.update(patch)
					.eq('id', id)
					.eq('user_id', userId)
					.select()
					.single(),

			deleteById: (id: string, userId: string) =>
				supabase.from('brand_briefs').delete().eq('id', id).eq('user_id', userId)
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
