import { describe, it, expect, vi } from 'vitest';
import {
	isMissingPersonasProfileColumn,
	withoutPersonasProfile,
	writeWithProfileFallback
} from './personas-profile-column';

describe('isMissingPersonasProfileColumn', () => {
	it('detects the Postgres undefined_column code', () => {
		expect(
			isMissingPersonasProfileColumn({
				code: '42703',
				message: 'column "personas_profile" of relation "agents" does not exist'
			})
		).toBe(true);
	});

	it('detects the PostgREST stale-schema-cache code', () => {
		expect(
			isMissingPersonasProfileColumn({
				code: 'PGRST204',
				message: "Could not find the 'personas_profile' column of 'agents' in the schema cache"
			})
		).toBe(true);
	});

	it('detects a message-only failure with no usable code', () => {
		expect(
			isMissingPersonasProfileColumn({
				message: 'column personas_profile does not exist'
			})
		).toBe(true);
	});

	it('accepts an undefined_column code with an empty message', () => {
		expect(isMissingPersonasProfileColumn({ code: '42703', message: '' })).toBe(true);
	});

	// The guard must be narrow: a real failure has to keep surfacing, otherwise a
	// broken write silently degrades to the legacy path forever.
	it('ignores unrelated errors', () => {
		expect(isMissingPersonasProfileColumn({ code: '23505', message: 'duplicate key value' })).toBe(
			false
		);
		expect(
			isMissingPersonasProfileColumn({ code: '42703', message: 'column "handle" does not exist' })
		).toBe(false);
		expect(isMissingPersonasProfileColumn({ message: 'permission denied for table agents' })).toBe(
			false
		);
		expect(isMissingPersonasProfileColumn(null)).toBe(false);
		expect(isMissingPersonasProfileColumn(undefined)).toBe(false);
		expect(isMissingPersonasProfileColumn('boom')).toBe(false);
	});
});

describe('withoutPersonasProfile', () => {
	it('strips only that key and does not mutate the input', () => {
		const payload = { name: 'Mia', market: '{"a":1}', personas_profile: { a: 1 } };
		const stripped = withoutPersonasProfile(payload);
		expect(stripped).toEqual({ name: 'Mia', market: '{"a":1}' });
		expect(payload.personas_profile).toEqual({ a: 1 });
	});
});

describe('writeWithProfileFallback', () => {
	it('does not retry when the write succeeds', async () => {
		const write = vi.fn().mockResolvedValue({ error: null });
		const payload = { name: 'Mia', personas_profile: { a: 1 } };

		const res = await writeWithProfileFallback(payload, write);

		expect(res.error).toBeNull();
		expect(write).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledWith(payload);
	});

	it('retries without the column when it is missing, keeping market', async () => {
		const write = vi
			.fn()
			.mockResolvedValueOnce({
				error: { code: '42703', message: 'column "personas_profile" does not exist' }
			})
			.mockResolvedValueOnce({ error: null });
		const payload = { name: 'Mia', market: '{"a":1}', personas_profile: { a: 1 } };

		const res = await writeWithProfileFallback(payload, write);

		expect(res.error).toBeNull();
		expect(write).toHaveBeenCalledTimes(2);
		// The retry must still carry `market` — that is what makes the fallback lossless.
		expect(write).toHaveBeenLastCalledWith({ name: 'Mia', market: '{"a":1}' });
	});

	it('surfaces unrelated errors without retrying', async () => {
		const write = vi
			.fn()
			.mockResolvedValue({ error: { code: '23505', message: 'duplicate key value' } });

		const res = await writeWithProfileFallback({ personas_profile: {} }, write);

		expect(res.error).toMatchObject({ code: '23505' });
		expect(write).toHaveBeenCalledTimes(1);
	});
});
