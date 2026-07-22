/**
 * Platform Identity Kit — per-platform bios, username candidates, and display
 * name for a persona. Client-safe (no server imports) so the engine generator,
 * the persona page UI, and tests all share one source of truth.
 *
 * IMPORTANT product constraint: none of this can be pushed to the platforms via
 * API (Zernio has no profile-update endpoints, and Instagram/TikTok forbid it
 * entirely) — the kit is a generate → copy-paste setup aid. Availability of a
 * username is confirmed MANUALLY: the user tries candidates at signup, marks the
 * ones that were taken, and confirms the one that worked. Once an account is
 * connected, Zernio's account sync returns the real username as ground truth.
 */
import { PLATFORMS } from './platforms';

/** Bio length limit + the stylistic register the generator should write in. */
export interface PlatformBioSpec {
	/** Hard character limit enforced by the platform's profile editor. */
	limit: number;
	/** Register hint fed to the LLM prompt (tone, shape, emoji policy). */
	style: string;
}

/**
 * Per-platform bio constraints, keyed by the platform registry keys. Limits are
 * the platforms' profile-editor caps (well-known values; a bio the user edits
 * over the limit is flagged in the UI, never silently truncated).
 */
export const PLATFORM_BIO_SPECS: Record<string, PlatformBioSpec> = {
	tiktok: { limit: 80, style: 'punchy 1–2 short lines, an emoji or two' },
	instagram: {
		limit: 150,
		style: '2–4 short lines separated by \\n, tasteful emojis, niche keywords'
	},
	x: { limit: 160, style: 'a witty one-liner with a clear point of view' },
	facebook: { limit: 101, style: 'one crisp page-intro sentence' },
	youtube: {
		limit: 1000,
		style:
			'channel description — the creator’s story, what they post, upload cadence, searchable keywords'
	},
	threads: { limit: 500, style: 'conversational, 2–3 lines, lighter than Instagram' },
	linkedin: { limit: 220, style: 'professional headline — role | value | credibility' },
	bluesky: { limit: 256, style: 'casual and personal, no marketing-speak' },
	pinterest: { limit: 500, style: 'keyword-rich — what ideas/boards people will find' },
	reddit: { limit: 200, style: 'plain and community-first, zero salesiness' },
	googlebusiness: { limit: 750, style: 'business description — what, for whom, why trust it' },
	telegram: { limit: 255, style: 'channel description — what subscribers get and how often' },
	snapchat: { limit: 80, style: 'short and playful' }
};

/** Platforms that get a generated bio — registry order, only known specs. */
export const BIO_PLATFORM_KEYS = Object.keys(PLATFORMS).filter((k) => PLATFORM_BIO_SPECS[k]);

/**
 * Default bio set for a persona with no connected accounts yet. Kit generation
 * is deliberately per-platform / small-batch: a single all-13-bios LLM call
 * overflows response token caps (truncated JSON) and flirts with the 120s LLM
 * deadline — the exact "generates then times out" failure.
 */
export const STARTER_BIO_PLATFORMS = ['tiktok', 'instagram', 'youtube'] as const;

export function bioLimit(platform: string | null | undefined): number | null {
	return PLATFORM_BIO_SPECS[platform ?? '']?.limit ?? null;
}

/**
 * Keeps only known platform keys with non-empty string bios. Deliberately does
 * NOT truncate to the platform limit — the user may be mid-edit and the UI shows
 * a live over-limit counter instead — but caps at a storage-sanity length.
 */
export function coerceBios(value: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (value && typeof value === 'object') {
		for (const key of BIO_PLATFORM_KEYS) {
			const v = (value as Record<string, unknown>)[key];
			if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, 2000);
		}
	}
	return out;
}

// ── Username candidates ────────────────────────────────────────────────────

/**
 * The universal handle rule: X is the strictest platform (15 chars, no
 * periods), so a candidate matching this works EVERYWHERE. Longer/dotted
 * candidates are still allowed — they just carry a compatibility note.
 */
export const UNIVERSAL_HANDLE_RE = /^[a-z0-9_]{2,15}$/;

/** Longest handle any supported platform accepts (Instagram/TikTok/YouTube ≤30). */
export const HANDLE_MAX = 30;

export type HandleStatus = 'untried' | 'taken' | 'confirmed';

export interface HandleCandidate {
	handle: string;
	/**
	 * Manual availability tracking: 'untried' → not yet attempted at signup,
	 * 'taken' → the user tried it and the platform rejected it,
	 * 'confirmed' → the user registered it somewhere.
	 */
	status: HandleStatus;
}

/** Lowercases and strips everything no platform accepts (keeps a-z 0-9 _ .). */
export function sanitizeHandle(raw: unknown): string {
	if (typeof raw !== 'string') return '';
	return raw
		.toLowerCase()
		.replace(/^@+/, '')
		.replace(/[^a-z0-9._]/g, '')
		.replace(/^\.+|\.+$/g, '')
		.slice(0, HANDLE_MAX);
}

/**
 * Human-readable note about which platforms a handle does NOT fit, or null when
 * it satisfies the universal rule (≤15 chars, a-z 0-9 _) and works everywhere.
 */
export function handleCompatNote(handle: string): string | null {
	const h = sanitizeHandle(handle);
	if (!h) return null;
	const issues: string[] = [];
	if (h.length > 15 || h.includes('.')) {
		issues.push(h.includes('.') ? 'X (no periods, max 15)' : 'X (max 15)');
	}
	if (h.length > 24) issues.push('TikTok (max 24)');
	return issues.length ? `Won’t fit ${issues.join(' or ')}` : null;
}

const HANDLE_STATUSES: readonly HandleStatus[] = ['untried', 'taken', 'confirmed'];

/** Sanitizes, dedupes, and status-coerces a stored/LLM candidate list. */
export function coerceHandleCandidates(value: unknown, cap = 16): HandleCandidate[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const out: HandleCandidate[] = [];
	for (const item of value) {
		// Accept both bare strings (LLM output) and {handle, status} objects (storage).
		const raw = typeof item === 'string' ? item : item?.handle;
		const handle = sanitizeHandle(raw);
		if (!handle || seen.has(handle)) continue;
		seen.add(handle);
		const status: HandleStatus = HANDLE_STATUSES.includes(item?.status) ? item.status : 'untried';
		out.push({ handle, status });
		if (out.length >= cap) break;
	}
	return out;
}

/**
 * Merges freshly generated candidates into the existing list WITHOUT losing the
 * user's manual availability work: existing entries keep their taken/confirmed
 * status; only genuinely new handles are appended.
 */
export function mergeHandleCandidates(
	existing: HandleCandidate[],
	fresh: HandleCandidate[],
	cap = 16
): HandleCandidate[] {
	const merged = [...existing];
	const seen = new Set(existing.map((c) => c.handle));
	for (const c of fresh) {
		if (seen.has(c.handle)) continue;
		seen.add(c.handle);
		merged.push({ handle: c.handle, status: 'untried' });
	}
	return merged.slice(0, cap);
}

/** Keeps only registry platform keys with a non-empty sanitized handle. */
export function coerceConfirmedHandles(value: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (value && typeof value === 'object') {
		for (const key of Object.keys(PLATFORMS)) {
			const h = sanitizeHandle((value as Record<string, unknown>)[key]);
			if (h) out[key] = h;
		}
	}
	return out;
}
