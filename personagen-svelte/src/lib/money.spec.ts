import { describe, it, expect } from 'vitest';
import {
	currencyForCountry,
	currencyForAcceptLanguage,
	resolveDisplayCurrency,
	creditsToAmount,
	formatCredits,
	rateFor,
	FALLBACK_FX,
	localeFromAcceptLanguage
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
		expect(resolveDisplayCurrency({ preference: 'gbp', country: 'AU', acceptLanguage: 'en-US' })).toBe('GBP');
		expect(resolveDisplayCurrency({ country: 'AU', acceptLanguage: 'en-US' })).toBe('AUD');
		expect(resolveDisplayCurrency({ acceptLanguage: 'en-NZ' })).toBe('NZD');
		expect(resolveDisplayCurrency({ platformDefault: 'EUR' })).toBe('EUR');
		expect(resolveDisplayCurrency({ platformDefault: 'auto' })).toBe('USD');
		expect(resolveDisplayCurrency({ preference: 'XXX', country: 'XX' })).toBe('USD');
	});
});

describe('money — conversion and formatting', () => {
	it('2 000 credits = $20.00 in USD regardless of rates', () => {
		expect(creditsToAmount(2000, 'USD', FALLBACK_FX)).toBe(20);
		expect(formatCredits(2000, 'USD', FALLBACK_FX, 'en-US')).toBe('$20.00');
	});

	it('converts with the stored table and falls back to the seed', () => {
		const fx = { base: 'USD' as const, rates: { USD: 1, AUD: 1.5 }, updated_at: 't', source: 'test' };
		expect(creditsToAmount(2000, 'AUD', fx)).toBe(30);
		expect(rateFor('AUD', null)).toBe(FALLBACK_FX.rates.AUD);
		expect(rateFor('NOPE', fx)).toBe(1); // unknown currency → 1:1, never NaN
	});

	it('formats zero-decimal currencies without cents', () => {
		const fx = { base: 'USD' as const, rates: { JPY: 150 }, updated_at: null, source: null };
		expect(formatCredits(2000, 'JPY', fx, 'en-US')).toBe('¥3,000');
	});

	it('negative balances format as negative money (shadow mode can overdraw)', () => {
		expect(formatCredits(-350, 'USD', FALLBACK_FX, 'en-US')).toBe('-$3.50');
	});

	it('locale from Accept-Language is a valid BCP-47 tag or undefined', () => {
		expect(localeFromAcceptLanguage('en-AU,en;q=0.9')).toBe('en-AU');
		expect(localeFromAcceptLanguage('*')).toBeUndefined();
		expect(localeFromAcceptLanguage(null)).toBeUndefined();
	});
});
