/**
 * Money display for credits — client-safe (no server imports).
 *
 * Credits are an internal unit: 1 credit = 1 US cent at RETAIL (estimated
 * provider cost × the platform's credit_markup, see server/credits.ts).
 * Users never see "credits"; they see a money amount in THEIR currency,
 * the way any wallet-style SaaS does ("Credits $20.00"). The currency comes
 * from, in order: the user's saved preference → the visiting browser's country
 * (Cloudflare header) → the Accept-Language locale → USD.
 *
 * Conversion uses the platform's stored FX table (platform_settings.fx_rates,
 * refreshed by an admin from the console). Rates are display-only: the wallet
 * itself is always USD cents, so a stale rate can never change what is charged.
 */

export type FxRates = {
	base: 'USD';
	rates: Record<string, number>;
	updated_at: string | null;
	source: string | null;
};

/** Seed table so display works before the first refresh. Approximate, 2026-09. */
export const FALLBACK_FX: FxRates = {
	base: 'USD',
	rates: {
		USD: 1,
		EUR: 0.92,
		GBP: 0.78,
		AUD: 1.52,
		NZD: 1.66,
		CAD: 1.37,
		SGD: 1.34,
		INR: 84,
		JPY: 150,
		CHF: 0.88,
		SEK: 10.6,
		NOK: 10.8,
		DKK: 6.9,
		PLN: 3.95,
		CZK: 23.2,
		HUF: 365,
		ZAR: 18.2,
		BRL: 5.5,
		MXN: 18.5,
		AED: 3.67,
		SAR: 3.75,
		HKD: 7.8,
		KRW: 1360,
		PHP: 57,
		MYR: 4.5,
		THB: 35,
		IDR: 15800,
		VND: 25000,
		TRY: 34,
		ILS: 3.7,
		NGN: 1600,
		KES: 129,
		EGP: 48,
		ARS: 950,
		CLP: 940,
		COP: 4100
	},
	updated_at: null,
	source: 'seed'
};

/** ISO 3166-1 alpha-2 → ISO 4217. Countries not listed fall back to USD. */
const COUNTRY_CURRENCY: Record<string, string> = {
	US: 'USD',
	PR: 'USD',
	EC: 'USD',
	SV: 'USD',
	PA: 'USD',
	GB: 'GBP',
	IM: 'GBP',
	JE: 'GBP',
	GG: 'GBP',
	AU: 'AUD',
	NZ: 'NZD',
	CA: 'CAD',
	SG: 'SGD',
	IN: 'INR',
	JP: 'JPY',
	CH: 'CHF',
	LI: 'CHF',
	SE: 'SEK',
	NO: 'NOK',
	DK: 'DKK',
	PL: 'PLN',
	CZ: 'CZK',
	HU: 'HUF',
	ZA: 'ZAR',
	BR: 'BRL',
	MX: 'MXN',
	AE: 'AED',
	SA: 'SAR',
	HK: 'HKD',
	KR: 'KRW',
	PH: 'PHP',
	MY: 'MYR',
	TH: 'THB',
	ID: 'IDR',
	VN: 'VND',
	TR: 'TRY',
	IL: 'ILS',
	NG: 'NGN',
	KE: 'KES',
	EG: 'EGP',
	AR: 'ARS',
	CL: 'CLP',
	CO: 'COP',
	// euro area
	AT: 'EUR',
	BE: 'EUR',
	CY: 'EUR',
	DE: 'EUR',
	EE: 'EUR',
	ES: 'EUR',
	FI: 'EUR',
	FR: 'EUR',
	GR: 'EUR',
	HR: 'EUR',
	IE: 'EUR',
	IT: 'EUR',
	LT: 'EUR',
	LU: 'EUR',
	LV: 'EUR',
	MT: 'EUR',
	NL: 'EUR',
	PT: 'EUR',
	SI: 'EUR',
	SK: 'EUR',
	MC: 'EUR',
	SM: 'EUR',
	VA: 'EUR',
	AD: 'EUR',
	ME: 'EUR',
	XK: 'EUR'
};

export const SUPPORTED_CURRENCIES = Object.keys(FALLBACK_FX.rates);

export function currencyForCountry(country: string | null | undefined): string | null {
	if (!country) return null;
	return COUNTRY_CURRENCY[country.toUpperCase()] ?? null;
}

/** "en-AU,en;q=0.9" → AUD; "de" (no region) → EUR is NOT assumed — null. */
export function currencyForAcceptLanguage(header: string | null | undefined): string | null {
	if (!header) return null;
	for (const part of header.split(',')) {
		const tag = part.split(';')[0].trim();
		const region = tag.split(/[-_]/)[1];
		const c = currencyForCountry(region);
		if (c) return c;
	}
	return null;
}

export function isSupportedCurrency(code: string | null | undefined): code is string {
	return !!code && Object.prototype.hasOwnProperty.call(FALLBACK_FX.rates, code.toUpperCase());
}

/**
 * Resolve the display currency for a request.
 *   preference (profile) → country header → Accept-Language → default ('auto' = USD)
 */
export function resolveDisplayCurrency(args: {
	preference?: string | null;
	country?: string | null;
	acceptLanguage?: string | null;
	platformDefault?: string | null;
}): string {
	const pref = args.preference?.toUpperCase();
	if (isSupportedCurrency(pref)) return pref;
	const byCountry = currencyForCountry(args.country);
	if (byCountry) return byCountry;
	const byLang = currencyForAcceptLanguage(args.acceptLanguage);
	if (byLang) return byLang;
	const def = args.platformDefault?.toUpperCase();
	if (def && def !== 'AUTO' && isSupportedCurrency(def)) return def;
	return 'USD';
}

export function rateFor(currency: string, fx: FxRates | null | undefined): number {
	const code = currency.toUpperCase();
	if (code === 'USD') return 1;
	// The stored table (ECB via frankfurter, 27 currencies) wins; a currency it
	// lacks takes the SEED rate — never 1. Nine currencies (AED, SAR, NGN, KES,
	// EGP, ARS, CLP, COP, VND) were shown at 1:1 with USD, understating every
	// price and balance by the whole rate (round-7 re-audit, High).
	const stored = Number(fx?.rates?.[code]);
	if (Number.isFinite(stored) && stored > 0) return stored;
	const seed = Number(FALLBACK_FX.rates[code]);
	return Number.isFinite(seed) && seed > 0 ? seed : 1;
}

/** Credits (USD cents) → amount in the display currency. */
export function creditsToAmount(credits: number, currency: string, fx?: FxRates | null): number {
	return ((Number(credits) || 0) / 100) * rateFor(currency, fx);
}

const ZERO_DECIMAL = ['JPY', 'KRW', 'VND', 'IDR', 'HUF', 'CLP', 'COP'];

/** Minor-unit digits of a currency: 0 for yen-like currencies, else 2. */
export function minorUnitDigits(currency: string): number {
	return ZERO_DECIMAL.includes(currency.toUpperCase()) ? 0 : 2;
}

/** Round half AWAY from zero (money convention). Math.round pulls -3.5 to -3. */
function roundHalfAway(n: number): number {
	return Math.sign(n) * Math.round(Math.abs(n));
}

export interface FormatOptions {
	/**
	 * Round to whole units of the currency and still print the ".00" — the wallet
	 * pill reads "A$28.00", not "A$27.76". A balance under one unit keeps its
	 * cents so a non-zero wallet never displays as zero. Default true.
	 */
	whole?: boolean;
}

/** Localised money string: 2 000 credits, AUD → "A$28.00"; JPY → "¥3,000". */
export function formatMoney(
	amount: number,
	currency: string,
	locale?: string,
	opts: FormatOptions = {}
): string {
	const whole = opts.whole ?? true;
	const zeroDecimal = ZERO_DECIMAL.includes(currency.toUpperCase());
	let value = amount;
	const fraction = zeroDecimal ? 0 : 2;
	if (whole && !zeroDecimal) {
		const rounded = roundHalfAway(amount);
		// Keep cents only when rounding would hide a real balance (|amount| < 0.5).
		if (rounded !== 0 || amount === 0) value = rounded;
	}
	if (zeroDecimal) value = roundHalfAway(amount);
	try {
		return new Intl.NumberFormat(locale || undefined, {
			style: 'currency',
			currency,
			currencyDisplay: 'narrowSymbol',
			minimumFractionDigits: fraction,
			maximumFractionDigits: fraction
		}).format(value);
	} catch {
		return `${currency} ${value.toFixed(fraction)}`;
	}
}

export function formatCredits(
	credits: number,
	currency: string,
	fx?: FxRates | null,
	locale?: string,
	opts: FormatOptions = {}
): string {
	return formatMoney(creditsToAmount(credits, currency, fx), currency, locale, opts);
}

/** Best-effort Intl locale from Accept-Language (first tag). */
export function localeFromAcceptLanguage(header: string | null | undefined): string | undefined {
	const tag = header?.split(',')[0]?.split(';')[0]?.trim();
	return tag && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag) ? tag : undefined;
}

// ── Retail conversion ───────────────────────────────────────────────────────
// One implementation of "provider cost → what the customer pays", shared by
// the server wallet (server/credits.ts imports THIS) and every screen that
// quotes a price before spending. Two copies of this arithmetic is how the
// app ended up quoting cost on seven surfaces and price on two.

/** 1 credit = 1 US cent at retail. */
export const CREDITS_PER_USD = 100;

/**
 * ceil(usd × markup × 100); non-positive or non-finite → 0.
 *
 * Rounds to 6 dp first so float noise (0.0800000001) can't add a credit, and
 * clamps a markup below 1 to 1 — quoting under cost is never the safe
 * direction. The server's creditsFor() is this function with the live platform
 * markup applied as the default argument.
 */
export function creditsForUsd(usd: number, markup: number): number {
	const n = Number(usd);
	if (!Number.isFinite(n) || n <= 0) return 0;
	const m = Number.isFinite(markup) && markup >= 1 ? markup : 1;
	return Math.ceil(+(n * m * CREDITS_PER_USD).toFixed(6));
}

/**
 * Everything a screen needs to turn a provider estimate into the number the
 * customer will actually be charged, in their own currency. Primed once per
 * page load from the portal layout (see stores/pricing.svelte.ts) so no
 * component has to prop-drill a markup it can't verify.
 */
export interface PricingContext {
	markup: number;
	currency: string;
	fx: FxRates | null;
	locale?: string;
	/**
	 * The viewer's IANA zone (from the `tz` cookie the portal sets in the
	 * browser). An INSTANT rendered on the server otherwise printed in the
	 * server's zone and then jumped hours on hydration (re-audit).
	 */
	timeZone?: string;
	/**
	 * Credits are actually being written (shadow or enforce). A quote is a real
	 * charge when this is true and an estimate when it is false, and the labels
	 * on screen have to say which — claiming a debit that will not happen is the
	 * same class of misreport as quoting cost where the customer pays retail.
	 */
	metered?: boolean;
	enforced?: boolean;
}

/** Retail credits for a raw provider estimate. */
export function quoteCredits(usd: number, pricing: PricingContext): number {
	return creditsForUsd(usd, pricing.markup);
}

/**
 * The headline string for a quote: provider cost → retail, in the viewer's
 * currency. Keeps cents (whole: false) because a quote of "$0.00" for a real
 * charge is exactly the misreport this replaces.
 */
export function quoteMoney(
	usd: number,
	pricing: PricingContext,
	opts: FormatOptions = { whole: false }
): string {
	return formatCredits(
		creditsForUsd(usd, pricing.markup),
		pricing.currency,
		pricing.fx,
		pricing.locale,
		opts
	);
}
