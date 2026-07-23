import {
	ZernioClient,
	ZERNIO_PUBLISH_SUPPORTED,
	ZERNIO_UNPUBLISH_SUPPORTED,
	type ZernioAccount
} from './zernio';
import { getAgentZernioRouting } from '$lib/server/zernio-keys';
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
	/**
	 * Which Zernio key created this resource ('default' | zernio_keys id).
	 * Persisted with the submission so verification/analytics/unpublish read it
	 * back with the SAME account — persona key reassignment must never orphan
	 * already-created Zernio posts behind a 403.
	 */
	keyRef?: string;
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

	// Let a transient failure (timeout/5xx listing accounts) THROW rather than
	// swallowing it to [] → null → a permanent "not connected" failure. The caller
	// turns a throw into a retriable error result instead.
	const accounts = await getZernioAccounts(client, cacheKey, profileId);
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
	// Fall back to the first match ONLY when scoped to this persona's own profile —
	// there, every account belongs to this persona so "first Instagram" is safe.
	// Unscoped (no profileId), a first-match could be a DIFFERENT persona's account,
	// so refuse to guess and let the publish fail with a clear "connect it" error.
	if (profileId) return matches[0].id;
	return null;
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

	// Per-persona routing: the agent's assigned managed key (Zernio Key Manager)
	// or the user's default key, plus the persona's profile id under that key.
	let apiKey: string | null;
	let profileId: string | null;
	let keyRef: string;
	try {
		({ apiKey, profileId, keyRef } = await getAgentZernioRouting(
			supabase,
			post.user_id,
			post.agent_id
		));
	} catch (err) {
		// Transient DB/key-store error — surface it (retriable) instead of masking
		// it as "no key configured", which the scheduler would fail permanently.
		return { success: false, provider: 'zernio', error: (err as Error).message };
	}
	if (!apiKey) {
		return {
			success: false,
			provider: 'zernio',
			error:
				'No Zernio API key available for this persona. Add one in Settings → API Keys or fix its assignment in the Zernio Key Manager.'
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
	const cacheKey = `${apiKey}::${profileId || 'all'}`;
	let accountId: string | null;
	try {
		accountId = await resolveZernioAccountId(
			client,
			cacheKey,
			normalizedPlat,
			connection,
			profileId || undefined
		);
	} catch (err) {
		// Transient (timeout/5xx while listing accounts) — surface the real message
		// so the scheduler classifies it retriable instead of terminally failing the
		// post as "not connected" on a passing network blip.
		return { success: false, provider: 'zernio', error: (err as Error).message };
	}

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
			mediaItems,
			// Stable across retries of the same post→platform so a timeout-after-commit
			// retry dedupes at Zernio instead of double-posting.
			idempotencyKey: `${post.id}:${normalizedPlat}`
		});
		return { ...result, provider: 'zernio', keyRef };
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
	// Tear down through the same key the post was published with (the persona's
	// assigned key) — the post id only exists in that Zernio account.
	const { apiKey } = await getAgentZernioRouting(supabase, post.user_id, post.agent_id).catch(
		() => ({ apiKey: null as string | null })
	);
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
