import { STUDIO_TEMPLATES } from '$lib/studio-templates';

/**
 * Which Studio shelf an output belongs on — the SAME four-word vocabulary the
 * Studio browses by (Text & Type / Photo / Video / Cinematic), so a tile in the
 * feed, the library, favorites, or the calendar reads as the thing that made it.
 */
export type PostSurface = 'typographic' | 'photo' | 'video' | 'cinematic';

export const SURFACE_LABEL: Record<PostSurface, string> = {
	typographic: 'Text',
	photo: 'Photo',
	video: 'Video',
	cinematic: 'Cinematic'
};

const TEMPLATE_BY_ID = new Map(STUDIO_TEMPLATES.map((t) => [t.id, t]));

export interface PostDisplay {
	text: string;
	mediaUrl: string | null;
	mediaType: string;
	/** Output class, Studio-shelf vocabulary — drives tile badges + format filters. */
	surface: PostSurface;
	/** Title of the Studio template that produced this, when one did. */
	templateTitle: string | null;
	/** Multi-shot cinematic post (its own pipeline, not the single-still one). */
	cinematic: boolean;
	posterUrl: string | null;
	ugcPrompt: string | null;
	script: string | null;
	product: any | null;
	/** Full observability record (models/costs/images/selections), if captured. */
	generation: any | null;
	/** Estimated spend { total, byProvider } — present on most posts even without the full record. */
	costBreakdown: any | null;
	/** Format + media type, for the observability panel. */
	format: string | null;
	mediaGenerated: boolean;
	/** On-screen caption hook + whether it was burned onto the video (opt-in). */
	onScreenText: string | null;
	captionsBurned: boolean;
	/** Whether the "AI GENERATED" disclosure badge was burned on (opt-in). */
	aiBadgeBurned: boolean;
}

const ERROR_SNIPPET_MAX = 140;

/** Clamps a stored provider error to a UI-safe length. */
export function truncateError(msg: string): string {
	const clean = msg.trim();
	return clean.length > ERROR_SNIPPET_MAX ? clean.slice(0, ERROR_SNIPPET_MAX - 1) + '…' : clean;
}

/**
 * Turns a raw, provider-shaped GENERATION error into one short, safe sentence.
 *
 * The stored error is untrusted noise: it can be a nested JSON string, carry
 * provider URLs, and leak key identifiers (e.g. `.../keys/<id>`). We never want
 * any of that on screen — it reads as garbage and exposes secrets. So we dig out
 * the human message, classify it into a known failure mode, and return a single
 * actionable line. Falls back to a generic sentence, never the raw payload.
 */
export function summarizeGenError(post: any): string {
	const GENERIC = 'Generation failed. Try again, or check your key in Settings.';

	let raw: unknown = null;
	try {
		const c = typeof post?.content === 'string' ? JSON.parse(post.content) : post?.content;
		raw = c?.error ?? c?.last_error ?? null;
	} catch {
		raw = null;
	}

	// The error is sometimes itself a JSON string, or a {error:{message}} tree —
	// peel it down to the innermost human string.
	const dig = (v: any, depth = 0): string => {
		if (v == null || depth > 5) return '';
		if (typeof v === 'string') {
			const t = v.trim();
			if (t.startsWith('{') || t.startsWith('[')) {
				try {
					return dig(JSON.parse(t), depth + 1);
				} catch {
					return t;
				}
			}
			return t;
		}
		if (typeof v === 'object') return dig(v.message ?? v.error ?? v.detail ?? v.reason ?? '', depth + 1);
		return String(v);
	};

	const low = dig(raw).toLowerCase();
	if (!low) return GENERIC;

	if (/credit|insufficient|can only afford|requires more|quota|balance/.test(low))
		return 'The generation key ran out of credits. Top it up and try again.';
	if (/rate.?limit|too many requests|\b429\b/.test(low))
		return 'Rate limited by the provider. Try again in a few minutes.';
	if (/timeout|timed out|deadline|took too long/.test(low))
		return 'The model timed out. Try again.';
	if (/content policy|safety|nsfw|flagged|moderat|blocked/.test(low))
		return 'Blocked by the model’s content policy. Adjust the prompt and retry.';
	if (/invalid.*key|unauthor|forbidden|\b401\b|\b403\b|api key/.test(low))
		return 'The generation key was rejected. Check it in Settings.';
	return GENERIC;
}

/**
 * Human-readable summary of why a post failed (or partially failed) to
 * publish: per-platform errors from publication_results when available,
 * falling back to the post-level _post.error / _post.last_error.
 */
export function getPostErrorSummary(post: any): string | null {
	const results = post?.publication_results;
	if (!results || typeof results !== 'object') return null;

	const platformErrors: string[] = [];
	for (const [platform, result] of Object.entries(results)) {
		if (platform === '_post') continue;
		const r = result as any;
		if (r && typeof r === 'object' && typeof r.error === 'string' && r.error) {
			platformErrors.push(`${platform}: ${truncateError(r.error)}`);
		}
	}
	if (platformErrors.length > 0) return platformErrors.join('\n');

	const meta = results._post;
	const postLevel = meta?.error || meta?.last_error;
	return typeof postLevel === 'string' && postLevel ? truncateError(postLevel) : null;
}

/**
 * Parses a post's `content` (JSON-stringified) into display fields, with a
 * fallback to `publication_results` for older rows from a since-retired
 * posting path that stored the provider's own media_url/media_type there
 * directly (flat, no per-platform key) instead of in `content` — those posts
 * really did publish, they just never got backfilled into the current shape.
 */
export function getPostDisplay(post: any): PostDisplay {
	const content = post?.content;
	let parsed: any = null;
	try {
		const trimmed = content?.trim() ?? '';
		if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
			parsed = JSON.parse(trimmed);
		}
	} catch {
		/* not JSON — plain-text legacy post */
	}

	// Legacy flat shape only (no platform-name key) — the current per-platform
	// shape ({platform: {status, permalink, provider, external_id}}) never
	// carries media, since today's pipeline always generates media before
	// posting and stores it in `content` from the start.
	const legacyResults = post?.publication_results;
	const legacyMedia =
		legacyResults && typeof legacyResults === 'object' && typeof legacyResults.media_url === 'string'
			? legacyResults
			: null;

	const mediaType =
		parsed?.media_type ||
		parsed?.mediaType ||
		(legacyMedia ? legacyMedia.media_type?.toLowerCase() : null) ||
		'image';
	const isCinematic = parsed?.cinematic === true;
	const template = parsed?.studio?.template ? TEMPLATE_BY_ID.get(parsed.studio.template) : undefined;
	// The template's own shelf, mapped to output vocabulary ('motion' → video).
	const templateSurface: PostSurface | null = template
		? template.surface === 'motion'
			? 'video'
			: (template.surface as PostSurface)
		: null;
	const hasMedia = Boolean(parsed?.media_url || parsed?.mediaUrl || legacyMedia?.media_url);
	// Delivered rows: classify what was ACTUALLY produced (media_type is truth —
	// a degraded video template that delivered a still is a photo). In-flight /
	// failed rows have no media yet, so the template says what the slot IS —
	// that's what makes a generating campaign slot a typed placeholder.
	const surface: PostSurface = isCinematic
		? 'cinematic'
		: hasMedia
			? mediaType === 'video'
				? 'video'
				: parsed?.generation?.still_style === 'graphic' || templateSurface === 'typographic'
					? 'typographic'
					: 'photo'
			: (templateSurface ??
				(mediaType === 'video'
					? 'video'
					: parsed?.generation?.still_style === 'graphic'
						? 'typographic'
						: 'photo'));

	return {
		text: parsed?.text || content || '',
		mediaUrl: parsed?.media_url || parsed?.mediaUrl || legacyMedia?.media_url || null,
		mediaType,
		surface,
		templateTitle: template?.title ?? null,
		cinematic: isCinematic,
		posterUrl: parsed?.poster_url || null,
		ugcPrompt: parsed?.ugc_broll_prompt || parsed?.ugcPrompt || null,
		script: parsed?.script || null,
		product: parsed?.product || null,
		generation: parsed?.generation || null,
		costBreakdown: parsed?.costBreakdown || null,
		format: parsed?.format || null,
		mediaGenerated: parsed?.media_generated ?? false,
		onScreenText: parsed?.on_screen_text || null,
		captionsBurned: parsed?.captions === true,
		aiBadgeBurned: parsed?.ai_badge === true
	};
}
