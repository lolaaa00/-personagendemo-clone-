/**
 * Persona Model v2 — silent backfill, Tier 1 (P1.7).
 *
 * TIER 1 IS A PURE FUNCTION OF DATA THE PROFILE ALREADY HOLDS. No sampling, no
 * extraction, no model call, no I/O. It computes only leaves that are strictly
 * implied by leaves that are already present; when an input leaf is absent the
 * derived leaf stays absent. A guess is a Tier 2 concern and must never appear
 * here — that is the whole reason Tier 1 is allowed to run on read for every
 * persona without a flag, a key or a budget.
 *
 * What it derives, and what each one needs:
 *
 *   creator.traitLabels  ← creator.bigFive          (schema: "Derived from
 *                          bigFive (≥ 65 high, ≤ 35 low)")
 *   look.promptCues      ← look (+ creator.age)     (schema: "Precomputed
 *                          prompt clause (= appearanceToPromptClause)";
 *                          look-prompt.ts: "that field IS the cached output of
 *                          this function")
 *   description.short    ← creator.displayName / firstName+lastName, plus at
 *                          least one of creator.age, creator.work.title,
 *                          creator.location.city/region
 *   description.frame    ← whichever of age / location / work / household the
 *                          profile actually has
 *
 * `description.*` is the fact list the UI renders (plan §3 P7): derived, not
 * drawn, and regenerable at any time — which is exactly why Tier 1 may rebuild
 * it. It is rendered through `label()` because a raw token in a UI string is
 * the en-dash incident waiting to happen again.
 *
 * THE WRITE RULE (narrower than the store's merge rule on purpose):
 *   • a leaf with no value is written
 *   • a leaf whose provenance is already 'derived' is RECOMPUTED (that is what
 *     "recomputed when its source changes" means in the provenance table)
 *   • every other leaf — 'user', 'extracted', 'sampled', or any value with no
 *     recorded provenance at all — is left exactly as it is
 * so a Tier 1 pass over a persona nobody has touched changes zero visible
 * fields, and only ever ADDS.
 *
 * Every leaf written is stamped 'derived' in meta.fieldSources. `meta.backfill`
 * records the pass; `at` comes from the injectable `now`, which is the only
 * non-deterministic input the function has. Two runs with the same `now`
 * produce deep-equal results.
 *
 * Never throws: a malformed, nearly-empty or wrong-shaped blob comes back as a
 * copy of itself plus, at most, the bookkeeping stamp.
 */
import { lookToPromptClause } from '$lib/persona-contract/look-prompt';
import { getPath, isObj, setPath, type Obj } from '$lib/persona-contract/paths';
import { describeFrame, describeShort } from '$lib/persona-contract/describe';
import {
	PERSONA_SCHEMA_VERSION,
	type BigFive,
	type FieldSource,
	type PersonaProfileV2
} from '$lib/persona-contract/schema';
import { BIG_FIVE_TRAIT_TOKENS, type TokenOf } from '$lib/persona-contract/tokens';

export interface BackfillTier1Options {
	/** Injectable clock, so the function is never impure. */
	now?: Date | string;
}

/** The tier this module implements. `meta.backfill.tier` never goes down. */
const TIER = 1 as const;

/** Same thresholds the sampler applies; documented on TRAIT_LABEL_TOKENS. */
const HIGH_TRAIT = 65;
const LOW_TRAIT = 35;

/** Explicit token pairs, so a trait label is never assembled from a string template. */
const TRAIT_LABELS: Record<
	keyof BigFive,
	{ high: TokenOf<'traitLabel'>; low: TokenOf<'traitLabel'> }
> = {
	openness: { high: 'high_openness', low: 'low_openness' },
	conscientiousness: { high: 'high_conscientiousness', low: 'low_conscientiousness' },
	extraversion: { high: 'high_extraversion', low: 'low_extraversion' },
	agreeableness: { high: 'high_agreeableness', low: 'low_agreeableness' },
	neuroticism: { high: 'high_neuroticism', low: 'low_neuroticism' }
};

// ── defensive readers ────────────────────────────────────────────────────────

/** A finite number, or undefined. */
function num(v: unknown): number | undefined {
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** The injectable clock as an ISO string. An unparseable `now` falls back to the real one, never throws. */
function isoNow(now: Date | string | undefined): string {
	if (now !== undefined) {
		const d = new Date(now);
		if (!Number.isNaN(d.getTime())) return d.toISOString();
	}
	return new Date().toISOString();
}

/** A copy that cannot alias the caller's object, whatever shape it is in. */
function cloneProfile<T>(value: T): T {
	try {
		return structuredClone(value);
	} catch {
		/* not structured-cloneable — fall through */
	}
	try {
		return JSON.parse(JSON.stringify(value)) as T;
	} catch {
		/* circular or non-serialisable — last resort */
	}
	return (isObj(value) ? { ...(value as unknown as Obj) } : value) as T;
}

// ── the derivations ──────────────────────────────────────────────────────────

/** The labels implied by the Big Five scores present, in canonical trait order. */
function deriveTraitLabels(bigFive: unknown): TokenOf<'traitLabel'>[] | undefined {
	if (!isObj(bigFive)) return undefined;
	const out: TokenOf<'traitLabel'>[] = [];
	for (const trait of BIG_FIVE_TRAIT_TOKENS) {
		const value = num(bigFive[trait]);
		if (value === undefined) continue;
		if (value >= HIGH_TRAIT) out.push(TRAIT_LABELS[trait].high);
		else if (value <= LOW_TRAIT) out.push(TRAIT_LABELS[trait].low);
	}
	// An empty array is a "clear" everywhere else in this contract, so a profile
	// whose every trait sits mid-range gets no leaf rather than an empty one.
	return out.length ? out : undefined;
}

/**
 * The cached appearance clause. Only for a look that actually carries
 * appearance data: without that guard a creator's age alone would conjure a
 * `look` section onto a persona that has none.
 */
function derivePromptCues(look: unknown, age: number | undefined): string | undefined {
	if (!isObj(look)) return undefined;
	const hasLookData = Object.keys(look).some(
		(key) => key !== 'promptCues' && look[key] !== undefined
	);
	if (!hasLookData) return undefined;
	const cue = lookToPromptClause(look as never, age === undefined ? undefined : { age });
	// TRIMMED, because the store trims every string leaf on write. The live
	// function returns the clause with a LEADING SPACE — it is appended straight
	// onto a prompt — so storing it verbatim produces a value that can never
	// round-trip: the store strips the space, Tier 1 re-derives it with the space,
	// and the leaf differs on every single pass. That is a backfill that rewrites
	// the same rows forever, and it survived an idempotency test because that test
	// called the function twice IN MEMORY and never went through the store.
	// A cache must hold what the store can give back.
	return cue.trim() || undefined;
}

// ── the pass ─────────────────────────────────────────────────────────────────

/**
 * Runs Tier 1 over a profile and returns a NEW profile. The input is never
 * mutated, nothing visible changes, and every leaf added is stamped 'derived'.
 */
export function backfillTier1(
	profile: PersonaProfileV2,
	options: BackfillTier1Options = {}
): PersonaProfileV2 {
	const out = cloneProfile(profile) as unknown as Obj;
	if (!isObj(out)) return profile;

	// Provenance is not optional: a leaf we cannot stamp is a leaf we must not
	// write. A blob whose `meta` is occupied by something that is not an object
	// therefore gets nothing at all.
	if (out.meta !== undefined && !isObj(out.meta)) return out as unknown as PersonaProfileV2;
	const meta: Obj = isObj(out.meta) ? out.meta : { schemaVersion: PERSONA_SCHEMA_VERSION };
	out.meta = meta;
	const sources: Record<string, FieldSource> = isObj(meta.fieldSources)
		? (meta.fieldSources as Record<string, FieldSource>)
		: {};

	/** True when nothing on the way to `path` is occupied by a non-object. */
	const ancestorsFree = (path: string): boolean => {
		const segs = path.split('.');
		let cur: Obj = out;
		for (const seg of segs.slice(0, -1)) {
			const next = cur[seg];
			if (next === undefined) return true; // setPath will create it
			if (!isObj(next)) return false; // never clobber a stored value
			cur = next;
		}
		return true;
	};

	/** Writes one derived leaf under THE WRITE RULE, and stamps its provenance. */
	const put = (path: string, value: unknown): void => {
		if (value === undefined) return;
		if (!ancestorsFree(path)) return;
		const current = getPath(out, path);
		if (current !== undefined && sources[path] !== 'derived') return; // not ours to touch
		if (current !== undefined && JSON.stringify(current) === JSON.stringify(value)) {
			sources[path] = 'derived';
			return;
		}
		setPath(out, path, value);
		sources[path] = 'derived';
	};

	const creator: Obj = isObj(out.creator) ? out.creator : {};

	put('creator.traitLabels', deriveTraitLabels(creator.bigFive));
	put('look.promptCues', derivePromptCues(out.look, num(creator.age)));
	put('description.short', describeShort(creator));
	put('description.frame', describeFrame(creator));

	if (Object.keys(sources).length) meta.fieldSources = sources;

	// Bookkeeping. `at` is the injectable clock; the tier never goes backwards,
	// so a Tier 1 pass over a persona Tier 2 already reached does not undo the
	// script's record of that.
	const previous = isObj(meta.backfill) ? meta.backfill : undefined;
	const previousTier = num(previous?.tier);
	meta.backfill = {
		tier: previousTier !== undefined && previousTier > TIER ? previousTier : TIER,
		at: isoNow(options.now)
	};

	return out as unknown as PersonaProfileV2;
}

/** The leaves Tier 1 is allowed to write. Exported for the spec and for P1.8's diff report. */
export const TIER_1_DERIVED_LEAVES = [
	'creator.traitLabels',
	'look.promptCues',
	'description.short',
	'description.frame'
] as const;
