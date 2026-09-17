/**
 * Permission denial in the portal is a designed state, never a silent teleport.
 *
 * Two page loads used to answer "this seat may not open this" with
 * `redirect(303, '/dashboard')`. The nav already hid both entries, so everyone
 * who reached them had followed a shared link or a bookmark — and was bounced to
 * a different page with no explanation. A user cannot distinguish that from a
 * broken link, and nothing tells them who could grant access. Five seat roles
 * were driven across every portal route to find it; the redirect was the only
 * permission behaviour in the product, and it was invisible.
 *
 * The designed answer already existed: the root +error.svelte names the seat
 * and who can change it. `(portal)/+error.svelte` re-renders it inside the
 * portal shell, so the sidebar survives the error. These lock both halves.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORTAL = join(__dirname, '..', '..', 'routes', '(portal)');

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\+(page|layout)\.server\.ts$/.test(entry)) out.push(p);
	}
	return out;
}

describe('portal loads never answer a permission check with a redirect', () => {
	const loads = walk(PORTAL);

	it('finds the loads at all (a silent empty scan would pass forever)', () => {
		expect(loads.length).toBeGreaterThan(5);
	});

	it('no server load bounces a signed-in user to /dashboard', () => {
		// The /login redirect for a MISSING session is the one legitimate bounce:
		// there is nobody to explain anything to yet. A redirect to /dashboard is
		// the tell of a permission check pretending to be navigation.
		const offenders = loads
			.filter((f) => /redirect\(\s*30[1-8]\s*,\s*['"]\/dashboard['"]/.test(readFileSync(f, 'utf8')))
			.map((f) => f.split('(portal)')[1]);
		expect(
			offenders,
			'A permission check answered with a redirect. Throw error(403, <who can open this>) ' +
				'instead — the designed error page names the seat and who can change it.'
		).toEqual([]);
	});

	it('the two gated pages say why, in the user’s terms', () => {
		for (const [file, needle] of [
			['admin/+page.server.ts', /error\(403,\s*['"][^'"]*owner[^'"]*['"]\)/i],
			['models/+page.server.ts', /error\(403,\s*['"][^'"]*platform[^'"]*['"]\)/i]
		] as const) {
			expect(readFileSync(join(PORTAL, file), 'utf8'), file).toMatch(needle);
		}
	});
});

describe('the portal keeps its shell when a page errors', () => {
	it('has its own error boundary', () => {
		// Without this, a 403 in the portal renders the ROOT error page inside the
		// root layout: no sidebar, no persona rail, nothing to click but the card.
		expect(existsSync(join(PORTAL, '+error.svelte'))).toBe(true);
	});

	it('re-uses the root error page rather than duplicating its copy', () => {
		// One component, two boundaries. A second copy of the 403 wording is a
		// second thing to keep true.
		const src = readFileSync(join(PORTAL, '+error.svelte'), 'utf8');
		expect(src).toMatch(/import\s+\w+\s+from\s+['"]\.\.\/\+error\.svelte['"]/);
		expect(src).not.toMatch(/You do not have access/);
	});
});
