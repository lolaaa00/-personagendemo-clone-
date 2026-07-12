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
