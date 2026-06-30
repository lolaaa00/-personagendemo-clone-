import { ComposioClient } from './composio';
import {
	getZernioApiKey,
	ZernioClient,
	ZERNIO_UNPUBLISH_SUPPORTED
} from './zernio';

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
		if (parsed?.text && typeof parsed.text === 'string') {
			let text = parsed.text;
			if (Array.isArray(parsed.hashtags) && parsed.hashtags.length > 0) {
				const tags = parsed.hashtags.map((h: string) => h.startsWith('#') ? h : `#${h}`).join(' ');
				text += '\n\n' + tags;
			}
			return text;
		}
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

export interface TeardownResult {
	/** Platforms whose live post was removed via API (Zernio unpublish). */
	unpublished: string[];
	/** Platforms with no API deletion path — the user must remove these by hand. */
	manualDeletion: Array<{ platform: string; permalink: string | null }>;
	/** Non-fatal errors encountered while attempting API teardown. */
	errors: string[];
}

/**
 * Attempts to remove a post from each platform it was published to.
 * Zernio's unpublish endpoint handles supported platforms; everything else
 * (Instagram always, Composio-published posts, etc.) is reported for manual deletion.
 * Never throws — teardown is best-effort and must not block the DB delete.
 */
export async function teardownPost(supabase: any, post: any): Promise<TeardownResult> {
	const result: TeardownResult = { unpublished: [], manualDeletion: [], errors: [] };
	const pubResults = (post?.publication_results || {}) as Record<string, any>;

	const publishedEntries = Object.entries(pubResults).filter(
		([, v]) => v && typeof v === 'object' && v.status === 'published'
	) as Array<[string, any]>;

	if (publishedEntries.length === 0) return result;

	let zernio: ZernioClient | null = null;
	const apiKey = await getZernioApiKey(supabase, post.user_id).catch(() => null);
	if (apiKey) zernio = new ZernioClient(apiKey);

	for (const [platform, info] of publishedEntries) {
		const plat = platform.toLowerCase();
		const provider = String(info.provider || '').toLowerCase();
		const externalId = info.external_id || null;
		const permalink = info.permalink || null;

		const zernioCanUnpublish =
			provider === 'zernio' &&
			!!zernio &&
			!!externalId &&
			(ZERNIO_UNPUBLISH_SUPPORTED as readonly string[]).includes(plat);

		if (zernioCanUnpublish) {
			const res = await zernio!.unpublish(externalId, plat);
			if (res.success) {
				result.unpublished.push(plat);
			} else {
				result.errors.push(`${plat}: ${res.error}`);
				result.manualDeletion.push({ platform: plat, permalink });
			}
			continue;
		}

		// Instagram (always), Composio-published, or missing id → manual deletion
		result.manualDeletion.push({ platform: plat, permalink });
	}

	return result;
}
