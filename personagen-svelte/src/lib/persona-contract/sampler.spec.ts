/**
 * Persona Model v2 — sampler contract tests.
 *
 * These are not "does it run" tests. The sampler exists to make two specific
 * failures impossible, and this file is where each one is proved:
 *
 *   INCOHERENCE — a 30-year-old with a teenager, a 19-year-old 'lead', a
 *   24-year-old with silver hair, a female persona with a beard. Every one of
 *   those is asserted over 1,000 seeds, because a rule that only holds "usually"
 *   is a rule a user will meet the exception to on their first roster.
 *
 *   SAMENESS — the v1 personas were all 25–34 with wavy brown hair. Statistical
 *   floors (no decade over 45%, at least 8 work domains, at least 6 hair
 *   colours, both genders present) are asserted over the same 1,000 seeds, so a
 *   weight change that quietly collapses the distribution fails here rather than
 *   in a client's roster.
 *
 * Everything is checked on collected VIOLATIONS rather than inside conditional
 * `expect`s, so a suite that happens to draw no silver-haired persona reports
 * "nothing to check" as a pass with a real assertion, never as a silent skip
 * (vitest runs with `requireAssertions`).
 */
import { describe, expect, it } from 'vitest';
import { inferGenderFromName } from '../name-gender';
import { getPath, leafPaths, type Obj } from './paths';
import { REGISTRY_VERSION } from './registry';
import {
	CHILD_AGE_BAND_YEARS,
	MAX_HEIGHT_CM,
	MIN_HEIGHT_CM,
	MIN_PARENT_CHILD_GAP,
	inSentence,
	samplePersonaSkeleton,
	type SkeletonConstraints
} from './sampler';
import type { PersonaProfileV2 } from './schema';
import { isToken, type TokenGroup } from './tokens';

/** Fixed clock: `generatedAt` is the sampler's only impure input, so it is injected away. */
const NOW = '2026-09-08T04:05:06.000Z';

const sample = (seed: string, constraints?: SkeletonConstraints): PersonaProfileV2 =>
	samplePersonaSkeleton(seed, constraints, { now: NOW });

const seeds = (count: number, prefix = 's'): string[] =>
	Array.from({ length: count }, (_, index) => `${prefix}-${index}`);

/** Every leaf the sampler writes that must hold a token, and the group it belongs to. */
const TOKEN_PATHS: Record<string, TokenGroup> = {
	'creator.market': 'market',
	'creator.gender': 'gender',
	'creator.heritage': 'heritage',
	'creator.education': 'education',
	'creator.location.geographicContext': 'geographicContext',
	'creator.work.domain': 'workDomain',
	'creator.work.seniority': 'seniority',
	'creator.work.employmentStatus': 'employmentStatus',
	'creator.work.workLocationMode': 'workLocationMode',
	'creator.economic.incomeBand': 'incomeBand',
	'creator.economic.priceFrame': 'priceFrame',
	'creator.household.relationshipStatus': 'relationshipStatus',
	'creator.household.housingType': 'housingType',
	'creator.lifestyle.activityLevel': 'activityLevel',
	'creator.lifestyle.transportMode': 'transportMode',
	'creator.lifestyle.dietaryStyle': 'dietaryStyle',
	'strategy.niche': 'niche',
	'look.skinTone': 'skinTone',
	'look.bodyType': 'bodyType',
	'look.faceShape': 'faceShape',
	'look.browShape': 'browShape',
	'look.hair.color': 'hairColor',
	'look.hair.grayCoverage': 'grayCoverage',
	'look.hair.length': 'hairLength',
	'look.hair.texture': 'hairTexture',
	'look.hair.style': 'hairstyle',
	'look.facialHair': 'facialHair',
	'look.eyes.color': 'eyeColor',
	'look.eyewear': 'eyewear'
};

/** Token ARRAYS the sampler writes; every member must belong to the group. */
const TOKEN_ARRAY_PATHS: Record<string, TokenGroup> = {
	'creator.traitLabels': 'traitLabel',
	'creator.household.pets': 'pet',
	'creator.household.children.ageBands': 'childAgeBand'
};

/** Sections whose leaves the sampler owns; `meta` is provenance, not sampled content. */
const SAMPLED_SECTIONS = ['creator', 'look', 'strategy', 'description'] as const;

/**
 * Age gates copied from the registry's seniority/education/housing tables.
 * Restated here on purpose: a test that read the gate from the same table the
 * sampler reads would pass even if both were wrong together.
 */
const SENIORITY_MIN_AGE: Record<string, number> = { senior: 30, lead: 34, owner: 26 };
const POSTGRADUATE_MIN_AGE = 24;
const HOME_OWNER_MIN_AGE = 26;
const SILVER_HAIR_MIN_AGE = 45;
const GRAY_MIN_AGE = 35;

/** One shared 1,000-persona corpus: the invariant and distribution suites read the same people. */
const CORPUS = seeds(1000, 'corpus').map((seed) => sample(seed));

describe('samplePersonaSkeleton — determinism', () => {
	it('returns a deep-equal persona for the same seed, over 200 seeds', () => {
		const mismatches = seeds(200, 'det').filter((seed) => {
			const a = JSON.stringify(sample(seed));
			const b = JSON.stringify(sample(seed));
			return a !== b;
		});
		expect(mismatches).toEqual([]);
	});

	it('is deterministic under constraints too', () => {
		const constraints: SkeletonConstraints = {
			market: 'us',
			gender: 'male',
			heritage: 'south_asian',
			ageRange: [41, 47],
			niche: 'food_cooking',
			incomeBand: 'upper_middle',
			avoid: { names: ['Arjun Patel'], heritages: ['white'], workDomains: ['technology'] }
		};
		const mismatches = seeds(50, 'det-c').filter(
			(seed) => JSON.stringify(sample(seed, constraints)) !== JSON.stringify(sample(seed, constraints))
		);
		expect(mismatches).toEqual([]);
	});

	it('stamps meta from the registry and the injected clock, never from Date.now', () => {
		const profile = sample('meta-seed');
		expect(profile.meta).toMatchObject({
			schemaVersion: 2,
			seed: 'meta-seed',
			registryVersion: REGISTRY_VERSION,
			generator: 'skeleton_v1',
			generatedAt: new Date(NOW).toISOString()
		});
	});
});

describe('samplePersonaSkeleton — fork isolation', () => {
	it('produces a different person for seeds differing only in the trailing character', () => {
		const collisions: string[] = [];
		for (let i = 0; i < 100; i++) {
			const a = sample(`iso-${i}a`);
			const b = sample(`iso-${i}b`);
			if (JSON.stringify(a) === JSON.stringify(b)) collisions.push(`iso-${i}`);
		}
		expect(collisions).toEqual([]);
	});

	it('varies the fields independently — a shared stream would move them together', () => {
		// Same seed, one constraint changed. Fields upstream of the change (name,
		// look, personality) must be free to keep their draws: forking per field is
		// what stops "pick a different niche" from re-rolling the persona's face.
		const base = sample('fork-a');
		const other = sample('fork-a', { niche: base.strategy?.niche === 'lifestyle' ? 'tech_ai' : 'lifestyle' });
		expect(other.creator?.firstName).toBe(base.creator?.firstName);
		expect(other.look?.skinTone).toBe(base.look?.skinTone);
		expect(other.strategy?.niche).not.toBe(base.strategy?.niche);
	});
});

describe('samplePersonaSkeleton — constraints win', () => {
	const cases: { field: string; constraints: SkeletonConstraints; read: (p: PersonaProfileV2) => unknown }[] = [
		{ field: 'gender', constraints: { gender: 'male' }, read: (p) => p.creator?.gender },
		{ field: 'heritage', constraints: { heritage: 'caribbean' }, read: (p) => p.creator?.heritage },
		{ field: 'market', constraints: { market: 'uk' }, read: (p) => p.creator?.market },
		{ field: 'niche', constraints: { niche: 'gaming_esports' }, read: (p) => p.strategy?.niche },
		{ field: 'incomeBand', constraints: { incomeBand: 'high' }, read: (p) => p.creator?.economic?.incomeBand }
	];

	for (const testCase of cases) {
		it(`honours a supplied ${testCase.field} on every one of 200 seeds`, () => {
			const wanted = Object.values(testCase.constraints)[0];
			const wrong = seeds(200, testCase.field)
				.map((seed) => testCase.read(sample(seed, testCase.constraints)))
				.filter((actual) => actual !== wanted);
			expect(wrong).toEqual([]);
		});
	}

	it('honours a supplied age range on every one of 200 seeds', () => {
		const outside = seeds(200, 'age')
			.map((seed) => sample(seed, { ageRange: [52, 58] }).creator?.age ?? -1)
			.filter((age) => age < 52 || age > 58);
		expect(outside).toEqual([]);
	});
});

describe('samplePersonaSkeleton — name conditioning', () => {
	it('keeps a supplied name verbatim and takes the gender signal from it', () => {
		expect(inferGenderFromName('Jenny Tran')).toBe('female');
		const profile = sample('name-1', { name: 'Jenny Tran' });
		expect(profile.creator?.firstName).toBe('Jenny');
		expect(profile.creator?.lastName).toBe('Tran');
		expect(profile.creator?.displayName).toBe('Jenny Tran');
		expect(profile.creator?.gender).toBe('female');
	});

	it('never re-draws the gender a name implies', () => {
		const withName = seeds(200, 'name').map((seed) => sample(seed, { name: 'Jenny Tran' }));
		expect(withName.filter((p) => p.creator?.gender !== 'female')).toEqual([]);
		expect(withName.filter((p) => p.creator?.firstName !== 'Jenny')).toEqual([]);
		// Control: without the name the same seeds do draw both genders, so the
		// assertion above is testing conditioning and not a constant.
		const free = seeds(200, 'name').map((seed) => sample(seed).creator?.gender);
		expect(new Set(free).size).toBe(2);
	});

	it('splits on the first space only, and accepts a single token', () => {
		const compound = sample('name-2', { name: 'Ana Maria de Souza' });
		expect(compound.creator?.firstName).toBe('Ana');
		expect(compound.creator?.lastName).toBe('Maria de Souza');
		const single = sample('name-3', { name: 'Cher' });
		expect(single.creator?.firstName).toBe('Cher');
		expect(single.creator?.lastName).toBeUndefined();
	});

	it('falls through to a drawn gender when the name carries no signal', () => {
		const genders = new Set(seeds(120, 'unknown-name').map((seed) => sample(seed, { name: 'Qzx Vorm' }).creator?.gender));
		expect(genders.size).toBe(2);
	});
});

describe('samplePersonaSkeleton — avoid is a soft preference', () => {
	it('prefers an unused heritage and work domain', () => {
		const avoided = seeds(60, 'avoid').map((seed) =>
			sample(seed, { avoid: { heritages: ['white'], workDomains: ['technology'] } })
		);
		expect(avoided.filter((p) => p.creator?.heritage === 'white')).toEqual([]);
		expect(avoided.filter((p) => p.creator?.work?.domain === 'technology')).toEqual([]);
	});

	it('still returns a persona when every option is avoided', () => {
		// An exhausted avoid-list must degrade, never throw and never loop: a
		// roster of 200 creators would otherwise stop being able to add its 201st.
		const profile = sample('avoid-all', {
			avoid: { heritages: ALL_HERITAGES, workDomains: ALL_WORK_DOMAINS, names: ALL_AVOIDED_NAMES }
		});
		expect(profile.creator?.heritage).toBeDefined();
		expect(profile.creator?.work?.domain).toBeDefined();
		expect(profile.creator?.firstName).toBeTruthy();
	});
});

describe('samplePersonaSkeleton — dependency invariants (1,000 seeds)', () => {
	it('never gives a parent a child less than 16 years younger', () => {
		const violations: string[] = [];
		for (const profile of CORPUS) {
			const age = profile.creator?.age ?? 0;
			for (const band of profile.creator?.household?.children?.ageBands ?? []) {
				const oldestImplied = CHILD_AGE_BAND_YEARS[band][1];
				if (age - oldestImplied < MIN_PARENT_CHILD_GAP) violations.push(`${age} / ${band}`);
			}
		}
		expect(violations).toEqual([]);
	});

	it('never records children without a count, or a count without children', () => {
		const violations = CORPUS.filter((profile) => {
			const children = profile.creator?.household?.children;
			if (!children) return false;
			return children.count !== children.ageBands.length || children.count < 1 || children.count > 3;
		});
		expect(violations).toEqual([]);
	});

	it('never places children under an implausible age or relationship', () => {
		const violations = CORPUS.filter((profile) => {
			if (!profile.creator?.household?.children) return false;
			const age = profile.creator.age ?? 0;
			const status = profile.creator.household.relationshipStatus;
			return age < 24 || !['partnered', 'married', 'separated', 'widowed'].includes(String(status));
		});
		expect(violations).toEqual([]);
	});

	it('never puts a seniority below its gate age', () => {
		const violations = CORPUS.filter((profile) => {
			const min = SENIORITY_MIN_AGE[String(profile.creator?.work?.seniority)];
			return min !== undefined && (profile.creator?.age ?? 0) < min;
		}).map((profile) => `${profile.creator?.work?.seniority}@${profile.creator?.age}`);
		expect(violations).toEqual([]);
	});

	it('never awards a postgraduate degree below 24', () => {
		const violations = CORPUS.filter(
			(profile) => profile.creator?.education === 'postgraduate' && (profile.creator?.age ?? 0) < POSTGRADUATE_MIN_AGE
		);
		expect(violations).toEqual([]);
	});

	it('never lets someone own their home below 26', () => {
		const violations = CORPUS.filter(
			(profile) =>
				String(profile.creator?.household?.housingType).endsWith('_owned') &&
				(profile.creator?.age ?? 0) < HOME_OWNER_MIN_AGE
		);
		expect(violations).toEqual([]);
	});

	it('never gives silver hair below 45, nor any gray coverage below 35', () => {
		const silver = CORPUS.filter(
			(profile) => profile.look?.hair?.color === 'silver_gray' && (profile.creator?.age ?? 0) < SILVER_HAIR_MIN_AGE
		);
		const gray = CORPUS.filter(
			(profile) => (profile.creator?.age ?? 0) < GRAY_MIN_AGE && profile.look?.hair?.grayCoverage !== 'none'
		);
		expect(silver).toEqual([]);
		expect(gray).toEqual([]);
	});

	it('never gives a female persona facial hair', () => {
		const violations = CORPUS.filter(
			(profile) => profile.creator?.gender === 'female' && profile.look?.facialHair !== 'none'
		);
		expect(violations).toEqual([]);
	});

	it('never shaves a head that has long hair', () => {
		const violations = CORPUS.filter(
			(profile) =>
				profile.look?.hair?.style === 'bald_shaved' &&
				!['pixie', 'short'].includes(String(profile.look?.hair?.length))
		);
		expect(violations).toEqual([]);
	});

	it('keeps height inside the human range', () => {
		const violations = CORPUS.filter((profile) => {
			const height = profile.look?.heightCm ?? 0;
			return !Number.isInteger(height) || height < MIN_HEIGHT_CM || height > MAX_HEIGHT_CM;
		}).map((profile) => profile.look?.heightCm);
		expect(violations).toEqual([]);
	});

	it('keeps every Big Five score an integer in 0–100', () => {
		const violations: string[] = [];
		for (const profile of CORPUS) {
			const bigFive = profile.creator?.bigFive;
			if (!bigFive) {
				violations.push('missing');
				continue;
			}
			for (const [trait, value] of Object.entries(bigFive)) {
				if (!Number.isInteger(value) || value < 0 || value > 100) violations.push(`${trait}=${value}`);
			}
		}
		expect(violations).toEqual([]);
	});

	it('derives trait labels from the scores it wrote', () => {
		const violations: string[] = [];
		for (const profile of CORPUS.slice(0, 200)) {
			const scores: [string, number][] = Object.entries(profile.creator?.bigFive ?? {});
			const labels = new Set(profile.creator?.traitLabels ?? []);
			for (const [trait, value] of scores) {
				if (value >= 65 && !labels.has(`high_${trait}` as never)) violations.push(`high ${trait} ${value}`);
				if (value <= 35 && !labels.has(`low_${trait}` as never)) violations.push(`low ${trait} ${value}`);
				if (value > 35 && value < 65 && (labels.has(`high_${trait}` as never) || labels.has(`low_${trait}` as never)))
					violations.push(`mid ${trait} ${value}`);
			}
		}
		expect(violations).toEqual([]);
	});
});

describe('samplePersonaSkeleton — distribution (1,000 seeds)', () => {
	const share = (counts: Map<string, number>): number => Math.max(...counts.values()) / CORPUS.length;

	const tally = (read: (profile: PersonaProfileV2) => string | undefined): Map<string, number> => {
		const counts = new Map<string, number>();
		for (const profile of CORPUS) {
			const key = read(profile);
			if (key === undefined) continue;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		return counts;
	};

	it('spreads age across decades — no decade takes more than 45%', () => {
		const decades = tally((profile) => `${Math.floor((profile.creator?.age ?? 0) / 10)}0s`);
		expect(share(decades)).toBeLessThan(0.45);
		expect(decades.size).toBeGreaterThanOrEqual(5);
	});

	it('keeps no heritage above 55% in the default (au) market', () => {
		const heritages = tally((profile) => profile.creator?.heritage);
		expect(share(heritages)).toBeLessThan(0.55);
		expect(heritages.size).toBeGreaterThanOrEqual(5);
	});

	it('reaches at least 8 distinct work domains', () => {
		expect(tally((profile) => profile.creator?.work?.domain).size).toBeGreaterThanOrEqual(8);
	});

	it('reaches at least 6 distinct hair colours', () => {
		expect(tally((profile) => profile.look?.hair?.color).size).toBeGreaterThanOrEqual(6);
	});

	it('produces both genders', () => {
		expect(tally((profile) => profile.creator?.gender).size).toBe(2);
	});

	it('actually exercises the rules the invariant suite asserts', () => {
		// A guard against VACUOUS invariants. "No silver hair under 45" passes
		// trivially if the sampler stopped producing silver hair at all, and
		// "no child within 16 years" passes trivially if it stopped producing
		// children. These floors are far below the observed rates; they exist to
		// fail loudly when a weight change quietly removes a whole branch.
		const withChildren = CORPUS.filter((profile) => profile.creator?.household?.children).length;
		const silver = CORPUS.filter((profile) => profile.look?.hair?.color === 'silver_gray').length;
		const owned = CORPUS.filter((profile) => String(profile.creator?.household?.housingType).endsWith('_owned'))
			.length;
		const bearded = CORPUS.filter((profile) => profile.look?.facialHair !== 'none').length;
		const graying = CORPUS.filter((profile) => profile.look?.hair?.grayCoverage !== 'none').length;
		expect(withChildren).toBeGreaterThan(100);
		expect(silver).toBeGreaterThan(10);
		expect(owned).toBeGreaterThan(50);
		expect(bearded).toBeGreaterThan(20);
		expect(graying).toBeGreaterThan(50);
	});

	it('varies the things v1 held constant — city, job title, body type', () => {
		expect(tally((profile) => profile.creator?.location?.city).size).toBeGreaterThanOrEqual(8);
		expect(tally((profile) => profile.creator?.work?.title).size).toBeGreaterThanOrEqual(15);
		expect(tally((profile) => profile.look?.bodyType).size).toBeGreaterThanOrEqual(5);
	});
});

describe('samplePersonaSkeleton — tokens and provenance', () => {
	it('writes a real token of the right group into every token field', () => {
		const violations: string[] = [];
		for (const profile of CORPUS.slice(0, 300)) {
			const root = profile as unknown as Obj;
			for (const [path, group] of Object.entries(TOKEN_PATHS)) {
				const value = getPath(root, path);
				if (value === undefined) continue;
				if (!isToken(group, value)) violations.push(`${path}=${String(value)}`);
			}
			for (const [path, group] of Object.entries(TOKEN_ARRAY_PATHS)) {
				const value = getPath(root, path);
				if (value === undefined) continue;
				if (!Array.isArray(value)) violations.push(`${path} is not an array`);
				else for (const item of value) if (!isToken(group, item)) violations.push(`${path}[]=${String(item)}`);
			}
		}
		expect(violations).toEqual([]);
	});

	it('records a fieldSource for every leaf it wrote', () => {
		const missing: string[] = [];
		const dangling: string[] = [];
		for (const profile of CORPUS.slice(0, 200)) {
			const root = profile as unknown as Obj;
			const sources = profile.meta.fieldSources ?? {};
			for (const section of SAMPLED_SECTIONS) {
				if (root[section] === undefined) continue;
				for (const path of leafPaths(root[section], section)) {
					if (sources[path] !== 'sampled') missing.push(path);
				}
			}
			for (const path of Object.keys(sources)) {
				if (getPath(root, path) === undefined) dangling.push(path);
			}
		}
		expect(missing).toEqual([]);
		expect(dangling).toEqual([]);
	});
});

describe('samplePersonaSkeleton — description', () => {
	it('writes one plain sentence naming the person, their age, job and city', () => {
		const profile = sample('desc-1');
		const short = profile.description?.short ?? '';
		expect(short).toMatch(/^\S.*\.$/);
		expect(short).toContain(String(profile.creator?.age));
		expect(short).toContain(String(profile.creator?.location?.city));
		expect(short).toContain(String(profile.creator?.displayName));
		expect(short).not.toMatch(/_/);
	});

	it('renders frame values as labels, never tokens', () => {
		const withUnderscores: string[] = [];
		for (const profile of CORPUS.slice(0, 200)) {
			for (const fact of profile.description?.frame ?? []) {
				if (/(^|\s)[a-z0-9]+_[a-z0-9_]+(\s|$)/.test(fact.value)) withUnderscores.push(`${fact.key}=${fact.value}`);
			}
		}
		expect(withUnderscores).toEqual([]);
	});

	it('frames age, location, work and household with readable values', () => {
		const profile = sample('desc-2', { market: 'au', ageRange: [34, 34], niche: 'fitness_health' });
		const frame = profile.description?.frame ?? [];
		expect(frame.map((fact) => fact.key)).toEqual(['age', 'location', 'work', 'household']);
		const location = frame.find((fact) => fact.key === 'location');
		expect(location?.value).toContain(String(profile.creator?.location?.city));
		expect(location?.value).toContain(String(profile.creator?.location?.region));
		const work = frame.find((fact) => fact.key === 'work');
		expect(work?.value).toContain(String(profile.creator?.work?.title));
		expect(work?.value).not.toContain(String(profile.creator?.work?.domain));
	});
});

describe('samplePersonaSkeleton — degenerate inputs', () => {
	it('works with no constraints at all', () => {
		const profile = samplePersonaSkeleton('bare', {}, { now: NOW });
		expect(profile.creator?.firstName).toBeTruthy();
		expect(profile.creator?.work?.title).toBeTruthy();
		expect(profile.look?.skinTone).toBeTruthy();
		expect(profile.description?.short).toBeTruthy();
	});

	it('works with the constraints argument omitted entirely', () => {
		const profile = samplePersonaSkeleton('bare-2');
		expect(profile.creator?.market).toBe('au');
		expect(profile.meta.generatedAt).toBeTruthy();
	});

	it('returns a complete persona when over-constrained (18–19 in a seniority-heavy niche)', () => {
		// The hard case rule 7 exists for: the niche's plausible jobs want a
		// seniority this age cannot hold. The sampler must degrade to the closest
		// valid combination, not emit a hole.
		const incomplete: string[] = [];
		for (const seed of seeds(200, 'tight')) {
			const profile = sample(seed, { ageRange: [18, 19], niche: 'finance_business', incomeBand: 'high' });
			const age = profile.creator?.age ?? 0;
			if (age < 18 || age > 19) incomplete.push(`age ${age}`);
			if (!profile.creator?.work?.title) incomplete.push('no title');
			if (!profile.creator?.household?.housingType) incomplete.push('no housing');
			if (!profile.look?.hair?.color) incomplete.push('no hair colour');
			if (profile.creator?.household?.children) incomplete.push('children at 18');
			const min = SENIORITY_MIN_AGE[String(profile.creator?.work?.seniority)];
			if (min !== undefined && age < min) incomplete.push(`seniority ${profile.creator?.work?.seniority}`);
		}
		expect(incomplete).toEqual([]);
	});

	it('clamps an inverted or out-of-range age range instead of failing', () => {
		const inverted = sample('clamp-1', { ageRange: [40, 30] });
		expect(inverted.creator?.age).toBeGreaterThanOrEqual(30);
		expect(inverted.creator?.age).toBeLessThanOrEqual(40);
		const impossible = sample('clamp-2', { ageRange: [-5, 3] });
		expect(impossible.creator?.age).toBe(18);
	});
});

/** Every heritage token — used to prove an exhausted avoid-list still returns a persona. */
const ALL_HERITAGES = [
	'mixed',
	'hispanic',
	'white',
	'south_asian',
	'black_african',
	'east_asian',
	'southeast_asian',
	'middle_eastern',
	'native_american',
	'pacific_islander',
	'caribbean',
	'central_asian'
];

const ALL_WORK_DOMAINS = [
	'health_care',
	'fitness_wellness',
	'beauty_personal_care',
	'education',
	'technology',
	'creative_media',
	'hospitality_food',
	'retail_ecommerce',
	'trades_construction',
	'finance_admin',
	'marketing_sales',
	'public_service',
	'parenting_home',
	'science_research',
	'sports_outdoors',
	'automotive_transport',
	'arts_entertainment',
	'agriculture_environment'
];

/** A blunt instrument: avoid every name the au/generic tables can produce. */
const ALL_AVOIDED_NAMES = ['Chloe', 'Ruby', 'Isla', 'Jack', 'Ollie', 'Cooper', 'Whitlock', 'Fitzgerald', 'Kennedy'];

describe('description prose reads as English', () => {
	it('lower-cases a whole multi-word job title, not just its first letter', () => {
		// Regression: "a 46-year-old customer Support Lead" — lower-casing only the
		// first character left every later word in title case.
		const offenders: string[] = [];
		for (let i = 0; i < 400; i++) {
			const short = samplePersonaSkeleton(`prose-${i}`).description?.short ?? '';
			// Any capitalised word AFTER the "N-year-old" phrase, other than the
			// place name that follows " in ", is a casing leak.
			const tail = short.split(/\d+-year-old /)[1] ?? '';
			const beforePlace = tail.split(' in ')[0] ?? '';
			if (/\b[A-Z][a-z]/.test(beforePlace)) offenders.push(short);
		}
		expect(offenders).toEqual([]);
	});

	it('keeps initialisms upright inside a title', () => {
		expect(inSentence('AI Researcher')).toBe('AI researcher');
		expect(inSentence('Customer Support Lead')).toBe('customer support lead');
		expect(inSentence('UX Designer')).toBe('UX designer');
	});
});
