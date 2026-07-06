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
	isActive: boolean;
}

export interface ZernioPublishResult {
	success: boolean;
	externalId?: string;
	permalink?: string | null;
	data?: unknown;
	error?: string;
}

export async function getZernioApiKey(supabase: any, userId?: string): Promise<string | null> {
	if (userId) {
		const userKey = await getUserApiKey(supabase, userId, 'zernio');
		if (userKey) return userKey;
	}

	const fallback = env.ZERNIO_API_KEY?.trim();
	return fallback && !fallback.includes('placeholder') ? fallback : null;
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
	 * Lists the social accounts connected under this Zernio API key.
	 * Used to resolve the `accountId` required for publishing. Verified against
	 * Zernio's documented shape `{ accounts: [{ _id, platform, username,
	 * displayName, isActive }], hasAnalyticsAccess }`, with tolerant fallbacks.
	 */
	async listAccounts(): Promise<ZernioAccount[]> {
		const response = await fetch(`${ZERNIO_BASE_URL}/accounts`, {
			method: 'GET',
			headers: this.getHeaders()
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(
				`Zernio accounts returned HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`
			);
		}
		let data: any = null;
		try {
			data = text ? JSON.parse(text) : null;
		} catch {
			data = null;
		}

		const list = Array.isArray(data?.accounts)
			? data.accounts
			: Array.isArray(data)
				? data
				: Array.isArray(data?.data?.accounts)
					? data.data.accounts
					: Array.isArray(data?.data)
						? data.data
						: Array.isArray(data?.items)
							? data.items
							: [];

		return list
			.map((a: any) => ({
				id: String(a?._id || a?.id || a?.accountId || a?.account_id || ''),
				platform: String(
					a?.platform || a?.provider || a?.type || a?.network || a?.channel || ''
				).toLowerCase(),
				handle: a?.username || a?.handle || a?.displayName || a?.display_name || a?.name || null,
				// Default true: only exclude accounts Zernio explicitly flags inactive.
				isActive: a?.isActive !== false
			}))
			.filter((a: ZernioAccount) => a.id && a.platform);
	}

	/** Lists Zernio profiles (workspaces) — tolerant to endpoint/shape variants. */
	async listProfiles(): Promise<Array<{ id: string; name: string | null }>> {
		for (const path of ['/users/me/profiles', '/profiles']) {
			const res = await fetch(`${ZERNIO_BASE_URL}${path}`, {
				method: 'GET',
				headers: this.getHeaders()
			});
			if (!res.ok) continue;
			let data: any = null;
			try {
				data = await res.json();
			} catch {
				continue;
			}
			const list = Array.isArray(data?.profiles)
				? data.profiles
				: Array.isArray(data?.items)
					? data.items
					: Array.isArray(data)
						? data
						: [];
			const mapped = list
				.map((p: any) => ({
					id: String(p?._id || p?.id || p?.profileId || ''),
					name: p?.name || p?.title || null
				}))
				.filter((p: { id: string }) => p.id);
			if (mapped.length) return mapped;
		}
		return [];
	}

	/**
	 * Generates a hosted OAuth connect URL for a platform (verified against
	 * Zernio docs: GET /v1/connect/{platform}?profileId=…&redirect_url=… →
	 * { authUrl }). After the user authorizes, Zernio redirects back to
	 * redirect_url with ?connected={platform}&accountId=… appended.
	 */
	async getConnectUrl(platform: string, redirectUrl?: string): Promise<string> {
		const p = platform.toLowerCase() === 'x' ? 'twitter' : platform.toLowerCase();
		const profiles = await this.listProfiles();
		const params = new URLSearchParams();
		if (profiles[0]?.id) params.set('profileId', profiles[0].id);
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

/** Platforms Zernio can publish to (used to prefer Zernio over Composio for routing). */
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
