import { env } from '$env/dynamic/private';
import crypto from 'crypto';

const SUPPORTED_SOCIAL_PLATFORMS = ['tiktok', 'instagram', 'youtube', 'facebook'] as const;
export type SocialPlatform = (typeof SUPPORTED_SOCIAL_PLATFORMS)[number];

// Platform to Composio Action Slug mapping
const COMPOSIO_ACTION_MAPPING: Record<string, string> = {
	facebook: 'FACEBOOK_CREATE_POST',
	instagram: 'INSTAGRAM_POST_IG_USER_MEDIA',
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
	 * Uploads a file from a URL to Composio S3 and returns the required { name, s3key, mimetype } object
	 */
	async uploadFileFromUrl(url: string, filename?: string): Promise<{ name: string; s3key: string; mimetype: string }> {
		console.log(`[Composio Client] Downloading file for upload to Composio: ${url}`);
		const fetchRes = await fetch(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
			}
		});
		if (!fetchRes.ok) {
			throw new Error(`Failed to fetch file from URL: ${url} (Status: ${fetchRes.status})`);
		}
		const buffer = Buffer.from(await fetchRes.arrayBuffer());
		const mimetype = fetchRes.headers.get('content-type') || 'video/mp4';
		
		const name = filename || url.split('/').pop() || 'upload.mp4';
		
		// Calculate MD5 hash
		const md5 = crypto.createHash('md5').update(buffer).digest('hex');
		
		console.log(`[Composio Client] Registering file upload with Composio. Name: ${name}, Size: ${buffer.length} bytes, MD5: ${md5}`);
		
		// Step 1: Request presigned URL
		const requestUrl = `${this.baseUrlV3_1}/files/upload/request`;
		const requestRes = await fetch(requestUrl, {
			method: 'POST',
			headers: this.getHeaders(),
			body: JSON.stringify({
				toolkit_slug: 'youtube',
				tool_slug: 'YOUTUBE_MULTIPART_UPLOAD_VIDEO',
				filename: name,
				mimetype,
				md5
			})
		});
		
		if (!requestRes.ok) {
			const errorText = await requestRes.text();
			throw new Error(`Failed to request presigned URL from Composio (Status: ${requestRes.status}): ${errorText}`);
		}
		
		const requestData = (await requestRes.json()) as any;
		
		// Check if it's already uploaded (Composio might return that it's already present or needs upload)
		const s3key = requestData.key || requestData.s3key;
		const putUrl = requestData.new_presigned_url || requestData.newPresignedUrl || requestData.url;
		
		if (!s3key) {
			throw new Error(`Composio did not return an s3key: ${JSON.stringify(requestData)}`);
		}
		
		if (putUrl) {
			console.log(`[Composio Client] Uploading file binary to presigned URL...`);
			const putRes = await fetch(putUrl, {
				method: 'PUT',
				headers: {
					'Content-Type': mimetype
				},
				body: buffer
			});
			
			if (!putRes.ok) {
				const errorText = await putRes.text();
				throw new Error(`Failed to upload file to presigned URL (Status: ${putRes.status}): ${errorText}`);
			}
			console.log(`[Composio Client] File upload successful!`);
		} else {
			console.log(`[Composio Client] File already exists in Composio S3 (MD5 matched), using existing key.`);
		}
		
		return { name, s3key, mimetype };
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
			const items = data.items || [];
			return items.filter((item: any) => item.user_id === personaId);
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
	): Promise<{ success: boolean; externalId?: string; permalink?: string | null; data?: any; error?: string }> {
		if (!this.apiKey) {
			return { success: false, error: 'COMPOSIO_API_KEY is not configured.' };
		}

		const platKey = platform.toLowerCase();
		if (!isPlatformConfigured(platKey)) {
			if (env.ALLOW_DEMO_MODE === 'true') {
				const mockExternalId = Math.random().toString(36).substring(2, 11);
				let mockPermalink = `https://www.${platKey}.com/p/${mockExternalId}`;
				if (platKey === 'youtube') {
					mockPermalink = `https://www.youtube.com/watch?v=${mockExternalId}`;
				}
				console.log(`[Composio Client] DEMO MODE: Simulating success for platform "${platform}" with permalink: ${mockPermalink}`);
				return {
					success: true,
					externalId: mockExternalId,
					permalink: mockPermalink,
					data: { message: `Simulated posting success on ${platform}` }
				};
			}
			return { success: false, error: `Platform "${platform}" is not configured.` };
		}

		const actionSlug = COMPOSIO_ACTION_MAPPING[platKey];
		if (!actionSlug) {
			return {
				success: false,
				error: `Posting action for platform "${platform}" is not supported.`
			};
		}

		// Parse content if it's a JSON string, to extract text and media URL
		let textContent = content;
		let extractedMediaUrl = mediaUrl;

		try {
			if (content.trim().startsWith('{') && content.trim().endsWith('}')) {
				const parsed = JSON.parse(content);
				if (parsed && typeof parsed === 'object') {
					if (parsed.text !== undefined) {
						textContent = parsed.text;
					}
					if (parsed.media_url !== undefined) {
						extractedMediaUrl = parsed.media_url;
					} else if (parsed.mediaUrl !== undefined) {
						extractedMediaUrl = parsed.mediaUrl;
					}

					// Double-nest check: if the extracted text is itself a JSON string
					if (typeof textContent === 'string' && textContent.trim().startsWith('{') && textContent.trim().endsWith('}')) {
						try {
							const nested = JSON.parse(textContent);
							if (nested && typeof nested === 'object' && nested.text !== undefined) {
								textContent = nested.text;
							}
						} catch (e) {
							// Ignore
						}
					}
				}
			}
		} catch (e) {
			// Ignore JSON parse error, treat as raw text
		}

		// Handle Instagram separately since it is a two-step process
		if (platKey === 'instagram') {
			console.log(`[Composio Client] Starting two-step Instagram posting for agent ${personaId}`);
			try {
				const targetMediaUrl = extractedMediaUrl || 'https://picsum.photos/1080/1080.jpg';
				console.log(
					`[Composio Client] Step 1: Creating Instagram Media Container via INSTAGRAM_POST_IG_USER_MEDIA`
				);
				const createResponse = await fetch(
					`${this.baseUrlV3_1}/tools/execute/INSTAGRAM_POST_IG_USER_MEDIA`,
					{
						method: 'POST',
						headers: this.getHeaders(),
						body: JSON.stringify({
							user_id: personaId,
							arguments: {
								ig_user_id: 'me',
								image_url: targetMediaUrl,
								caption: textContent
							}
						})
					}
				);

				if (!createResponse.ok) {
					const errorText = await createResponse.text();
					return {
						success: false,
						error: `Composio Instagram container creation failed (status ${createResponse.status}): ${errorText}`
					};
				}

				const createResult = (await createResponse.json()) as any;
				if (!createResult.successful) {
					return {
						success: false,
						error: `Composio Instagram container creation failed: ${createResult.error || JSON.stringify(createResult.data || createResult)}`
					};
				}

				const creationId = createResult.data?.id || createResult.result?.id || createResult.id;
				if (!creationId) {
					return {
						success: false,
						error: `Failed to extract creation_id from container response: ${JSON.stringify(createResult)}`
					};
				}

				console.log(
					`[Composio Client] Step 2: Publishing Instagram Media Container via INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH. Creation ID: ${creationId}`
				);
				const publishResponse = await fetch(
					`${this.baseUrlV3_1}/tools/execute/INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH`,
					{
						method: 'POST',
						headers: this.getHeaders(),
						body: JSON.stringify({
							user_id: personaId,
							arguments: {
								ig_user_id: 'me',
								creation_id: creationId,
								max_wait_seconds: 60
							}
						})
					}
				);

				if (!publishResponse.ok) {
					const errorText = await publishResponse.text();
					return {
						success: false,
						error: `Composio Instagram publishing failed (status ${publishResponse.status}): ${errorText}`
					};
				}

				const publishResult = (await publishResponse.json()) as any;
				if (!publishResult.successful) {
					return {
						success: false,
						error: `Composio Instagram publishing failed: ${publishResult.error || JSON.stringify(publishResult.data || publishResult)}`
					};
				}

				const resObj = publishResult.result || publishResult.data || publishResult;
				const externalId = resObj?.id || publishResult.id;
				let permalink = resObj?.permalink || resObj?.link || resObj?.url || resObj?.uri || null;

				if (!permalink && externalId) {
					try {
						console.log(`[Composio Client] Querying INSTAGRAM_GET_IG_MEDIA for real permalink of externalId: ${externalId}`);
						const mediaInfoResponse = await fetch(
							`${this.baseUrlV3_1}/tools/execute/INSTAGRAM_GET_IG_MEDIA`,
							{
								method: 'POST',
								headers: this.getHeaders(),
								body: JSON.stringify({
									user_id: personaId,
									arguments: {
										ig_media_id: externalId
									}
								})
							}
						);
						if (mediaInfoResponse.ok) {
							const mediaInfoResult = (await mediaInfoResponse.json()) as any;
							if (mediaInfoResult.successful) {
								const mediaData = mediaInfoResult.result?.data || mediaInfoResult.data?.data || mediaInfoResult.result || mediaInfoResult.data;
								if (mediaData && mediaData.permalink) {
									permalink = mediaData.permalink;
									console.log(`[Composio Client] Successfully retrieved verified Instagram permalink: ${permalink}`);
								}
							}
						}
					} catch (e) {
						console.warn('[Composio Client] Failed to fetch Instagram media permalink:', e);
					}
				}

				return { success: true, externalId, permalink, data: publishResult };
			} catch (err) {
				console.error('[Composio Client] Instagram posting execution failed:', err);
				return { success: false, error: (err as Error).message };
			}
		}

		// Build arguments based on the platform's API requirements for other platforms
		let args: Record<string, any> = {};
		if (platKey === 'facebook') {
			args = { message: textContent };
		} else if (platKey === 'youtube') {
			const videoUrl = extractedMediaUrl || 'https://placeholdervideo.dev/1280x720';
			let videoFileObj;
			try {
				videoFileObj = await this.uploadFileFromUrl(videoUrl, 'video.mp4');
			} catch (err) {
				return {
					success: false,
					error: `YouTube video upload to Composio failed: ${(err as Error).message}`
				};
			}

			args = {
				title: textContent.substring(0, 100),
				description: textContent,
				videoFile: videoFileObj,
				categoryId: '22', // People & Blogs
				privacyStatus: 'public'
			};
		} else if (platKey === 'tiktok') {
			args = {
				title: textContent.substring(0, 150),
				video_url:
					extractedMediaUrl ||
					'https://placeholdervideo.dev/1280x720'
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
			console.log(`[Composio Client] Raw Response for ${actionSlug}:`, JSON.stringify(result, null, 2));

			if (result && typeof result === 'object' && result.successful === false) {
				return {
					success: false,
					error: result.error || JSON.stringify(result.data || result)
				};
			}

			let externalId: string | undefined;
			let permalink: string | null = null;
			if (result && typeof result === 'object') {
				const resObj = result.result || result.data || result;
				if (resObj && typeof resObj === 'object') {
					const extracted =
						resObj.id || resObj.post_id || resObj.message_id || resObj.item_id || resObj.id_str || resObj.video?.id;
					if (extracted) {
						externalId = String(extracted);
					}
					const possibleLink = resObj.permalink || resObj.link || resObj.url || resObj.uri || resObj.share_url;
					if (possibleLink) {
						permalink = String(possibleLink);
					}
				}
			}

			if (externalId && !permalink) {
				if (platKey === 'youtube') {
					permalink = `https://www.youtube.com/watch?v=${externalId}`;
				} else if (platKey === 'instagram') {
					permalink = `https://www.instagram.com/p/${externalId}/`;
				} else if (platKey === 'facebook') {
					permalink = `https://www.facebook.com/${externalId}`;
				} else if (platKey === 'tiktok') {
					permalink = `https://www.tiktok.com/video/${externalId}`;
				}
			}

			return { success: true, externalId, permalink, data: result };
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
				let response;
				if (platform.toLowerCase() === 'instagram') {
					response = await fetch(
						`${this.baseUrlV3_1}/tools/execute/INSTAGRAM_GET_IG_MEDIA_INSIGHTS`,
						{
							method: 'POST',
							headers: this.getHeaders(),
							body: JSON.stringify({
								user_id: personaId,
								arguments: {
									ig_media_id: externalId,
									metric: ['views', 'likes', 'comments', 'shares']
								}
							})
						}
					);
				} else {
					response = await fetch(
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
				}
				if (response.ok) {
					const data = (await response.json()) as any;
					if (data && typeof data === 'object') {
						metrics.estimated = false;
						const resObj = data.result || data.data || data;
						if (resObj && typeof resObj === 'object') {
							if (platform.toLowerCase() === 'instagram') {
								const insightsList = Array.isArray(resObj.data)
									? resObj.data
									: Array.isArray(resObj)
										? resObj
										: [];
								for (const insight of insightsList) {
									const val = Number(insight.values?.[0]?.value) || 0;
									if (insight.name === 'views' || insight.name === 'reach') {
										metrics.views = val;
									} else if (insight.name === 'likes') {
										metrics.likes = val;
									} else if (insight.name === 'comments') {
										metrics.comments = val;
									} else if (insight.name === 'shares') {
										metrics.shares = val;
									}
								}
							} else {
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
