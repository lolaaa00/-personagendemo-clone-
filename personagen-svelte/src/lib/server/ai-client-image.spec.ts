/**
 * Pins the vision image path to the SSRF guard.
 *
 * `fetchImageInlineData` is the one place the server fetches a URL the CLIENT
 * chose. The regression this guards against: someone "simplifying" it back to a
 * plain fetch, which would let a logged-in user read deployment-internal hosts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { safeFetchMock } = vi.hoisted(() => ({ safeFetchMock: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('./user-api-keys', () => ({ getUserApiKey: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {} }));
vi.mock('./social/http', () => ({
	// If the image path ever calls the unguarded fetch, this throws and the
	// "returns null" expectations below fail loudly.
	fetchWithTimeout: vi.fn(() => {
		throw new Error('fetchWithTimeout must not be used for user-supplied image URLs');
	})
}));
vi.mock('./safe-fetch', () => ({ safeFetch: safeFetchMock }));

const { fetchImageInlineData } = await import('./ai-client');

function response(body: Uint8Array, headers: Record<string, string>, ok = true) {
	return {
		ok,
		headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
		arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
	};
}

beforeEach(() => {
	safeFetchMock.mockReset();
});

describe('fetchImageInlineData', () => {
	it('fetches through safeFetch (never the plain fetch) and returns base64 inline data', async () => {
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		safeFetchMock.mockResolvedValue(response(png, { 'content-type': 'image/png' }));

		const out = await fetchImageInlineData('https://cdn.example.com/face.png');

		expect(safeFetchMock).toHaveBeenCalledTimes(1);
		expect(safeFetchMock.mock.calls[0][0]).toBe('https://cdn.example.com/face.png');
		// A timeout signal is passed so a hung origin cannot wedge the request.
		expect(safeFetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
		expect(out).toEqual({ mimeType: 'image/png', data: Buffer.from(png).toString('base64') });
	});

	it('returns null when the guard rejects the URL (private host, bad scheme)', async () => {
		safeFetchMock.mockRejectedValue(new Error('URL resolves to a private/internal address'));
		await expect(fetchImageInlineData('http://169.254.169.254/latest')).resolves.toBeNull();
	});

	it('returns null on a non-2xx response', async () => {
		safeFetchMock.mockResolvedValue(
			response(new Uint8Array(0), { 'content-type': 'image/png' }, false)
		);
		await expect(fetchImageInlineData('https://cdn.example.com/missing.png')).resolves.toBeNull();
	});

	it('returns null when the body is not an image', async () => {
		safeFetchMock.mockResolvedValue(
			response(new TextEncoder().encode('{"secret":1}'), { 'content-type': 'application/json' })
		);
		await expect(fetchImageInlineData('https://cdn.example.com/api')).resolves.toBeNull();
	});

	it('refuses oversized images by declared length and by actual body', async () => {
		const tiny = new Uint8Array([1, 2, 3]);
		safeFetchMock.mockResolvedValueOnce(
			response(tiny, { 'content-type': 'image/jpeg', 'content-length': String(21 * 1024 * 1024) })
		);
		await expect(fetchImageInlineData('https://cdn.example.com/huge.jpg')).resolves.toBeNull();

		const big = new Uint8Array(20 * 1024 * 1024 + 1);
		safeFetchMock.mockResolvedValueOnce(response(big, { 'content-type': 'image/jpeg' }));
		await expect(fetchImageInlineData('https://cdn.example.com/lying.jpg')).resolves.toBeNull();
	});
});
