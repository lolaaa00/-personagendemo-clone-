import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';

/**
 * Same-origin streaming proxy for public media.
 *
 * Why: generated media lives on a self-hosted Supabase behind a bare
 * `*.easypanel.host` domain — no CDN, measured at a few hundred KB/s to real
 * users. The APP's domain, however, is already proxied by Cloudflare. Serving
 * media from `/media/...` on the app origin puts every asset behind that proxy:
 * posters/images (cacheable-by-extension) get edge-cached globally out of the
 * box, videos benefit from Cloudflare's backhaul immediately and become
 * edge-cached the moment a "Cache Everything"-style Cache Rule for `/media/*`
 * is added in the Cloudflare dashboard. It also removes a second TLS/DNS
 * handshake, since the feed no longer talks to a foreign host.
 *
 * Scope is deliberately narrow: ONLY the two public read paths of our own
 * bucket may pass through (object + image-render). Anything else 404s, so this
 * can never be used as an open proxy. Objects are immutable
 * (timestamp+random names), hence the aggressive immutable cache header.
 */
const ALLOWED_PREFIXES = ['object/public/ugc-media/', 'render/image/public/ugc-media/'];

/** Response headers worth passing through from storage. */
const PASS_HEADERS = [
	'content-type',
	'content-length',
	'content-range',
	'accept-ranges',
	'etag',
	'last-modified'
];

export const GET: RequestHandler = async ({ params, url, request, fetch }) => {
	const path = params.path || '';
	if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p))) throw error(404, 'Not found');

	const base = (publicEnv.PUBLIC_SUPABASE_URL || privateEnv.PUBLIC_SUPABASE_URL || '')
		.trim()
		.replace(/\/+$/, '');
	if (!base) throw error(503, 'Storage not configured');

	// Forward the headers that make video seeking + revalidation work.
	const fwd = new Headers();
	for (const h of ['range', 'if-none-match', 'if-modified-since', 'accept', 'accept-encoding']) {
		const v = request.headers.get(h);
		if (v) fwd.set(h, v);
	}

	const upstream = await fetch(`${base}/storage/v1/${path}${url.search}`, { headers: fwd });
	if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
		throw error(upstream.status === 404 ? 404 : 502, 'Upstream media fetch failed');
	}

	const headers = new Headers();
	for (const h of PASS_HEADERS) {
		const v = upstream.headers.get(h);
		if (v) headers.set(h, v);
	}
	// Immutable object paths → cache as hard as possible, browser and edge alike.
	headers.set('cache-control', 'public, max-age=31536000, immutable');

	return new Response(upstream.status === 304 ? null : upstream.body, {
		status: upstream.status,
		headers
	});
};
