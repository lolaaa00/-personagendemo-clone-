/**
 * The persona wizard's Market choice, and what it means once a persona exists.
 *
 * A client audit (UX-008) found Market pre-set to Australia; the fix defaulted
 * it to Global — and a re-audit then found the choice reached nothing on the
 * path a new account actually takes (fill it in yourself): the create request
 * never carried it, so every persona was stored with the column default
 * ('Australia') and a hard-coded Australia/Sydney posting clock. One list, and
 * the two things a choice has to set: the market itself (plus the profile token
 * post generation reads) and the timezone the posting window runs in.
 *
 * Client-safe; no I/O.
 */
export const MARKETS = [
	'Australia',
	'United States',
	'United Kingdom',
	'Canada',
	'New Zealand',
	'Germany',
	'France',
	'Japan',
	'Global'
] as const;

export type MarketName = (typeof MARKETS)[number];

/** Anything not on the list is Global — the neutral choice, never a country. */
export function marketName(value: unknown): MarketName {
	return typeof value === 'string' && (MARKETS as readonly string[]).includes(value)
		? (value as MarketName)
		: 'Global';
}

/**
 * The profile token post generation reads (`creator.market`). The trait
 * registry has Australian, US and UK packs; every other market — Global
 * included — is `generic`, which is the truth: no country-specific pack runs.
 */
export function marketToken(market: MarketName): 'au' | 'us' | 'uk' | 'generic' {
	if (market === 'Australia') return 'au';
	if (market === 'United States') return 'us';
	if (market === 'United Kingdom') return 'uk';
	return 'generic';
}

const MARKET_TIMEZONE: Partial<Record<MarketName, string>> = {
	Australia: 'Australia/Sydney',
	'United States': 'America/New_York',
	'United Kingdom': 'Europe/London',
	Canada: 'America/Toronto',
	'New Zealand': 'Pacific/Auckland',
	Germany: 'Europe/Berlin',
	France: 'Europe/Paris',
	Japan: 'Asia/Tokyo'
};

export function isValidTimezone(tz: unknown): tz is string {
	if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/**
 * Where the persona's posting window runs: the market's own clock, or — for
 * Global — the creator's browser timezone, or UTC. Never a silent Sydney.
 */
export function timezoneForMarket(market: MarketName, browserTimezone?: unknown): string {
	return MARKET_TIMEZONE[market] ?? (isValidTimezone(browserTimezone) ? browserTimezone : 'UTC');
}
