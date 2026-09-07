/**
 * Audience age buckets — the numeric bounds behind the en-dashed chip keys.
 *
 * A leaf module (imports only persona-profile) so that BOTH the v1 store and
 * the v2 contract's upgrade/downgrade can use it without an import cycle. The
 * store re-exports these names, so no existing caller changes.
 *
 * `ageMin`/`ageMax` are DERIVED from the selected buckets — older generation
 * prompts read the numbers, the UI edits the buckets, and keeping the two in
 * sync here means a bucket edit can never leave stale numbers behind.
 */
import { AGE_RANGE_KEYS, coerceAgeRanges } from './persona-profile';

/** Numeric bounds for each audience bucket, keyed in `AGE_RANGE_KEYS` order. */
export const AGE_RANGE_BOUNDS: Record<string, { lo: number; hi: number }> = {
	'13–17': { lo: 13, hi: 17 },
	'18–24': { lo: 18, hi: 24 },
	'25–34': { lo: 25, hi: 34 },
	'35–44': { lo: 35, hi: 44 },
	'45–54': { lo: 45, hi: 54 },
	'55+': { lo: 55, hi: 99 }
};

/** Derives {ageMin, ageMax} from selected buckets; both null when none selected. */
export function ageBoundsFromRanges(ranges: readonly string[] | null | undefined): {
	ageMin: number | null;
	ageMax: number | null;
} {
	const bounds = (ranges ?? [])
		.map((k) => AGE_RANGE_BOUNDS[k])
		.filter((b): b is { lo: number; hi: number } => !!b);
	if (!bounds.length) return { ageMin: null, ageMax: null };
	return {
		ageMin: Math.min(...bounds.map((b) => b.lo)),
		ageMax: Math.max(...bounds.map((b) => b.hi))
	};
}

/**
 * Legacy shape support: profiles written before the bucket picker stored only
 * `ageMin`/`ageMax`. Recovers the buckets those numbers overlap so an old
 * persona shows its audience instead of a blank chip row.
 */
export function deriveAgeRanges(
	profile: { ageRanges?: unknown; ageMin?: number | null; ageMax?: number | null } | null | undefined
): string[] {
	const ranges = coerceAgeRanges(profile?.ageRanges);
	if (ranges.length) return ranges;
	const { ageMin, ageMax } = profile ?? {};
	if (typeof ageMin === 'number' && typeof ageMax === 'number') {
		return AGE_RANGE_KEYS.filter((k) => {
			const b = AGE_RANGE_BOUNDS[k];
			return b && b.hi >= ageMin && b.lo <= ageMax;
		});
	}
	return [];
}
