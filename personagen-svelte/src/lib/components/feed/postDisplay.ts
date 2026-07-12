export interface PostDisplay {
	text: string;
	mediaUrl: string | null;
	mediaType: string;
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
}

const ERROR_SNIPPET_MAX = 140;

/** Clamps a stored provider error to a UI-safe length. */
export function truncateError(msg: string): string {
	const clean = msg.trim();
	return clean.length > ERROR_SNIPPET_MAX ? clean.slice(0, ERROR_SNIPPET_MAX - 1) + '…' : clean;
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

	return {
		text: parsed?.text || content || '',
		mediaUrl: parsed?.media_url || parsed?.mediaUrl || legacyMedia?.media_url || null,
		mediaType: parsed?.media_type || parsed?.mediaType || (legacyMedia ? legacyMedia.media_type?.toLowerCase() : null) || 'image',
		posterUrl: parsed?.poster_url || null,
		ugcPrompt: parsed?.ugc_broll_prompt || parsed?.ugcPrompt || null,
		script: parsed?.script || null,
		product: parsed?.product || null,
		generation: parsed?.generation || null,
		costBreakdown: parsed?.costBreakdown || null,
		format: parsed?.format || null,
		mediaGenerated: parsed?.media_generated ?? false
	};
}
