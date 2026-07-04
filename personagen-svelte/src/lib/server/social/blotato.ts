import { env } from '$env/dynamic/private';
import { getUserApiKey } from '$lib/server/user-api-keys';
import { fetchWithTimeout } from './http';

// Module-scope shadow: every Blotato call gets a hard deadline instead of
// hanging a scheduler tick on one stuck socket (same policy as zernio.ts).
const fetch = fetchWithTimeout;

const BLOTATO_BASE_URL = 'https://backend.blotato.com/v2';

/**
 * Blotato posting provider (https://help.blotato.com/api).
 *
 * Auth model: platform OAuth lives in Blotato's dashboard (my.blotato.com/settings);
 * this client authenticates to Blotato with an API key via the `blotato-api-key`
 * header. NOTE: generating a Blotato API key ends the free trial and starts the
 * paid plan — this integration stays dormant until a key is saved.
 *
 * Rate limit: 30 posts/min account-wide — the scheduler's sequential per-post
 * publishing stays far under this.
 */

export interface BlotatoAccount {
	id: string;
	platform: string;
	handle: string | null;
	displayName: string | null;
	/** Facebook/LinkedIn page id (from /subaccounts) required for page posting. */
	pageId?: string | null;
}

export interface BlotatoPublishInput {
	accountId: string;
	platform: string;
	text: string;
	mediaUrls: string[];
	/** Facebook/LinkedIn page target (stored in connection provider_metadata at sync). */
	pageId?: string | null;
	isVideo?: boolean;
}

export interface BlotatoPublishResult {
	success: boolean;
	externalId?: string;
	permalink?: string | null;
	data?: unknown;
	error?: string;
}

export async function getBlotatoApiKey(supabase: any, userId?: string): Promise<string | null> {
	if (userId) {
		const userKey = await getUserApiKey(supabase, userId, 'blotato').catch(() => null);
		if (userKey) return userKey;
	}
	const fallback = env.BLOTATO_API_KEY?.trim();
	return fallback && !fallback.includes('placeholder') ? fallback : null;
}

/** Platforms Blotato can publish to (per docs; used for routing preference). */
export const BLOTATO_PUBLISH_SUPPORTED = [
	'instagram',
	'tiktok',
	'youtube',
	'facebook',
	'twitter',
	'x',
	'threads',
	'linkedin',
	'pinterest',
	'bluesky'
] as const;

/** Maps our connections.platform vocabulary onto Blotato's platform values. */
function toBlotatoPlatform(platform: string): string {
	const p = platform.toLowerCase();
	if (p === 'x') return 'twitter';
	return p;
}

/**
 * Builds the per-platform `target` object POST /v2/posts requires. TikTok's
 * disclosure flags are set truthfully for AI-generated UGC.
 */
function buildTarget(platform: string, pageId?: string | null): Record<string, unknown> {
	const p = toBlotatoPlatform(platform);
	if (p === 'tiktok') {
		return {
			targetType: 'tiktok',
			privacyLevel: 'PUBLIC_TO_EVERYONE',
			disabledComments: false,
			disabledDuet: false,
			disabledStitch: false,
			isBrandedContent: false,
			isYourBrand: true,
			isAiGenerated: true
		};
	}
	if ((p === 'facebook' || p === 'linkedin') && pageId) {
		return { targetType: p, pageId };
	}
	if (p === 'youtube') {
		return { targetType: 'youtube', privacyStatus: 'public', shouldNotifySubscribers: true };
	}
	return { targetType: p };
}

export class BlotatoClient {
	constructor(private apiKey: string) {}

	private getHeaders() {
		return {
			'blotato-api-key': this.apiKey,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		};
	}

	/**
	 * Lists social accounts connected in the Blotato dashboard. For Facebook and
	 * LinkedIn accounts, also fetches subaccounts so page posting has a pageId.
	 * Verified shape: { items: [{ id, platform, fullname, username }] }.
	 */
	async listAccounts(): Promise<BlotatoAccount[]> {
		const response = await fetch(`${BLOTATO_BASE_URL}/users/me/accounts`, {
			method: 'GET',
			headers: this.getHeaders()
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(
				`Blotato accounts returned HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`
			);
		}
		let data: any = null;
		try {
			data = text ? JSON.parse(text) : null;
		} catch {
			data = null;
		}
		const list = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

		const accounts: BlotatoAccount[] = list
			.map((a: any) => ({
				id: String(a?.id ?? ''),
				platform: String(a?.platform ?? '').toLowerCase(),
				handle: a?.username ?? null,
				displayName: a?.fullname ?? null,
				pageId: null
			}))
			.filter((a: BlotatoAccount) => a.id && a.platform);

		// Page-based platforms need a pageId from /subaccounts; first page wins,
		// the full list is preserved by the caller in provider_metadata.
		for (const acc of accounts) {
			if (acc.platform !== 'facebook' && acc.platform !== 'linkedin') continue;
			try {
				const subRes = await fetch(
					`${BLOTATO_BASE_URL}/users/me/accounts/${encodeURIComponent(acc.id)}/subaccounts`,
					{ method: 'GET', headers: this.getHeaders() }
				);
				if (!subRes.ok) continue;
				const sub = (await subRes.json()) as any;
				const subs = Array.isArray(sub?.items) ? sub.items : Array.isArray(sub) ? sub : [];
				if (subs[0]?.id) acc.pageId = String(subs[0].id);
			} catch {
				/* page posting simply unavailable for this account */
			}
		}

		return accounts;
	}

	/** Publishes immediately via POST /v2/posts. */
	async publishNow(input: BlotatoPublishInput): Promise<BlotatoPublishResult> {
		const platform = toBlotatoPlatform(input.platform);
		const body = {
			post: {
				accountId: input.accountId,
				content: {
					text: input.text,
					mediaUrls: input.mediaUrls,
					platform
				},
				target: buildTarget(input.platform, input.pageId)
			}
		};

		const response = await fetch(`${BLOTATO_BASE_URL}/posts`, {
			method: 'POST',
			headers: this.getHeaders(),
			body: JSON.stringify(body)
		});

		const text = await response.text();
		let data: any = null;
		try {
			data = text ? JSON.parse(text) : text;
		} catch {
			data = text;
		}

		if (!response.ok) {
			return {
				success: false,
				error: `Blotato returned HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`
			};
		}

		const post = data?.post || data?.data || data;
		const externalId = post?.id || post?.postId || post?.submissionId;
		const permalink = post?.permalink || post?.url || null;

		return {
			success: true,
			externalId: externalId ? String(externalId) : undefined,
			permalink: permalink ? String(permalink) : null,
			data
		};
	}
}
