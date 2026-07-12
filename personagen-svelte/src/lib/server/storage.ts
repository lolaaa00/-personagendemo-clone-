import type { SupabaseClient } from '@supabase/supabase-js';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';

/**
 * Durable media storage.
 *
 * Generated stills/videos come back as provider CDN URLs (fal etc.), which are
 * ephemeral. We copy each into a public Supabase Storage bucket you own and store
 * THAT url on the post — so thumbnails and (critically) the publish step never
 * break when a provider URL expires.
 */

const BUCKET = 'ugc-media';
let bucketEnsured = false;

async function ensureBucket(svc: SupabaseClient): Promise<void> {
	if (bucketEnsured) return;
	try {
		const { data } = await svc.storage.getBucket(BUCKET);
		if (!data) {
			// No per-bucket size limit — self-hosted instances cap it globally and
			// reject larger values; UGC clips are only a few MB anyway.
			await svc.storage.createBucket(BUCKET, { public: true });
		}
	} catch {
		// createBucket throws if it already exists (race) — fine.
	}
	bucketEnsured = true;
}

/** Uploads raw bytes to the public bucket and returns the durable public URL. */
export async function persistBufferToStorage(
	svc: SupabaseClient,
	buffer: Buffer,
	userId: string,
	ext: string,
	contentType: string
): Promise<string> {
	await ensureBucket(svc);
	const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
	const { error } = await svc.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: false });
	if (error) throw error;
	return svc.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** True once a URL already lives in our own public bucket (skip re-persisting). */
export function isDurableBucketUrl(url: string | null | undefined): boolean {
	return typeof url === 'string' && url.includes(`/storage/v1/object/public/${BUCKET}/`);
}

/**
 * The origin our public bucket URLs are served from — the same Supabase URL the
 * service/server clients are built from (see `createSupabaseServiceClient`), which
 * is also what `getPublicUrl()` above stamps onto every URL we mint. Returns null
 * when unconfigured/unparseable, which makes `isOwnedBucketUrl` fail closed.
 */
function ownedStorageOrigin(): string | null {
	const raw = (publicEnv.PUBLIC_SUPABASE_URL || privateEnv.PUBLIC_SUPABASE_URL || '').trim();
	if (!raw) return null;
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
		return u.origin;
	} catch {
		return null;
	}
}

/**
 * True if the URL points inside THIS user's own folder in our bucket (re-pin safety).
 *
 * SECURITY: this is the ONLY gate on the restore-avatar / restore-kit-stage routes,
 * i.e. the thing that stops an attacker pinning an arbitrary external URL as a
 * persona's face (it gets written to `ugc_character_ref`, handed to fal as an
 * image_urls entry, and fetched by `persistToStorage`). It used to be a bare
 * `url.includes('/storage/v1/object/public/<bucket>/<uid>/')`, which a substring
 * anywhere in the URL satisfies — so
 *   https://evil.tld/x?=/storage/v1/object/public/ugc-media/<uid>/a.png
 * sailed through. Match the ORIGIN and a PATH PREFIX on a parsed URL instead;
 * anything that isn't http(s) on our storage origin, or that fails to parse, is
 * rejected.
 */
export function isOwnedBucketUrl(url: string | null | undefined, userId: string): boolean {
	if (typeof url !== 'string' || !url || typeof userId !== 'string' || !userId) return false;

	const origin = ownedStorageOrigin();
	if (!origin) return false;

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}

	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
	if (parsed.origin !== origin) return false;

	return parsed.pathname.startsWith(`/storage/v1/object/public/${BUCKET}/${userId}/`);
}

export interface StoredImage {
	url: string;
	name: string;
	createdAt: string | null;
	sizeBytes: number | null;
}

/**
 * Lists a user's generated images (newest first) from their bucket folder, for
 * the "restore a previous profile picture" history picker. Images only — videos
 * and `backup-*` internal copies are filtered out. Nothing is ever deleted, so
 * every past generation is recoverable here.
 */
export async function listUserImages(
	svc: SupabaseClient,
	userId: string,
	limit = 100
): Promise<StoredImage[]> {
	const { data, error } = await svc.storage
		.from(BUCKET)
		.list(userId, { limit, sortBy: { column: 'created_at', order: 'desc' } });
	if (error || !data) return [];
	return data
		.filter((o) => /\.(png|jpe?g|webp)$/i.test(o.name) && !o.name.startsWith('backup-'))
		.map((o) => ({
			url: svc.storage.from(BUCKET).getPublicUrl(`${userId}/${o.name}`).data.publicUrl,
			name: o.name,
			createdAt: (o as any).created_at ?? null,
			sizeBytes: (o as any).metadata?.size ?? null
		}));
}

/**
 * Downloads `sourceUrl` and re-uploads it to the public `ugc-media` bucket,
 * returning the durable public URL.
 *
 * `extraHeaders` lets callers pass provider auth (e.g. OpenRouter's video
 * content endpoint requires `Authorization: Bearer …` AND expires — without it
 * the copy silently 401'd and the ephemeral URL got stored, then 404'd later).
 * Retries transient network failures; throws only when the source is genuinely
 * unfetchable so callers can decide to fail loudly rather than store a dead URL.
 */
export async function persistToStorage(
	svc: SupabaseClient,
	sourceUrl: string,
	userId: string,
	ext: string,
	extraHeaders?: Record<string, string>
): Promise<string> {
	// Already ours — don't round-trip it through the network again.
	if (isDurableBucketUrl(sourceUrl)) return sourceUrl;

	let lastErr: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const res = await fetch(sourceUrl, {
				headers: { 'User-Agent': 'Mozilla/5.0', ...(extraHeaders || {}) },
				signal: AbortSignal.timeout(90_000)
			});
			// 404/410 = the provider already deleted it — retrying won't help.
			if (res.status === 404 || res.status === 410) {
				throw new Error(`source gone (${res.status})`);
			}
			if (!res.ok) throw new Error(`fetch source failed (${res.status})`);
			const contentType =
				res.headers.get('content-type') || (ext === 'mp4' ? 'video/mp4' : 'image/png');
			const buffer = Buffer.from(await res.arrayBuffer());
			if (buffer.length === 0) throw new Error('empty source body');
			return persistBufferToStorage(svc, buffer, userId, ext, contentType);
		} catch (e) {
			lastErr = e;
			if (String((e as Error).message).startsWith('source gone')) break;
			await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error('persistToStorage failed');
}
