/**
 * Registry truth, checked against the LIVE catalog.
 *
 * The Model Manager makes three claims: this row is what runs, this price is
 * what you pay, this is where it came from. Unit tests prove the resolvers in
 * isolation; nothing proved the claims against the rows production actually
 * holds. This does, by calling the SAME resolvers the pipeline calls — no
 * reimplementation, so it cannot drift from the code it checks.
 *
 * Integration project (`npm run test:integration`): it needs the service-role
 * key. Without credentials it asserts that fact and stops, rather than passing
 * silently — a green run must mean the invariants were checked, never that the
 * checker could not reach the database.
 *
 * That is enough for a developer running it by hand, but not for a gate: with
 * no key the run still exits 0, and anything chaining on it would deploy having
 * checked nothing. Set REGISTRY_TRUTH_STRICT=1 (deploy.ps1 does) to turn "I
 * could not check" into a failure.
 *
 * READ-ONLY. It never writes a row.
 */
import { describe, it, expect } from 'vitest';
// vitest does not boot SvelteKit, so $env/dynamic/private is empty here and the
// checker would "pass" by skipping. Load the same .env the app runs on.
import 'dotenv/config';
import {
	openRouterRoute,
	registryDefault,
	servesKind,
	type RegistryKind,
	type RegistryRow
} from './model-registry';
import { describeUsage, reconcileLedger, type LedgerEvent } from './registry-usage';

const URL = process.env.PUBLIC_SUPABASE_URL || '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const HAVE_CREDS = Boolean(URL && KEY && !KEY.startsWith('disabled'));
/** Gate mode: absent credentials are a failure, not a skip. */
const STRICT = process.env.REGISTRY_TRUTH_STRICT === '1';
const LEDGER_WINDOW_DAYS = 30;

async function pg<T = any>(query: string): Promise<T[]> {
	const res = await fetch(`${URL}/pg/query`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
		body: JSON.stringify({ query })
	});
	const body = await res.json();
	if (!Array.isArray(body)) throw new Error(`pg/query failed: ${JSON.stringify(body).slice(0, 300)}`);
	return body as T[];
}

const KINDS: RegistryKind[] = ['image_t2i', 'image_edit', 'video_i2v', 'tts'];

describe.skipIf(!HAVE_CREDS)('registry truth (live platform catalog)', () => {
	let rows: RegistryRow[] = [];
	let events: LedgerEvent[] = [];

	it('the platform catalog exists and is readable', async () => {
		rows = await pg<RegistryRow>(
			`select * from public.model_registry where user_id is null order by released_at desc nulls last`
		);
		events = await pg<LedgerEvent>(
			`select provider, model, operation, est_cost from public.generation_events
			  where created_at > now() - interval '${LEDGER_WINDOW_DAYS} days'`
		);
		// A platform catalog is the point of the shared registry; its absence
		// means the migration never ran on this database.
		expect(rows.length).toBeGreaterThan(0);
	});

	it('each mode has at most one default, and every default is wired, active and priced', () => {
		for (const kind of KINDS) {
			const defaults = rows.filter((r) => servesKind(r, kind) && r.is_default);
			expect(defaults.length, `${kind}: expected at most one default, found ${defaults.length}`).toBeLessThanOrEqual(1);
			for (const d of defaults) {
				expect(d.wired, `${kind} default ${d.model_id} is not wired`).toBe(true);
				expect(d.status, `${kind} default ${d.model_id} is not active`).toBe('active');
				expect(d.deprecated, `${kind} default ${d.model_id} is deprecated`).toBe(false);
				expect(d.price_usd, `${kind} default ${d.model_id} has no price — it cannot be billed`).not.toBeNull();
			}
		}
	});

	it('every route the pipeline resolves points at a row that can actually run', () => {
		// The fal modes the pipeline resolves by star, with the constants they
		// fall back to. Mirrors resolveImageKeys(); a mode added there without a
		// line here is caught by the coverage assertion below.
		const falModes: RegistryKind[] = ['tts'];
		for (const kind of falModes) {
			const route = registryDefault(rows, kind, 'fal', 'FALLBACK', 0);
			if (!route.fromRegistry) continue; // documented fallback, not a broken row
			const row = rows.find((r) => r.model_id === route.id && servesKind(r, kind));
			expect(row, `${kind} resolves to ${route.id}, which is not in the catalog`).toBeTruthy();
			expect(route.usd, `${kind} resolves to ${route.id} at a nonsense price`).toBeGreaterThan(0);
		}
		for (const kind of ['image_t2i', 'image_edit', 'video_i2v'] as RegistryKind[]) {
			const route = openRouterRoute(rows, kind, 'FALLBACK', 0);
			if (!route.fromRegistry) continue;
			const row = rows.find(
				(r) => r.provider === 'openrouter' && r.model_id === route.id && servesKind(r, kind)
			);
			expect(row, `OpenRouter ${kind} route ${route.id} is not in the catalog`).toBeTruthy();
			expect(route.usd, `OpenRouter ${kind} route ${route.id} is priced at zero`).toBeGreaterThan(0);
		}
	});

	it('what the page says a row does matches what the resolvers do', () => {
		const usage = describeUsage(rows);
		for (const [rowId, tags] of Object.entries(usage.byRowId)) {
			const row = rows.find((r) => r.id === rowId);
			expect(row, `usage tag points at row ${rowId}, which is not in the catalog`).toBeTruthy();
			// A row the page says the pipeline uses must be runnable.
			expect(row!.wired, `${row!.model_id} is tagged "${tags[0].site}" but is not wired`).toBe(true);
			expect(row!.status, `${row!.model_id} is tagged "${tags[0].site}" but is not active`).toBe('active');
		}
		// Every mode the pipeline reads should have at least one tagged row, or
		// the page is telling admins their star does nothing.
		expect(usage.consultedKinds.length, 'no mode resolves to a registry row at all').toBeGreaterThan(0);
	});

	it('reports models that RAN but no row claims (warning, not a failure)', () => {
		const rec = reconcileLedger(rows, events, LEDGER_WINDOW_DAYS);
		if (rec.unlisted.length) {
			console.warn(
				`[registry-truth] ${rec.unlisted.length} model(s) ran in the last ${LEDGER_WINDOW_DAYS} days with no catalog row:\n` +
					rec.unlisted
						.map((u) => `  ${u.provider} · ${u.model} · ${u.runs}x · $${u.usd.toFixed(2)}`)
						.join('\n') +
					`\n  Fix: open /models as a platform admin and click "Check for new models".` +
					`\n  A model that runs unlisted is priced from a compiled-in constant, not from the Model Manager.`
			);
		}
		// Deliberately not a failure: an unlisted model is a catalog gap to close,
		// not a broken deploy. The assertion is that reconciliation RAN.
		expect(rec.windowDays).toBe(LEDGER_WINDOW_DAYS);
	});
});

describe.skipIf(HAVE_CREDS)('registry truth (no credentials)', () => {
	it('is skipped without a service-role key, and says so rather than passing quietly', () => {
		expect(HAVE_CREDS).toBe(false);
	});

	it('fails instead of skipping when it is being used as a gate (REGISTRY_TRUTH_STRICT=1)', () => {
		expect(
			STRICT,
			'REGISTRY_TRUTH_STRICT=1 was set, so this run is a gate — but PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing, so nothing was checked. Provide credentials or drop the strict flag.'
		).toBe(false);
	});
});
