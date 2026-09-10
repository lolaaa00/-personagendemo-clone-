/**
 * Persona Model v2 — silent backfill, Tier 2 (P1.7).
 *
 * Tier 1 derives what the profile already implies. Tier 2 is for the personas
 * that predate the structured record entirely: everything anyone ever knew about
 * them is buried in prose — the soul paragraph, the content angle, the target
 * avatar. A creator whose soul says "a Melbourne physio who trains before work"
 * has a city, a job and a life; the record just has no field holding them.
 *
 * TWO STEPS, IN THIS ORDER, AND THE ORDER IS THE WHOLE DESIGN:
 *
 *   1. RECONCILE. Ask a model to EXTRACT facts the prose already states, and
 *      write them as `extracted`. Extraction, never invention: the prompt says
 *      to answer "unknown" for anything not stated, and `applyReconciliation`
 *      throws away everything that is not a valid token regardless of what came
 *      back. A model that guesses can only ever leave the profile as it was.
 *
 *   2. SAMPLE THE REST. Feed every fact now known — user-supplied, extracted,
 *      derived — into the skeleton sampler as CONSTRAINTS, and fill only the
 *      leaves still missing. Because the sampler treats a constraint as
 *      absolute, the invented half can never contradict the known half. That is
 *      what "reconciliation-first" means, and it is why the order cannot be
 *      swapped: sampling first would produce a coherent stranger, and the
 *      extraction would then be fighting it.
 *
 * NOTHING HERE IS OVERWRITTEN. Every write goes to a leaf that is absent. A
 * persona's own words, and anything Tier 1 derived from them, survive untouched.
 *
 * PURE. The provider call is the CALLER's job — this module takes the answer as
 * data. That keeps the whole transformation testable without a key, and keeps
 * the money gates (budget, credits, ledger) in the endpoint where the service
 * client already lives. A pure core with the spend at the edge is also the only
 * arrangement in which a `shadow` run is trustworthy: shadow calls the model,
 * reports what would change, and writes nothing.
 */
import { getPath, isObj, leafPaths, setPath, type Obj } from '$lib/persona-contract/paths';
import { REGISTRY_VERSION } from '$lib/persona-contract/registry';
import { samplePersonaSkeleton, type SkeletonConstraints } from '$lib/persona-contract/sampler';
import type { FieldSource, PersonaProfileV2 } from '$lib/persona-contract/schema';
import { isToken } from '$lib/persona-contract/tokens';

/** The tier this module reaches. */
const TIER = 2 as const;

/**
 * The fields the model is asked for. Deliberately small: every one is either a
 * token group the sampler can be constrained by, or a plain fact a person
 * plausibly states about themselves in a bio. Asking for forty fields produces
 * forty guesses.
 */
export interface ReconciliationAnswer {
	market?: string;
	gender?: string;
	age?: number | string;
	heritage?: string;
	niche?: string;
	education?: string;
	incomeBand?: string;
	relationshipStatus?: string;
	housingType?: string;
	activityLevel?: string;
	dietaryStyle?: string;
	transportMode?: string;
	employmentStatus?: string;
	workLocationMode?: string;
	seniority?: string;
	workDomain?: string;
	city?: string;
	region?: string;
	occupationTitle?: string;
}

/** Leaf path ← answer key, for the values that are plain single tokens. */
const TOKEN_FIELDS = [
	['creator.market', 'market', 'market'],
	['creator.gender', 'gender', 'gender'],
	['creator.heritage', 'heritage', 'heritage'],
	['strategy.niche', 'niche', 'niche'],
	['creator.education', 'education', 'education'],
	['creator.economic.incomeBand', 'incomeBand', 'incomeBand'],
	['creator.household.relationshipStatus', 'relationshipStatus', 'relationshipStatus'],
	['creator.household.housingType', 'housingType', 'housingType'],
	['creator.lifestyle.activityLevel', 'activityLevel', 'activityLevel'],
	['creator.lifestyle.dietaryStyle', 'dietaryStyle', 'dietaryStyle'],
	['creator.lifestyle.transportMode', 'transportMode', 'transportMode'],
	['creator.work.employmentStatus', 'employmentStatus', 'employmentStatus'],
	['creator.work.workLocationMode', 'workLocationMode', 'workLocationMode'],
	['creator.work.seniority', 'seniority', 'seniority'],
	['creator.work.domain', 'workDomain', 'workDomain']
] as const;

/** Free-text leaves the model may fill: a place name and a job title. */
const TEXT_FIELDS = [
	['creator.location.city', 'city'],
	['creator.location.region', 'region'],
	['creator.work.title', 'occupationTitle']
] as const;

/** Hard bounds on an extracted age. Outside these it is not a creator's age. */
const MIN_AGE = 18;
const MAX_AGE = 80;

function sourcesOf(profile: PersonaProfileV2): Record<string, FieldSource> {
	return (profile.meta.fieldSources ??= {});
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * The prose Tier 2 reads. Nothing else is sent — a model given the whole record
 * starts "confirming" the fields it can already see, which turns a sampled guess
 * into an extracted fact and makes it permanent.
 */
export function reconciliationSource(profile: PersonaProfileV2): string {
	const parts: string[] = [];
	const push = (label: string, value: unknown) => {
		if (typeof value === 'string' && value.trim()) parts.push(`${label}: ${value.trim()}`);
	};
	push('Soul', (profile as unknown as Obj).soul ?? profile._legacy?.soul);
	push('Content angle', profile.strategy?.contentAngle);
	push('Target viewer', profile.audience?.targetAvatar);
	push('Viewer psychology', profile.audience?.psychProfile);
	push('Archetype', profile.strategy?.archetypeText);
	push('Content focus', profile.strategy?.contentFocusText);
	return parts.join('\n');
}

/** True when there is nothing for a model to read, so Tier 2 must not spend. */
export function hasReconcilableProse(profile: PersonaProfileV2): boolean {
	return reconciliationSource(profile).trim().length > 0;
}

/**
 * The extraction prompt.
 *
 * Every instruction here exists because the alternative is a plausible lie. The
 * model is told to answer "unknown" freely, that guessing is a failure, and that
 * it must not infer the creator from the audience — a brief describing women
 * 45-54 says nothing about who the creator is, and that inference is the single
 * most tempting wrong answer in this whole system.
 */
export function reconciliationPrompt(profile: PersonaProfileV2): string {
	return `You are reading everything known about a content creator and reporting ONLY the facts it already states.

WHAT YOU ARE DOING: extraction, not description. You are not inventing a person; you are reading one off a page.

RULES, in order of importance:
1. If the text does not state a fact, answer "unknown". "unknown" is the CORRECT answer far more often than not, and a wrong guess is worse than no answer — it becomes a permanent fact about this person.
2. Never infer the creator from their audience. "Speaks to new mums" does not make the creator a mother. "For women 45-54" does not make the creator 45-54.
3. Never infer from a name, a brand, or a niche. A skincare creator is not automatically a woman.
4. Only report what a reasonable reader would say is STATED, not implied, not likely.

TEXT:
${reconciliationSource(profile)}

Answer with JSON only, no prose, no code fence. Every field optional — omit a field entirely rather than writing "unknown":
{
  "age": number (18-80, only if an explicit age or birth year is stated),
  "gender": "male" | "female",
  "market": "au" | "us" | "uk",
  "city": string, "region": string,
  "occupationTitle": string (their job, e.g. "Physiotherapist"),
  "workDomain": one of the domain tokens if obvious,
  "employmentStatus": e.g. "self_employed" | "full_time" | "part_time",
  "workLocationMode": "on_site" | "hybrid" | "remote",
  "seniority": e.g. "junior" | "mid" | "senior" | "lead" | "owner",
  "education": e.g. "secondary" | "bachelor" | "postgraduate",
  "incomeBand": e.g. "low" | "lower_middle" | "middle" | "upper_middle" | "high",
  "heritage": a heritage token if the text states it explicitly,
  "niche": the creator's niche if stated,
  "relationshipStatus": e.g. "single" | "partnered" | "married",
  "housingType": e.g. "apartment_rented" | "house_owned",
  "activityLevel": e.g. "sedentary" | "moderate" | "active",
  "dietaryStyle": e.g. "omnivore" | "vegetarian" | "vegan",
  "transportMode": e.g. "car" | "public_transport" | "bike" | "walk"
}`;
}

export interface ReconciliationResult {
	profile: PersonaProfileV2;
	/** Leaf paths written, in the order they were written. */
	extracted: string[];
	/** Answer keys discarded because the value was not a valid token. */
	rejected: string[];
}

/**
 * Writes the model's answer onto the profile — every value re-validated, every
 * target leaf required to be empty.
 *
 * This is the enforcement, and it is the reason the prompt can be trusted at
 * all: a prompt is a request, a filter is a guarantee. A hallucinated
 * `heritage: "elvish"` is not a token and never reaches the record; a
 * hallucinated `age: 34` on a persona that already has an age is a write to an
 * occupied leaf and is refused.
 */
export function applyReconciliation(
	profile: PersonaProfileV2,
	answer: unknown
): ReconciliationResult {
	const out = clone(profile);
	const root = out as unknown as Obj;
	const sources = sourcesOf(out);
	const extracted: string[] = [];
	const rejected: string[] = [];

	if (!isObj(answer)) return { profile: out, extracted, rejected };

	const free = (path: string): boolean =>
		sources[path] === undefined && getPath(root, path) === undefined;
	const write = (path: string, value: unknown): void => {
		setPath(root, path, value);
		sources[path] = 'extracted';
		extracted.push(path);
	};

	for (const [path, key, group] of TOKEN_FIELDS) {
		const raw = answer[key];
		if (raw === undefined || raw === null || raw === '') continue;
		if (!isToken(group, raw)) {
			rejected.push(`${key}=${JSON.stringify(raw)}`);
			continue;
		}
		if (free(path)) write(path, raw);
	}

	for (const [path, key] of TEXT_FIELDS) {
		const raw = answer[key];
		if (typeof raw !== 'string' || !raw.trim()) continue;
		// A place or a job is free text, so the only guard available is shape.
		// Anything sentence-length is the model explaining itself, not answering.
		const value = raw.trim();
		if (value.length > 60 || /[\n{}[\]]/.test(value)) {
			rejected.push(`${key}=${JSON.stringify(value.slice(0, 40))}`);
			continue;
		}
		if (free(path)) write(path, value);
	}

	const rawAge = answer.age;
	const age =
		typeof rawAge === 'number' ? rawAge : typeof rawAge === 'string' ? Number(rawAge) : NaN;
	if (Number.isFinite(age)) {
		const rounded = Math.round(age);
		if (rounded < MIN_AGE || rounded > MAX_AGE) {
			rejected.push(`age=${rounded}`);
		} else if (free('creator.age')) {
			write('creator.age', rounded);
			// An age we read off a page is exact in the only sense that matters:
			// somebody stated it. That is not the same as a bucket midpoint, and
			// the portrait prompt treats the two differently.
			if (free('creator.ageSource')) write('creator.ageSource', 'exact');
		}
	} else if (rawAge !== undefined && rawAge !== null && rawAge !== '') {
		rejected.push(`age=${JSON.stringify(rawAge)}`);
	}

	return { profile: out, extracted, rejected };
}

/**
 * Everything now known, expressed as sampler constraints.
 *
 * The sampler treats a constraint as ABSOLUTE, so this is what stops step 2
 * contradicting step 1. Only the fields `SkeletonConstraints` actually supports
 * are passed; a fact the sampler cannot be constrained by is simply left in
 * place and never re-drawn, because the copy-back below only fills empty leaves.
 */
export function constraintsFromProfile(profile: PersonaProfileV2): SkeletonConstraints {
	const creator = profile.creator ?? {};
	const out: SkeletonConstraints = {};
	if (creator.market) out.market = creator.market;
	if (creator.gender) out.gender = creator.gender;
	if (creator.heritage) out.heritage = creator.heritage;
	if (creator.education) out.education = creator.education;
	if (creator.economic?.incomeBand) out.incomeBand = creator.economic.incomeBand;
	if (profile.strategy?.niche) out.niche = profile.strategy.niche;
	const name = (
		creator.displayName ?? [creator.firstName, creator.lastName].filter(Boolean).join(' ')
	).trim();
	if (name) out.name = name;
	if (typeof creator.age === 'number' && Number.isFinite(creator.age)) {
		out.ageRange = [creator.age, creator.age];
	}
	return out;
}

/** Sections the sampler owns. Anything outside them is not its business to fill. */
const SAMPLEABLE_PREFIXES = ['creator.', 'look.', 'voice.', 'strategy.'] as const;

export interface CompletionResult {
	profile: PersonaProfileV2;
	sampled: string[];
}

/**
 * Fills what is still missing, from a skeleton drawn under the known facts.
 *
 * Copies ONLY into empty leaves. The skeleton is a complete person, but almost
 * all of it is discarded — it exists to answer "what would a plausible rest-of-
 * life look like for someone with these facts", and the answer is only consulted
 * where the record is silent.
 *
 * `description.*` is excluded: it is Tier 1's, derived from whatever this leaves
 * behind, and copying the skeleton's version would describe a person who is
 * partly this creator and partly the draw.
 */
export function completeBySampling(
	profile: PersonaProfileV2,
	seed: string,
	options: { now?: string } = {}
): CompletionResult {
	const out = clone(profile);
	const root = out as unknown as Obj;
	const sources = sourcesOf(out);
	const sampled: string[] = [];

	const skeleton = samplePersonaSkeleton(
		seed,
		constraintsFromProfile(out),
		options.now ? { now: options.now } : undefined
	);
	const skeletonRoot = skeleton as unknown as Obj;

	for (const path of leafPaths(skeletonRoot)) {
		if (!SAMPLEABLE_PREFIXES.some((p) => path.startsWith(p))) continue;
		if (sources[path] !== undefined) continue;
		if (getPath(root, path) !== undefined) continue;
		const value = getPath(skeletonRoot, path);
		if (value === undefined || value === null) continue;
		if (Array.isArray(value) && value.length === 0) continue;
		setPath(root, path, value);
		sources[path] = 'sampled';
		sampled.push(path);
	}

	return { profile: out, sampled };
}

/** True when this profile has already been through Tier 2 on this registry. */
export function tier2AlreadyDone(profile: PersonaProfileV2): boolean {
	const backfill = profile.meta?.backfill;
	return !!backfill && backfill.tier >= TIER && profile.meta?.registryVersion === REGISTRY_VERSION;
}

export interface Tier2Result {
	profile: PersonaProfileV2;
	extracted: string[];
	sampled: string[];
	rejected: string[];
	/** True when the profile was already complete on this registry version. */
	skipped: boolean;
}

/**
 * Reconcile, then complete. `answer` is whatever the model returned; pass
 * `undefined` for a run with no provider, which degrades to sampling under the
 * facts already recorded rather than failing.
 */
export function backfillTier2(
	profile: PersonaProfileV2,
	options: { answer?: unknown; seed?: string; now?: string } = {}
): Tier2Result {
	if (tier2AlreadyDone(profile)) {
		return { profile: clone(profile), extracted: [], sampled: [], rejected: [], skipped: true };
	}

	const reconciled = applyReconciliation(profile, options.answer);
	const seed = options.seed ?? profile.meta?.seed ?? stableSeed(profile);
	const completed = completeBySampling(reconciled.profile, seed, { now: options.now });

	const out = completed.profile;
	out.meta.seed ??= seed;
	out.meta.registryVersion = REGISTRY_VERSION;
	out.meta.backfill = { tier: TIER, at: options.now ?? new Date().toISOString() };

	return {
		profile: out,
		extracted: reconciled.extracted,
		sampled: completed.sampled,
		rejected: reconciled.rejected,
		skipped: false
	};
}

/**
 * A seed for a profile that has none. Derived from the profile's own content, so
 * the same persona always samples the same completion — a re-run must not hand
 * someone a different life.
 */
function stableSeed(profile: PersonaProfileV2): string {
	const creator = profile.creator ?? {};
	const basis = [
		creator.displayName,
		creator.firstName,
		creator.lastName,
		profile.strategy?.niche,
		profile.strategy?.contentAngle
	]
		.filter((x): x is string => typeof x === 'string' && !!x)
		.join('|');
	if (basis) return `tier2:${basis}`;
	// Nothing identifying at all: fall back to the shape of the record itself,
	// which is still deterministic for a given profile.
	return `tier2:${leafPaths(profile as unknown as Obj).join(',')}`;
}

export { TIER as TIER_2 };
