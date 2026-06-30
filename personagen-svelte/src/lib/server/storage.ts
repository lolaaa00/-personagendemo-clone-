import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Durable media storage.
 *
 * Generated stills/videos come back as fal (or other provider) CDN URLs, which
 * are ephemeral. We copy each one into a public Supabase Storage bucket you own
 * and store THAT url on the post — so thumbnails and (critically) the publish
 * step never break when a provider URL expires.
 */

const BUCKET = 'ugc-media';
let bucketEnsured = false;

async function ensureBucket(svc: SupabaseClient): Promise<void> {
	if (bucketEnsured) return;
	try {
		const { data } = await svc.storage.getBucket(BUCKET);
		if (!data) {
			// No per-bucket size limit — self-hosted instances cap it globally and
			// reject larger values; UGC clips are a few MB anyway.
			await svc.storage.createBucket(BUCKET, { public: true });
		}
	} catch {
		// createBucket throws if it already exists (race) — fine.
	}
	bucketEnsured = true;
}

/**
 * Downloads `sourceUrl` and re-uploads it to the public `ugc-media` bucket,
 * returning the durable public URL. Throws on failure (callers fall back to the
 * original url so generation is never blocked by a storage hiccup).
 */
export async function persistToStorage(
	svc: SupabaseClient,
	sourceUrl: string,
	userId: string,
	ext: string
): Promise<string> {
	await ensureBucket(svc);

	const res = await fetch(sourceUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
	if (!res.ok) throw new Error(`fetch source failed (${res.status})`);
	const contentType = res.headers.get('content-type') || (ext === 'mp4' ? 'video/mp4' : 'image/png');
	const buffer = Buffer.from(await res.arrayBuffer());

	const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
	const { error } = await svc.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: false });
	if (error) throw error;

	const { data } = svc.storage.from(BUCKET).getPublicUrl(path);
	return data.publicUrl;
}
