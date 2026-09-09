/**
 * ffmpeg ARGUMENT construction for the two local-assembly primitives.
 *
 * Deliberately not an encode test: this suite runs on plain node in CI, where
 * ffmpeg is not installed, and `video.ts` treats ffmpeg as a soft dependency
 * precisely so that stays true. That costs less than it looks, because every
 * ffmpeg bug this app has actually shipped was a wrong or missing FLAG — a
 * dropped `+faststart`, an `amix` that halved the voice, a filtergraph naming a
 * stream the input didn't have — and all of those live in the argument array.
 *
 * So `buildMotionArgs` / `buildVoiceoverArgs` are pure and exported, and this
 * file pins the flags. The public wrappers get one test each: the never-throw
 * contract, which is the whole reason their callers can stay simple.
 *
 * The one thing an argument test cannot see is whether ffmpeg TERMINATES, and
 * that is not hypothetical here: the first version of the voiceover graph used
 * `tpad=stop_mode=clone:stop=-1` with `-shortest`, which reads correctly, and
 * encodes forever. The invariants at the bottom of the voiceover section exist
 * to keep that specific mistake from coming back.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
// Type-only: erased at compile time, so it cannot load the module before the
// env mock below is installed.
import type { MuxSourceFacts, MuxVoiceoverOptions } from './video';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const { buildMotionArgs, buildVoiceoverArgs, targetSeconds, stillToMotion, muxVoiceover } =
	await import('./video');

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
});

/** Value of the argument immediately following `flag`. */
function valueAfter(args: string[], flag: string): string {
	const i = args.indexOf(flag);
	return i === -1 ? '' : (args[i + 1] ?? '');
}
/** Asserts `flag value` appear adjacent, the only way ffmpeg reads them. */
function hasPair(args: string[], flag: string, value: string): boolean {
	return valueAfter(args, flag) === value;
}

describe('buildMotionArgs — output format', () => {
	it('produces a 1080x1920 yuv420p H.264 clip with faststart', () => {
		const args = buildMotionArgs('still.img', 'out.mp4');
		const vf = valueAfter(args, '-vf');

		// The 9:16 master canvas is set by zoompan's own output size, not by a
		// trailing scale — anything else would resample the card twice.
		expect(vf).toContain('s=1080x1920');
		expect(hasPair(args, '-c:v', 'libx264')).toBe(true);
		expect(hasPair(args, '-pix_fmt', 'yuv420p')).toBe(true);
		expect(hasPair(args, '-movflags', '+faststart')).toBe(true);
		expect(vf).toContain('format=yuv420p');
		// The clip is silent by contract; audio arrives via muxVoiceover.
		expect(args).toContain('-an');
		expect(args[args.length - 1]).toBe('out.mp4');
		expect(hasPair(args, '-i', 'still.img')).toBe(true);
	});

	it('honours UGC_VIDEO_CRF like every other encode in this module', () => {
		expect(hasPair(buildMotionArgs('a', 'b'), '-crf', '27')).toBe(true);
		mockEnv.UGC_VIDEO_CRF = '22';
		expect(hasPair(buildMotionArgs('a', 'b'), '-crf', '22')).toBe(true);
	});
});

describe('buildMotionArgs — duration policy', () => {
	it('defaults to 5s @30fps and states that length three ways consistently', () => {
		const args = buildMotionArgs('a', 'b');
		// 5 * 30 = 150 frames. zoompan's d, the -frames:v cap and the output rate
		// must agree or the clip is silently the wrong length.
		expect(valueAfter(args, '-vf')).toContain('d=150');
		expect(hasPair(args, '-frames:v', '150')).toBe(true);
		expect(hasPair(args, '-r', '30')).toBe(true);
		expect(valueAfter(args, '-vf')).toContain('fps=30');
	});

	it('takes its default length from UGC_VIDEO_DURATION, like the paid path', () => {
		mockEnv.UGC_VIDEO_DURATION = '8';
		const args = buildMotionArgs('a', 'b');
		expect(hasPair(args, '-frames:v', '240')).toBe(true);
		expect(valueAfter(args, '-vf')).toContain('d=240');
	});

	it('ignores a junk UGC_VIDEO_DURATION rather than producing a 0-frame clip', () => {
		mockEnv.UGC_VIDEO_DURATION = 'five';
		expect(hasPair(buildMotionArgs('a', 'b'), '-frames:v', '150')).toBe(true);
	});

	it('lets an explicit seconds/fps override the env default', () => {
		mockEnv.UGC_VIDEO_DURATION = '8';
		const args = buildMotionArgs('a', 'b', { seconds: 3, fps: 24 });
		expect(hasPair(args, '-frames:v', '72')).toBe(true);
		expect(hasPair(args, '-r', '24')).toBe(true);
	});

	it('clamps absurd input instead of emitting an unrenderable graph', () => {
		expect(hasPair(buildMotionArgs('a', 'b', { seconds: 0 }), '-frames:v', '30')).toBe(true);
		expect(hasPair(buildMotionArgs('a', 'b', { seconds: 9999, fps: 30 }), '-frames:v', '900')).toBe(
			true
		);
		expect(hasPair(buildMotionArgs('a', 'b', { fps: 500, seconds: 1 }), '-r', '60')).toBe(true);
		expect(hasPair(buildMotionArgs('a', 'b', { fps: 1, seconds: 1 }), '-r', '12')).toBe(true);
	});
});

describe('buildMotionArgs — the move itself', () => {
	it('zooms on a supersampled canvas, which is the anti-judder fix', () => {
		const vf = valueAfter(buildMotionArgs('a', 'b'), '-vf');
		// 4x the 1080x1920 master: zoompan rounds its crop origin to whole INPUT
		// pixels, so the input has to be much larger than the output or the push
		// visibly steps.
		expect(vf).toContain('4320');
		expect(vf).toContain('7680');
		// ...and the zoom must still land on the 9:16 master, not on the big one.
		expect(vf).toContain('s=1080x1920');
	});

	it('drives the move from `on`, never from the drifting `zoom` accumulator', () => {
		const vf = valueAfter(buildMotionArgs('a', 'b'), '-vf');
		expect(vf).toContain('on/149');
		// z='zoom+0.001' is the accumulator form that drifts and stutters.
		expect(vf).not.toContain('z=zoom+');
		expect(vf).not.toContain("z='zoom+");
	});

	it('pushes in from 1.0 and pulls out from 1.12', () => {
		const zin = valueAfter(buildMotionArgs('a', 'b', { direction: 'in' }), '-vf');
		expect(zin).toContain("z='1+0.12*on/149'");
		const zout = valueAfter(buildMotionArgs('a', 'b', { direction: 'out' }), '-vf');
		expect(zout).toContain("z='1.12-0.12*on/149'");
	});

	it('pans vertically at a fixed crop, and up/down are mirrors', () => {
		const up = valueAfter(buildMotionArgs('a', 'b', { direction: 'up' }), '-vf');
		const down = valueAfter(buildMotionArgs('a', 'b', { direction: 'down' }), '-vf');
		// Fixed zoom: a push mixed into a pan reads as a wobble.
		expect(up).toContain("z='1.12'");
		expect(down).toContain("z='1.12'");
		expect(up).toContain("y='(ih-ih/zoom)*(1-on/149)'");
		expect(down).toContain("y='(ih-ih/zoom)*on/149'");
		expect(up).not.toEqual(down);
	});

	it('keeps the frame horizontally centred in every direction', () => {
		for (const direction of ['in', 'out', 'up', 'down'] as const) {
			const vf = valueAfter(buildMotionArgs('a', 'b', { direction }), '-vf');
			expect(vf).toContain("x='iw/2-(iw/zoom/2)'");
		}
	});
});

describe('buildMotionArgs — stills that are not 9:16', () => {
	it('covers by default: fill the frame, centre-crop the overflow, never bars', () => {
		const vf = valueAfter(buildMotionArgs('a', 'b'), '-vf');
		expect(vf).toContain('force_original_aspect_ratio=increase');
		expect(vf).toContain('crop=4320:7680');
		expect(vf).not.toContain('pad=');
	});

	it('contains on request: whole still kept, remainder padded black', () => {
		const vf = valueAfter(buildMotionArgs('a', 'b', { fit: 'contain' }), '-vf');
		expect(vf).toContain('force_original_aspect_ratio=decrease');
		expect(vf).toContain('pad=4320:7680');
		expect(vf).not.toContain('crop=');
	});

	it('never stretches: aspect is forced and SAR is normalised in both modes', () => {
		for (const fit of ['cover', 'contain'] as const) {
			const vf = valueAfter(buildMotionArgs('a', 'b', { fit }), '-vf');
			expect(vf).toContain('force_original_aspect_ratio=');
			// A bare `scale=4320:7680` would silently distort an off-spec still.
			expect(vf).not.toMatch(/scale=4320:7680(?!:force)/);
			// A non-1 sample aspect ratio on a phone JPEG would survive the scale.
			expect(vf).toContain('setsar=1');
		}
	});
});

// A 5s clip narrated by a 3s voiceover — the ordinary case, where the two
// policies visibly disagree.
const FACTS: MuxSourceFacts = { hasAudio: true, videoSeconds: 5, audioSeconds: 3 };
const facts = (over: Partial<MuxSourceFacts> = {}): MuxSourceFacts => ({ ...FACTS, ...over });
const vo = (f: MuxSourceFacts = FACTS, opts: MuxVoiceoverOptions = {}) =>
	buildVoiceoverArgs('in.mp4', 'vo.audio', 'out.mp4', f, opts);
const graphOf = (args: string[]) => valueAfter(args, '-filter_complex');

describe('targetSeconds — the duration policy on its own', () => {
	it("defaults to the narration's length, so it is never cut mid-sentence", () => {
		expect(targetSeconds(FACTS)).toBe(3);
		expect(targetSeconds(FACTS, 'audio')).toBe(3);
	});

	it("'video' hands the decision back to the clip", () => {
		expect(targetSeconds(FACTS, 'video')).toBe(5);
	});

	it("'longest' truncates neither, in either direction", () => {
		expect(targetSeconds(FACTS, 'longest')).toBe(5);
		expect(targetSeconds(facts({ audioSeconds: 7 }), 'longest')).toBe(7);
	});

	it('returns null when the probe could not read the length it needs', () => {
		expect(targetSeconds(facts({ audioSeconds: null }), 'audio')).toBeNull();
		expect(targetSeconds(facts({ videoSeconds: null }), 'video')).toBeNull();
		// 'longest' can still answer from whichever side it did read.
		expect(targetSeconds(facts({ videoSeconds: null }), 'longest')).toBe(3);
		expect(targetSeconds(facts({ audioSeconds: null, videoSeconds: null }), 'longest')).toBeNull();
	});
});

describe('buildVoiceoverArgs — encode + wiring', () => {
	it('re-encodes with the module-wide delivery settings and faststart', () => {
		const args = vo();
		expect(hasPair(args, '-c:v', 'libx264')).toBe(true);
		expect(hasPair(args, '-pix_fmt', 'yuv420p')).toBe(true);
		expect(hasPair(args, '-movflags', '+faststart')).toBe(true);
		expect(hasPair(args, '-crf', '27')).toBe(true);
		expect(hasPair(args, '-c:a', 'aac')).toBe(true);
		expect(hasPair(args, '-b:a', '96k')).toBe(true);
		// The delivery width cap has to ride inside the filtergraph: -vf and
		// -filter_complex cannot both drive the same stream.
		expect(graphOf(args)).toContain('scale=w=min(720\\,iw):h=-2');
		expect(args).not.toContain('-vf');
	});

	it('maps the filtergraph outputs explicitly, both video and audio', () => {
		const args = vo();
		expect(graphOf(args)).toContain('[vout]');
		expect(graphOf(args)).toContain('[aout]');
		expect(hasPair(args, '-map', '[vout]')).toBe(true);
		// indexOf finds the first -map, so check the audio one by hand.
		expect(args.filter((a, i) => a === '-map' && args[i + 1] === '[aout]')).toHaveLength(1);
		expect(args[args.indexOf('-i') + 1]).toBe('in.mp4');
		expect(args[args.lastIndexOf('-i') + 1]).toBe('vo.audio');
		expect(args[args.length - 1]).toBe('out.mp4');
	});
});

describe('buildVoiceoverArgs — duration policy lands on -t', () => {
	it("defaults to the narration's length and holds the clip's last frame to reach it", () => {
		const args = vo();
		expect(hasPair(args, '-t', '3.000')).toBe(true);
		// A 3s narration under a 5s clip is a trim; a 7s one needs the held frame,
		// and the same graph covers both because -t decides where it stops.
		expect(graphOf(args)).toContain('tpad=stop_mode=clone:stop=-1');
	});

	it("'video' pins the output to the clip instead", () => {
		expect(hasPair(vo(FACTS, { keep: 'video' }), '-t', '5.000')).toBe(true);
	});

	it("'longest' pins it to whichever side runs longer", () => {
		expect(hasPair(vo(FACTS, { keep: 'longest' }), '-t', '5.000')).toBe(true);
		expect(hasPair(vo(facts({ audioSeconds: 7 }), { keep: 'longest' }), '-t', '7.000')).toBe(true);
	});

	it('pads the audio side too, so a short mix still fills the target', () => {
		expect(graphOf(vo(FACTS, { keep: 'video' }))).toContain('apad');
	});
});

describe('buildVoiceoverArgs — ducking', () => {
	it('ducks the clip audio to 0.25 by default and keeps the voice at unity', () => {
		const graph = graphOf(vo());
		expect(graph).toContain('[0:a]volume=0.25[bed]');
		expect(graph).toContain('[1:a]volume=1[vo]');
	});

	it('sets amix normalize=0 — the flag whose absence halves the voiceover', () => {
		for (const keep of ['audio', 'video', 'longest'] as const) {
			expect(graphOf(vo(FACTS, { keep }))).toContain('amix=inputs=2:duration=longest:normalize=0');
		}
	});

	it('takes a caller-supplied duck level and clamps it to a legal gain', () => {
		const duck = (n: number) => graphOf(vo(FACTS, { duckOriginal: n }));
		expect(duck(0.5)).toContain('[0:a]volume=0.5[bed]');
		expect(duck(0)).toContain('[0:a]volume=0[bed]');
		expect(duck(9)).toContain('[0:a]volume=1[bed]');
		expect(duck(-3)).toContain('[0:a]volume=0[bed]');
	});
});

describe('buildVoiceoverArgs — a source clip with no audio track', () => {
	const silent = facts({ hasAudio: false });

	it('never references [0:a], for any policy (amix on a missing input is fatal)', () => {
		for (const keep of ['audio', 'video', 'longest'] as const) {
			const graph = graphOf(vo(silent, { keep }));
			// Not "unused" — absent. ffmpeg fails at graph-configuration time on a
			// stream specifier the input does not have.
			expect(graph).not.toContain('[0:a]');
			expect(graph).not.toContain('amix');
			expect(graph).toContain('[aout]');
			// The video half is untouched by the audio question.
			expect(graph).toContain('[vout]');
		}
	});

	it('ignores duckOriginal when there is nothing to duck', () => {
		expect(graphOf(vo(silent, { duckOriginal: 0.1 }))).not.toContain('volume=');
	});

	it('still applies the duration policy, and still holds the last frame', () => {
		const args = vo(silent);
		expect(hasPair(args, '-t', '3.000')).toBe(true);
		expect(graphOf(args)).toContain('tpad=stop_mode=clone:stop=-1');
		expect(graphOf(args)).toContain('[1:a]apad[aout]');
	});
});

describe('buildVoiceoverArgs — termination invariants', () => {
	// Cartesian product of every branch the builder has.
	const cases = (['audio', 'video', 'longest'] as const).flatMap((keep) =>
		[true, false].flatMap((hasAudio) =>
			(
				[
					{ videoSeconds: 5, audioSeconds: 3 },
					{ videoSeconds: 5, audioSeconds: null },
					{ videoSeconds: null, audioSeconds: 3 },
					{ videoSeconds: null, audioSeconds: null }
				] as Pick<MuxSourceFacts, 'videoSeconds' | 'audioSeconds'>[]
			).map((d) => ({ keep, args: vo({ hasAudio, ...d }, { keep }) }))
		)
	);

	it('never emits -shortest, which does not fire against an endless pad', () => {
		// The bug this replaced: tpad stop=-1 + -shortest encodes forever.
		for (const { args } of cases) expect(args).not.toContain('-shortest');
	});

	it('only ever pads when -t is there to stop the padding', () => {
		for (const { args } of cases) {
			const graph = graphOf(args);
			const padsForever = graph.includes('stop=-1') || graph.includes('apad');
			expect(padsForever ? args.includes('-t') : true).toBe(true);
		}
	});

	it('degrades to a plain mux — no pads, no -t — when a length is unreadable', () => {
		const args = vo(facts({ audioSeconds: null }));
		const graph = graphOf(args);
		expect(args).not.toContain('-t');
		expect(graph).not.toContain('tpad');
		expect(graph).not.toContain('apad');
		// Still a valid, complete graph — just an unbounded one.
		expect(graph).toContain('[vout]');
		expect(graph).toContain('[aout]');
	});
});

describe('never-throw contract', () => {
	// Not a network test: an unparseable URL makes fetch reject synchronously, so
	// these finish in microseconds and cannot flake or hang in CI. (On a host
	// without ffmpeg both bail even earlier, at hasFfmpeg.)
	const BAD_URL = 'not a url';

	it('stillToMotion returns null instead of throwing when the still is unfetchable', async () => {
		await expect(stillToMotion(BAD_URL)).resolves.toBeNull();
	});

	it('muxVoiceover returns null instead of throwing when an input is unfetchable', async () => {
		await expect(muxVoiceover(BAD_URL, BAD_URL)).resolves.toBeNull();
	});
});
