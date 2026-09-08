/**
 * Brand brief → sampler constraints (Persona Model v2).
 *
 * A brand brief is free-form JSON on `brand_briefs.data`: whatever the user or
 * an earlier LLM step happened to write. This module reads it and returns the
 * few things the persona sampler can safely be told up front — market, audience
 * age band, gender skew, income band, life stage, niche.
 *
 * THE GOVERNING RULE IS "NEVER INVENT". A constraint is a hard filter on the
 * sampler's tables: a wrong one silently removes every candidate that would
 * have been right, and a constraint that is not a real token removes the whole
 * table. So every rule below is written to fail to `undefined` rather than to
 * guess, an unreadable brief yields `{}` (which the sampler handles by falling
 * back to its own defaults), and every emitted value is checked with `isToken`
 * before it leaves this file.
 *
 * `briefToConstraints` is deterministic and dependency-free — no I/O, no LLM,
 * no clock, no randomness — so the same brief always produces the same
 * constraints and the sampler's seed remains the only source of variation.
 * `constraintsExtractionPrompt` / `mergeExtractedConstraints` are the seam for
 * an optional LLM pass that can read prose this parser cannot; the merge is
 * validated exactly like the deterministic path, so a hallucinating model can
 * only ever leave the deterministic result unchanged.
 */
import { TOKEN_GROUPS, isToken } from '$lib/persona-contract/tokens';
import { tokenForLabel } from '$lib/persona-contract/labels';

export interface BriefConstraints {
	market?: string;
	ageRange?: [number, number];
	genderMix?: string;
	gender?: string;
	incomeBand?: string;
	lifeStage?: string[];
	niche?: string;
}

/** Ages outside this band are never useful audience constraints, so they clamp in. */
const AGE_MIN = 13;
const AGE_MAX = 99;

type Brief = Record<string, unknown>;

/** The groups this module can emit a single token for. */
type SingleTokenGroup = 'market' | 'gender' | 'genderMix' | 'incomeBand' | 'niche';

/**
 * Arrays are excluded deliberately: `briefData` must be a JSON object. A string,
 * a number or an array is a brief we cannot read, and the honest answer to an
 * unreadable brief is no constraints at all.
 */
function isRecord(value: unknown): value is Brief {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Pull the strings out of a brief field. Briefs in the wild hold plain strings
 * (`demographics`), string arrays (`interests`) and arrays of objects
 * (`products: [{ name, description }]`), so we walk two levels and take only
 * strings. Numbers are ignored on purpose — a bare number carries no context,
 * and letting one into the age parser is exactly how a product count becomes an
 * audience age.
 */
function flattenStrings(value: unknown, depth: number): string[] {
	if (typeof value === 'string') return [value];
	if (depth <= 0) return [];
	if (Array.isArray(value)) return value.flatMap((entry) => flattenStrings(entry, depth - 1));
	if (isRecord(value)) return Object.values(value).flatMap((entry) => flattenStrings(entry, depth - 1));
	return [];
}

/**
 * Only these field names are read. A whitelist (rather than "walk the whole
 * object") is what makes a deeply nested stranger of an object yield `{}`
 * instead of scraping constraints out of data that was never about the
 * audience. The ' . ' join is a sentence boundary so a phrase or a number range
 * can never be formed by accident across two unrelated fields.
 */
function collectText(brief: Brief, fields: readonly string[]): string {
	const parts: string[] = [];
	for (const field of fields) parts.push(...flattenStrings(brief[field], 2));
	return parts
		.map((part) => part.trim())
		.filter(Boolean)
		.join(' . ');
}

/** Fields that describe the AUDIENCE. Age, gender skew, market and life stage read only these. */
const AUDIENCE_FIELDS = [
	'demographics',
	'audience',
	'targetAudience',
	'target_audience',
	'market',
	'country',
	'region',
	'location'
] as const;

/** Fields that describe the BRAND. Niche and income band read these as well as the audience fields. */
const BRAND_FIELDS = [
	'brandName',
	'name',
	'tagline',
	'mission',
	'description',
	'industry',
	'niche',
	'category',
	'vertical',
	'products',
	'interests',
	'painPoints',
	'commStyle',
	'traits'
] as const;

/**
 * Every dash-like character folds to '-'. U+2013 (en dash) is the one that has
 * already cost this codebase a bug — the age chips are labelled '25–34' with a
 * typographic dash, so a brief pasted out of the UI carries it too, and a parser
 * that only knows ASCII '-' silently reads no age at all.
 */
const DASH_CHARS = /[\u2010-\u2015\u2212]/g;

function normalizeDashes(text: string): string {
	return text.replace(DASH_CHARS, '-').replace(/\s+/g, ' ').trim();
}

/** Lowercased, dash-folded prose. Used where punctuation matters (age ranges, '18+'). */
function toProse(text: string): string {
	return normalizeDashes(text).toLowerCase();
}

/**
 * Space-delimited word soup, padded with a leading and trailing space so a
 * phrase test is a plain `includes(' word ')`. Whole-word matching by
 * construction: no regex escaping, and 'men' can never match inside 'women'.
 */
function toWords(text: string): string {
	const stripped = toProse(text)
		.replace(/[^a-z0-9+]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return stripped ? ` ${stripped} ` : '';
}

function hasPhrase(words: string, phrase: string): boolean {
	return words.length > 0 && words.includes(` ${phrase} `);
}

function hasAnyPhrase(words: string, phrases: readonly string[]): boolean {
	return phrases.some((phrase) => hasPhrase(words, phrase));
}

// ── market ─────────────────────────────────────────────────────────────────

/**
 * Nationality and country words only. 'english' is absent on purpose (it names a
 * language far more often than a market) and so is 'gb'.
 */
const MARKET_WORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
	['au', ['australia', 'australian', 'australians', 'aussie', 'aussies']],
	['us', ['america', 'american', 'americans', 'usa', 'united states']],
	['uk', ['britain', 'british', 'united kingdom']]
];

/**
 * Country codes are matched CASE-SENSITIVELY against the original text. This is
 * not fussiness: lowercase 'us' is the first-person pronoun, and folding case
 * would turn "a brand that feels like us" into the United States market. An
 * uppercase standalone 'US' is unambiguously a country code.
 */
const MARKET_CODES: ReadonlyArray<readonly [string, RegExp]> = [
	['au', /\b(?:AU|AUS)\b/],
	['us', /\b(?:US|USA)\b/],
	['uk', /\bUK\b/]
];

/**
 * Ambiguity resolves to `undefined`, never to a winner. A brief that names two
 * markets has not told us which one the persona lives in, and 'generic' is not
 * a safe stand-in either — the caller owns that default.
 */
function detectMarket(brief: Brief, raw: string, words: string): string | undefined {
	const explicit = tokenForLabelOf('market', brief, ['market', 'country', 'region']);
	if (explicit) return explicit;
	const found = new Set<string>();
	for (const [token, phrases] of MARKET_WORDS) if (hasAnyPhrase(words, phrases)) found.add(token);
	for (const [token, code] of MARKET_CODES) if (code.test(raw)) found.add(token);
	if (found.size !== 1) return undefined;
	const [only] = found;
	return isToken('market', only) ? only : undefined;
}

// ── age range ──────────────────────────────────────────────────────────────

function clampAge(value: number): number {
	return Math.min(AGE_MAX, Math.max(AGE_MIN, Math.round(value)));
}

/** Clamp into 13..99, then swap when the brief wrote the bounds backwards ("aged 40 to 25"). */
function normalizeAgeRange(low: number, high: number): [number, number] {
	const a = clampAge(low);
	const b = clampAge(high);
	return a <= b ? [a, b] : [b, a];
}

/**
 * Three shapes, in order of how explicit they are.
 *
 * The `>= AGE_MIN` guard on the upper bound is what stops "open 9-5" and "buy
 * 2+ items" from being read as audience ages: a range whose largest number is
 * under 13 is not describing people. It is a blunt guard, and deliberately so —
 * a missed age costs nothing (the sampler picks one), a wrong age silently
 * filters the whole persona table.
 */
function parseAgeRange(prose: string): [number, number] | undefined {
	const explicit = /\b(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\b/.exec(prose);
	if (explicit) {
		const low = Number(explicit[1]);
		const high = Number(explicit[2]);
		if (Math.max(low, high) >= AGE_MIN) return normalizeAgeRange(low, high);
	}
	// "in their 30s" — a decade, so the band is that decade: [30, 39].
	const decade = /\b([1-9]0)s\b/.exec(prose);
	if (decade) {
		const start = Number(decade[1]);
		if (start + 9 >= AGE_MIN) return normalizeAgeRange(start, start + 9);
	}
	// "18+" — open-ended upward, closed at the top of the band.
	const plus = /\b(\d{1,2})\s*\+/.exec(prose);
	if (plus) {
		const start = Number(plus[1]);
		if (start >= AGE_MIN) return normalizeAgeRange(start, AGE_MAX);
	}
	return undefined;
}

// ── gender ─────────────────────────────────────────────────────────────────

const FEMALE_WORDS = [
	'women',
	'woman',
	'female',
	'females',
	'mums',
	'mum',
	'moms',
	'mom',
	'mothers',
	'mother',
	'ladies',
	'girls'
] as const;

const MALE_WORDS = ['men', 'man', 'male', 'males', 'dads', 'dad', 'fathers', 'father', 'boys'] as const;

/**
 * The audience's gender skew. "Both or neither → mixed" applies only when there
 * IS audience prose to read: 'mixed' is a reading of a sentence, not a value to
 * conjure for a brief that never described an audience.
 */
function detectGenderMix(words: string): string | undefined {
	if (!words) return undefined;
	const female = hasAnyPhrase(words, FEMALE_WORDS);
	const male = hasAnyPhrase(words, MALE_WORDS);
	if (female && !male) return 'female_skew';
	if (male && !female) return 'male_skew';
	return 'mixed';
}

/** Words that mean "the person on camera", as opposed to the person watching. */
const CREATOR_NOUNS = [
	'creator',
	'influencer',
	'persona',
	'presenter',
	'host',
	'spokesperson',
	'ambassador',
	'model',
	'founder',
	'character',
	'avatar'
] as const;

const CREATOR_GENDER_WORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
	['female', ['female', 'woman']],
	['male', ['male', 'man']]
];

/**
 * The creator's own gender, and ONLY when the brief literally describes the
 * creator ("a female creator", "the host should be a man").
 *
 * "Australian women 25-40" describes who is WATCHING. Deriving the creator's
 * gender from the audience's is the single most tempting wrong inference here:
 * plenty of briefs for a female audience want a male creator, and a wrong hard
 * constraint on gender removes half the sampler's tables before it starts. So
 * an audience description leaves this `undefined`, and the sampler decides.
 */
function detectCreatorGender(words: string): string | undefined {
	if (!words) return undefined;
	const found = new Set<string>();
	for (const [token, genderWords] of CREATOR_GENDER_WORDS) {
		for (const gender of genderWords) {
			for (const noun of CREATOR_NOUNS) {
				const phrases = [
					`${gender} ${noun}`,
					`${noun} is ${gender}`,
					`${noun} is a ${gender}`,
					`${noun} should be ${gender}`,
					`${noun} should be a ${gender}`
				];
				if (hasAnyPhrase(words, phrases)) found.add(token);
			}
		}
	}
	if (found.size !== 1) return undefined;
	const [only] = found;
	return isToken('gender', only) ? only : undefined;
}

// ── income band ────────────────────────────────────────────────────────────

const BUDGET_WORDS = ['budget', 'affordable', 'affordability', 'value', 'cheap', 'low cost', 'bargain'] as const;
const PREMIUM_WORDS = ['premium', 'high end', 'upscale', 'boutique'] as const;
const LUXURY_WORDS = ['luxury', 'luxurious'] as const;

/**
 * Price positioning is a proxy for the audience's income band, so it is read
 * with a light hand.
 *
 * 'value' matches only as a whole word, which keeps "our values" and "value
 * proposition" out (though "we value quality" still slips through — an accepted
 * false positive, and part of why a conflicting brief scores nothing).
 * Conflicting signals ("affordable luxury") yield `undefined` rather than a coin
 * flip, because a brief that says both has told us nothing usable.
 */
function detectIncomeBand(words: string): string | undefined {
	if (!words) return undefined;
	const budget = hasAnyPhrase(words, BUDGET_WORDS);
	const premium = hasAnyPhrase(words, PREMIUM_WORDS);
	const luxury = hasAnyPhrase(words, LUXURY_WORDS);
	if (budget && (premium || luxury)) return undefined;
	if (premium) return 'upper_middle';
	if (luxury) return 'high';
	if (budget) return 'lower_middle';
	return undefined;
}

// ── life stage ─────────────────────────────────────────────────────────────

/**
 * Checked first, and then REMOVED from the text before the established-family
 * pass runs. "new parents" contains "parents": without the removal the same
 * three words would emit both young_family and established_family, which are
 * contradictory constraints on the same persona.
 */
const YOUNG_FAMILY_PHRASES = [
	'new mums',
	'new mum',
	'new moms',
	'new mom',
	'new mothers',
	'new parents',
	'new parent',
	'young family',
	'young families',
	'first time parents',
	'expecting parents',
	'newborn',
	'newborns'
] as const;

/**
 * Plural audience nouns only. Bare 'family' and 'parent' are excluded: they read
 * as brand voice ("a family brand") at least as often as audience.
 */
const ESTABLISHED_FAMILY_PHRASES = ['parents', 'families', 'mums', 'moms', 'dads', 'mothers', 'fathers'] as const;
const STUDENT_PHRASES = [
	'student',
	'students',
	'undergrads',
	'uni students',
	'university students',
	'college students'
] as const;
const RETIRED_PHRASES = ['retirees', 'retiree', 'retired', 'seniors', 'pensioners'] as const;
const EARLY_CAREER_PHRASES = ['professionals', 'early career', 'early careers', 'graduates', 'grads'] as const;

function detectLifeStages(words: string): string[] | undefined {
	if (!words) return undefined;
	const found = new Set<string>();
	if (hasAnyPhrase(words, STUDENT_PHRASES)) found.add('student');
	if (hasAnyPhrase(words, EARLY_CAREER_PHRASES)) found.add('early_career');
	if (hasAnyPhrase(words, RETIRED_PHRASES)) found.add('retired');

	let residue = words;
	if (hasAnyPhrase(words, YOUNG_FAMILY_PHRASES)) {
		found.add('young_family');
		for (const phrase of YOUNG_FAMILY_PHRASES) residue = residue.split(` ${phrase} `).join('  ');
	}
	if (hasAnyPhrase(residue, ESTABLISHED_FAMILY_PHRASES)) found.add('established_family');

	// Emitted in the token list's own order so the output never depends on the
	// order the brief happened to mention things in.
	const ordered = TOKEN_GROUPS.lifeStage.filter((token) => found.has(token));
	return ordered.length ? [...ordered] : undefined;
}

// ── niche ──────────────────────────────────────────────────────────────────

/**
 * Keyword table, scored. 'lifestyle' has no entry on purpose: it is the label
 * that would match everything and therefore distinguishes nothing. Bare 'health'
 * is absent for the same reason — it collides with 'wellness' on every brief
 * that says "health and wellness", and a tie is thrown away, not guessed.
 */
const NICHE_KEYWORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
	[
		'beauty_wellness',
		[
			'skincare',
			'skin care',
			'skin',
			'beauty',
			'cosmetics',
			'makeup',
			'make up',
			'haircare',
			'hair care',
			'serum',
			'moisturiser',
			'moisturizer',
			'spa',
			'wellness',
			'self care'
		]
	],
	[
		'fitness_health',
		[
			'gym',
			'gyms',
			'fitness',
			'workout',
			'workouts',
			'strength training',
			'yoga',
			'pilates',
			'running',
			'supplements',
			'protein',
			'nutrition'
		]
	],
	['tech_ai', ['saas', 'software', 'ai', 'artificial intelligence', 'gadget', 'gadgets', 'developers', 'hardware', 'devices']],
	[
		'food_cooking',
		['recipe', 'recipes', 'cooking', 'kitchen', 'meals', 'meal prep', 'snacks', 'restaurant', 'coffee', 'baking', 'food']
	],
	[
		'fashion_style',
		['fashion', 'clothing', 'apparel', 'outfits', 'streetwear', 'jewellery', 'jewelry', 'footwear', 'sneakers', 'wardrobe']
	],
	[
		'travel_adventure',
		['travel', 'travellers', 'travelers', 'tourism', 'hotel', 'hotels', 'resort', 'itinerary', 'destinations', 'flights']
	],
	['finance_business', ['finance', 'investing', 'investors', 'banking', 'crypto', 'fintech', 'accounting', 'insurance', 'mortgage']],
	['gaming_esports', ['gaming', 'gamers', 'esports', 'console', 'video games']],
	['education_learning', ['course', 'courses', 'tutoring', 'edtech', 'curriculum', 'classroom', 'lessons']],
	['parenting_family', ['parenting', 'nappies', 'diapers', 'prams', 'strollers', 'motherhood', 'babies', 'toddlers']],
	['home_diy', ['home decor', 'interiors', 'furniture', 'renovation', 'diy', 'gardening', 'homeware']],
	['pets_animals', ['pet', 'pets', 'dogs', 'cats', 'puppy', 'veterinary', 'kitten']],
	['entertainment_pop_culture', ['celebrity', 'pop culture', 'movies', 'tv shows', 'streaming shows']],
	['sustainability_eco', ['sustainable', 'sustainability', 'eco', 'eco friendly', 'zero waste', 'recycled', 'carbon']],
	['arts_creativity', ['artist', 'artists', 'painting', 'illustration', 'handmade', 'crafts']],
	['sports', ['football', 'soccer', 'basketball', 'cricket', 'tennis', 'surfing', 'athletes']],
	['automotive', ['automotive', 'cars', 'vehicles', 'motorbike', 'tyres', 'tires', 'ev']]
];

/**
 * The brief's own structured field wins when it is (or reads as) a niche label —
 * "Beauty & Wellness" is exactly what the UI shows, so a brief written by this
 * app round-trips without any guessing at all. Prose keywords are the fallback,
 * and a tie between two niches is discarded rather than broken arbitrarily.
 */
function detectNiche(brief: Brief, words: string): string | undefined {
	const explicit = tokenForLabelOf('niche', brief, ['niche', 'industry', 'category', 'vertical']);
	if (explicit) return explicit;
	if (!words) return undefined;
	let best: string | undefined;
	let bestScore = 0;
	let tied = false;
	for (const [token, keywords] of NICHE_KEYWORDS) {
		const score = keywords.reduce((total, keyword) => total + (hasPhrase(words, keyword) ? 1 : 0), 0);
		if (score === 0) continue;
		if (score > bestScore) {
			best = token;
			bestScore = score;
			tied = false;
		} else if (score === bestScore) {
			tied = true;
		}
	}
	if (!best || tied) return undefined;
	return isToken('niche', best) ? best : undefined;
}

// ── shared helpers ─────────────────────────────────────────────────────────

/**
 * Try `tokenForLabel` on a brief's structured fields. LLM-written briefs store
 * display labels ("Beauty & Wellness", "Australia") where the contract wants
 * tokens; `tokenForLabel` already handles case and the en-dash, and returns null
 * rather than a near-miss.
 */
function tokenForLabelOf(group: 'market' | 'niche', brief: Brief, fields: readonly string[]): string | undefined {
	for (const field of fields) {
		const value = brief[field];
		if (typeof value !== 'string') continue;
		const token = tokenForLabel(group, value);
		if (token && isToken(group, token)) return token;
	}
	return undefined;
}

/** The one gate every token passes through before it can become a constraint. */
function keepToken(group: SingleTokenGroup, value: unknown): string | undefined {
	return isToken(group, value) ? value : undefined;
}

function keepLifeStages(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const kept = TOKEN_GROUPS.lifeStage.filter((token) => value.includes(token));
	return kept.length ? [...kept] : undefined;
}

/** Accepts a two-number tuple in any order and returns it clamped and sorted, or nothing. */
function keepAgeRange(value: unknown): [number, number] | undefined {
	if (!Array.isArray(value) || value.length !== 2) return undefined;
	const [low, high] = value;
	if (typeof low !== 'number' || typeof high !== 'number') return undefined;
	if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined;
	return normalizeAgeRange(low, high);
}

/**
 * Re-validates every field and drops what is not a real token. Both the
 * deterministic result and the LLM's answer pass through here, so there is
 * exactly one definition of "a constraint we are willing to emit".
 */
function sanitize(input: BriefConstraints): BriefConstraints {
	const out: BriefConstraints = {};
	const market = keepToken('market', input.market);
	if (market) out.market = market;
	const ageRange = keepAgeRange(input.ageRange);
	if (ageRange) out.ageRange = ageRange;
	const genderMix = keepToken('genderMix', input.genderMix);
	if (genderMix) out.genderMix = genderMix;
	const gender = keepToken('gender', input.gender);
	if (gender) out.gender = gender;
	const incomeBand = keepToken('incomeBand', input.incomeBand);
	if (incomeBand) out.incomeBand = incomeBand;
	const lifeStage = keepLifeStages(input.lifeStage);
	if (lifeStage) out.lifeStage = lifeStage;
	const niche = keepToken('niche', input.niche);
	if (niche) out.niche = niche;
	return out;
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * Read what the brief already says. Pure, deterministic, never throws: any
 * input that is not a readable brief object — null, a string, a number, an
 * array, an object of unrelated keys — returns `{}`, which is a correct and
 * complete answer, not a failure.
 */
export function briefToConstraints(briefData: unknown): BriefConstraints {
	if (!isRecord(briefData)) return {};

	const audienceRaw = collectText(briefData, AUDIENCE_FIELDS);
	const brandRaw = collectText(briefData, BRAND_FIELDS);
	const allRaw = [audienceRaw, brandRaw].filter(Boolean).join(' . ');

	const audienceProse = toProse(audienceRaw);
	const audienceWords = toWords(audienceRaw);
	const allWords = toWords(allRaw);

	return sanitize({
		market: detectMarket(briefData, audienceRaw, audienceWords),
		ageRange: parseAgeRange(audienceProse),
		genderMix: detectGenderMix(audienceWords),
		gender: detectCreatorGender(allWords),
		incomeBand: detectIncomeBand(allWords),
		lifeStage: detectLifeStages(audienceWords),
		niche: detectNiche(briefData, allWords)
	});
}

function tokenList(group: SingleTokenGroup | 'lifeStage'): string {
	return (TOKEN_GROUPS[group] as readonly string[]).join(' | ');
}

/**
 * The prompt for the optional LLM extraction step.
 *
 * A pure function of the brief — no clock, no ids, no randomness — so the same
 * brief always produces the same prompt and the call is cacheable and testable.
 * It enumerates the legal tokens rather than asking for free text, and insists
 * on omission over invention, because everything the model returns is about to
 * become a hard filter on the sampler.
 */
export function constraintsExtractionPrompt(briefData: unknown): string {
	const brief = isRecord(briefData) ? briefData : {};
	const audience = collectText(brief, AUDIENCE_FIELDS);
	const brand = collectText(brief, BRAND_FIELDS);

	return [
		'You are extracting audience constraints from a brand brief.',
		'',
		'AUDIENCE TEXT:',
		audience || '(none given)',
		'',
		'BRAND TEXT:',
		brand || '(none given)',
		'',
		'Return JSON only — no prose, no explanation, no markdown code fences.',
		'Shape (every key optional; omit a key entirely when the brief does not say):',
		'{',
		`  "market": ${tokenList('market')},`,
		'  "ageRange": [minAge, maxAge],  // whole numbers between 13 and 99',
		`  "genderMix": ${tokenList('genderMix')},  // the AUDIENCE's skew`,
		`  "gender": ${tokenList('gender')},  // the CREATOR's own gender — only if the brief describes the creator, never inferred from the audience`,
		`  "incomeBand": ${tokenList('incomeBand')},`,
		`  "lifeStage": [${tokenList('lifeStage')}],`,
		`  "niche": ${tokenList('niche')}`,
		'}',
		'',
		'Rules:',
		'- Use the exact tokens above. Any other value is discarded.',
		'- Omit anything the brief does not state or clearly imply. Omission is correct; a guess is not.',
		'- {} is a valid and complete answer.'
	].join('\n');
}

/**
 * Layer a model's answer over the deterministic result.
 *
 * Valid fields override, invalid fields are dropped in silence, unknown keys are
 * ignored, and a null/undefined/garbage answer leaves the base untouched. The
 * result is therefore never worse than the deterministic reading — the worst an
 * LLM can do here is add nothing.
 */
export function mergeExtractedConstraints(base: BriefConstraints, extracted: unknown): BriefConstraints {
	const safeBase = sanitize(isRecord(base) ? (base as BriefConstraints) : {});
	if (!isRecord(extracted)) return safeBase;
	const overrides = sanitize({
		market: typeof extracted.market === 'string' ? extracted.market : undefined,
		ageRange: keepAgeRange(extracted.ageRange),
		genderMix: typeof extracted.genderMix === 'string' ? extracted.genderMix : undefined,
		gender: typeof extracted.gender === 'string' ? extracted.gender : undefined,
		incomeBand: typeof extracted.incomeBand === 'string' ? extracted.incomeBand : undefined,
		lifeStage: keepLifeStages(extracted.lifeStage),
		niche: typeof extracted.niche === 'string' ? extracted.niche : undefined
	});
	return { ...safeBase, ...overrides };
}
