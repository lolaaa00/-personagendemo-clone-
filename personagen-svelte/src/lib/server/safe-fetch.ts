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
		const [a, b] = ip.split('.').map(Number);
		if (a === 127) return true; // loopback
		if (a === 10) return true; // private
		if (a === 172 && b >= 16 && b <= 31) return true; // private
		if (a === 192 && b === 168) return true; // private
		if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
		if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT (100.64.0.0/10)
		if (a === 0) return true; // "this network" (incl. 0.0.0.0)
		return false;
	}
	if (net.isIPv6(ip)) {
		const lower = ip.toLowerCase();
		if (lower === '::' || lower === '::0') return true; // unspecified — routes to loopback
		if (lower === '::1') return true; // loopback
		if (lower.startsWith('fe80:')) return true; // link-local
		if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local (fc00::/7)
		if (lower.startsWith('::ffff:')) {
			// IPv4-mapped IPv6 — recheck the embedded IPv4 address.
			const mapped = lower.replace('::ffff:', '');
			return net.isIPv4(mapped) ? isPrivateOrReservedIp(mapped) : true;
		}
		return false;
	}
	return true; // unrecognized format — fail closed
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
			lookup: (_hostname, _opts, cb) => {
				// Only ever hand the socket a pre-validated public address. Re-check
				// here too, so even the pinned set can't smuggle a private IP.
				const ip = ips.find((a) => !isPrivateOrReservedIp(a));
				if (!ip) {
					cb(new Error('No public address for host'), '', 0);
					return;
				}
				cb(null, ip, net.isIPv6(ip) ? 6 : 4);
			}
		}
	});
	try {
		// @ts-expect-error — undici's `dispatcher` option isn't in the DOM RequestInit type.
		return await fetch(rawUrl, { ...init, dispatcher });
	} finally {
		dispatcher.close().catch(() => {});
	}
}
