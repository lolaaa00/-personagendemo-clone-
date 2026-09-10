import { describe, it, expect } from 'vitest';
import { buildLifeDetails, formatBirthday, hasAutoRows } from './life-details';
import { upgradeV1toV2 } from '$lib/persona-contract';

const flatten = (groups: ReturnType<typeof buildLifeDetails>) =>
	groups.flatMap((g) => g.rows.map((r) => `${g.key}.${r.key}`));

const valuesOf = (groups: ReturnType<typeof buildLifeDetails>) =>
	groups.flatMap((g) =>
		g.rows.map((r) => (r.value.kind === 'chips' ? r.value.chips.join(', ') : (r.value.text ?? '')))
	);

describe('buildLifeDetails — nothing to show renders nothing', () => {
	it('returns [] for junk, null and non-objects', () => {
		expect(buildLifeDetails(null)).toEqual([]);
		expect(buildLifeDetails(undefined)).toEqual([]);
		expect(buildLifeDetails('nope')).toEqual([]);
		expect(buildLifeDetails(42)).toEqual([]);
		expect(buildLifeDetails([])).toEqual([]);
	});

	it('returns [] for a v2 profile with no creator at all', () => {
		expect(buildLifeDetails({ meta: { schemaVersion: 2 } })).toEqual([]);
	});

	it('returns [] for a creator whose life leaves are all empty shapes', () => {
		const groups = buildLifeDetails({
			meta: { schemaVersion: 2 },
			creator: {
				displayName: 'Jenny Tran',
				work: {},
				location: {},
				household: { children: {} },
				lifestyle: {},
				economic: {},
				languages: [],
				traitLabels: [],
				neverDiscusses: [],
				education: '',
				birthday: ''
			}
		});
		expect(groups).toEqual([]);
	});

	it('returns [] for an upgraded v1 persona that never went through the sampler', () => {
		// The exact shape a legacy persona has: identity + appearance, nothing else.
		const v1 = {
			gender: 'female',
			displayName: 'Mia Chen',
			archetype: 'The Educator',
			targetAvatar: 'Busy parents',
			appearance: { ethnicity: 'East Asian', personaAge: '30–35', hairColor: 'Black' }
		};
		const upgraded = upgradeV1toV2(v1);
		// The upgrade does populate creator (gender/heritage/bucket age)…
		expect(upgraded.creator).toBeTruthy();
		// …and Life details still shows nothing, because every one of those leaves
		// is already editable elsewhere on the page.
		expect(buildLifeDetails(upgraded)).toEqual([]);
	});

	it('drops an age that came from a v1 bucket midpoint, keeps an exact one', () => {
		const bucket = buildLifeDetails({
			creator: { age: 32, ageSource: 'bucket' }
		});
		expect(bucket).toEqual([]);

		const exact = buildLifeDetails({ creator: { age: 32, ageSource: 'exact' } });
		expect(flatten(exact)).toEqual(['life.age']);

		// No ageSource at all is treated as exact — only 'bucket' is imprecise.
		expect(flatten(buildLifeDetails({ creator: { age: 41 } }))).toEqual(['life.age']);
	});

	it('never emits an empty group', () => {
		const groups = buildLifeDetails({ creator: { work: { title: 'Barista' } } });
		expect(groups).toHaveLength(1);
		expect(groups[0].key).toBe('work');
		expect(groups.every((g) => g.rows.length > 0)).toBe(true);
	});
});

describe('buildLifeDetails — labels, never tokens', () => {
	const profile = {
		meta: { schemaVersion: 2 },
		creator: {
			age: 34,
			ageSource: 'exact',
			birthday: '03-14',
			education: 'bachelor',
			languages: ['English', 'Vietnamese'],
			location: {
				city: 'Brisbane',
				region: 'Queensland',
				geographicContext: 'urban',
				timezone: 'Australia/Brisbane'
			},
			work: {
				title: 'Customer Support Lead',
				domain: 'retail_ecommerce',
				employmentStatus: 'employed_full_time',
				seniority: 'lead',
				workLocationMode: 'hybrid'
			},
			household: {
				relationshipStatus: 'married',
				children: { count: 2, ageBands: ['toddler', 'primary'] },
				pets: ['dog', 'cat'],
				housingType: 'apartment_rented'
			},
			lifestyle: {
				activityLevel: 'moderate',
				transportMode: 'public_transport',
				dietaryStyle: 'flexitarian'
			},
			economic: { incomeBand: 'upper_middle', priceFrame: 'value' },
			bigFive: {
				openness: 72,
				conscientiousness: 61,
				extraversion: 48,
				agreeableness: 80,
				neuroticism: 33
			},
			traitLabels: ['high_openness', 'high_agreeableness'],
			neverDiscusses: ['politics', 'medical_advice']
		}
	};

	it('renders no snake_case token anywhere in the output', () => {
		const rendered = [
			...valuesOf(buildLifeDetails(profile)),
			...buildLifeDetails(profile).flatMap((g) => [g.title, ...g.rows.map((r) => r.label)])
		].join(' | ');
		expect(rendered).not.toMatch(/[a-z]+_[a-z]+/);
	});

	it('turns known tokens into their registry labels', () => {
		const rendered = valuesOf(buildLifeDetails(profile));
		expect(rendered).toContain('Rented apartment');
		expect(rendered).toContain('Retail & e-commerce');
		expect(rendered).toContain('Upper-middle income');
		expect(rendered).toContain('Public transport');
		expect(rendered).toContain("Bachelor's degree");
		expect(rendered).toContain('Dog, Cat');
		expect(rendered).toContain('Curious, Warm');
		expect(rendered).toContain('Politics, Medical advice');
	});

	it('composes the derived phrases', () => {
		const rendered = valuesOf(buildLifeDetails(profile));
		expect(rendered).toContain('Brisbane, Queensland');
		expect(rendered).toContain('2 children (Toddler, Primary school)');
		expect(rendered).toContain('14 March');
	});

	it('orders groups life → work → place → household → personality', () => {
		expect(buildLifeDetails(profile).map((g) => g.key)).toEqual([
			'life',
			'work',
			'place',
			'household',
			'personality'
		]);
	});

	it('orders Big Five O-C-E-A-N regardless of stored key order', () => {
		const shuffled = {
			creator: {
				bigFive: {
					neuroticism: 33,
					agreeableness: 80,
					openness: 72,
					extraversion: 48,
					conscientiousness: 61
				}
			}
		};
		const personality = buildLifeDetails(shuffled)[0];
		expect(personality.rows.map((r) => r.key)).toEqual([
			'openness',
			'conscientiousness',
			'extraversion',
			'agreeableness',
			'neuroticism'
		]);
		expect(personality.rows.map((r) => r.label)).toEqual([
			'Openness',
			'Conscientiousness',
			'Extraversion',
			'Agreeableness',
			'Neuroticism'
		]);
	});

	it('is deterministic — same input, identical output', () => {
		expect(buildLifeDetails(profile)).toEqual(buildLifeDetails(profile));
	});

	it('falls back to the raw value for an off-registry token rather than blanking', () => {
		const rendered = valuesOf(buildLifeDetails({ creator: { education: 'doctorate' } }));
		expect(rendered).toEqual(['doctorate']);
	});
});

describe('buildLifeDetails — degenerate values', () => {
	it('renders "None" for zero children and nothing for a missing count', () => {
		expect(
			valuesOf(buildLifeDetails({ creator: { household: { children: { count: 0 } } } }))
		).toEqual(['None']);
		expect(
			buildLifeDetails({ creator: { household: { children: { ageBands: ['teen'] } } } })
		).toEqual([]);
	});

	it('renders one child in the singular', () => {
		expect(
			valuesOf(buildLifeDetails({ creator: { household: { children: { count: 1 } } } }))
		).toEqual(['1 child']);
	});

	it('shows whichever half of a place exists', () => {
		expect(valuesOf(buildLifeDetails({ creator: { location: { city: 'Perth' } } }))).toEqual([
			'Perth'
		]);
		expect(valuesOf(buildLifeDetails({ creator: { location: { region: 'Victoria' } } }))).toEqual([
			'Victoria'
		]);
	});

	it('ignores non-finite numbers and wrongly typed leaves', () => {
		expect(
			buildLifeDetails({
				creator: {
					age: Number.NaN,
					languages: 'English',
					household: { pets: 'dog' },
					bigFive: { openness: 'high' },
					work: { title: '   ' }
				}
			})
		).toEqual([]);
	});

	it('clamps and rounds a Big Five value into 0–100', () => {
		const rows = buildLifeDetails({
			creator: { bigFive: { openness: 140, conscientiousness: -20, extraversion: 61.6 } }
		})[0].rows;
		expect(rows.map((r) => (r.value.kind === 'meter' ? r.value.percent : -1))).toEqual([
			100, 0, 62
		]);
	});

	it('rejects a malformed birthday instead of printing it raw', () => {
		expect(formatBirthday('03-14')).toBe('14 March');
		expect(formatBirthday('1990-03-14')).toBeUndefined();
		expect(formatBirthday('13-40')).toBeUndefined();
		expect(formatBirthday('00-01')).toBeUndefined();
		expect(formatBirthday(null)).toBeUndefined();
		expect(formatBirthday(314)).toBeUndefined();
	});
});

describe('buildLifeDetails — provenance', () => {
	const withSources = (fieldSources: Record<string, string>) =>
		buildLifeDetails({
			meta: { schemaVersion: 2, fieldSources },
			creator: {
				work: { title: 'Barista' },
				location: { city: 'Hobart', region: 'Tasmania' }
			}
		});

	it('marks nothing when the profile carries no fieldSources', () => {
		const groups = buildLifeDetails({
			creator: { work: { title: 'Barista' } }
		});
		expect(hasAutoRows(groups)).toBe(false);
	});

	it('marks a sampled leaf and leaves a user-set leaf unmarked', () => {
		const groups = withSources({
			'creator.work.title': 'sampled',
			'creator.location.city': 'user',
			'creator.location.region': 'user'
		});
		const rows = groups.flatMap((g) => g.rows);
		expect(rows.find((r) => r.key === 'title')?.auto).toBe(true);
		expect(rows.find((r) => r.key === 'where')?.auto).toBe(false);
		expect(hasAutoRows(groups)).toBe(true);
	});

	it('treats derived as auto', () => {
		expect(withSources({ 'creator.work.title': 'derived' })[0].rows[0].auto).toBe(true);
	});

	it('never marks a multi-leaf row auto when any half of it is the user’s', () => {
		const rows = withSources({
			'creator.location.city': 'sampled',
			'creator.location.region': 'user'
		}).flatMap((g) => g.rows);
		expect(rows.find((r) => r.key === 'where')?.auto).toBe(false);
	});

	it('ignores an unknown provenance value rather than trusting it', () => {
		expect(withSources({ 'creator.work.title': 'wat' })[0].rows[0].auto).toBe(false);
	});
});
