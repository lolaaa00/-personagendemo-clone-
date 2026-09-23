/**
 * The top-up request status must be one the database accepts. The first
 * version used 'open', which `tickets_status_check` rejects, and every request
 * failed in production-shaped data while every unit test passed — nothing
 * compared the code's status to the table's constraint. This does.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOPUP_PENDING_STATUS, TOPUP_TITLE_PREFIX } from './topup-requests';

const appRoot = join(__dirname, '..', '..', '..');
const sql = readFileSync(join(appRoot, 'supabase', 'migration.sql'), 'utf8');

function allowedTicketStatuses(): string[] {
	const table = sql.match(/CREATE TABLE public\.tickets \(([^;]*?)\n\);/);
	const check = table?.[1].match(/status TEXT[^,]*?CHECK \(status IN \(([^)]*)\)\)/);
	return (check?.[1] ?? '').split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

describe('top-up requests vs the tickets table', () => {
	it('reads the real constraint (the sample is not empty)', () => {
		expect(allowedTicketStatuses()).toEqual(['backlog', 'in_progress', 'review', 'done']);
	});

	it('writes a status the constraint accepts', () => {
		expect(allowedTicketStatuses()).toContain(TOPUP_PENDING_STATUS);
	});

	it('every writer and reader uses the shared constant, not a literal', () => {
		const files = [
			'src/routes/api/billing/request-topup/+server.ts',
			'src/routes/(portal)/billing/+page.server.ts',
			'src/routes/api/admin/settings/+server.ts',
			'src/routes/api/support/report-failure/+server.ts',
			'src/routes/api/support/sign-in-help/+server.ts'
		];
		for (const f of files) {
			const src = readFileSync(join(appRoot, f), 'utf8');
			expect(src, f).toContain('TOPUP_PENDING_STATUS');
			expect(src, f).not.toMatch(/\.eq\('status', 'open'\)/);
			expect(src, f).not.toMatch(/status: 'open'/);
		}
		expect(TOPUP_TITLE_PREFIX).toBe('Top-up request');
	});
});
