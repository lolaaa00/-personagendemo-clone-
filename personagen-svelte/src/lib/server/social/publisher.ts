import { ComposioClient } from './composio';
import {
	getZernioApiKey,
	ZernioClient,
	ZERNIO_PUBLISH_SUPPORTED,
	ZERNIO_UNPUBLISH_SUPPORTED,
	type ZernioAccount
} from './zernio';
import { VIDEO_ONLY_PLATFORMS } from './platforms';

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
		// Trust the generator's explicit media_type; fall back to the URL extension.
		const isVideo =
			parsed?.media_type === 'video' || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(mediaUrl);
		return [{ type: isVideo ? 'video' : 'image', url: mediaUrl }];
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

// Short-lived cache of Zernio account lookups, keyed by API key. Stops us calling
// /accounts once per platform per post when publishing a multi-platform post.
const zernioAccountsCache = new Map<string, { at: number; accounts: ZernioAccount[] }>();
const ZERNIO_ACCOUNTS_TTL_MS = 60_000;

async function getZernioAccounts(client: ZernioClient, apiKey: string) {
	const cached = zernioAccountsCache.get(apiKey);
	if (cached && Date.now() - cached.at < ZERNIO_ACCOUNTS_TTL_MS) return cached.accounts;
	const accounts = await client.listAccounts();
	zernioAccountsCache.set(apiKey, { at: Date.now(), accounts });
	return accounts;
}

/** Platform name(s) Zernio may report for a given connection platform. */
function platformAliases(platform: string): string[] {
	const p = platform.toLowerCase();
	if (p === 'x' || p === 'twitter') return ['x', 'twitter'];
	return [p];
}

/**
 * Resolves the Zernio accountId to publish to for a platform: first the id stored
 * on the connection row, otherwise matched live from the account's /accounts list
 * (by platform, preferring a handle match). Returns null when no account is linked.
 */
async function resolveZernioAccountId(
	client: ZernioClient,
	apiKey: string,
	platform: string,
	connection: any
): Promise<string | null> {
	const stored = getZernioAccountId(connection);
	if (stored) return stored;

	const accounts = await getZernioAccounts(client, apiKey).catch(() => []);
	if (!accounts.length) return null;

	const aliases = platformAliases(platform);
	const matches = accounts.filter((a) => aliases.includes(a.platform) && a.isActive !== false);
	if (matches.length === 0) return null;

	const handle = String(connection?.handle || '')
		.toLowerCase()
		.replace(/^@/, '')
		.split('.')[0];
	if (handle) {
		const byHandle = matches.find(
			(a) => String(a.handle || '').toLowerCase().replace(/^@/, '') === handle
		);
		if (byHandle) return byHandle.id;
	}
	return matches[0].id;
}

/**
 * Publishes a post to a single platform.
 *
 * Zernio-first: whenever a Zernio key is configured and the platform is
 * Zernio-supported, we publish through Zernio — it's the only path that can post
 * VIDEO to Instagram/TikTok (Composio's IG path is image-only and TikTok isn't on
 * Composio). Composio remains an image-only fallback for platforms with no linked
 * Zernio account. Video with no Zernio path fails loudly rather than posting wrong.
 */
export async function publishToPlatform({
	supabase,
	post,
	connection,
	platform
}: PublishPlatformInput): Promise<PublishPlatformResult> {
	const normalizedPlat = String(platform || '').toLowerCase();
	const mediaItems = extractMediaItems(post.content);
	const isVideo = !!mediaItems?.some((m) => m.type === 'video');

	const apiKey = await getZernioApiKey(supabase, post.user_id).catch(() => null);
	const zernioSupportsPlatform = (ZERNIO_PUBLISH_SUPPORTED as readonly string[]).includes(
		normalizedPlat
	);

	if (apiKey && zernioSupportsPlatform) {
		const client = new ZernioClient(apiKey);
		const accountId = await resolveZernioAccountId(
			client,
			apiKey,
			normalizedPlat,
			connection
		).catch(() => null);

		if (accountId) {
			try {
				const result = await client.publishNow({
					content: getTextContent(post.content),
					platform: normalizedPlat,
					accountId,
					mediaItems
				});
				return { ...result, provider: 'zernio' };
			} catch (err) {
				return { success: false, provider: 'zernio', error: (err as Error).message };
			}
		}

		if (isVideo) {
			return {
				success: false,
				provider: 'zernio',
				error: `No Zernio account linked for ${normalizedPlat}. Video can only be published through Zernio (Composio can't post video to Instagram, and TikTok isn't on Composio). Connect ${normalizedPlat} in Zernio, then retry.`
			};
		}
		// Image with no matching Zernio account → fall through to Composio below.
	}

	// Video with no Zernio path at all → fail loudly; Composio cannot publish it.
	if (isVideo) {
		return {
			success: false,
			provider: 'zernio',
			error: `Video publishing to ${normalizedPlat} requires Zernio. Add your Zernio API key in Settings and connect ${normalizedPlat}.`
		};
	}

	// Composio's only YouTube/TikTok action requires video — an image would be
	// silently mis-uploaded and rejected by the platform API with a cryptic error.
	// Fail clearly here instead of attempting a doomed upload.
	if (!isVideo && (VIDEO_ONLY_PLATFORMS as readonly string[]).includes(normalizedPlat)) {
		return {
			success: false,
			provider: 'composio',
			error: `${normalizedPlat} requires video content (Composio has no image-upload path for this platform). This post's media is an image, so it can't be published here.`
		};
	}

	const composio = new ComposioClient();
	const result = await composio.executePost(post.agent_id, normalizedPlat, post.content);
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
