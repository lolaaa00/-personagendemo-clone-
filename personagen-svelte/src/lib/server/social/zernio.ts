import { env } from '$env/dynamic/private';
import { getUserApiKey } from '$lib/server/user-api-keys';

const ZERNIO_BASE_URL = 'https://zernio.com/api/v1';

export interface ZernioPublishInput {
	content: string;
	platform: string;
	accountId: string;
	mediaItems?: Array<{ type: 'image' | 'video'; url: string }>;
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

/** Platforms Zernio's unpublish endpoint can remove a live post from. */
export const ZERNIO_UNPUBLISH_SUPPORTED = [
	'threads',
	'facebook',
	'twitter',
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
