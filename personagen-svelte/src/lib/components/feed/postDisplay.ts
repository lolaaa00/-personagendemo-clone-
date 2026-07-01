export interface PostDisplay {
	text: string;
	mediaUrl: string | null;
	mediaType: string;
	posterUrl: string | null;
	ugcPrompt: string | null;
	script: string | null;
	product: any | null;
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
		product: parsed?.product || null
	};
}
