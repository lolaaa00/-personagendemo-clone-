/**
 * `isOwnedBucketUrl` is the gate that stops an attacker pinning an arbitrary URL
 * as a persona's face.
 *
 * Its own docstring calls it "the ONLY gate" on the restore-avatar / restore-kit
 * routes, and persona creation is now a third caller: the wizard sends the
 * preview portrait it wants adopted, and whatever survives this check is written
 * to `agent_configs.ugc_character_ref` — from where it is handed to fal as an
 * `image_urls` entry and re-fetched server-side. Despite that it had no test at
 * all, which is how the substring bypass below lived in the code long enough to
 * need fixing.
 *
 * These pin the behaviour the three call sites depend on. The bypass case is the
 * regression test the original fix never got.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { publicEnvMock, privateEnvMock } = vi.hoisted(() => ({
	publicEnvMock: {} as Record<string, string>,
	privateEnvMock: {} as Record<string, string>
}));

vi.mock('$env/dynamic/public', () => ({ env: publicEnvMock }));
vi.mock('$env/dynamic/private', () => ({ env: privateEnvMock }));

import { isOwnedBucketUrl } from './storage';

const ORIGIN = 'https://db.example.com';
const UID = '11111111-2222-3333-4444-555555555555';
const OTHER_UID = '99999999-8888-7777-6666-555555555555';
const owned = (uid: string, file = 'portrait.png') =>
	`${ORIGIN}/storage/v1/object/public/ugc-media/${uid}/${file}`;

beforeEach(() => {
	// The origin is read fresh on every call, so setting it here is enough.
	publicEnvMock.PUBLIC_SUPABASE_URL = ORIGIN;
	delete privateEnvMock.PUBLIC_SUPABASE_URL;
});

describe('isOwnedBucketUrl', () => {
	it('accepts a URL inside this user own folder in our bucket', () => {
		expect(isOwnedBucketUrl(owned(UID), UID)).toBe(true);
	});

	it('accepts a nested path under the user folder', () => {
		expect(isOwnedBucketUrl(owned(UID, 'sub/dir/shot.png'), UID)).toBe(true);
	});

	it('rejects another user folder in the same bucket', () => {
		expect(isOwnedBucketUrl(owned(OTHER_UID), UID)).toBe(false);
	});

	it('rejects a prefix-collision on the user id', () => {
		// `${UID}extra` starts with the uid but is a different folder; the trailing
		// slash in the compared prefix is what makes this false.
		expect(isOwnedBucketUrl(owned(`${UID}extra`), UID)).toBe(false);
	});

	it('rejects the substring bypass an external host can otherwise smuggle', () => {
		// The original implementation was a bare `url.includes(...)`, which this
		// satisfies while pointing at an attacker-controlled host.
		const evil = `https://evil.tld/x?=/storage/v1/object/public/ugc-media/${UID}/a.png`;
		expect(isOwnedBucketUrl(evil, UID)).toBe(false);
	});

	it('rejects a lookalike host', () => {
		const lookalike = `https://db.example.com.evil.tld/storage/v1/object/public/ugc-media/${UID}/a.png`;
		expect(isOwnedBucketUrl(lookalike, UID)).toBe(false);
	});

	it('rejects a different bucket on our own origin', () => {
		expect(
			isOwnedBucketUrl(`${ORIGIN}/storage/v1/object/public/other-bucket/${UID}/a.png`, UID)
		).toBe(false);
	});

	it('rejects a private (non-public) object path', () => {
		expect(isOwnedBucketUrl(`${ORIGIN}/storage/v1/object/ugc-media/${UID}/a.png`, UID)).toBe(false);
	});

	it.each(['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///etc/passwd'])(
		'rejects the non-http(s) scheme %s',
		(url) => {
			expect(isOwnedBucketUrl(url, UID)).toBe(false);
		}
	);

	it('rejects an unparseable URL', () => {
		expect(isOwnedBucketUrl('not a url', UID)).toBe(false);
	});

	it.each([
		['null url', null],
		['undefined url', undefined],
		['empty url', '']
	])('rejects %s', (_label, url) => {
		expect(isOwnedBucketUrl(url as string | null | undefined, UID)).toBe(false);
	});

	it('rejects an empty user id rather than matching any folder', () => {
		expect(isOwnedBucketUrl(owned(UID), '')).toBe(false);
	});

	it('fails closed when the storage origin is not configured', () => {
		delete publicEnvMock.PUBLIC_SUPABASE_URL;
		expect(isOwnedBucketUrl(owned(UID), UID)).toBe(false);
	});

	it('falls back to the private env copy of the origin', () => {
		delete publicEnvMock.PUBLIC_SUPABASE_URL;
		privateEnvMock.PUBLIC_SUPABASE_URL = ORIGIN;
		expect(isOwnedBucketUrl(owned(UID), UID)).toBe(true);
	});
});
