/**
 * One-time backfill: re-encode already-generated video posts down to web
 * delivery size. Provider masters come in at ~7–8 Mbps (≈5 MB for a 5-second
 * clip); our self-hosted storage serves a few hundred KB/s, so those clips take
 * tens of seconds to minutes to load. A CRF re-encode at feed resolution is
 * ~4–6× smaller with no visible difference on a phone feed — that's the whole
 * fix.
 *
 * This does NOT regenerate anything — no model spend. It downloads each
 * existing clip, re-encodes it (scale ≤720w, CRF 27, AAC 96k, +faststart),
 * uploads the result as a fresh object, and repoints the post's
 * `content.media_url`. If a clip is already small enough that the encode
 * doesn't pay (result ≥ 85% of source), it falls back to a lossless +faststart
 * remux so the pass still helps startup latency. The old object is left in
 * place (this app never deletes media). Each processed post gets
 * `content.web_optimized: true`, so re-running skips it — idempotent.
 *
 * New posts already come out compressed from the generation pipeline
 * (src/lib/server/video.ts optimizeForWeb); this only covers the backlog.
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *   Dry run (default — writes nothing, just reports the count):
 *     npm run backfill:compress
 *   Actually do it:
 *     npm run backfill:compress -- --apply
 *   Options: --limit=N (cap the batch, for a cautious first pass)
 *            --crf=N   (quality/size knob, default 27; lower = bigger/better)
 *
 * Requires (read from .env via --env-file): PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, and ffmpeg on PATH (or FFMPEG_PATH set).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'ugc-media';
// Each worker downloads AND re-uploads several MB through the same slow host
// we're trying to relieve — 2 keeps the pass from starving live users.
const CONCURRENCY = 2;
const MAX_WIDTH = 720;

// ── CLI + env ────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 0) : Infinity;
const crfArg = process.argv.find((a) => a.startsWith('--crf='));
const CRF = crfArg ? Math.min(35, Math.max(18, Number(crfArg.split('=')[1]) || 27)) : 27;

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

if (!SUPABASE_URL || !SERVICE_KEY) {
	console.error(
		'✖ Missing PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run via `npm run backfill:compress` so .env is loaded.'
	);
	process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── ffmpeg helpers ───────────────────────────────────────────────────────────
function ffmpegAvailable(): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const p = spawn(FFMPEG, ['-version']);
			p.on('error', () => resolve(false));
			p.on('close', (code) => resolve(code === 0));
		} catch {
			resolve(false);
		}
	});
}

function runFfmpeg(args: string[], cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const p = spawn(FFMPEG, args, { cwd });
		let err = '';
		p.stderr.on('data', (d) => (err += d.toString()));
		p.on('error', reject);
		p.on('close', (code) =>
			code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`))
		);
	});
}

/** Download → delivery re-encode (fallback: lossless +faststart) → mp4 bytes. */
async function compress(url: string): Promise<{ bytes: Buffer; from: number; encoded: boolean }> {
	const dir = await mkdtemp(join(tmpdir(), 'ugc-cmp-'));
	try {
		const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
		if (!res.ok) throw new Error(`download failed (${res.status})`);
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.length === 0) throw new Error('empty source body');
		await writeFile(join(dir, 'in.mp4'), buf);

		try {
			await runFfmpeg(
				[
					'-y',
					'-i',
					'in.mp4',
					'-vf',
					`scale=w=min(${MAX_WIDTH}\\,iw):h=-2`,
					'-c:v',
					'libx264',
					'-crf',
					String(CRF),
					'-preset',
					'veryfast',
					'-pix_fmt',
					'yuv420p',
					'-c:a',
					'aac',
					'-b:a',
					'96k',
					'-movflags',
					'+faststart',
					'enc.mp4'
				],
				dir
			);
			const enc = await readFile(join(dir, 'enc.mp4'));
			if (enc.length > 0 && enc.length < buf.length * 0.85) {
				return { bytes: enc, from: buf.length, encoded: true };
			}
		} catch (e) {
			console.warn(`  (encode failed, remux-only fallback: ${(e as Error).message})`);
		}

		await runFfmpeg(['-y', '-i', 'in.mp4', '-c', 'copy', '-movflags', '+faststart', 'out.mp4'], dir);
		return { bytes: await readFile(join(dir, 'out.mp4')), from: buf.length, encoded: false };
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

// ── Row selection ────────────────────────────────────────────────────────────
interface Target {
	id: string;
	userId: string;
	content: Record<string, unknown>;
	mediaUrl: string;
}

/** True once a URL already lives in our own public bucket. */
function isDurableBucketUrl(url: unknown): url is string {
	return typeof url === 'string' && url.includes(`/storage/v1/object/public/${BUCKET}/`);
}

/** Classifies a post: a target to compress, or a reason it's skipped. */
function classify(row: { id: string; user_id: string; content: string }):
	| { kind: 'target'; target: Target }
	| { kind: 'skip'; reason: string } {
	let content: Record<string, unknown>;
	try {
		content = JSON.parse(row.content);
	} catch {
		return { kind: 'skip', reason: 'non-JSON content' };
	}
	const mediaType = content.media_type ?? content.mediaType;
	if (mediaType !== 'video') return { kind: 'skip', reason: 'not a video' };
	if (content.web_optimized === true) return { kind: 'skip', reason: 'already compressed' };
	const mediaUrl = content.media_url ?? content.mediaUrl;
	if (!isDurableBucketUrl(mediaUrl)) return { kind: 'skip', reason: 'media not in our bucket' };
	return {
		kind: 'target',
		target: { id: row.id, userId: row.user_id, content, mediaUrl }
	};
}

async function fetchVideoPosts(): Promise<{ targets: Target[]; skips: Record<string, number> }> {
	const targets: Target[] = [];
	const skips: Record<string, number> = {};
	const PAGE = 1000;
	for (let from = 0; ; from += PAGE) {
		const { data, error } = await supabase
			.from('posts')
			.select('id, user_id, content')
			.range(from, from + PAGE - 1);
		if (error) throw error;
		if (!data || data.length === 0) break;
		for (const row of data as { id: string; user_id: string; content: string }[]) {
			const c = classify(row);
			if (c.kind === 'target') targets.push(c.target);
			else skips[c.reason] = (skips[c.reason] ?? 0) + 1;
		}
		if (data.length < PAGE) break;
	}
	return { targets, skips };
}

// ── Per-post work ────────────────────────────────────────────────────────────
async function processOne(t: Target): Promise<string> {
	const { bytes, from, encoded } = await compress(t.mediaUrl);

	// Fresh, immutable object path (mirrors persistBufferToStorage in the app).
	const rand = Math.random().toString(36).slice(2, 8);
	const path = `${t.userId}/${Date.now()}-${rand}.mp4`;
	const { error: upErr } = await supabase.storage
		.from(BUCKET)
		.upload(path, bytes, { contentType: 'video/mp4', upsert: false, cacheControl: '604800' });
	if (upErr) throw new Error(`upload failed: ${upErr.message}`);
	const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

	const newContent = {
		...t.content,
		media_url: publicUrl,
		web_optimized: true,
		faststart: true
	};
	const { error: updErr } = await supabase
		.from('posts')
		.update({ content: JSON.stringify(newContent) })
		.eq('id', t.id);
	if (updErr) throw new Error(`db update failed: ${updErr.message}`);

	return `${(from / 1e6).toFixed(1)}MB → ${(bytes.length / 1e6).toFixed(1)}MB${encoded ? '' : ' (remux only)'}`;
}

/** Runs `worker` over `items` with a fixed concurrency cap. */
async function pool<T>(items: T[], size: number, worker: (item: T, i: number) => Promise<void>) {
	let next = 0;
	const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
		for (;;) {
			const i = next++;
			if (i >= items.length) return;
			await worker(items[i], i);
		}
	});
	await Promise.all(runners);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
	if (!(await ffmpegAvailable())) {
		console.error(
			`✖ ffmpeg not found (tried "${FFMPEG}"). Install it or set FFMPEG_PATH, then re-run.`
		);
		process.exit(1);
	}

	console.log('Scanning posts…');
	const { targets: all, skips } = await fetchVideoPosts();
	const targets = Number.isFinite(LIMIT) ? all.slice(0, LIMIT) : all;

	console.log('\n── Scope ──────────────────────────────');
	console.log(`Video posts needing compression : ${all.length}`);
	if (Number.isFinite(LIMIT) && all.length > targets.length)
		console.log(`Capped by --limit to            : ${targets.length}`);
	for (const [reason, n] of Object.entries(skips))
		console.log(`Skipped (${reason})`.padEnd(33) + `: ${n}`);
	console.log('───────────────────────────────────────\n');

	if (targets.length === 0) {
		console.log('Nothing to do. ✔');
		return;
	}

	if (!APPLY) {
		console.log(
			`DRY RUN — no changes made. Re-run with --apply to compress these ${targets.length} clip(s).`
		);
		console.log('  npm run backfill:compress -- --apply');
		return;
	}

	console.log(`Applying to ${targets.length} clip(s) with concurrency ${CONCURRENCY}, CRF ${CRF}…\n`);
	let done = 0;
	let failed = 0;
	await pool(targets, CONCURRENCY, async (t) => {
		try {
			const note = await processOne(t);
			done++;
			console.log(`✔ ${done + failed}/${targets.length}  ${t.id}  ${note}`);
		} catch (e) {
			failed++;
			console.warn(`✖ ${done + failed}/${targets.length}  ${t.id} — ${(e as Error).message}`);
		}
	});

	console.log(`\nFinished. Compressed ${done}, failed ${failed}.`);
	if (failed > 0) {
		console.log(
			'Failed posts were left untouched (still playable via the original URL). Re-run to retry them.'
		);
		process.exitCode = 1;
	}
}

main().catch((e) => {
	console.error('Fatal:', e);
	process.exit(1);
});
