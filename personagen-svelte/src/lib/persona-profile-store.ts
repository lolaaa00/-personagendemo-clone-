/**
 * Persona Profile store — the single typed accessor for a persona's extended
 * profile (audience, archetype, appearance, voice, identity kit).
 *
 * ── Why this module exists ────────────────────────────────────────────────
 * `agents.market` was declared `TEXT DEFAULT 'Australia'` — a country string.
 * At some point the whole persona profile started being written into it as a
 * JSON string, and the column never got renamed or retyped. The result is a
 * defensive `typeof a.market === 'string' && a.market.startsWith('{')` +
 * `JSON.parse` in a try/catch duplicated across the engine, the persona page,
 * the profile generator and content generation. Two concrete bugs fall out of
 * that duplication:
 *
 *   1. Every reader re-implements "is this JSON or a legacy country string?",
 *      and they don't all agree.
 *   2. SILENT DATA LOSS — the writer serialises a hand-written object literal,
 *      so any field the literal forgets is dropped on save. We have already
 *      been bitten by this. `mergePersonaProfile` below is the fix.
 *
 * The migration (supabase/personas_profile_migration.sql) adds a real
 * `personas_profile JSONB` column alongside `market`, backfilled from it. Both
 * are still written so a database that has NOT run the migration yet (client
 * bootstraps) keeps working via the `market` fallback. No external service
 * reads `market` (`services/mcp-bridge` verified 2026-09-05). Hence the
 * dual-READ order below.
 *
 * Client-safe on purpose: no `$env`, no `lib/server` imports, so API routes,
 * the engine, and Svelte components can all import the same accessor.
 */
import {
	CONTENT_FOCUS_OPTIONS,
	PERSONA_ARCHETYPES,
	coerceAgeRanges,
	coerceAppearance,
	coerceToOption,
	stripLeadingAvatarName
} from './persona-profile';
import {
	coerceBios,
	coerceConfirmedHandles,
	coerceHandleCandidates,
	type HandleCandidate
} from './persona-identity';
import { AGE_RANGE_BOUNDS, ageBoundsFromRanges, deriveAgeRanges } from './persona-age';
import { isPersonaProfileV2 } from './persona-contract/schema';
import { downgradeV2toV1 } from './persona-contract/upgrade';

// Re-exported so every existing importer keeps working; the helpers moved to a
// leaf module (persona-age.ts) so the v2 contract can share them without an
// import cycle through this file.
export { AGE_RANGE_BOUNDS, ageBoundsFromRanges, deriveAgeRanges };

/** The persona's own gender. `''` means "not chosen" — never `null`/`undefined` once set. */
export type PersonaGender = '' | 'female' | 'male';

/**
 * Voice characteristics inferred from the persona's NAME (e.g. "Jenny Tran" →
 * female / Vietnamese-American / soft Australian accent). Recorded for
 * observability; the closest catalog TTS voice is what actually gets pinned.
 */
export interface PersonaVoiceProfile {
	gender?: string;
	nationality?: string;
	accent?: string;
}

/**
 * The persona profile as stored. Every field is optional: profiles are built
 * incrementally (wizard → "Generate for brand" → manual edits), and a partial
 * profile is the normal case, not an error state.
 */
export interface PersonaProfile {
	/**
	 * The AUDIENCE's age buckets — NOT the persona's own age. Values are the
	 * en-dashed keys from `AGE_RANGE_KEYS` ('25–34', not '25-34').
	 */
	ageRanges?: string[];
	/** Numeric audience bounds derived from `ageRanges`; null when no bucket is selected. */
	ageMin?: number | null;
	ageMax?: number | null;
	/** The PERSONA's gender (drives portrait generation and TTS voice alignment). */
	gender?: PersonaGender;
	/** One of `PERSONA_ARCHETYPES`. */
	archetype?: string;
	/** One of `CONTENT_FOCUS_OPTIONS`. */
	contentFocus?: string;
	/** Free-text psychographic description of the audience. */
	psychProfile?: string;
	/** Free-text editorial angle the persona takes on its niche. */
	contentAngle?: string;
	/** Free-text description of the single target viewer. */
	targetAvatar?: string;
	/** Wardrobe / look variables, keyed by `APPEARANCE_FIELDS` keys. */
	appearance?: Record<string, string>;
	voiceProfile?: PersonaVoiceProfile;
	/** Platform Identity Kit: per-platform bios keyed by platform registry key. */
	bios?: Record<string, string>;
	/** Username candidates with MANUAL availability status (untried/taken/confirmed). */
	handleCandidates?: HandleCandidate[];
	/** Platform key → the handle the user actually registered. */
	confirmedHandles?: Record<string, string>;
	/** Public display name (distinct from the persona's internal `agents.name`). */
	displayName?: string;
}

/**
 * The complete key set. Anything not listed here is stripped by
 * `serializePersonaProfile` and ignored by `mergePersonaProfile`, which is what
 * keeps the blob from accreting dead keys forever.
 */
export const PERSONA_PROFILE_KEYS = [
	'ageRanges',
	'ageMin',
	'ageMax',
	'gender',
	'archetype',
	'contentFocus',
	'psychProfile',
	'contentAngle',
	'targetAvatar',
	'appearance',
	'voiceProfile',
	'bios',
	'handleCandidates',
	'confirmedHandles',
	'displayName'
] as const satisfies readonly (keyof PersonaProfile)[];

/** Parses a JSON object string, or returns null. Never throws. */
function parseObject(value: unknown): Record<string, unknown> | null {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	// The legacy `market` value is a bare country string ('Australia'). Only a
	// value that actually opens as a JSON object is worth parsing — this is the
	// check that keeps 'Australia' from becoming garbage instead of {}.
	if (!trimmed.startsWith('{')) return null;
	try {
		const parsed = JSON.parse(trimmed);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

/**
 * Reads a persona profile off an agent row. **This is the only supported way to
 * read it** — do not hand-roll `JSON.parse(agent.market)`.
 *
 * Dual-read precedence, in order:
 *   1. `personas_profile` — the JSONB column. Supabase hands JSONB back already
 *      decoded, so this is normally an object; a JSON string is tolerated for
 *      the case where a caller round-tripped it through a TEXT path.
 *   2. `market` — ONLY when it is a string that opens with `{`. This is the
 *      pre-migration home of the profile and stays readable until every writer
 *      has moved over and the backfill is confirmed everywhere.
 *
 * `personas_profile` wins whenever it holds an object, even a partial one:
 * after the migration it is the column that gets written first, so treating it
 * as authoritative is what makes a partially-migrated row read correctly.
 *
 * Never throws. Malformed JSON, a legacy country string, a number, an array,
 * `null`, `undefined` — all return `{}`.
 *
 * Deliberately does NOT coerce field values: reading is lossless so an unknown
 * or slightly-off value survives a read/write round trip through
 * `mergePersonaProfile`. `serializePersonaProfile` is the normalising gate.
 */
export function readPersonaProfile(
	agent: { personas_profile?: unknown; market?: unknown } | null | undefined
): PersonaProfile {
	const raw = readStoredProfileObject(agent);
	// v2 blob behind a v1 reader: downgrade losslessly (labels back, verbatim
	// text preferred, unknown keys restored) so every legacy consumer keeps
	// working the day the save path starts writing v2. A v1 blob is returned
	// exactly as stored — no upgrade/downgrade round trip, no normalisation.
	if (isPersonaProfileV2(raw)) return downgradeV2toV1(raw);
	return raw as PersonaProfile;
}

/**
 * The raw stored object, whatever its shape (v1 or v2), with the same dual-read
 * precedence as `readPersonaProfile`. Never throws; `{}` for anything unusable.
 * Shared with the v2 store (`persona-contract/store.ts`).
 */
export function readStoredProfileObject(
	agent: { personas_profile?: unknown; market?: unknown } | null | undefined
): Record<string, unknown> {
	if (!agent || typeof agent !== 'object') return {};
	return parseObject(agent.personas_profile) ?? parseObject(agent.market) ?? {};
}

/** Keeps only the three known voice keys as trimmed non-empty strings. */
export function coerceVoiceProfile(value: unknown): PersonaVoiceProfile {
	const out: PersonaVoiceProfile = {};
	if (value && typeof value === 'object') {
		for (const key of ['gender', 'nationality', 'accent'] as const) {
			const v = (value as Record<string, unknown>)[key];
			if (typeof v === 'string' && v.trim()) out[key] = v.trim();
		}
	}
	return out;
}

/** Trimmed string, or '' for anything that isn't a string. */
function coerceText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/**
 * Canonical option when the value matches one (exact or loose, case-insensitive),
 * else the trimmed value itself, else ''. Lossless for anything a user actually
 * typed; only non-strings become ''.
 */
function coerceStrategyPick(value: unknown, options: readonly string[]): string {
	return coerceToOption(value, options) || coerceText(value);
}

/**
 * Normalises a profile for storage: coerces each known field through the same
 * helpers the UI and the generator already use, and STRIPS every unknown key.
 *
 * Key presence is preserved exactly: a key absent from the input is absent from
 * the output. That is what makes serialize-then-merge safe — see
 * `mergePersonaProfile`, where an absent key means "leave the stored value
 * alone". Serialising a partial profile must not silently assert emptiness for
 * the fields it doesn't mention.
 *
 * The one exception is `ageMin`/`ageMax`: whenever `ageRanges` is present they
 * are re-derived from it, because they are a projection of the buckets rather
 * than independent state.
 *
 * Returns an object — the caller decides whether to stringify (see
 * `profileToMarketString` for the `market` back-compat write).
 */
export function serializePersonaProfile(
	profile: PersonaProfile | null | undefined
): PersonaProfile {
	const p = (profile ?? {}) as Record<string, unknown>;
	const out: PersonaProfile = {};
	const has = (key: string) => Object.prototype.hasOwnProperty.call(p, key);

	if (has('ageRanges')) {
		const ranges = coerceAgeRanges(p.ageRanges);
		out.ageRanges = ranges;
		// Derived, always — never trust incoming numbers when buckets are given.
		const bounds = ageBoundsFromRanges(ranges);
		out.ageMin = bounds.ageMin;
		out.ageMax = bounds.ageMax;
	} else {
		if (has('ageMin')) out.ageMin = typeof p.ageMin === 'number' ? p.ageMin : null;
		if (has('ageMax')) out.ageMax = typeof p.ageMax === 'number' ? p.ageMax : null;
	}

	if (has('gender')) {
		out.gender = p.gender === 'female' || p.gender === 'male' ? p.gender : '';
	}
	// Strategy picks snap onto the canonical option when they match (case/partial),
	// and are otherwise kept VERBATIM — same "stored values are sacred" rule as
	// appearance. Blanking an off-list value here would silently erase a legacy
	// archetype on the next ordinary save; the UI shows off-list values as an
	// extra select option instead, and LLM output is snapped at the generator.
	if (has('archetype')) out.archetype = coerceStrategyPick(p.archetype, PERSONA_ARCHETYPES);
	if (has('contentFocus'))
		out.contentFocus = coerceStrategyPick(p.contentFocus, CONTENT_FOCUS_OPTIONS);
	if (has('psychProfile')) out.psychProfile = coerceText(p.psychProfile);
	if (has('contentAngle')) out.contentAngle = coerceText(p.contentAngle);
	// Strips a leading fictional proper name left by the old "name the audience"
	// prompt bug, so the fix self-persists on the next save.
	if (has('targetAvatar')) out.targetAvatar = stripLeadingAvatarName(coerceText(p.targetAvatar));
	if (has('appearance')) out.appearance = coerceAppearance(p.appearance);
	if (has('voiceProfile')) out.voiceProfile = coerceVoiceProfile(p.voiceProfile);
	if (has('bios')) out.bios = coerceBios(p.bios);
	if (has('handleCandidates')) out.handleCandidates = coerceHandleCandidates(p.handleCandidates);
	if (has('confirmedHandles')) out.confirmedHandles = coerceConfirmedHandles(p.confirmedHandles);
	if (has('displayName')) out.displayName = coerceText(p.displayName);

	return out;
}

/**
 * Merges a partial update into the stored profile. **This is the fix for the
 * silent-data-loss bug**: the old save path stringified a hand-written literal,
 * so any field that literal forgot to include was wiped from storage.
 *
 * THE MERGE RULE — read this before changing anything here:
 *
 *   • A key ABSENT from the patch PRESERVES the existing value. "I didn't
 *     mention it" means "I don't know about it", never "delete it". A caller
 *     that only edits bios cannot destroy the appearance config.
 *   • An explicit `null` or `undefined` in the patch ALSO preserves the
 *     existing value. `{ archetype: undefined }` is what a partially-populated
 *     object literal looks like, and it must behave identically to omitting the
 *     key — otherwise the original bug walks straight back in through a
 *     different door.
 *   • Only an explicit EMPTY VALUE clears: `''`, `[]`, `{}`. Those are what the
 *     UI actually sends when a user clears a field, so they are unambiguous
 *     intent.
 *   • `ageMin`/`ageMax` are the sole exception to "absent preserves": when the
 *     patch sets `ageRanges`, the bounds are re-derived from it, because stale
 *     numbers against fresh buckets is a worse failure than losing them.
 *
 * Unknown keys in the patch are ignored; unknown keys already on `existing` are
 * carried through untouched, so a field added by a newer client isn't destroyed
 * by an older one.
 */
export function mergePersonaProfile(
	existing: PersonaProfile | null | undefined,
	patch: Partial<PersonaProfile> | null | undefined
): PersonaProfile {
	const out: PersonaProfile = { ...(existing ?? {}) };
	if (!patch || typeof patch !== 'object') return out;

	for (const key of PERSONA_PROFILE_KEYS) {
		const value = (patch as Record<string, unknown>)[key];
		// null / undefined === "no opinion". See THE MERGE RULE above.
		if (value === null || value === undefined) continue;
		(out as Record<string, unknown>)[key] = value;
	}

	// Bounds follow the buckets whenever the buckets are restated.
	if (Array.isArray(patch.ageRanges)) {
		const bounds = ageBoundsFromRanges(patch.ageRanges);
		out.ageMin = bounds.ageMin;
		out.ageMax = bounds.ageMax;
	}

	return out;
}

// `profileToMarketString` was deleted in Persona Model v2 P0.6: nothing writes
// profile JSON to `agents.market` any more (market_restore_migration.sql returned
// the column to a market string). The READ fallback in readStoredProfileObject
// stays for rows whose personas_profile is still NULL; it matches nothing once
// those rows have saved once.
