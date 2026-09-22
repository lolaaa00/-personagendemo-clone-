import { describe, it, expect } from 'vitest';
import { statusAfterConnectionCheck } from './agent-status';

describe('statusAfterConnectionCheck', () => {
	it('never overrides the user on a persona that has not connected yet', () => {
		// Round-2 re-audit: switched on, then Paused again by the next page load.
		expect(statusAfterConnectionCheck('active', 0, 0)).toBe('active');
		expect(statusAfterConnectionCheck('paused', 0, 0)).toBe('paused');
		expect(statusAfterConnectionCheck('pending', null, 0)).toBe('pending');
	});

	it('pauses an active persona that LOST its last connection', () => {
		expect(statusAfterConnectionCheck('active', 2, 0)).toBe('paused');
	});

	it('wakes a pending persona on its first connection, and never un-pauses', () => {
		expect(statusAfterConnectionCheck('pending', 0, 1)).toBe('active');
		expect(statusAfterConnectionCheck('active', 1, 1)).toBe('active');
		expect(statusAfterConnectionCheck('paused', 1, 1)).toBe('paused');
	});
});
