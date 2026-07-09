import { env } from '$env/dynamic/private';
import { getUserApiKey } from '$lib/server/user-api-keys';
import { fetchWithTimeout } from './http';

// Module-scope shadow: every Zernio call in this file gets a hard deadline
// instead of hanging a scheduler tick on one stuck socket.
const fetch = fetchWithTimeout;

const ZERNIO_BASE_URL = 'https://zernio.com/api/v1';

export interface ZernioPublishInput {
	content: string;
	platform: string;
	accountId: string;
	mediaItems?: Array<{ type: 'image' | 'video'; url: string }>;
}

export interface ZernioAccount {
	id: string;
	platform: string;
	handle: string | null;
	displayName: string | null;
	profilePicture: string | null;
	/** The Zernio profile (persona bucket) this account is filed under. */
	profileId: string | null;
	isActive: boolean;
	/** Live follower count — only populated when the key has analytics access. */
	followersCount: number | null;
}

export interface ZernioPublishResult {
	success: boolean;
	externalId?: string;
	permalink?: string | null;
	data?: unknown;
	error?: string;
}

/** Normalized per-post metrics, shaped to what the scheduler stores on posts.analytics. */
export interface ZernioPostMetrics {
	views: number;
	likes: number;
	comments: number;
	shares: number;
	saves: number;
	impressions: number;
	reach: number;
	clicks: number;
	engagementRate: number;
}

/** A Zernio profile — the per-persona bucket that isolates connected accounts. */
export interface ZernioProfile {
	id: string;
	name: string | null;
	isDefault: boolean;
	isOverLimit: boolean;
}

export async function getZernioApiKey(supabase: any, userId?: string): Promise<string | null> {
	if (userId) {
		const userKey = await getUserApiKey(supabase, userId, 'zernio');
		if (userKey) return userKey;
	}

	const fallback = env.ZERNIO_API_KEY?.trim();
	return fallback && !fallback.includes('placeholder') ? fallback : null;
}

// ── Billing meter ──────────────────────────────────────────────────────────
// Zernio killed pricing tiers (verified 2026-07-08, zernio.com/pricing): billing
// is pure pay-per-connected-account, metered daily and prorated, GLOBAL across the
// key (not per persona). First 2 accounts free, then graduated per-account.

/** Monthly USD price of the account at a given 1-based connection index. */
function accountBandPriceUsd(indexOneBased: number): number {
	if (indexOneBased <= 2) return 0; // first 2 free
	if (indexOneBased <= 10) return 6; // accounts 3–10
	if (indexOneBased <= 100) return 3; // accounts 11–100
	if (indexOneBased <= 2000) return 1; // accounts 101–2,000
	return 0; // 2,001+ is custom/negotiated — don't assert a price
}

export interface ZernioAccountMeter {
	total: number;
	freeUsed: number;
	freeRemaining: number;
	billable: number;
	monthlyCostUsd: number;
	/** What connecting one more account would add per month. */
	nextAccountCostUsd: number;
}

/** Pure: derives the pay-per-account meter from the total connected-account count. */
export function computeZernioAccountMeter(total: number): ZernioAccountMeter {
	const t = Math.max(0, Math.floor(total));
	let monthly = 0;
	for (let i = 1; i <= t; i++) monthly += accountBandPriceUsd(i);
	return {
		total: t,
		freeUsed: Math.min(t, 2),
		freeRemaining: Math.max(0, 2 - t),
		billable: Math.max(0, t - 2),
		monthlyCostUsd: monthly,
		nextAccountCostUsd: accountBandPriceUsd(t + 1)
	};
}

export class ZernioClient {
	constructor(private apiKey: string) {}

	private getHeaders() {
		return {
			Authorization: `Bearer ${this.apiKey}`,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		};
	}

	private async getJson(path: string): Promise<{ ok: boolean; status: number; data: any; text: string }> {
		const res = await fetch(`${ZERNIO_BASE_URL}${path}`, {
			method: 'GET',
			headers: this.getHeaders()
		});
		const text = await res.text();
		let data: any = null;
		try {
			data = text ? JSON.parse(text) : null;
		} catch {
			data = null;
		}
		return { ok: res.ok, status: res.status, data, text };
	}

	async publishNow(input: ZernioPublishInput): Promise<ZernioPublishResult> {
		const response = await fetch(`${ZERNIO_BASE_URL}/posts`, {
			method: 'POST',
			headers: this.getHeaders(),
			body: JSON.stringify({
				content: input.content,
				publishNow: true,
				mediaItems: input.mediaItems?.length ? input.mediaItems : undefined,
				platforms: [
					{
						platform: input.platform,
						accountId: input.accountId
					}
				]
			})
		});

		const text = await response.text();
		let data: any = null;
		try {
			data = text ? JSON.parse(text) : null;
		} catch {
			data = text;
		}

		if (!response.ok) {
			return {
				success: false,
				error: `Zernio returned HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}`
			};
		}

		const post = data?.post || data?.data?.post || data?.data || data;
		const externalId = post?._id || post?.id || post?.postId;
		const permalink = post?.permalink || post?.url || post?.link || null;

		return {
			success: true,
			externalId: externalId ? String(externalId) : undefined,
			permalink: permalink ? String(permalink) : null,
			data
		};
	}

	/**
	 * Deletes a draft or scheduled post record from Zernio.
	 * Per Zernio docs, published posts cannot be deleted here — use unpublish() instead.
	 */
	async deletePost(postId: string): Promise<{ success: boolean; error?: string }> {
		const response = await fetch(`${ZERNIO_BASE_URL}/posts/${encodeURIComponent(postId)}`, {
			method: 'DELETE',
			headers: this.getHeaders()
		});
		if (!response.ok) {
			const text = await response.text();
			return { success: false, error: `Zernio delete returned HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}` };
		}
		return { success: true };
	}

	/**
	 * Fetches the social accounts under this key, optionally scoped to one profile
	 * (persona). Verified against Zernio OpenAPI: GET /v1/accounts →
	 * { accounts: [{ _id, platform, profileId, username, displayName, profilePicture,
	 * isActive, followersCount? }], hasAnalyticsAccess }. followersCount is only
	 * present when the key has analytics access, so we surface hasAnalyticsAccess
	 * for the caller to gate on rather than assuming a number exists.
	 */
	async fetchAccounts(opts?: {
		profileId?: string;
		includeOverLimit?: boolean;
	}): Promise<{ accounts: ZernioAccount[]; hasAnalyticsAccess: boolean }> {
		const params = new URLSearchParams();
		if (opts?.profileId) params.set('profileId', opts.profileId);
		if (opts?.includeOverLimit) params.set('includeOverLimit', 'true');
		params.set('limit', '200');
		const qs = params.toString();
		const { ok, status, data, text } = await this.getJson(`/accounts${qs ? `?${qs}` : ''}`);
		if (!ok) {
			throw new Error(`Zernio accounts returned HTTP ${status}${text ? `: ${text.slice(0, 200)}` : ''}`);
		}

		const list = Array.isArray(data?.accounts)
			? data.accounts
			: Array.isArray(data)
				? data
				: Array.isArray(data?.data?.accounts)
					? data.data.accounts
					: Array.isArray(data?.items)
						? data.items
						: [];

		const accounts: ZernioAccount[] = list
			.map((a: any) => {
				// profileId may be a bare string or an expanded { _id } Profile object.
				const rawProfile = a?.profileId ?? a?.profile ?? null;
				const profileId =
					rawProfile && typeof rawProfile === 'object'
						? String(rawProfile._id || rawProfile.id || '')
						: rawProfile
							? String(rawProfile)
							: null;
				const followers = a?.followersCount;
				return {
					id: String(a?._id || a?.id || a?.accountId || a?.account_id || ''),
					platform: String(
						a?.platform || a?.provider || a?.type || a?.network || a?.channel || ''
					).toLowerCase(),
					handle: a?.username || a?.handle || a?.displayName || a?.display_name || a?.name || null,
					displayName: a?.displayName || a?.display_name || null,
					profilePicture: a?.profilePicture || a?.profile_picture || null,
					profileId: profileId || null,
					isActive: a?.isActive !== false,
					followersCount: typeof followers === 'number' ? followers : null
				};
			})
			.filter((a: ZernioAccount) => a.id && a.platform);

		return { accounts, hasAnalyticsAccess: data?.hasAnalyticsAccess === true };
	}

	/** Thin wrapper: just the account list (used by publish routing + sync). */
	async listAccounts(opts?: { profileId?: string }): Promise<ZernioAccount[]> {
		return (await this.fetchAccounts(opts)).accounts;
	}

	/**
	 * Per-post metrics via GET /v1/analytics?postId=…. Returns normalized metrics or
	 * null when Zernio has no analytics for this post yet (never synthetic numbers).
	 * Analytics is bundled on every Zernio account (verified 2026-07-08), so this is
	 * the single post-metrics source.
	 */
	async fetchPostMetrics(postId: string): Promise<ZernioPostMetrics | null> {
		const { ok, data } = await this.getJson(`/analytics?postId=${encodeURIComponent(postId)}`);
		if (!ok) return null;
		// Response is oneOf; the post-analytics variant nests metrics under `analytics`.
		const a = data?.analytics || data?.data?.analytics || null;
		if (!a || typeof a !== 'object') return null;
		const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
		return {
			views: num(a.views),
			likes: num(a.likes),
			comments: num(a.comments),
			shares: num(a.shares),
			saves: num(a.saves),
			impressions: num(a.impressions),
			reach: num(a.reach),
			clicks: num(a.clicks),
			engagementRate: num(a.engagementRate)
		};
	}

	/**
	 * Follower counts per account via GET /v1/accounts/follower-stats. Scoped to a
	 * profile (persona) when given. Returns a map of accountId → currentFollowers.
	 * Requires analytics access; returns an empty map (never throws) when unavailable
	 * so live follower sync degrades gracefully instead of failing a status check.
	 */
	async getFollowerStats(opts?: {
		profileId?: string;
		accountIds?: string[];
	}): Promise<Map<string, number>> {
		const params = new URLSearchParams();
		if (opts?.profileId) params.set('profileId', opts.profileId);
		if (opts?.accountIds?.length) params.set('accountIds', opts.accountIds.join(','));
		const qs = params.toString();
		const out = new Map<string, number>();
		try {
			const { ok, data } = await this.getJson(`/accounts/follower-stats${qs ? `?${qs}` : ''}`);
			if (!ok) return out;
			const list = Array.isArray(data?.accounts) ? data.accounts : [];
			for (const a of list) {
				const id = String(a?._id || a?.id || '');
				const followers = a?.currentFollowers ?? a?.followersCount;
				if (id && typeof followers === 'number') out.set(id, followers);
			}
		} catch {
			/* analytics unavailable or transient — caller keeps prior counts */
		}
		return out;
	}

	/** Lists Zernio profiles (persona buckets). */
	async listProfiles(includeOverLimit = false): Promise<ZernioProfile[]> {
		const { ok, data } = await this.getJson(
			`/profiles${includeOverLimit ? '?includeOverLimit=true' : ''}`
		);
		if (!ok) return [];
		const list = Array.isArray(data?.profiles)
			? data.profiles
			: Array.isArray(data?.items)
				? data.items
				: Array.isArray(data)
					? data
					: [];
		return list
			.map((p: any) => ({
				id: String(p?._id || p?.id || p?.profileId || ''),
				name: p?.name || p?.title || null,
				isDefault: p?.isDefault === true,
				isOverLimit: p?.isOverLimit === true
			}))
			.filter((p: ZernioProfile) => p.id);
	}

	/**
	 * Ensures a Zernio profile exists for a persona and returns its id. Matches an
	 * existing profile by exact (case-insensitive) name first — idempotent across
	 * calls — otherwise creates one via POST /v1/profiles { name, color }.
	 */
	async ensureProfile(name: string, color?: string): Promise<string | null> {
		const wanted = name.trim().toLowerCase();
		if (wanted) {
			const existing = await this.listProfiles();
			const match = existing.find((p) => (p.name || '').trim().toLowerCase() === wanted);
			if (match) return match.id;
		}

		const res = await fetch(`${ZERNIO_BASE_URL}/profiles`, {
			method: 'POST',
			headers: this.getHeaders(),
			body: JSON.stringify({ name: name.trim() || 'Persona', ...(color ? { color } : {}) })
		});
		if (!res.ok) return null;
		let data: any = null;
		try {
			data = await res.json();
		} catch {
			return null;
		}
		const id = data?.profile?._id || data?.profile?.id || data?._id || data?.id;
		return id ? String(id) : null;
	}

	/**
	 * Disconnects an account in Zernio (DELETE /v1/accounts/{id}). This stops its
	 * per-account meter charge — the whole point of "disconnect" under pay-per-account
	 * billing — so it's more than a local hide. Best-effort; never throws.
	 */
	async disconnectAccount(accountId: string): Promise<boolean> {
		try {
			const res = await fetch(`${ZERNIO_BASE_URL}/accounts/${encodeURIComponent(accountId)}`, {
				method: 'DELETE',
				headers: this.getHeaders()
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	/** Moves an account onto a persona's profile (PATCH /v1/accounts/{id}). Best-effort. */
	async moveAccountToProfile(accountId: string, profileId: string): Promise<boolean> {
		try {
			const res = await fetch(`${ZERNIO_BASE_URL}/accounts/${encodeURIComponent(accountId)}`, {
				method: 'PATCH',
				headers: this.getHeaders(),
				body: JSON.stringify({ profileId })
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	/**
	 * Generates a hosted OAuth connect URL for a platform, filed under a persona's
	 * profile. Verified against Zernio OpenAPI: GET /v1/connect/{platform}?profileId=…
	 * &redirect_url=… → { authUrl, state }. After the user authorizes, Zernio
	 * redirects back to redirect_url; the new account lands under profileId.
	 */
	async getConnectUrl(platform: string, redirectUrl?: string, profileId?: string): Promise<string> {
		const p = platform.toLowerCase() === 'x' ? 'twitter' : platform.toLowerCase();
		let pid = profileId;
		if (!pid) {
			const profiles = await this.listProfiles();
			pid = profiles[0]?.id;
		}
		const params = new URLSearchParams();
		if (pid) params.set('profileId', pid);
		if (redirectUrl) params.set('redirect_url', redirectUrl);
		const qs = params.toString();
		const res = await fetch(
			`${ZERNIO_BASE_URL}/connect/${encodeURIComponent(p)}${qs ? `?${qs}` : ''}`,
			{ method: 'GET', headers: this.getHeaders() }
		);
		const text = await res.text();
		if (!res.ok) {
			throw new Error(`Zernio connect returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
		}
		let data: any = null;
		try {
			data = JSON.parse(text);
		} catch {
			data = null;
		}
		const url = data?.authUrl || data?.auth_url || data?.url;
		if (!url) throw new Error(`Zernio connect returned no authUrl: ${text.slice(0, 200)}`);
		return String(url);
	}

	/**
	 * Removes an already-published post from a specific platform.
	 * Zernio does NOT support Instagram, TikTok, or Snapchat for unpublish.
	 */
	async unpublish(postId: string, platform: string): Promise<{ success: boolean; error?: string }> {
		const response = await fetch(`${ZERNIO_BASE_URL}/posts/${encodeURIComponent(postId)}/unpublish`, {
			method: 'POST',
			headers: this.getHeaders(),
			body: JSON.stringify({ platform })
		});
		if (!response.ok) {
			const text = await response.text();
			return { success: false, error: `Zernio unpublish returned HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ''}` };
		}
		return { success: true };
	}
}

/** Platforms Zernio can publish to (the full connectable registry). */
export const ZERNIO_PUBLISH_SUPPORTED = [
	'instagram',
	'tiktok',
	'threads',
	'facebook',
	'twitter',
	'x',
	'linkedin',
	'youtube',
	'pinterest',
	'reddit',
	'bluesky',
	'googlebusiness',
	'telegram',
	'snapchat'
] as const;

/** Platforms Zernio's unpublish endpoint can remove a live post from. */
export const ZERNIO_UNPUBLISH_SUPPORTED = [
	'threads',
	'facebook',
	'twitter',
	'x',
	'linkedin',
	'youtube',
	'pinterest',
	'reddit',
	'bluesky',
	'googlebusiness',
	'telegram'
] as const;

/** Platforms with no API-based deletion path — the user must remove these manually. */
export const MANUAL_DELETE_ONLY_PLATFORMS = ['instagram', 'tiktok', 'snapchat'] as const;
