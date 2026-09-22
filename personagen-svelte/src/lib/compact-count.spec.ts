import { describe, it, expect } from 'vitest';
import { parseCompactCount, formatCompactCount } from './compact-count';

describe('parseCompactCount', () => {
	it('reads the forms the platform sync stores', () => {
		expect(parseCompactCount('13.8K')).toBe(13800);
		expect(parseCompactCount('4,520')).toBe(4520);
		expect(parseCompactCount('1.2M')).toBe(1_200_000);
		expect(parseCompactCount('7k')).toBe(7000);
		expect(parseCompactCount(8670)).toBe(8670);
	});

	it('is 0 for nothing, garbage or negatives — never NaN', () => {
		for (const v of [null, undefined, '', '—', 'abc', -5, NaN]) expect(parseCompactCount(v)).toBe(0);
	});

	it('sums the round-2 roster to what its rows say (was 161.9K)', () => {
		const rows = ['4,520', '7,010', '3,690', '0', '8,670', '13.8K'];
		const total = rows.reduce((s, r) => s + parseCompactCount(r), 0);
		expect(total).toBe(37690);
		expect(formatCompactCount(total)).toBe('37.7K');
	});
});
