/**
 * Allowed Persona Profile option sets — mirrored in the persona page's <select>
 * dropdowns (src/routes/(portal)/personas/[agentId]/+page.svelte). The persona-
 * profile generator emits and validates against these so an LLM value always maps
 * back onto a selectable option. Keep the two in sync.
 *
 * Client-safe (no server imports) so both the generator endpoint and the UI can
 * read the same source of truth.
 */

export const PERSONA_ARCHETYPES = [
	'The Creator',
	'The Expert / Authority',
	'The Relatable Friend',
	'The Aspirational',
	'The Storyteller',
	'The Activist / Advocate',
	'The Entertainer',
	'The Educator',
	'The Disruptor',
	'The Community Builder'
] as const;

export const CONTENT_FOCUS_OPTIONS = [
	'Education & How-Tos',
	'Entertainment & Humor',
	'Lifestyle & Aesthetic',
	'Product Reviews & UGC',
	'Inspiration & Motivation',
	'Behind-the-Scenes',
	'News & Commentary',
	'Tutorials & Demos',
	'Personal Journey'
] as const;

/** Age brackets — NOTE the en-dash (U+2013), matching the page's chip keys exactly. */
export const AGE_RANGE_KEYS = ['13–17', '18–24', '25–34', '35–44', '45–54', '55+'] as const;

/** Persona niche options — mirrored in the Identity/Profile niche <select>. */
export const NICHE_OPTIONS = [
	'Beauty & Wellness',
	'Fitness & Health',
	'Tech & AI',
	'Food & Cooking',
	'Fashion & Style',
	'Travel & Adventure',
	'Finance & Business',
	'Gaming & Esports',
	'Education & Learning',
	'Lifestyle',
	'Parenting & Family',
	'Home & DIY',
	'Pets & Animals',
	'Entertainment & Pop Culture',
	'Sustainability & Eco',
	'Arts & Creativity',
	'Sports',
	'Automotive'
] as const;

/**
 * ── Appearance traits ────────────────────────────────────────────────────────
 *
 * The "dynamic variables" that define the influencer's look. These feed the
 * profile-picture / reference-kit / post-image prompts so the generated face and
 * outfit reflect them, and are filled by "Generate for brand".
 *
 * STORAGE CONTRACT (do not break): every appearance value is a PLAIN STRING, the
 * same kind free text has always produced (`hairColor: 'Light Brown'`). The curated
 * option sets below are a UI affordance only — they are NOT enums, ids, or objects.
 * That is what makes chips safe: nothing downstream (portrait builder, reference
 * kit, image prompts) has to change, and a persona created before chips existed
 * (`hairColor: 'honey blonde'`) keeps working and is preserved VERBATIM by
 * `coerceAppearance()`. Never snap a stored value onto the nearest option — that
 * would silently change existing personas' faces on the next generation.
 *
 * Two kinds of field:
 *  • curated (`options.length > 0`) — chip picker, "+N more" behind the first few.
 *  • free-form (`options.length === 0`, `group: 'advanced'`) — plain text input,
 *    grouped under a collapsed "Advanced" section.
 */

/**
 * The universal, always-selectable "unset" option. Selecting it means *the model /
 * profile generator decides*, so a user can reach a preview with ZERO required
 * decisions. It is a UI-level sentinel: it is stored as an empty string (or the key
 * omitted entirely) and `coerceAppearance()` drops it, so it never reaches a prompt.
 * A field whose stored value is '' or missing renders as `BEST_FIT` selected.
 */
export const BEST_FIT = 'Best Fit';

/** Heritage. Fed into the SUBJECT of the portrait, not the trailing clause. */
export const ETHNICITY_OPTIONS = [
	'Mixed',
	'Hispanic',
	'White',
	'South Asian',
	'Black / African',
	'East Asian',
	'Southeast Asian',
	'Middle Eastern',
	'Native American',
	'Pacific Islander',
	'Caribbean',
	'Central Asian'
] as const;

/**
 * The PERSONA's own apparent age. NOTE: this is NOT `ageRanges` / `AGE_RANGE_KEYS`,
 * which is the AUDIENCE's age bracket consumed by the strategy prompt. Different
 * concept, different key, never aliased. Uses the same en-dash (U+2013) convention.
 */
export const PERSONA_AGE_OPTIONS = ['18–24', '25–29', '30–35', '36–44', '45–54', '55–64', '65+'] as const;

export const SKIN_TONE_OPTIONS = [
	'Fair/Light',
	'Medium',
	'Dark',
	'Porcelain',
	'Olive',
	'Tan',
	'Bronze',
	'Deep'
] as const;

export const EYE_COLOR_OPTIONS = ['Brown', 'Blue', 'Green', 'Hazel', 'Amber', 'Gray', 'Dark Brown'] as const;

export const BODY_TYPE_OPTIONS = [
	'Athletic',
	'Slim',
	'Curvy',
	'Average',
	'Muscular',
	'Petite',
	'Plus-Size',
	'Tall & Lean'
] as const;

export const HAIR_LENGTH_OPTIONS = [
	'Long',
	'Medium',
	'Short',
	'Shoulder-Length',
	'Chin-Length',
	'Pixie',
	'Waist-Length'
] as const;

/** Style only — length lives in `hairLength` and composes with this. */
export const HAIRSTYLE_OPTIONS = [
	'Curly',
	'Wavy',
	'Straight',
	'Coily',
	'Braided',
	'Sleek Bun',
	'Ponytail',
	'Afro',
	'Locs',
	'Bald / Shaved'
] as const;

export const HAIR_COLOR_OPTIONS = [
	'Light Brown',
	'Dark Brown',
	'Blonde',
	'Black',
	'Auburn',
	'Red',
	'Platinum Blonde',
	'Silver / Gray'
] as const;

/**
 * Field metadata the UI renders from. Every entry has `options` (empty array =
 * free-text field) so consumers never have to test for its presence, and `group`
 * ('core' = shown up front, 'advanced' = free-form, collapsed).
 *
 * `placeholder` keeps its `e.g. ` prefix: the persona generator strips it and feeds
 * the remainder to the LLM as the key's hint (see routes/api/engine/+server.ts).
 */
export const APPEARANCE_FIELDS = [
	// Ethnicity leads: it's the strongest identity + uniqueness signal and the fix for
	// "the face doesn't match the persona's heritage". Inferred from the name at profile
	// time (Jenny Tran → Vietnamese), editable, and fed into the SUBJECT of the portrait.
	{
		key: 'ethnicity',
		label: 'Ethnicity / heritage',
		placeholder: 'e.g. Vietnamese, Nigerian, Brazilian, Korean-American',
		group: 'core',
		options: ETHNICITY_OPTIONS
	},
	{
		key: 'personaAge',
		label: 'Age',
		placeholder: 'e.g. 25–29 (the creator’s own apparent age, not the audience’s)',
		group: 'core',
		options: PERSONA_AGE_OPTIONS
	},
	{
		key: 'skinTone',
		label: 'Skin tone',
		placeholder: 'e.g. Medium, Olive, Deep',
		group: 'core',
		options: SKIN_TONE_OPTIONS
	},
	{
		key: 'bodyType',
		label: 'Body type',
		placeholder: 'e.g. Athletic, Slim, Curvy',
		group: 'core',
		options: BODY_TYPE_OPTIONS
	},
	{
		key: 'hairLength',
		label: 'Hair length',
		placeholder: 'e.g. Long, Shoulder-Length, Short',
		group: 'core',
		options: HAIR_LENGTH_OPTIONS
	},
	{
		key: 'hairstyle',
		label: 'Hairstyle',
		placeholder: 'e.g. Wavy, Curly, Sleek Bun (style only — length is its own field)',
		group: 'core',
		options: HAIRSTYLE_OPTIONS
	},
	{
		key: 'hairColor',
		label: 'Hair color',
		placeholder: 'e.g. Light Brown, Blonde, Black',
		group: 'core',
		options: HAIR_COLOR_OPTIONS
	},
	{
		key: 'eyeColor',
		label: 'Eye color',
		placeholder: 'e.g. Brown, Blue, Hazel',
		group: 'core',
		options: EYE_COLOR_OPTIONS
	},
	// ── Advanced / free-form: too open-ended to enumerate, kept as text. ──
	{
		key: 'wardrobe',
		label: 'Wardrobe / outfit',
		placeholder: 'e.g. cream linen sets, minimal gold jewelry',
		group: 'advanced',
		options: []
	},
	{
		key: 'outfitColors',
		label: 'Outfit colors',
		placeholder: 'e.g. earth tones — cream, tan, olive',
		group: 'advanced',
		options: []
	},
	{
		key: 'headwear',
		label: 'Headwear',
		placeholder: 'e.g. none / silk turban / headscarf',
		group: 'advanced',
		options: []
	},
	// Distinctive features keep two same-ethnicity personas from converging on one face.
	{
		key: 'distinctiveFeatures',
		label: 'Distinctive features',
		placeholder: 'e.g. freckles, dimples, sharp jawline, warm smile',
		group: 'advanced',
		options: []
	},
	{
		key: 'styling',
		label: 'Styling / season / era',
		placeholder: 'e.g. summer 2025, breezy minimalism',
		group: 'advanced',
		options: []
	}
] as const satisfies readonly {
	key: string;
	label: string;
	placeholder: string;
	group: 'core' | 'advanced';
	options: readonly string[];
}[];

export type AppearanceKey = (typeof APPEARANCE_FIELDS)[number]['key'];
export type AppearanceFieldGroup = (typeof APPEARANCE_FIELDS)[number]['group'];

/** Chip-backed traits, in display order. */
export const CURATED_APPEARANCE_FIELDS = APPEARANCE_FIELDS.filter((f) => f.options.length > 0);
/** Free-text traits — the collapsed "Advanced" group. */
export const ADVANCED_APPEARANCE_FIELDS = APPEARANCE_FIELDS.filter((f) => f.options.length === 0);

/** key → curated options. Missing/empty means the field is free text. */
export const APPEARANCE_TRAIT_OPTIONS: Readonly<Record<string, readonly string[]>> =
	Object.fromEntries(APPEARANCE_FIELDS.map((f) => [f.key, f.options]));

/**
 * Curated options for a trait; empty array for free-text (or unknown) fields.
 *
 * `Object.hasOwn` rather than a plain lookup: the record is built with
 * `Object.fromEntries`, so it inherits Object.prototype and a bare lookup would
 * return the `Object` constructor for `traitOptionsFor('constructor')` — which
 * then reads as a curated trait because functions have a `.length`.
 */
export function traitOptionsFor(key: string): readonly string[] {
	return Object.hasOwn(APPEARANCE_TRAIT_OPTIONS, key) ? APPEARANCE_TRAIT_OPTIONS[key] : [];
}

/** True when the trait is chip-backed (has a curated option set). */
export function isCuratedTrait(key: string): boolean {
	return traitOptionsFor(key).length > 0;
}

/**
 * Keeps only the known appearance keys, trimmed strings — safe to store/render.
 *
 * Values are preserved VERBATIM: an off-list legacy value ('honey blonde') is kept
 * exactly as stored and is never snapped to a curated option. The only value that is
 * dropped is the `BEST_FIT` sentinel, which means "unset / let the model decide".
 */
export function coerceAppearance(value: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (value && typeof value === 'object') {
		const source = value as Record<string, unknown>;
		for (const f of APPEARANCE_FIELDS) {
			const v = source[f.key];
			if (typeof v !== 'string') continue;
			const t = v.trim();
			if (!t || t.toLowerCase() === BEST_FIT.toLowerCase()) continue;
			out[f.key] = t;
		}
	}
	return out;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Composes hair length with hairstyle instead of replacing it. Personas created
 * before `hairLength` existed store a COMBINED value in `hairstyle` ('long loose
 * waves'), so emitting the length again would read "long long loose waves" — if the
 * hairstyle already contains the length word, the length is dropped.
 */
function hairDescriptor(a: Record<string, string>): string {
	const style = a.hairstyle ?? '';
	const length = a.hairLength ?? '';
	const lengthIsRedundant =
		!!length && !!style && new RegExp(`\\b${escapeRegExp(length)}\\b`, 'i').test(style);
	return [a.hairColor, lengthIsRedundant ? '' : length, style].filter(Boolean).join(' ');
}

/**
 * Turns an appearance config into a single natural-language clause appended to the
 * image prompt, so the generated portrait reflects the wardrobe/hair/eyes/etc.
 * Empty when nothing is set (the model then chooses freely).
 */
export function appearanceToPromptClause(appearance: Record<string, string> | null | undefined): string {
	const a = coerceAppearance(appearance);
	const parts: string[] = [];
	// NOTE: ethnicity is deliberately NOT emitted here — the portrait builders put it
	// in the SUBJECT of the prompt (stronger than a trailing clause), so keeping it out
	// avoids diluting or duplicating it.
	// Age/skin/build lead: they describe the subject before the styling details do.
	if (a.personaAge) parts.push(`${a.personaAge} years old`);
	if (a.skinTone) parts.push(`${a.skinTone} skin tone`);
	if (a.bodyType) parts.push(`${a.bodyType} build`);
	const hair = hairDescriptor(a);
	if (hair) parts.push(`${hair} hair`);
	if (a.eyeColor) parts.push(`${a.eyeColor} eyes`);
	if (a.distinctiveFeatures) parts.push(a.distinctiveFeatures);
	if (a.headwear && !/^(none|no|n\/a)$/i.test(a.headwear)) parts.push(`wearing a ${a.headwear}`);
	if (a.wardrobe) parts.push(`dressed in ${a.wardrobe}`);
	if (a.outfitColors) parts.push(`outfit in ${a.outfitColors}`);
	if (a.styling) parts.push(`${a.styling} styling`);
	return parts.length ? ` Appearance: ${parts.join(', ')}.` : '';
}

/**
 * Strips a leading fictional proper name from a target-avatar sentence — a cleanup
 * for personas generated before the "name the audience" prompt bug was fixed, so
 * existing profiles read clean without regenerating. Applied wherever the avatar is
 * USED (content generation) and SHOWN (profile field), and it self-persists on the
 * next save.
 *
 * Deliberately conservative: it fires ONLY on the exact bug signature — 1–3
 * Title-Case tokens, a comma, then an article ("a"/"an"/"the") or an age. So real
 * descriptions ("A 36-year-old mom who…", "Health-conscious parents who…") are left
 * untouched because they don't have a "Name, a/the/<age>…" prefix.
 */
export function stripLeadingAvatarName(value: string | null | undefined): string {
	const t = (value ?? '').trim();
	if (!t) return '';
	const m = t.match(
		/^[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*){0,2},\s+((?:an?|the)\s+.+|\d{1,2}[-\s]?year.+)$/s
	);
	if (!m) return t;
	const rest = m[1].trim();
	return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/**
 * Coerces an arbitrary LLM value onto the allowed set: exact (case-insensitive)
 * match first, then a loose contains-match, else '' — so an off-list value never
 * silently fails to select in the UI's <select> binding.
 */
export function coerceToOption(value: unknown, options: readonly string[]): string {
	if (typeof value !== 'string') return '';
	const v = value.trim().toLowerCase();
	if (!v) return '';
	const exact = options.find((o) => o.toLowerCase() === v);
	if (exact) return exact;
	const partial = options.find(
		(o) => o.toLowerCase().includes(v) || v.includes(o.toLowerCase())
	);
	return partial ?? '';
}

/** Keeps only valid age-bracket keys the UI can select. */
export function coerceAgeRanges(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => (AGE_RANGE_KEYS as readonly string[]).includes(v));
}
