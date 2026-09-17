/**
 * Persona Model v2 — the viewer panel (Phase 3, P3.1/P3.2).
 *
 * An audience description is a bracket: "women 45–54, mid income, parents".
 * Nobody writes a script for a bracket. `sampleViewerPanel` turns the bracket
 * into a handful of CONCRETE viewers — an age, a city, a day job, a household,
 * a price lens — so a draft can be judged against someone rather than against a
 * demographic. The fit judge (P3.3) reads this panel; the persona page shows it
 * as the "who she is talking to" cards.
 *
 * The rules are the sampler's rules, deliberately:
 *   1. ONE FORK PER FIELD. Every draw comes from `r.fork('<field>')`, so adding
 *      a field later cannot re-roll the fields around it.
 *   2. DEPENDENCY ORDER. age → seniority → income → occupation → household →
 *      employment, because the registry's gates run in exactly that direction
 *      (a 'high' income needs a senior title; owned housing needs age + income).
 *   3. THE REGISTRY IS THE ONLY SOURCE OF SAMPLED VALUES. Nothing here holds a
 *      list of places, jobs, incomes or households; it asks `registry.pick`.
 *      The only literals are structural: the audience→constraint mappings
 *      (a gender-mix ratio, a life-stage age window, the parent/child gap),
 *      which are relationships between contract tokens, not trait values.
 *   4. NEVER THROWS. A missing, partial or malformed audience is the normal
 *      case — most stored personas predate the field — so every input is
 *      normalised and every viewer is built inside a guard. The function
 *      always returns a usable panel.
 *
 * DECISIONING is sampled per viewer, from the registry's decisioning tables and
 * gated on that viewer's own income band and age — a panel whose five viewers
 * shared one buying style could only ever raise one objection to a draft. A leaf
 * the audience STATES still wins: that is what the customer said about their
 * audience, and a sampled value must never overrule a stated one.
 *
 * Pure and client-safe: no `$env`, no `lib/server`, no clock, no Math.random.
 */
import { inSentence } from './describe';
import { label } from './labels';
import {
	registry,
	type RegistryGateContext,
	type RegistryTable,
	type ResolvedRegistry
} from './registry';
import { rng, type Rng } from './rng';
import { CHILD_AGE_BAND_YEARS, MIN_PARENT_CHILD_GAP } from './sampler';
import type { AudienceDecisioning, PersonaAudience, ViewerSkeleton } from './schema';
import { isToken, type TokenGroup, type TokenOf } from './tokens';

/**
 * How long one viewer's objection may be.
 *
 * The producer and the consumer both need this number and they used to disagree
 * silently. FitVerdict truncates at 240 characters with an ellipsis, and its
 * comment said "The judge already caps objections" — the judge said nothing
 * about length at all. So the model wrote as much as it liked, the app paid for
 * every output token of it at 6x the input rate, and the UI threw away
 * everything past 240 characters before a person ever saw it.
 *
 * Exported from here because the prompt lives under lib/server (unimportable
 * from a component) and the renderer is client-side. One number, two importers,
 * and a test that fails if the prompt stops stating it.
 */
export const MAX_OBJECTION_CHARS = 240;

export const DEFAULT_PANEL_SIZE = 5;
export const MIN_PANEL_SIZE = 1;
export const MAX_PANEL_SIZE = 12;

/** Viewer age span when the audience says nothing. Adults only: a panel is who buys. */
const VIEWER_MIN_AGE = 18;
const VIEWER_MAX_AGE = 80;

/** Below this the viewer is at school, not in a job — the registry has no youth occupations. */
const WORKING_AGE = 18;

/**
 * Share of the panel that is female, per mix token. A ratio, not a trait value:
 * it is what the token MEANS, and it is applied as an exact quota so a five-seat
 * panel for 'female_skew' is 4/1 on every seed rather than 5/0 on an unlucky one.
 */
const FEMALE_SHARE: Record<TokenOf<'genderMix'>, number> = {
	female_skew: 0.8,
	male_skew: 0.2,
	mixed: 0.5
};

/**
 * The age window a life stage implies. A SOFT constraint: it narrows the stated
 * age range when the two overlap and yields to it when they do not, because
 * `ageRanges` is the explicit statement and the life stage is a characterisation.
 */
const LIFE_STAGE_AGES: Record<TokenOf<'lifeStage'>, readonly [number, number]> = {
	student: [18, 26],
	early_career: [22, 34],
	young_family: [26, 42],
	established_family: [35, 58],
	empty_nester: [50, 70],
	retired: [62, VIEWER_MAX_AGE]
};

/** How likely a life stage is to have children at home. */
const LIFE_STAGE_CHILDREN: Record<TokenOf<'lifeStage'>, number> = {
	student: 0.05,
	early_career: 0.12,
	young_family: 0.95,
	established_family: 0.88,
	empty_nester: 0.8,
	retired: 0.7
};

/** Life stages whose children have grown up; the band table is narrowed, never replaced. */
const GROWN_CHILD_BANDS: readonly TokenOf<'childAgeBand'>[] = ['teen', 'adult'];
const GROWN_CHILD_STAGES: readonly TokenOf<'lifeStage'>[] = ['empty_nester', 'retired'];

/**
 * Decisioning leaf → token group. A stated value is validated against the group
 * before it is kept, and a missing one is sampled from the registry table of the
 * SAME NAME — which is why this map is the whole of the panel's decisioning
 * knowledge, and not one buying style is written down here.
 */
const DECISIONING_GROUPS = {
	priceSensitivity: 'priceSensitivity',
	purchaseChannel: 'purchaseChannel',
	brandLoyalty: 'brandLoyalty',
	promoResponsiveness: 'promoResponsiveness',
	messageProcessingStyle: 'messageProcessingStyle',
	communicationPreference: 'communicationPreference',
	digitalCapability: 'digitalCapability'
} as const satisfies Record<keyof AudienceDecisioning, TokenGroup>;

export interface ViewerPanelOptions {
	/** Panel size; clamped to [MIN_PANEL_SIZE, MAX_PANEL_SIZE]. Default DEFAULT_PANEL_SIZE. */
	size?: number;
	/** Market whose registry tables supply places and jobs. Unknown markets fall back to generic. */
	market?: string;
}

// ── normalisation ──────────────────────────────────────────────────────────

/** What the audience actually constrains, once every malformed value is dropped. */
interface PanelSpec {
	ageBands: readonly (readonly [number, number])[];
	genderMix?: TokenOf<'genderMix'>;
	lifeStages: readonly TokenOf<'lifeStage'>[];
	incomeBand?: TokenOf<'incomeBand'>;
	decisioning?: AudienceDecisioning;
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

/**
 * Numeric bounds for an age-range token, PARSED rather than tabulated: the token
 * ('45_54', '55_plus') already carries its bounds, so a new bucket needs no edit
 * here. Returns null for anything that is not shaped like an age-range token.
 */
function ageBounds(token: string): readonly [number, number] | null {
	const match = /^(\d{1,3})_(\d{1,3}|plus)$/.exec(token);
	if (!match) return null;
	const lo = Number(match[1]);
	const hi = match[2] === 'plus' ? VIEWER_MAX_AGE : Number(match[2]);
	if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return null;
	return [lo, Math.min(hi, VIEWER_MAX_AGE)];
}

function normaliseAudience(audience: PersonaAudience | null | undefined): PanelSpec {
	const a: Partial<PersonaAudience> =
		audience && typeof audience === 'object' && !Array.isArray(audience) ? audience : {};

	const ageBands: (readonly [number, number])[] = [];
	for (const raw of asArray(a.ageRanges)) {
		if (!isToken('ageRange', raw)) continue;
		const bounds = ageBounds(raw);
		if (bounds) ageBands.push(bounds);
	}

	const lifeStages: TokenOf<'lifeStage'>[] = [];
	for (const raw of asArray(a.lifeStage)) {
		if (isToken('lifeStage', raw) && !lifeStages.includes(raw)) lifeStages.push(raw);
	}

	return {
		ageBands,
		genderMix: isToken('genderMix', a.genderMix) ? a.genderMix : undefined,
		lifeStages,
		incomeBand: isToken('incomeBand', a.incomeBand) ? a.incomeBand : undefined,
		decisioning: statedDecisioning(a.decisioning)
	};
}

/**
 * The decisioning leaves the audience actually STATED, keeping only real tokens.
 * These are facts about the audience, so they override the sampled value on
 * every seat; a leaf dropped here (missing or malformed) is left to the registry.
 */
function statedDecisioning(source: unknown): AudienceDecisioning | undefined {
	if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
	const from = source as Record<string, unknown>;
	const out: Record<string, string> = {};
	for (const [key, group] of Object.entries(DECISIONING_GROUPS)) {
		const value = from[key];
		if (isToken(group, value)) out[key] = value;
	}
	return Object.keys(out).length ? (out as AudienceDecisioning) : undefined;
}

function clampSize(size: number | undefined): number {
	if (typeof size !== 'number' || !Number.isFinite(size)) return DEFAULT_PANEL_SIZE;
	return Math.min(MAX_PANEL_SIZE, Math.max(MIN_PANEL_SIZE, Math.round(size)));
}

// ── small pure helpers ─────────────────────────────────────────────────────

/** A table with only the allowed tokens, or the original when that empties it (never sample from nothing). */
function restrictTable<G extends TokenGroup>(
	table: RegistryTable<G>,
	allow: (token: TokenOf<G>) => boolean
): RegistryTable<G> {
	const entries = table.entries.filter((entry) => allow(entry.token));
	return entries.length ? { group: table.group, entries } : table;
}

/**
 * One viewer's buying style: every leaf the audience states, and every other
 * leaf drawn from the registry table of the same name under this viewer's own
 * gates (income band, age, market).
 *
 * The gates are what keep the value coherent with the person wearing it — a
 * 'low' income viewer cannot draw 'price_insensitive', because the entry is
 * gated to the upper bands and every table keeps an ungated middle entry so
 * gating can never empty the pool and fall back past that gate.
 *
 * One fork per leaf, named for the field, so adding an eighth leaf later cannot
 * re-roll the seven already stored on somebody's persona.
 */
function sampleDecisioning(
	r: Rng,
	resolved: ResolvedRegistry,
	ctx: RegistryGateContext,
	stated: AudienceDecisioning | undefined
): AudienceDecisioning | undefined {
	const out: Record<string, string> = {};
	for (const [leaf, group] of Object.entries(DECISIONING_GROUPS)) {
		const said = stated?.[leaf as keyof AudienceDecisioning];
		if (said !== undefined) {
			out[leaf] = said;
			continue;
		}
		const table = resolved[group as keyof ResolvedRegistry] as RegistryTable | undefined;
		if (!table?.entries?.length) continue;
		out[leaf] = registry.pick(table, r.fork(`viewer.decisioning.${leaf}`), ctx);
	}
	return Object.keys(out).length ? (out as AudienceDecisioning) : undefined;
}

/** Overlap of two closed ranges, or null when they do not meet. */
function intersect(
	a: readonly [number, number],
	b: readonly [number, number]
): readonly [number, number] | null {
	const lo = Math.max(a[0], b[0]);
	const hi = Math.min(a[1], b[1]);
	return lo <= hi ? [lo, hi] : null;
}

/**
 * Exact gender quota for the panel, then a seeded shuffle.
 *
 * Drawing each viewer's gender independently would let a five-seat 'mixed' panel
 * come out all-female on a plausible seed — precisely the failure the mix token
 * exists to prevent. The quota makes the mix a property of the panel; the
 * shuffle keeps the ORDER varied so seat 0 is not always female.
 */
function allocateGenders(
	r: Rng,
	mix: TokenOf<'genderMix'> | undefined,
	size: number
): TokenOf<'gender'>[] {
	const females = Math.round(size * FEMALE_SHARE[mix ?? 'mixed']);
	const list: TokenOf<'gender'>[] = [];
	for (let i = 0; i < size; i++) list.push(i < females ? 'female' : 'male');
	for (let i = list.length - 1; i > 0; i--) {
		const j = r.int(0, i);
		const swap = list[i];
		list[i] = list[j];
		list[j] = swap;
	}
	return list;
}

/**
 * Which stated age band this seat draws from.
 *
 * Cycling the seats through the bands (from a seeded offset) rather than drawing
 * a band per viewer is what makes "25–34 and 55+" produce both, instead of five
 * viewers from whichever band won the coin toss.
 */
function bandForSeat(
	bands: readonly (readonly [number, number])[],
	index: number,
	offset: number
): readonly [number, number] {
	if (!bands.length) return [VIEWER_MIN_AGE, VIEWER_MAX_AGE];
	return bands[(index + offset) % bands.length];
}

// ── the panel ──────────────────────────────────────────────────────────────

/**
 * A small panel of concrete viewers implied by an audience.
 *
 * @param seed     Canonical seed (in practice `meta.seed`). The same seed and
 *                 audience always produce the identical panel, so a stored panel
 *                 is reproducible and a re-roll is an explicit act.
 * @param audience The audience bracket. Missing or partial is normal.
 * @param options  Panel size and the market whose registry supplies places/jobs.
 */
export function sampleViewerPanel(
	seed: string,
	audience: PersonaAudience | null | undefined,
	options: ViewerPanelOptions = {}
): ViewerSkeleton[] {
	const opts = options && typeof options === 'object' ? options : {};
	const baseSeed = typeof seed === 'string' && seed.trim() ? seed : 'panel';
	const size = clampSize(opts.size);
	const spec = normaliseAudience(audience);
	const resolved = registry.for(typeof opts.market === 'string' ? opts.market : undefined);

	const genders = allocateGenders(rng(`${baseSeed}:panel:mix`), spec.genderMix, size);
	const ageOffset = spec.ageBands.length
		? rng(`${baseSeed}:panel:ages`).int(0, spec.ageBands.length - 1)
		: 0;
	const stageOffset = spec.lifeStages.length
		? rng(`${baseSeed}:panel:stages`).int(0, spec.lifeStages.length - 1)
		: 0;

	const panel: ViewerSkeleton[] = [];
	for (let index = 0; index < size; index++) {
		// P3.2 pins this shape: `${meta.seed}:panel:${i}`.
		const viewerSeed = `${baseSeed}:panel:${index}`;
		try {
			panel.push(
				sampleViewer(viewerSeed, spec, resolved, genders[index], index, ageOffset, stageOffset)
			);
		} catch {
			// A registry that cannot be sampled must still yield a seat: a short
			// panel would silently change the fit judge's arithmetic.
			panel.push({ seed: viewerSeed, gender: genders[index] });
		}
	}
	return panel;
}

function sampleViewer(
	viewerSeed: string,
	spec: PanelSpec,
	resolved: ResolvedRegistry,
	gender: TokenOf<'gender'>,
	index: number,
	ageOffset: number,
	stageOffset: number
): ViewerSkeleton {
	const r = rng(viewerSeed);
	const market = resolved.market;

	// ── age ──────────────────────────────────────────────────────────────────
	// The stated range is the hard constraint; the life stage narrows it only
	// where the two agree, so "45–54, retired" stays 45–54 rather than becoming 62+.
	const lifeStage = spec.lifeStages.length
		? spec.lifeStages[(index + stageOffset) % spec.lifeStages.length]
		: undefined;
	const stated = bandForSeat(spec.ageBands, index, ageOffset);
	const narrowed = lifeStage ? intersect(stated, LIFE_STAGE_AGES[lifeStage]) : null;
	const band = narrowed ?? stated;
	const age = r.fork('viewer.age').int(band[0], band[1]);

	// ── location ─────────────────────────────────────────────────────────────
	// Region then a city inside it, so timezone and urban/rural character travel
	// with the city and cannot contradict the region.
	const regions = resolved.regions ?? [];
	const region = regions.length
		? r.fork('viewer.location.region').weighted(regions, (candidate) => candidate.weight)
		: undefined;
	const cities = region?.cities ?? [];
	const city = cities.length
		? r.fork('viewer.location.city').weighted(cities, (candidate) => candidate.weight)
		: undefined;

	// ── seniority → income → price lens ──────────────────────────────────────
	const seniority =
		age >= WORKING_AGE
			? registry.pick(resolved.seniority, r.fork('viewer.work.seniority'), { age, market })
			: undefined;
	const incomeBand =
		spec.incomeBand ??
		registry.pick(resolved.incomeBand, r.fork('viewer.economic.incomeBand'), {
			age,
			seniority,
			market
		});
	const priceFrame = registry.pick(resolved.priceFrame, r.fork('viewer.economic.priceFrame'), {
		age,
		incomeBand,
		market
	});

	// ── work ─────────────────────────────────────────────────────────────────
	const workCtx: RegistryGateContext = { age, gender, incomeBand, seniority, market };
	const occupation =
		age >= WORKING_AGE
			? registry.occupations(resolved, r.fork('viewer.work.occupation'), workCtx)
			: undefined;

	// ── household ────────────────────────────────────────────────────────────
	const relationshipStatus = registry.pick(
		resolved.relationshipStatus,
		r.fork('viewer.household.relationshipStatus'),
		{ age, gender, market }
	);

	// A child band may only sit MIN_PARENT_CHILD_GAP years or more below the
	// viewer — the same rule the creator sampler uses, which is what keeps the
	// 30-year-old with a teenager impossible rather than merely unlikely.
	const childRng = r.fork('viewer.household.children');
	let allowedBands = (Object.keys(CHILD_AGE_BAND_YEARS) as TokenOf<'childAgeBand'>[]).filter(
		(band) => age - CHILD_AGE_BAND_YEARS[band][1] >= MIN_PARENT_CHILD_GAP
	);
	if (lifeStage && GROWN_CHILD_STAGES.includes(lifeStage)) {
		const grown = allowedBands.filter((band) => GROWN_CHILD_BANDS.includes(band));
		if (grown.length) allowedBands = grown;
	}
	// The gap rule alone would let a 17-year-old have a newborn (17 − 1 ≥ 16), so
	// a below-working-age viewer is childless outright: they are the teenager in
	// the audience, not somebody's parent.
	const childChance = lifeStage ? LIFE_STAGE_CHILDREN[lifeStage] : age >= 34 ? 0.55 : 0.35;
	let children: { count: number; ageBands: TokenOf<'childAgeBand'>[] } | undefined;
	if (age >= WORKING_AGE && allowedBands.length && childRng.chance(childChance)) {
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
		for (let i = 0; i < count; i++)
			ageBands.push(registry.pick(bandTable, childRng, { age, market }));
		children = { count, ageBands };
	}

	const housingType = registry.pick(resolved.housingType, r.fork('viewer.household.housingType'), {
		age,
		incomeBand,
		market
	});

	// ── employment ───────────────────────────────────────────────────────────
	// Drawn last, because 'homemaker' is gated on having children and a viewer
	// below working age is at school. Both are RESTRICTIONS on the registry
	// table, never a value invented here.
	const employmentTable =
		age >= WORKING_AGE
			? resolved.employmentStatus
			: restrictTable(resolved.employmentStatus, (token) => token === 'student');
	const employmentStatus = registry.pick(employmentTable, r.fork('viewer.work.employmentStatus'), {
		age,
		gender,
		seniority,
		market,
		hasChildren: !!children
	});
	const workLocationMode =
		age >= WORKING_AGE
			? registry.pick(resolved.workLocationMode, r.fork('viewer.work.workLocationMode'), {
					age,
					seniority,
					market
				})
			: undefined;

	// ── decisioning ──────────────────────────────────────────────────────────
	// Last, because it is gated on the income band and age drawn above.
	const decisioning = sampleDecisioning(r, resolved, { age, incomeBand, market }, spec.decisioning);

	const viewer: ViewerSkeleton = {
		seed: viewerSeed,
		gender,
		age,
		location: {
			...(region ? { region: region.name } : {}),
			...(city
				? { city: city.name, geographicContext: city.geographicContext, timezone: city.timezone }
				: {})
		},
		work: {
			...(occupation ? { domain: occupation.domain, title: occupation.title } : {}),
			employmentStatus,
			...(workLocationMode ? { workLocationMode } : {}),
			...(seniority ? { seniority } : {})
		},
		household: {
			relationshipStatus,
			...(children ? { children } : {}),
			housingType
		},
		economic: { incomeBand, priceFrame },
		...(decisioning ? { decisioning } : {})
	};
	viewer.summary = summarise(viewer);
	return viewer;
}

/**
 * One line a human can hold in their head while reading a draft. Derived from
 * the sampled tokens through `labels.ts` — regenerable, never a stored fact.
 */
function summarise(viewer: ViewerSkeleton): string {
	const parts: string[] = [];
	const who = [
		label('gender', viewer.gender),
		viewer.age !== undefined ? String(viewer.age) : ''
	].filter(Boolean);
	if (who.length) parts.push(who.join(', '));
	const place = viewer.location?.city ?? viewer.location?.region;
	if (place) parts.push(place);
	if (viewer.work?.title) parts.push(inSentence(viewer.work.title));
	else if (viewer.work?.employmentStatus)
		parts.push(label('employmentStatus', viewer.work.employmentStatus));
	if (viewer.economic?.incomeBand) parts.push(label('incomeBand', viewer.economic.incomeBand));
	const kids = viewer.household?.children?.count;
	if (kids) parts.push(kids === 1 ? '1 child at home' : `${kids} children at home`);
	return parts.join(' · ');
}
