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
					'/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
					'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
					'/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
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
 * Returns captioned mp4 bytes, or null if captions couldn't be applied
 * (ffmpeg/font missing, or any failure — caller keeps the original).
 */
export async function burnCaptions(videoUrl: string, hook: string): Promise<Buffer | null> {
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

		const hookText = (hook || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 90);
		const filters = [
			// "AI GENERATED" badge: translucent box + text, top-left
			'drawbox=x=22:y=26:w=196:h=46:color=black@0.55:t=fill',
			`drawtext=fontfile=${fontName}:text='${escDrawtext('AI GENERATED')}':fontcolor=white:fontsize=22:x=38:y=38`
		];
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
