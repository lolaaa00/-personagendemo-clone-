import type { ApiResponse } from '$lib/types';

const ENDPOINTS = {
	posts: '/api/posts',
	feed: '/api/posts',
	accounts: '/api/accounts',
	contentForge: '/api/engine?path=personagen-content-forge',
	blueprints: '/api/engine?path=personagen-blueprints',
	brandBrief: '/api/engine?path=personagen-brand-brief',
	autopilot: '/api/autopilot'
} as const;

export interface AutopilotView {
	enabled: boolean;
	mode: 'advisor' | 'semi_autonomous' | 'fully_autonomous';
	window_start: number;
	window_end: number;
	timezone: string;
}

/**
 * Parses a fetch Response as JSON, translating non-JSON bodies (an HTML 502/504
 * gateway page, an empty proxy error) into a readable Error instead of letting
 * the raw `Unexpected token '<', "<!DOCTYPE"… is not valid JSON` parse failure
 * bubble into a toast.
 */
export async function parseJsonResponse<T = any>(res: Response): Promise<T> {
	const contentType = res.headers.get('content-type') ?? '';
	if (contentType.includes('json')) {
		try {
			return (await res.json()) as T;
		} catch {
			// Claimed JSON but unparseable — fall through to the status-based message.
		}
	}
	if (res.status === 502 || res.status === 504) {
		throw new Error(
			'The server took too long — the generation may still be running in the background.'
		);
	}
	if (res.status === 401) {
		throw new Error('Session expired — log in again.');
	}
	throw new Error(`Server error (HTTP ${res.status}).`);
}

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
		const data = (await parseJsonResponse<any>(res)) ?? {};
		if (!res.ok) {
			let errorMessage = `HTTP ${res.status}`;
			if (typeof data.error === 'string') {
				errorMessage = data.error;
			} else if (data.error && typeof data.error.message === 'string') {
				errorMessage = data.error.message;
			} else if (typeof data.message === 'string') {
				errorMessage = data.message;
			}
			throw new Error(errorMessage);
		}
		return data;
	} catch (err) {
		console.error(`[API] ${action} failed:`, err);
		return { success: false, error: (err as Error).message };
	}
}

// ── Posts (3 actions) ──────────────────────────────────────────────────────────
// list/get and the old Feed object (calendar/upcoming/recent) were removed —
// zero callers; calendar and the persona Feed tab both load posts via their
// own +page.server.ts, not this client-side service.

export const Posts = {
	create: (post: unknown) => request(ENDPOINTS.posts, 'create', { post }),
	/** Reads one post — used to poll an async generation job until it leaves 'generating'. */
	get: (id: string) => request<any>(ENDPOINTS.posts, 'get', { id }),
	update: (id: string, data: unknown) =>
		request(ENDPOINTS.posts, 'update', { id, ...(data as Record<string, unknown>) }),
	delete: (id: string) => request(ENDPOINTS.posts, 'delete', { id })
};

// ── Content Forge (8 actions — unified generation engine) ──────────────────

export const ContentForge = {
	generate: (
		agentId: string,
		topic: string,
		platform: string,
		templateId?: string,
		productId?: string
	) =>
		request(ENDPOINTS.contentForge, 'generate', {
			agent_id: agentId,
			topic,
			platforms: [platform],
			template_id: templateId,
			product_id: productId
		}),
	batchGenerate: (
		agentId: string,
		topic: string,
		count: number,
		platform: string,
		templateId?: string,
		productId?: string
	) =>
		request(ENDPOINTS.contentForge, 'batch_generate', {
			agent_id: agentId,
			topic,
			count,
			platforms: [platform],
			template_id: templateId,
			product_id: productId
		}),
	autoSchedule: (
		copies: unknown[],
		agentId: string,
		startDate: string,
		platform: string,
		intervalHours = 2,
		windowStart = 8,
		windowEnd = 20
	) =>
		request(ENDPOINTS.contentForge, 'auto_schedule', {
			copies,
			agent_id: agentId,
			start_date: startDate,
			platform,
			interval_hours: intervalHours,
			window_start: windowStart,
			window_end: windowEnd
		}),
	publishGenerated: (content: unknown, agentId: string, mediaUrl?: string) =>
		request(ENDPOINTS.contentForge, 'publish_generated', {
			content,
			agent_id: agentId,
			media_url: mediaUrl
		}),
	generateProfile: (agentId: string) =>
		request(ENDPOINTS.contentForge, 'generate_profile', { agent_id: agentId }),
	script: (agentId: string, topic: string, platform: string, templateId?: string) =>
		request(ENDPOINTS.contentForge, 'script', {
			agent_id: agentId,
			topic,
			platforms: [platform],
			blueprint_id: templateId
		}),
	titles: (agentId: string, topic: string, platform: string, templateId?: string) =>
		request(ENDPOINTS.contentForge, 'titles', {
			agent_id: agentId,
			topic,
			platforms: [platform],
			blueprint_id: templateId
		}),
	thumbnailBrief: (agentId: string, topic: string, platform: string) =>
		request(ENDPOINTS.contentForge, 'thumbnail_brief', {
			agent_id: agentId,
			topic,
			platforms: [platform]
		})
	// `repurpose` was removed: the engine action was a fake no-op (it returned
	// "Repurposing scheduled" without doing anything) and now answers 501.
};

// ── Blueprints / Style Templates (5 actions) ──────────────────────────────

export const Blueprints = {
	list: () => request(ENDPOINTS.blueprints, 'list_blueprints', {}),
	get: (id: string) => request(ENDPOINTS.blueprints, 'get_blueprint', { id }),
	save: (data: Record<string, unknown>) => request(ENDPOINTS.blueprints, 'save_blueprint', data),
	update: (id: string, data: unknown) =>
		request(ENDPOINTS.blueprints, 'update_blueprint', { id, data }),
	delete: (id: string) => request(ENDPOINTS.blueprints, 'delete_blueprint', { id })
};

// ── Brand Brief (5 actions) ───────────────────────────────────────────────

export const BrandBrief = {
	get: () => request<any>(ENDPOINTS.brandBrief, 'get_brief', {}),
	scrapeStore: (url: string) => request<any>(ENDPOINTS.brandBrief, 'scrape_store', { url }),
	scrapeProduct: (url: string) => request<any>(ENDPOINTS.brandBrief, 'scrape_product', { url }),
	extendField: (fieldName: string, fieldVal: string, brandContext?: string) =>
		request<{ enriched: string }>(ENDPOINTS.brandBrief, 'extend_field', { fieldName, fieldVal, brandContext }),
	generateField: (fieldName: string, brandContext?: string) =>
		request<{ generated: string }>(ENDPOINTS.brandBrief, 'generate_field', { fieldName, brandContext }),
	spinField: (fieldName: string, fieldVal: string, brandContext?: string) =>
		request<{ variations: string[] }>(ENDPOINTS.brandBrief, 'spin_field', { fieldName, fieldVal, brandContext }),
	// Multi-brand: briefId targets an existing brief; omitted = create new.
	save: (data: Record<string, unknown>, briefId?: string | null, name?: string) =>
		request<any>(ENDPOINTS.brandBrief, 'save_brief', { data, brief_id: briefId || undefined, name }),
	list: () => request<Array<{ id: string; name: string; updated_at: string }>>(ENDPOINTS.brandBrief, 'list_briefs', {}),
	getById: (briefId: string) => request<any>(ENDPOINTS.brandBrief, 'get_brief', { brief_id: briefId }),
	// Generate a unique, brand-tailored persona profile (all fields except gender)
	// for competitive influencer positioning. Server resolves name/soul/siblings.
	generatePersonaProfile: (agentId: string, brandBriefId: string | null, gender: string) =>
		request<{
			ageRanges: string[];
			archetype: string;
			contentFocus: string;
			targetAvatar: string;
			psychProfile: string;
			contentAngle: string;
		}>(ENDPOINTS.brandBrief, 'generate_persona_profile', { agentId, brandBriefId, gender })
};

// ── Autopilot (per-agent auto-generation config + manual top-up) ───────────

export const Autopilot = {
	getConfig: (agentId: string) =>
		request<AutopilotView>(ENDPOINTS.autopilot, 'get_config', { agent_id: agentId }),
	setConfig: (
		agentId: string,
		cfg: {
			enabled?: boolean;
			mode?: 'semi_autonomous' | 'fully_autonomous';
			window_start?: number;
			window_end?: number;
			timezone?: string;
		}
	) => request<AutopilotView>(ENDPOINTS.autopilot, 'set_config', { agent_id: agentId, ...cfg }),
	generateNow: (agentId: string) =>
		request<{ generated: number; agents: number }>(ENDPOINTS.autopilot, 'generate_now', {
			agent_id: agentId
		})
};

// ── Accounts / Connections (3 actions) ────────────────────────────────────

export const Accounts = {
	checkStatus: (agentId: string) =>
		request<Record<string, any>>(ENDPOINTS.accounts, 'check_status', { persona_id: agentId }),
	initConnection: (agentId: string, platform: string) =>
		request<{ redirect_url?: string }>(ENDPOINTS.accounts, 'initiate_connection', {
			persona_id: agentId,
			platform
		}),
	disconnect: (agentId: string, platform: string) =>
		request(ENDPOINTS.accounts, 'disconnect', { persona_id: agentId, platform })
};

// ── Personas (Direct DB) ──────────────────────────────────────────────────
export const Personas = {
	createDirect: (payload: { name: string; niche: string; platform: string; bio: string }) =>
		fetch('/api/agents', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		}).then(async (res) => {
			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.error || `HTTP ${res.status}`);
			}
			return data;
		})
};
