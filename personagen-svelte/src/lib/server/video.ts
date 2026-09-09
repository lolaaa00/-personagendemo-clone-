import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';

/**
 * Burns a hook caption + "AI GENERATED" badge onto a generated video using ffmpeg.
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

		const res = await fetch(videoUrl, {
			headers: { 'User-Agent': 'Mozilla/5.0', ...(extraHeaders || {}) }
		});
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

		const res = await fetch(videoUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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

/**
 * Returns captioned mp4 bytes, or null if captions couldn't be applied
 * (ffmpeg/font missing, or any failure — caller keeps the original).
 */
export async function burnCaptions(
	videoUrl: string,
	opts: { badge?: boolean; hook?: string }
): Promise<Buffer | null> {
	const wantBadge = opts.badge === true;
	const hookText = (opts.hook || '')
		.replace(/[\r\n]+/g, ' ')
		.trim()
		.slice(0, 90);
	// Nothing requested → don't re-encode; the caller keeps the clean original.
	if (!wantBadge && !hookText) return null;
	if (!(await hasFfmpeg())) return null;
	const font = findFont();
	if (!font) return null;

	let dir: string | null = null;
	try {
		dir = await mkdtemp(join(tmpdir(), 'ugc-'));
		const inName = 'in.mp4';
		const outName = 'out.mp4';
		const fontName = 'font.ttf';
		const hookName = 'hook.txt';

		const res = await fetch(videoUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
		if (!res.ok) return null;
		await writeFile(join(dir, inName), Buffer.from(await res.arrayBuffer()));
		await copyFile(font, join(dir, fontName));

		const filters: string[] = [];
		if (wantBadge) {
			// "AI GENERATED" badge: translucent box + text, top-left
			filters.push('drawbox=x=22:y=26:w=196:h=46:color=black@0.55:t=fill');
			filters.push(
				`drawtext=fontfile=${fontName}:text='${escDrawtext('AI GENERATED')}':fontcolor=white:fontsize=22:x=38:y=38`
			);
		}
		if (hookText) {
			await writeFile(join(dir, hookName), hookText, 'utf8');
			filters.push(
				`drawtext=fontfile=${fontName}:textfile=${hookName}:fontcolor=white:fontsize=46:borderw=4:bordercolor=black@0.9:x=(w-text_w)/2:y=h-(h/5):line_spacing=8`
			);
		}

		// The overlay pass re-encodes anyway, so encode straight to delivery
		// settings (capped width + CRF) — a full-bitrate captioned master would
		// undo everything optimizeForWeb buys. Scale runs FIRST so the drawtext
		// pixel coordinates land on the final frame size.
		await runFfmpeg(['-y', '-i', inName, ...webEncodeArgs(filters), '-c:a', 'copy', outName], dir);
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
	if (!(await hasFfmpeg())) return null;

	let dir: string | null = null;
	try {
		dir = await mkdtemp(join(tmpdir(), 'ugc-motion-'));
		// Extension-free on purpose: ffmpeg probes image formats by content, and
		// guessing the extension wrong (a JPEG our storage named .png) is the one
		// thing that could break that.
		const inName = 'still.img';
		const outName = 'out.mp4';

		const res = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
	dir: string,
	fileName: string
): Promise<{ hasAudio: boolean; seconds: number | null }> {
	const text = await new Promise<string>((resolve) => {
		try {
			const p = spawn(ffmpegBin(), ['-hide_banner', '-i', fileName], { cwd: dir });
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
		const vRes = await fetch(videoUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
		if (!vRes.ok) return null;
		const vBuf = Buffer.from(await vRes.arrayBuffer());
		if (vBuf.length === 0) return null;

		const aRes = await fetch(audioUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
