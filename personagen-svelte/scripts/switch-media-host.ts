/**
 * One-time switch: repoint every post's media/poster URL from the raw storage
 * host (`l2g-supabase.zi1cc5.easypanel.host` — direct to the VPS, no CDN,
 * measured at a few hundred KB/s) to `media.monarchstack.com`, which fronts the
 * SAME Kong/storage service through Cloudflare. With the Cloudflare cache rule
 * in place, videos and thumbnails then come off the edge at full speed instead
 * of trickling from the VPS.
 *
 * Prerequisites (the script probes and refuses to run until they're true):
 *   1. EasyPanel domain `media.monarchstack.com` → supabase/kong:8000 (done via
 *      panel API — see memory personagen-video-latency).
 *   2. Cloudflare DNS: A record `media` → 72.60.125.183, PROXIED (orange cloud).
 *   3. (For mp4 edge-caching) Cloudflare Cache Rule: hostname
 *      media.monarchstack.com → Eligible for cache ("Cache Everything").
 *
 * Only POSTS' `content.media_url` / `content.poster_url` are rewritten.
 * agent_configs URLs (avatars/reference kits) are deliberately left on the
 * storage host: the restore routes validate them against PUBLIC_SUPABASE_URL's
 * origin (isOwnedBucketUrl) and would reject rewritten values.
 *
 * Fully reversible: re-run with --revert to swap the hosts back.
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *   Dry run (default):   npm run switch:media-host
 *   Apply:               npm run switch:media-host -- --apply
 *   Revert:              npm run switch:media-host -- --apply --revert
 */
import { createClient } from '@supabase/supabase-js';

const CDN_HOST = 'https://media.monarchstack.com';
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');

const SUPABASE_URL = (process.env.PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
	console.error('✖ Missing PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (run via npm so .env loads).');
	process.exit(1);
}

const FROM = REVERT ? CDN_HOST : SUPABASE_URL;
const TO = REVERT ? SUPABASE_URL : CDN_HOST;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

/** The CDN host must serve OUR storage before any URL is repointed at it. */
async function probeCdn(sampleObjectUrl: string): Promise<void> {
	if (REVERT) return; // reverting back to the storage host needs no probe
	const probeUrl = sampleObjectUrl.replace(SUPABASE_URL, CDN_HOST);
	let res: Response;
	try {
		res = await fetch(probeUrl, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
	} catch (e) {
		throw new Error(
			`${CDN_HOST} is not reachable (${(e as Error).message}). Add the Cloudflare DNS record first (A "media" → 72.60.125.183, proxied).`
		);
	}
	if (!res.ok) {
		throw new Error(
			`${CDN_HOST} responded ${res.status} for a known object — routing isn't live yet (DNS still propagating, or the EasyPanel domain/TLS isn't ready). Nothing was changed.`
		);
	}
	const type = res.headers.get('content-type') || '';
	if (!/video|image|octet-stream/.test(type)) {
		throw new Error(`${CDN_HOST} returned unexpected content-type "${type}" — refusing to switch.`);
	}
	console.log(`✔ Probe OK: ${probeUrl} → ${res.status} (${type}, cf-cache: ${res.headers.get('cf-cache-status') ?? 'n/a'})`);
}

interface Target {
	id: string;
	content: Record<string, unknown>;
	fields: string[];
}

async function main() {
	console.log(`Rewriting host ${FROM} → ${TO}\nScanning posts…`);
	const targets: Target[] = [];
	let sampleUrl: string | null = null;
	const PAGE = 1000;
	for (let from = 0; ; from += PAGE) {
		const { data, error } = await supabase
			.from('posts')
			.select('id, content')
			.range(from, from + PAGE - 1);
		if (error) throw error;
		if (!data || data.length === 0) break;
		for (const row of data as { id: string; content: string }[]) {
			let content: Record<string, unknown>;
			try {
				content = JSON.parse(row.content);
			} catch {
				continue;
			}
			const fields = ['media_url', 'poster_url'].filter(
				(f) => typeof content[f] === 'string' && (content[f] as string).startsWith(`${FROM}/storage/v1/`)
			);
			if (fields.length === 0) continue;
			if (!sampleUrl) sampleUrl = content[fields[0]] as string;
			targets.push({ id: row.id, content, fields });
		}
		if (data.length < PAGE) break;
	}

	console.log(`Posts to rewrite: ${targets.length}`);
	if (targets.length === 0) {
		console.log('Nothing to do. ✔');
		return;
	}

	await probeCdn(REVERT ? (sampleUrl as string) : (sampleUrl as string));

	if (!APPLY) {
		console.log(`\nDRY RUN — no changes made. Re-run with --apply to rewrite ${targets.length} post(s).`);
		return;
	}

	let done = 0;
	for (const t of targets) {
		const newContent = { ...t.content };
		for (const f of t.fields) {
			newContent[f] = (newContent[f] as string).replace(`${FROM}/storage/v1/`, `${TO}/storage/v1/`);
		}
		const { error } = await supabase
			.from('posts')
			.update({ content: JSON.stringify(newContent) })
			.eq('id', t.id);
		if (error) {
			console.warn(`✖ ${t.id} — ${error.message}`);
			continue;
		}
		done++;
	}
	console.log(`\nFinished. Rewrote ${done}/${targets.length} post(s).`);
}

main().catch((e) => {
	console.error('Fatal:', e.message ?? e);
	process.exit(1);
});
