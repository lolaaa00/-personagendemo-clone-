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
 * Appearance / wardrobe configuration — the "dynamic variables" that define the
 * influencer's look. Free text so anything can be typed (a turban, blue eyes, a
 * specific season/era). These feed the profile-picture prompt so the generated
 * face/outfit reflect them, and are filled by "Generate for brand".
 */
export const APPEARANCE_FIELDS = [
	// Ethnicity leads: it's the strongest identity + uniqueness signal and the fix for
	// "the face doesn't match the persona's heritage". Inferred from the name at profile
	// time (Jenny Tran → Vietnamese), editable, and fed into the SUBJECT of the portrait.
	{ key: 'ethnicity', label: 'Ethnicity / heritage', placeholder: 'e.g. Vietnamese, Nigerian, Brazilian, Korean-American' },
	{ key: 'wardrobe', label: 'Wardrobe / outfit', placeholder: 'e.g. cream linen sets, minimal gold jewelry' },
	{ key: 'outfitColors', label: 'Outfit colors', placeholder: 'e.g. earth tones — cream, tan, olive' },
	{ key: 'hairstyle', label: 'Hairstyle', placeholder: 'e.g. long loose waves / sleek bun / bald' },
	{ key: 'hairColor', label: 'Hair color', placeholder: 'e.g. honey blonde' },
	{ key: 'eyeColor', label: 'Eye color', placeholder: 'e.g. warm brown' },
	{ key: 'headwear', label: 'Headwear', placeholder: 'e.g. none / silk turban / headscarf' },
	// Distinctive features keep two same-ethnicity personas from converging on one face.
	{ key: 'distinctiveFeatures', label: 'Distinctive features', placeholder: 'e.g. freckles, dimples, sharp jawline, warm smile' },
	{ key: 'styling', label: 'Styling / season / era', placeholder: 'e.g. summer 2025, breezy minimalism' }
] as const;

export type AppearanceKey = (typeof APPEARANCE_FIELDS)[number]['key'];

/** Keeps only the known appearance keys, trimmed strings — safe to store/render. */
export function coerceAppearance(value: any): Record<string, string> {
	const out: Record<string, string> = {};
	if (value && typeof value === 'object') {
		for (const f of APPEARANCE_FIELDS) {
			const v = value[f.key];
			if (typeof v === 'string' && v.trim()) out[f.key] = v.trim();
		}
	}
	return out;
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
	if (a.hairstyle || a.hairColor)
		parts.push(`${[a.hairColor, a.hairstyle].filter(Boolean).join(' ')} hair`);
	if (a.eyeColor) parts.push(`${a.eyeColor} eyes`);
	if (a.distinctiveFeatures) parts.push(a.distinctiveFeatures);
	if (a.headwear && !/^(none|no|n\/a)$/i.test(a.headwear)) parts.push(`wearing a ${a.headwear}`);
	if (a.wardrobe) parts.push(`dressed in ${a.wardrobe}`);
	if (a.outfitColors) parts.push(`outfit in ${a.outfitColors}`);
	if (a.styling) parts.push(`${a.styling} styling`);
	return parts.length ? ` Appearance: ${parts.join(', ')}.` : '';
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
