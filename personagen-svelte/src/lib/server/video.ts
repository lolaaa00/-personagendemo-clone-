import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
// The quote and the ingest gate must clamp to the SAME clip length; $lib/formats
// owns that number because it is the module the client and server already share.
import { MAX_SECONDS, MIN_SECONDS } from '$lib/formats';

/**
 * Burns a hook caption, an optional timed caption track, and an "AI GENERATED"
 * badge onto a generated video using ffmpeg.
 *
 * Robust by design: if ffmpeg or a usable font isn't on the host, it returns null
 * and the caller keeps the un-captioned video — captions are an enhancement, never
 * a hard dependency. To avoid cross-platform path-escaping in ffmpeg filters, all
 * inputs (video, font, text) are copied into a temp dir and referenced relatively
 * with ffmpeg's cwd set to that dir.
 */

/**
 * The in-flight or completed probe. Caching the PROMISE rather than a boolean
 * is load-bearing: the previous version set a "checked" flag before awaiting,
 * so a second caller arriving during the first probe read the not-yet-assigned
 * `false` and was told ffmpeg was missing on a host that has it. Harmless when
 * the only consumer was an optional caption burn; not harmless now that whole
 * formats are offered or withheld on this answer.
 */
let ffmpegProbe: Promise<boolean> | null = null;

function ffmpegBin(): string {
	return env.FFMPEG_PATH || 'ffmpeg';
}

/**
 * Every asset download in this module goes through here, with a hard
 * PER-REQUEST deadline.
 *
 * Without one, a single hung socket stalls the caller forever: these run inside
 * scheduler ticks and detached generation tasks, which have no outer timeout of
 * their own, so a provider that accepts a connection and then never sends a byte
 * pins the task until the process restarts. Failing at 120s costs one clip;
 * hanging costs the queue. (content/generate.ts makes the same argument for its
 * own provider calls — this is that rule applied to the media fetches.)
 *
 * NEVER rename this to `fetch`. A module-level `const fetch` shadows the global,
 * and once the SSR bundle hoists modules into one scope another module's call to
 * the *global* fetch can bind to this local instead and recurse until the stack
 * blows — a failure already suffered once in this codebase, documented at
 * genFetch in content/generate.ts.
 */
const MEDIA_FETCH_TIMEOUT_MS = 120_000;

/**
 * A media URL the fetch layer can actually attempt. Every entry point below
 * takes URLs — storage links, provider results — and fetches them into a temp
 * dir before ffmpeg sees a file; none accepts a local path. Checking the shape
 * FIRST means a truncated storage link, a null coerced to "null" or a
 * user-supplied value returns the same null in microseconds, instead of after
 * the ffmpeg probe spawn and a temp dir it used to be queued behind. That
 * ordering is also what made the never-throw tests time out under CPU load:
 * the "instant" failure was waiting on a subprocess.
 */
export function isFetchableMediaUrl(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0) return false;
	try {
		const u = new URL(value);
		return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'data:';
	} catch {
		return false;
	}
}

function mediaFetch(url: string, init?: RequestInit): Promise<Response> {
	return fetch(url, {
		...init,
		// Caller headers win over the default UA, and the deadline is not
		// overridable — a call that opts out of it is the bug this exists to stop.
		headers: { 'User-Agent': 'Mozilla/5.0', ...(init?.headers ?? {}) },
		signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS)
	});
}

export async function hasFfmpeg(): Promise<boolean> {
	ffmpegProbe ??= new Promise<boolean>((resolve) => {
		try {
			const p = spawn(ffmpegBin(), ['-version']);
			p.on('error', () => resolve(false));
			p.on('close', (code) => resolve(code === 0));
		} catch {
			resolve(false);
		}
	});
	return ffmpegProbe;
}

export function findFont(): string | null {
	if (env.UGC_FONT_FILE && existsSync(env.UGC_FONT_FILE)) return env.UGC_FONT_FILE;
	const candidates =
		process.platform === 'win32'
			? [
					'C:/Windows/Fonts/arialbd.ttf',
					'C:/Windows/Fonts/arial.ttf',
					'C:/Windows/Fonts/segoeui.ttf'
				]
			: [
					// Alpine (our Docker runtime) — `font-dejavu` installs here.
					'/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
					'/usr/share/fonts/dejavu/DejaVuSans.ttf',
					// Debian / Ubuntu
					'/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
					'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
					'/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
					// Arch
					'/usr/share/fonts/TTF/DejaVuSans.ttf'
				];
	return candidates.find((f) => existsSync(f)) || null;
}

export function runFfmpeg(args: string[], cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const p = spawn(ffmpegBin(), args, { cwd });
		let err = '';
		p.stderr.on('data', (d) => (err += d.toString()));
		p.on('error', reject);
		p.on('close', (code) =>
			code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`))
		);
	});
}

/** ffmpeg drawtext escaping for short, static, single-quoted text (the badge). */
function escDrawtext(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

// ── Web-delivery encode settings ─────────────────────────────────────────────
// Providers hand back clips at absurd delivery bitrates for their size — Kling's
// 716×1284 output measures ~7.7 Mbps, i.e. ~5 MB for a FIVE-SECOND clip. Our
// self-hosted storage serves at a few hundred KB/s, so that encoding is the
// difference between "plays in 2s" and "minutes of spinner". A CRF re-encode at
// feed resolution lands ~4–6× smaller with no visible difference on a phone.
const WEB_MAX_WIDTH = 720; // never upscale — min(720, iw)
function webCrf(): number {
	const n = Number(env.UGC_VIDEO_CRF);
	return Number.isFinite(n) && n >= 18 && n <= 35 ? Math.round(n) : 27;
}
function compressionEnabled(): boolean {
	return env.UGC_VIDEO_COMPRESS !== 'false';
}
/**
 * The delivery scale filter on its own. `\,` keeps the comma inside min() from
 * splitting the filtergraph.
 */
const WEB_SCALE_FILTER = `scale=w=min(${WEB_MAX_WIDTH}\\,iw):h=-2`;
/**
 * The codec half of the delivery settings, with no `-vf` of its own. Split out
 * so the `-filter_complex` callers below can reuse the exact same encode: a
 * filtergraph and `-vf` are mutually exclusive on the same stream, so without
 * this split a second encoder-flag list would drift away from this one.
 */
function x264DeliveryArgs(): string[] {
	return [
		'-c:v',
		'libx264',
		'-crf',
		String(webCrf()),
		'-preset',
		'veryfast',
		'-pix_fmt',
		'yuv420p',
		'-movflags',
		'+faststart'
	];
}
/** Shared x264 delivery args: capped width, sane pixel format, faststart. */
function webEncodeArgs(extraFilters: string[] = []): string[] {
	return ['-vf', [WEB_SCALE_FILTER, ...extraFilters].join(','), ...x264DeliveryArgs()];
}

/**
 * Downloads a clip once and returns web-optimised mp4 bytes:
 *
 *   1. CRF re-encode at feed resolution (see webEncodeArgs) — typically 4–6×
 *      smaller than the provider master, which is what actually makes clips
 *      load fast over our un-CDN'd storage host.
 *   2. If the encode fails, or somehow isn't meaningfully smaller than the
 *      source (already-tiny clip), falls back to a lossless `-c copy`
 *      `+faststart` remux so the browser can still start playback off a small
 *      opening range request.
 *
 * Returns null when ffmpeg is missing or the source can't be fetched — the
 * caller then persists the original clip unchanged (correctness over
 * optimisation). Set UGC_VIDEO_COMPRESS=false to skip step 1 (remux only);
 * UGC_VIDEO_CRF tunes quality/size (default 27).
 */
export async function optimizeForWeb(
	videoUrl: string,
	extraHeaders?: Record<string, string>
): Promise<Buffer | null> {
	if (!(await hasFfmpeg())) return null;

	let dir: string | null = null;
	try {
		dir = await mkdtemp(join(tmpdir(), 'ugc-fs-'));
		const inName = 'in.mp4';

		const res = await mediaFetch(videoUrl, { headers: extraHeaders });
		if (!res.ok) return null;
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.length === 0) return null;
		await writeFile(join(dir, inName), buf);

		if (compressionEnabled()) {
			try {
				await runFfmpeg(
					['-y', '-i', inName, ...webEncodeArgs(), '-c:a', 'aac', '-b:a', '96k', 'enc.mp4'],
					dir
				);
				const enc = await readFile(join(dir, 'enc.mp4'));
				// Keep the encode only when it actually pays for itself.
				if (enc.length > 0 && enc.length < buf.length * 0.85) {
					console.log(
						`[Video] web encode ${(buf.length / 1e6).toFixed(1)}MB → ${(enc.length / 1e6).toFixed(1)}MB`
					);
					return enc;
				}
			} catch (e) {
				console.warn('[Video] web encode failed, falling back to remux:', (e as Error).message);
			}
		}

		await runFfmpeg(['-y', '-i', inName, '-c', 'copy', '-movflags', '+faststart', 'out.mp4'], dir);
		return await readFile(join(dir, 'out.mp4'));
	} catch (e) {
		console.warn('[Video] optimize skipped:', (e as Error).message);
		return null;
	} finally {
		if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

/**
 * Back-compat alias for the lossless-only path. Prefer optimizeForWeb, which
 * also compresses; kept because "remux faststart" is referenced by older docs
 * and scripts.
 */
export async function remuxFaststart(videoUrl: string): Promise<Buffer | null> {
	if (!(await hasFfmpeg())) return null;

	let dir: string | null = null;
	try {
		dir = await mkdtemp(join(tmpdir(), 'ugc-fs-'));
		const inName = 'in.mp4';
		const outName = 'out.mp4';

		const res = await mediaFetch(videoUrl);
		if (!res.ok) return null;
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.length === 0) return null;
		await writeFile(join(dir, inName), buf);

		await runFfmpeg(['-y', '-i', inName, '-c', 'copy', '-movflags', '+faststart', outName], dir);
		return await readFile(join(dir, outName));
	} catch (e) {
		console.warn('[Video] faststart remux skipped:', (e as Error).message);
		return null;
	} finally {
		if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

/** The font is always copied to this fixed name — see the module header. */
const CAPTION_FONT_NAME = 'font.ttf';
/** The hook's temp file. Fixed name; nothing user-supplied reaches a path. */
const HOOK_FILE_NAME = 'hook.txt';

/**
 * One line of the timed track: a label that appears at `at` and, unless `until`
 * ends it, stays for the rest of the clip.
 *
 * The omitted-`until` case is the whole reason this exists. The numbered
 * listicle — the format that outperforms everything else in short form — works
 * because the items ACCUMULATE: item 3 lands while 1 and 2 are still on screen,
 * so the viewer sees a list being built rather than a slideshow of single lines.
 * A caption that always disappears cannot express that, which is why "no end" is
 * the default rather than something a caller has to know to ask for.
 */
export interface TimedCaption {
	/** One short label, e.g. "1. Sunrise Stare". */
	text: string;
	/** Seconds from clip start when it appears. */
	at: number;
	/** Seconds when it disappears. Omitted = stays to the end, so a list ACCUMULATES. */
	until?: number;
}

export interface BurnCaptionsOptions {
	badge?: boolean;
	hook?: string;
	/** Optional timed track. Omit it and the render is byte-identical to before. */
	track?: TimedCaption[];
}

/**
 * What one caption render needs: the temp text files to write, and the filter
 * chain that reads them. Separated because the filters are pure (and therefore
 * testable without ffmpeg or a media file) while the files are I/O.
 */
export interface CaptionPlan {
	/** Written into the ffmpeg cwd before the run, in this order. */
	files: Array<{ name: string; text: string }>;
	/** drawbox/drawtext filters, in draw order. Empty = nothing was requested. */
	filters: string[];
}

/**
 * Type scale for a track item, as a divisor of the DELIVERY frame width: 720/15
 * = 48px. Derived rather than hardcoded so the block survives a change to
 * WEB_MAX_WIDTH — a fixed pixel size that is a third of the frame at 720 is a
 * caption at 2160.
 *
 * 48 is not a taste call. An earlier build set these at 31px against a 44px left
 * margin and the frames read as a footnote under the video — the eye went to the
 * subject and never to the list, which is the one thing the format exists to
 * deliver. The items ARE the content here (the hook is the framing), so they are
 * deliberately larger than the hook's 46, not smaller.
 */
const TRACK_FONT_DIVISOR = 15;
/**
 * Row pitch as a multiple of the item's own font size. 1.4 leaves a descender's
 * worth of air between rows: at 1.0 the heavy outlines of adjacent rows touch
 * and the block reads as a solid slab.
 */
const TRACK_ROW_PITCH = 1.4;
/** Clearance between the lowest row and the hook line, in item font sizes. */
const TRACK_HOOK_GAP = 0.5;

/**
 * How many items are ever drawn. A track is model-generated, so "how long is
 * it" is not a number we control: the cap is what stops a hallucinated 40-item
 * list from either running off the top of the frame or building a filtergraph
 * with 40 drawtext stages (each of which is a full-frame pass per frame). Six
 * rows is also about where a listicle stops being readable in a feed.
 */
export const MAX_TIMED_CAPTIONS = 6;

/**
 * Per-item character cap. drawtext does NOT wrap, so an over-long label is drawn
 * as one line running off both edges of the frame; truncating at least keeps the
 * beginning of it legible. Shorter than the hook's 90 because these are labels.
 */
const TRACK_MAX_CHARS = 60;

/**
 * Seconds as a filter-safe literal: clamped non-negative (a negative `t` bound
 * makes `between` never true) and rounded to milliseconds so a float artefact
 * like 1.2000000000000002 doesn't end up in the expression.
 */
function captionSeconds(n: unknown): number {
	const v = typeof n === 'number' ? n : Number(n);
	if (!Number.isFinite(v) || v <= 0) return 0;
	return Math.round(v * 1000) / 1000;
}

/**
 * Builds the caption filter chain and the temp files it reads.
 *
 * Pure and exported for the same reason buildMotionArgs is: every caption bug
 * this app has shipped was a wrong filter string, and asserting on the string
 * costs nothing while installing ffmpeg in CI costs a platform.
 *
 * `frameWidth` is the DELIVERY width the pixel coordinates will land on — the
 * scale filter runs first (see burnCaptions), so it is min(WEB_MAX_WIDTH, iw)
 * and WEB_MAX_WIDTH is the right default for anything at or above the cap.
 */
export function buildCaptionPlan(
	opts: BurnCaptionsOptions,
	frameWidth: number = WEB_MAX_WIDTH
): CaptionPlan {
	const files: CaptionPlan['files'] = [];
	const filters: string[] = [];

	if (opts.badge === true) {
		// "AI GENERATED" badge: translucent box + text, top-left
		filters.push('drawbox=x=22:y=26:w=196:h=46:color=black@0.55:t=fill');
		filters.push(
			`drawtext=fontfile=${CAPTION_FONT_NAME}:text='${escDrawtext('AI GENERATED')}':fontcolor=white:fontsize=22:x=38:y=38`
		);
	}

	const hookText = (opts.hook || '')
		.replace(/[\r\n]+/g, ' ')
		.trim()
		.slice(0, 90);
	if (hookText) {
		files.push({ name: HOOK_FILE_NAME, text: hookText });
		filters.push(
			`drawtext=fontfile=${CAPTION_FONT_NAME}:textfile=${HOOK_FILE_NAME}:fontcolor=white:fontsize=46:borderw=4:bordercolor=black@0.9:x=(w-text_w)/2:y=h-(h/5):line_spacing=8`
		);
	}

	// Normalise BEFORE laying out: the row maths is driven by how many items
	// actually get drawn, so a blank entry in the middle of a model's list must
	// not reserve a row and leave a hole in the stack.
	const items = (Array.isArray(opts.track) ? opts.track : [])
		.map((c) => ({
			// Newlines are stripped exactly as the hook strips them, and for a
			// harder reason: a literal newline inside a drawtext TEXTFILE is drawn
			// as a stray glyph box mid-line on a real render, not as a line break.
			text: String(c?.text ?? '')
				.replace(/[\r\n]+/g, ' ')
				.trim()
				.slice(0, TRACK_MAX_CHARS),
			at: captionSeconds(c?.at),
			until: c?.until
		}))
		.filter((c) => c.text.length > 0)
		// Order is the CALLER's, deliberately not sorted by `at`: the items are
		// numbered ("1.", "2.") and sorting would let a mistimed entry print its
		// number in the wrong row, which looks like our bug rather than theirs.
		.slice(0, MAX_TIMED_CAPTIONS);

	const fontSize = Math.max(12, Math.round(frameWidth / TRACK_FONT_DIVISOR));
	const rowPitch = Math.round(fontSize * TRACK_ROW_PITCH);
	const hookGap = Math.round(fontSize * TRACK_HOOK_GAP);

	items.forEach((item, i) => {
		// A per-item file, never interpolated text: the labels are model output,
		// so they carry whatever ':' , '\' or quote the model felt like emitting,
		// and textfile is the one drawtext input with no escaping surface at all.
		const name = `cap${i}.txt`;
		files.push({ name, text: item.text });

		// The block is anchored to the hook line and grows UPWARD, so row N-1 is
		// always the lowest. Top-anchoring is the obvious alternative and it
		// overflows: six 67px rows started at 2h/3 run off the bottom of a 1280-tall
		// delivery frame. Anchoring at the bottom means the row a viewer reads first
		// simply starts higher on a longer list, and nothing can ever leave frame.
		// The offset is a function of the item's INDEX, so no two rows can collide
		// however many there are.
		const offset = hookGap + (items.length - i) * rowPitch;

		// Quoted, not comma-escaped: inside '' ffmpeg takes every character
		// literally, so the `\,` form used by WEB_SCALE_FILTER would put a literal
		// backslash into the expression and fail to parse. Quoting is what keeps
		// the comma from splitting the filter chain.
		const enable =
			typeof item.until === 'number' &&
			Number.isFinite(item.until) &&
			captionSeconds(item.until) > item.at
				? `between(t,${item.at},${captionSeconds(item.until)})`
				: `gte(t,${item.at})`;

		filters.push(
			`drawtext=fontfile=${CAPTION_FONT_NAME}:textfile=${name}:fontcolor=white:fontsize=${fontSize}:borderw=6:bordercolor=black@0.92:x=(w-text_w)/2:y=h-(h/5)-${offset}:enable='${enable}'`
		);
	});

	return { files, filters };
}

/**
 * Returns captioned mp4 bytes, or null if captions couldn't be applied
 * (ffmpeg/font missing, or any failure — caller keeps the original).
 *
 * `hook` and `track` compose: a listicle is a framing line plus the items that
 * land under it as they are spoken.
 */
export async function burnCaptions(
	videoUrl: string,
	opts: BurnCaptionsOptions
): Promise<Buffer | null> {
	const plan = buildCaptionPlan(opts);
	// Nothing requested → don't re-encode; the caller keeps the clean original.
	if (plan.filters.length === 0) return null;
	if (!isFetchableMediaUrl(videoUrl)) return null;
	if (!(await hasFfmpeg())) return null;
	const font = findFont();
	if (!font) return null;

	let dir: string | null = null;
	try {
		dir = await mkdtemp(join(tmpdir(), 'ugc-'));
		const inName = 'in.mp4';
		const outName = 'out.mp4';

		const res = await mediaFetch(videoUrl);
		if (!res.ok) return null;
		await writeFile(join(dir, inName), Buffer.from(await res.arrayBuffer()));
		await copyFile(font, join(dir, CAPTION_FONT_NAME));

		for (const f of plan.files) await writeFile(join(dir, f.name), f.text, 'utf8');

		// The overlay pass re-encodes anyway, so encode straight to delivery
		// settings (capped width + CRF) — a full-bitrate captioned master would
		// undo everything optimizeForWeb buys. Scale runs FIRST so the drawtext
		// pixel coordinates land on the final frame size.
		await runFfmpeg(
			['-y', '-i', inName, ...webEncodeArgs(plan.filters), '-c:a', 'copy', outName],
			dir
		);
		return await readFile(join(dir, outName));
	} catch (e) {
		console.warn('[Video] caption burn-in skipped:', (e as Error).message);
		return null;
	} finally {
		if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

// ── Local assembly primitives ────────────────────────────────────────────────
// Two composer formats assemble locally instead of buying a clip from a video
// model: an *animated typographic card* (our own card-renderer still + a Ken
// Burns move) and *narrated product motion* (an existing b-roll clip + our TTS
// track). Both cost $0 and a couple of seconds of CPU where the model path
// costs cents and ~60s — which is exactly why they must never become a hard
// dependency. Same contract as everything above: null on any failure, the
// caller degrades to the paid path or to the un-enhanced asset.

/**
 * 9:16 master canvas for `stillToMotion`. Matches card-renderer.ts's
 * CANVAS_W/CANVAS_H exactly, so animating a card never resamples the
 * typography it was handed. The 720-wide delivery cap is deliberately NOT
 * applied here: `optimizeForWeb` owns that cap and runs on the stored asset, so
 * duplicating it would give us two places to change one number.
 */
const MOTION_W = 1080;
const MOTION_H = 1920;

/**
 * How far the Ken Burns move travels: a 12% push. Over a 5s clip that is
 * ~2.4%/s — present enough to read as motion in a feed, slow enough that it
 * never looks like a zoom transition.
 */
const MOTION_ZOOM = 0.12;

/**
 * Supersampling factor for the zoompan canvas. `zoompan` rounds its pan/crop
 * origin to WHOLE INPUT PIXELS every frame, so a 12% push across 150 frames on
 * a 1080-wide source only has ~130 distinct crop widths to walk through — the
 * infamous zoompan judder, where the image visibly snaps between steps. Zooming
 * on a 4x canvas makes one input pixel a quarter of an output pixel, which puts
 * the rounding error below the display grid and the move reads as smooth. 4 is
 * the smallest factor where the stepping stops being visible, and it costs one
 * scale of a SINGLE frame (zoompan synthesises every output frame from that one
 * input frame), not one per frame, so it is nearly free.
 */
const MOTION_SUPERSAMPLE = 4;

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

/**
 * Clip length in seconds. Reads UGC_VIDEO_DURATION — the same knob the paid
 * video path uses in content/generate.ts — so a locally assembled clip is the
 * same length as the model clip it replaces. Default 5.
 */
function defaultClipSeconds(): number {
	const n = parseInt(env.UGC_VIDEO_DURATION || '', 10);
	return Number.isFinite(n) && n > 0 ? n : 5;
}

export type MotionDirection = 'in' | 'out' | 'up' | 'down';

export interface StillToMotionOptions {
	/** Clip length. Default: UGC_VIDEO_DURATION, else 5. Clamped to 1–30s. */
	seconds?: number;
	/** Ken Burns move. Default 'in' (a slow push), the safest on any subject. */
	direction?: MotionDirection;
	/** Output frame rate. Default 30. Clamped to 12–60. */
	fps?: number;
	/**
	 * How a still that is not 9:16 is made to fit. Default 'cover'.
	 *
	 * 'cover' scales up until the frame is full and CENTER-CROPS the overflow;
	 * 'contain' fits the whole still and pads the remainder black. Cover is the
	 * default because (a) our own renderer already emits 1080x1920, so the crop
	 * is a no-op on the intended input and only engages for off-spec stills, and
	 * (b) in a vertical feed letterbox bars read as reposted, low-effort content
	 * and shrink the subject on the one screen size that matters. A caller
	 * feeding a landscape still that must survive intact passes 'contain'.
	 * Neither mode ever stretches: both go through force_original_aspect_ratio,
	 * so the source aspect is preserved in every case.
	 */
	fit?: 'cover' | 'contain';
}

/**
 * Pure ffmpeg-argument construction for `stillToMotion`, exported so the unit
 * suite can pin the flags without ffmpeg installed. Every bug this app has hit
 * in ffmpeg land was a wrong or missing flag, never a wrong encode.
 */
export function buildMotionArgs(
	inName: string,
	outName: string,
	opts: StillToMotionOptions = {}
): string[] {
	const seconds = clamp(opts.seconds ?? defaultClipSeconds(), 1, 30);
	const fps = Math.round(clamp(opts.fps ?? 30, 12, 60));
	const direction = opts.direction ?? 'in';
	const fit = opts.fit ?? 'cover';

	// zoompan emits exactly `d` frames per input frame; `d - 1` is the last frame
	// index, so the move reaches its end position ON the final frame rather than
	// one step short of it.
	const frames = Math.max(2, Math.round(seconds * fps));
	const last = frames - 1;

	const bigW = MOTION_W * MOTION_SUPERSAMPLE;
	const bigH = MOTION_H * MOTION_SUPERSAMPLE;
	const zMax = (1 + MOTION_ZOOM).toFixed(2);

	// Every expression is an explicit function of `on` (the output frame index).
	// The tempting shorthand — z='zoom+0.001', i.e. accumulate on the previous
	// frame's zoom — is the other classic zoompan bug: the accumulator is re-read
	// after rounding, so the move drifts and stutters and its end position
	// depends on the frame count. A closed form cannot drift.
	let z: string;
	let y: string;
	if (direction === 'in') {
		z = `1+${MOTION_ZOOM}*on/${last}`;
		y = 'ih/2-(ih/zoom/2)';
	} else if (direction === 'out') {
		z = `${zMax}-${MOTION_ZOOM}*on/${last}`;
		y = 'ih/2-(ih/zoom/2)';
	} else {
		// Vertical pans hold a fixed crop so the whole move is the travel; mixing
		// a push into a pan on a 5s clip reads as a wobble, not a camera move.
		z = zMax;
		// 'up' = the frame travels toward the top of the still (the subject drifts
		// down); 'down' is its mirror. ih-ih/zoom is the full available travel.
		y = direction === 'up' ? `(ih-ih/zoom)*(1-on/${last})` : `(ih-ih/zoom)*on/${last}`;
	}

	// Normalise onto the SUPERSAMPLED canvas directly rather than to 1080x1920
	// and then up: a 4K source would otherwise be thrown away and re-invented.
	const normalise =
		fit === 'cover'
			? [
					`scale=${bigW}:${bigH}:force_original_aspect_ratio=increase:flags=bicubic`,
					`crop=${bigW}:${bigH}`
				]
			: [
					`scale=${bigW}:${bigH}:force_original_aspect_ratio=decrease:flags=bicubic`,
					`pad=${bigW}:${bigH}:(ow-iw)/2:(oh-ih)/2:color=black`
				];

	const vf = [
		...normalise,
		// PNGs and phone JPEGs can carry a non-1 sample aspect ratio, which would
		// survive the scale and quietly stretch the output.
		'setsar=1',
		`zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='${y}':d=${frames}:s=${MOTION_W}x${MOTION_H}:fps=${fps}`,
		'format=yuv420p'
	].join(',');

	return [
		'-y',
		'-i',
		inName,
		'-vf',
		vf,
		// zoompan already yields exactly `frames`, but an animated PNG or a GIF
		// handed to us as a "still" decodes as many input frames and zoompan would
		// emit `d` frames for EACH of them. This caps it at the clip we asked for
		// instead of a multi-minute surprise.
		'-frames:v',
		String(frames),
		'-r',
		String(fps),
		// Silent by design — audio, if any, arrives later via muxVoiceover.
		'-an',
		...x264DeliveryArgs(),
		outName
	];
}

/**
 * Turns a single still into a short silent 9:16 mp4 with a slow Ken Burns move.
 * This is what makes an *animated* typographic card possible for $0: the card
 * is already typeset by our own renderer, and this puts it in motion with no AI
 * video model involved.
 *
 * Output is 1080x1920, H.264 / yuv420p / +faststart — the same encoder settings
 * every other clip in this app ships with (see x264DeliveryArgs).
 *
 * Returns null when ffmpeg is missing, or the still can't be fetched or
 * encoded; the caller then keeps the static image (or falls through to the paid
 * video path). It never throws.
 */
export async function stillToMotion(
	imageUrl: string,
	opts: StillToMotionOptions = {}
): Promise<Buffer | null> {
	if (!isFetchableMediaUrl(imageUrl)) return null;
	if (!(await hasFfmpeg())) return null;

	let dir: string | null = null;
	try {
		dir = await mkdtemp(join(tmpdir(), 'ugc-motion-'));
		// Extension-free on purpose: ffmpeg probes image formats by content, and
		// guessing the extension wrong (a JPEG our storage named .png) is the one
		// thing that could break that.
		const inName = 'still.img';
		const outName = 'out.mp4';

		const res = await mediaFetch(imageUrl);
		if (!res.ok) return null;
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.length === 0) return null;
		await writeFile(join(dir, inName), buf);

		await runFfmpeg(buildMotionArgs(inName, outName, opts), dir);
		return await readFile(join(dir, outName));
	} catch (e) {
		console.warn('[Video] still-to-motion skipped:', (e as Error).message);
		return null;
	} finally {
		if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

/**
 * Linear gain the clip's OWN audio is ducked to while the voiceover plays.
 * 0.25 is about -12 dB: the ambience stays audible as a bed instead of
 * disappearing, but never competes with speech. 1 = no ducking, 0 = silenced.
 */
const DEFAULT_DUCK = 0.25;

export interface MuxVoiceoverOptions {
	/**
	 * Which track decides the output length. Default 'audio'.
	 *
	 * 'audio'   — output is exactly as long as the narration: a short clip holds
	 *             its last frame, a long one is trimmed.
	 * 'video'   — output is exactly as long as the clip: narration is trimmed if
	 *             it overruns, silence-padded if it falls short.
	 * 'longest' — neither is truncated; whichever ends last ends the file.
	 */
	keep?: 'video' | 'audio' | 'longest';
	/** See DEFAULT_DUCK. Clamped to 0–1. Ignored when the clip has no audio. */
	duckOriginal?: number;
}

/** What a probe of the two inputs told us. `null` seconds = unreadable. */
export interface MuxSourceFacts {
	/** The clip carries an audio stream of its own (so there is a bed to duck). */
	hasAudio: boolean;
	videoSeconds: number | null;
	audioSeconds: number | null;
}

/**
 * THE DURATION POLICY, in one function.
 *
 * Default 'audio', because of which failure is worse in a feed: a clip that
 * ends mid-word never delivers the line it was made for and the viewer cannot
 * recover it, whereas a clip that outlives its narration merely wastes seconds.
 * So the narration is never cut by default, and the video is stretched to meet
 * it by cloning its last frame rather than running out and leaving the player
 * on black. A caller who would rather lose words than hold a frame passes
 * keep:'video'.
 *
 * Returns null when the probe couldn't read the length the policy needs — see
 * buildVoiceoverArgs, which then declines to bound the output at all.
 */
export function targetSeconds(
	facts: MuxSourceFacts,
	keep: 'video' | 'audio' | 'longest' = 'audio'
): number | null {
	const { videoSeconds: v, audioSeconds: a } = facts;
	if (keep === 'video') return v;
	if (keep === 'audio') return a;
	if (v === null) return a;
	if (a === null) return v;
	return Math.max(v, a);
}

/**
 * Pure ffmpeg-argument construction for `muxVoiceover`, exported for the unit
 * suite. The probe results are a parameter rather than something this function
 * gathers, so the two graphs that are easy to get fatally wrong — the one for a
 * clip with no audio stream, which must never name `[0:a]`, and the unbounded
 * fallback, which must never contain an infinite filter — are both directly
 * testable without a media file.
 */
export function buildVoiceoverArgs(
	videoName: string,
	audioName: string,
	outName: string,
	facts: MuxSourceFacts,
	opts: MuxVoiceoverOptions = {}
): string[] {
	const keep = opts.keep ?? 'audio';
	const duck = clamp(opts.duckOriginal ?? DEFAULT_DUCK, 0, 1);
	const target = targetSeconds(facts, keep);

	// `-t` is what enforces the duration policy, and it is also the ONLY thing
	// that can terminate the padding filters below, which are deliberately
	// infinite. `-shortest` looks like the natural fit here and is a trap: with
	// an endlessly-padding video filter it never fires, and ffmpeg encodes until
	// the disk fills. (Measured, not assumed — tpad stop=-1 with -shortest ran
	// past 5 minutes on a 5-second clip.) So when the probe couldn't give us a
	// length, we pad NOTHING and let the muxer end each stream naturally: a
	// slightly less polished join beats a hung render.
	const bounded = target !== null;

	const graph: string[] = [];
	if (bounded) {
		// stop=-1 clones the last frame forever; `-t` cuts it at the target. This
		// is what turns "the clip ran out before the sentence did" into a held end
		// frame instead of black.
		graph.push('[0:v]tpad=stop_mode=clone:stop=-1[vhold]');
	}
	graph.push(`[${bounded ? 'vhold' : '0:v'}]${WEB_SCALE_FILTER}[vout]`);

	if (facts.hasAudio) {
		// The clip's own audio is DUCKED, not dropped: b-roll models emit ambient
		// audio that is most of what makes a shot feel real, and replacing it with
		// a dry voice over silence sounds like a slideshow.
		graph.push(`[0:a]volume=${duck}[bed]`);
		graph.push('[1:a]volume=1[vo]');
		// normalize=0 is load-bearing: amix defaults to dividing every input by
		// the input count, which halves the voiceover and is the single most
		// common "why is my narration so quiet" bug in this filter.
		// duration=longest keeps the mix alive for whichever track runs longer;
		// the trimming is `-t`'s job, not amix's.
		graph.push(
			`[bed][vo]amix=inputs=2:duration=longest:normalize=0${bounded ? '[mix]' : '[aout]'}`
		);
		if (bounded) graph.push('[mix]apad[aout]');
	} else {
		// NO `[0:a]` ANYWHERE on this branch. A filtergraph naming a stream the
		// input does not have is a hard ffmpeg error at graph-configuration time —
		// the classic amix-on-a-silent-clip failure — so the reference cannot
		// merely go unused, it has to be absent. There is nothing to duck either.
		graph.push(bounded ? '[1:a]apad[aout]' : '[1:a]anull[aout]');
	}

	return [
		'-y',
		'-i',
		videoName,
		'-i',
		audioName,
		'-filter_complex',
		graph.join(';'),
		'-map',
		'[vout]',
		'-map',
		'[aout]',
		...x264DeliveryArgs(),
		// The same audio settings optimizeForWeb ships: 96k AAC is transparent for
		// speech over a bed at feed volume.
		'-c:a',
		'aac',
		'-b:a',
		'96k',
		...(bounded ? ['-t', (target as number).toFixed(3)] : []),
		outName
	];
}

/**
 * Reads a file's length and whether it has an audio stream, in one spawn of the
 * one binary we already depend on. ffprobe is a SEPARATE executable that the
 * FFMPEG_PATH override would not point at, so assuming it exists would quietly
 * break exactly the hosts that needed the override; `ffmpeg -i` with no output
 * file prints the same header, exits non-zero, and costs the same ~50ms.
 *
 * Everything about it fails soft: an unparseable header yields
 * `{ hasAudio: false, seconds: null }`, and each of those is the conservative
 * answer — no audio means the filtergraph can't reference a stream that isn't
 * there, and no duration means we decline to pad rather than risk an unbounded
 * encode.
 */
async function probeMedia(
	dir: string | undefined,
	fileName: string
): Promise<{ hasAudio: boolean; seconds: number | null }> {
	const text = await new Promise<string>((resolve) => {
		try {
			// `dir` is optional so a caller holding an absolute path or a URL — as
			// probeAudioSeconds does — need not invent a temp directory just to
			// satisfy a cwd it will never use.
			const p = spawn(ffmpegBin(), ['-hide_banner', '-i', fileName], dir ? { cwd: dir } : {});
			let err = '';
			p.stderr.on('data', (d) => (err += d.toString()));
			p.on('error', () => resolve(''));
			p.on('close', () => resolve(err));
		} catch {
			resolve('');
		}
	});

	const m = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(text);
	let seconds: number | null = null;
	if (m) {
		const n = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
		// "Duration: N/A" doesn't match at all; a zero-length read is still junk.
		if (Number.isFinite(n) && n > 0) seconds = n;
	}
	return { hasAudio: /Stream #\d+:\d+.*: Audio:/.test(text), seconds };
}

/**
 * Lays a voiceover under an existing clip and returns the muxed mp4 bytes — the
 * "narrated product motion" format: our TTS stage plus b-roll we already
 * generated, joined locally instead of paying for a talking-head model.
 *
 * Length defaults to the narration's (see MuxVoiceoverOptions.keep) and the
 * clip's own audio is ducked under the voice rather than dropped. Re-encodes
 * with the same delivery settings as every other clip here, +faststart.
 *
 * Returns null when ffmpeg is missing, either input can't be fetched, or the
 * mux fails — the caller then keeps the un-narrated clip. It never throws.
 */
export async function muxVoiceover(
	videoUrl: string,
	audioUrl: string,
	opts: MuxVoiceoverOptions = {}
): Promise<Buffer | null> {
	if (!isFetchableMediaUrl(videoUrl) || !isFetchableMediaUrl(audioUrl)) return null;
	if (!(await hasFfmpeg())) return null;

	let dir: string | null = null;
	try {
		dir = await mkdtemp(join(tmpdir(), 'ugc-vo-'));
		const videoName = 'in.mp4';
		// Extension-free for the same reason as stillToMotion: our TTS providers
		// hand back mp3, wav or m4a and ffmpeg probes by content anyway.
		const audioName = 'vo.audio';
		const outName = 'out.mp4';

		// Fetched one at a time, not under Promise.all: when both fetches reject,
		// Promise.all reports the first and leaves the second unhandled.
		const vRes = await mediaFetch(videoUrl);
		if (!vRes.ok) return null;
		const vBuf = Buffer.from(await vRes.arrayBuffer());
		if (vBuf.length === 0) return null;

		const aRes = await mediaFetch(audioUrl);
		if (!aRes.ok) return null;
		const aBuf = Buffer.from(await aRes.arrayBuffer());
		if (aBuf.length === 0) return null;

		await writeFile(join(dir, videoName), vBuf);
		await writeFile(join(dir, audioName), aBuf);

		// Both probes run before the encode because the duration policy — and,
		// more importantly, whether the padding filters are safe to use at all —
		// depends on knowing how long each side is.
		const v = await probeMedia(dir, videoName);
		const a = await probeMedia(dir, audioName);
		const facts: MuxSourceFacts = {
			hasAudio: v.hasAudio,
			videoSeconds: v.seconds,
			audioSeconds: a.seconds
		};

		await runFfmpeg(buildVoiceoverArgs(videoName, audioName, outName, facts, opts), dir);
		return await readFile(join(dir, outName));
	} catch (e) {
		console.warn('[Video] voiceover mux skipped:', (e as Error).message);
		return null;
	} finally {
		if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

// ── Audio assembly ───────────────────────────────────────────────────────────
// A format that must SHOW something at the moment it is SAID cannot guess where
// that moment is; it has to speak one clip per beat and measure them. That
// leaves a caller holding N audio files it needs as one track, plus the far more
// valuable question "when does beat 3 start?". Both belong here, because the
// answer is a temp dir and an ffmpeg decode, and this module is the only place
// in the app that is allowed to know that — the listicle's first implementation
// pulled node:fs/os/path into content/generate.ts to do it by hand.

/**
 * Length of an AUDIO file in seconds — the measurement `probeVideo` structurally
 * cannot give.
 *
 * `probeVideo` selects the first stream with `codec_type === 'video'` and
 * returns null without one, so it reports "unreadable" for every speech-only
 * file handed to it. That is right for its own caller (a clip we cannot see is
 * not a clip we can bill for) and useless to anyone measuring narration.
 *
 * Deliberately narrower than exporting the internal `probeMedia`: that one takes
 * a directory plus a RELATIVE name — a shape only the temp-dir helpers in this
 * file produce — and answers a second question (`hasAudio`) that exists purely
 * to stop a filtergraph naming a stream the input lacks. This signature instead
 * matches `probeVideo`: path/URL or Buffer in, one number or null out.
 *
 * Null when ffmpeg is missing, the bytes are unreadable, or the file carries no
 * audio stream at all. That last case is deliberate: a container duration for a
 * file with nothing to hear is not a length anything here should time against.
 */
export async function probeAudioSeconds(input: string | Buffer): Promise<number | null> {
	if (!(await hasFfmpeg())) return null;

	let dir: string | null = null;
	try {
		// Extension-free, as in stillToMotion: ffmpeg detects the container by
		// content, and a guessed extension is the only thing that could confuse it.
		const target = Buffer.isBuffer(input) ? 'in.audio' : input;
		if (Buffer.isBuffer(input)) {
			if (input.length === 0) return null;
			dir = await mkdtemp(join(tmpdir(), 'ugc-aprobe-'));
			await writeFile(join(dir, target), input);
		} else if (!input) return null;

		const { hasAudio, seconds } = await probeMedia(dir ?? undefined, target);
		return hasAudio ? seconds : null;
	} catch (e) {
		console.warn('[Video] audio probe failed:', (e as Error).message);
		return null;
	} finally {
		if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

/**
 * The intermediate every join passes through: signed 16-bit little-endian mono
 * at 24 kHz.
 *
 * Raw PCM is what makes the returned timings EXACT rather than estimated —
 * length is bytes / (rate x 2), with no container header to skip, no VBR frame
 * table to trust and no second spawn to pay for. Nothing else available here is
 * good enough: an mp3's own header duration is a guess the encoder wrote, and
 * probeAudioSeconds above reads ffmpeg's `Duration:` line, which is rounded to
 * centiseconds. A hundredth of a second per beat compounds down a list until the
 * last reveal is visibly late.
 */
const CONCAT_PCM_RATE = 24000;
const CONCAT_PCM_BYTES_PER_SEC = CONCAT_PCM_RATE * 2;
/**
 * Silence between beats. Long enough to read as a deliberate break before the
 * next item, short enough that a five-item list does not gain two seconds of
 * dead air it is paying lip-sync render time for.
 */
const DEFAULT_CONCAT_GAP_SEC = 0.35;
/** Above this a "gap" is a bug in the caller, not a pause. */
const MAX_CONCAT_GAP_SEC = 2;

export interface ConcatAudioOptions {
	/**
	 * Silence inserted BETWEEN segments — never before the first or after the
	 * last, so the track starts on the word. Clamped to 0–2s, rounded to whole
	 * samples, defaults to 0.35s.
	 */
	gapSeconds?: number;
}

/** The joined track and, inseparably, where everything in it landed. */
export interface ConcatenatedAudio {
	/** The encoded m4a. */
	bytes: Buffer;
	/** Each segment's own length in seconds, in input order. */
	seconds: number[];
	/**
	 * The offset at which each segment BEGINS in the joined track — the thing a
	 * caption track is timed against, and the reason a caller asked for a join
	 * instead of a concat filter. Returned WITH the bytes because only this
	 * function knows where the gaps went; handing back audio alone would send the
	 * caller off to measure a file we just measured, worse.
	 */
	startsAt: number[];
}

/**
 * The timeline, from decoded byte counts. Pure and exported because this is the
 * arithmetic that is easy to get wrong and impossible to SEE wrong: the gap
 * belongs before every segment but the first, and it has to reach the cursor
 * BEFORE that segment's start is recorded. Add it after and every start from the
 * second on is one gap early, compounding down the list — which presents as
 * "the captions drift", not as an off-by-one.
 */
export function planAudioTimeline(
	pcmByteLengths: number[],
	gapSeconds?: number
): { gapBytes: number; seconds: number[]; startsAt: number[] } {
	const requested = Number.isFinite(gapSeconds as number)
		? (gapSeconds as number)
		: DEFAULT_CONCAT_GAP_SEC;
	// Whole SAMPLES, not bytes. An odd byte count shears every following sample
	// by one byte and turns the remainder of the track into white noise.
	const gapBytes = Math.round(clamp(requested, 0, MAX_CONCAT_GAP_SEC) * CONCAT_PCM_RATE) * 2;
	const seconds: number[] = [];
	const startsAt: number[] = [];
	let cursor = 0;
	for (let i = 0; i < pcmByteLengths.length; i++) {
		if (i > 0) cursor += gapBytes / CONCAT_PCM_BYTES_PER_SEC;
		startsAt.push(cursor);
		const s = Math.max(0, pcmByteLengths[i] ?? 0) / CONCAT_PCM_BYTES_PER_SEC;
		seconds.push(s);
		cursor += s;
	}
	return { gapBytes, seconds, startsAt };
}

/**
 * Decode one segment to the raw intermediate. `-vn` is not decorative: several
 * TTS providers embed cover art, and a video stream reaching a headerless s16le
 * muxer is written straight into the sample data as noise.
 */
export function buildPcmDecodeArgs(inName: string, outName: string): string[] {
	return [
		'-y',
		'-i',
		inName,
		'-vn',
		'-ac',
		'1',
		'-ar',
		String(CONCAT_PCM_RATE),
		'-f',
		's16le',
		outName
	];
}

/**
 * Encode the joined PCM.
 *
 * AAC through ffmpeg's NATIVE encoder, never libmp3lame: mp3 encoding needs an
 * external library our Alpine runtime is not guaranteed to carry, so an mp3
 * output fails on the deploy host and nowhere a developer would ever see it.
 *
 * The `-f s16le -ar -ac` triple must come BEFORE `-i`. Raw PCM has no header, so
 * ffmpeg cannot infer any of it and falls back to 44.1 kHz stereo — which does
 * not error, it just plays the narration fast, chipmunked, and out of sync with
 * every offset we measured.
 */
export function buildPcmEncodeArgs(inName: string, outName: string): string[] {
	return [
		'-y',
		'-f',
		's16le',
		'-ar',
		String(CONCAT_PCM_RATE),
		'-ac',
		'1',
		'-i',
		inName,
		'-c:a',
		'aac',
		'-b:a',
		'128k',
		outName
	];
}

/**
 * Fetches audio segments, joins them with a controlled silence gap, and returns
 * the encoded bytes together with each segment's length and start offset.
 *
 * Returns null on ANY failure and never throws — no ffmpeg, an unfetchable or
 * empty segment, a decode that produced nothing. The caller is expected to fall
 * back to whatever un-segmented audio it can still produce, because a talking
 * head with no reveals ships and a thrown error does not.
 */
export async function concatAudio(
	urls: string[],
	opts: ConcatAudioOptions = {}
): Promise<ConcatenatedAudio | null> {
	if (urls.length === 0) return null;
	if (!urls.every(isFetchableMediaUrl)) return null;
	if (!(await hasFfmpeg())) return null;

	let dir: string | null = null;
	try {
		dir = await mkdtemp(join(tmpdir(), 'ugc-concat-'));
		const pcms: Buffer[] = [];
		for (let i = 0; i < urls.length; i++) {
			// One at a time, not under Promise.all: when several fetches reject,
			// Promise.all reports the first and leaves the rest unhandled.
			const res = await mediaFetch(urls[i]);
			if (!res.ok) return null;
			const buf = Buffer.from(await res.arrayBuffer());
			if (buf.length === 0) return null;
			const inName = `seg${i}.audio`;
			const pcmName = `seg${i}.pcm`;
			await writeFile(join(dir, inName), buf);
			await runFfmpeg(buildPcmDecodeArgs(inName, pcmName), dir);
			const pcm = await readFile(join(dir, pcmName));
			// A zero-length decode is a hard stop, not a segment to skip: dropping it
			// would remove words from the middle of the track while every LATER start
			// stayed where it was, so the whole tail fires against speech that moved.
			if (pcm.length === 0) return null;
			pcms.push(pcm);
		}

		const plan = planAudioTimeline(
			pcms.map((p) => p.length),
			opts.gapSeconds
		);
		const gap = Buffer.alloc(plan.gapBytes);
		const joined: Buffer[] = [];
		for (let i = 0; i < pcms.length; i++) {
			if (i > 0) joined.push(gap);
			joined.push(pcms[i]);
		}

		const joinedName = 'joined.pcm';
		const outName = 'out.m4a';
		await writeFile(join(dir, joinedName), Buffer.concat(joined));
		await runFfmpeg(buildPcmEncodeArgs(joinedName, outName), dir);
		const bytes = await readFile(join(dir, outName));
		if (bytes.length === 0) return null;
		return { bytes, seconds: plan.seconds, startsAt: plan.startsAt };
	} catch (e) {
		console.warn('[Video] audio concat skipped:', (e as Error).message);
		return null;
	} finally {
		if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

// ── Source-clip ingest ───────────────────────────────────────────────────────
// The video-to-video formats (see $lib/formats: 'reel-remake', 'motion-transfer')
// re-perform a clip the USER supplies. fal's wan animate models bill per output
// SECOND, so the clip's length is not metadata — it is the multiplier on the
// bill. Everything below exists so that a clip is never stored, quoted or sent
// without a measured duration behind it.

/**
 * ffprobe is a SEPARATE executable from ffmpeg, so a host that needed
 * FFMPEG_PATH would break here if we just spawned a bare 'ffprobe'. Order:
 * explicit FFPROBE_PATH, else the sibling of the configured ffmpeg (they ship
 * in the same directory in every distribution and every static build), else the
 * bare name off PATH.
 *
 * Exported so the unit suite can pin the derivation — the sibling rule is the
 * only part of this file that can silently point at a binary that isn't there.
 */
export function ffprobeBin(): string {
	if (env.FFPROBE_PATH) return env.FFPROBE_PATH;
	const configured = env.FFMPEG_PATH;
	if (configured) {
		// Only the trailing basename is rewritten: a path like
		// /opt/ffmpeg-builds/ffmpeg/bin/ffmpeg must not have its DIRECTORY renamed.
		const m = /^(.*[\\/])?ffmpeg(\.exe)?$/i.exec(configured);
		if (m) return `${m[1] ?? ''}ffprobe${m[2] ?? ''}`;
	}
	return 'ffprobe';
}

/**
 * Same memoised-PROMISE pattern as hasFfmpeg, for the same reason: a boolean
 * flag set before the await lets a concurrent caller read the not-yet-assigned
 * `false` and conclude the host cannot ingest video when it can. Here that
 * mistake costs more than it did for captions — it does not degrade one clip,
 * it withholds a whole format from the composer.
 */
let ffprobeProbe: Promise<boolean> | null = null;

export async function hasFfprobe(): Promise<boolean> {
	ffprobeProbe ??= new Promise<boolean>((resolve) => {
		try {
			const p = spawn(ffprobeBin(), ['-version']);
			p.on('error', () => resolve(false));
			p.on('close', (code) => resolve(code === 0));
		} catch {
			resolve(false);
		}
	});
	return ffprobeProbe;
}

export interface VideoProbe {
	/** Wall-clock length. THE BILLING BASIS for the per-second video models. */
	durationSec: number;
	/** Display dimensions — rotation already applied (see probeVideo). */
	width: number;
	height: number;
}

/** Reads ffprobe's JSON report, or null if the spawn or the exit failed. */
function runFfprobeJson(target: string, cwd?: string): Promise<string | null> {
	return new Promise((resolve) => {
		try {
			// `-i` rather than a positional argument: a filename beginning with a
			// dash would otherwise be parsed as an option.
			const p = spawn(
				ffprobeBin(),
				['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-i', target],
				cwd ? { cwd } : {}
			);
			let out = '';
			p.stdout.on('data', (d) => (out += d.toString()));
			// stderr is drained but ignored: `-v error` keeps it empty on success, and
			// an unread pipe can fill and stall the child on a chatty build.
			p.stderr.on('data', () => {});
			p.on('error', () => resolve(null));
			p.on('close', (code) => resolve(code === 0 ? out : null));
		} catch {
			resolve(null);
		}
	});
}

function finitePositive(v: unknown): number | null {
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Rotation in degrees, from either place ffprobe reports it: the modern
 * `side_data_list` displaymatrix entry, or the legacy `tags.rotate` string that
 * older muxers (and plenty of Android phones) still write.
 */
function clipRotationDegrees(stream: Record<string, unknown>): number {
	const sideData = stream.side_data_list;
	if (Array.isArray(sideData)) {
		for (const entry of sideData) {
			const raw = Number((entry as Record<string, unknown>)?.rotation);
			if (Number.isFinite(raw) && raw !== 0) return raw;
		}
	}
	const tags = stream.tags as Record<string, unknown> | undefined;
	const legacy = Number(tags?.rotate);
	return Number.isFinite(legacy) ? legacy : 0;
}

/**
 * Measures a clip: length in seconds and DISPLAY dimensions.
 *
 * Accepts a Buffer (an upload still in memory — written to a temp dir and
 * cleaned up in `finally`, like every other helper here) or a path/URL string.
 *
 * Returns null on any failure and NEVER throws — but this is the one place in
 * this file where the caller must not shrug that off. Captions, card motion and
 * the voiceover mux are enhancements, so null there means "keep the original".
 * A null HERE means the duration is unknown, and the duration is what the
 * per-second video models bill on: storing the clip anyway would let a run be
 * quoted at a length nobody measured. The ingest route therefore treats null as
 * "reject the upload", never as "carry on without it".
 */
export async function probeVideo(input: string | Buffer): Promise<VideoProbe | null> {
	if (!(await hasFfprobe())) return null;

	let dir: string | null = null;
	try {
		let target: string;
		let cwd: string | undefined;
		if (Buffer.isBuffer(input)) {
			if (input.length === 0) return null;
			dir = await mkdtemp(join(tmpdir(), 'ugc-probe-'));
			// Extension-free on purpose, as in stillToMotion: ffprobe detects the
			// container by content, and a wrong extension is the only thing that
			// could confuse it about a file it would otherwise read fine.
			target = 'in.video';
			cwd = dir;
			await writeFile(join(dir, target), input);
		} else {
			if (!input) return null;
			target = input;
		}

		const raw = await runFfprobeJson(target, cwd);
		if (!raw) return null;
		const report = JSON.parse(raw) as {
			format?: { duration?: string | number };
			streams?: Array<Record<string, unknown>>;
		};

		const streams = Array.isArray(report.streams) ? report.streams : [];
		// The first VIDEO stream, not streams[0]: a phone clip carries audio, and
		// often timecode and a cover-art stream, in no guaranteed order.
		const v = streams.find((s) => s.codec_type === 'video');
		if (!v) return null;

		// Container duration first — a stream's own `duration` is absent in
		// fragmented mp4 and in WebM, where only the container knows the length.
		const durationSec = finitePositive(report.format?.duration) ?? finitePositive(v.duration);
		const width = finitePositive(v.width);
		const height = finitePositive(v.height);
		if (durationSec === null || width === null || height === null) return null;

		// Phones record LANDSCAPE frames plus a rotation matrix; the stream is
		// 1920x1080 and every player shows it 1080x1920. Reporting the stored
		// dimensions would tell the composer a portrait clip is a landscape one,
		// and the run would be framed for the wrong aspect.
		const quarterTurn = Math.abs(clipRotationDegrees(v)) % 180 === 90;

		return {
			durationSec,
			width: Math.round(quarterTurn ? height : width),
			height: Math.round(quarterTurn ? width : height)
		};
	} catch (e) {
		console.warn('[Video] probe failed:', (e as Error).message);
		return null;
	} finally {
		if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

// ── Ingest policy ────────────────────────────────────────────────────────────
// The bounds and the verdict for the source-clip upload route. They live here,
// beside the probe that produces the numbers they judge, rather than in the
// `+server.ts`: a route module cannot be imported by the unit suite (it pulls
// `./$types` and the whole db/service-supabase chain into a node test), and a
// bound that gates SPENDING is the last thing that should go unpinned.

/**
 * 100MB. Generous enough for 30s off a modern phone (4K HEVC lands ~60-80MB)
 * and small enough that a mistaken 4GB screen recording is refused from its
 * declared size instead of after we have buffered all of it into memory.
 */
export const MAX_CLIP_BYTES = 100 * 1024 * 1024;

/**
 * 30s. A ceiling on the BILL, not on taste: the v2v models charge per output
 * second, so this is the only thing bounding what a single click can cost. It
 * also sits past the length a feed actually watches.
 */
export const MAX_CLIP_SECONDS = MAX_SECONDS;

/**
 * 1s. Below this there is nothing to re-perform, and a sub-second upload is
 * almost always a truncated or corrupt file that probed just well enough to
 * look valid.
 */
export const MIN_CLIP_SECONDS = MIN_SECONDS;

/**
 * Smallest side we will accept. Under this the source carries less detail than
 * the model needs to track a performer at all, and the output is mush that was
 * still billed by the second.
 */
export const MIN_CLIP_DIMENSION = 128;

/**
 * Accepted containers, mapped to the extension the stored object gets. An
 * allowlist by CONTAINER rather than a `startsWith('video/')` check because
 * these are what fal's animate endpoints reliably decode; an .avi or .mkv would
 * upload happily and then fail at the provider — after the quote.
 *
 * `video/x-m4v` and the `video/mov` some browsers report are aliases, not
 * separate formats: both are mp4/QuickTime on the wire.
 */
export const ACCEPTED_CLIP_MIME: Record<string, string> = {
	'video/mp4': 'mp4',
	'video/x-m4v': 'm4v',
	'video/quicktime': 'mov',
	'video/mov': 'mov',
	'video/webm': 'webm'
};

/**
 * The stored extension for an upload's mime type, or null when we don't accept
 * it. Browsers append codec parameters (`video/mp4; codecs="avc1.42E01E"`), so
 * the type is normalised before the lookup — matching on the raw header string
 * rejects perfectly good Chrome uploads.
 */
export function clipExtForMime(mimeType: string | null | undefined): string | null {
	if (typeof mimeType !== 'string') return null;
	const base = mimeType.split(';')[0].trim().toLowerCase();
	return ACCEPTED_CLIP_MIME[base] ?? null;
}

/**
 * The whole validation verdict for one upload: a human-readable reason to
 * refuse it, or null when it may be stored. Pure and exported so the bounds
 * that gate spending are held by tests rather than by review.
 *
 * `probe` is null when ffprobe could not read the file — see probeVideo. An
 * unmeasured clip is refused, never stored on trust.
 */
export function clipRejectionReason(
	bytes: number,
	mimeType: string | null | undefined,
	probe: VideoProbe | null
): string | null {
	if (!clipExtForMime(mimeType)) {
		return 'That file type is not supported. Upload an MP4, MOV or WebM clip.';
	}
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return 'That file is empty.';
	}
	if (bytes > MAX_CLIP_BYTES) {
		return `That clip is too large (max ${Math.round(MAX_CLIP_BYTES / (1024 * 1024))}MB).`;
	}
	if (!probe) {
		return 'Could not read that video file. Re-export it as an MP4 (H.264) and try again.';
	}
	if (probe.durationSec > MAX_CLIP_SECONDS) {
		return `That clip is ${probe.durationSec.toFixed(1)}s. Trim it to ${MAX_CLIP_SECONDS}s or less — this format is billed by the second.`;
	}
	if (probe.durationSec < MIN_CLIP_SECONDS) {
		return `That clip is too short (minimum ${MIN_CLIP_SECONDS}s).`;
	}
	if (probe.width < MIN_CLIP_DIMENSION || probe.height < MIN_CLIP_DIMENSION) {
		return `That clip is too small to re-perform (minimum ${MIN_CLIP_DIMENSION}px on each side).`;
	}
	return null;
}
