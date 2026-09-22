/**
 * The client half of the plan gates.
 *
 * Six server routes refuse a feature with 403 PLAN_FEATURE. For months no
 * client read any of them, so a gated plan produced a refusal on a control that
 * still looked enabled — which reads as a bug, not a plan limit. These bind the
 * surfacing so it cannot quietly come undone.
 *
 * The second half matters more than the first. Every one of those routes gates
 * NARROWLY — only a raise, only a create, only a save, only four of six
 * providers — and a client that gates more broadly than its server breaks
 * working features for people who are entitled to them. Most of what follows
 * asserts what must NOT be disabled.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BYOK_GATED_KEY_PROVIDERS, byokReason, isByokGated, providerByKeyProvider } from '$lib/providers';

const read = (...p: string[]) => readFileSync(new URL(`../../${p.join('/')}`, import.meta.url), 'utf-8');

const files = {
	layout: read('routes', '(portal)', '+layout.server.ts'),
	personas: read('routes', '(portal)', 'personas', '[agentId]', '+page.svelte'),
	settings: read('routes', '(portal)', 'settings', '+page.svelte'),
	developer: read('routes', '(portal)', 'developer', '+page.svelte'),
	brief: read('routes', '(portal)', 'brand-brief', '+page.svelte'),
	composer: read('lib', 'components', 'generation', 'GenerationComposer.svelte'),
	calendar: read('routes', '(portal)', 'calendar', '+page.svelte')
};

describe('the files under test were actually read', () => {
	it.each(Object.entries(files))('%s is non-empty', (_name, src) => {
		expect(src.length).toBeGreaterThan(400);
	});
});

describe('entitlements reach the client at all', () => {
	it('the portal layout resolves them once for every page', () => {
		expect(files.layout).toContain('entitlementsFor(user.id)');
		expect(files.layout).toMatch(/\bentitlements,/);
	});

	it('both never-brick paths return a PERMISSIVE default', () => {
		// The placeholder-config return and the catch. An unreadable plan must not
		// lock the UI down — a database blip is not a downgrade.
		const fallbacks = files.layout.split('...UNRESTRICTED').length - 1;
		expect(fallbacks, 'every fallback return needs a permissive entitlements object').toBe(2);
	});
});

describe('each gated control reads its own entitlement', () => {
	it.each([
		['autonomy ceiling', files.personas, 'maxAutonomy'],
		['cinematic (composer host)', files.personas, 'entitlements?.cinematic'],
		['cinematic (calendar host)', files.calendar, 'entitlements?.cinematic'],
		['API access', files.developer, 'apiAccess'],
		['teams', files.settings, 'teams'],
		['BYOK', files.settings, 'byok'],
		['brand-brief limit', files.brief, 'brandBriefLimit']
	])('%s', (_label, src, needle) => {
		expect(src).toContain(needle);
	});

	it('a control is disabled only when the entitlement is explicitly false', () => {
		// `!ent.teams` would also fire on undefined — an unreadable plan would
		// disable the product. Every gate reads `=== false` or a null-limit check.
		for (const src of [files.developer, files.settings, files.personas, files.calendar]) {
			expect(src).not.toMatch(/disabled=\{[^}]*!data\.entitlements\.\w/);
		}
	});
});

describe('the autonomy gate mirrors the server: only a RAISE is refused', () => {
	it('it compares against the SAVED level, not just the ceiling', () => {
		// saveProfile() sends autonomyLevel on every save, including saves that
		// touch none of it. Without this comparison a persona already above a
		// tightened ceiling could never be edited again.
		expect(files.personas).toContain('savedAutonomy');
		expect(files.personas).toMatch(/AUTONOMY_RANK\[level\] <= AUTONOMY_RANK\[savedAutonomy\]/);
	});

	it('the select itself is never disabled — you can always drop DOWN', () => {
		const select = files.personas.slice(
			files.personas.indexOf('id="p-autonomy"') - 200,
			files.personas.indexOf('id="p-autonomy"') + 200
		);
		expect(select).not.toMatch(/<select[^>]*id="p-autonomy"[^>]*disabled/);
	});
});

describe('what must NEVER be gated', () => {
	it('API keys can still be listed and revoked on any plan', () => {
		// "so a plan change never strands a key the user cannot see or turn off"
		expect(files.developer).toContain('revokeKey');
		expect(files.developer).not.toMatch(/revokeKey[\s\S]{0,400}createKeyBlockedReason/);
	});

	it('the publishing and research keys are never gated', () => {
		// Zernio is how every plan publishes; Firecrawl is how briefs are
		// researched. Both are promised to Free.
		//
		// This used to regex a BYOK_GATED_PROVIDERS literal out of the settings
		// page. That literal is gone — the page now derives the list from the
		// provider catalogue — and a test that greps for a vanished literal
		// reports an empty string and passes on nothing. Assert the real values.
		//
		// Since 2026-09-21 the gated list is EMPTY, so the non-empty guard above
		// was removed rather than relaxed: it would now fail on the intended
		// state. The claim this test exists to protect is unchanged and is
		// asserted directly — Zernio and Firecrawl must never be gated — and
		// providers.spec.ts pins the emptiness itself, with the reason.
		expect(BYOK_GATED_KEY_PROVIDERS).not.toContain('zernio');
		expect(BYOK_GATED_KEY_PROVIDERS).not.toContain('firecrawl');
		expect(isByokGated('zernio')).toBe(false);
		// Zernio is still the one key a customer may bring, so its field is real.
		expect(byokReason(providerByKeyProvider('zernio')!)).toBeNull();
		// and the page really does derive rather than restate
		expect(files.settings).toContain('isByokGated(');
	});

	it('the brand-brief SAVE button is not gated — only creating a new one', () => {
		// saveAll() has ~10 call sites and most are autosaves on an existing
		// brief, which the server deliberately leaves open.
		expect(files.brief).toContain('newBriefBlockedReason');
		expect(files.brief).not.toMatch(/onclick=\{\(e\) => saveAll\(e\)\}[^>]*disabled=\{[^}]*Blocked/);
	});
});

describe('a plan refusal is not offered as something to retry', () => {
	it('the composer swaps Retry for a route to Billing on PLAN_FEATURE', () => {
		// The cinematic gate runs BEFORE the preview branch, so a cinematic
		// template used to resolve into "Can't prepare this generation" with a
		// Retry button that could never succeed.
		expect(files.composer).toContain("data?.code === 'PLAN_FEATURE'");
		expect(files.composer).toContain('loadBlockedByPlan');
		expect(files.composer).toMatch(/loadBlockedByPlan[\s\S]{0,200}href="\/billing"/);
	});

	it('the brand-brief page stops reporting a refusal as a sync failure', () => {
		// It showed "Saved locally — cloud sync failed" for EVERY failure and threw
		// the server's message away.
		expect(files.brief).toMatch(/TRANSPORT_FAILURE/);
		expect(files.brief).toMatch(/showToast\(message, 'error'\)/);
	});
});
