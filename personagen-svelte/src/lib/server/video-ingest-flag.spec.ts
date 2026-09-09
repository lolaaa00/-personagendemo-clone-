/**
 * Source-clip ingest switch — precedence and fail-safe behaviour.
 *
 * This flag decides whether a deployment will accept third-party footage for a
 * persona to re-perform. It is the one switch whose accidental ON state cannot
 * be undone after the fact: the clip is already uploaded and stored. So a
 * missing row, a stale environment variable, a typo in the console and a
 * half-written database value all have to read as OFF, and only an explicit
 * affirmative may read as ON.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockEnv, settings } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string>,
	settings: { value: {} as Record<string, unknown> }
}));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('./settings', () => ({ getSettings: () => settings.value }));

const { videoIngestEnabled, videoIngestSource } = await import('./flags');

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	settings.value = {};
});

describe('default — an unconfigured deployment does not accept source clips', () => {
	it('is off with nothing set anywhere', () => {
		expect(videoIngestEnabled()).toBe(false);
		expect(videoIngestSource()).toBe('default');
	});
});

describe('precedence: env beats database beats default', () => {
	it('the database row is used when no env var is set', () => {
		settings.value = { video_ingest: true };
		expect(videoIngestEnabled()).toBe(true);
		expect(videoIngestSource()).toBe('database');
	});

	it('the env var overrides the database in both directions', () => {
		settings.value = { video_ingest: true };
		mockEnv.VIDEO_INGEST = 'off';
		expect(videoIngestEnabled()).toBe(false);
		expect(videoIngestSource()).toBe('env');

		settings.value = { video_ingest: false };
		mockEnv.VIDEO_INGEST = 'on';
		expect(videoIngestEnabled()).toBe(true);
		expect(videoIngestSource()).toBe('env');
	});

	it('an empty env var is not a decision — the database still speaks', () => {
		settings.value = { video_ingest: true };
		mockEnv.VIDEO_INGEST = '   ';
		expect(videoIngestEnabled()).toBe(true);
		expect(videoIngestSource()).toBe('database');
	});
});

describe('fails safe — only an explicit affirmative turns it on', () => {
	it('accepts on | true | 1, whatever the case or padding', () => {
		for (const v of ['on', 'true', '1', 'ON', ' True ']) {
			mockEnv.VIDEO_INGEST = v;
			expect(videoIngestEnabled()).toBe(true);
		}
	});

	it('reads anything else as off, including junk that is not a "no"', () => {
		for (const v of ['off', 'false', '0', 'yes', 'enabled', 'v2']) {
			mockEnv.VIDEO_INGEST = v;
			expect(videoIngestEnabled()).toBe(false);
		}
	});

	it('a non-boolean database value never opens ingest', () => {
		for (const v of ['true', 1, 'on', {}, null]) {
			settings.value = { video_ingest: v };
			expect(videoIngestEnabled()).toBe(false);
		}
	});
});

describe('read at call time, not import time', () => {
	it('sees a flip that happens after the module was loaded', () => {
		expect(videoIngestEnabled()).toBe(false);
		settings.value = { video_ingest: true };
		expect(videoIngestEnabled()).toBe(true);
		mockEnv.VIDEO_INGEST = 'off';
		expect(videoIngestEnabled()).toBe(false);
	});
});

describe('the switch does not depend on unrelated observability flags', () => {
	it('opens with the activity log off', () => {
		// The rights attestation lives in `source_clip_attestations` and ingest
		// fails closed when that row cannot be written, so the guarantee is at the
		// write. Coupling ingest to ACTIVITY_LOG as well would disable a working,
		// fully-audited feature for a reason that no longer exists.
		settings.value = { video_ingest: true, activity_log: false };
		expect(videoIngestEnabled()).toBe(true);
	});
});
