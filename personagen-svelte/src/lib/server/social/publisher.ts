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
	provider: 'zernio';
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

function getStoredZernioAccountId(connection: any): string | null {
	const id =
		connection?.provider_account_id ||
		connection?.zernio_account_id ||
		connection?.external_account_id ||
		connection?.metadata?.zernioAccountId;
	return id ? String(id) : null;
}

// Short-lived cache of Zernio account lookups, keyed by `${apiKey}::${profileId}`.
// Stops us calling /accounts once per platform when publishing a multi-platform post.
const zernioAccountsCache = new Map<string, { at: number; accounts: ZernioAccount[] }>();
const ZERNIO_ACCOUNTS_TTL_MS = 60_000;

async function getZernioAccounts(client: ZernioClient, cacheKey: string, profileId?: string) {
	const cached = zernioAccountsCache.get(cacheKey);
	if (cached && Date.now() - cached.at < ZERNIO_ACCOUNTS_TTL_MS) return cached.accounts;
	const accounts = await client.listAccounts(profileId ? { profileId } : undefined);
	zernioAccountsCache.set(cacheKey, { at: Date.now(), accounts });
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
 * on the connection row (set at sync time), otherwise matched live from the
 * persona's profile-scoped /accounts list (by platform, preferring a handle
 * match). Scoping to the persona's profileId keeps multi-persona routing correct.
 */
async function resolveZernioAccountId(
	client: ZernioClient,
	cacheKey: string,
	platform: string,
	connection: any,
	profileId?: string
): Promise<string | null> {
	const stored = getStoredZernioAccountId(connection);
	if (stored) return stored;

	const accounts = await getZernioAccounts(client, cacheKey, profileId).catch(() => []);
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

/** Looks up the persona's Zernio profile id for profile-scoped account resolution. */
async function getAgentProfileId(supabase: any, agentId?: string): Promise<string | undefined> {
	if (!agentId) return undefined;
	try {
		const { data } = await supabase
			.from('agents')
			.select('zernio_profile_id')
			.eq('id', agentId)
			.maybeSingle();
		return data?.zernio_profile_id || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Publishes a post to a single platform via Zernio — the single consolidated
 * provider. Requires a Zernio API key and a connected account for the platform;
 * fails loudly (not silently) when either is missing so the scheduler can surface
 * a real reason rather than dropping the post.
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
	if (!apiKey) {
		return {
			success: false,
			provider: 'zernio',
			error: 'No Zernio API key configured. Add one in Settings → API Keys to publish.'
		};
	}

	if (!(ZERNIO_PUBLISH_SUPPORTED as readonly string[]).includes(normalizedPlat)) {
		return {
			success: false,
			provider: 'zernio',
			error: `Zernio does not support publishing to ${normalizedPlat}.`
		};
	}

	// Image posts to video-only platforms can't succeed — say so instead of shipping
	// a doomed upload the platform API rejects with a cryptic error.
	if (!isVideo && (VIDEO_ONLY_PLATFORMS as readonly string[]).includes(normalizedPlat)) {
		return {
			success: false,
			provider: 'zernio',
			error: `${normalizedPlat} requires video content, but this post's media is an image.`
		};
	}

	const client = new ZernioClient(apiKey);
	const profileId = await getAgentProfileId(supabase, post.agent_id);
	const cacheKey = `${apiKey}::${profileId || 'all'}`;
	const accountId = await resolveZernioAccountId(
		client,
		cacheKey,
		normalizedPlat,
		connection,
		profileId
	).catch(() => null);

	if (!accountId) {
		return {
			success: false,
			provider: 'zernio',
			error: `No connected ${normalizedPlat} account for this persona in Zernio. Connect it on the Connections tab, then retry.`
		};
	}

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
 * Zernio's unpublish endpoint handles supported platforms; Instagram, TikTok, and
 * Snapchat have no API deletion path and are reported for manual deletion.
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
		const externalId = info.external_id || null;
		const permalink = info.permalink || null;

		const zernioCanUnpublish =
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

		// Instagram/TikTok/Snapchat (no API deletion) or missing id → manual deletion.
		result.manualDeletion.push({ platform: plat, permalink });
	}

	return result;
}
