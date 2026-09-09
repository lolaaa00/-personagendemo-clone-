import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PLAN_FALLBACK } from './plans';
import { entitlementsFromRow, atLeast, planRank, UNRESTRICTED, type Entitlements } from './entitlements';

const src = (...p: string[]) => readFileSync(new URL(`../../${p.join('/')}`, import.meta.url), 'utf-8');
const ent = (plan: string): Entitlements =>
	entitlementsFromRow(PLAN_FALLBACK.find((p) => p.plan === plan) ?? null, plan);

/**
 * Every feature line the catalog sells, and the line of code that makes it
 * true. A new feature string with no entry here fails this file — which is the
 * point: the previous nine were sold for months with nothing behind them.
 */
const PROMISES: Array<{
	match: RegExp;
	gate?: { file: string[]; needle: string };
	universal?: string;
}> = [
	{ match: /personas?$/, gate: { file: ['routes', 'api', 'agents', '+server.ts'], needle: 'personaLimitExceeded' } },
	{ match: /month of media generation included/, gate: { file: ['routes', 'api', 'billing', 'webhook', '+server.ts'], needle: 'includedResetClawback' } },
	{ match: /brand briefs?$/, gate: { file: ['routes', 'api', 'engine', '+server.ts'], needle: 'brandBriefLimit' } },
	{ match: /Advisor \+ Semi-autonomous|All three autonomy levels/, gate: { file: ['routes', 'api', 'agents', 'config', '+server.ts'], needle: 'maxAutonomy' } },
	{ match: /Standard video \+ lip-sync|Cinematic multi-shot \+ talking head/, gate: { file: ['routes', 'api', 'agent', '[agentId]', 'generate-post', '+server.ts'], needle: 'ent.cinematic' } },
	{ match: /Priority generation queue/, gate: { file: ['lib', 'server', 'autopilot.ts'], needle: 'orderByPlanPriority' } },
	{ match: /Teams \+ shared workspaces/, gate: { file: ['routes', 'api', 'workspaces', '+server.ts'], needle: 'ent.teams' } },
	{ match: /Bring your own keys/, gate: { file: ['routes', 'api', 'settings', 'api-keys', '+server.ts'], needle: 'ent.byok' } },
	{ match: /API access/, gate: { file: ['routes', 'api', 'developer', 'keys', '+server.ts'], needle: 'ent.apiAccess' } },
	{ match: /free credit per person to start/, gate: { file: ['lib', 'server', 'welcome-guard.ts'], needle: 'maybeWithholdWelcome' } },
	{ match: /Unlimited text posts/, universal: 'text costs only its writing; no plan restricts it' },
	{ match: /All 13 platforms/, universal: 'publishing is on every plan, including free' },
	{ match: /Spend ledger \+ verified publishing/, universal: 'the ledger and publish receipts are shown to every plan — listing it only under Brand overstates it, a copy decision, not a gate' },
	{ match: /Approval queue/, universal: 'review/approve is how every persona below fully-autonomous works — same overstatement' }
];

describe('plan copy — every feature line has a line of code', () => {
	const allFeatures = [...new Set(PLAN_FALLBACK.flatMap((p) => p.features))];

	it.each(allFeatures)('"%s" is accounted for', (feature) => {
		const hits = PROMISES.filter((p) => p.match.test(feature));
		expect(hits.length, `no entry in PROMISES matches "${feature}" — add the gate, or record why it needs none`).toBe(1);
	});

	it.each(PROMISES.filter((p) => p.gate).map((p) => [String(p.match), p.gate!] as const))(
		'%s is still enforced',
		(_label, gate) => {
			expect(src(...gate.file)).toContain(gate.needle);
		}
	);
});

describe('entitlements — absent means allowed', () => {
	it('an empty object restricts nothing', () => {
		const e = entitlementsFromRow({ plan: 'x', name: 'X', price_usd_cents: 0, included_credits: 0, persona_limit: null, brand_brief_limit: null, features: [], sort: 0, active: true, entitlements: {} }, 'x');
		expect(e).toMatchObject(UNRESTRICTED);
	});

	it('a row from an unmigrated database restricts nothing', () => {
		expect(entitlementsFromRow(null, 'free')).toMatchObject(UNRESTRICTED);
	});

	it('junk in the column is ignored rather than obeyed', () => {
		const e = entitlementsFromRow({ plan: 'x', name: 'X', price_usd_cents: 0, included_credits: 0, persona_limit: null, brand_brief_limit: null, features: [], sort: 0, active: true, entitlements: { max_autonomy: 'wizard', teams: 'yes' } as Record<string, unknown> }, 'x');
		expect(e.maxAutonomy).toBe('fully_autonomous');
		expect(e.teams).toBe(true);
	});
});

describe('entitlements — the seeded catalog says what the copy says', () => {
	it('Studio stops at semi-autonomous, Brand does not', () => {
		expect(ent('studio').maxAutonomy).toBe('semi_autonomous');
		expect(ent('brand').maxAutonomy).toBe('fully_autonomous');
	});

	it('cinematic is Brand and up', () => {
		expect(ent('studio').cinematic).toBe(false);
		expect(ent('brand').cinematic).toBe(true);
	});

	it('teams, API and BYOK are Agency alone', () => {
		for (const k of ['teams', 'apiAccess', 'byok'] as const) {
			expect(ent('studio')[k], k).toBe(false);
			expect(ent('brand')[k], k).toBe(false);
			expect(ent('agency')[k], k).toBe(true);
		}
	});

	it('only Agency is served first', () => {
		expect(ent('agency').priority).toBe(true);
		expect(ent('brand').priority).toBe(false);
		expect(planRank('agency')).toBeGreaterThan(planRank('brand'));
		expect(planRank('brand')).toBeGreaterThan(planRank('free'));
		expect(planRank(undefined)).toBe(0);
	});
});

describe('entitlements — nobody can be made worse off', () => {
	it('free is unrestricted today, so every gate is inert', () => {
		// This is what makes shipping the gates safe: all nine live accounts are
		// on free. Tightening free is the launch-day edit, quoted in the migration.
		expect(ent('free')).toMatchObject(UNRESTRICTED);
	});

	it('a paid plan is never resolved below free', () => {
		const free = ent('free');
		for (const plan of ['studio', 'brand', 'agency']) {
			const e = atLeast(ent(plan), free);
			expect(e.maxAutonomy, plan).toBe(free.maxAutonomy);
			expect(e.cinematic, plan).toBe(true);
			expect(e.teams, plan).toBe(true);
			expect(e.apiAccess, plan).toBe(true);
			expect(e.byok, plan).toBe(true);
		}
	});

	it('unlimited beats any number, whichever side it is on', () => {
		const a = { ...ent('studio'), personaLimit: 3 };
		const b = { ...ent('agency'), personaLimit: null };
		expect(atLeast(a, b).personaLimit).toBeNull();
		expect(atLeast(b, a).personaLimit).toBeNull();
		expect(atLeast({ ...a, personaLimit: 3 }, { ...b, personaLimit: 10 }).personaLimit).toBe(10);
	});

	it('priority does not float up from free', () => {
		expect(atLeast(ent('brand'), ent('free')).priority).toBe(false);
		expect(atLeast(ent('agency'), ent('free')).priority).toBe(true);
	});
});
