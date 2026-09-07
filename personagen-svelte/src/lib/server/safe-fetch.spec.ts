/**
 * SSRF guard — pure-logic tests. No network: every case uses an IP literal or
 * `localhost`, which `resolvePublicIps` short-circuits before any DNS lookup.
 *
 * This module is the ONLY URL guard in the codebase (the engine's older private
 * copy was folded into it on 2026-09-05). Anything that fetches a user-supplied
 * URL server-side must go through `safeFetch` / `resolvePublicIps`; the specs in
 * `ai-client-image.spec.ts` pin the image path to it.
 */
import { describe, it, expect } from 'vitest';
import { isPrivateOrReservedIp, resolvePublicIps } from './safe-fetch';

describe('isPrivateOrReservedIp', () => {
	it.each([
		['127.0.0.1', 'loopback'],
		['127.255.255.254', 'loopback range'],
		['10.0.0.1', 'RFC1918 10/8'],
		['172.16.0.1', 'RFC1918 172.16/12 low'],
		['172.31.255.255', 'RFC1918 172.16/12 high'],
		['192.168.1.1', 'RFC1918 192.168/16'],
		['169.254.169.254', 'cloud metadata / link-local'],
		['100.64.0.1', 'carrier-grade NAT 100.64/10'],
		['100.127.255.255', 'carrier-grade NAT high'],
		['0.0.0.0', 'this-network'],
		['::1', 'IPv6 loopback'],
		['::', 'IPv6 unspecified (routes to loopback)'],
		['fe80::1', 'IPv6 link-local'],
		['fc00::1', 'IPv6 unique-local fc'],
		['fd12:3456::1', 'IPv6 unique-local fd'],
		['::ffff:10.0.0.1', 'IPv4-mapped private'],
		['::ffff:169.254.169.254', 'IPv4-mapped metadata']
	])('blocks %s (%s)', (ip) => {
		expect(isPrivateOrReservedIp(ip)).toBe(true);
	});

	it.each([
		['8.8.8.8', 'public v4'],
		['1.1.1.1', 'public v4'],
		['172.15.0.1', 'just below 172.16/12'],
		['172.32.0.1', 'just above 172.16/12'],
		['100.63.255.255', 'just below CGNAT'],
		['100.128.0.0', 'just above CGNAT'],
		['2606:4700:4700::1111', 'public v6'],
		['::ffff:8.8.8.8', 'IPv4-mapped public']
	])('allows %s (%s)', (ip) => {
		expect(isPrivateOrReservedIp(ip)).toBe(false);
	});

	it('fails CLOSED on garbage', () => {
		expect(isPrivateOrReservedIp('not-an-ip')).toBe(true);
		expect(isPrivateOrReservedIp('')).toBe(true);
	});
});

describe('resolvePublicIps', () => {
	it('rejects non-http(s) schemes before touching DNS', async () => {
		await expect(resolvePublicIps('ftp://example.com/x')).rejects.toThrow(/http\/https/);
		await expect(resolvePublicIps('file:///etc/passwd')).rejects.toThrow(/http\/https/);
		await expect(resolvePublicIps('javascript:alert(1)')).rejects.toThrow();
	});

	it('rejects malformed URLs', async () => {
		await expect(resolvePublicIps('not a url')).rejects.toThrow(/Invalid URL/);
		await expect(resolvePublicIps('')).rejects.toThrow(/Invalid URL/);
	});

	it('rejects localhost and *.localhost by name', async () => {
		await expect(resolvePublicIps('http://localhost:8000/')).rejects.toThrow(/disallowed host/);
		await expect(resolvePublicIps('http://kong.localhost/')).rejects.toThrow(/disallowed host/);
	});

	it('rejects IP-literal hosts that are private or reserved', async () => {
		await expect(resolvePublicIps('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
			/private\/internal/
		);
		await expect(resolvePublicIps('http://10.0.0.5:8000/rest/v1/')).rejects.toThrow(
			/private\/internal/
		);
		await expect(resolvePublicIps('http://[::1]:5432/')).rejects.toThrow(/private\/internal/);
	});

	it('returns the literal for a public IP host', async () => {
		await expect(resolvePublicIps('https://8.8.8.8/image.png')).resolves.toEqual(['8.8.8.8']);
	});
});
