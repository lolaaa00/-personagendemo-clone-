/**
 * Resolve hostnames through a public resolver instead of this machine's.
 *
 * Mid-session the local resolver started returning a router placeholder
 * (`2600:1700:...::1`) for the Supabase host, so every request failed with
 * UND_ERR_CONNECT_TIMEOUT while the service itself was healthy — the deployed
 * app's own /api/health still reported `supabase: ok`, and pinning the real
 * address with `curl --resolve` answered in 0.27s.
 *
 * `dns.setServers()` alone does not fix it: that only affects `dns.resolve*`,
 * while `fetch` (undici) connects through `dns.lookup`, which uses the OS
 * resolver. So this installs a dispatcher whose `lookup` goes through
 * `resolve4` against a public server.
 *
 * Load it, do not import it for its exports:
 *   node --import ./scripts/ux/dns-fix.mjs build/index.js
 *   node --import ./scripts/ux/dns-fix.mjs scripts/ux/whatever.mjs
 *
 * This is audit tooling. It is never imported by application code, and it
 * changes nothing about the machine — the override lives and dies with the
 * process.
 */
import dns from 'node:dns';
import { promises as dnsp } from 'node:dns';

const RESOLVERS = ['1.1.1.1', '8.8.8.8'];
dnsp.setServers(RESOLVERS);

const cache = new Map();

/**
 * Patch `dns.lookup` itself rather than undici's dispatcher: `net.connect` is
 * what ultimately resolves, and it calls this function. Overriding it covers
 * fetch, the Supabase client and anything else in the process at once.
 */
const original = dns.lookup;

function patched(hostname, options, callback) {
	if (typeof options === 'function') {
		callback = options;
		options = {};
	}
	const opts = typeof options === 'number' ? { family: options } : (options ?? {});

	// Literals and loopback never need a resolver.
	if (/^[\d.]+$/.test(hostname) || hostname === 'localhost' || hostname === '::1') {
		return original(hostname, options, callback);
	}

	const done = (addr) => {
		if (opts.all) return callback(null, [{ address: addr, family: 4 }]);
		return callback(null, addr, 4);
	};

	const cached = cache.get(hostname);
	if (cached) return process.nextTick(() => done(cached));

	dnsp.resolve4(hostname).then(
		(addrs) => {
			if (!addrs?.length) return original(hostname, options, callback);
			cache.set(hostname, addrs[0]);
			done(addrs[0]);
		},
		// If the public resolver cannot answer either, fall back to the OS one
		// rather than breaking a host this override was never needed for.
		() => original(hostname, options, callback)
	);
}

dns.lookup = patched;
dns.promises.lookup = async (hostname, options) =>
	new Promise((resolve, reject) => {
		patched(hostname, options ?? {}, (err, address, family) =>
			err ? reject(err) : resolve(options?.all ? address : { address, family })
		);
	});
