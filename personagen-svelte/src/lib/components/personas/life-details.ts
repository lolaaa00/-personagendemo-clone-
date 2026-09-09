/**
 * "Life details" — the read-only view model behind LifeDetails.svelte.
 *
 * Persona Model v2 gives a creator a life: where they live, what they do, who
 * they live with, how they lean. None of it is asked for — the sampler fills it
 * — so the UI's whole job is to SHOW what happens to be there and to be
 * completely silent about what is not.
 *
 * Three rules make that safe, and they are the reason this is a pure module
 * with its own spec rather than markup logic inside a component:
 *
 *   1. ONLY SET LEAVES. A leaf that is absent, blank, an empty array or a
 *      non-finite number produces no row. A group with no rows produces no
 *      group. A profile with no groups produces an empty array, and the page
 *      renders nothing at all — no header, no empty card. A v1 persona that has
 *      never been through the sampler therefore sees the page exactly as it did
 *      before this section existed.
 *
 *   2. DETERMINISTIC ORDER. Groups are life → work → place → household →
 *      personality, and rows within a group are written out one by one. Nothing
 *      here iterates object keys, so no persona can surprise the layout and no
 *      two personas order the same facts differently.
 *
 *   3. LABELS, NEVER TOKENS. Every token-valued leaf goes through `label()`.
 *      `apartment_rented` is a storage detail; "Rented apartment" is the
 *      product. Free-text leaves (job title, city, timezone) pass through
 *      trimmed.
 *
 * DELIBERATELY OMITTED, and why: `creator.gender`, `creator.heritage` and a
 * bucket-derived `creator.age` are all already editable on this page (Persona
 * Profile → Gender; Character & Visuals → Ethnicity / Persona Age). Repeating
 * them here would be one truth with two affordances. The bucket age is
 * additionally a midpoint the v1 → v2 upgrade invented from a range — printing
 * "Age 32" for a persona whose user only ever said "30–35" states a fact nobody
 * entered. So an age shows only when it is exact.
 *
 * Pure, client-safe, and it never throws: malformed input describes nothing,
 * which is a correct answer rather than a failure.
 */
import { label } from '$lib/persona-contract';
import type { FieldSource, PersonaProfileV2 } from '$lib/persona-contract';

export type LifeDetailValue =
	| { kind: 'text'; text: string }
	| { kind: 'chips'; chips: string[] }
	| { kind: 'meter'; text: string; percent: number };

export interface LifeDetailRow {
	/** Stable within a group; used as the keyed-each key. */
	key: string;
	label: string;
	value: LifeDetailValue;
	/** True when every stored provenance for this row is 'sampled' or 'derived'. */
	auto: boolean;
}

export interface LifeDetailGroup {
	key: string;
	title: string;
	rows: LifeDetailRow[];
}

/** What a caller can hand us: a v2 profile, a raw blob, or nothing at all. */
export type LifeDetailsInput = PersonaProfileV2 | Record<string, unknown> | null | undefined;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

const str = (v: unknown): string | undefined =>
	typeof v === 'string' && v.trim() ? v.trim() : undefined;

const num = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const strings = (v: unknown): string[] =>
	Array.isArray(v)
		? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim())
		: [];

const sub = (parent: Obj | undefined, key: string): Obj | undefined => {
	const value = parent?.[key];
	return isObj(value) ? value : undefined;
};

/** Provenance values that mean "the system put this here, you didn't". */
const AUTO_SOURCES: ReadonlySet<string> = new Set<FieldSource>(['sampled', 'derived']);

/**
 * A row is marked `auto` only when at least one contributing leaf carries a
 * provenance AND none of them is 'user' or 'extracted'. Unknown provenance —
 * the normal case for an upgraded v1 blob — marks nothing, so the marker can
 * never land on a value the user typed.
 */
function autoFlag(sources: Record<string, string> | undefined, paths: readonly string[]): boolean {
	if (!sources) return false;
	let seen = false;
	for (const path of paths) {
		const source = sources[path];
		if (source === undefined) continue;
		if (!AUTO_SOURCES.has(source)) return false;
		seen = true;
	}
	return seen;
}

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/** 'MM-DD' to '14 March'. Anything else is undefined — never a raw '03-14'. */
export function formatBirthday(value: unknown): string | undefined {
	const raw = str(value);
	if (!raw || !/^\d{2}-\d{2}$/.test(raw)) return undefined;
	const month = Number(raw.slice(0, 2));
	const day = Number(raw.slice(3, 5));
	if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
	return `${day} ${MONTHS[month - 1]}`;
}

/** 'Brisbane, Queensland' — or whichever half exists. */
function placePhrase(location: Obj | undefined): string | undefined {
	const city = str(location?.city);
	const region = str(location?.region);
	if (city && region) return `${city}, ${region}`;
	return city ?? region;
}

/** '2 children (Toddler, Primary school)' / '1 child' / 'None'. */
function childrenPhrase(children: Obj | undefined): string | undefined {
	if (!children) return undefined;
	const count = num(children.count);
	if (count === undefined || count < 0) return undefined;
	if (count === 0) return 'None';
	const bands = strings(children.ageBands).map((band) => label('childAgeBand', band));
	const head = `${count} ${count === 1 ? 'child' : 'children'}`;
	return bands.length ? `${head} (${bands.join(', ')})` : head;
}

/** Big Five leaves in canonical O-C-E-A-N order. Never Object.keys(). */
const BIG_FIVE_ORDER = [
	'openness',
	'conscientiousness',
	'extraversion',
	'agreeableness',
	'neuroticism'
] as const;

/** A tiny builder so each group reads as a list of facts rather than a list of ifs. */
class GroupBuilder {
	readonly rows: LifeDetailRow[] = [];
	private readonly sources: Record<string, string> | undefined;

	constructor(sources: Record<string, string> | undefined) {
		this.sources = sources;
	}

	text(key: string, labelText: string, value: string | undefined, ...paths: string[]): void {
		if (!value) return;
		this.rows.push({
			key,
			label: labelText,
			value: { kind: 'text', text: value },
			auto: autoFlag(this.sources, paths)
		});
	}

	/** A token leaf, rendered through the label registry; skipped when unset. */
	token(
		key: string,
		labelText: string,
		group: Parameters<typeof label>[0],
		token: unknown,
		path: string
	): void {
		const raw = str(token);
		if (!raw) return;
		this.text(key, labelText, label(group, raw) || raw, path);
	}

	chips(key: string, labelText: string, chips: string[], ...paths: string[]): void {
		if (!chips.length) return;
		this.rows.push({
			key,
			label: labelText,
			value: { kind: 'chips', chips },
			auto: autoFlag(this.sources, paths)
		});
	}

	meter(key: string, labelText: string, value: number, path: string): void {
		const percent = Math.max(0, Math.min(100, Math.round(value)));
		this.rows.push({
			key,
			label: labelText,
			value: { kind: 'meter', text: `${percent}`, percent },
			auto: autoFlag(this.sources, [path])
		});
	}
}

/**
 * The whole section, as data. `[]` means "render nothing" — the caller must not
 * draw a header for an empty result.
 */
export function buildLifeDetails(profile: LifeDetailsInput | unknown): LifeDetailGroup[] {
	const root = isObj(profile) ? profile : undefined;
	const creator = sub(root, 'creator');
	if (!creator) return [];

	const sources = sub(sub(root, 'meta'), 'fieldSources') as Record<string, string> | undefined;

	const location = sub(creator, 'location');
	const work = sub(creator, 'work');
	const household = sub(creator, 'household');
	const lifestyle = sub(creator, 'lifestyle');
	const economic = sub(creator, 'economic');
	const bigFive = sub(creator, 'bigFive');

	const groups: LifeDetailGroup[] = [];
	const add = (key: string, title: string, build: (b: GroupBuilder) => void) => {
		const builder = new GroupBuilder(sources);
		build(builder);
		if (builder.rows.length) groups.push({ key, title, rows: builder.rows });
	};

	// Life
	add('life', 'Life', (b) => {
		// Exact ages only — see the module note on bucket midpoints.
		const age = num(creator.age);
		if (age !== undefined && creator.ageSource !== 'bucket') {
			b.text('age', 'Age', `${Math.round(age)}`, 'creator.age');
		}
		b.text('birthday', 'Birthday', formatBirthday(creator.birthday), 'creator.birthday');
		b.token('education', 'Education', 'education', creator.education, 'creator.education');
		b.chips('languages', 'Languages', strings(creator.languages), 'creator.languages');
		b.token(
			'activity',
			'Activity level',
			'activityLevel',
			lifestyle?.activityLevel,
			'creator.lifestyle.activityLevel'
		);
		b.token(
			'transport',
			'Gets around by',
			'transportMode',
			lifestyle?.transportMode,
			'creator.lifestyle.transportMode'
		);
		b.token(
			'diet',
			'Diet',
			'dietaryStyle',
			lifestyle?.dietaryStyle,
			'creator.lifestyle.dietaryStyle'
		);
	});

	// Work
	add('work', 'Work', (b) => {
		b.text('title', 'Role', str(work?.title), 'creator.work.title');
		b.token('domain', 'Field', 'workDomain', work?.domain, 'creator.work.domain');
		b.token(
			'employment',
			'Employment',
			'employmentStatus',
			work?.employmentStatus,
			'creator.work.employmentStatus'
		);
		b.token('seniority', 'Seniority', 'seniority', work?.seniority, 'creator.work.seniority');
		b.token(
			'mode',
			'Works',
			'workLocationMode',
			work?.workLocationMode,
			'creator.work.workLocationMode'
		);
	});

	// Place
	add('place', 'Place', (b) => {
		b.text(
			'where',
			'Lives in',
			placePhrase(location),
			'creator.location.city',
			'creator.location.region'
		);
		b.token(
			'context',
			'Setting',
			'geographicContext',
			location?.geographicContext,
			'creator.location.geographicContext'
		);
		b.text('timezone', 'Timezone', str(location?.timezone), 'creator.location.timezone');
	});

	// Household
	add('household', 'Household', (b) => {
		b.token(
			'relationship',
			'Relationship',
			'relationshipStatus',
			household?.relationshipStatus,
			'creator.household.relationshipStatus'
		);
		b.text(
			'children',
			'Children',
			childrenPhrase(sub(household, 'children')),
			'creator.household.children.count',
			'creator.household.children.ageBands'
		);
		b.chips(
			'pets',
			'Pets',
			strings(household?.pets).map((pet) => label('pet', pet)),
			'creator.household.pets'
		);
		b.token('home', 'Home', 'housingType', household?.housingType, 'creator.household.housingType');
		b.token('income', 'Income', 'incomeBand', economic?.incomeBand, 'creator.economic.incomeBand');
		b.token('price', 'Shops', 'priceFrame', economic?.priceFrame, 'creator.economic.priceFrame');
	});

	// Personality
	add('personality', 'Personality', (b) => {
		b.chips(
			'traits',
			'Reads as',
			strings(creator.traitLabels).map((trait) => label('traitLabel', trait)),
			'creator.traitLabels'
		);
		if (bigFive) {
			for (const trait of BIG_FIVE_ORDER) {
				const value = num(bigFive[trait]);
				if (value === undefined) continue;
				b.meter(trait, label('bigFiveTrait', trait), value, `creator.bigFive.${trait}`);
			}
		}
		b.chips(
			'never',
			'Never discusses',
			strings(creator.neverDiscusses).map((topic) => label('neverDiscusses', topic)),
			'creator.neverDiscusses'
		);
	});

	return groups;
}

/** True when at least one visible row was filled in by the system. */
export function hasAutoRows(groups: readonly LifeDetailGroup[]): boolean {
	return groups.some((group) => group.rows.some((row) => row.auto));
}
