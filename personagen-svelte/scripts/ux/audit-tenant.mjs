#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// UX AUDIT TENANT — an isolated, fully reversible set of accounts + data used
// to review the authenticated portal as every role.
//
//   node scripts/ux/audit-tenant.mjs create    # create accounts + seed data
//   node scripts/ux/audit-tenant.mjs status    # what exists right now
//   node scripts/ux/audit-tenant.mjs destroy   # remove every row it created
//   node scripts/ux/audit-tenant.mjs reset     # destroy + create
//
// SAFETY CONTRACT — this script is pointed at a LIVE instance that holds real
// users and real content, so:
//   · it only ever CREATES rows owned by its own `ux-*@personagen.test` users;
//   · it never reads, updates or deletes a row belonging to anyone else;
//   · `destroy` deletes exactly the auth users it made — every dependent row
//     cascades from auth.users — plus their storage objects and the one
//     workspace it created;
//   · accounts are made with the service role (admin.createUser), NOT through
//     /api/auth/signup, so the welcome-credit hourly cap that protects real
//     signups is never consumed;
//   · credits are ledger units, not money. Granting them costs nothing.
//     SPENDING them calls paid providers, which is why the audit protocol caps
//     live generation rather than this script capping credits.
//
// Passwords are random per run and written to `.ux-audit/accounts.json`, which
// is gitignored. They are NOT committed and NOT logged in full.
// ═══════════════════════════════════════════════════════════════════════════
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { pg, q, SB, KEY, appRoot } from './sql.mjs';

const cmd = process.argv[2] || 'status';
const OUT_DIR = join(appRoot, '.ux-audit');
const OUT_FILE = join(OUT_DIR, 'accounts.json');
const DOMAIN = 'personagen.test';
const WORKSPACE_NAME = 'UX Audit Co';

const svc = createClient(SB, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

/**
 * The seven experiences the portal actually has. `seat` is the workspace_members
 * role; `owner` holds the workspace and the content, `platform` holds the
 * Admin Console, `fresh` holds nothing at all (the zero state).
 */
const ROLES = [
	{ key: 'owner',    seat: null,      label: 'Workspace owner',  note: 'Owns the workspace and all personas. The default paying user.' },
	{ key: 'admin',    seat: 'admin',   label: 'Workspace admin',  note: 'Full operational control except renaming/deleting the workspace or deleting a persona.' },
	{ key: 'manager',  seat: 'manager', label: 'Workspace manager',note: 'Approve/publish, connections, spend visibility. Cannot manage seats.' },
	{ key: 'creator',  seat: 'creator', label: 'Workspace creator',note: 'Generates and drafts. Thin wallet on purpose — reviews the out-of-credits path.' },
	{ key: 'viewer',   seat: 'viewer',  label: 'Workspace viewer',  note: 'Read-only. The role most likely to be shown controls that will 403.' },
	{ key: 'platform', seat: null,      label: 'Platform admin',    note: 'Admin Console. Not a member of the audit workspace.' },
	{ key: 'fresh',    seat: null,      label: 'Brand-new account', note: 'Signed up seconds ago. Every surface is in its zero state.' }
];

const email = (k) => `ux-${k}@${DOMAIN}`;
const strongPassword = () => `Ux!${randomBytes(12).toString('base64url')}`;

// ── persona seed ──────────────────────────────────────────────────────────
// Faces reuse the demo assets already in static/; they are app-relative paths,
// which image-url.ts passes through untouched.
const FACE = (n) => `/assets/personas/persona-${n}-720.webp`;

/**
 * Every seeded persona is `advisor` with `posts_per_day: 0`, and that is a
 * SAFETY REQUIREMENT, not a preference.
 *
 * This database is shared with the deployed production app, which runs its own
 * scheduler. The first version of this seed set semi/fully-autonomous levels;
 * production's autopilot found the new personas within twenty minutes and
 * generated 34 posts against them — 56 real LLM calls, $0.112 of provider spend
 * charged to the owner's wallet — while this machine's servers all had
 * RUN_SCHEDULER=false. Disabling the scheduler locally protects nothing, because
 * the scheduler that matters runs somewhere else.
 *
 * autopilot.ts selects `.in('autonomy_level', ['semi_autonomous','fully_autonomous'])`,
 * so `advisor` is the one value it can never pick up. Do not change these.
 * The autonomy CONTROL is still reviewable on the persona page; what is refused
 * here is leaving a seeded persona armed.
 */
const PERSONAS = [
	{ n: 5,  name: 'Mara Vance',   handle: 'maravance',    niche: 'Wellness & daily rituals', status: 'active', autonomy: 'advisor', fav: true },
	{ n: 9,  name: 'Jonah Reid',   handle: 'jonahreid',    niche: 'Strength training',        status: 'active', autonomy: 'advisor', fav: false },
	{ n: 1,  name: 'Ana Okafor',   handle: 'anaokafor',    niche: 'Founder & B2B',            status: 'active', autonomy: 'advisor', fav: true },
	{ n: 3,  name: 'Lena Brandt',  handle: 'lenabrandt',   niche: 'Home & kitchen',           status: 'paused', autonomy: 'advisor', fav: false },
	{ n: 7,  name: 'Theo Marsh',   handle: 'theomarsh',    niche: 'Long-form explainers',     status: 'paused', autonomy: 'advisor', fav: false },
	{ n: 4,  name: 'Nico Alvarez', handle: 'nicoalvarez',  niche: 'Street food & travel',     status: 'pending', autonomy: 'advisor', fav: false }
];

const CAPTIONS = [
	'Three weeks in and the 3pm slump just… stopped showing up. Same spoon, same time, every morning.',
	'Nobody warns you that the jar becomes a habit before it becomes a favourite.',
	'I tested this against my usual pre-workout for a fortnight. Notes in the comments.',
	'The label says 450g. What it does not say is that it lasts about nine days in this house.',
	'Asked my gym to stock it. They asked what it was. So: a thread.',
	'Unpopular opinion: the 200g jar is the better buy if you actually travel.',
	'Day 14. Still no crash. Still slightly suspicious of how well this works.',
	'What I put in my bag before a 6am session, ranked honestly.',
	'This is the part of the routine I would not drop if the budget got cut.',
	'Two spoons, one flat white, and the morning stops being a negotiation.',
	'A short one today: why I stopped buying the supermarket stuff.',
	'Behind the scenes of a very unglamorous product shoot.'
];

const PLATFORM_SETS = [
	['instagram'], ['instagram', 'threads'], ['tiktok'], ['linkedin'],
	['instagram', 'facebook'], ['youtube'], ['x'], ['pinterest']
];

function contentFor({ kind, text, face, err, intended, template }) {
	const base = { text };
	if (kind === 'photo') return JSON.stringify({ ...base, media_url: FACE(face), media_type: 'image', generation: { still_style: 'photo' }, costBreakdown: { total: 0.26, byProvider: { fal: 0.26 } } });
	if (kind === 'card')  return JSON.stringify({ ...base, media_url: FACE(face), media_type: 'image', generation: { still_style: 'graphic' }, studio: { template: template ?? null }, costBreakdown: { total: 0.02, byProvider: { openrouter: 0.02 } } });
	// No media: in-flight, failed, rejected, or a text-only draft. `intended`
	// is what the run SET OUT to make, which is what types the placeholder.
	return JSON.stringify({ ...base, ...(intended ? { intended } : {}), ...(err ? { error: err } : {}) });
}

const dayOffset = (d) => {
	const t = new Date();
	t.setDate(t.getDate() + d);
	return t.toISOString().slice(0, 10);
};

async function loadAccounts() {
	if (!existsSync(OUT_FILE)) return null;
	try { return JSON.parse(readFileSync(OUT_FILE, 'utf8')); } catch { return null; }
}

async function findUser(mail) {
	// listUsers is paginated; the tenant is small and always recent.
	for (let page = 1; page <= 5; page++) {
		const { data } = await svc.auth.admin.listUsers({ page, perPage: 200 });
		const hit = (data?.users ?? []).find((u) => u.email?.toLowerCase() === mail.toLowerCase());
		if (hit) return hit;
		if (!data?.users?.length || data.users.length < 200) return null;
	}
	return null;
}

// ── create ────────────────────────────────────────────────────────────────
async function create() {
	const existing = (await loadAccounts()) ?? { accounts: {} };
	const out = { createdAt: new Date().toISOString(), workspace: null, accounts: {} };

	for (const role of ROLES) {
		const mail = email(role.key);
		let user = await findUser(mail);
		let password = existing.accounts?.[role.key]?.password ?? strongPassword();

		if (user) {
			// Re-running create must leave a usable login, so reset the password
			// to the one we are about to write down.
			password = strongPassword();
			await svc.auth.admin.updateUserById(user.id, { password, email_confirm: true });
			console.log(`· ${role.key.padEnd(9)} exists, password reset`);
		} else {
			const { data, error } = await svc.auth.admin.createUser({
				email: mail,
				password,
				email_confirm: true,
				user_metadata: { full_name: role.label }
			});
			if (error) throw new Error(`createUser ${mail}: ${error.message}`);
			user = data.user;
			console.log(`· ${role.key.padEnd(9)} created`);
		}
		out.accounts[role.key] = { email: mail, password, id: user.id, seat: role.seat, label: role.label, note: role.note };
	}

	const ids = Object.fromEntries(Object.entries(out.accounts).map(([k, v]) => [k, v.id]));

	// ── wallets ──
	// Owner/admin/manager work normally; creator is deliberately thin so the
	// out-of-credits path is reviewable; viewer and fresh get the signup grant.
	const balances = { owner: 12000, admin: 6000, manager: 6000, creator: 40, viewer: 1000, platform: 5000, fresh: 1000 };
	for (const [k, bal] of Object.entries(balances)) {
		await pg(`insert into credit_accounts (user_id, balance_credits, billing_mode)
		          values (${q(ids[k])}, ${bal}, 'credits')
		          on conflict (user_id) do update set balance_credits = excluded.balance_credits`);
	}

	// ── platform admin ──
	await pg(`insert into platform_admins (user_id, note) values (${q(ids.platform)}, 'UX audit tenant — temporary')
	          on conflict (user_id) do nothing`);

	// ── workspace + seats ──
	const wsRows = await pg(`select id from workspaces where owner_id = ${q(ids.owner)} and name = ${q(WORKSPACE_NAME)} limit 1`);
	let wsId = wsRows?.[0]?.id;
	if (!wsId) {
		const ins = await pg(`insert into workspaces (owner_id, name) values (${q(ids.owner)}, ${q(WORKSPACE_NAME)}) returning id`);
		wsId = ins?.[0]?.id;
	}
	out.workspace = { id: wsId, name: WORKSPACE_NAME };
	for (const role of ROLES.filter((r) => r.seat)) {
		await pg(`insert into workspace_members (workspace_id, user_id, role, invited_by)
		          values (${q(wsId)}, ${q(ids[role.key])}, ${q(role.seat)}, ${q(ids.owner)})
		          on conflict (workspace_id, user_id) do update set role = excluded.role`);
	}
	// One pending invite so the invite-management surface has a row, and one
	// addressed to `fresh` so the "you've been invited" banner is reviewable.
	await pg(`insert into workspace_invites (workspace_id, email, role, token, invited_by, status)
	          values (${q(wsId)}, ${q(email('fresh'))}, 'creator', ${q('ux-audit-invite-' + randomBytes(8).toString('hex'))}, ${q(ids.owner)}, 'pending')
	          on conflict do nothing`);

	// ── personas ──
	const personaIds = {};
	// One group so the sidebar's grouping affordance has something to group.
	const grpRows = await pg(`insert into persona_groups (user_id, name) values (${q(ids.owner)}, 'Honey — core cast')
	                          returning id`);
	const groupId = grpRows?.[0]?.id;

	for (const p of PERSONAS) {
		const gradient = ['linear-gradient(135deg,#7c6aed,#22d3ee)', 'linear-gradient(135deg,#db2777,#f59e0b)', 'linear-gradient(135deg,#059669,#22d3ee)'][p.n % 3];
		const rows = await pg(`insert into agents (user_id, name, handle, niche, status, gradient, initial, is_favorite, group_id, workspace_id, followers, engagement_rate, connection_count)
		  values (${q(ids.owner)}, ${q(p.name)}, ${q(p.handle)}, ${q(p.niche)}, ${q(p.status)}, ${q(gradient)}, ${q(p.name[0])}, ${p.fav}, ${p.fav ? q(groupId) : 'null'}, ${q(wsId)}, ${q(String(1200 + p.n * 830))}, ${(2 + (p.n % 5) * 0.7).toFixed(2)}, ${p.n % 3})
		  returning id`);
		const id = rows?.[0]?.id;
		personaIds[p.handle] = id;
		await pg(`insert into agent_configs (user_id, agent_id, autonomy_level, posts_per_day, active_hours_start, active_hours_end, timezone, ugc_character_ref, ugc_voice, ugc_format)
		          values (${q(ids.owner)}, ${q(id)}, ${q(p.autonomy)}, 0, 8, 20, 'Australia/Brisbane', ${q(FACE(p.n))}, 'warm_female', 'auto')`);
	}

	// ── connections ── display rows only; no provider account is reachable,
	// and the scheduler is off during the audit, so nothing can publish.
	const conn = [
		['maravance', 'instagram', 'active', '@mara.vance'],
		['maravance', 'threads', 'active', '@mara.vance'],
		['jonahreid', 'tiktok', 'reauth_required', '@jonah.lifts'],
		['anaokafor', 'linkedin', 'error', 'ana-okafor'],
		['lenabrandt', 'pinterest', 'stale', 'lenabrandt']
	];
	for (const [h, plat, status, handle] of conn) {
		await pg(`insert into connections (user_id, agent_id, platform, handle, verified, status, provider, followers, engagement_rate, last_sync)
		          values (${q(ids.owner)}, ${q(personaIds[h])}, ${q(plat)}, ${q(handle)}, ${status === 'active'}, ${q(status)}, 'zernio', ${3000 + Math.floor(Math.random() * 9000)}, ${(1 + Math.random() * 4).toFixed(2)}, now() - interval '6 hours')`);
	}

	// ── brand briefs ──
	for (const [name, site] of [['HoneyX — Manly Plus', 'https://honeyx.example'], ['HoneyX — Retail range', 'https://honeyx.example/retail']]) {
		await pg(`insert into brand_briefs (user_id, name, version, data) values (${q(ids.owner)}, ${q(name)}, 1, ${q(JSON.stringify({
			brand: 'HoneyX', site, tagline: "Men's honey, made for the morning.",
			products: [
				{ name: 'Manly Plus 450g', price: 'A$39.00', blurb: 'Premium honey blend, daily spoon.' },
				{ name: 'Manly Plus 200g', price: 'A$22.00', blurb: 'Travel size.' }
			],
			audience: 'Australian men 28–45 who already buy supplements',
			tone: 'plain, unhyped, slightly dry'
		}))}::jsonb)`);
	}

	// ── posts: every status, spread across dates and personas ──
	const handles = PERSONAS.map((p) => p.handle);
	const rows = [];
	let ci = 0;
	const nextCaption = () => CAPTIONS[ci++ % CAPTIONS.length];

	// published (past)
	for (let i = 0; i < 9; i++) {
		const h = handles[i % 3];
		rows.push({ h, status: 'published', content: contentFor({ kind: i % 3 === 0 ? 'card' : 'photo', text: nextCaption(), face: PERSONAS[i % 3].n, template: 'quote_card' }), date: dayOffset(-(i + 1)), time: '09:41:00', published: true, platforms: PLATFORM_SETS[i % PLATFORM_SETS.length], fav: i === 2 });
	}
	// drafts (awaiting approval — the review queue)
	for (let i = 0; i < 7; i++) {
		const h = handles[i % 4];
		rows.push({ h, status: 'draft', content: contentFor({ kind: i % 2 === 0 ? 'photo' : 'card', text: nextCaption(), face: PERSONAS[i % 4].n }), date: dayOffset(i), time: '14:00:00', platforms: PLATFORM_SETS[(i + 2) % PLATFORM_SETS.length] });
	}
	// text-only drafts with typed placeholders (video/cinematic intent, no media)
	rows.push({ h: 'jonahreid', status: 'draft', content: contentFor({ kind: 'none', text: nextCaption(), intended: { media: 'video', format: 'spokesperson' } }), date: dayOffset(1), time: '18:30:00', platforms: ['tiktok'] });
	rows.push({ h: 'theomarsh', status: 'draft', content: contentFor({ kind: 'none', text: nextCaption(), intended: { media: 'cinematic', format: 'broll' } }), date: dayOffset(2), time: '11:00:00', platforms: ['youtube'] });
	// scheduled (future only — nothing can come due during an audit)
	for (let i = 0; i < 5; i++) {
		rows.push({ h: handles[i % 3], status: 'scheduled', content: contentFor({ kind: 'photo', text: nextCaption(), face: PERSONAS[i % 3].n }), date: dayOffset(3 + i), time: ['08:15:00', '12:00:00', '17:45:00'][i % 3], platforms: PLATFORM_SETS[i % PLATFORM_SETS.length] });
	}
	// in-flight
	rows.push({ h: 'maravance', status: 'generating', content: contentFor({ kind: 'none', text: '', intended: { media: 'image', still: 'photo' } }), date: dayOffset(0), time: '10:05:00', platforms: ['instagram'] });
	rows.push({ h: 'jonahreid', status: 'publishing', content: contentFor({ kind: 'photo', text: nextCaption(), face: 9 }), date: dayOffset(0), time: '10:20:00', platforms: ['tiktok', 'instagram'] });
	// failures, in both flavours the UI distinguishes
	rows.push({ h: 'anaokafor', status: 'failed', content: contentFor({ kind: 'none', text: '', intended: { media: 'image', still: 'photo' }, err: 'Image provider returned 503 after 3 attempts. Nothing was charged for the failed attempt.' }), date: dayOffset(-1), time: '07:10:00', platforms: ['linkedin'] });
	rows.push({ h: 'maravance', status: 'failed', content: contentFor({ kind: 'photo', text: nextCaption(), face: 5, err: 'Instagram rejected the upload: caption exceeds 2,200 characters.' }), date: dayOffset(-2), time: '16:00:00', platforms: ['instagram'] });
	// partial + rejected
	rows.push({ h: 'maravance', status: 'partial', content: contentFor({ kind: 'photo', text: nextCaption(), face: 5 }), date: dayOffset(-3), time: '09:00:00', platforms: ['instagram', 'facebook'], pubResults: { instagram: { status: 'published', permalink: 'https://instagram.com/p/ux-audit-demo' }, facebook: { status: 'failed', error: 'Page token expired' } } });
	rows.push({ h: 'lenabrandt', status: 'rejected', content: contentFor({ kind: 'card', text: nextCaption(), face: 3 }), date: dayOffset(-4), time: '13:00:00', platforms: ['pinterest'] });
	// a soft-deleted post so Trash has a row
	rows.push({ h: 'theomarsh', status: 'draft', content: contentFor({ kind: 'photo', text: nextCaption(), face: 7 }), date: dayOffset(-5), time: '15:00:00', platforms: ['youtube'], deleted: true });

	for (const r of rows) {
		const pubResults = r.pubResults ? `${q(JSON.stringify(r.pubResults))}::jsonb` : 'null';
		await pg(`insert into posts (user_id, agent_id, content, platforms, status, scheduled_date, scheduled_time, published_at, is_favorite, deleted_at, publication_results, fit_score)
		  values (${q(ids.owner)}, ${q(personaIds[r.h])}, ${q(r.content)}, array[${r.platforms.map(q).join(',')}]::text[], ${q(r.status)}, ${q(r.date)}, ${q(r.time)},
		          ${r.published ? `(${q(r.date)}::date + ${q(r.time)}::time)` : 'null'}, ${r.fav ? 'true' : 'false'}, ${r.deleted ? 'now()' : 'null'}, ${pubResults},
		          ${r.status === 'published' || r.status === 'draft' ? 60 + Math.floor(Math.random() * 39) : 'null'})`);
	}

	// ── a credit history the ledger page can render ──
	await pg(`insert into credit_ledger (user_id, delta, kind, balance_after, note)
	          select ${q(ids.owner)}, 12000, 'grant', 12000, 'UX audit tenant — opening balance'
	          where not exists (select 1 from credit_ledger where user_id = ${q(ids.owner)} and note = 'UX audit tenant — opening balance')`);

	mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
	console.log(`\nWrote ${OUT_FILE}`);
	await status();
}

// ── status ────────────────────────────────────────────────────────────────
async function status() {
	const mails = ROLES.map((r) => email(r.key));
	const rows = await pg(`select u.email, u.id,
	    coalesce(a.balance_credits, -1) as credits,
	    (select count(*) from agents g where g.user_id = u.id) as personas,
	    (select count(*) from posts p where p.user_id = u.id) as posts,
	    (select role from workspace_members m where m.user_id = u.id limit 1) as seat,
	    (select true from platform_admins pa where pa.user_id = u.id) as platform_admin
	  from auth.users u left join credit_accounts a on a.user_id = u.id
	  where u.email in (${mails.map(q).join(',')}) order by u.email`);
	console.log('\nUX audit tenant:');
	if (!rows?.length) { console.log('  (none — run `create`)'); return; }
	for (const r of rows) {
		console.log(`  ${String(r.email).padEnd(30)} seat=${String(r.seat ?? (r.platform_admin ? 'platform-admin' : '—')).padEnd(14)} credits=${String(r.credits).padEnd(6)} personas=${String(r.personas).padEnd(3)} posts=${r.posts}`);
	}
	const ws = await pg(`select w.name, (select count(*) from workspace_members m where m.workspace_id = w.id) as seats from workspaces w where w.name = ${q(WORKSPACE_NAME)}`);
	if (ws?.length) console.log(`  workspace "${ws[0].name}" · ${ws[0].seats} seats`);
}

// ── destroy ───────────────────────────────────────────────────────────────
async function destroy() {
	const mails = ROLES.map((r) => email(r.key));
	const rows = await pg(`select id, email from auth.users where email in (${mails.map(q).join(',')})`);
	if (!rows?.length) { console.log('nothing to remove'); return; }

	for (const u of rows) {
		// Storage has no cascade from auth.users, so sweep objects first.
		try {
			const objects = await pg(`select bucket_id, name from storage.objects where split_part(name, '/', 1) = ${q(u.id)}`);
			for (const o of objects ?? []) {
				await fetch(`${SB}/storage/v1/object/${o.bucket_id}/${o.name}`, {
					method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
				});
			}
			if (objects?.length) console.log(`· swept ${objects.length} storage object(s) for ${u.email}`);
		} catch { /* storage sweep is best-effort */ }

		const { error } = await svc.auth.admin.deleteUser(u.id);
		console.log(`· deleted ${u.email}${error ? ' — ' + error.message : ''}`);
	}
	// The workspace is owner-cascaded, but delete by name too in case the owner
	// row was already gone from an interrupted run.
	await pg(`delete from workspaces where name = ${q(WORKSPACE_NAME)}`);
	if (existsSync(OUT_FILE)) writeFileSync(OUT_FILE, JSON.stringify({ destroyedAt: new Date().toISOString(), accounts: {} }, null, 2));
	console.log('tenant removed');
}

if (!SB || !KEY) { console.error('PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env'); process.exit(1); }
if (cmd === 'create') await create();
else if (cmd === 'destroy') await destroy();
else if (cmd === 'reset') { await destroy(); await create(); }
else await status();
