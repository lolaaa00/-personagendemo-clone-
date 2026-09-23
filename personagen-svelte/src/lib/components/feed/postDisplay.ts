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
	// Every generation runs on the platform's keys since customer generation keys
	// were withdrawn (2026-09-21), so no failure here is ever "check your key":
	// the user has none. The generic line points at the one real way to reach
	// us — the drawer's "Report this problem" — where it used to say "tell us"
	// with no way to (round-2 re-audit).
	const GENERIC =
		'Generation didn’t finish, and nothing was taken from your wallet. Try again — if it keeps failing, open the post and use Report this problem.';

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

	const text = dig(raw);
	const low = text.toLowerCase();
	if (!low) return GENERIC;

	// Since 2026-09-10 the server writes a customer-safe sentence onto the row
	// (server/failure-text.ts: vendor-free, link-free, says whose problem it
	// is). Show it AS WRITTEN. Re-classifying it here threw the real cause
	// away: a re-audit found "Image provider returned 503 … nothing was
	// charged" rendered as a generic "didn't finish" on every tile.
	if (isCustomerSafeFailureText(text)) return text;

	// Older rows can hold raw provider text: classify it, never show it. A
	// failed POST is never the customer's wallet — the wallet check refuses a
	// run up front (402) before any post exists — so credit wording here is
	// always the provider account's, which is on us.
	if (/credit|insufficient|can only afford|requires more|quota|balance|\b402\b/.test(low))
		return 'Generation is paused on our side while the provider account is topped up. That’s on us — nothing was taken from your wallet. Try again shortly.';
	if (/rate.?limit|too many requests|\b429\b/.test(low))
		return 'The provider is rate-limiting us right now. Try again in a few minutes.';
	if (/timeout|timed out|deadline|took too long/.test(low))
		return 'The model took too long and the run was stopped. Try again.';
	if (/content policy|safety|nsfw|flagged|moderat|blocked/.test(low))
		return 'Blocked by the model’s content policy. Adjust the prompt and try again.';
	if (/invalid.*key|unauthor|forbidden|\b401\b|\b403\b|api key/.test(low))
		return 'Our provider key was rejected. That’s on us, not your account — try again shortly.';
	return GENERIC;
}

/**
 * True for a sentence written FOR a customer: no links, no JSON or markup, no
 * vendor or key identifiers, and shaped like a sentence. Anything else is raw
 * provider output, which is for the server log only.
 */
export function isCustomerSafeFailureText(text: string): boolean {
	const t = text.trim();
	if (t.length < 12 || t.length > 400) return false;
	if (/https?:|www\.|[{}[\]<>]|\n/.test(t)) return false;
	if (/openrouter|fal\.ai|\bfal\b|gemini|anthropic|openai|kie\b|firecrawl|elevenlabs|replicate|\bsk-|key[_-]?id|\/keys\//i.test(t))
		return false;
	return /^[A-Z“"']/.test(t) && /[.!?…]$/.test(t);
}

/**
 * Human-readable summary of why a post failed (or partially failed) to
 * publish: per-platform errors from publication_results when available,
 * falling back to the post-level _post.error / _post.last_error.
 */
const PLATFORM_NAMES: Record<string, string> = {
	instagram: 'Instagram',
	facebook: 'Facebook',
	tiktok: 'TikTok',
	linkedin: 'LinkedIn',
	youtube: 'YouTube',
	twitter: 'X',
	x: 'X',
	threads: 'Threads',
	pinterest: 'Pinterest',
	reddit: 'Reddit',
	bluesky: 'Bluesky',
	snapchat: 'Snapchat',
	googlebusiness: 'Google Business'
};

export function getPostErrorSummary(post: any): string | null {
	const results = post?.publication_results;
	if (!results || typeof results !== 'object') return null;

	const platformErrors: string[] = [];
	for (const [platform, result] of Object.entries(results)) {
		if (platform === '_post') continue;
		const r = result as any;
		if (r && typeof r === 'object' && typeof r.error === 'string' && r.error) {
			// "Facebook: page token expired", not the raw "facebook: Page token expired".
			const name = PLATFORM_NAMES[platform.toLowerCase()] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
			const msg = truncateError(r.error);
			platformErrors.push(`${name}: ${msg.charAt(0).toLowerCase()}${msg.slice(1)}`);
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


/**
 * The generate-post request a failed post was trying to make, rebuilt from what
 * the server kept on the failed row: `{ topic, intended: { media, format?,
 * still? }, studio? }` (generate-post/+server.ts keeps these on failure "so a
 * failed slot must still say WHAT it was going to be (format badge, retry)").
 *
 * The retry control was designed for and never built: a client audit (UX-007)
 * found failure notices that said "try again" with nothing to click. This is
 * the one mapping every surface uses, so a retry cannot quietly ask for a
 * different format than the run that failed.
 *
 * It is a STARTING POINT, never a spend: callers open the confirm-first
 * composer with it, the server resolves the real plan and price, and the user
 * approves exactly as they did the first time. Returns null when the row does
 * not say enough to rebuild the request honestly.
 *
 * It carries the row's platforms and — only if it is still ahead — its
 * schedule. A re-audit found the first version rebuilt only the format while
 * the composer said "the failed post's settings are filled in": an
 * Instagram-only post scheduled for 10:05 came back as Instagram + Threads,
 * unscheduled. retryCarriedSummary() now says exactly what was carried.
 */
export function retryBodyFromFailedPost(
	post:
		| {
				content?: unknown;
				platforms?: unknown;
				scheduled_date?: unknown;
				scheduled_time?: unknown;
		  }
		| null
		| undefined,
	now: Date = new Date()
): Record<string, unknown> | null {
	let parsed: unknown;
	try {
		parsed = typeof post?.content === 'string' ? JSON.parse(post.content) : post?.content;
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object') return null;
	const c = parsed as {
		topic?: unknown;
		intended?: { media?: unknown; format?: unknown; still?: unknown };
		studio?: { template?: unknown; standalone?: unknown };
	};
	const intended = c.intended && typeof c.intended === 'object' ? c.intended : null;
	const media = intended?.media;
	if (!intended || (media !== 'image' && media !== 'video' && media !== 'cinematic')) return null;

	const body: Record<string, unknown> = { media };
	if (typeof intended.format === 'string' && intended.format) body.format = intended.format;
	if (intended.still === 'graphic') body.still = 'graphic';
	if (typeof c.topic === 'string' && c.topic.trim()) body.topic = c.topic.trim();
	const studio = c.studio && typeof c.studio === 'object' ? c.studio : null;
	if (studio?.template) body.studio_template = studio.template;
	if (studio?.standalone) body.deliver = 'asset';

	// Platforms: the server keeps only the ones still connected, so a platform
	// disconnected since shows as not connected rather than silently swapped.
	const platforms = Array.isArray(post?.platforms)
		? post.platforms.filter((p): p is string => typeof p === 'string' && p.length > 0)
		: [];
	if (platforms.length > 0 && !studio?.standalone) body.platforms = platforms;

	// Schedule: only a time still in the future. A slot that has passed is not
	// carried — scheduling "now" by accident is worse than asking again.
	const date = typeof post?.scheduled_date === 'string' ? post.scheduled_date : '';
	const time = typeof post?.scheduled_time === 'string' ? post.scheduled_time : '';
	if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		const at = new Date(`${date}T${/^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : '23:59'}:00`);
		if (!Number.isNaN(at.getTime()) && at.getTime() > now.getTime()) {
			body.scheduled_date = date;
			if (/^\d{2}:\d{2}/.test(time)) body.scheduled_time = time.slice(0, 5);
		}
	}
	return body;
}

/**
 * The composer subtitle for a retry: what was actually carried over, so it can
 * never again claim settings it did not fill in.
 */
export function retryCarriedSummary(
	body: Record<string, unknown>,
	failed?: { scheduled_date?: unknown } | null
): string {
	const carried: string[] = ['format'];
	if (typeof body.topic === 'string') carried.push('topic');
	const plats = Array.isArray(body.platforms) ? (body.platforms as string[]) : [];
	if (plats.length > 0)
		carried.push(
			`platforms (${plats.map((p) => PLATFORM_NAMES[p.toLowerCase()] ?? p).join(', ')})`
		);
	if (typeof body.scheduled_date === 'string') carried.push('schedule');
	const list =
		carried.length === 1
			? carried[0]
			: `${carried.slice(0, -1).join(', ')} and ${carried[carried.length - 1]}`;
	const passed =
		typeof failed?.scheduled_date === 'string' && typeof body.scheduled_date !== 'string'
			? ' Its original time has passed, so pick a new one if it should be scheduled.'
			: '';
	const unconnected =
		plats.length > 0
			? ' A platform that is no longer connected cannot be picked — the Deliver step says so.'
			: '';
	return `The failed post’s ${list} ${carried.length === 1 ? 'is' : 'are'} filled in below.${passed}${unconnected} Check the price and edit anything before approving.`;
}
