/**
 * The provider catalogue is now the ONE description of "which providers exist
 * and what can a user do with each". Four places used to restate it (the
 * cost→key map in credits.ts, the gated list in the Settings page, the same
 * list again in the api-keys route, and the CHECK enum in the database) and
 * nothing bound them together.
 *
 * This file is the binding, and the first half is the regression net: the
 * DERIVED values must equal the literal lists exactly as they stood before the
 * refactor, so "behaviour did not change for any provider that exists today"
 * is a checked claim rather than a promise.
 *
 * The second half is what the catalogue buys: a provider that can never be
 * BYOK'd carries a REASON, not an absence, and the database enum is read out of
 * the SQL rather than copied, so widening it without a catalogue entry fails
 * here instead of at runtime.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMockSupabase } from '../tests/mock-supabase';
import {
	PROVIDER_CATALOGUE,
	KEYED_COST_PROVIDERS,
	BYOK_GATED_KEY_PROVIDERS,
	NON_BYOK_PROVIDERS,
	USER_KEY_PROVIDERS,
	byokReason,
	isByokGated,
	providerById,
	providerByKeyProvider
} from '$lib/providers';
import { PRICING_MATRIX } from '$lib/pricing';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('./service-supabase', () => ({
	getServiceSupabase: () => {
		throw new Error('no service key in tests');
	}
}));

const credits = await import('./credits');
const userKeys = await import('./user-api-keys');

const read = (...p: string[]) => readFileSync(new URL(`../../${p.join('/')}`, import.meta.url), 'utf-8');

const sources = {
	bootstrapSql: readFileSync(new URL('../../../supabase/client_bootstrap.sql', import.meta.url), 'utf-8'),
	providers: read('lib', 'providers.ts'),
	credits: read('lib', 'server', 'credits.ts'),
	apiKeysRoute: read('routes', 'api', 'settings', 'api-keys', '+server.ts'),
	settingsPage: read('routes', '(portal)', 'settings', '+page.svelte')
};

/**
 * The literals as they stood before the catalogue existed. Nothing derives
 * from these — they are frozen copies of the old code, which is the only way
 * they can catch a change in the new code.
 */
const BEFORE = {
	/** credits.ts:46-51 */
	keyedProviders: { fal: 'fal_ai', openrouter: 'openrouter', gemini: 'gemini', firecrawl: 'firecrawl' },
	/** settings/+page.svelte:1079 and api-keys/+server.ts:129 (identical by hand) */
	byokGated: ['openrouter', 'gemini', 'fal_ai', 'kie_ai']
};

describe('the files under test were actually read', () => {
	it.each(Object.entries(sources))('%s is non-empty', (_name, src) => {
		expect(src.length).toBeGreaterThan(400);
	});
});

describe('the regression net — the derived lists equal the literals they replaced', () => {
	it('KEYED_COST_PROVIDERS is exactly the old credits.ts map', () => {
		// Same keys, same values, same size — an extra entry is a provider that
		// silently started billing a user key; a missing one is spend we stopped
		// attributing (and therefore started eating).
		expect({ ...KEYED_COST_PROVIDERS }).toEqual(BEFORE.keyedProviders);
	});

	it('the entitlement-gated list is exactly the old four', () => {
		// Order never mattered (both call sites used .includes), membership always did.
		expect([...BYOK_GATED_KEY_PROVIDERS].sort()).toEqual([...BEFORE.byokGated].sort());
	});

	it('publishing and research are STILL never gated', () => {
		// Zernio is how every plan publishes, Firecrawl is how briefs are
		// researched. Both are promised to Free; gating either breaks a feature
		// someone paying nothing was told they had.
		expect(isByokGated('zernio')).toBe(false);
		expect(isByokGated('firecrawl')).toBe(false);
		expect(isByokGated('openrouter')).toBe(true);
		expect(isByokGated('gemini')).toBe(true);
		expect(isByokGated('fal_ai')).toBe(true);
		expect(isByokGated('kie_ai')).toBe(true);
	});

	it('the catalogue covers every provider a key can be stored for, and no more', () => {
		expect([...USER_KEY_PROVIDERS].sort()).toEqual([...userKeys.SUPPORTED_USER_KEY_PROVIDERS].sort());
	});
});

describe('keySourceFor resolves identically for every provider it resolves today', () => {
	/** Every cost-event provider name the ledger can carry, and what it must resolve to. */
	const CASES: Array<[string, 'platform' | 'none']> = [
		['fal', 'platform'],
		['openrouter', 'platform'],
		['gemini', 'platform'],
		['firecrawl', 'platform'],
		// keyed by nothing: no user key is ever charged for these
		['zernio', 'none'],
		['kie_ai', 'none'],
		['local', 'none'],
		['storage', 'none'],
		['higgsfield', 'none']
	];

	it.each(CASES)('%s with no stored key → %s', async (provider, want) => {
		const sb = createMockSupabase(() => ({ data: null }));
		expect(await credits.keySourceFor(sb, 'u1', provider)).toBe(want);
	});

	it('a keyed provider with no key never even queries the key store', async () => {
		const sb = createMockSupabase(() => ({ data: null }));
		await credits.keySourceFor(sb, 'u1', 'zernio');
		await credits.keySourceFor(sb, 'u1', 'higgsfield');
		expect(sb.queries).toHaveLength(0);
	});

	it.each(Object.entries(BEFORE.keyedProviders))(
		'%s still looks the key up under the %s row, and a usable one is byo',
		async (costProvider, keyProvider) => {
			mockEnv.USER_SECRETS_ENCRYPTION_KEY = 'x'.repeat(32);
			const row = { provider: keyProvider, ...userKeys.encryptSecret('sk-user-key') };
			const sb = createMockSupabase((q) =>
				q.table === 'user_api_keys' && q.eqOf('provider') === keyProvider ? { data: row } : { data: null }
			);
			expect(await credits.keySourceFor(sb, 'u1', costProvider)).toBe('byo');
			delete mockEnv.USER_SECRETS_ENCRYPTION_KEY;
		}
	);
});

describe('every catalogue entry names a real key row, or declares it stores none', () => {
	/**
	 * Parsed, never copied. client_bootstrap.sql widens the constraint more than
	 * once (08 creates it, 09 and 10 re-add it), so the EFFECTIVE enum is the
	 * last one the script applies — which is also the one the live table has.
	 */
	function effectiveKeyProviderEnum(sql: string): string[] {
		const stmts = sql.split(/;\s*\n/);
		let last: string[] | null = null;
		for (const s of stmts) {
			if (!/user_api_keys/.test(s) || !/provider\s+TEXT|user_api_keys_provider_check/i.test(s)) continue;
			const m = s.match(/CHECK\s*\(\s*provider\s+IN\s*\(([^)]*)\)/i);
			if (!m) continue;
			last = m[1]
				.split(',')
				.map((v) => v.trim().replace(/^'|'$/g, ''))
				.filter(Boolean);
		}
		return last ?? [];
	}

	const enumValues = effectiveKeyProviderEnum(sources.bootstrapSql);

	it('the CHECK enum was actually parsed out of the SQL', () => {
		// A regex that quietly matched nothing would make every assertion below
		// vacuous, so the parse is asserted before it is used.
		expect(sources.bootstrapSql.length).toBeGreaterThan(400);
		expect(enumValues.length).toBeGreaterThanOrEqual(6);
		expect(enumValues).toContain('zernio');
		expect(enumValues).toContain('fal_ai');
	});

	it.each(PROVIDER_CATALOGUE.map((p) => [p.id, p] as const))(
		'%s stores its key under a value the database accepts',
		(_id, entry) => {
			if (entry.keyProvider === null) {
				// Nothing to store — and then nothing may be billed to a key either.
				expect(entry.billsToUserKey).toBe(false);
				return;
			}
			expect(enumValues).toContain(entry.keyProvider);
		}
	);

	it('a provider that bills a user key also names the row that key lives in', () => {
		for (const p of PROVIDER_CATALOGUE) {
			if (!p.billsToUserKey) continue;
			expect(p.keyProvider, `${p.id} bills a user key`).not.toBeNull();
			expect(p.costProvider, `${p.id} bills a user key`).not.toBeNull();
		}
		expect(PROVIDER_CATALOGUE.filter((p) => p.billsToUserKey)).toHaveLength(4);
	});

	it('every cost-event name the catalogue claims is priced in pricing.ts', () => {
		const priced = new Set(PRICING_MATRIX.map((p) => p.provider as string));
		const named = PROVIDER_CATALOGUE.flatMap((p) => (p.costProvider ? [p.costProvider] : []));
		expect(named.length).toBeGreaterThan(0);
		for (const c of named) expect(priced, `${c} has no price row`).toContain(c);
	});

	it('ids and key rows are unique, and a lookup finds what it should', () => {
		expect(new Set(PROVIDER_CATALOGUE.map((p) => p.id)).size).toBe(PROVIDER_CATALOGUE.length);
		expect(new Set(USER_KEY_PROVIDERS).size).toBe(USER_KEY_PROVIDERS.length);
		expect(providerById('fal_ai')?.costProvider).toBe('fal');
		expect(providerByKeyProvider('fal_ai')?.id).toBe('fal_ai');
		expect(providerById('nope')).toBeNull();
		expect(providerByKeyProvider('nope')).toBeNull();
	});
});

describe('a provider that cannot be BYOK’d explains itself instead of going missing', () => {
	it('the case is exercised, not theoretical', () => {
		expect(NON_BYOK_PROVIDERS.length).toBeGreaterThan(0);
		expect(NON_BYOK_PROVIDERS.map((p) => p.id)).toContain('higgsfield');
	});

	it.each(NON_BYOK_PROVIDERS.map((p) => [p.id, p] as const))('%s carries a user-facing reason', (_id, p) => {
		const reason = byokReason(p);
		expect(reason, 'a refusal with no reason is the absence we are replacing').toBeTruthy();
		expect(String(reason).length).toBeGreaterThan(30);
		expect(String(reason)).toMatch(/\.$/);
	});

	it.each(NON_BYOK_PROVIDERS.map((p) => [p.id, p] as const))(
		'%s is absent from every list that would key, gate or bill it',
		(id, p) => {
			expect(p.keyProvider).toBeNull();
			expect(p.billsToUserKey).toBe(false);
			expect(USER_KEY_PROVIDERS as readonly string[]).not.toContain(id);
			expect(BYOK_GATED_KEY_PROVIDERS as readonly string[]).not.toContain(id);
			expect(Object.keys(KEYED_COST_PROVIDERS)).not.toContain(id);
			expect(userKeys.isSupportedProvider(id)).toBe(false);
		}
	);

	it('a BYOK-supported provider never carries a reason', () => {
		const supported = PROVIDER_CATALOGUE.filter((p) => p.byok.supported);
		expect(supported.length).toBeGreaterThan(0);
		for (const p of supported) expect(byokReason(p)).toBeNull();
	});
});

describe('the consumers derive instead of restating', () => {
	it('credits.ts reads the catalogue and holds no cost→key map of its own', () => {
		expect(sources.credits).toContain("from '$lib/providers'");
		expect(sources.credits).toContain('KEYED_COST_PROVIDERS[provider]');
		expect(sources.credits).not.toMatch(/fal:\s*'fal_ai'/);
	});

	it('the api-keys route gates from the catalogue', () => {
		expect(sources.apiKeysRoute).toContain("from '$lib/providers'");
		expect(sources.apiKeysRoute).toContain('isByokGated(provider)');
		expect(sources.apiKeysRoute).not.toMatch(/GENERATION_PROVIDERS\s*=\s*\[/);
	});

	it('the Settings page gates from the catalogue and renders the refusal', () => {
		expect(sources.settingsPage).toContain("from '$lib/providers'");
		expect(sources.settingsPage).toContain('isByokGated(provider)');
		expect(sources.settingsPage).not.toMatch(/BYOK_GATED_PROVIDERS\s*=\s*\[/);
		// The reason has to be on screen where the key field would have been.
		expect(sources.settingsPage).toContain('NON_BYOK_PROVIDERS');
		expect(sources.settingsPage).toContain('byokReason(p)');
	});

	it('the catalogue stays client-safe — the Settings page imports it', () => {
		// pricing.ts is the precedent: a shared module both halves read. One
		// server-only import here would break the client build outright.
		// Checked on the IMPORT SPECIFIERS, not on the prose: the file's own
		// header names `$env/server` as the thing it must not import, and a naive
		// substring match would fail on the documentation that says so.
		const specifiers = [...sources.providers.matchAll(/\bfrom\s+'([^']+)'/g)].map((m) => m[1]);
		for (const s of specifiers) {
			expect(s, `${s} is not reachable from the browser`).not.toMatch(
				/^(\$env\/|\$lib\/server\/|node:|\.\/|\.\.\/)/
			);
		}
		// pricing.ts, the precedent, imports nothing at all; if that ever changes
		// the loop above still holds the line, so assert the scan itself ran.
		expect(Array.isArray(specifiers)).toBe(true);
	});
});
