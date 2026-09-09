/**
 * Trait Registry invariants.
 *
 * The registry is the sampler's only source of values, so a hole here becomes a
 * persona with a missing or impossible field. These assert the properties the
 * sampler is allowed to rely on: every table exists for every market, every
 * token is real and labelled, gates reference only known tokens, and picking
 * always returns something.
 */
import { describe, it, expect } from 'vitest';
import { registry, gatePasses, REGISTRY_VERSION, GENERIC, AU } from './index';
import type { MarketRegistry, RegistryTable } from './types';
import { rng } from '../rng';
import { TOKEN_GROUPS, isToken, type TokenGroup } from '../tokens';
import { label } from '../labels';
import { NICHE_OPTIONS } from '../../persona-profile';

const MARKETS = ['au', 'us', 'uk', 'generic'] as const;
/** Every table field on a resolved registry, with the token group it draws from. */
const TABLE_FIELDS: Array<[keyof MarketRegistry, TokenGroup]> = [
	['heritage', 'heritage'],
	['education', 'education'],
	['employmentStatus', 'employmentStatus'],
	['workLocationMode', 'workLocationMode'],
	['seniority', 'seniority'],
	['incomeBand', 'incomeBand'],
	['priceFrame', 'priceFrame'],
	['relationshipStatus', 'relationshipStatus'],
	['childAgeBand', 'childAgeBand'],
	['housingType', 'housingType'],
	['pet', 'pet'],
	['activityLevel', 'activityLevel'],
	['transportMode', 'transportMode'],
	['dietaryStyle', 'dietaryStyle'],
	['skinTone', 'skinTone'],
	['eyeColor', 'eyeColor'],
	['bodyType', 'bodyType'],
	['hairLength', 'hairLength'],
	['hairstyle', 'hairstyle'],
	['hairColor', 'hairColor'],
	['hairTexture', 'hairTexture'],
	['faceShape', 'faceShape'],
	['browShape', 'browShape'],
	['priceSensitivity', 'priceSensitivity'],
	['purchaseChannel', 'purchaseChannel'],
	['brandLoyalty', 'brandLoyalty'],
	['promoResponsiveness', 'promoResponsiveness'],
	['messageProcessingStyle', 'messageProcessingStyle'],
	['communicationPreference', 'communicationPreference'],
	['digitalCapability', 'digitalCapability']
];

/** The decisioning tables, which carry gates the other tables do not need. */
const DECISIONING_FIELDS = [
	'priceSensitivity',
	'purchaseChannel',
	'brandLoyalty',
	'promoResponsiveness',
	'messageProcessingStyle',
	'communicationPreference',
	'digitalCapability'
] as const;

describe('version', () => {
	it('is semver and pinned — a change here means every persona re-rolls differently', () => {
		expect(REGISTRY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
	});
});

describe('resolution', () => {
	it('every market resolves every table, non-empty', () => {
		for (const m of MARKETS) {
			const r = registry.for(m);
			for (const [field, group] of TABLE_FIELDS) {
				const table = r[field as keyof typeof r] as RegistryTable;
				expect(table, `${m}.${String(field)}`).toBeTruthy();
				expect(table.group, `${m}.${String(field)} group`).toBe(group);
				expect(table.entries.length, `${m}.${String(field)} entries`).toBeGreaterThan(0);
			}
			expect(r.regions.length, `${m}.regions`).toBeGreaterThan(0);
			expect(r.names.length, `${m}.names`).toBeGreaterThan(0);
			expect(r.occupations.length, `${m}.occupations`).toBeGreaterThan(0);
			expect(r.languages.length, `${m}.languages`).toBeGreaterThan(0);
		}
	});

	it('an unknown or missing market falls back to generic instead of throwing', () => {
		expect(registry.for('xx').market).toBe('generic');
		expect(registry.for(null).market).toBe('generic');
		expect(registry.for(undefined).market).toBe('generic');
		expect(registry.for('').market).toBe('generic');
	});

	it('a market overlays only what it declares and inherits the rest', () => {
		const au = registry.for('au');
		// AU declares transport and heritage…
		expect(au.transportMode).toBe(AU.transportMode);
		expect(au.heritage).toBe(AU.heritage);
		// …and inherits everything it does not.
		expect(au.dietaryStyle).toBe(GENERIC.dietaryStyle);
		expect(au.occupations).toBe(GENERIC.occupations);
	});

	it('names merge per heritage: a market localises some, inherits the others', () => {
		const au = registry.for('au');
		const white = registry.namesFor(au, 'white');
		const southAsian = registry.namesFor(au, 'south_asian');
		expect(white.family).toContain('Whitlock'); // AU's own
		expect(southAsian.family).toEqual(
			registry.namesFor(registry.for('generic'), 'south_asian').family
		);
	});

	it('resolution is cached (same object back), so tables are safe to compare by identity', () => {
		expect(registry.for('au')).toBe(registry.for('au'));
	});
});

describe('table contents', () => {
	it('every token in every table is a real token of its group, with a label', () => {
		for (const m of MARKETS) {
			const r = registry.for(m);
			for (const [field, group] of TABLE_FIELDS) {
				const table = r[field as keyof typeof r] as RegistryTable;
				for (const e of table.entries) {
					expect(isToken(group, e.token), `${m}.${String(field)}: ${e.token}`).toBe(true);
					expect(label(group, e.token), `${m}.${String(field)}: ${e.token} label`).toBeTruthy();
				}
			}
		}
	});

	it('no table repeats a token, and weights are non-negative', () => {
		for (const m of MARKETS) {
			const r = registry.for(m);
			for (const [field] of TABLE_FIELDS) {
				const table = r[field as keyof typeof r] as RegistryTable;
				const tokens = table.entries.map((e) => e.token);
				expect(new Set(tokens).size, `${m}.${String(field)} duplicates`).toBe(tokens.length);
				for (const e of table.entries)
					expect(e.weight, `${m}.${String(field)}.${e.token}`).toBeGreaterThanOrEqual(0);
			}
		}
	});

	it('every table has at least one entry with weight > 0 (a zeroed table would be unpickable)', () => {
		for (const m of MARKETS) {
			const r = registry.for(m);
			for (const [field] of TABLE_FIELDS) {
				const table = r[field as keyof typeof r] as RegistryTable;
				expect(
					table.entries.some((e) => e.weight > 0),
					`${m}.${String(field)}`
				).toBe(true);
			}
		}
	});

	it('gates reference only known tokens', () => {
		for (const m of MARKETS) {
			const r = registry.for(m);
			const check = (
				g: NonNullable<RegistryTable['entries'][number]['gates']> | undefined,
				where: string
			) => {
				if (!g) return;
				for (const t of g.gender ?? [])
					expect(isToken('gender', t), `${where} gender ${t}`).toBe(true);
				for (const t of g.niches ?? [])
					expect(isToken('niche', t), `${where} niche ${t}`).toBe(true);
				for (const t of g.educations ?? [])
					expect(isToken('education', t), `${where} education ${t}`).toBe(true);
				for (const t of g.incomeBands ?? [])
					expect(isToken('incomeBand', t), `${where} income ${t}`).toBe(true);
				for (const t of g.seniorities ?? [])
					expect(isToken('seniority', t), `${where} seniority ${t}`).toBe(true);
				for (const t of g.marketOnly ?? [])
					expect(isToken('market', t), `${where} market ${t}`).toBe(true);
			};
			for (const [field] of TABLE_FIELDS) {
				const table = r[field as keyof typeof r] as RegistryTable;
				for (const e of table.entries) check(e.gates, `${m}.${String(field)}.${e.token}`);
			}
			for (const o of r.occupations) check(o.gates, `${m}.occupation.${o.title}`);
		}
	});

	it('every name set has both genders and family names, and every heritage token has a set', () => {
		for (const m of MARKETS) {
			const r = registry.for(m);
			for (const n of r.names) {
				expect(isToken('heritage', n.heritage)).toBe(true);
				expect(n.female.length, `${m}.${n.heritage}.female`).toBeGreaterThan(3);
				expect(n.male.length, `${m}.${n.heritage}.male`).toBeGreaterThan(3);
				expect(n.family.length, `${m}.${n.heritage}.family`).toBeGreaterThan(3);
			}
			// Every heritage the market can draw must have names to draw from.
			for (const e of r.heritage.entries) {
				if (e.weight <= 0) continue;
				expect(
					r.names.some((n) => n.heritage === e.token),
					`${m}: no names for ${e.token}`
				).toBe(true);
			}
		}
	});

	it('every niche can find at least one occupation', () => {
		const r = registry.for('generic');
		for (const nicheLabel of NICHE_OPTIONS) {
			const token = TOKEN_GROUPS.niche.find((t) => label('niche', t) === nicheLabel);
			expect(token, `no token for niche "${nicheLabel}"`).toBeTruthy();
			const suited = r.occupations.filter(
				(o) => !o.gates?.niches || o.gates.niches.includes(token!)
			);
			expect(suited.length, `niche ${token} has no occupation`).toBeGreaterThan(0);
		}
	});

	it('every city carries a real IANA-looking timezone and a valid context', () => {
		for (const m of MARKETS) {
			for (const region of registry.for(m).regions) {
				expect(region.cities.length, `${m}.${region.name}`).toBeGreaterThan(0);
				for (const c of region.cities) {
					expect(isToken('geographicContext', c.geographicContext), `${m}.${c.name}`).toBe(true);
					expect(c.timezone, `${m}.${c.name} tz`).toMatch(/^(UTC|[A-Za-z]+\/[A-Za-z_]+)$/);
					expect(c.weight).toBeGreaterThan(0);
				}
			}
		}
	});

	it('look priors only mention real tokens', () => {
		for (const m of MARKETS) {
			const r = registry.for(m);
			for (const [heritage, prior] of Object.entries(r.look)) {
				if (heritage !== 'default')
					expect(isToken('heritage', heritage), `look.${heritage}`).toBe(true);
				for (const [group, weights] of Object.entries(prior)) {
					for (const token of Object.keys(weights as object)) {
						expect(isToken(group as TokenGroup, token), `look.${heritage}.${group}.${token}`).toBe(
							true
						);
					}
				}
			}
		}
	});
});

describe('decisioning tables', () => {
	it('every decisioning table keeps an UNGATED entry, so gating can never empty it', () => {
		// registry.pick falls back to the ungated pool when every entry is gated
		// out — which would hand a low-income viewer the very token its gate
		// exists to forbid. One always-eligible entry per table prevents that.
		for (const m of MARKETS) {
			const r = registry.for(m);
			for (const field of DECISIONING_FIELDS) {
				const table = r[field] as RegistryTable;
				expect(
					table.entries.some((e) => e.weight > 0 && !e.gates),
					`${m}.${field} has no ungated entry`
				).toBe(true);
			}
		}
	});

	it('a low income can never draw price_insensitive or promo_averse — 500 picks', () => {
		const r = registry.for('generic');
		const gen = rng('low-income');
		for (let i = 0; i < 500; i++) {
			const age = 18 + (i % 63);
			expect(registry.pick(r.priceSensitivity, gen, { incomeBand: 'low', age })).not.toBe(
				'price_insensitive'
			);
			expect(registry.pick(r.promoResponsiveness, gen, { incomeBand: 'low', age })).not.toBe(
				'promo_averse'
			);
		}
	});

	it('a high income can never draw price_led, and reaches price_insensitive', () => {
		const r = registry.for('generic');
		const gen = rng('high-income');
		const seen = new Set<string>();
		for (let i = 0; i < 500; i++) {
			const token = registry.pick(r.priceSensitivity, gen, { incomeBand: 'high', age: 40 });
			expect(token).not.toBe('price_led');
			seen.add(token);
		}
		expect(seen.has('price_insensitive')).toBe(true);
	});

	it('every decisioning table spreads across more than one token for a plain context', () => {
		const r = registry.for('generic');
		for (const field of DECISIONING_FIELDS) {
			const gen = rng(`spread-${field}`);
			const seen = new Set<string>();
			for (let i = 0; i < 300; i++)
				seen.add(registry.pick(r[field] as RegistryTable, gen, { age: 38, incomeBand: 'middle' }));
			expect(seen.size, `${field} is effectively constant`).toBeGreaterThan(1);
		}
	});

	it('age gates hold: an older viewer draws neither peer_led nor advanced', () => {
		const r = registry.for('generic');
		const gen = rng('older');
		for (let i = 0; i < 300; i++) {
			expect(registry.pick(r.communicationPreference, gen, { age: 68 })).not.toBe('peer_led');
			expect(registry.pick(r.digitalCapability, gen, { age: 68 })).not.toBe('advanced');
		}
	});
});

describe('gatePasses', () => {
	it('an absent gate passes, and an UNKNOWN context value passes', () => {
		expect(gatePasses(undefined, {})).toBe(true);
		// The sampler fills in dependency order; a gate on a field not yet drawn
		// must not empty the table.
		expect(gatePasses({ minAge: 30 }, {})).toBe(true);
		expect(gatePasses({ niches: ['fitness_health'] }, {})).toBe(true);
	});

	it('enforces every dimension when the context knows it', () => {
		expect(gatePasses({ minAge: 30 }, { age: 29 })).toBe(false);
		expect(gatePasses({ minAge: 30 }, { age: 30 })).toBe(true);
		expect(gatePasses({ maxAge: 28 }, { age: 29 })).toBe(false);
		expect(gatePasses({ gender: ['female'] }, { gender: 'male' })).toBe(false);
		expect(gatePasses({ niches: ['tech_ai'] }, { niche: 'food_cooking' })).toBe(false);
		expect(gatePasses({ educations: ['bachelor'] }, { education: 'secondary' })).toBe(false);
		expect(gatePasses({ incomeBands: ['high'] }, { incomeBand: 'low' })).toBe(false);
		expect(gatePasses({ seniorities: ['owner'] }, { seniority: 'entry' })).toBe(false);
		expect(gatePasses({ marketOnly: ['au'] }, { market: 'us' })).toBe(false);
		expect(gatePasses({ hasChildren: true }, { hasChildren: false })).toBe(false);
		expect(gatePasses({ hasChildren: true }, { hasChildren: true })).toBe(true);
	});
});

describe('picking', () => {
	it('respects gates: a 22-year-old never draws a gated-older option', () => {
		const r = registry.for('generic');
		const gen = rng('gate-test');
		for (let i = 0; i < 300; i++) {
			expect(registry.pick(r.seniority, gen, { age: 22 })).not.toBe('lead');
			expect(registry.pick(r.education, gen, { age: 20 })).not.toBe('postgraduate');
			expect(registry.pick(r.hairColor, gen, { age: 25 })).not.toBe('silver_gray');
		}
	});

	it('never returns undefined even when every entry is gated out', () => {
		const r = registry.for('generic');
		const gen = rng('over-constrained');
		// Impossible context: too young for every seniority gate at once.
		const got = registry.pick(r.seniority, gen, { age: 5 });
		expect(typeof got).toBe('string');
		expect(isToken('seniority', got)).toBe(true);
	});

	it('throws only on a structurally empty table, which is a registry bug', () => {
		expect(() => registry.pick({ group: 'pet', entries: [] }, rng('x'))).toThrow(/empty/);
	});

	it('is deterministic for a seed', () => {
		const r = registry.for('au');
		const draw = () => {
			const gen = rng('same-seed');
			return [
				registry.pick(r.heritage, gen),
				registry.pick(r.housingType, gen, { age: 30, incomeBand: 'middle' })
			];
		};
		expect(draw()).toEqual(draw());
	});

	it('a heritage prior is AUTHORITATIVE for its group — unlisted tones are unreachable, not merely unlikely', () => {
		const r = registry.for('generic');
		const gen = rng('authoritative');
		const whitePrior = r.look.white;
		const allowed = new Set(Object.keys(whitePrior.skinTone ?? {}));
		for (let i = 0; i < 800; i++) {
			expect(allowed.has(registry.pickLook(r.skinTone, whitePrior, 'skinTone', gen))).toBe(true);
		}
		// A group the prior does not mention falls through to the base table.
		const seen = new Set<string>();
		for (let i = 0; i < 400; i++)
			seen.add(registry.pickLook(r.bodyType as never, whitePrior, 'bodyType' as never, gen));
		expect(seen.size).toBeGreaterThan(1);
	});

	it('pickLook re-weights by heritage: black_african skews deep/dark, white skews fair', () => {
		const r = registry.for('generic');
		const count = (heritage: string) => {
			const gen = rng(`look-${heritage}`);
			const prior = r.look[heritage];
			const seen: Record<string, number> = {};
			for (let i = 0; i < 600; i++) {
				const t = registry.pickLook(r.skinTone, prior, 'skinTone', gen);
				seen[t] = (seen[t] ?? 0) + 1;
			}
			return seen;
		};
		const black = count('black_african');
		const white = count('white');
		expect((black.deep ?? 0) + (black.dark ?? 0)).toBeGreaterThan(300);
		expect((white.fair_light ?? 0) + (white.porcelain ?? 0)).toBeGreaterThan(200);
		expect(white.deep ?? 0).toBe(0);
	});

	it('occupations honour niche affinity and always return something', () => {
		const r = registry.for('generic');
		const gen = rng('occ');
		for (let i = 0; i < 200; i++) {
			const o = registry.occupations(r, gen, { niche: 'pets_animals' });
			expect(o.gates?.niches === undefined || o.gates.niches.includes('pets_animals')).toBe(true);
		}
		// A niche with no dedicated occupation still resolves via the fallbacks.
		expect(registry.occupations(r, gen, { niche: 'entertainment_pop_culture' }).title).toBeTruthy();
	});
});

describe('market character — the tables actually differ', () => {
	it('AU, US and UK draw different heritage mixes and different places', () => {
		const heritageMix = (m: string) => {
			const r = registry.for(m);
			const gen = rng(`mix-${m}`);
			const seen: Record<string, number> = {};
			for (let i = 0; i < 1000; i++) {
				const t = registry.pick(r.heritage, gen);
				seen[t] = (seen[t] ?? 0) + 1;
			}
			return seen;
		};
		const au = heritageMix('au');
		const us = heritageMix('us');
		const uk = heritageMix('uk');
		// US has a large hispanic share; AU has almost none. UK leans south_asian.
		expect(us.hispanic ?? 0).toBeGreaterThan(120);
		expect(au.hispanic ?? 0).toBeLessThan(60);
		expect(uk.south_asian ?? 0).toBeGreaterThan(au.south_asian ?? 0);
		// AU has pacific_islander representation the others do not.
		expect(au.pacific_islander ?? 0).toBeGreaterThan(0);
		expect(us.pacific_islander ?? 0).toBe(0);

		const cities = (m: string) =>
			registry.for(m).regions.flatMap((r2) => r2.cities.map((c) => c.name));
		expect(cities('au')).toContain('Brisbane');
		expect(cities('us')).toContain('Austin');
		expect(cities('uk')).toContain('Manchester');
		expect(cities('au')).not.toContain('Austin');
	});

	it('a zero-weight heritage is never drawn but stays in the table as history', () => {
		const uk = registry.for('uk');
		expect(uk.heritage.entries.find((e) => e.token === 'pacific_islander')?.weight).toBe(0);
		const gen = rng('uk-zero');
		for (let i = 0; i < 500; i++)
			expect(registry.pick(uk.heritage, gen)).not.toBe('pacific_islander');
	});
});
