import { describe, it, expect } from 'vitest';
import {
	formatMoney,
	currencyForCountry,
	currencyForAcceptLanguage,
	resolveDisplayCurrency,
	creditsToAmount,
	formatCredits,
	rateFor,
	FALLBACK_FX,
	localeFromAcceptLanguage,
	creditsForUsd,
	quoteCredits,
	quoteMoney
} from './money';

describe('money — currency resolution', () => {
	it('maps countries to currencies, euro area included, unknown → null', () => {
		expect(currencyForCountry('AU')).toBe('AUD');
		expect(currencyForCountry('de')).toBe('EUR');
		expect(currencyForCountry('GB')).toBe('GBP');
		expect(currencyForCountry('ZZ')).toBeNull();
		expect(currencyForCountry(null)).toBeNull();
	});

	it('reads the region from Accept-Language; a bare language never guesses', () => {
		expect(currencyForAcceptLanguage('en-AU,en;q=0.9')).toBe('AUD');
		expect(currencyForAcceptLanguage('fr-CA,fr;q=0.8,en-US;q=0.5')).toBe('CAD');
		expect(currencyForAcceptLanguage('de')).toBeNull();
		expect(currencyForAcceptLanguage(null)).toBeNull();
	});

	it('precedence: preference → country → language → platform default → USD', () => {
		expect(
			resolveDisplayCurrency({ preference: 'gbp', country: 'AU', acceptLanguage: 'en-US' })
		).toBe('GBP');
		expect(resolveDisplayCurrency({ country: 'AU', acceptLanguage: 'en-US' })).toBe('AUD');
		expect(resolveDisplayCurrency({ acceptLanguage: 'en-NZ' })).toBe('NZD');
		expect(resolveDisplayCurrency({ platformDefault: 'EUR' })).toBe('EUR');
		expect(resolveDisplayCurrency({ platformDefault: 'auto' })).toBe('USD');
		expect(resolveDisplayCurrency({ preference: 'XXX', country: 'XX' })).toBe('USD');
	});
});

describe('money — conversion and formatting', () => {
	it('marks US dollars as US$ where the local currency also writes "$" (round-9)', () => {
		expect(formatMoney(79, 'USD', 'es-MX')).toBe('US$79.00');
		// Keep the locale's decimal separator; only disambiguate the currency symbol.
		expect(formatMoney(10, 'USD', 'es-CL')).toBe('US$10,00');
		expect(formatMoney(61.34, 'MXN', 'es-MX', { whole: false })).toBe('$61.34');
		expect(formatMoney(79, 'USD', 'en-US')).toBe('$79.00');
		expect(formatMoney(79, 'USD', 'en-PH')).toBe('$79.00');
		expect(formatMoney(79, 'USD')).toBe('$79.00');
	});

	it('2 000 credits = $20.00 in USD regardless of rates', () => {
		expect(creditsToAmount(2000, 'USD', FALLBACK_FX)).toBe(20);
		expect(formatCredits(2000, 'USD', FALLBACK_FX, 'en-US')).toBe('$20.00');
	});

	it('converts with the stored table and falls back to the seed', () => {
		const fx = {
			base: 'USD' as const,
			rates: { USD: 1, AUD: 1.5 },
			updated_at: 't',
			source: 'test'
		};
		expect(creditsToAmount(2000, 'AUD', fx)).toBe(30);
		expect(rateFor('AUD', null)).toBe(FALLBACK_FX.rates.AUD);
		expect(rateFor('NOPE', fx)).toBe(1); // unknown currency → 1:1, never NaN
	});

	it('rounds converted amounts to whole units and keeps the .00', () => {
		const fx = {
			base: 'USD' as const,
			rates: { USD: 1, AUD: 1.3882, EUR: 0.86044, GBP: 0.7391 },
			updated_at: 't',
			source: 'test'
		};
		expect(formatCredits(2000, 'AUD', fx, 'en-AU')).toBe('$28.00'); // 27.76 → 28
		expect(formatCredits(2000, 'EUR', fx, 'en-IE')).toBe('€17.00'); // 17.21 → 17
		expect(formatCredits(2000, 'GBP', fx, 'en-GB')).toBe('£15.00'); // 14.78 → 15
		expect(formatCredits(1958, 'USD', fx, 'en-US')).toBe('$20.00'); // 19.58 → 20
	});

	it('a balance under one unit keeps its cents so it never shows as zero', () => {
		expect(formatCredits(42, 'USD', FALLBACK_FX, 'en-US')).toBe('$0.42');
		expect(formatCredits(0, 'USD', FALLBACK_FX, 'en-US')).toBe('$0.00');
		expect(formatCredits(60, 'USD', FALLBACK_FX, 'en-US')).toBe('$1.00'); // 0.60 rounds to 1
	});

	it('exact mode is available for ledgers and admin views', () => {
		expect(formatCredits(1958, 'USD', FALLBACK_FX, 'en-US', { whole: false })).toBe('$19.58');
	});

	it('formats zero-decimal currencies without cents', () => {
		const fx = { base: 'USD' as const, rates: { JPY: 150 }, updated_at: null, source: null };
		expect(formatCredits(2000, 'JPY', fx, 'en-US')).toBe('¥3,000');
	});

	it('negative balances round the same way (shadow mode can overdraw)', () => {
		expect(formatCredits(-350, 'USD', FALLBACK_FX, 'en-US')).toBe('-$4.00');
		expect(formatCredits(-350, 'USD', FALLBACK_FX, 'en-US', { whole: false })).toBe('-$3.50');
	});

	it('locale from Accept-Language is a valid BCP-47 tag or undefined', () => {
		expect(localeFromAcceptLanguage('en-AU,en;q=0.9')).toBe('en-AU');
		expect(localeFromAcceptLanguage('*')).toBeUndefined();
		expect(localeFromAcceptLanguage(null)).toBeUndefined();
	});
});

describe('money — retail conversion (the quote a screen shows)', () => {
	it('is the same arithmetic the wallet debits: ceil(usd x markup x 100)', () => {
		expect(creditsForUsd(0.42, 3)).toBe(126);
		expect(creditsForUsd(0.08, 3)).toBe(24);
		// The Director's $0.002 is a real charge; rounding it away would let a
		// screen quote free for something the ledger bills.
		expect(creditsForUsd(0.002, 3)).toBe(1);
	});

	it('float noise never buys an extra credit', () => {
		// 0.08 * 3 * 100 is 24.000000000000004 in IEEE754; a naive ceil() bills 25.
		expect(creditsForUsd(0.08, 3)).toBe(24);
		expect(creditsForUsd(0.42, 1)).toBe(42);
	});

	it('nothing is charged for nothing, and a bad markup never undercharges', () => {
		expect(creditsForUsd(0, 3)).toBe(0);
		expect(creditsForUsd(-1, 3)).toBe(0);
		expect(creditsForUsd(Number.NaN, 3)).toBe(0);
		// A markup below 1 would quote under cost — clamped, never applied.
		expect(creditsForUsd(0.42, 0.5)).toBe(42);
		expect(creditsForUsd(0.42, Number.NaN)).toBe(42);
	});

	it('quotes a provider estimate as what the customer pays, in their currency', () => {
		const usd = { markup: 3, currency: 'USD', fx: FALLBACK_FX, locale: 'en-US' };
		// $0.42 of provider cost is $1.26 of customer money at a 3x markup — the
		// screens that printed "$0.42" were understating every quote by the markup.
		expect(quoteMoney(0.42, usd)).toBe('$1.26');
		expect(quoteCredits(0.42, usd)).toBe(126);
	});

	it('a quote keeps its cents — "$0.00" for a real charge is the bug it replaces', () => {
		const usd = { markup: 3, currency: 'USD', fx: FALLBACK_FX, locale: 'en-US' };
		expect(quoteMoney(0.002, usd)).toBe('$0.01');
	});
});
