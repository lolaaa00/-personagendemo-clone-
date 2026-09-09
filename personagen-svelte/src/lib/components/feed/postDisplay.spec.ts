import { describe, it, expect } from 'vitest';
import { refineFormatOf, VIDEO_FORMAT_LABEL } from './postDisplay';
import { MODEL_CATALOG, getModel, resolveModel, DEFAULT_MODEL } from '$lib/models';
import { FORMAT_CATALOG } from '$lib/formats';

/**
 * These lock the two places the drawer used to answer a question about a post by
 * guessing. Both guesses were invisible: one named a model that never ran, the
 * other quoted a price the ledger would then contradict — and neither surface
 * has a red state to notice it by.
 */

describe('refineFormatOf — mirrors refineUgcMedia’s format branch', () => {
	it('keeps the three formats a refine can reproduce as they are', () => {
		expect(refineFormatOf('broll')).toBe('broll');
		expect(refineFormatOf('vo_broll')).toBe('vo_broll');
		expect(refineFormatOf('motion_card')).toBe('motion_card');
	});

	it('re-runs a performance transfer as b-roll — its source clip is not stored', () => {
		expect(refineFormatOf('v2v_replace')).toBe('broll');
		expect(refineFormatOf('v2v_move')).toBe('broll');
	});

	it('sends a narrated transfer down the spokesperson branch, as the server does', () => {
		expect(refineFormatOf('v2v_narrated')).toBe('spokesperson');
	});

	it('treats an explicit spokesperson and a legacy row with no format alike', () => {
		expect(refineFormatOf('spokesperson')).toBe('spokesperson');
		expect(refineFormatOf(null)).toBe('spokesperson');
		expect(refineFormatOf(undefined)).toBe('spokesperson');
	});
});

describe('VIDEO_FORMAT_LABEL — an unknown format is unnamed, never “b-roll”', () => {
	it('names a legacy row with no format as b-roll, which is all there was', () => {
		expect(VIDEO_FORMAT_LABEL['broll']).toBe('b-roll clip');
	});

	it('does not describe a performance transfer as b-roll', () => {
		expect(VIDEO_FORMAT_LABEL['v2v_replace']).toContain('performance transfer');
		expect(VIDEO_FORMAT_LABEL['v2v_move']).toContain('performance transfer');
		expect(VIDEO_FORMAT_LABEL['v2v_replace']).not.toContain('b-roll');
		expect(VIDEO_FORMAT_LABEL['v2v_move']).not.toContain('b-roll');
	});

	it('returns nothing for a format token it has no name for', () => {
		expect(VIDEO_FORMAT_LABEL['some_format_added_after_this_build']).toBeUndefined();
	});
});

describe('naming a recorded model resolves by id, not by an assumed kind', () => {
	it('resolveModel(video_i2v, …) silently substitutes the default for a v2v id', () => {
		// The behaviour the drawer must not use for a RECORD. Asserted here so the
		// day resolveModel stops substituting, this test — not a user — finds out.
		const v2v = MODEL_CATALOG.find((m) => m.kind === 'video_v2v')!;
		const substituted = resolveModel('video_i2v', v2v.id);
		expect(substituted.id).toBe(DEFAULT_MODEL.video_i2v);
		expect(substituted.id).not.toBe(v2v.id);
	});

	it('getModel names every catalog kind by its own id', () => {
		for (const m of MODEL_CATALOG) expect(getModel(m.id)?.label).toBe(m.label);
	});

	it('getModel returns undefined for an id the catalog dropped, so callers can fall back to the raw id', () => {
		expect(getModel('fal-ai/a-model-that-was-retired')).toBeUndefined();
	});

	it('every per-second model is flagged, so no surface can quote its rate as a per-call price', () => {
		const v2vModels = MODEL_CATALOG.filter((m) => m.kind === 'video_v2v');
		expect(v2vModels.length).toBeGreaterThan(0);
		for (const m of v2vModels) expect(m.billing).toBe('per_second');
	});
});

describe('every deliverable format is nameable', () => {
	it('names the listicle rather than falling through to "video"', () => {
		// The map deliberately has no fallthrough: an unnamed format renders as a
		// bare "video" rather than confidently mislabelling itself as b-roll. That
		// is right, and it also means a NEW format is silently anonymous until it
		// is added here — which is what happened to the listicle.
		expect(VIDEO_FORMAT_LABEL.listicle).toBeTruthy();
	});

	it('covers every video format the catalog can deliver', () => {
		// Derived from the catalog, so the next format added is enrolled here
		// automatically instead of shipping unnamed.
		const deliverable = FORMAT_CATALOG.filter(
			(f) => f.video && f.request.format && f.request.format !== 'auto'
		);
		for (const f of deliverable) {
			expect(
				VIDEO_FORMAT_LABEL[f.request.format!],
				`format '${f.request.format}' (${f.id}) has no display label`
			).toBeTruthy();
		}
	});
});
