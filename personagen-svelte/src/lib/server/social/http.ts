/**
 * fetch with a hard deadline. Zernio API calls previously had
 * no timeout at all — one hung socket stalled a scheduler tick or the
 * connections tab indefinitely. Aborts surface as a clearly-worded "timed out"
 * error, which the scheduler's retry classifier treats as transient.
 */
export const PROVIDER_FETCH_TIMEOUT_MS = 60_000;

export async function fetchWithTimeout(
	input: string | URL,
	init?: RequestInit,
	timeoutMs: number = PROVIDER_FETCH_TIMEOUT_MS
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(input, { ...init, signal: controller.signal });
	} catch (err) {
		if (controller.signal.aborted) {
			throw new Error(`Request to ${String(input)} timed out after ${timeoutMs}ms`);
		}
		throw err;
	} finally {
		clearTimeout(timer);
	}
}
