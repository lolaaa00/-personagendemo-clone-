/**
 * A generation's `selections` record must describe the generation that happened.
 *
 * A client opened a photo-still post and found:
 *
 *   Format     photo still · image · generated
 *   Requested  bytedance/seedance-2.5/reference-to-video — not what ran
 *
 * Nothing about that still had asked for a video. The selection was correct and
 * the record was wrong about it, which is worse than a cosmetic bug: this panel
 * exists precisely so a substitution cannot happen invisibly, and a field that
 * cries substitution on a generation that had none teaches people to ignore it.
 *
 * The cause was the test that decided whether to record it:
 *
 *   input.videoModel && input.videoModel !== videoModelRan
 *
 * `videoModelRan` is null on every still. So any still whose input still carried
 * a video model — a pinned or default choice the composer sends regardless of
 * format — satisfied `!== null` and recorded a request that was never made.
 *
 * These tests pin the rule itself rather than the expression, so a future
 * refactor of the condition still has to answer the same question.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The decision, extracted as data so the tests read as the rule and not as a
 * restatement of the code. Mirrors the guarded branch in generate.ts.
 */
function recordsRequestedVideo(input: {
	mediaType: 'image' | 'video';
	videoModel: string | null;
	v2vModelRequested: string | null;
	videoModelRan: string | null;
}): boolean {
	const { mediaType, videoModel, v2vModelRequested, videoModelRan } = input;
	if (mediaType !== 'video') return false;
	if (videoModel && videoModel !== videoModelRan) return true;
	if (v2vModelRequested && v2vModelRequested !== videoModelRan) return true;
	return false;
}

describe('a still never records a requested video model', () => {
	it('does not report a substitution when the input carried a default video model', () => {
		// The reported case: a photo still, a video model riding along in the input,
		// and no video anywhere in the output.
		expect(
			recordsRequestedVideo({
				mediaType: 'image',
				videoModel: 'bytedance/seedance-2.5/reference-to-video',
				v2vModelRequested: null,
				videoModelRan: null
			})
		).toBe(false);
	});

	it('stays silent on a still even when a transfer model was pinned', () => {
		expect(
			recordsRequestedVideo({
				mediaType: 'image',
				videoModel: null,
				v2vModelRequested: 'bytedance/seedance-2.5/reference-to-video',
				videoModelRan: null
			})
		).toBe(false);
	});
});

describe('a video still discloses what it could not run', () => {
	it('reports the request when a pinned model was not the one that ran', () => {
		// The case the field exists for: a failover. Both sides are video.
		expect(
			recordsRequestedVideo({
				mediaType: 'video',
				videoModel: 'bytedance/seedance-2.5/reference-to-video',
				v2vModelRequested: null,
				videoModelRan: 'kling/o3/image-to-video'
			})
		).toBe(true);
	});

	it('reports a transfer that dropped to image-to-video', () => {
		expect(
			recordsRequestedVideo({
				mediaType: 'video',
				videoModel: null,
				v2vModelRequested: 'bytedance/seedance-2.5/reference-to-video',
				videoModelRan: 'kling/o3/image-to-video'
			})
		).toBe(true);
	});

	it('says nothing when the model asked for is the model that ran', () => {
		expect(
			recordsRequestedVideo({
				mediaType: 'video',
				videoModel: 'kling/o3/image-to-video',
				v2vModelRequested: null,
				videoModelRan: 'kling/o3/image-to-video'
			})
		).toBe(false);
	});
});

describe('the source still carries the guard', () => {
	it('gates videoModelRequested on the generation being a video', () => {
		// The rule above is only worth anything if generate.ts actually applies it.
		// A refactor that drops the mediaType gate reintroduces the reported bug on
		// every still, silently, and no unit test of a pure helper would notice.
		const src = readFileSync(join(__dirname, 'generate.ts'), 'utf8');
		const block = src.slice(
			src.indexOf('videoModelRequested: input.videoModel') - 900,
			src.indexOf('videoModelRequested: input.videoModel') + 400
		);
		expect(block).toContain("mediaType === 'video'");
	});
});
