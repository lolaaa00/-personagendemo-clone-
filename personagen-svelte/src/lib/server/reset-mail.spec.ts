import { describe, it, expect } from 'vitest';
import { recoveryLink, resetMailBody, RESET_NEXT } from './reset-mail';

describe('reset-mail — the link the app puts in a password-reset email', () => {
	it('points at our own recover route with the token hash and the reset dialog as next', () => {
		const link = recoveryLink('https://honeyx.monarchstack.com', 'abc123');
		const u = new URL(link);
		expect(u.origin).toBe('https://honeyx.monarchstack.com');
		expect(u.pathname).toBe('/api/auth/recover');
		expect(u.searchParams.get('token_hash')).toBe('abc123');
		expect(u.searchParams.get('next')).toBe(RESET_NEXT);
	});

	it('never carries the GoTrue host or localhost — the auth container’s API_EXTERNAL_URL is not involved', () => {
		const link = recoveryLink('https://honeyx.monarchstack.com', 'abc123');
		expect(link).not.toMatch(/localhost|supabase|auth\/v1/);
	});

	it('the email says it works once and expires, and carries the link in text and html', () => {
		const link = recoveryLink('https://honeyx.monarchstack.com', 'tok');
		const body = resetMailBody(link);
		expect(body.text).toContain(link);
		expect(body.html).toContain(link);
		expect(body.text).toMatch(/works once/);
		expect(body.text).toMatch(/expires in an hour/);
	});
});
