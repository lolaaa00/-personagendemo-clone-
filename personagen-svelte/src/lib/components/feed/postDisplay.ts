import { STUDIO_TEMPLATES } from '$lib/studio-templates';
import { proxiedMediaUrl } from '$lib/image-url';

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
	/** Studio "Asset only" output — deliberately NOT in the review queue. */
	standalone: boolean;
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
	/** True only when the burn outcome was actually RECORDED. Legacy posts predate
	 *  the fields — asserting "off" for them would misstate a clip that visibly
	 *  has captions, so surfaces must stay silent when this is false. */
	captionsKnown: boolean;
	/** The TTS voice that actually spoke (spokesperson posts), if recorded. */
	voice: string | null;
	/** In-flight/failed rows: what the run SET OUT to produce, when recorded. */
	intended: { media?: string; format?: string; still?: string } | null;
}

/**
 * Human names for the formats a DELIVERED clip can carry, keyed by the token
 * stored on the post.
 *
 * A map, not a ternary chain, because the chain that used to do this ended in
 * `: 'b-roll clip'` — so every format the catalog grew after it was written
 * described itself as b-roll. That is how a performance transfer (`v2v_*`, a
 * source clip re-performed by the persona, billed per second) rendered as
 * "b-roll clip · video": a confident, wrong statement about what the post IS.
 * A token that is absent from this map must therefore stay UNNAMED — callers
 * say only "video" — rather than fall through to the most common answer.
 *
 * A missing format is genuinely b-roll: legacy rows predate the field, and the
 * pipeline made nothing else back then.
 */
export const VIDEO_FORMAT_LABEL: Record<string, string> = {
	broll: 'b-roll clip',
	spokesperson: 'spokesperson (talking head)',
	vo_broll: 'narrated product motion',
	motion_card: 'motion text card',
	v2v_replace: 'performance transfer (source scene kept)',
	v2v_move: 'performance transfer (motion only)',
	v2v_narrated: 'narrated performance transfer',
	listicle: 'listicle (timed reveals)'
};

/** The only four formats a refine can actually DELIVER. */
export type RefineFormat = 'spokesperson' | 'broll' | 'vo_broll' | 'motion_card';

/**
 * What a refine of this post will actually RUN — a mirror of the format branch
 * at the top of refineUgcMedia's video stage (server/content/generate.ts).
 *
 * It has to be a mirror rather than a reading of the stored format, because the
 * drawer quotes a price off it and that quote is what the user's two-click
 * confirm consents to. The old "anything that isn't 'broll' is a talking head"
 * reading was wrong three separate ways once the format catalog grew:
 *
 *   - a motion card is re-typeset and re-muxed locally, so no video provider is
 *     called at all and the still is the entire spend;
 *   - a narrated b-roll runs the CLIP model plus TTS — no lip-sync anywhere;
 *   - a performance transfer cannot re-perform anything, because the ingested
 *     source clip is not part of the stored post. The server re-shoots the still
 *     and re-animates it as plain b-roll, so a v2v post was quoting ~$1.00 of
 *     talking head against ~$0.55 of Kling.
 *
 * Over-quoting is not the safe direction either: a confirm that names a number
 * the ledger then contradicts is the same broken consent as under-quoting.
 *
 * 'v2v_narrated' is deliberately absent from the transfer branch: it carries a
 * voiceover, and the server's own mapping drops it through to spokesperson.
 */
export function refineFormatOf(format: string | null | undefined): RefineFormat {
	if (format === 'broll' || format === 'vo_broll' || format === 'motion_card') return format;
	if (format === 'v2v_replace' || format === 'v2v_move') return 'broll';
	return 'spokesperson';
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
		if (typeof v === 'object')
			return dig(v.message ?? v.error ?? v.detail ?? v.reason ?? '', depth + 1);
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
	if (content && typeof content === 'object') {
		// Some write paths store the object directly — same contract as the
		// stringified form (summarizeGenError already tolerates this; the display
		// classifier must too, or an object-content post loses its whole record).
		parsed = content;
	} else {
		try {
			const trimmed = typeof content === 'string' ? content.trim() : '';
			if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
				parsed = JSON.parse(trimmed);
			}
		} catch {
			/* not JSON — plain-text legacy post */
		}
	}

	// Legacy flat shape only (no platform-name key) — the current per-platform
	// shape ({platform: {status, permalink, provider, external_id}}) never
	// carries media, since today's pipeline always generates media before
	// posting and stores it in `content` from the start.
	const legacyResults = post?.publication_results;
	const legacyMedia =
		legacyResults &&
		typeof legacyResults === 'object' &&
		typeof legacyResults.media_url === 'string'
			? legacyResults
			: null;

	const mediaUrl = parsed?.media_url || parsed?.mediaUrl || legacyMedia?.media_url || null;
	const mediaType =
		parsed?.media_type ||
		parsed?.mediaType ||
		(legacyMedia ? legacyMedia.media_type?.toLowerCase() : null) ||
		// Legacy rows recorded no media_type; sniffing the URL beats asserting
		// "image" for what is plainly a clip (a video rendered in an <img> tag).
		(typeof mediaUrl === 'string' && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(mediaUrl)
			? 'video'
			: 'image');
	const isCinematic = parsed?.cinematic === true;
	const template = parsed?.studio?.template
		? TEMPLATE_BY_ID.get(parsed.studio.template)
		: undefined;
	// The template's own shelf, mapped to output vocabulary ('motion' → video).
	const templateSurface: PostSurface | null = template
		? template.surface === 'motion'
			? 'video'
			: (template.surface as PostSurface)
		: null;
	// What the run SET OUT to make — stamped on placeholder/failed rows by the
	// generate endpoint so a type exists before (or without) any delivered media.
	const intended = parsed?.intended && typeof parsed.intended === 'object' ? parsed.intended : null;
	const intendedSurface: PostSurface | null = intended
		? intended.media === 'cinematic'
			? 'cinematic'
			: intended.media === 'video'
				? 'video'
				: intended.still === 'graphic'
					? 'typographic'
					: intended.media === 'image'
						? 'photo'
						: null
		: null;
	const hasMedia = Boolean(mediaUrl);
	// Delivered rows: classify what was ACTUALLY produced (media_type is truth —
	// a degraded video template that delivered a still is a photo). In-flight /
	// failed rows have no media yet, so the recorded INTENT says what the slot
	// is becoming (template shelf as the legacy fallback) — that's what makes a
	// generating campaign slot a typed placeholder instead of a default "photo".
	const surface: PostSurface = isCinematic
		? 'cinematic'
		: hasMedia
			? mediaType === 'video'
				? 'video'
				: parsed?.generation?.still_style === 'graphic' || templateSurface === 'typographic'
					? 'typographic'
					: 'photo'
			: (intendedSurface ??
				templateSurface ??
				(mediaType === 'video'
					? 'video'
					: parsed?.generation?.still_style === 'graphic'
						? 'typographic'
						: 'photo'));

	return {
		// Placeholder/failed rows have parsed JSON but no text — that must render
		// as empty, never as the raw JSON payload (internal prompt scaffolding).
		text: parsed ? parsed.text || '' : content || '',
		// Display URLs route through the same-origin /media proxy (Cloudflare-
		// fronted). The RAW storage URL stays in the DB — publishing reads that,
		// platforms need an absolute public URL.
		mediaUrl: (proxiedMediaUrl(mediaUrl) as string | null) ?? null,
		mediaType,
		surface,
		templateTitle: template?.title ?? null,
		cinematic: isCinematic,
		standalone: parsed?.studio?.standalone === true,
		posterUrl: (proxiedMediaUrl(parsed?.poster_url || null) as string | null) ?? null,
		ugcPrompt: parsed?.ugc_broll_prompt || parsed?.ugcPrompt || null,
		script: parsed?.script || null,
		product: parsed?.product || null,
		generation: parsed?.generation || null,
		costBreakdown: parsed?.costBreakdown || null,
		format: parsed?.format || null,
		mediaGenerated: parsed?.media_generated ?? false,
		onScreenText: parsed?.on_screen_text || null,
		captionsBurned: parsed?.captions === true,
		aiBadgeBurned: parsed?.ai_badge === true,
		captionsKnown: parsed ? parsed.captions !== undefined || parsed.ai_badge !== undefined : false,
		voice: typeof parsed?.voice === 'string' ? parsed.voice : null,
		intended
	};
}
