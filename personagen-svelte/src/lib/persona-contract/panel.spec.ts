/**
 * The viewer-panel contract (Phase 3).
 *
 * A panel is stored on the profile and read by the fit judge, so the properties
 * pinned here are the ones a change must not break: the same seed and audience
 * yield the identical panel; the panel never leaves the audience's own age
 * ranges; the mix is a property of the panel rather than a coin toss; five
 * viewers are five different people; and an empty or malformed audience — the
 * normal case for a persona that predates the field — still yields a panel.
 *
 * Sweeps run across many seeds on purpose: one lucky seed proves nothing about
 * a sampler.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PANEL_SIZE, MAX_PANEL_SIZE, sampleViewerPanel } from './panel';
import { CHILD_AGE_BAND_YEARS, MIN_PARENT_CHILD_GAP } from './sampler';
import type { PersonaAudience, ViewerSkeleton } from './schema';

const AUDIENCE: PersonaAudience = {
	ageRanges: ['45_54'],
	genderMix: 'female_skew',
	lifeStage: ['established_family'],
	incomeBand: 'middle'
};

const seeds = (n: number, prefix = 'seed'): string[] =>
	Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

describe('determinism', () => {
	it('the same seed and audience produce the identical panel', () => {
		for (const seed of seeds(20)) {
			const a = sampleViewerPanel(seed, AUDIENCE);
			const b = sampleViewerPanel(seed, AUDIENCE);
			expect(JSON.stringify(a)).toBe(JSON.stringify(b));
		}
	});

	it('different seeds produce different panels', () => {
		const rendered = seeds(20).map((seed) => JSON.stringify(sampleViewerPanel(seed, AUDIENCE)));
		expect(new Set(rendered).size).toBe(rendered.length);
	});

	it('every viewer carries the seed the plan pins', () => {
		const panel = sampleViewerPanel('jenny', AUDIENCE);
		expect(panel.map((v) => v.seed)).toEqual([
			'jenny:panel:0',
			'jenny:panel:1',
			'jenny:panel:2',
			'jenny:panel:3',
			'jenny:panel:4'
		]);
	});
});

describe('the audience is honoured', () => {
	it('every viewer sits inside one of the stated age ranges — 100 seeds', () => {
		const audience: PersonaAudience = { ageRanges: ['25_34', '55_plus'] };
		for (const seed of seeds(100)) {
			for (const viewer of sampleViewerPanel(seed, audience)) {
				const age = viewer.age as number;
				const inside = (age >= 25 && age <= 34) || age >= 55;
				expect(inside, `${viewer.seed} age ${age}`).toBe(true);
			}
		}
	});

	it('a single stated range pins every viewer into it', () => {
		for (const seed of seeds(50)) {
			for (const viewer of sampleViewerPanel(seed, { ageRanges: ['45_54'] })) {
				expect(viewer.age).toBeGreaterThanOrEqual(45);
				expect(viewer.age).toBeLessThanOrEqual(54);
			}
		}
	});

	it('several stated ranges are all represented in one panel', () => {
		const audience: PersonaAudience = { ageRanges: ['18_24', '35_44', '55_plus'] };
		for (const seed of seeds(30)) {
			const bands = new Set(
				sampleViewerPanel(seed, audience, { size: 6 }).map((v) => {
					const age = v.age as number;
					return age <= 24 ? 'young' : age <= 44 ? 'mid' : 'old';
				})
			);
			expect(bands.size).toBe(3);
		}
	});

	it('gender mix is an exact quota, not a coin toss', () => {
		for (const seed of seeds(30)) {
			const females = (a: PersonaAudience) =>
				sampleViewerPanel(seed, a).filter((v) => v.gender === 'female').length;
			expect(females({ genderMix: 'female_skew' })).toBe(4);
			expect(females({ genderMix: 'male_skew' })).toBe(1);
			expect(females({ genderMix: 'mixed' })).toBe(3);
		}
	});

	it('the seat a gender lands on still varies by seed', () => {
		const firstSeats = seeds(30).map(
			(seed) => sampleViewerPanel(seed, { genderMix: 'mixed' })[0].gender
		);
		expect(new Set(firstSeats).size).toBe(2);
	});

	it('a stated income band is used verbatim, and the price lens follows it', () => {
		for (const seed of seeds(40)) {
			for (const viewer of sampleViewerPanel(seed, { incomeBand: 'low' })) {
				expect(viewer.economic?.incomeBand).toBe('low');
				// The registry gates 'premium' and 'luxury' behind middle-or-better income.
				expect(['budget', 'value']).toContain(viewer.economic?.priceFrame);
			}
		}
	});

	it('a life stage narrows the age when no range is stated', () => {
		for (const seed of seeds(40)) {
			for (const viewer of sampleViewerPanel(seed, { lifeStage: ['retired'] })) {
				expect(viewer.age).toBeGreaterThanOrEqual(62);
			}
			for (const viewer of sampleViewerPanel(seed, { lifeStage: ['student'] })) {
				expect(viewer.age).toBeLessThanOrEqual(26);
			}
		}
	});

	it('a stated age range beats a life stage that contradicts it', () => {
		for (const seed of seeds(40)) {
			for (const viewer of sampleViewerPanel(seed, {
				ageRanges: ['25_34'],
				lifeStage: ['retired']
			})) {
				expect(viewer.age).toBeGreaterThanOrEqual(25);
				expect(viewer.age).toBeLessThanOrEqual(34);
			}
		}
	});

	it('decisioning is inherited from the audience, with unknown leaves dropped', () => {
		const panel = sampleViewerPanel('d', {
			decisioning: {
				priceSensitivity: 'value_led',
				brandLoyalty: 'switcher',
				digitalCapability: 'nonsense' as never
			}
		});
		for (const viewer of panel) {
			expect(viewer.decisioning).toEqual({
				priceSensitivity: 'value_led',
				brandLoyalty: 'switcher'
			});
		}
	});

	it('no decisioning on the audience means none on the viewer', () => {
		for (const viewer of sampleViewerPanel('d', { ageRanges: ['35_44'] })) {
			expect(viewer.decisioning).toBeUndefined();
		}
	});
});

describe('variety', () => {
	const identity = (v: ViewerSkeleton) => `${v.age}|${v.work?.title ?? v.work?.employmentStatus}`;

	it('a five-seat panel yields at least 3 distinct age/occupation combinations — 60 seeds', () => {
		for (const seed of seeds(60, 'variety')) {
			const panel = sampleViewerPanel(seed, AUDIENCE);
			const distinct = new Set(panel.map(identity));
			expect(distinct.size, `${seed} → ${[...distinct].join(', ')}`).toBeGreaterThanOrEqual(3);
		}
	});

	it('the same holds for a wide-open audience', () => {
		for (const seed of seeds(60, 'open')) {
			const distinct = new Set(sampleViewerPanel(seed, {}).map(identity));
			expect(distinct.size, seed).toBeGreaterThanOrEqual(3);
		}
	});

	it('cities are not all the same place across a panel', () => {
		const spread = seeds(30).map(
			(seed) => new Set(sampleViewerPanel(seed, AUDIENCE).map((v) => v.location?.city)).size
		);
		expect(Math.max(...spread)).toBeGreaterThan(1);
	});
});

describe('coherence', () => {
	it('no child band sits closer than the parent gap allows — 60 seeds', () => {
		for (const seed of seeds(60, 'kids')) {
			for (const viewer of sampleViewerPanel(seed, { ageRanges: ['25_34', '45_54'] })) {
				for (const band of viewer.household?.children?.ageBands ?? []) {
					const gap = (viewer.age as number) - CHILD_AGE_BAND_YEARS[band][1];
					expect(gap, `${viewer.seed} ${band}`).toBeGreaterThanOrEqual(MIN_PARENT_CHILD_GAP);
				}
			}
		}
	});

	it('a young-family audience has children at home more often than a student one', () => {
		const withKids = (stage: 'young_family' | 'student') =>
			seeds(40)
				.flatMap((seed) => sampleViewerPanel(seed, { lifeStage: [stage] }))
				.filter((v) => !!v.household?.children).length;
		expect(withKids('young_family')).toBeGreaterThan(withKids('student'));
	});

	it('every viewer has a summary that names the age', () => {
		for (const viewer of sampleViewerPanel('summary', AUDIENCE)) {
			expect(viewer.summary).toBeTruthy();
			expect(viewer.summary).toContain(String(viewer.age));
		}
	});

	it('a minor audience yields school-age viewers, not owners', () => {
		for (const seed of seeds(30, 'teen')) {
			for (const viewer of sampleViewerPanel(seed, { ageRanges: ['13_17'] })) {
				expect(viewer.age).toBeGreaterThanOrEqual(13);
				expect(viewer.age).toBeLessThanOrEqual(17);
				expect(viewer.work?.seniority).toBeUndefined();
				expect(viewer.work?.employmentStatus).toBe('student');
				expect(viewer.household?.children).toBeUndefined();
			}
		}
	});
});

describe('degradation', () => {
	it('an empty audience still yields a full panel of adults', () => {
		const panel = sampleViewerPanel('empty', {});
		expect(panel).toHaveLength(DEFAULT_PANEL_SIZE);
		for (const viewer of panel) {
			expect(viewer.age).toBeGreaterThanOrEqual(18);
			expect(viewer.age).toBeLessThanOrEqual(80);
			expect(viewer.gender).toBeTruthy();
			expect(viewer.location?.city).toBeTruthy();
			expect(viewer.economic?.incomeBand).toBeTruthy();
		}
	});

	it('null and undefined audiences do not throw', () => {
		expect(sampleViewerPanel('x', undefined)).toHaveLength(DEFAULT_PANEL_SIZE);
		expect(sampleViewerPanel('x', null)).toHaveLength(DEFAULT_PANEL_SIZE);
	});

	it('malformed input does not throw', () => {
		const junk = [
			{ ageRanges: 'nope', genderMix: 42, lifeStage: {}, incomeBand: 'rich', decisioning: 'x' },
			{ ageRanges: [null, 7, '25–34', '25_34'], lifeStage: ['galactic', 'retired'] },
			{ ageRanges: [], lifeStage: [], decisioning: {} },
			[],
			'audience',
			0
		];
		for (const audience of junk) {
			const panel = sampleViewerPanel('junk', audience as unknown as PersonaAudience);
			expect(panel).toHaveLength(DEFAULT_PANEL_SIZE);
			for (const viewer of panel) expect(typeof viewer.seed).toBe('string');
		}
	});

	it('a junk seed or options object still yields a panel', () => {
		expect(sampleViewerPanel('', AUDIENCE)).toHaveLength(DEFAULT_PANEL_SIZE);
		expect(sampleViewerPanel(undefined as unknown as string, AUDIENCE)).toHaveLength(
			DEFAULT_PANEL_SIZE
		);
		expect(sampleViewerPanel('s', AUDIENCE, null as unknown as { size: number })).toHaveLength(
			DEFAULT_PANEL_SIZE
		);
		expect(sampleViewerPanel('s', AUDIENCE, { market: 'atlantis' })).toHaveLength(
			DEFAULT_PANEL_SIZE
		);
	});

	it('size is clamped to something sane', () => {
		expect(sampleViewerPanel('s', AUDIENCE, { size: 3 })).toHaveLength(3);
		expect(sampleViewerPanel('s', AUDIENCE, { size: 0 })).toHaveLength(1);
		expect(sampleViewerPanel('s', AUDIENCE, { size: -20 })).toHaveLength(1);
		expect(sampleViewerPanel('s', AUDIENCE, { size: 10_000 })).toHaveLength(MAX_PANEL_SIZE);
		expect(sampleViewerPanel('s', AUDIENCE, { size: Number.NaN })).toHaveLength(DEFAULT_PANEL_SIZE);
		expect(sampleViewerPanel('s', AUDIENCE, { size: 2.6 })).toHaveLength(3);
	});

	it('an unknown market falls back to the generic registry rather than throwing', () => {
		const panel = sampleViewerPanel('m', AUDIENCE, { market: 'atlantis' });
		for (const viewer of panel) expect(viewer.location?.city).toBeTruthy();
	});
});

describe('purity', () => {
	it('does not mutate its input', () => {
		const audience: PersonaAudience = {
			ageRanges: ['35_44'],
			genderMix: 'mixed',
			lifeStage: ['young_family'],
			incomeBand: 'upper_middle',
			decisioning: { priceSensitivity: 'quality_led' }
		};
		const before = JSON.stringify(audience);
		const options = { size: 4, market: 'au' };
		const optionsBefore = JSON.stringify(options);
		sampleViewerPanel('pure', audience, options);
		expect(JSON.stringify(audience)).toBe(before);
		expect(JSON.stringify(options)).toBe(optionsBefore);
	});

	it('inherited decisioning is copied, not shared', () => {
		const audience: PersonaAudience = { decisioning: { brandLoyalty: 'loyal' } };
		const panel = sampleViewerPanel('copy', audience);
		expect(panel[0].decisioning).not.toBe(audience.decisioning);
		expect(panel[0].decisioning).not.toBe(panel[1].decisioning);
	});
});
