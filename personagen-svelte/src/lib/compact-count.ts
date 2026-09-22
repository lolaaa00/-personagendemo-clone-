/**
 * "13.8K" → 13800. Follower counts arrive from the platform sync as display
 * text ("4,520", "13.8K", "1.2M"), and the dashboard summed them with
 *   replace(/K/, '000') then replace(/\./, '')
 * which turns "13.8K" into "13.8000" and then 138000: every account over a
 * thousand followers counted ten times (round-2 re-audit: 161.9K shown for a
 * roster that adds up to 37,690).
 */
const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

export function parseCompactCount(value: unknown): number {
	if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
	const m = String(value ?? '')
		.trim()
		.replace(/,/g, '')
		.match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/i);
	if (!m) return 0;
	const n = parseFloat(m[1]) * (m[2] ? SUFFIX[m[2].toLowerCase()] : 1);
	return Number.isFinite(n) ? Math.round(n) : 0;
}

/** 37690 → "37.7K" — the dashboard's display form. */
export function formatCompactCount(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
	if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
	return String(n);
}
