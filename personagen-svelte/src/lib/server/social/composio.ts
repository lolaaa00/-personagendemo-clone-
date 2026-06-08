import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

// Platform to Composio App ID mapping
const COMPOSIO_APP_MAPPING: Record<string, string> = {
	instagram: 'instagram',
	facebook: 'facebook',
	youtube: 'youtube',
	tiktok: 'tiktok'
};

// Platform to Composio Action Slug mapping
const COMPOSIO_ACTION_MAPPING: Record<string, string> = {
	facebook: 'FACEBOOK_CREATE_POST',
	instagram: 'INSTAGRAM_PUBLISH_PHOTO',
	youtube: 'YOUTUBE_MULTIPART_UPLOAD_VIDEO',
	tiktok: 'TIKTOK_PUBLISH_VIDEO'
};

export class ComposioClient {
	private apiKey: string;
	private baseUrl = 'https://backend.composio.dev/api/v3';
	private baseUrlV3_1 = 'https://backend.composio.dev/api/v3.1';

	constructor() {
		// Use GEMINI_API_KEY as fallback if COMPOSIO_API_KEY is not defined,
		// or check private environment variables
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

		const appId = COMPOSIO_APP_MAPPING[platform.toLowerCase()];
		if (!appId) {
			throw new Error(`Platform ${platform} is not supported under the Managed Connection profile.`);
		}

		console.log(`[Composio Client] Generating link for agent=${personaId}, app=${appId}`);

		const response = await fetch(`${this.baseUrl}/connected_accounts/link`, {
			method: 'POST',
			headers: this.getHeaders(),
			body: JSON.stringify({
				user_id: personaId,
				app_id: appId,
				callback_url: callbackUrl
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Composio Link API returned status ${response.status}: ${errorText}`);
		}

		const data = (await response.json()) as any;
		if (!data.redirectUrl) {
			throw new Error('Composio Link API did not return a redirectUrl in the response.');
		}

		return data.redirectUrl;
	}

	/**
	 * Executes a posting action on behalf of an agent (personaId) for the given platform
	 */
	async executePost(
		personaId: string,
		platform: string,
		content: string,
		mediaUrl?: string
	): Promise<{ success: boolean; data?: any; error?: string }> {
		if (!this.apiKey) {
			return { success: false, error: 'COMPOSIO_API_KEY is not configured.' };
		}

		const platKey = platform.toLowerCase();
		const actionSlug = COMPOSIO_ACTION_MAPPING[platKey];
		if (!actionSlug) {
			return { success: false, error: `Posting action for platform "${platform}" is not supported.` };
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
				video_file: mediaUrl || 'https://assets.mixkit.co/videos/preview/mixkit-stars-in-space-1611-large.mp4',
				privacyStatus: 'public'
			};
		} else if (platKey === 'tiktok') {
			args = {
				title: content.substring(0, 150),
				video_url: mediaUrl || 'https://assets.mixkit.co/videos/preview/mixkit-stars-in-space-1611-large.mp4'
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

			const result = await response.json();
			return { success: true, data: result };
		} catch (err) {
			console.error(`[Composio Client] Error executing post to ${platform}:`, err);
			return { success: false, error: (err as Error).message };
		}
	}
}
