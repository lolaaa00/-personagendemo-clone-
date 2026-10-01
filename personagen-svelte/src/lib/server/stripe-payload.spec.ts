import { describe, expect, it } from 'vitest';
import legacy from './fixtures/stripe-invoice-paid-legacy.json';
import basil from './fixtures/stripe-invoice-paid-basil.json';
import {
	invoiceServicePeriod,
	invoiceSubscriptionId,
	invoiceSubscriptionMetadata,
	subscriptionServicePeriod
} from './stripe-payload';

describe('Stripe webhook payload compatibility', () => {
	it.each([
		[legacy, 'sub_legacy', 'studio'],
		[basil, 'sub_basil', 'brand']
	] as const)(
		'reads subscription and metadata from versioned invoice fixtures',
		(invoice, subscription, plan) => {
			expect(invoiceSubscriptionId(invoice)).toBe(subscription);
			expect(invoiceSubscriptionMetadata(invoice)).toMatchObject({ plan });
		}
	);
	it('uses the Basil subscription line period, not invoice lookback dates', () => {
		expect(invoiceServicePeriod(basil)).toEqual({
			start: '2025-12-01T00:00:00.000Z',
			end: '2026-01-01T00:00:00.000Z'
		});
	});
	it('supports legacy top-level and Basil item subscription periods', () => {
		expect(subscriptionServicePeriod({ current_period_start: 1, current_period_end: 2 })).toEqual({
			start: '1970-01-01T00:00:01.000Z',
			end: '1970-01-01T00:00:02.000Z'
		});
		expect(
			subscriptionServicePeriod({
				items: { data: [{ current_period_start: 3, current_period_end: 4 }] }
			})
		).toEqual({ start: '1970-01-01T00:00:03.000Z', end: '1970-01-01T00:00:04.000Z' });
	});
});
