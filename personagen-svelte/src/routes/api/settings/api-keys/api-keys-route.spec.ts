import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The `authenticated` role has no SELECT on user_api_keys (secrets are read as
 * service_role since c7674db). A user-client upsert/update/select on that table
 * fails with "permission denied" — which is exactly how saving a provider key
 * broke in production (client audit, round 9). This pins every access in the
 * route to the service client.
 */
describe('api-keys route — user_api_keys is touched only through the service client', () => {
	const src = readFileSync(resolve(__dirname, '+server.ts'), 'utf8');
	it('never reaches user_api_keys through locals.supabase', () => {
		expect(src).not.toMatch(/locals\.supabase\s*\.from\('user_api_keys'\)/);
	});
	it('reaches it through the service client, scoped by user id', () => {
		expect(src).toMatch(/getServiceSupabase\(\)/);
		const accesses = src.match(/await keys\(\)\s*\.from\('user_api_keys'\)/g) ?? [];
		expect(accesses.length).toBeGreaterThanOrEqual(4);
		const scoped = src.match(/\.eq\('user_id', user\.id\)/g) ?? [];
		expect(scoped.length).toBeGreaterThanOrEqual(3); // list, test-update, delete; the upsert carries user_id in its row
	});
});
