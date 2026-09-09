/**
 * Persona Model v2 — deterministic per-field re-roll (P1.5).
 *
 * "Give me a different job for this creator" must change the job and nothing
 * else. The face, the name, the age and the heritage have to survive, or the
 * button is a persona shredder rather than a persona editor.
 *
 * WHY A TABLE AND NOT A DEPENDENCY GRAPH
 *
 * `samplePersonaSkeleton` is monolithic: it draws every field in one pass, in a
 * fixed dependency order, and there is no way to ask it for one leaf. The only
 * honest way to re-draw a part of a persona is therefore:
 *
 *   1. run the WHOLE sampler again under a re-roll seed,
 *   2. pin, through `SkeletonConstraints`, everything the group must not move,
 *   3. copy back ONLY the leaves the group owns.
 *
 * Step 3 is what makes `look.*` safe during a job re-roll: the second draw has a
 * completely different face, and we simply never read it.
 *
 * The mapping from "field the user clicked" to (owned leaves, pinned facts) is
 * an explicit table below — REROLL_GROUPS. A generic dependency graph derived
 * from the registry gates would be cleverer and much harder to trust: a reviewer
 * cannot see, in a diff, that a change to it just started re-rolling faces. The
 * table can be read in ten seconds and its blast radius is literally listed.
 *
 * THREE CONSEQUENCES OF THE SAMPLER'S CONSTRAINT SURFACE, all deliberate:
 *
 * - `creator.education` is OWNED BY `creator.work`. Education gates occupations
 *   ('Physiotherapist' needs bachelor/postgraduate) and income, but
 *   `SkeletonConstraints` has no `education` field, so it cannot be pinned. If
 *   the group did not own it, a job re-roll could hand a 'secondary'-educated
 *   creator a physiotherapy job. Owning it keeps the pair coherent. (The better
 *   fix is an `education` constraint on the sampler; that file is not ours.)
 * - `creator.economic.incomeBand` is OWNED BY `creator.work` for the same
 *   reason, and there is deliberately no standalone economic group: income is
 *   gated on education and seniority, so re-rolling it alone could contradict
 *   the stored job.
 * - `creator.work.employmentStatus` is owned by BOTH work and household,
 *   because the sampler re-draws it once children are known (the 'homemaker
 *   with nobody at home' rule). Ties resolve to the first matching row, so the
 *   exact path `creator.work.employmentStatus` re-rolls the job.
 *
 * `strategy.niche` is intentionally NOT rerollable: niche conditions occupation,
 * personality, look and positioning, so "re-roll the niche" is "re-roll the
 * persona" — that is regeneration, not a field edit.
 *
 * PROVENANCE IS ABSOLUTE. A leaf whose `meta.fieldSources` entry is 'user' or
 * 'extracted' is never written and never deleted, even inside the group being
 * re-rolled. Provenance is leaf-level, so a user-typed title can end up beside a
 * re-rolled domain; that is the accepted price of never destroying typed input.
 * Everything this module writes is stamped 'sampled', matching the sampler.
 *
 * PURE. No clock (the sampler's injectable `now` is fed a fixed value and its
 * `meta` is discarded anyway), no I/O, no randomness outside the seeded RNG.
 * Same profile + same path + same nonce => byte-identical result, forever.
 */
import { describeProfile } from '$lib/persona-contract/describe';
import { getPath, isObj, leafPaths, setPath, type Obj } from '$lib/persona-contract/paths';
import { seedHash } from '$lib/persona-contract/rng';
import { samplePersonaSkeleton, type SkeletonConstraints } from '$lib/persona-contract/sampler';
import type {
	FieldSource,
	PersonaDescription,
	PersonaProfileV2
} from '$lib/persona-contract/schema';

/** A fact a group may carry over from the existing profile into the re-draw. */
export type PinKey = 'market' | 'name' | 'gender' | 'age' | 'heritage' | 'niche' | 'incomeBand' | 'education';

export interface RerollGroup {
	/** Stable key; also accepted directly as a `fieldPath`. */
	key: string;
	/** Leaf paths this group REPLACES. Anything not listed here cannot move. */
	owns: readonly string[];
	/** Facts pinned into the re-draw so they cannot change. */
	pins: readonly PinKey[];
}

/** Every pin the sampler supports; spelled out per row so the table reads in a diff. */
const EVERY_PIN: readonly PinKey[] = [
	'market',
	'name',
	'gender',
	'age',
	'heritage',
	'niche',
	'incomeBand',
	'education'
];

/**
 * The whole blast-radius contract of a re-roll, in one readable table.
 *
 * ORDER IS SIGNIFICANT: a path owned by more than one group resolves to the
 * first row that claims it.
 */
export const REROLL_GROUPS: readonly RerollGroup[] = [
	{
		key: 'creator.work',
		owns: [
			'creator.work.domain',
			'creator.work.title',
			'creator.work.seniority',
			'creator.work.employmentStatus',
			'creator.work.workLocationMode',
			'creator.economic.incomeBand',
			'creator.economic.priceFrame'
		],
		// incomeBand is NOT pinned: a new job is allowed to pay differently.
		// education IS pinned: a re-roll of the job must not rewrite the degree
		// that qualified the creator for it.
		pins: ['market', 'name', 'gender', 'age', 'heritage', 'niche', 'education']
	},
	{
		key: 'creator.household',
		owns: [
			'creator.household.relationshipStatus',
			'creator.household.children.count',
			'creator.household.children.ageBands',
			'creator.household.pets',
			'creator.household.housingType',
			// The sampler re-draws employment once children are known; without this
			// a household re-roll could leave a 'homemaker' with an empty house.
			'creator.work.employmentStatus'
		],
		pins: EVERY_PIN
	},
	{
		key: 'creator.location',
		owns: [
			'creator.location.region',
			'creator.location.city',
			'creator.location.geographicContext',
			'creator.location.timezone'
		],
		pins: EVERY_PIN
	},
	{
		key: 'creator.lifestyle',
		// socialPlatformsUsed is never sampled, so it is not owned and never cleared.
		owns: [
			'creator.lifestyle.activityLevel',
			'creator.lifestyle.transportMode',
			'creator.lifestyle.dietaryStyle'
		],
		pins: EVERY_PIN
	},
	{
		key: 'creator.bigFive',
		owns: [
			'creator.bigFive.openness',
			'creator.bigFive.conscientiousness',
			'creator.bigFive.extraversion',
			'creator.bigFive.agreeableness',
			'creator.bigFive.neuroticism',
			'creator.traitLabels'
		],
		pins: EVERY_PIN
	},
	{
		key: 'creator.name',
		owns: ['creator.firstName', 'creator.lastName', 'creator.displayName'],
		// 'name' is deliberately absent: pinning it would make this a no-op.
		pins: ['market', 'gender', 'age', 'heritage', 'niche', 'incomeBand']
	},
	{
		key: 'look',
		// The `*Text` companions are v1 verbatim values that OUTRANK the tokens in
		// the prompt builder, and `promptCues` is a cached render of the whole
		// look. A re-roll that left them behind would show the old face. They are
		// owned so they are cleared — unless provenance protects them, in which
		// case the user's own words survive and win, which is correct.
		owns: [
			'look.skinTone',
			'look.skinToneText',
			'look.bodyType',
			'look.bodyTypeText',
			'look.heightCm',
			'look.faceShape',
			'look.browShape',
			'look.hair.color',
			'look.hair.colorText',
			'look.hair.grayCoverage',
			'look.hair.length',
			'look.hair.lengthText',
			'look.hair.texture',
			'look.hair.style',
			'look.hair.styleText',
			'look.facialHair',
			'look.eyes.color',
			'look.eyes.colorText',
			'look.eyewear',
			'look.promptCues'
		],
		pins: EVERY_PIN
	},
	{
		key: 'strategy.positioning',
		owns: ['strategy.archetype', 'strategy.archetypeText', 'strategy.contentFocus', 'strategy.contentFocusText'],
		pins: EVERY_PIN
	}
];

/**
 * The group a clicked field belongs to, or undefined when the field is not
 * rerollable. Never throws: callers include an HTTP handler.
 *
 * A path matches when it IS the group key, IS an owned leaf, or is an ancestor
 * of one ('look.hair' → the look group). A bare section name like 'creator' is
 * rejected: it is not a field, and matching it would silently re-roll a job.
 */
export function rerollGroupFor(fieldPath: unknown): RerollGroup | undefined {
	if (typeof fieldPath !== 'string') return undefined;
	const path = fieldPath.trim();
	if (!path) return undefined;
	return REROLL_GROUPS.find(
		(group) =>
			group.key === path ||
			group.owns.includes(path) ||
			(path.includes('.') && group.owns.some((owned) => owned.startsWith(`${path}.`)))
	);
}

/** Every rerollable group key, for a UI that wants to render the buttons. */
export function rerollableGroupKeys(): string[] {
	return REROLL_GROUPS.map((group) => group.key);
}

/**
 * Re-samples one part of `profile`, leaving everything else byte-identical.
 *
 * @param fieldPath a group key or any leaf inside a group. Unknown or
 *                  non-rerollable paths return the profile unchanged.
 * @param nonce     changes the draw; the same nonce always gives the same draw.
 */
export function rerollField(
	profile: PersonaProfileV2,
	fieldPath: string,
	nonce: string | number
): PersonaProfileV2 {
	const out = clone(profile);
	const group = rerollGroupFor(fieldPath);
	if (!group) return out;

	const seed = `${baseSeed(profile)}:${fieldPath}:${String(nonce)}`;
	// `now` is pinned so the sampler never reads the clock; its meta is discarded.
	const draw = samplePersonaSkeleton(seed, constraintsFor(profile, group.pins), { now: FIXED_NOW });

	const meta = (out.meta ??= { schemaVersion: 2 });
	const sources: Record<string, FieldSource> = (meta.fieldSources ??= {});
	const root = out as unknown as Obj;
	const drawn = draw as unknown as Obj;

	for (const path of group.owns) {
		if (!isWritable(sources, path)) continue;
		const value = getPath(drawn, path);
		if (value === undefined) {
			// The re-draw has no opinion here (childless household, no pets, a v1
			// text companion the sampler never writes) — so neither may the profile.
			deleteLeaf(root, path);
			delete sources[path];
		} else {
			setPath(root, path, value);
			sources[path] = 'sampled';
		}
	}

	applyDerivedDescription(out, sources);
	return out;
}

// ── description ────────────────────────────────────────────────────────────

/**
 * The `description` block, recomputed from a profile's own fields.
 *
 * `description` is DERIVED — the sampler builds it at the end of a draw from the
 * facts above it — so after a re-roll it is stale by definition, and it cannot
 * simply be copied from the re-draw (that draw has a different city and a
 * different household). It is rebuilt here instead.
 *
 * Exported so the spec can assert this reproduces the sampler's own output for a
 * freshly sampled profile; that test is what stops the two from drifting.
 */
export function deriveDescription(profile: PersonaProfileV2): PersonaDescription | undefined {
	return describeProfile(profile);
}

/** Writes the derived description in place, honouring provenance on both leaves. */
function applyDerivedDescription(profile: PersonaProfileV2, sources: Record<string, FieldSource>): void {
	const derived = deriveDescription(profile);
	if (!derived) return;
	const root = profile as unknown as Obj;
	if (isWritable(sources, 'description.short')) {
		setPath(root, 'description.short', derived.short);
		sources['description.short'] = 'sampled';
	}
	if (isWritable(sources, 'description.frame')) {
		setPath(root, 'description.frame', derived.frame);
		sources['description.frame'] = 'sampled';
	}
}

// ── internals ──────────────────────────────────────────────────────────────

/** Any fixed instant: the sampler's `generatedAt` is discarded, this only removes the clock. */
const FIXED_NOW = '1970-01-01T00:00:00.000Z';

function clone(profile: PersonaProfileV2): PersonaProfileV2 {
	return JSON.parse(JSON.stringify(profile)) as PersonaProfileV2;
}

/** Automation may write an unknown, 'sampled' or 'derived' leaf — never 'user' or 'extracted'. */
function isWritable(sources: Record<string, FieldSource>, path: string): boolean {
	const source = sources[path];
	return source === undefined || source === 'sampled' || source === 'derived';
}

/** Deletes a leaf and any containers it just emptied, so no `{}` husks are left behind. */
function deleteLeaf(root: Obj, path: string): void {
	const segs = path.split('.');
	for (let depth = segs.length; depth > 1; depth--) {
		const parent = getPath(root, segs.slice(0, depth - 1).join('.'));
		if (!isObj(parent)) return;
		delete parent[segs[depth - 1]];
		if (Object.keys(parent).length > 0) return;
	}
	delete root[segs[0]];
}

/**
 * The seed a re-roll is derived from.
 *
 * Hand-built and v1-upgraded profiles have no `meta.seed`, and a re-roll must
 * still work for them, so the fallback hashes the profile's own content — sorted
 * by path, so it does not depend on key order — into a stable synthetic seed.
 * Same profile, same fallback seed, every time.
 */
function baseSeed(profile: PersonaProfileV2): string {
	const stored = profile.meta?.seed;
	if (typeof stored === 'string' && stored.trim()) return stored;
	const root = profile as unknown as Obj;
	const parts: string[] = [];
	for (const section of ['creator', 'look', 'strategy'] as const) {
		const sub = root[section];
		if (!isObj(sub)) continue;
		for (const leaf of leafPaths(sub, section)) parts.push(`${leaf}=${JSON.stringify(getPath(root, leaf))}`);
	}
	return `derived:${seedHash(parts.sort().join('|')).toString(36)}`;
}

/** Carries the group's pinned facts out of the existing profile and into the re-draw. */
function constraintsFor(profile: PersonaProfileV2, pins: readonly PinKey[]): SkeletonConstraints {
	const creator = profile.creator ?? {};
	const out: SkeletonConstraints = {};
	const pinned = (key: PinKey) => pins.includes(key);

	if (pinned('market') && creator.market) out.market = creator.market;
	if (pinned('name')) {
		const name = (creator.displayName ?? [creator.firstName, creator.lastName].filter(Boolean).join(' ')).trim();
		if (name) out.name = name;
	}
	if (pinned('gender') && creator.gender) out.gender = creator.gender;
	if (pinned('age') && typeof creator.age === 'number' && Number.isFinite(creator.age)) {
		out.ageRange = [creator.age, creator.age];
	}
	if (pinned('heritage') && creator.heritage) out.heritage = creator.heritage;
	if (pinned('niche') && profile.strategy?.niche) out.niche = profile.strategy.niche;
	if (pinned('incomeBand') && creator.economic?.incomeBand) out.incomeBand = creator.economic.incomeBand;
	if (pinned('education') && creator.education) out.education = creator.education;
	return out;
}
