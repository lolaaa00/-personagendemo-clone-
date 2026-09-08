/**
 * Persona Model v2 — the creator skeleton sampler.
 *
 * Turns a seed (plus optional constraints) into a complete, internally coherent
 * `PersonaProfileV2` creator: who they are, where they live, what they do, who
 * is at home, how they look. No LLM, no network, no clock — a pure function of
 * (seed, constraints, registry version). The LLM's job is prose ON TOP of this
 * skeleton, never the facts themselves, because facts drawn by a language model
 * are the source of the two failures this phase exists to kill: personas that
 * are all 25–34 with wavy brown hair, and personas whose facts contradict each
 * other (a 30-year-old with a teenager, a 19-year-old "senior lead").
 *
 * THREE INVARIANTS HOLD THE WHOLE DESIGN UP:
 *
 * 1. ONE FORK PER FIELD. Every draw comes from `r.fork('<field>')`, never from
 *    a single shared stream. Without that, inserting one draw anywhere in this
 *    file would re-roll every field after it, so every existing persona would
 *    silently change face and job the next time the sampler was touched.
 *
 * 2. DEPENDENCIES FLOW DOWNWARD. The order of the steps below IS the model:
 *    market → location → gender → age → heritage → name → languages →
 *    education → work → economic → household → lifestyle → psychology → look →
 *    description. A field may only be gated on something already drawn; that is
 *    why `registry.gatePasses` treats an unknown context value as "no opinion".
 *
 * 3. THE REGISTRY OWNS THE VALUES. This file holds no trait literals except
 *    where no registry table exists yet (age bands, gray coverage, facial hair,
 *    eyewear — each marked below). Adding a market is a directory; adding a
 *    trait is a table.
 *
 * PROVENANCE: every leaf written here is recorded in `meta.fieldSources` as
 * 'sampled', which is what makes later automation safe — it may overwrite
 * 'sampled' and 'derived', never 'user' or 'extracted'.
 *
 * Client-safe: no $env, no lib/server, no I/O.
 */
import { label } from './labels';
import { setPath, type Obj } from './paths';
import { registry, REGISTRY_VERSION, type GateContext, type ResolvedRegistry } from './registry';
import type { RegistryOccupation, RegistryTable } from './registry/types';
import { rng, type Rng } from './rng';
import {
	PERSONA_SCHEMA_VERSION,
	type BigFive,
	type PersonaDescriptionFact,
	type PersonaProfileV2
} from './schema';
import { GENDER_TOKENS, NICHE_TOKENS, type TokenGroup, type TokenOf } from './tokens';
import { inferGenderFromName } from '../name-gender';

/**
 * What the caller may pin. Anything supplied is USED, never re-drawn — a
 * constraint the sampler could override is not a constraint, and the wizard
 * relies on "I said female, I got female" being absolute.
 */
export interface SkeletonConstraints {
	market?: TokenOf<'market'>;
	/** User-supplied creator name. CONDITIONS gender; never overwritten. */
	name?: string;
	gender?: TokenOf<'gender'>;
	ageRange?: [number, number];
	heritage?: TokenOf<'heritage'>;
	niche?: TokenOf<'niche'>;
	incomeBand?: TokenOf<'incomeBand'>;
	/**
	 * Cross-persona uniqueness. SOFT by design: a roster of twelve creators must
	 * not fail to sample its thirteenth because every option is spoken for, so
	 * an exhausted avoid-list degrades to "draw normally" rather than throwing.
	 */
	avoid?: {
		names?: string[];
		heritages?: string[];
		workDomains?: string[];
	};
}

/** Injectable clock, so `meta.generatedAt` never makes the sampler impure in tests. */
export interface SkeletonOptions {
	now?: Date | string;
}

/**
 * The product's default market. Deliberately NOT sampled: a creator roster with
 * a random country per persona is a bug, not variety. Callers who want a mixed
 * roster pass `market` per persona.
 */
const DEFAULT_MARKET: TokenOf<'market'> = 'au';

/**
 * Creator age bands. NO REGISTRY TABLE EXISTS for age (it is a number, not a
 * token group), so the curve lives here. It is shaped to keep any single decade
 * well under half the roster — the direct fix for "every persona is 25–34" —
 * while staying plausible for someone who posts for a living.
 *
 * CURATED PLAUSIBILITY, NOT CENSUS DATA.
 */
const AGE_BANDS: readonly { min: number; max: number; weight: number }[] = [
	{ min: 18, max: 24, weight: 14 },
	{ min: 25, max: 29, weight: 18 },
	{ min: 30, max: 34, weight: 20 },
	{ min: 35, max: 39, weight: 15 },
	{ min: 40, max: 49, weight: 16 },
	{ min: 50, max: 59, weight: 10 },
	{ min: 60, max: 69, weight: 7 }
];

/** Hard bounds on a sampled creator age, whatever a caller asks for. */
const MIN_AGE = 18;
const MAX_AGE = 80;

/**
 * The ages each child band IMPLIES, as [min, max].
 *
 * Exported because it is a shared contract, not an implementation detail: the
 * sampler uses it to decide which bands a parent of a given age may have, and
 * the spec uses the same table to prove the rule. Two copies of this table
 * would let the sampler and its own test drift into agreeing on a wrong answer.
 *
 * `adult` is capped at 30 on purpose — an unbounded upper edge would make the
 * "at least 16 years younger than the parent" rule unfalsifiable.
 */
export const CHILD_AGE_BAND_YEARS: Record<TokenOf<'childAgeBand'>, readonly [number, number]> = {
	baby: [0, 1],
	toddler: [2, 4],
	primary: [5, 12],
	teen: [13, 17],
	adult: [18, 30]
};

/** Minimum plausible gap between a parent's age and a child's. A 30-year-old has no teenager. */
export const MIN_PARENT_CHILD_GAP = 16;

/** Relationship statuses that make children in the household plausible. */
const CHILD_BEARING_STATUSES: readonly TokenOf<'relationshipStatus'>[] = [
	'partnered',
	'married',
	'separated',
	'widowed'
];

/** Youngest age at which the sampler will place children in the household. */
const MIN_PARENT_AGE = 24;

/**
 * Gray coverage. NO REGISTRY TABLE EXISTS for this group yet, so the weights
 * live here, banded by age. Below 35 the answer is always 'none' — early gray
 * exists in life but reads as an error in a generated persona, and the cost of
 * excluding it is far lower than the cost of a 24-year-old rendered silver.
 */
const GRAY_BANDS: readonly { minAge: number; weights: readonly { token: TokenOf<'grayCoverage'>; weight: number }[] }[] =
	[
		{
			minAge: 60,
			weights: [
				{ token: 'light', weight: 10 },
				{ token: 'salt_and_pepper', weight: 30 },
				{ token: 'mostly_gray', weight: 35 },
				{ token: 'white', weight: 25 }
			]
		},
		{
			minAge: 50,
			weights: [
				{ token: 'none', weight: 10 },
				{ token: 'light', weight: 24 },
				{ token: 'salt_and_pepper', weight: 36 },
				{ token: 'mostly_gray', weight: 22 },
				{ token: 'white', weight: 8 }
			]
		},
		{
			minAge: 45,
			weights: [
				{ token: 'none', weight: 26 },
				{ token: 'light', weight: 36 },
				{ token: 'salt_and_pepper', weight: 26 },
				{ token: 'mostly_gray', weight: 10 },
				{ token: 'white', weight: 2 }
			]
		},
		{
			minAge: 35,
			weights: [
				{ token: 'none', weight: 62 },
				{ token: 'light', weight: 30 },
				{ token: 'salt_and_pepper', weight: 8 }
			]
		}
	];

/** Gray coverages that read as gray HAIR, not merely gray strands. */
const FULLY_GRAY: readonly TokenOf<'grayCoverage'>[] = ['mostly_gray', 'white'];

/** Facial hair. NO REGISTRY TABLE EXISTS; always 'none' for a female persona. */
const FACIAL_HAIR_WEIGHTS: readonly { token: TokenOf<'facialHair'>; weight: number }[] = [
	{ token: 'none', weight: 46 },
	{ token: 'stubble', weight: 22 },
	{ token: 'short_beard', weight: 16 },
	{ token: 'full_beard', weight: 8 },
	{ token: 'goatee', weight: 5 },
	{ token: 'moustache', weight: 3 }
];

/** Eyewear. NO REGISTRY TABLE EXISTS. ~15% wear glasses; a few are sunglasses-forward. */
const EYEWEAR_WEIGHTS: readonly { token: TokenOf<'eyewear'>; weight: number }[] = [
	{ token: 'none', weight: 80 },
	{ token: 'glasses', weight: 15 },
	{ token: 'sunglasses_often', weight: 5 }
];

/** Hair lengths a shaved head is compatible with — bald-with-waist-length is not a person. */
const SHAVEABLE_LENGTHS: readonly TokenOf<'hairLength'>[] = ['pixie', 'short'];

/** Height priors by gender, in cm. Clamped so no draw can leave the human range. */
const HEIGHT_BY_GENDER: Record<TokenOf<'gender'>, { mean: number; sd: number }> = {
	female: { mean: 165, sd: 7 },
	male: { mean: 178, sd: 8 }
};
export const MIN_HEIGHT_CM = 140;
export const MAX_HEIGHT_CM = 205;

/**
 * Niche → personality nudge. A fitness creator who never finishes anything and
 * an entertainment creator who is a recluse are the kind of quiet incoherence
 * that makes generated personas feel synthetic. The nudge is small (one third
 * of a standard deviation) so it colours the distribution without collapsing it.
 */
const NICHE_TRAIT_NUDGE: Partial<Record<TokenOf<'niche'>, Partial<Record<keyof BigFive, number>>>> = {
	fitness_health: { conscientiousness: 10 },
	sports: { conscientiousness: 10 },
	entertainment_pop_culture: { extraversion: 10 },
	arts_creativity: { openness: 10 }
};

/** Score thresholds that turn a Big Five number into a stated trait. Mirrors schema.ts. */
const HIGH_TRAIT = 65;
const LOW_TRAIT = 35;

/** Explicit token pairs, so a trait label is never assembled from a string template. */
const TRAIT_LABELS: Record<keyof BigFive, { high: TokenOf<'traitLabel'>; low: TokenOf<'traitLabel'> }> = {
	openness: { high: 'high_openness', low: 'low_openness' },
	conscientiousness: { high: 'high_conscientiousness', low: 'low_conscientiousness' },
	extraversion: { high: 'high_extraversion', low: 'low_extraversion' },
	agreeableness: { high: 'high_agreeableness', low: 'low_agreeableness' },
	neuroticism: { high: 'high_neuroticism', low: 'low_neuroticism' }
};

const BIG_FIVE_ORDER: readonly (keyof BigFive)[] = [
	'openness',
	'conscientiousness',
	'extraversion',
	'agreeableness',
	'neuroticism'
];

// ── small pure helpers ─────────────────────────────────────────────────────

/**
 * Soft preference. Returns the options not on the avoid-list, or ALL of them
 * when that would leave nothing. This one line is why `avoid` can never make
 * sampling fail or loop: exhaustion degrades to the unfiltered pool.
 */
function preferring<T>(items: readonly T[], isAvoided: (item: T) => boolean): readonly T[] {
	const kept = items.filter((item) => !isAvoided(item));
	return kept.length ? kept : items;
}

/** A table with only the allowed tokens, or the original when that empties it (never sample from nothing). */
function restrictTable<G extends TokenGroup>(
	table: RegistryTable<G>,
	allow: (token: TokenOf<G>) => boolean
): RegistryTable<G> {
	const entries = table.entries.filter((entry) => allow(entry.token));
	return entries.length ? { group: table.group, entries } : table;
}

/** Weighted pick over a local (non-registry) weight list. */
function pickWeighted<T extends string>(r: Rng, items: readonly { token: T; weight: number }[]): T {
	return r.weighted(items, (item) => item.weight).token;
}

function clampAge(value: number): number {
	return Math.min(MAX_AGE, Math.max(MIN_AGE, Math.round(value)));
}

/**
 * A job title as it should read mid-sentence, without mangling the stored title.
 *
 * Lower-casing only the first character produced "a 46-year-old customer Support
 * Lead": every later word kept its title case. Titles here are plain English
 * noun phrases, so the whole thing lower-cases cleanly — EXCEPT words that are
 * proper nouns or initialisms even in running text, which stay as stored.
 */
const TITLE_KEEP_CASE = /^(AI|IT|HR|PR|UX|UI|SEO|QA|CEO|CTO|CFO|COO)$/;

/** Exported for the spec, which pins the casing rule directly rather than via 400 samples. */
export function inSentence(title: string): string {
	return title
		.split(' ')
		.map((word) => (TITLE_KEEP_CASE.test(word) ? word : word.toLowerCase()))
		.join(' ');
}

/**
 * 'a' vs 'an' for "a 34-year-old" / "an 18-year-old".
 *
 * Driven by how the NUMBER is pronounced, not by its first letter: 18, 19 and
 * the eighties all open with a vowel sound while their digits do not, so a
 * spelling test would write "a 18-year-old" in the sampler's own headline
 * sentence.
 */
function ageArticle(age: number): string {
	return age === 11 || age === 18 || age === 19 || (age >= 80 && age <= 89) ? 'an' : 'a';
}

// ── the sampler ────────────────────────────────────────────────────────────

/**
 * Draws a complete creator skeleton.
 *
 * @param seed      Canonical seed; the same seed and constraints always produce
 *                  the identical persona, which is what makes a per-field
 *                  re-roll explainable and the output snapshot-testable.
 * @param constraints Fields the caller has already decided. Always honoured.
 * @param options   Injectable clock only; the sampler is otherwise pure.
 */
export function samplePersonaSkeleton(
	seed: string,
	constraints: SkeletonConstraints = {},
	options: SkeletonOptions = {}
): PersonaProfileV2 {
	const r = rng(seed);
	const sources: Record<string, 'sampled'> = {};
	const root: Obj = {};

	/** Writes one leaf AND its provenance. Every field goes through here, so coverage cannot drift. */
	const set = (path: string, value: unknown): void => {
		setPath(root, path, value);
		sources[path] = 'sampled';
	};

	const avoidHeritages = new Set(constraints.avoid?.heritages ?? []);
	const avoidDomains = new Set(constraints.avoid?.workDomains ?? []);
	const avoidNameParts = new Set<string>();
	const avoidFullNames = new Set<string>();
	for (const raw of constraints.avoid?.names ?? []) {
		const normalised = raw.trim().toLowerCase().replace(/\s+/g, ' ');
		if (!normalised) continue;
		avoidFullNames.add(normalised);
		for (const part of normalised.split(' ')) avoidNameParts.add(part);
	}

	// ── market ───────────────────────────────────────────────────────────────
	const market = constraints.market ?? DEFAULT_MARKET;
	const resolved: ResolvedRegistry = registry.for(market);
	set('creator.market', market);

	// ── location ─────────────────────────────────────────────────────────────
	// Region first, then a city inside it: a city's timezone and urban/rural
	// character travel WITH the city, so location can never contradict itself.
	const regionRng = r.fork('creator.location.region');
	const region = regionRng.weighted(resolved.regions, (candidate) => candidate.weight);
	const city = r.fork('creator.location.city').weighted(region.cities, (candidate) => candidate.weight);
	set('creator.location.region', region.name);
	set('creator.location.city', city.name);
	set('creator.location.geographicContext', city.geographicContext);
	set('creator.location.timezone', city.timezone);

	// ── gender ───────────────────────────────────────────────────────────────
	// Precedence: explicit constraint, then the signal in a user-supplied name,
	// then a draw. Inference is only ever a signal — an unknown name falls
	// through to the draw rather than defaulting, so a gender is never invented
	// from a name the table has never seen.
	const suppliedName = constraints.name?.trim() ?? '';
	const inferredGender = suppliedName ? inferGenderFromName(suppliedName) : undefined;
	const gender: TokenOf<'gender'> =
		constraints.gender ?? inferredGender ?? r.fork('creator.gender').pick(GENDER_TOKENS);
	set('creator.gender', gender);

	// ── age ──────────────────────────────────────────────────────────────────
	const ageRng = r.fork('creator.age');
	let age: number;
	if (constraints.ageRange) {
		const lo = clampAge(Math.min(constraints.ageRange[0], constraints.ageRange[1]));
		const hi = clampAge(Math.max(constraints.ageRange[0], constraints.ageRange[1]));
		age = ageRng.int(lo, hi);
	} else {
		const band = ageRng.weighted(AGE_BANDS, (candidate) => candidate.weight);
		age = ageRng.int(band.min, band.max);
	}
	set('creator.age', age);
	set('creator.ageSource', 'exact');

	// ── heritage ─────────────────────────────────────────────────────────────
	const heritage: TokenOf<'heritage'> =
		constraints.heritage ??
		registry.pick(
			restrictTable(resolved.heritage, (token) => !avoidHeritages.has(token)),
			r.fork('creator.heritage'),
			{ market }
		);
	set('creator.heritage', heritage);

	// ── name ─────────────────────────────────────────────────────────────────
	// A supplied name is kept VERBATIM (split on the first space only, so
	// 'Ana Maria de Souza' keeps its family name intact). Otherwise the name is
	// drawn from the heritage's own set, which is the single cheapest thing that
	// stops a roster reading as twelve variations of one person.
	const nameSet = registry.namesFor(resolved, heritage);
	let firstName: string;
	let lastName: string | undefined;
	if (suppliedName) {
		const space = suppliedName.indexOf(' ');
		firstName = space < 0 ? suppliedName : suppliedName.slice(0, space);
		const rest = space < 0 ? '' : suppliedName.slice(space + 1).trim();
		lastName = rest || undefined;
	} else {
		const givenPool = gender === 'female' ? nameSet.female : nameSet.male;
		firstName = r
			.fork('creator.firstName')
			.pick(preferring(givenPool, (candidate) => avoidNameParts.has(candidate.toLowerCase())));
		const familyPool = preferring(nameSet.family, (candidate) => avoidNameParts.has(candidate.toLowerCase()));
		// Scan forward from a random start for the first family name that does not
		// reconstruct an avoided FULL name. Bounded by the pool length: it always
		// terminates, and always returns something.
		const start = r.fork('creator.lastName').int(0, familyPool.length - 1);
		lastName = familyPool[start];
		for (let offset = 0; offset < familyPool.length; offset++) {
			const candidate = familyPool[(start + offset) % familyPool.length];
			if (!avoidFullNames.has(`${firstName} ${candidate}`.toLowerCase())) {
				lastName = candidate;
				break;
			}
		}
	}
	const displayName = [firstName, lastName].filter(Boolean).join(' ');
	set('creator.firstName', firstName);
	if (lastName) set('creator.lastName', lastName);
	set('creator.displayName', displayName);

	// ── languages ────────────────────────────────────────────────────────────
	// The market's first language is always spoken; a second is a coin-weighted
	// extra drawn from the rest of the market's list, which is where a market
	// file's real local colour lives.
	const languageRng = r.fork('creator.languages');
	const languages = [resolved.languages[0]];
	const others = resolved.languages.slice(1);
	if (others.length && languageRng.chance(0.32)) {
		const second = languageRng.pick(others);
		if (second !== languages[0]) languages.push(second);
	}
	set('creator.languages', languages);

	// ── education ────────────────────────────────────────────────────────────
	// Gated on age by the table ('postgraduate' has minAge 24) — the sampler
	// supplies the age, the registry owns the rule.
	const education = registry.pick(resolved.education, r.fork('creator.education'), { age, gender, market });
	set('creator.education', education);

	// ── strategy: niche ──────────────────────────────────────────────────────
	// Drawn here rather than in a later section because occupation affinity,
	// body type and personality all depend on it. A creator's niche is a fact
	// about the persona, not a piece of positioning prose.
	const niche: TokenOf<'niche'> = constraints.niche ?? r.fork('strategy.niche').pick(NICHE_TOKENS);
	set('strategy.niche', niche);

	// ── strategy: positioning ────────────────────────────────────────────────
	// Archetype and content focus are SAMPLED, not left blank for a model to
	// fill. A persona created with no provider key configured must be complete,
	// not half-blank, and "the table always has an answer" is what makes the
	// no-AI path a real path rather than a degraded one. When the prose pass does
	// run it overwrites both — a model that has read the brief positions better
	// than a weighted table — so this is a floor, never a ceiling.
	const positioningCtx: GateContext = { age, gender, niche, market };
	set(
		'strategy.archetype',
		registry.pick(resolved.archetype, r.fork('strategy.archetype'), positioningCtx)
	);
	set(
		'strategy.contentFocus',
		registry.pick(resolved.contentFocus, r.fork('strategy.contentFocus'), positioningCtx)
	);

	// ── work ─────────────────────────────────────────────────────────────────
	const workCtx: GateContext = { age, gender, niche, education, market };
	const occupationRegistry: ResolvedRegistry = avoidDomains.size
		? { ...resolved, occupations: [...preferring(resolved.occupations, (o) => avoidDomains.has(o.domain))] }
		: resolved;
	let occupation: RegistryOccupation = registry.occupations(
		occupationRegistry,
		r.fork('creator.work.occupation'),
		workCtx
	);

	// Seniority is drawn from the AGE-GATED pool first, then narrowed to what the
	// occupation allows. Narrowing first would let a title's `seniorities` gate
	// override an age gate and produce a 19-year-old 'owner'; this way the age
	// rule always wins. When the two cannot both hold, the OCCUPATION yields:
	// we re-pick from titles that carry no seniority demand, because a job is
	// easier to change than an age.
	const seniorityRng = r.fork('creator.work.seniority');
	const allowedBySeniorityGate = occupation.gates?.seniorities;
	let seniority = registry.pick(resolved.seniority, seniorityRng, { age, market });
	if (allowedBySeniorityGate && !allowedBySeniorityGate.includes(seniority)) {
		const narrowed = restrictTable(resolved.seniority, (token) => allowedBySeniorityGate.includes(token));
		const candidate = registry.pick(narrowed, seniorityRng, { age, market });
		if (allowedBySeniorityGate.includes(candidate) && passesAgeGate(resolved, candidate, age)) {
			seniority = candidate;
		} else {
			occupation = registry.occupations(
				{
					...occupationRegistry,
					occupations: [...preferring(occupationRegistry.occupations, (o) => !!o.gates?.seniorities)]
				},
				r.fork('creator.work.occupation.refit'),
				{ ...workCtx, seniority }
			);
		}
	}
	set('creator.work.domain', occupation.domain);
	set('creator.work.title', occupation.title);
	set('creator.work.seniority', seniority);

	const employmentRng = r.fork('creator.work.employmentStatus');
	let employmentStatus = registry.pick(resolved.employmentStatus, employmentRng, { ...workCtx, seniority });
	const workLocationMode = registry.pick(resolved.workLocationMode, r.fork('creator.work.workLocationMode'), {
		...workCtx,
		seniority
	});

	// ── economic ─────────────────────────────────────────────────────────────
	// incomeBand is gated on education AND seniority (the registry says 'high'
	// needs senior/lead/owner), and priceFrame is gated on incomeBand — so the
	// creator's price lens is downstream of what they actually earn.
	const incomeBand: TokenOf<'incomeBand'> =
		constraints.incomeBand ??
		registry.pick(resolved.incomeBand, r.fork('creator.economic.incomeBand'), {
			age,
			education,
			seniority,
			market
		});
	const priceFrame = registry.pick(resolved.priceFrame, r.fork('creator.economic.priceFrame'), {
		age,
		incomeBand,
		market
	});
	set('creator.economic.incomeBand', incomeBand);
	set('creator.economic.priceFrame', priceFrame);

	// ── household ────────────────────────────────────────────────────────────
	const relationshipStatus = registry.pick(
		resolved.relationshipStatus,
		r.fork('creator.household.relationshipStatus'),
		{ age, gender, market }
	);
	set('creator.household.relationshipStatus', relationshipStatus);

	// Children exist only when both the age and the relationship make them
	// plausible, and each child's age band must sit at least MIN_PARENT_CHILD_GAP
	// years below the parent. That single rule is what keeps the 30-year-old with
	// a teenager — the most visible incoherence in the v1 personas — impossible
	// rather than merely unlikely.
	const childRng = r.fork('creator.household.children');
	const allowedBands = (Object.keys(CHILD_AGE_BAND_YEARS) as TokenOf<'childAgeBand'>[]).filter(
		(band) => age - CHILD_AGE_BAND_YEARS[band][1] >= MIN_PARENT_CHILD_GAP
	);
	const eligibleForChildren =
		age >= MIN_PARENT_AGE && CHILD_BEARING_STATUSES.includes(relationshipStatus) && allowedBands.length > 0;
	let hasChildren = false;
	let childCount = 0;
	if (eligibleForChildren && childRng.chance(age >= 34 ? 0.62 : 0.42)) {
		hasChildren = true;
		const count = childRng.weighted(
			[
				{ n: 1, weight: 42 },
				{ n: 2, weight: 42 },
				{ n: 3, weight: 16 }
			],
			(candidate) => candidate.weight
		).n;
		const bandTable = restrictTable(resolved.childAgeBand, (token) => allowedBands.includes(token));
		const ageBands: TokenOf<'childAgeBand'>[] = [];
		for (let i = 0; i < count; i++) ageBands.push(registry.pick(bandTable, childRng, { age, market }));
		childCount = count;
		set('creator.household.children.count', count);
		set('creator.household.children.ageBands', ageBands);
	}

	// A 'homemaker' with nobody at home is the registry's own gate contradicting
	// itself, only because employment was drawn before the household was known.
	// Re-draw it now that `hasChildren` is a fact.
	if (employmentStatus === 'homemaker' && !hasChildren) {
		employmentStatus = registry.pick(resolved.employmentStatus, employmentRng, {
			...workCtx,
			seniority,
			hasChildren: false
		});
	}
	set('creator.work.employmentStatus', employmentStatus);
	set('creator.work.workLocationMode', workLocationMode);

	const petRng = r.fork('creator.household.pets');
	if (petRng.chance(0.46)) {
		const wanted = petRng.chance(0.24) ? 2 : 1;
		const pets: TokenOf<'pet'>[] = [];
		for (let i = 0; i < wanted; i++) {
			const pet = registry.pick(resolved.pet, petRng, { age, incomeBand, market });
			if (!pets.includes(pet)) pets.push(pet);
		}
		set('creator.household.pets', pets);
	}

	// Ownership is gated on age AND income by the registry (owned housing has
	// minAge 26 plus a middle-or-better income), so "owns a house at 21" is
	// unreachable rather than merely rare.
	const housingType = registry.pick(resolved.housingType, r.fork('creator.household.housingType'), {
		age,
		incomeBand,
		market
	});
	set('creator.household.housingType', housingType);

	// ── lifestyle ────────────────────────────────────────────────────────────
	const lifestyleCtx: GateContext = { age, gender, niche, incomeBand, market };
	set(
		'creator.lifestyle.activityLevel',
		registry.pick(resolved.activityLevel, r.fork('creator.lifestyle.activityLevel'), lifestyleCtx)
	);
	set(
		'creator.lifestyle.transportMode',
		registry.pick(resolved.transportMode, r.fork('creator.lifestyle.transportMode'), lifestyleCtx)
	);
	set(
		'creator.lifestyle.dietaryStyle',
		registry.pick(resolved.dietaryStyle, r.fork('creator.lifestyle.dietaryStyle'), lifestyleCtx)
	);

	// ── psychology ───────────────────────────────────────────────────────────
	// Five independent normal draws, each on its own fork, then a small
	// niche-shaped nudge. Independent draws are the point: correlated or
	// hand-picked traits produce personas that all read as the same upbeat
	// extravert, which is exactly the sameness this model exists to break.
	const nudge = NICHE_TRAIT_NUDGE[niche] ?? {};
	const traitLabels: TokenOf<'traitLabel'>[] = [];
	for (const trait of BIG_FIVE_ORDER) {
		const base = r.fork(`creator.bigFive.${trait}`).gauss(50, 15, 0, 100);
		const value = Math.min(100, Math.max(0, Math.round(base + (nudge[trait] ?? 0))));
		set(`creator.bigFive.${trait}`, value);
		if (value >= HIGH_TRAIT) traitLabels.push(TRAIT_LABELS[trait].high);
		else if (value <= LOW_TRAIT) traitLabels.push(TRAIT_LABELS[trait].low);
	}
	set('creator.traitLabels', traitLabels);

	// ── look ─────────────────────────────────────────────────────────────────
	// Skin, eyes, hair colour and hair texture are drawn UNDER THE HERITAGE
	// PRIOR (`registry.pickLook`), which is authoritative for the groups it
	// names. That is the fix for a 'white' heritage drawing a deep skin tone at
	// its base weight — the single most common look incoherence in v1.
	const lookCtx: GateContext = { age, gender, niche, market };
	const prior = resolved.look[heritage] ?? resolved.look.default;
	const skinTone = registry.pickLook(resolved.skinTone, prior, 'skinTone', r.fork('look.skinTone'), lookCtx);
	const eyeColor = registry.pickLook(resolved.eyeColor, prior, 'eyeColor', r.fork('look.eyes.color'), lookCtx);
	let hairColor = registry.pickLook(resolved.hairColor, prior, 'hairColor', r.fork('look.hair.color'), lookCtx);
	const hairTexture = registry.pickLook(
		resolved.hairTexture,
		prior,
		'hairTexture',
		r.fork('look.hair.texture'),
		lookCtx
	);

	// Gray coverage is age-banded and never anything but 'none' under 35. When
	// the coverage says the head reads gray, the COLOUR follows it — heritage
	// priors never list 'silver_gray', so without this step no persona would
	// ever go gray and the registry's own minAge-45 gate would be dead code.
	const grayRng = r.fork('look.hair.grayCoverage');
	const grayBand = GRAY_BANDS.find((candidate) => age >= candidate.minAge);
	const grayCoverage: TokenOf<'grayCoverage'> = grayBand ? pickWeighted(grayRng, grayBand.weights) : 'none';
	if (FULLY_GRAY.includes(grayCoverage)) hairColor = 'silver_gray';

	const hairLength = registry.pick(resolved.hairLength, r.fork('look.hair.length'), lookCtx);
	// A shaved head with waist-length hair is not a person. Length is drawn
	// first, so the style yields to it.
	const hairstyleTable = SHAVEABLE_LENGTHS.includes(hairLength)
		? resolved.hairstyle
		: restrictTable(resolved.hairstyle, (token) => token !== 'bald_shaved');
	const hairstyle = registry.pick(hairstyleTable, r.fork('look.hair.style'), lookCtx);

	set('look.skinTone', skinTone);
	set('look.bodyType', registry.pick(resolved.bodyType, r.fork('look.bodyType'), lookCtx));
	const height = HEIGHT_BY_GENDER[gender];
	set('look.heightCm', r.fork('look.heightCm').gauss(height.mean, height.sd, MIN_HEIGHT_CM, MAX_HEIGHT_CM));
	set('look.faceShape', registry.pick(resolved.faceShape, r.fork('look.faceShape'), lookCtx));
	set('look.browShape', registry.pick(resolved.browShape, r.fork('look.browShape'), lookCtx));
	set('look.hair.color', hairColor);
	set('look.hair.grayCoverage', grayCoverage);
	set('look.hair.length', hairLength);
	set('look.hair.texture', hairTexture);
	set('look.hair.style', hairstyle);
	set('look.facialHair', gender === 'female' ? 'none' : pickWeighted(r.fork('look.facialHair'), FACIAL_HAIR_WEIGHTS));
	set('look.eyes.color', eyeColor);
	set('look.eyewear', pickWeighted(r.fork('look.eyewear'), EYEWEAR_WEIGHTS));

	// ── description ──────────────────────────────────────────────────────────
	// Derived, not drawn: regenerable from the fields above without an LLM, and
	// rendered in LABELS because a token in a UI string is the en-dash incident
	// waiting to happen again.
	const jobPhrase = inSentence(occupation.title);
	set(
		'description.short',
		`${displayName} is ${ageArticle(age)} ${age}-year-old ${jobPhrase} in ${city.name}, ${region.name}.`
	);
	const householdParts = [label('relationshipStatus', relationshipStatus)];
	if (hasChildren) householdParts.push(`${childCount} ${childCount === 1 ? 'child' : 'children'}`);
	householdParts.push(label('housingType', housingType));
	const frame: PersonaDescriptionFact[] = [
		{ key: 'age', label: 'Age', value: `${age}` },
		{ key: 'location', label: 'Location', value: `${city.name}, ${region.name}` },
		{ key: 'work', label: 'Work', value: `${occupation.title} · ${label('workDomain', occupation.domain)}` },
		{ key: 'household', label: 'Household', value: householdParts.join(' · ') }
	];
	set('description.frame', frame);

	// ── meta ─────────────────────────────────────────────────────────────────
	// The ONLY impure line in the file, and it is injectable — tests pass `now`
	// so a golden comparison is a comparison of the persona, not of the clock.
	const generatedAt = (options.now ? new Date(options.now) : new Date()).toISOString();
	const profile = root as unknown as PersonaProfileV2;
	profile.meta = {
		schemaVersion: PERSONA_SCHEMA_VERSION,
		seed,
		registryVersion: REGISTRY_VERSION,
		generator: 'skeleton_v1',
		generatedAt,
		fieldSources: sources
	};
	return profile;
}

/**
 * True when a seniority token's own age gate admits this age.
 *
 * Needed because `registry.pick` deliberately NEVER returns nothing: given an
 * over-narrowed table it falls back to the ungated weights, which is right for
 * "always produce a persona" and wrong for "is this specific value legal here".
 * The sampler asks the question directly rather than trusting the fallback.
 */
function passesAgeGate(resolved: ResolvedRegistry, token: TokenOf<'seniority'>, age: number): boolean {
	const entry = resolved.seniority.entries.find((candidate) => candidate.token === token);
	if (!entry?.gates) return true;
	if (entry.gates.minAge !== undefined && age < entry.gates.minAge) return false;
	if (entry.gates.maxAge !== undefined && age > entry.gates.maxAge) return false;
	return true;
}
