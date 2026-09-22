/**
 * The round-3 audit server died on "Cannot use cookies.set(...) after the
 * response has been generated": a late auth-js event wrote cookies after the
 * response, the throw became an unhandled rejection, and Node exited. The
 * cookie writer must swallow exactly that, and keep writing the rest.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

const { setAuthCookies } = await import('./supabase');

describe('setAuthCookies', () => {
	it('never throws when the response has already been generated', () => {
		const cookies = {
			set: vi.fn(() => {
				throw new Error('Cannot use `cookies.set(...)` after the response has been generated');
			})
		};
		expect(() => setAuthCookies(cookies, [{ name: 'sb-a', value: 'x' }])).not.toThrow();
	});

	it('writes every cookie with path=/ when it can', () => {
		const cookies = { set: vi.fn() };
		setAuthCookies(cookies, [
			{ name: 'sb-a', value: '1', options: { sameSite: 'lax' } },
			{ name: 'sb-b', value: '2' }
		]);
		expect(cookies.set).toHaveBeenCalledTimes(2);
		expect(cookies.set).toHaveBeenCalledWith('sb-a', '1', { sameSite: 'lax', path: '/' });
	});

	it('one failing cookie does not stop the others', () => {
		const set = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error('Cannot use `cookies.set(...)` after the response has been generated');
			})
			.mockImplementation(() => {});
		setAuthCookies({ set }, [
			{ name: 'a', value: '1' },
			{ name: 'b', value: '2' }
		]);
		expect(set).toHaveBeenCalledTimes(2);
	});
});
