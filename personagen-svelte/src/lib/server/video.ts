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

async function hasFfmpeg(): Promise<boolean> {
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

function findFont(): string | null {
	if (env.UGC_FONT_FILE && existsSync(env.UGC_FONT_FILE)) return env.UGC_FONT_FILE;
	const candidates =
		process.platform === 'win32'
			? ['C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf']
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

function runFfmpeg(args: string[], cwd: string): Promise<void> {
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

/**
 * Stream-copies a video into a web-optimised mp4 (moov atom moved to the front,
 * a.k.a. `+faststart`) so a browser `<video>` can start showing/playing after a
 * tiny opening range request instead of pulling much of the file to find metadata
 * that providers often leave at the very end. This is the single biggest reason a
 * generated clip "takes forever to load" in the drawer.
 *
 * `-c copy` means NO re-encode — it just rewrites the container, so it's fast and
 * lossless. Returns the remuxed bytes, or null if ffmpeg is unavailable or the
 * remux failed (caller then persists the original clip unchanged). Videos that go
 * through burnCaptions already get +faststart there, so this only covers the
 * common no-overlay path.
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
	const hookText = (opts.hook || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 90);
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

		await runFfmpeg(
			['-y', '-i', inName, '-vf', filters.join(','), '-c:a', 'copy', '-movflags', '+faststart', outName],
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
