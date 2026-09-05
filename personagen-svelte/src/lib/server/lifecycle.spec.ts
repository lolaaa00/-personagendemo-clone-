import { describe, it, expect, beforeEach } from 'vitest';
import { onShutdown, runShutdown, _resetLifecycleForTests } from './lifecycle';

beforeEach(() => _resetLifecycleForTests());

describe('lifecycle — shutdown flushers', () => {
	it('runs every flusher in registration order and reports success', async () => {
		const order: string[] = [];
		onShutdown('a', () => {
			order.push('a');
		});
		onShutdown('b', async () => {
			order.push('b');
		});
		const res = await runShutdown('test');
		expect(order).toEqual(['a', 'b']);
		expect(res.ok).toEqual(['a', 'b']);
		expect(res.failed).toEqual([]);
	});

	it('a failing flusher does not stop the others', async () => {
		let ran = false;
		onShutdown('boom', () => {
			throw new Error('nope');
		});
		onShutdown('after', () => {
			ran = true;
		});
		const res = await runShutdown('test');
		expect(ran).toBe(true);
		expect(res.failed[0]).toMatch(/boom: nope/);
		expect(res.ok).toEqual(['after']);
	});
});
