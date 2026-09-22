import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MARKETS, marketName, marketToken, timezoneForMarket, isValidTimezone } from './markets';

describe('market choice (UX-008)', () => {
	it('falls back to Global, never a country', () => {
		expect(marketName(undefined)).toBe('Global');
		expect(marketName('Atlantis')).toBe('Global');
		expect(marketName('Japan')).toBe('Japan');
	});

	it('maps to the profile token generation reads', () => {
		expect(marketToken('Australia')).toBe('au');
		expect(marketToken('United States')).toBe('us');
		expect(marketToken('United Kingdom')).toBe('uk');
		expect(marketToken('Japan')).toBe('generic');
		expect(marketToken('Global')).toBe('generic');
	});

	it('gives every named market a real timezone, and Global the browser clock', () => {
		for (const m of MARKETS) {
			if (m === 'Global') continue;
			expect(isValidTimezone(timezoneForMarket(m)), m).toBe(true);
		}
		expect(timezoneForMarket('Japan')).toBe('Asia/Tokyo');
		expect(timezoneForMarket('Global', 'Asia/Manila')).toBe('Asia/Manila');
		expect(timezoneForMarket('Global', 'Not/AZone')).toBe('UTC');
		expect(timezoneForMarket('Global')).toBe('UTC');
	});

	it('the create endpoint persists the choice instead of a hard-coded Sydney clock', () => {
		const api = readFileSync(join(__dirname, '..', 'routes', 'api', 'agents', '+server.ts'), 'utf8');
		expect(api).not.toMatch(/timezone:\s*'Australia\/Sydney'/);
		expect(api).toMatch(/timezoneForMarket\(/);
		expect(api).toMatch(/market:\s*chosenMarket/);
		const wizard = readFileSync(
			join(__dirname, '..', 'routes', '(portal)', 'generator', '+page.svelte'),
			'utf8'
		);
		const payload = wizard.slice(wizard.indexOf('function buildCreatePayload'));
		expect(payload.slice(0, 1500)).toMatch(/\bmarket\b/);
	});
});
