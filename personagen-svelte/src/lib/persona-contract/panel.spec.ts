/**
 * The viewer-panel contract (Phase 3).
 *
 * A panel is stored on the profile and read by the fit judge, so the properties
 * pinned here are the ones a change must not break: the same seed and audience
 * yield the identical panel; the panel never leaves the audience's own age
 * ranges; the mix is a property of the panel rather than a coin toss; five
 * viewers are five different people; a buying style is sampled per viewer and
 * can never contradict the viewer wearing it, while a STATED one always wins;
 * and an empty or malformed audience — the normal case for a persona that
 * predates the field — still yields a panel.
 *
 * Sweeps run across many seeds on purpose: one lucky seed proves nothing about
 * a sampler.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PANEL_SIZE, MAX_PANEL_SIZE, sampleViewerPanel } from './panel';
import { CHILD_AGE_BAND_YEARS, MIN_PARENT_CHILD_GAP } from './sampler';
import type { AudienceDecisioning, PersonaAudience, ViewerSkeleton } from './schema';
import { isToken, type TokenGroup } from './tokens';

/** Every decisioning leaf and the group its value must belong to. */
const DECISIONING_LEAVES: Array<[keyof AudienceDecisioning, TokenGroup]> = [
	['priceSensitivity', 'priceSensitivity'],
	['purchaseChannel', 'purchaseChannel'],
	['brandLoyalty', 'brandLoyalty'],
	['promoResponsiveness', 'promoResponsiveness'],
	['messageProcessingStyle', 'messageProcessingStyle'],
	['communicationPreference', 'communicationPreference'],
	['digitalCapability', 'digitalCapability']
];

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

	it('a stated decisioning leaf wins on every seat — 40 seeds', () => {
		const audience: PersonaAudience = {
			decisioning: { priceSensitivity: 'value_led', brandLoyalty: 'switcher' }
		};
		for (const seed of seeds(40)) {
			for (const viewer of sampleViewerPanel(seed, audience)) {
				expect(viewer.decisioning?.priceSensitivity).toBe('value_led');
				expect(viewer.decisioning?.brandLoyalty).toBe('switcher');
			}
		}
	});

	it('a stated leaf wins even where the registry would never have drawn it', () => {
		// 'low' income gates price_insensitive out of the table entirely, so this
		// value can only be here because the customer stated it.
		const audience: PersonaAudience = {
			incomeBand: 'low',
			decisioning: { priceSensitivity: 'price_insensitive' }
		};
		for (const seed of seeds(20)) {
			for (const viewer of sampleViewerPanel(seed, audience)) {
				expect(viewer.decisioning?.priceSensitivity).toBe('price_insensitive');
			}
		}
	});

	it('a malformed stated leaf is dropped and sampled instead, never copied verbatim', () => {
		const panel = sampleViewerPanel('d', {
			decisioning: {
				priceSensitivity: 'value_led',
				digitalCapability: 'nonsense' as never
			}
		});
		for (const viewer of panel) {
			expect(viewer.decisioning?.priceSensitivity).toBe('value_led');
			expect(viewer.decisioning?.digitalCapability).not.toBe('nonsense');
			expect(isToken('digitalCapability', viewer.decisioning?.digitalCapability)).toBe(true);
		}
	});

	it('an unstated leaf is still filled, from the registry, with a real token', () => {
		for (const viewer of sampleViewerPanel('d', { ageRanges: ['35_44'] })) {
			for (const [leaf, group] of DECISIONING_LEAVES) {
				expect(isToken(group, viewer.decisioning?.[leaf]), `${leaf}`).toBe(true);
			}
		}
	});
});

describe('decisioning is sampled per viewer', () => {
	it('a low income viewer never draws price_insensitive — 100 seeds', () => {
		const audience: PersonaAudience = { incomeBand: 'low' };
		for (const seed of seeds(100)) {
			for (const viewer of sampleViewerPanel(seed, audience, { size: MAX_PANEL_SIZE })) {
				expect(viewer.economic?.incomeBand).toBe('low');
				expect(viewer.decisioning?.priceSensitivity).not.toBe('price_insensitive');
				expect(viewer.decisioning?.promoResponsiveness).not.toBe('promo_averse');
			}
		}
	});

	it('a high income viewer never draws price_led — 100 seeds', () => {
		const audience: PersonaAudience = { incomeBand: 'high' };
		for (const seed of seeds(100)) {
			for (const viewer of sampleViewerPanel(seed, audience)) {
				expect(viewer.decisioning?.priceSensitivity).not.toBe('price_led');
			}
		}
	});

	it('viewers on one panel differ in decisioning — swept across 60 seeds', () => {
		let varied = 0;
		for (const seed of seeds(60, 'mix')) {
			const panel = sampleViewerPanel(seed, AUDIENCE);
			const rendered = new Set(panel.map((v) => JSON.stringify(v.decisioning)));
			if (rendered.size > 1) varied++;
		}
		// One lucky panel proves nothing; near-every panel must vary.
		expect(varied).toBeGreaterThan(55);
	});

	it('every decisioning leaf takes more than one value across the sweep', () => {
		const seen = new Map<string, Set<string>>();
		for (const seed of seeds(60, 'spread')) {
			for (const viewer of sampleViewerPanel(seed, {}, { size: MAX_PANEL_SIZE })) {
				for (const [leaf] of DECISIONING_LEAVES) {
					const value = viewer.decisioning?.[leaf];
					if (!value) continue;
					const bucket = seen.get(leaf) ?? new Set<string>();
					bucket.add(value);
					seen.set(leaf, bucket);
				}
			}
		}
		for (const [leaf] of DECISIONING_LEAVES) {
			expect(seen.get(leaf)?.size ?? 0, `${leaf}`).toBeGreaterThan(1);
		}
	});

	it('a viewer that is gated away from every option still gets a coherent value', () => {
		// A 65+ panel: peer_led and visual_led are gated out by age, so the leaf
		// must come from what remains rather than falling back past the gate.
		for (const seed of seeds(40, 'old')) {
			for (const viewer of sampleViewerPanel(seed, { ageRanges: ['55_plus'] })) {
				if ((viewer.age as number) < 60) continue;
				expect(viewer.decisioning?.communicationPreference).not.toBe('peer_led');
				expect(viewer.decisioning?.communicationPreference).not.toBe('visual_led');
				expect(viewer.decisioning?.digitalCapability).not.toBe('advanced');
			}
		}
	});

	it('decisioning is deterministic for a seed and does not move other fields', () => {
		for (const seed of seeds(20, 'det')) {
			const a = sampleViewerPanel(seed, AUDIENCE);
			const b = sampleViewerPanel(seed, AUDIENCE);
			expect(a.map((v) => JSON.stringify(v.decisioning))).toEqual(
				b.map((v) => JSON.stringify(v.decisioning))
			);
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
			// A usable panel includes a buying style: the fit judge reads it even
			// when the customer said nothing about how their audience decides.
			for (const [leaf, group] of DECISIONING_LEAVES) {
				expect(isToken(group, viewer.decisioning?.[leaf]), `${leaf}`).toBe(true);
			}
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
