import { describe, it, expect, beforeEach } from 'vitest';
import { primePricing, resetPricing } from '$lib/stores/pricing.svelte';
import { slotTime, slotDateTime, localDate, instantDateTime } from './datetime';

describe('one slot convention, in the resolved locale (UI-005)', () => {
	beforeEach(() => resetPricing());

	it('prints 12-hour in en-US and 24-hour in en-GB for the same stored slot', () => {
		primePricing({ locale: 'en-US' });
		expect(slotTime('2026-09-22', '14:00:00')).toMatch(/2:00\s?PM/);
		primePricing({ locale: 'en-GB' });
		expect(slotTime('2026-09-22', '14:00:00')).toBe('14:00');
	});

	it('uses the viewer order for full dates (was US order under en-GB)', () => {
		primePricing({ locale: 'en-GB' });
		const d = new Date(2026, 8, 21);
		// Day before month — the punctuation is ICU's business.
		expect(localDate(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })).toMatch(
			/^Monday,? 21 September 2026$/
		);
	});

	it('degrades to the stored text, never "Invalid Date"', () => {
		expect(slotDateTime(null, null)).toBe('Unscheduled');
		expect(slotTime('2026-09-22', null)).toBe('');
		expect(instantDateTime('not a date')).toBe('');
		expect(slotDateTime('2026-09-22', '10:05:00')).not.toMatch(/Invalid/);
	});
});
