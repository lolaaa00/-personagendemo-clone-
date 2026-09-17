/**
 * Disposable verification account for driving `(portal)/**` routes.
 *
 *   node scripts/verify-seed.mjs create    # make the user + fixtures, print creds
 *   node scripts/verify-seed.mjs destroy   # remove the user and everything it owns
 *
 * Every portal route redirects to /login, so a browser-driven verification needs
 * a real session. This creates ONE throwaway user (fixed address, so re-running
 * `create` recycles it) with enough data to exercise posts, reference photos,
 * personas, products and competitors — then `destroy` removes it again.
 *
 * ⚠️ Supabase here is the LIVE self-hosted instance, not a local container.
 * Always run `destroy` when you finish. Never point verification at a real
 * user's account: drive destructive flows (delete, bulk delete) against THIS
 * account only.
 *
 * Reads PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env, so run it
 * BEFORE scrubbing the server-side secrets for the scheduler (see SKILL.md).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = (() => {
	const out = {};
	try {
		for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
			const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
			if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
		}
	} catch {
		/* fall through to process.env */
	}
	return { ...out, ...process.env };
})();

const SB_URL = env.PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
	console.error('Missing PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env or environment).');
	process.exit(1);
}

const EMAIL = 'verify-harness@personagen.test';
const PASSWORD = 'VerifyHarness!2026';

/**
 * ONE user, deliberately. Per-role verification — every seat, a platform admin,
 * and a brand-new empty account, each with realistic fixtures — lives in
 * `scripts/ux/audit-tenant.mjs` (`create|status|destroy|reset`). This script
 * stayed the lean, single-owner harness the verify skill documents, because a
 * fast UI check should not mint five auth users on the live instance every run.
 * The seat addresses below exist only so `destroy` can sweep any left behind by
 * an earlier version of this script that did.
 */
const SEATS = ['admin', 'manager', 'creator', 'viewer'];
const seatEmail = (role) => `verify-${role}@personagen.test`;
// Distinct widths ⇒ distinct URLs. The persona Assets grid de-dupes by URL, so
// reusing one image collapses every fixture into a single tile.
const IMG = (w) =>
	`https://akhuapothecary.com/cdn/shop/files/SMALL_PNG.png?v=1737485656&width=${w}`;

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
const api = (path, init) => fetch(`${SB_URL}${path}`, { ...init, headers: { ...H, ...init?.headers } });

async function listUsers() {
	const res = await api('/auth/v1/admin/users?per_page=200');
	const body = await res.json();
	return body.users || [];
}


/** Creates a confirmed user, or returns the existing one at that address. */
async function makeUser(email, password, fullName) {
	const res = await api('/auth/v1/admin/users', {
		method: 'POST',
		body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: fullName } })
	});
	const body = await res.json();
	if (body.id) return body.id;
	const existing = (await listUsers()).find((u) => u.email === email);
	if (existing) return existing.id;
	console.error(`user create failed for ${email}:`, JSON.stringify(body).slice(0, 300));
	process.exit(1);
}

async function destroy(quiet = false) {
	// Seat users own no rows — their access is a membership row that cascades
	// with the workspace — so they are removed first and unconditionally, even
	// when the owner is already gone. Leaving them behind would let a later
	// `create` collide on a duplicate address.
	const all = await listUsers();
	for (const seat of SEATS) {
		const u = all.find((x) => x.email === seatEmail(seat));
		if (u) await api(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
	}
	const user = all.find((u) => u.email === EMAIL) || null;
	if (!user) {
		if (!quiet) console.log('nothing to destroy');
		return;
	}
	await api(`/rest/v1/workspaces?owner_id=eq.${user.id}`, { method: 'DELETE' });
	// agent_configs / connections / posts cascade off agents in the app's own
	// delete path, but a raw teardown has to sweep them explicitly.
	for (const table of ['posts', 'brand_briefs', 'agent_configs', 'connections', 'agents']) {
		await api(`/rest/v1/${table}?user_id=eq.${user.id}`, { method: 'DELETE' });
	}
	await api(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
	if (!quiet) console.log('destroyed', user.id);
}

async function insert(table, rows) {
	const res = await api(`/rest/v1/${table}`, {
		method: 'POST',
		headers: { Prefer: 'return=representation' },
		body: JSON.stringify(rows)
	});
	const body = await res.json();
	if (!Array.isArray(body)) {
		console.error(`${table} insert failed:`, JSON.stringify(body).slice(0, 300));
		process.exit(1);
	}
	return body;
}

async function create() {
	await destroy(true);

	const userId = await makeUser(EMAIL, PASSWORD, 'Verify Harness');

	// One workspace, owned by the harness user, holding every seeded persona.
	// Without it there is nothing for a membership row to point at, so the four
	// seat logins below would authenticate into an empty portal and every
	// permission check would pass for the wrong reason.
	const [workspace] = await insert('workspaces', [
		{ owner_id: userId, name: 'Harness Workspace' }
	]);

	// NOTE: `agents` has no `bio`/`platform` column — inserting them fails with
	// PGRST204 "Could not find the 'bio' column".
	const agents = await insert('agents', [
		{ user_id: userId, workspace_id: workspace.id, name: 'Harness Persona A', niche: 'wellness', handle: 'harness_a', status: 'active', market: '{}', initial: 'A' },
		{ user_id: userId, workspace_id: workspace.id, name: 'Harness Persona B', niche: 'wellness', handle: 'harness_b', status: 'active', market: '{}', initial: 'B' },
		{ user_id: userId, workspace_id: workspace.id, name: 'Harness Persona C', niche: 'fitness', handle: 'harness_c', status: 'paused', market: '{}', initial: 'C' }
	]);
	const agentA = agents.find((a) => a.name === 'Harness Persona A');

	await insert('agent_configs', [
		{
			user_id: userId,
			agent_id: agentA.id,
			ugc_character_ref: IMG(700),
			ugc_reference_kit: {
				sheet: IMG(601),
				full_body: IMG(602),
				side_profiles: IMG(603),
				sheet_history: [IMG(601), IMG(606)],
				full_body_history: [IMG(602), IMG(604), IMG(605)]
			}
		}
	]);

	const today = new Date().toISOString().slice(0, 10);
	await insert(
		'posts',
		Array.from({ length: 5 }, (_, i) => ({
			user_id: userId,
			agent_id: agentA.id,
			content: JSON.stringify({
				caption: `Harness post ${i + 1}`,
				topic: `Topic ${i + 1}`,
				media_url: IMG(800 + i),
				media_type: 'image'
			}),
			platforms: ['instagram'],
			status: 'draft',
			scheduled_date: today,
			scheduled_time: `${String(9 + i).padStart(2, '0')}:00:00`
		}))
	);

	await insert('brand_briefs', [
		{
			user_id: userId,
			name: 'Harness Brand',
			version: 1,
			data: {
				brandName: 'Harness Brand',
				primaryColor: '#2C4A3E',
				secondaryColor: '#F4F0EA',
				logoUrl: IMG(600),
				products: [
					{ id: 'p1', name: 'Product One', description: 'First', price: '$10', photoUrl: IMG(610) },
					{ id: 'p2', name: 'Product Two', description: 'Second', price: '$20', photoUrl: IMG(611) }
				],
				competitors: [
					{ id: 'c1', name: 'Rival One', url: 'https://rival1.com', notes: 'n1' },
					{ id: 'c2', name: 'Rival Two', url: 'https://rival2.com', notes: 'n2' },
					{ id: 'c3', name: 'Rival Three', url: 'https://rival3.com', notes: 'n3' }
				]
			}
		}
	]);

	console.log(
		JSON.stringify({ email: EMAIL, password: PASSWORD, userId, workspaceId: workspace.id, agentA: agentA.id })
	);
}

const cmd = process.argv[2];
if (cmd === 'create') await create();
else if (cmd === 'destroy') await destroy();
else {
	console.error('usage: node scripts/verify-seed.mjs create|destroy');
	process.exit(1);
}
