import dns from 'dns';
import { URL } from 'url';

/**
 * Validates a URL to prevent Server-Side Request Forgery (SSRF).
 * Ensures only HTTP/HTTPS protocols are used and the target IP address does not
 * resolve to a loopback, private Class A/B/C network, link-local, multicast, or IPv6 equivalents.
 */
export async function validateUrlForSsrf(urlStr: string): Promise<boolean> {
	try {
		const parsedUrl = new URL(urlStr);
		if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
			return false;
		}

		const hostname = parsedUrl.hostname;

		// Resolve DNS to verify IP
		return new Promise((resolve) => {
			dns.lookup(hostname, (err, address, family) => {
				if (err || !address) {
					resolve(false);
					return;
				}

				if (family === 4) {
					const parts = address.split('.').map(Number);
					if (
						parts[0] === 127 || // Loopback
						parts[0] === 10 || // Class A Private
						(parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // Class B Private
						(parts[0] === 192 && parts[1] === 168) || // Class C Private
						(parts[0] === 169 && parts[1] === 254) || // Link Local
						parts[0] === 0 || // Local network
						parts[0] >= 224 // Multicast/Reserved
					) {
						resolve(false);
					} else {
						resolve(true);
					}
				} else if (family === 6) {
					const ip = address.toLowerCase();
					if (
						ip === '::1' ||
						ip === '::' ||
						ip.startsWith('fc') ||
						ip.startsWith('fd') ||
						ip.startsWith('fe80') ||
						ip.startsWith('ff')
					) {
						resolve(false);
					} else {
						resolve(true);
					}
				} else {
					resolve(false);
				}
			});
		});
	} catch (e) {
		return false;
	}
}
