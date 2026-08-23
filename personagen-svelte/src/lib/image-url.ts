/**
 * Supabase storage serves the original upload — the UGC PNGs are ~1.8MB each, and
 * /review renders 67 of them, so the queue was pulling well over 100MB of image
 * data to fill 320px-wide cards. The storage API exposes a render endpoint that
 * resizes and negotiates WebP, which takes the same asset to ~20KB.
 *
 * Measured on the live bucket, one representative asset:
 *   original PNG            1,801,327 bytes
 *   render webp width=320      20,774 bytes
 *   render webp width=640      61,486 bytes
 */
import { env as publicEnv } from '$env/dynamic/public';

const OBJECT_MARKER = '/storage/v1/object/public/';
const VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?|$)/i;

/**
 * Rewrite a URL on OUR storage host to the same-origin `/media/...` proxy
 * (src/routes/media/[...path]). The app domain sits behind Cloudflare while the
 * storage host does not — measured at a few hundred KB/s direct — so serving
 * media through the app origin is what puts it behind the CDN. Only the two
 * public read paths of our own bucket are rewritten; anything else (external
 * hosts, data URIs, other buckets) is returned untouched, mirroring the proxy
 * route's own allow-list.
 */
export function proxiedMediaUrl<T extends string | null | undefined>(url: T): T | string {
	if (!url || typeof url !== 'string') return url;
	const base = (publicEnv.PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
	if (!base || !url.startsWith(`${base}/storage/v1/`)) return url;
	const rest = url.slice(`${base}/storage/v1/`.length);
	if (
		!rest.startsWith('object/public/ugc-media/') &&
		!rest.startsWith('render/image/public/ugc-media/')
	) {
		return url;
	}
	return `/media/${rest}`;
}

/**
 * Rewrite a public Supabase storage URL to a resized render URL.
 * Anything that isn't a public storage object — external hosts, data URIs,
 * videos (not transformable) — is returned untouched.
 */
export function thumbUrl(
	url: string | null | undefined,
	width: number,
	quality = 70
): string | null | undefined {
	if (!url || typeof url !== 'string') return url;
	// Accept already-proxied /media/... URLs too (e.g. display.mediaUrl from
	// getPostDisplay): map back to the storage form so the resize logic below
	// applies, then the final return re-proxies.
	if (url.startsWith('/media/')) {
		const base = (publicEnv.PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
		if (base) url = `${base}/storage/v1/${url.slice('/media/'.length)}`;
	}
	if (VIDEO_RE.test(url)) return proxiedMediaUrl(url);
	const i = url.indexOf(OBJECT_MARKER);
	if (i === -1) return url;

	const origin = url.slice(0, i);
	const rest = url.slice(i + OBJECT_MARKER.length);
	const [path, existingQuery] = rest.split('?');
	const q = new URLSearchParams(existingQuery);
	q.set('width', String(width));
	q.set('quality', String(quality));
	return proxiedMediaUrl(`${origin}/storage/v1/render/image/public/${path}?${q.toString()}`);
}

/**
 * Fall back to the untransformed original if the render endpoint fails for a
 * given object, so a transform problem degrades to "slow" rather than "broken".
 * Wire as: onerror={(e) => restoreOriginal(e, originalUrl)}
 */
export function restoreOriginal(event: Event, original: string | null | undefined): void {
	const img = event.currentTarget as HTMLImageElement | null;
	if (!img || !original || img.dataset.fellBack === '1') return;
	img.dataset.fellBack = '1';
	img.src = original;
}
