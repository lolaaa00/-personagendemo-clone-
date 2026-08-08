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
const OBJECT_MARKER = '/storage/v1/object/public/';
const VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?|$)/i;

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
	if (VIDEO_RE.test(url)) return url;
	const i = url.indexOf(OBJECT_MARKER);
	if (i === -1) return url;

	const origin = url.slice(0, i);
	const rest = url.slice(i + OBJECT_MARKER.length);
	const [path, existingQuery] = rest.split('?');
	const q = new URLSearchParams(existingQuery);
	q.set('width', String(width));
	q.set('quality', String(quality));
	return `${origin}/storage/v1/render/image/public/${path}?${q.toString()}`;
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
