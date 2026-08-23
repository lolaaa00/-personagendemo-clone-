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

let ffmpegChecked = false;
let ffmpegOk = false;

function ffmpegBin(): string {
	return env.FFMPEG_PATH || 'ffmpeg';
}

export async function hasFfmpeg(): Promise<boolean> {
	if (ffmpegChecked) return ffmpegOk;
	ffmpegChecked = true;
	ffmpegOk = await new Promise((resolve) => {
		try {
			const p = spawn(ffmpegBin(), ['-version']);
			p.on('error', () => resolve(false));
			p.on('close', (code) => resolve(code === 0));
		} catch {
			resolve(false);
		}
	});
	return ffmpegOk;
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
/** Shared x264 delivery args: capped width, sane pixel format, faststart. */
function webEncodeArgs(extraFilters: string[] = []): string[] {
	// `\,` keeps the comma inside min() from splitting the filtergraph.
	const filters = [`scale=w=min(${WEB_MAX_WIDTH}\\,iw):h=-2`, ...extraFilters];
	return [
		'-vf',
		filters.join(','),
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
