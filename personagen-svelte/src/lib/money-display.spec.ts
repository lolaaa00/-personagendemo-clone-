import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard: a screen where someone DECIDES to spend must quote the price, never
 * the provider's cost.
 *
 * The wallet debits `ceil(providerUsd × credit_markup × 100)` credits, rendered
 * as money in the viewer's currency. Seven surfaces used to print the raw
 * provider estimate with a `$` in front of it, so the product quoted about a
 * third of what it charged — the campaign planner's launch button said
 * "est. $10.20" for a run that debited $30.60.
 *
 * That is not the kind of bug you fix once. Every new price render is one
 * `.toFixed(2)` away from reintroducing it, so this test fails the build when a
 * file starts formatting a provider number as money without being on the
 * allowlist below.
 */

const ROOTS = ['src/routes', 'src/lib/components'];

/** `$` immediately followed by an interpolation that formats a number. */
const RAW_MONEY = /\$\{[^}]*\.toFixed\(/;

/**
 * Files allowed to render a provider figure, each for a stated reason. Adding a
 * file here is a deliberate claim that its number is NOT what a customer pays.
 */
const ALLOWED: Record<string, string> = {
	'src/routes/(portal)/admin/+page.svelte':
		'Platform admin console: operator-facing COGS and the markup preview, which exist precisely to show cost next to price.',
	'src/routes/(portal)/models/+page.svelte':
		'Model Manager is platform-admin only and its ledger is platform-wide COGS — quoting it at retail would tell the operator we paid our own markup.',
	'src/lib/components/feed/PostDrawer.svelte':
		'Observability panel shows the retail price as the headline and keeps the provider figure beneath it, explicitly labelled "at cost".',
	'src/lib/components/dashboard/SparkChart.svelte': 'Chart endpoint labels — not money.'
};

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (p.endsWith('.svelte')) out.push(p.split('\\').join('/'));
	}
	return out;
}

describe('money display — screens quote the price, not the cost', () => {
	const files = ROOTS.flatMap((r) => walk(r));

	it('finds the UI to scan (a silent empty scan would pass forever)', () => {
		expect(files.length).toBeGreaterThan(20);
	});

	it('no screen formats a provider figure as money unless it is allowlisted', () => {
		const offenders = files.filter((f) => RAW_MONEY.test(readFileSync(f, 'utf8')) && !ALLOWED[f]);
		expect(
			offenders,
			'These render a raw provider number as money. Use quote() from $lib/stores/pricing.svelte, ' +
				'or add the file to ALLOWED in this spec with the reason its number is not a customer charge.'
		).toEqual([]);
	});

	it('every allowlisted file still exists and still needs its exemption', () => {
		// An allowlist entry that no longer matches is stale permission — the next
		// person to add a price render to that file would inherit the exemption.
		for (const [file, reason] of Object.entries(ALLOWED)) {
			expect(reason.length, `${file} needs a reason`).toBeGreaterThan(20);
			expect(files, `${file} is allowlisted but no longer exists`).toContain(file);
			expect(RAW_MONEY.test(readFileSync(file, 'utf8')), `${file} no longer needs its exemption`).toBe(
				true
			);
		}
	});

	it('the surfaces that quote a generation all read the shared pricing context', () => {
		// These are the screens a user reads before spending. Each must go through
		// quote(), which is the only formatter that applies the markup.
		const mustQuote = [
			'src/lib/components/generation/GenerationComposer.svelte',
			'src/lib/components/generation/CampaignPlanner.svelte',
			'src/lib/components/feed/PostDrawer.svelte',
			'src/lib/components/agents/AgentRoster.svelte',
			'src/routes/(portal)/personas/[agentId]/+page.svelte'
		];
		for (const f of mustQuote) {
			const src = readFileSync(f, 'utf8');
			expect(src, `${f} must import quote() from the pricing store`).toMatch(
				/from '\$lib\/stores\/pricing\.svelte'/
			);
		}
	});
});
