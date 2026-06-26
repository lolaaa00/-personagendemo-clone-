import { ComposioClient } from './composio';
import { getZernioApiKey, ZernioClient } from './zernio';

export interface PublishPlatformInput {
	supabase: any;
	post: any;
	connection: any;
	platform: string;
}

export interface PublishPlatformResult {
	success: boolean;
	externalId?: string;
	permalink?: string | null;
	data?: unknown;
	error?: string;
	provider: 'composio' | 'zernio';
}

function extractMediaItems(content: string): Array<{ type: 'image' | 'video'; url: string }> | undefined {
	try {
		const parsed = JSON.parse(content);
		const mediaUrl = parsed?.media_url || parsed?.mediaUrl;
		if (!mediaUrl || typeof mediaUrl !== 'string') return undefined;
		const type = /\.(mp4|mov|webm|m4v)(\?|$)/i.test(mediaUrl) ? 'video' : 'image';
		return [{ type, url: mediaUrl }];
	} catch {
		return undefined;
	}
}

function getTextContent(content: string): string {
	try {
		const parsed = JSON.parse(content);
		if (parsed?.text && typeof parsed.text === 'string') return parsed.text;
	} catch {
		// Raw text content is already publishable.
	}
	return content;
}

function getZernioAccountId(connection: any): string | null {
	const id =
		connection?.provider_account_id ||
		connection?.zernio_account_id ||
		connection?.external_account_id ||
		connection?.metadata?.zernioAccountId;
	return id ? String(id) : null;
}

export async function publishToPlatform({
	supabase,
	post,
	connection,
	platform
}: PublishPlatformInput): Promise<PublishPlatformResult> {
	const provider = String(connection?.provider || '').toLowerCase();
	const zernioAccountId = getZernioAccountId(connection);

	if (provider === 'zernio' && zernioAccountId) {
		try {
			const apiKey = await getZernioApiKey(supabase, post.user_id);
			if (!apiKey) {
				return { success: false, provider: 'zernio', error: 'Zernio API key is not configured.' };
			}

			const client = new ZernioClient(apiKey);
			const result = await client.publishNow({
				content: getTextContent(post.content),
				platform,
				accountId: zernioAccountId,
				mediaItems: extractMediaItems(post.content)
			});

			return { ...result, provider: 'zernio' };
		} catch (err) {
			return { success: false, provider: 'zernio', error: (err as Error).message };
		}
	}

	const composio = new ComposioClient();
	const result = await composio.executePost(post.agent_id, platform, post.content);
	return { ...result, provider: 'composio' };
}
