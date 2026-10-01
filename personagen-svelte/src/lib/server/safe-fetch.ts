/**
 * SSRF-hardened fetch for user-supplied URLs (storefront scraping fallback).
 *
 * A plain `assertPublicHttpUrl()` before `fetch()` is a TOCTOU: the guard
 * resolves the hostname, but `fetch()` re-resolves it independently, so a
 * time-based DNS-rebinding record (public IP to the guard, 169.254.169.254 to
 * the socket) slips through. This pins the connection to a PRE-VALIDATED public
 * IP via an undici dispatcher whose `lookup` only ever returns addresses that
 * passed the private/reserved check — the socket can't reach an internal host
 * even if DNS flips between check and connect. TLS SNI/cert validation still
 * uses the original hostname, so HTTPS is unaffected.
 */

import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent } from 'undici';

export function isPrivateOrReservedIp(ip: string): boolean {
	if (net.isIPv4(ip)) {
		const [a, b, c] = ip.split('.').map(Number);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 0 && (c === 0 || c === 2)) ||
			(a === 192 && b === 88 && c === 99) ||
			(a === 192 && b === 168) ||
			(a === 198 && (b === 18 || b === 19)) ||
			(a === 198 && b === 51 && c === 100) ||
			(a === 203 && b === 0 && c === 113) ||
			a >= 224
		);
	}
	if (net.isIPv6(ip)) {
		const lower = ip.toLowerCase();
		if (lower === '::' || lower === '::0') return true; // unspecified — routes to loopback
		if (lower === '::1') return true; // loopback
		if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local fe80::/10
		if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local (fc00::/7)
		if (lower.startsWith('ff')) return true; // multicast
		if (lower.startsWith('2001:db8:')) return true; // documentation
		if (lower.startsWith('::ffff:')) {
			// IPv4-mapped IPv6 — recheck the embedded IPv4 address.
			const mapped = lower.replace('::ffff:', '');
			return net.isIPv4(mapped) ? isPrivateOrReservedIp(mapped) : true;
		}
		return false;
	}
	return true; // unrecognized format — fail closed
}

/** Build undici's DNS callback from an immutable, already validated set. */
export function createPinnedLookup(ips: readonly string[]) {
	const pinned = [...ips];
	return (
		_hostname: string,
		_opts: unknown,
		cb: (error: Error | null, ip: string, family: number) => void
	) => {
		const ip = pinned.find((address) => !isPrivateOrReservedIp(address));
		if (!ip) return cb(new Error('No public address for host'), '', 0);
		cb(null, ip, net.isIPv6(ip) ? 6 : 4);
	};
}

/** Resolves a URL's host to public IPs, throwing if it's disallowed or private. */
export async function resolvePublicIps(rawUrl: string): Promise<string[]> {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new Error('Invalid URL');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('Only http/https URLs are allowed');
	}
	const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
		throw new Error('URL resolves to a disallowed host');
	}

	let ips: string[];
	if (net.isIP(hostname)) {
		ips = [hostname];
	} else {
		const records = await dns.lookup(hostname, { all: true }).catch(() => []);
		ips = records.map((r) => r.address);
	}
	if (ips.length === 0) throw new Error('Could not resolve URL host');
	for (const ip of ips) {
		if (isPrivateOrReservedIp(ip)) throw new Error('URL resolves to a private/internal address');
	}
	return ips;
}

/**
 * Like `fetch`, but for untrusted external URLs: validates the URL, resolves it
 * once, and pins the socket to the validated public IP(s) so a DNS rebind after
 * the check cannot redirect the connection to an internal address.
 */
export async function safeFetch(rawUrl: string, init?: RequestInit): Promise<Response> {
	const ips = await resolvePublicIps(rawUrl);
	const dispatcher = new Agent({
		connect: {
			lookup: createPinnedLookup(ips)
		}
	});
	try {
		// @ts-expect-error — undici's `dispatcher` option isn't in the DOM RequestInit type.
		return await fetch(rawUrl, { ...init, dispatcher });
	} finally {
		dispatcher.close().catch(() => {});
	}
}

/**
 * Fetch an untrusted URL while validating and pinning every redirect hop.
 * Native redirect following is deliberately disabled: otherwise undici would
 * resolve the Location target outside the pinned dispatcher.
 */
export async function safeFetchWithRedirects(
	rawUrl: string,
	init: RequestInit = {},
	maxRedirects = 5,
	fetchHop: typeof safeFetch = safeFetch
): Promise<Response> {
	if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
		throw new Error('maxRedirects must be a non-negative integer');
	}
	let url = rawUrl;
	for (let hop = 0; ; hop++) {
		const response = await fetchHop(url, { ...init, redirect: 'manual' });
		if (response.status < 300 || response.status >= 400) return response;
		const location = response.headers.get('location');
		if (!location) return response;
		if (hop >= maxRedirects) {
			await response.body?.cancel();
			throw new Error(`Too many redirects (maximum ${maxRedirects})`);
		}
		await response.body?.cancel();
		url = new URL(location, url).toString();
		// fetchHop=safeFetch resolves, validates, and pins this new target before
		// opening its socket. Tests inject a spy without weakening production.
	}
}
