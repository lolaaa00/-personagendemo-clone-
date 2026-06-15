import { env } from '$env/dynamic/private';

const SUPPORTED_SOCIAL_PLATFORMS = ['tiktok', 'instagram', 'youtube', 'facebook'] as const;
export type SocialPlatform = (typeof SUPPORTED_SOCIAL_PLATFORMS)[number];

// Platform to Composio Action Slug mapping
const COMPOSIO_ACTION_MAPPING: Record<string, string> = {
	facebook: 'FACEBOOK_CREATE_POST',
	instagram: 'INSTAGRAM_PUBLISH_PHOTO',
	youtube: 'YOUTUBE_MULTIPART_UPLOAD_VIDEO',
	tiktok: 'TIKTOK_PUBLISH_VIDEO'
};

export function getAllSocialPlatforms(): SocialPlatform[] {
	return [...SUPPORTED_SOCIAL_PLATFORMS];
}

export function getComposioAuthConfigId(platform: string): string {
	const key = `COMPOSIO_AUTH_CONFIG_${platform.toUpperCase()}`;
	return env[key] || '';
}

export function isPlatformConfigured(platform: string): boolean {
	return Boolean(getComposioAuthConfigId(platform));
}

export class ComposioClient {
	private apiKey: string;
	private baseUrl = 'https://backend.composio.dev/api/v3';
	private baseUrlV3_1 = 'https://backend.composio.dev/api/v3.1';

	constructor() {
		this.apiKey = env.COMPOSIO_API_KEY || '';
	}

	private getHeaders() {
		return {
			'x-api-key': this.apiKey,
			'Content-Type': 'application/json'
		};
	}

	/**
	 * Initiates a managed OAuth connection request and returns the hosted redirect URL
	 */
	async getOAuthLink(personaId: string, platform: string, callbackUrl: string): Promise<string> {
		if (!this.apiKey) {
			throw new Error('COMPOSIO_API_KEY is not configured in environment variables.');
		}

		const platKey = platform.toLowerCase();
		if (!SUPPORTED_SOCIAL_PLATFORMS.includes(platKey as SocialPlatform)) {
			throw new Error(`Platform ${platform} is not supported under the connection profile.`);
		}

		const authConfigId = getComposioAuthConfigId(platKey);
		if (!authConfigId) {
			throw new Error(
				`Platform ${platform} is not configured. Set COMPOSIO_AUTH_CONFIG_${platKey.toUpperCase()} to enable it.`
			);
		}

		console.log(
			`[Composio Client] Generating link for agent=${personaId}, authConfigId=${authConfigId}`
		);

		const response = await fetch(`${this.baseUrl}/connected_accounts/link`, {
			method: 'POST',
			headers: this.getHeaders(),
			body: JSON.stringify({
				user_id: personaId,
				auth_config_id: authConfigId,
				callback_url: callbackUrl
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Composio Link API returned status ${response.status}: ${errorText}`);
		}

		const data = (await response.json()) as any;
		const redirectUrl = data.redirect_url || data.redirectUrl;
		if (!redirectUrl) {
			throw new Error(
				`Composio Link API did not return redirect_url in response: ${JSON.stringify(data)}`
			);
		}

		return redirectUrl;
	}

	/**
	 * Lists all connected accounts for an agent (personaId) from Composio
	 */
	async listConnections(personaId: string): Promise<any[]> {
		if (!this.apiKey) {
			throw new Error('COMPOSIO_API_KEY is not configured.');
		}

		try {
			const response = await fetch(`${this.baseUrl}/connected_accounts?user_id=${personaId}`, {
				method: 'GET',
				headers: this.getHeaders()
			});

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(
					`Composio connected accounts returned status ${response.status}: ${errorText}`
				);
			}

			const data = (await response.json()) as any;
			return data.items || [];
		} catch (err) {
			throw new Error(
				`Failed to list Composio connections for agent ${personaId}: ${(err as Error).message}`
			);
		}
	}

	/**
	 * Executes a posting action on behalf of an agent (personaId) for the given platform
	 */
	async executePost(
		personaId: string,
		platform: string,
		content: string,
		mediaUrl?: string
	): Promise<{ success: boolean; externalId?: string; data?: any; error?: string }> {
		if (!this.apiKey) {
			return { success: false, error: 'COMPOSIO_API_KEY is not configured.' };
		}

		const platKey = platform.toLowerCase();
		if (!isPlatformConfigured(platKey)) {
			return { success: false, error: `Platform "${platform}" is not configured.` };
		}

		const actionSlug = COMPOSIO_ACTION_MAPPING[platKey];
		if (!actionSlug) {
			return {
				success: false,
				error: `Posting action for platform "${platform}" is not supported.`
			};
		}

		// Build arguments based on the platform's API requirements
		let args: Record<string, any> = {};
		if (platKey === 'facebook') {
			args = { message: content };
		} else if (platKey === 'instagram') {
			args = {
				caption: content,
				image_url: mediaUrl || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800'
			};
		} else if (platKey === 'youtube') {
			args = {
				title: content.substring(0, 100),
				description: content,
				video_file:
					mediaUrl ||
					'https://assets.mixkit.co/videos/preview/mixkit-stars-in-space-1611-large.mp4',
				privacyStatus: 'public'
			};
		} else if (platKey === 'tiktok') {
			args = {
				title: content.substring(0, 150),
				video_url:
					mediaUrl || 'https://assets.mixkit.co/videos/preview/mixkit-stars-in-space-1611-large.mp4'
			};
		}

		console.log(`[Composio Client] Executing action ${actionSlug} for agent ${personaId}`);

		try {
			const response = await fetch(`${this.baseUrlV3_1}/tools/execute/${actionSlug}`, {
				method: 'POST',
				headers: this.getHeaders(),
				body: JSON.stringify({
					user_id: personaId,
					arguments: args
				})
			});

			if (!response.ok) {
				const errorText = await response.text();
				return {
					success: false,
					error: `Composio action returned status ${response.status}: ${errorText}`
				};
			}

			const result = (await response.json()) as any;

			let externalId: string | undefined;
			if (result && typeof result === 'object') {
				const resObj = result.result || result.data || result;
				if (resObj && typeof resObj === 'object') {
					const extracted =
						resObj.id || resObj.post_id || resObj.message_id || resObj.item_id || resObj.id_str;
					if (extracted) {
						externalId = String(extracted);
					}
				}
			}

			return { success: true, externalId, data: result };
		} catch (err) {
			console.error(`[Composio Client] Error executing post to ${platform}:`, err);
			return { success: false, error: (err as Error).message };
		}
	}

	/**
	 * Fetches live post performance metrics from Composio or fallback simulated metrics that grow organically
	 */
	async fetchPostMetrics(
		personaId: string,
		platform: string,
		externalId: string,
		publishedAt?: string | Date
	): Promise<{
		views: number;
		likes: number;
		comments: number;
		shares: number;
		estimated: boolean;
	}> {
		const metrics = { views: 0, likes: 0, comments: 0, shares: 0, estimated: true };

		// Fallback organic growth curve logic based on time elapsed
		const pubDate = publishedAt ? new Date(publishedAt) : new Date(Date.now() - 3600000 * 4); // default 4 hrs ago
		const elapsedHours = Math.max(0.1, (Date.now() - pubDate.getTime()) / (1000 * 60 * 60));

		// Generate stable seed based on externalId
		let seed = 0;
		if (externalId) {
			for (let i = 0; i < externalId.length; i++) {
				seed += externalId.charCodeAt(i);
			}
		} else {
			seed = Math.floor(Math.random() * 100);
		}

		// Calculate organic scaling metrics (logarithmic or logistic growth)
		// More time = more views, plateauing after 72 hours
		const baseViews = 500 + (seed % 9500); // 500 to 10000 views baseline
		const growthFactor = 1 - Math.exp(-elapsedHours / 24); // logistic-like curve
		metrics.views = Math.max(10, Math.floor(baseViews * growthFactor * (1 + 0.1 * (seed % 10))));

		// Engagement rates
		const likeRate = 0.05 + 0.005 * (seed % 15); // 5% to 12.5% of views
		const commentRate = 0.005 + 0.001 * (seed % 5); // 0.5% to 1% of views
		const shareRate = 0.002 + 0.0005 * (seed % 8); // 0.2% to 0.6% of views

		metrics.likes = Math.floor(metrics.views * likeRate);
		metrics.comments = Math.floor(metrics.views * commentRate);
		metrics.shares = Math.floor(metrics.views * shareRate);

		// If COMPOSIO_API_KEY is configured, try querying the live integration
		if (this.apiKey && externalId && !externalId.startsWith('ext_')) {
			try {
				const response = await fetch(
					`${this.baseUrlV3_1}/tools/execute/${platform.toUpperCase()}_GET_POST_METRICS`,
					{
						method: 'POST',
						headers: this.getHeaders(),
						body: JSON.stringify({
							user_id: personaId,
							arguments: { post_id: externalId }
						})
					}
				);
				if (response.ok) {
					const data = (await response.json()) as any;
					if (data && typeof data === 'object') {
						metrics.estimated = false;
						const resObj = data.result || data.data || data;
						if (resObj && typeof resObj === 'object') {
							metrics.views = Number(resObj.views || resObj.view_count || metrics.views);
							metrics.likes = Number(
								resObj.likes || resObj.like_count || resObj.favorite_count || metrics.likes
							);
							metrics.comments = Number(
								resObj.comments || resObj.comment_count || metrics.comments
							);
							metrics.shares = Number(
								resObj.shares || resObj.share_count || resObj.retweet_count || metrics.shares
							);
						}
					}
				}
			} catch (err) {
				console.warn(
					'[Composio Client] Failed to fetch live metrics, falling back to simulated data:',
					err
				);
			}
		}

		return metrics;
	}

	/**
	 * Executes an arbitrary tool/action on Composio
	 */
	async executeAction(
		personaId: string,
		actionSlug: string,
		args: Record<string, any> = {}
	): Promise<any> {
		if (!this.apiKey) {
			throw new Error('COMPOSIO_API_KEY is not configured.');
		}

		const response = await fetch(`${this.baseUrlV3_1}/tools/execute/${actionSlug}`, {
			method: 'POST',
			headers: this.getHeaders(),
			body: JSON.stringify({
				user_id: personaId,
				arguments: args
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Composio Action ${actionSlug} returned status ${response.status}: ${errorText}`
			);
		}

		return await response.json();
	}
}
