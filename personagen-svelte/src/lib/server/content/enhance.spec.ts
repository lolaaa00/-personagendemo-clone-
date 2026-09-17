/**
 * The enhancement chain's two gates, and its promise never to cost anyone a post.
 *
 * Three behaviours here are load-bearing and none is obvious from reading the
 * call site:
 *
 *   1. The pass will not run without a configured price. fal publishes no rate
 *      for its upscalers, so "on" is not enough — an unpriced paid step is one
 *      the ledger cannot record, and unmetered is free once credits enforce.
 *   2. Every failure returns the ORIGINAL image and bills NOTHING. A realism
 *      pass that loses someone their post is worse than one that never ran.
 *   3. The response is read at `image.url`. Every other image path in this
 *      codebase reads `images[0].url`, and these upscalers do not use that
 *      shape — so a t2i-shaped response must be rejected rather than silently
 *      billed for an undefined URL.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const { envMock, flagsMock } = vi.hoisted(() => ({
	envMock: {} as Record<string, string>,
	flagsMock: { value: 'off' as 'off' | 'upscale' }
}));

vi.mock('$env/dynamic/private', () => ({ env: envMock }));
vi.mock('$lib/server/flags', () => ({ enhanceChain: () => flagsMock.value }));
vi.mock('$lib/server/storage', () => ({
	persistToStorage: vi.fn(async (_svc: any, url: string) => `https://ours.test/durable/${btoa(url)}.png`)
}));

import { enhanceImage, upscaleUsd } from './enhance';

const SVC = {} as any;
const ORIGINAL = 'https://fal.media/ephemeral/original.png';
const UPSCALED = 'https://fal.media/ephemeral/upscaled.png';
const KEY = 'fal-key';

function mockFal(body: unknown, ok = true, status = 200) {
	const f = vi.fn(async () => ({
		ok,
		status,
		json: async () => body,
		text: async () => JSON.stringify(body)
	}));
	vi.stubGlobal('fetch', f);
	return f;
}

beforeEach(() => {
	for (const k of Object.keys(envMock)) delete envMock[k];
	flagsMock.value = 'upscale';
	envMock.UGC_UPSCALE_USD = '0.01';
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('the price gate', () => {
	it.each([
		['unset', undefined],
		['empty', ''],
		['not a number', 'free'],
		['zero — a free claim nobody verified is still unverified', '0'],
		['negative', '-0.01'],
		['absurdly high, so a typo cannot bill a dollar a call', '5']
	])('reads %s as no price', (_label, raw) => {
		if (raw === undefined) delete envMock.UGC_UPSCALE_USD;
		else envMock.UGC_UPSCALE_USD = raw;
		expect(upscaleUsd()).toBeNull();
	});

	it('accepts a plain rate', () => {
		envMock.UGC_UPSCALE_USD = '0.004';
		expect(upscaleUsd()).toBe(0.004);
	});

	it('does not run the pass, or bill, when the switch is on but no price is set', async () => {
		delete envMock.UGC_UPSCALE_USD;
		const f = mockFal({ image: { url: UPSCALED } });

		const r = await enhanceImage(SVC, 'u1', ORIGINAL, KEY);

		expect(f).not.toHaveBeenCalled();
		expect(r.url).toBe(ORIGINAL);
		expect(r.costEvents).toEqual([]);
		expect(r.applied).toEqual([]);
		expect(r.skipped).toMatch(/price/i);
	});

	it('says so loudly, because a switch that is on and silently idle is worse than one that is off', async () => {
		delete envMock.UGC_UPSCALE_USD;
		mockFal({ image: { url: UPSCALED } });
		await enhanceImage(SVC, 'u1', ORIGINAL, KEY);
		expect(console.warn).toHaveBeenCalled();
	});
});

describe('the switch', () => {
	it('is off by default and touches nothing', async () => {
		flagsMock.value = 'off';
		const f = mockFal({ image: { url: UPSCALED } });

		const r = await enhanceImage(SVC, 'u1', ORIGINAL, KEY);

		expect(f).not.toHaveBeenCalled();
		expect(r.url).toBe(ORIGINAL);
		expect(r.costEvents).toEqual([]);
	});

	it('does not run without a fal key', async () => {
		const f = mockFal({ image: { url: UPSCALED } });
		const r = await enhanceImage(SVC, 'u1', ORIGINAL, '');
		expect(f).not.toHaveBeenCalled();
		expect(r.url).toBe(ORIGINAL);
	});
});

describe('a successful pass', () => {
	it('returns a durable URL and bills exactly the configured rate, once', async () => {
		envMock.UGC_UPSCALE_USD = '0.006';
		mockFal({ image: { url: UPSCALED } });

		const r = await enhanceImage(SVC, 'u1', ORIGINAL, KEY);

		expect(r.applied).toEqual(['upscale']);
		expect(r.original).toBe(ORIGINAL);
		expect(r.url).toContain('ours.test/durable');
		expect(r.costEvents).toHaveLength(1);
		expect(r.costEvents[0].usd).toBe(0.006);
		expect(r.costEvents[0].provider).toBe('fal');
		// The receipt points at the stored image, not the provider URL that expires.
		expect(r.costEvents[0].assetUrl).toBe(r.url);
	});

	it('sends the schema fal actually declares: image_url singular, and scale', async () => {
		const f = mockFal({ image: { url: UPSCALED } });
		await enhanceImage(SVC, 'u1', ORIGINAL, KEY);

		const body = JSON.parse((f.mock.calls[0] as any)[1].body);
		expect(body.image_url).toBe(ORIGINAL);
		expect(body).not.toHaveProperty('image_urls');
		expect(body.scale).toBe(2);
		// Not the t2i parameters — these endpoints take neither.
		expect(body).not.toHaveProperty('image_size');
		expect(body).not.toHaveProperty('aspect_ratio');
	});

	it('clamps an out-of-range scale to fal own default rather than passing it on', async () => {
		envMock.UGC_UPSCALE_SCALE = '99';
		const f = mockFal({ image: { url: UPSCALED } });
		await enhanceImage(SVC, 'u1', ORIGINAL, KEY);
		expect(JSON.parse((f.mock.calls[0] as any)[1].body).scale).toBe(2);
	});

	it('calls the configured endpoint', async () => {
		envMock.UGC_UPSCALE_MODEL = 'fal-ai/clarity-upscaler';
		const f = mockFal({ image: { url: UPSCALED } });
		await enhanceImage(SVC, 'u1', ORIGINAL, KEY);
		expect((f.mock.calls[0] as any)[0]).toContain('fal-ai/clarity-upscaler');
	});
});

describe('never-brick: a failure costs the original, and costs nothing', () => {
	it('keeps the original when fal returns an error status', async () => {
		mockFal({ detail: 'boom' }, false, 500);

		const r = await enhanceImage(SVC, 'u1', ORIGINAL, KEY);

		expect(r.url).toBe(ORIGINAL);
		expect(r.costEvents).toEqual([]);
		expect(r.skipped).toMatch(/failed/i);
	});

	it('keeps the original when the request throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('socket hang up');
			})
		);

		const r = await enhanceImage(SVC, 'u1', ORIGINAL, KEY);

		expect(r.url).toBe(ORIGINAL);
		expect(r.costEvents).toEqual([]);
	});

	it('rejects a t2i-shaped response instead of billing for an undefined URL', async () => {
		// `images[0].url` is what every OTHER image path here returns. If this
		// module ever reads that path, it would bill for `undefined`.
		mockFal({ images: [{ url: UPSCALED }] });

		const r = await enhanceImage(SVC, 'u1', ORIGINAL, KEY);

		expect(r.url).toBe(ORIGINAL);
		expect(r.costEvents).toEqual([]);
	});

	it('keeps the original when the image URL comes back empty', async () => {
		mockFal({ image: { url: '' } });
		const r = await enhanceImage(SVC, 'u1', ORIGINAL, KEY);
		expect(r.url).toBe(ORIGINAL);
		expect(r.costEvents).toEqual([]);
	});

	it('handles an empty input without calling out', async () => {
		const f = mockFal({ image: { url: UPSCALED } });
		const r = await enhanceImage(SVC, 'u1', '', KEY);
		expect(f).not.toHaveBeenCalled();
		expect(r.costEvents).toEqual([]);
	});
});
