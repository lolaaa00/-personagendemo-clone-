/**
 * One-time backfill: re-mux already-generated video posts to a web-optimised mp4
 * (moov atom moved to the front, a.k.a. `+faststart`) so they start playing after
 * a small opening request instead of forcing the browser to download the whole
 * file to find its metadata. That non-faststart layout is why older clips "take
 * forever to load" in the drawer and refuse to play inline on mobile at all.
 *
 * This does NOT regenerate anything — no model spend. It downloads each existing
 * clip, stream-copies it (`-c copy`, lossless) with `+faststart`, uploads the
 * result as a fresh object, and repoints the post's `content.media_url` at it. The
 * old object is left in place (this app never deletes media). Each processed post
 * gets `content.faststart: true`, so re-running skips it — the job is idempotent.
 *
 * New posts already come out faststart from the generation pipeline; this only
 * covers the backlog created before that change.
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *   Dry run (default — writes nothing, just reports the count):
 *     npm run backfill:faststart
 *   Actually do it:
 *     npm run backfill:faststart -- --apply
 *   Options: --limit=N (cap the batch, for a cautious first pass)
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
const CONCURRENCY = 4;

// ── CLI + env ────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 0) : Infinity;

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

if (!SUPABASE_URL || !SERVICE_KEY) {
	console.error(
		'✖ Missing PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Run via `npm run backfill:faststart` so .env is loaded.'
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

/** Download → lossless +faststart remux → return mp4 bytes. */
async function remuxFaststart(url: string): Promise<Buffer> {
	const dir = await mkdtemp(join(tmpdir(), 'ugc-fs-'));
	try {
		const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
		if (!res.ok) throw new Error(`download failed (${res.status})`);
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.length === 0) throw new Error('empty source body');
		await writeFile(join(dir, 'in.mp4'), buf);
		await runFfmpeg(['-y', '-i', 'in.mp4', '-c', 'copy', '-movflags', '+faststart', 'out.mp4'], dir);
		return await readFile(join(dir, 'out.mp4'));
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

/** Classifies a post: a target to remux, or a reason it's skipped. */
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
	if (content.faststart === true) return { kind: 'skip', reason: 'already faststart' };
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
async function processOne(t: Target): Promise<void> {
	const remuxed = await remuxFaststart(t.mediaUrl);

	// Fresh, immutable object path (mirrors persistBufferToStorage in the app).
	const rand = Math.random().toString(36).slice(2, 8);
	const path = `${t.userId}/${Date.now()}-${rand}.mp4`;
	const { error: upErr } = await supabase.storage
		.from(BUCKET)
		.upload(path, remuxed, { contentType: 'video/mp4', upsert: false, cacheControl: '604800' });
	if (upErr) throw new Error(`upload failed: ${upErr.message}`);
	const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

	const newContent = { ...t.content, media_url: publicUrl, faststart: true };
	const { error: updErr } = await supabase
		.from('posts')
		.update({ content: JSON.stringify(newContent) })
		.eq('id', t.id);
	if (updErr) throw new Error(`db update failed: ${updErr.message}`);
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
	console.log(`Video posts needing faststart : ${all.length}`);
	if (Number.isFinite(LIMIT) && all.length > targets.length)
		console.log(`Capped by --limit to           : ${targets.length}`);
	for (const [reason, n] of Object.entries(skips)) console.log(`Skipped (${reason})`.padEnd(32) + `: ${n}`);
	console.log('───────────────────────────────────────\n');

	if (targets.length === 0) {
		console.log('Nothing to do. ✔');
		return;
	}

	if (!APPLY) {
		console.log(`DRY RUN — no changes made. Re-run with --apply to remux these ${targets.length} clip(s).`);
		console.log('  npm run backfill:faststart -- --apply');
		return;
	}

	console.log(`Applying to ${targets.length} clip(s) with concurrency ${CONCURRENCY}…\n`);
	let done = 0;
	let failed = 0;
	await pool(targets, CONCURRENCY, async (t) => {
		try {
			await processOne(t);
			done++;
			console.log(`✔ ${done + failed}/${targets.length}  ${t.id}`);
		} catch (e) {
			failed++;
			console.warn(`✖ ${done + failed}/${targets.length}  ${t.id} — ${(e as Error).message}`);
		}
	});

	console.log(`\nFinished. Remuxed ${done}, failed ${failed}.`);
	if (failed > 0) {
		console.log('Failed posts were left untouched (still playable via the original URL). Re-run to retry them.');
		process.exitCode = 1;
	}
}

main().catch((e) => {
	console.error('Fatal:', e);
	process.exit(1);
});
