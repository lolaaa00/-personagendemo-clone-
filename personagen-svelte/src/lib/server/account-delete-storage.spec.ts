/**
 * "Delete my account" must delete the account's files too.
 *
 * Generated media lives in a PUBLIC bucket under `<userId>/…`, and storage does
 * not cascade from auth.users. The delete route removed every table and the
 * auth row and never touched storage, so a user who deleted their account left
 * every image they had ever generated publicly readable, forever.
 *
 * Ordering is the subtle part: storage.objects.owner is NULL on every row in
 * this project, so the path prefix is the ONLY link between a file and its
 * owner. Once the auth row is gone nothing can say whose files those were, so
 * the purge has to happen while the user still exists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(
	join(__dirname, '..', '..', 'routes', 'api', 'account', 'delete', '+server.ts'),
	'utf8'
);

describe('account deletion removes the user’s stored media', () => {
	it('lists and removes files under the user prefix', () => {
		expect(route).toContain(".storage.from(bucket).list(userId");
		expect(route).toContain('.storage.from(bucket).remove(paths)');
		expect(route).toContain('`${userId}/${f.name}`');
	});

	it('purges BEFORE deleting the auth user, while the prefix still means something', () => {
		expect(route.indexOf('.storage.from(bucket).remove(paths)')).toBeLessThan(
			route.indexOf('auth.admin.deleteUser(userId)')
		);
	});

	it('pages, rather than deleting only the first 100 files', () => {
		expect(route).toContain('offset += 100');
		expect(route).toContain('if (files.length < 100) break;');
	});

	it('reports a storage failure instead of swallowing it', () => {
		// The user asked for their data to be gone; silently keeping it is the
		// one outcome this route must never report as success.
		expect(route).toContain("failedSteps.push(`storage list:");
		expect(route).toContain("failedSteps.push(`storage remove:");
	});
});
