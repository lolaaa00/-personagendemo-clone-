/**
 * Count + noun, agreeing. "1 views" shipped on the post drawer's analytics row
 * because eight call sites each hardcoded the plural; this is the one helper
 * they now share.
 */

/** The noun alone, agreeing with n. `plural(1, 'view')` → "view". */
export function plural(n: number, one: string, many: string = one + 's'): string {
	return Math.abs(Number(n)) === 1 ? one : many;
}

/**
 * Count and noun together, with the count localised.
 * `countLabel(1, 'view')` → "1 view"; `countLabel(2400, 'view')` → "2,400 views".
 */
export function countLabel(n: number, one: string, many?: string): string {
	const value = Number(n) || 0;
	return `${value.toLocaleString()} ${plural(value, one, many)}`;
}

/**
 * Compact count + noun for stat rows: 2.4K views, 1 view. Agreement is decided
 * by the REAL count, never the abbreviated one — "1.0K view" would be wrong.
 */
export function compactCountLabel(n: number, one: string, many?: string): string {
	const value = Number(n) || 0;
	const abs = Math.abs(value);
	const short =
		abs >= 1_000_000
			? (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
			: abs >= 1000
				? (value / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
				: value.toLocaleString();
	return `${short} ${plural(value, one, many)}`;
}
