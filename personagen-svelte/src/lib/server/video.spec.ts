/**
 * ffmpeg ARGUMENT construction for the local-assembly primitives and the
 * caption burn-in.
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
import type { MuxSourceFacts, MuxVoiceoverOptions, TimedCaption, VideoProbe } from './video';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const {
	buildMotionArgs,
	buildVoiceoverArgs,
	buildCaptionPlan,
	targetSeconds,
	planAudioTimeline,
	buildPcmDecodeArgs,
	buildPcmEncodeArgs,
	concatAudio,
	probeAudioSeconds,
	stillToMotion,
	muxVoiceover,
	burnCaptions,
	MAX_TIMED_CAPTIONS,
	ffprobeBin,
	probeVideo,
	clipExtForMime,
	clipRejectionReason,
	MAX_CLIP_BYTES,
	MAX_CLIP_SECONDS,
	MIN_CLIP_SECONDS,
	MIN_CLIP_DIMENSION
} = await import('./video');

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

/**
 * Captions.
 *
 * The badge and the hook are LEGACY OUTPUT: three exact strings that have been
 * rendering in production, pinned character-for-character below so that adding
 * the timed track cannot have moved them by a pixel. Everything after that is
 * the track itself, which is the part that can silently produce a frame nobody
 * looks at — an off-frame row, an `enable` window that is never true, a `\n`
 * drawn as a glyph box — none of which any encode-free test can see except by
 * reading the filter string.
 */
const BADGE_BOX = 'drawbox=x=22:y=26:w=196:h=46:color=black@0.55:t=fill';
const BADGE_TEXT =
	"drawtext=fontfile=font.ttf:text='AI GENERATED':fontcolor=white:fontsize=22:x=38:y=38";
const HOOK_FILTER =
	'drawtext=fontfile=font.ttf:textfile=hook.txt:fontcolor=white:fontsize=46:borderw=4:bordercolor=black@0.9:x=(w-text_w)/2:y=h-(h/5):line_spacing=8';

/** Only the track's drawtext stages, in draw order. */
const trackOf = (filters: string[]) => filters.filter((f) => f.includes('textfile=cap'));
const track = (...items: TimedCaption[]) => buildCaptionPlan({ track: items });
const LIST: TimedCaption[] = [
	{ text: '1. Sunrise Stare', at: 0 },
	{ text: '2. The Cold Plunge', at: 2.5 },
	{ text: '3. Nobody Claps', at: 5 }
];

describe('buildCaptionPlan — the pre-existing badge and hook, unchanged', () => {
	it('emits the exact filters production has been rendering', () => {
		const plan = buildCaptionPlan({ badge: true, hook: 'Watch this' });
		expect(plan.filters).toEqual([BADGE_BOX, BADGE_TEXT, HOOK_FILTER]);
		expect(plan.files).toEqual([{ name: 'hook.txt', text: 'Watch this' }]);
	});

	it('an absent track adds nothing at all — this change is additive or it is a bug', () => {
		for (const opts of [
			{ badge: true },
			{ hook: 'Watch this' },
			{ badge: true, hook: 'Watch this' }
		]) {
			expect(buildCaptionPlan(opts)).toEqual(buildCaptionPlan({ ...opts, track: [] }));
			expect(buildCaptionPlan(opts).filters.some((f) => f.includes('enable='))).toBe(false);
		}
	});

	it('asks for no re-encode when nothing was requested', () => {
		// An empty filter list is what makes burnCaptions return null and the caller
		// keep the untouched original, rather than paying a re-encode for a no-op.
		expect(buildCaptionPlan({}).filters).toEqual([]);
		expect(buildCaptionPlan({ hook: '   ' }).filters).toEqual([]);
		expect(buildCaptionPlan({ track: [{ text: ' \n ', at: 1 }] }).filters).toEqual([]);
	});

	it('still strips newlines out of the hook', () => {
		expect(buildCaptionPlan({ hook: 'two\nlines' }).files[0].text).toBe('two lines');
	});
});

describe('buildCaptionPlan — a timed item is drawn as content, not as a footnote', () => {
	it('is centred, large, and heavily outlined over live video', () => {
		const [f] = trackOf(track(LIST[0]).filters);
		expect(f).toContain('x=(w-text_w)/2');
		// 720/15. The 31px-at-a-44px-left-margin version read as a caption under
		// the subject instead of as the thing the viewer is meant to read.
		expect(f).toContain('fontsize=48');
		expect(f).toContain('borderw=6');
		expect(f).toContain('bordercolor=black@0.92');
		expect(f).toContain('fontcolor=white');
	});

	it('scales the type off the frame width instead of hardcoding 48', () => {
		const [big] = trackOf(buildCaptionPlan({ track: [LIST[0]] }, 1080).filters);
		expect(big).toContain('fontsize=72');
		// ...and the row pitch follows it, or a bigger frame would overlap rows.
		expect(big).toContain('y=h-(h/5)-137');
	});

	it('passes the text by file, never interpolated into the filter string', () => {
		// Item text is model output: a ':' or a quote inside it would otherwise
		// terminate the option or the filter.
		const plan = track({ text: "3. It's 5:00 — go", at: 1 });
		expect(plan.files).toContainEqual({ name: 'cap0.txt', text: "3. It's 5:00 — go" });
		const [f] = trackOf(plan.filters);
		expect(f).toContain('textfile=cap0.txt');
		expect(f).not.toContain(':text=');
	});

	it('strips newlines from every item, which drawtext renders as a glyph box', () => {
		const plan = track({ text: '1. Two\nWords', at: 0 }, { text: '2. Three\r\nMore', at: 1 });
		for (const f of plan.files) expect(f.text).not.toMatch(/[\r\n]/);
		expect(plan.files[0].text).toBe('1. Two Words');
		expect(plan.files[1].text).toBe('2. Three More');
	});
});

describe('buildCaptionPlan — when each item is on screen', () => {
	it('accumulates by default: no end time means it stays to the last frame', () => {
		const fs = trackOf(track(...LIST).filters);
		expect(fs[0]).toContain("enable='gte(t,0)'");
		expect(fs[1]).toContain("enable='gte(t,2.5)'");
		expect(fs[2]).toContain("enable='gte(t,5)'");
		// The listicle only works because item 1 is still up when item 3 lands.
		expect(fs.some((f) => f.includes('between('))).toBe(false);
	});

	it('bounds the window when until is given', () => {
		const [f] = trackOf(track({ text: 'flash', at: 1.25, until: 3.5 }).filters);
		expect(f).toContain("enable='between(t,1.25,3.5)'");
	});

	it('quotes the expression so its comma cannot split the filter chain', () => {
		// `\,` (the WEB_SCALE_FILTER trick) is wrong here: inside '' ffmpeg takes
		// every character literally, so the backslash would reach the expression
		// parser.
		for (const f of trackOf(track({ text: 'x', at: 1, until: 2 }).filters)) {
			expect(f).toMatch(/enable='[a-z]+\(t,[0-9.,]+\)'$/);
			expect(f).not.toContain('\\,');
		}
	});

	it('never emits a window that is empty or starts before the clip does', () => {
		// A negative `at` or an until <= at is a model typo; both would render an
		// item that is simply never visible, which looks like a dropped item.
		expect(trackOf(track({ text: 'x', at: -4 }).filters)[0]).toContain("enable='gte(t,0)'");
		expect(trackOf(track({ text: 'x', at: 3, until: 3 }).filters)[0]).toContain(
			"enable='gte(t,3)'"
		);
		expect(trackOf(track({ text: 'x', at: 3, until: 1 }).filters)[0]).toContain(
			"enable='gte(t,3)'"
		);
		expect(trackOf(track({ text: 'x', at: Number.NaN, until: Number.NaN }).filters)[0]).toContain(
			"enable='gte(t,0)'"
		);
	});
});

describe('buildCaptionPlan — the stack', () => {
	it('gives every item its own row, from its index, with no collisions', () => {
		const ys = trackOf(track(...LIST).filters).map((f) => /y=(h-\(h\/5\)-\d+)/.exec(f)?.[1]);
		expect(ys).toEqual(['h-(h/5)-225', 'h-(h/5)-158', 'h-(h/5)-91']);
		expect(new Set(ys).size).toBe(ys.length);
	});

	it('lays out N items without collision for every N up to the cap', () => {
		for (let n = 1; n <= MAX_TIMED_CAPTIONS; n++) {
			const items = Array.from({ length: n }, (_, i) => ({ text: `${i + 1}. item`, at: i }));
			const offsets = trackOf(track(...items).filters).map((f) =>
				Number(/y=h-\(h\/5\)-(\d+)/.exec(f)?.[1])
			);
			expect(offsets).toHaveLength(n);
			// One row pitch apart, descending — row 0 highest, row n-1 lowest, and
			// the whole block bottom-anchored so it never leaves the frame.
			for (let i = 1; i < n; i++) expect(offsets[i - 1] - offsets[i]).toBe(67);
			// 48px of type inside a 67px pitch: the outlines cannot touch.
			expect(Math.min(...offsets)).toBeGreaterThan(48);
		}
	});

	it('keeps the caller ordering, so a numbered list is never re-shuffled', () => {
		// Sorting by `at` would put "2." above "1." for a mistimed track — our bug
		// to the viewer, not the model's.
		const plan = track({ text: '1. first', at: 9 }, { text: '2. second', at: 1 });
		expect(plan.files.map((f) => f.text)).toEqual(['1. first', '2. second']);
		expect(trackOf(plan.filters)[0]).toContain("enable='gte(t,9)'");
	});

	it('closes the gap left by a blank item instead of reserving a hole', () => {
		const plan = track(
			{ text: '1. one', at: 0 },
			{ text: '  ', at: 1 },
			{ text: '3. three', at: 2 }
		);
		expect(plan.files.map((f) => f.name)).toEqual(['cap0.txt', 'cap1.txt']);
		expect(trackOf(plan.filters)).toHaveLength(2);
	});
});

describe('buildCaptionPlan — the runaway-list cap', () => {
	const many = Array.from({ length: 20 }, (_, i) => ({ text: `${i + 1}. item`, at: i }));

	it('draws at most MAX_TIMED_CAPTIONS rows, keeping the first ones', () => {
		const plan = track(...many);
		expect(trackOf(plan.filters)).toHaveLength(MAX_TIMED_CAPTIONS);
		expect(plan.files.map((f) => f.text)).toEqual(
			many.slice(0, MAX_TIMED_CAPTIONS).map((m) => m.text)
		);
	});

	it('truncates an over-long label rather than drawing it off both edges', () => {
		// drawtext does not wrap; a 400-char "label" is one line wider than the frame.
		expect(track({ text: 'x'.repeat(400), at: 0 }).files[0].text).toHaveLength(60);
	});

	it('composes with the hook and the badge in one chain', () => {
		const plan = buildCaptionPlan({ badge: true, hook: 'Watch this', track: LIST });
		expect(plan.filters.slice(0, 3)).toEqual([BADGE_BOX, BADGE_TEXT, HOOK_FILTER]);
		expect(plan.filters).toHaveLength(3 + LIST.length);
		expect(plan.files.map((f) => f.name)).toEqual(['hook.txt', 'cap0.txt', 'cap1.txt', 'cap2.txt']);
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

/**
 * The segmented-voiceover join.
 *
 * Two things can go wrong here and neither is visible in the output file. The
 * timeline can be off by a gap — which reads as "the captions drift" and gets
 * blamed on the lip-sync model — and the encode can name a codec our Alpine
 * runtime does not carry, which fails on the deploy host and nowhere else. Both
 * live in a pure function or an argument array, so both are pinned here.
 */
const SEC = 24000 * 2; // bytes of s16le@24k mono per second

describe('planAudioTimeline — where each beat starts', () => {
	it('starts the first segment at zero and gaps only BETWEEN', () => {
		// The classic failure is a leading gap or a gap counted after the start is
		// recorded; either way item one is the beat that gives it away.
		const { startsAt, seconds } = planAudioTimeline([SEC, 2 * SEC, SEC], 0.35);
		expect(startsAt).toEqual([0, 1.35, 3.7]);
		expect(seconds).toEqual([1, 2, 1]);
	});

	it('defaults to the 0.35s beat gap when none is passed', () => {
		expect(planAudioTimeline([SEC, SEC]).startsAt).toEqual([0, 1.35]);
	});

	it('keeps durations EXACT, not rounded to a probe centisecond', () => {
		// The whole reason the join runs through raw PCM: a header duration would
		// round this to 0.33 and every later reveal would inherit the error.
		expect(planAudioTimeline([Math.round(0.333 * SEC)], 0).seconds[0]).toBeCloseTo(0.333, 6);
	});

	it('rounds the gap to a whole SAMPLE, never an odd byte count', () => {
		// One stray byte shifts every following sample and the rest of the track is
		// white noise — silent in the args, deafening in the file.
		for (const g of [0.35, 0.1234, 0.0001, 1.999]) {
			expect(planAudioTimeline([SEC, SEC], g).gapBytes % 2).toBe(0);
		}
	});

	it('refuses a nonsense gap rather than allocating a nonsense buffer', () => {
		// Buffer.alloc(NaN) throws, which would break the never-null contract of the
		// only caller. Negative is clamped for the same reason: no overlap.
		expect(planAudioTimeline([SEC, SEC], Number.NaN).startsAt).toEqual([0, 1.35]);
		expect(planAudioTimeline([SEC, SEC], -5).startsAt).toEqual([0, 1]);
		expect(planAudioTimeline([SEC, SEC], 999).startsAt).toEqual([0, 3]);
	});

	it('is empty for no segments', () => {
		expect(planAudioTimeline([], 0.35)).toEqual({ gapBytes: 16800, seconds: [], startsAt: [] });
	});
});

describe('buildPcmDecodeArgs / buildPcmEncodeArgs — the join flags', () => {
	it('decodes to the exact raw format the timeline arithmetic assumes', () => {
		const args = buildPcmDecodeArgs('seg0.audio', 'seg0.pcm');
		expect(hasPair(args, '-f', 's16le')).toBe(true);
		expect(hasPair(args, '-ar', '24000')).toBe(true);
		expect(hasPair(args, '-ac', '1')).toBe(true);
		// Any other rate or channel count makes bytes/(rate x 2) the wrong answer,
		// so the reveals would be timed against a track nobody hears.
		expect(args[args.length - 1]).toBe('seg0.pcm');
	});

	it('drops a cover-art stream before it becomes sample data', () => {
		// TTS providers embed artwork; a video stream reaching a headerless s16le
		// muxer is written straight into the audio as noise.
		expect(buildPcmDecodeArgs('a', 'b')).toContain('-vn');
	});

	it('encodes with the NATIVE aac encoder, never libmp3lame', () => {
		// libmp3lame is an external library our Alpine runtime is not guaranteed to
		// carry: an mp3 output fails on the deploy host and passes everywhere else.
		const args = buildPcmEncodeArgs('joined.pcm', 'out.m4a');
		expect(hasPair(args, '-c:a', 'aac')).toBe(true);
		expect(args.join(' ')).not.toContain('libmp3lame');
	});

	it('declares the raw input format BEFORE -i', () => {
		// Raw PCM has no header. Behind -i these flags describe the OUTPUT and
		// ffmpeg reads the file as 44.1k stereo: no error, just a chipmunked track
		// that no longer matches a single measured offset.
		const args = buildPcmEncodeArgs('joined.pcm', 'out.m4a');
		const i = args.indexOf('-i');
		for (const flag of ['-f', '-ar', '-ac']) expect(args.indexOf(flag)).toBeLessThan(i);
		expect(args[i + 1]).toBe('joined.pcm');
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

	it('burnCaptions returns null instead of throwing, track or no track', async () => {
		// Captions are an enhancement: every failure here has to end with the caller
		// holding the original clip, never with a rejected promise mid-generation.
		await expect(burnCaptions(BAD_URL, { hook: 'hi' })).resolves.toBeNull();
		await expect(burnCaptions(BAD_URL, { track: LIST })).resolves.toBeNull();
	});

	it('concatAudio returns null instead of throwing when a segment is unfetchable', async () => {
		// The listicle's whole degradation story depends on this: a throw here would
		// abort a run that could still have shipped as a plain talking head.
		await expect(concatAudio([BAD_URL, BAD_URL])).resolves.toBeNull();
	});

	it('concatAudio declines an empty segment list without spawning anything', async () => {
		await expect(concatAudio([])).resolves.toBeNull();
	});

	it('probeAudioSeconds returns null rather than throwing on anything unreadable', async () => {
		// Same contract as probeVideo, and the same three shapes of failure: a path
		// that cannot be opened, no bytes at all, and bytes that are not audio.
		await expect(probeAudioSeconds('/definitely/not/a/file.mp3')).resolves.toBeNull();
		await expect(probeAudioSeconds(Buffer.alloc(0))).resolves.toBeNull();
		await expect(probeAudioSeconds(Buffer.from('this is not an mp3'))).resolves.toBeNull();
	});

	it('burnCaptions declines a no-op render without touching the network', async () => {
		// Not a fetch that fails — a request that never happens, because an empty
		// plan means there is nothing to burn and a re-encode would only cost quality.
		await expect(burnCaptions(BAD_URL, {})).resolves.toBeNull();
		await expect(burnCaptions(BAD_URL, { badge: false, track: [] })).resolves.toBeNull();
	});
});

/**
 * Source-clip ingest.
 *
 * Same discipline as the argument tests above — nothing here needs ffprobe
 * installed — but the stakes are different. These are the bounds that decide
 * what a single upload is allowed to cost: the v2v models bill per output
 * second, so `clipRejectionReason` is the only thing standing between a
 * 40-minute screen recording and a per-second invoice for it.
 */
describe('ffprobeBin — which binary gets spawned', () => {
	it('defaults to the bare name on PATH', () => {
		expect(ffprobeBin()).toBe('ffprobe');
	});

	it('prefers an explicit FFPROBE_PATH', () => {
		mockEnv.FFPROBE_PATH = '/opt/bin/ffprobe';
		mockEnv.FFMPEG_PATH = '/usr/local/bin/ffmpeg';
		expect(ffprobeBin()).toBe('/opt/bin/ffprobe');
	});

	it('derives the sibling of a configured ffmpeg', () => {
		// The whole point of the override: a host that had to point at a private
		// ffmpeg build has ffprobe next to it, never on PATH.
		mockEnv.FFMPEG_PATH = '/opt/ffmpeg-static/ffmpeg';
		expect(ffprobeBin()).toBe('/opt/ffmpeg-static/ffprobe');
	});

	it('keeps the .exe suffix and the windows separators', () => {
		mockEnv.FFMPEG_PATH = 'C:\\tools\\ffmpeg\\bin\\ffmpeg.exe';
		expect(ffprobeBin()).toBe('C:\\tools\\ffmpeg\\bin\\ffprobe.exe');
	});

	it('renames only the basename, never a directory that says ffmpeg', () => {
		mockEnv.FFMPEG_PATH = '/opt/ffmpeg/bin/ffmpeg';
		expect(ffprobeBin()).not.toContain('/opt/ffprobe/');
	});

	it('falls back to PATH when FFMPEG_PATH is a wrapper we cannot reason about', () => {
		// e.g. a shell shim called `av-encode` — guessing a sibling name from it
		// would spawn something that does not exist; PATH at least might work.
		mockEnv.FFMPEG_PATH = '/usr/local/bin/av-encode';
		expect(ffprobeBin()).toBe('ffprobe');
	});
});

describe('clipExtForMime — the container allowlist', () => {
	it('accepts the four containers fal can decode', () => {
		expect(clipExtForMime('video/mp4')).toBe('mp4');
		expect(clipExtForMime('video/quicktime')).toBe('mov');
		expect(clipExtForMime('video/webm')).toBe('webm');
		expect(clipExtForMime('video/x-m4v')).toBe('m4v');
	});

	it('ignores the codec parameters browsers append', () => {
		// Chrome sends this for a re-encoded upload; matching the raw header
		// string would reject a perfectly good mp4.
		expect(clipExtForMime('video/mp4; codecs="avc1.42E01E"')).toBe('mp4');
		expect(clipExtForMime('VIDEO/MP4')).toBe('mp4');
	});

	it('rejects containers that would only fail later at the provider', () => {
		expect(clipExtForMime('video/x-matroska')).toBeNull();
		expect(clipExtForMime('video/avi')).toBeNull();
	});

	it('rejects non-video and missing types', () => {
		expect(clipExtForMime('image/png')).toBeNull();
		expect(clipExtForMime('application/octet-stream')).toBeNull();
		expect(clipExtForMime('')).toBeNull();
		expect(clipExtForMime(null)).toBeNull();
		expect(clipExtForMime(undefined)).toBeNull();
	});
});

describe('clipRejectionReason — what an upload is allowed to be', () => {
	const ok: VideoProbe = { durationSec: 8.4, width: 1080, height: 1920 };

	it('accepts a normal phone clip', () => {
		expect(clipRejectionReason(4_000_000, 'video/mp4', ok)).toBeNull();
	});

	it('rejects an unaccepted container before anything else', () => {
		const reason = clipRejectionReason(1000, 'video/x-matroska', ok);
		expect(reason).toContain('not supported');
	});

	it('rejects an empty or oversized file', () => {
		expect(clipRejectionReason(0, 'video/mp4', ok)).toContain('empty');
		expect(clipRejectionReason(MAX_CLIP_BYTES + 1, 'video/mp4', ok)).toContain('too large');
		// The cap itself is inclusive — a file exactly at the limit is fine.
		expect(clipRejectionReason(MAX_CLIP_BYTES, 'video/mp4', ok)).toBeNull();
	});

	it('REFUSES an unprobed clip rather than storing it unmeasured', () => {
		// The single most important line in this file: null probe = no duration =
		// no billing basis. Everywhere else in video.ts a null means "carry on
		// without the enhancement"; here it must mean "stop".
		const reason = clipRejectionReason(4_000_000, 'video/mp4', null);
		expect(reason).toContain('Could not read');
	});

	it('rejects a clip longer than the per-second bill we are willing to quote', () => {
		const reason = clipRejectionReason(4_000_000, 'video/mp4', {
			...ok,
			durationSec: MAX_CLIP_SECONDS + 0.5
		});
		expect(reason).toContain('billed by the second');
		// The boundary is inclusive: exactly the cap is still a legal clip.
		expect(
			clipRejectionReason(4_000_000, 'video/mp4', { ...ok, durationSec: MAX_CLIP_SECONDS })
		).toBeNull();
	});

	it('rejects a sub-second stub', () => {
		expect(
			clipRejectionReason(4_000_000, 'video/mp4', { ...ok, durationSec: MIN_CLIP_SECONDS / 2 })
		).toContain('too short');
		expect(
			clipRejectionReason(4_000_000, 'video/mp4', { ...ok, durationSec: MIN_CLIP_SECONDS })
		).toBeNull();
	});

	it('rejects a frame too small to track a performer in', () => {
		expect(
			clipRejectionReason(4_000_000, 'video/mp4', { ...ok, width: MIN_CLIP_DIMENSION - 1 })
		).toContain('too small');
		expect(
			clipRejectionReason(4_000_000, 'video/mp4', { ...ok, height: MIN_CLIP_DIMENSION - 1 })
		).toContain('too small');
	});

	it('every rejection is a sentence a user can act on', () => {
		// These strings go straight into the upload UI, so an empty or a stack-trace
		// -shaped reason is a bug, not a cosmetic issue.
		const reasons = [
			clipRejectionReason(4_000_000, 'image/png', ok),
			clipRejectionReason(0, 'video/mp4', ok),
			clipRejectionReason(MAX_CLIP_BYTES + 1, 'video/mp4', ok),
			clipRejectionReason(4_000_000, 'video/mp4', null),
			clipRejectionReason(4_000_000, 'video/mp4', { ...ok, durationSec: 999 })
		];
		for (const r of reasons) {
			expect(typeof r === 'string' && r.length > 10 && r.endsWith('.')).toBe(true);
		}
	});
});

describe('probeVideo — never-throw contract', () => {
	// Not a media test: an unreadable path fails at the spawn or the exit, which
	// is the same code path a corrupt upload takes. On a host without ffprobe it
	// bails even earlier, at hasFfprobe. Either way the answer is null.
	it('returns null instead of throwing on a path that cannot be read', async () => {
		await expect(probeVideo('/definitely/not/a/file.mp4')).resolves.toBeNull();
	});

	it('returns null on an empty buffer without spawning anything', async () => {
		await expect(probeVideo(Buffer.alloc(0))).resolves.toBeNull();
	});

	it('returns null on bytes that are not a video', async () => {
		await expect(probeVideo(Buffer.from('this is not an mp4'))).resolves.toBeNull();
	});
});
