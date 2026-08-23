import { describe, it, expect, vi } from 'vitest';

// Same pattern as budget.spec.ts: a hoisted mock env each test can mutate.
const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/public', () => ({ env: mockEnv }));

const { thumbUrl, proxiedMediaUrl } = await import('./image-url');

const BASE = 'https://storage.example.com';
const OBJ = `${BASE}/storage/v1/object/public/ugc-media/user-1/123-abc.png`;
const VID = `${BASE}/storage/v1/object/public/ugc-media/user-1/123-abc.mp4`;

describe('proxiedMediaUrl', () => {
	it('rewrites our bucket objects to the same-origin /media proxy', () => {
		mockEnv.PUBLIC_SUPABASE_URL = BASE;
		expect(proxiedMediaUrl(OBJ)).toBe('/media/object/public/ugc-media/user-1/123-abc.png');
		expect(proxiedMediaUrl(VID)).toBe('/media/object/public/ugc-media/user-1/123-abc.mp4');
	});

	it('rewrites render URLs and keeps their query', () => {
		mockEnv.PUBLIC_SUPABASE_URL = BASE;
		expect(
			proxiedMediaUrl(`${BASE}/storage/v1/render/image/public/ugc-media/u/a.png?width=320`)
		).toBe('/media/render/image/public/ugc-media/u/a.png?width=320');
	});

	it('leaves foreign hosts, other buckets, and unconfigured env untouched', () => {
		mockEnv.PUBLIC_SUPABASE_URL = BASE;
		const foreign = 'https://evil.tld/storage/v1/object/public/ugc-media/u/a.png';
		expect(proxiedMediaUrl(foreign)).toBe(foreign);
		const otherBucket = `${BASE}/storage/v1/object/public/secrets/u/a.png`;
		expect(proxiedMediaUrl(otherBucket)).toBe(otherBucket);
		mockEnv.PUBLIC_SUPABASE_URL = '';
		expect(proxiedMediaUrl(OBJ)).toBe(OBJ);
		expect(proxiedMediaUrl(null)).toBe(null);
	});
});

describe('thumbUrl', () => {
	it('resizes bucket images via the render endpoint, proxied', () => {
		mockEnv.PUBLIC_SUPABASE_URL = BASE;
		expect(thumbUrl(OBJ, 320)).toBe(
			'/media/render/image/public/ugc-media/user-1/123-abc.png?width=320&quality=70'
		);
	});

	it('accepts an already-proxied URL without losing the resize', () => {
		mockEnv.PUBLIC_SUPABASE_URL = BASE;
		expect(thumbUrl('/media/object/public/ugc-media/user-1/123-abc.png', 160)).toBe(
			'/media/render/image/public/ugc-media/user-1/123-abc.png?width=160&quality=70'
		);
	});

	it('passes videos through (proxied), never the render endpoint', () => {
		mockEnv.PUBLIC_SUPABASE_URL = BASE;
		expect(thumbUrl(VID, 480)).toBe('/media/object/public/ugc-media/user-1/123-abc.mp4');
	});
});
