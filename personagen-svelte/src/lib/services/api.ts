import type { ApiResponse } from '$lib/types';

const ENDPOINTS = {
	posts: '/api/posts',
	feed: '/api/posts',
	accounts: '/api/accounts',
	generate: '/api/engine?path=personagen-ai-generate',
	publish: '/api/engine?path=personagen-publish',
	trends: '/api/engine?path=personagen-trends',
	inbox: '/api/engine?path=personagen-engagement',
	factory: '/api/engine?path=personagen-account-factory',
	email: '/api/engine?path=personagen-email',
	channelDecode: '/api/engine?path=personagen-channel-decode',
	contentForge: '/api/engine?path=personagen-content-forge',
	blueprints: '/api/engine?path=personagen-blueprints',
	brandBrief: '/api/engine?path=personagen-brand-brief'
} as const;

async function request<T>(
	endpoint: string,
	action: string,
	payload: Record<string, unknown> = {}
): Promise<ApiResponse<T>> {
	try {
		const res = await fetch(endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, ts: Date.now(), ...payload })
		});
		if (!res.ok) {
			let errorMessage = `HTTP ${res.status}`;
			try {
				const errorData = await res.json() as any;
				if (errorData) {
					if (typeof errorData.error === 'string') {
						errorMessage = errorData.error;
					} else if (errorData.error && typeof errorData.error.message === 'string') {
						errorMessage = errorData.error.message;
					} else if (typeof errorData.message === 'string') {
						errorMessage = errorData.message;
					}
				}
			} catch {
				// Ignore JSON parsing failure and keep generic HTTP error
			}
			throw new Error(errorMessage);
		}
		return await res.json();
	} catch (err) {
		console.error(`[API] ${action} failed:`, err);
		return { success: false, error: (err as Error).message };
	}
}

// ── Posts (5 actions) ──────────────────────────────────────────────────────────

export const Posts = {
	create: (post: unknown) => request(ENDPOINTS.posts, 'create', { post }),
	update: (id: string, data: unknown) =>
		request(ENDPOINTS.posts, 'update', { id, ...(data as Record<string, unknown>) }),
	delete: (id: string) => request(ENDPOINTS.posts, 'delete', { id }),
	list: (filters?: Record<string, unknown>) => request(ENDPOINTS.posts, 'list', filters || {}),
	get: (id: string) => request(ENDPOINTS.posts, 'get', { id })
};

// ── Generate (4 actions) ───────────────────────────────────────────────────────

export const Generate = {
	content: (personaId: string, prompt: string, platforms: string[]) =>
		request(ENDPOINTS.generate, 'content', { persona_id: personaId, prompt, platforms }),
	reply: (personaId: string, context: unknown, platform: string) =>
		request(ENDPOINTS.generate, 'reply', { persona_id: personaId, context, platform }),
	trendPost: (personaId: string, trendTopic: string, platforms: string[]) =>
		request(ENDPOINTS.generate, 'trend_post', {
			persona_id: personaId,
			trend_topic: trendTopic,
			platforms
		}),
	batch: (personaId: string, count: number, platforms: string[]) =>
		request(ENDPOINTS.generate, 'batch', { persona_id: personaId, count, platforms })
};

// ── Publish (2 actions) ────────────────────────────────────────────────────────

export const Publish = {
	now: (post: unknown) => request(ENDPOINTS.publish, 'publish', { post }),
	retry: (postId: string) => request(ENDPOINTS.publish, 'retry', { post_id: postId })
};

// ── Accounts (4 actions) ───────────────────────────────────────────────────────

export const Accounts = {
	initConnection: (personaId: string, platform: string) =>
		request(ENDPOINTS.accounts, 'initiate_connection', { persona_id: personaId, platform }),
	checkStatus: (personaId: string) =>
		request(ENDPOINTS.accounts, 'check_status', { persona_id: personaId }),
	disconnect: (personaId: string, platform: string) =>
		request(ENDPOINTS.accounts, 'disconnect', { persona_id: personaId, platform }),
	listAll: () => request(ENDPOINTS.accounts, 'list_accounts', {})
};

// ── Feed (3 actions) ───────────────────────────────────────────────────────────

export const Feed = {
	calendar: (month: number, year: number, personaId?: string) =>
		request(ENDPOINTS.feed, 'calendar', { month, year, persona_id: personaId }),
	upcoming: (limit = 10) => request(ENDPOINTS.feed, 'upcoming', { limit }),
	recent: (limit = 10) => request(ENDPOINTS.feed, 'recent', { limit })
};

// ── Trends (3 actions) ─────────────────────────────────────────────────────────

export const Trends = {
	get: (personaId: string) => request(ENDPOINTS.trends, 'get', { persona_id: personaId }),
	getByNiche: (niche: string) => request(ENDPOINTS.trends, 'get_by_niche', { niche }),
	refresh: (personaId: string) => request(ENDPOINTS.trends, 'refresh', { persona_id: personaId })
};

// ── Inbox (4 actions) ──────────────────────────────────────────────────────────

export const Inbox = {
	list: (personaId: string, filters?: Record<string, unknown>) =>
		request(ENDPOINTS.inbox, 'list', { persona_id: personaId, ...filters }),
	approve: (id: string) => request(ENDPOINTS.inbox, 'approve', { id }),
	ignore: (id: string) => request(ENDPOINTS.inbox, 'ignore', { id }),
	updateReply: (id: string, replyText: string) =>
		request(ENDPOINTS.inbox, 'update_reply', { id, reply_text: replyText })
};

// ── Factory (6 actions) ────────────────────────────────────────────────────────

export const Factory = {
	create: (persona: unknown) => request(ENDPOINTS.factory, 'create_account', { persona }),
	status: (id: string) => request(ENDPOINTS.factory, 'check_status', { id }),
	retry: (id: string, step: string) => request(ENDPOINTS.factory, 'retry', { id, step }),
	refresh: (id: string) => request(ENDPOINTS.factory, 'refresh_session', { id }),
	health: (id: string) => request(ENDPOINTS.factory, 'health_check', { id }),
	list: () => request(ENDPOINTS.factory, 'list_accounts', {})
};

// ── Email (6 actions) ──────────────────────────────────────────────────────────

export const Email = {
	listInbox: (personaId: string) => request(ENDPOINTS.email, 'list', { persona_id: personaId }),
	getThread: (threadId: string) => request(ENDPOINTS.email, 'thread', { thread_id: threadId }),
	send: (personaId: string, msg: Record<string, unknown>) =>
		request(ENDPOINTS.email, 'send', { persona_id: personaId, ...msg }),
	draft: (personaId: string, emailId: string) =>
		request(ENDPOINTS.email, 'ai_draft', { persona_id: personaId, email_id: emailId }),
	approve: (emailId: string) => request(ENDPOINTS.email, 'approve_send', { email_id: emailId }),
	search: (personaId: string, query: string) =>
		request(ENDPOINTS.email, 'search', { persona_id: personaId, q: query })
};

// ── Channel Decode (5 actions) ─────────────────────────────────────────────────

export const ChannelDecode = {
	decode: (url: string, platform: string) =>
		request(ENDPOINTS.channelDecode, 'decode', { url, platform }),
	analyze: (channelData: unknown) =>
		request(ENDPOINTS.channelDecode, 'analyze', { channel_data: channelData }),
	getBlueprint: (id: string) => request(ENDPOINTS.channelDecode, 'get_blueprint', { id }),
	listBlueprints: () => request(ENDPOINTS.channelDecode, 'list_blueprints', {}),
	deleteBlueprint: (id: string) => request(ENDPOINTS.channelDecode, 'delete_blueprint', { id })
};

// ── Content Forge (5 actions) ──────────────────────────────────────────────────

export const ContentForge = {
	generate: (
		blueprintId: string,
		topic: string,
		agentHandle: string,
		platforms: string[]
	) =>
		request(ENDPOINTS.contentForge, 'generate', {
			blueprint_id: blueprintId,
			topic,
			agent_handle: agentHandle,
			platforms
		}),
	titles: (blueprintId: string, topic: string, count = 5) =>
		request(ENDPOINTS.contentForge, 'titles', { blueprint_id: blueprintId, topic, count }),
	script: (blueprintId: string, topic: string, agentHandle: string) =>
		request(ENDPOINTS.contentForge, 'script', {
			blueprint_id: blueprintId,
			topic,
			agent_handle: agentHandle
		}),
	thumbnailBrief: (blueprintId: string, topic: string) =>
		request(ENDPOINTS.contentForge, 'thumbnail_brief', { blueprint_id: blueprintId, topic }),
	repurpose: (contentId: string, targetPlatforms: string[]) =>
		request(ENDPOINTS.contentForge, 'repurpose', {
			content_id: contentId,
			target_platforms: targetPlatforms
		})
};

// ── Blueprints (3 actions) ─────────────────────────────────────────────────────

export const Blueprints = {
	feedToAgent: (blueprintId: string, agentHandle: string, targets: unknown) =>
		request(ENDPOINTS.blueprints, 'feed_to_agent', {
			blueprint_id: blueprintId,
			agent_handle: agentHandle,
			targets
		}),
	getAgentBlueprints: (agentHandle: string) =>
		request(ENDPOINTS.blueprints, 'get_agent_blueprints', { agent_handle: agentHandle }),
	removeFromAgent: (blueprintId: string, agentHandle: string) =>
		request(ENDPOINTS.blueprints, 'remove_from_agent', {
			blueprint_id: blueprintId,
			agent_handle: agentHandle
		})
};

// ── Brand Brief (2 actions) ───────────────────────────────────────────────────

export const BrandBrief = {
	scrapeStore: (url: string) => request<any>(ENDPOINTS.brandBrief, 'scrape_store', { url }),
	extendField: (fieldName: string, fieldVal: string) =>
		request<{ enriched: string }>(ENDPOINTS.brandBrief, 'extend_field', { fieldName, fieldVal })
};

