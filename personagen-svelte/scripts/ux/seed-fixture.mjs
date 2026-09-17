#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Put CONTENT on the existing `verify-kit-*@personagen.test` fixture account so
// the portal can be reviewed with real rows in it, and take it away again.
//
//   node scripts/ux/seed-fixture.mjs seed
//   node scripts/ux/seed-fixture.mjs status
//   node scripts/ux/seed-fixture.mjs unseed
//
// Two differences from the seven-account tenant this replaces, both deliberate:
//
//   · It creates NO users. It borrows one fixture account that already exists
//     and owns nothing, and refuses to run if that account is missing.
//
//   · Every persona is `advisor` with `posts_per_day: 0`. This database is
//     shared with the deployed app, which runs its own scheduler. The first
//     version of the seed used semi/fully-autonomous levels and production's
//     autopilot found the personas within twenty minutes, generating 34 posts
//     and spending $0.112 of real provider credit. `advisor` is the one value
//     autopilot's query (`.in('autonomy_level', ['semi_autonomous',
//     'fully_autonomous'])`) cannot select.
//
// The fixture's wallet is also deliberately small, and `credits_mode` is
// `enforce`, so a runaway generation is refused by the app itself as a second,
// independent stop.
// ═══════════════════════════════════════════════════════════════════════════
import { pg, q } from './sql.mjs';

const EMAIL = 'verify-kit-69a88f@personagen.test';
const cmd = process.argv[2] || 'status';

const FACE = (n) => `/assets/personas/persona-${n}-720.webp`;

const PERSONAS = [
	{ n: 5, name: 'Mara Vance', handle: 'maravance', niche: 'Wellness & daily rituals', status: 'active', fav: true },
	{ n: 9, name: 'Jonah Reid', handle: 'jonahreid', niche: 'Strength training', status: 'active', fav: false },
	{ n: 1, name: 'Ana Okafor', handle: 'anaokafor', niche: 'Founder & B2B', status: 'active', fav: true },
	{ n: 3, name: 'Lena Brandt', handle: 'lenabrandt', niche: 'Home & kitchen', status: 'paused', fav: false },
	{ n: 7, name: 'Theo Marsh', handle: 'theomarsh', niche: 'Long-form explainers', status: 'paused', fav: false },
	{ n: 4, name: 'Nico Alvarez', handle: 'nicoalvarez', niche: 'Street food & travel', status: 'pending', fav: false }
];

const CAPTIONS = [
	'Three weeks in and the 3pm slump just stopped showing up. Same spoon, same time, every morning.',
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

function contentFor({ kind, text, face, err, intended }) {
	const base = { text };
	if (kind === 'photo')
		return JSON.stringify({ ...base, media_url: FACE(face), media_type: 'image', generation: { still_style: 'photo' }, costBreakdown: { total: 0.26, byProvider: { fal: 0.26 } } });
	if (kind === 'card')
		return JSON.stringify({ ...base, media_url: FACE(face), media_type: 'image', generation: { still_style: 'graphic' }, costBreakdown: { total: 0.02, byProvider: { openrouter: 0.02 } } });
	return JSON.stringify({ ...base, ...(intended ? { intended } : {}), ...(err ? { error: err } : {}) });
}

const dayOffset = (d) => {
	const t = new Date();
	t.setDate(t.getDate() + d);
	return t.toISOString().slice(0, 10);
};

async function userId() {
	const r = await pg(`select id from auth.users where email = ${q(EMAIL)}`);
	if (!r?.length) {
		console.error(`${EMAIL} does not exist — refusing to create it`);
		process.exit(1);
	}
	return r[0].id;
}

async function seed() {
	const uid = await userId();
	const have = await pg(`select count(*) n from agents where user_id = ${q(uid)}`);
	if (Number(have[0].n) > 0) {
		console.log('already seeded — run `unseed` first');
		return status();
	}

	const grp = await pg(`insert into persona_groups (user_id, name) values (${q(uid)}, 'Honey — core cast') returning id`);
	const groupId = grp?.[0]?.id;

	const ids = {};
	for (const p of PERSONAS) {
		const gradient = ['linear-gradient(135deg,#7c6aed,#22d3ee)', 'linear-gradient(135deg,#db2777,#f59e0b)', 'linear-gradient(135deg,#059669,#22d3ee)'][p.n % 3];
		const rows = await pg(`insert into agents (user_id, name, handle, niche, status, gradient, initial, is_favorite, group_id, followers, engagement_rate, connection_count)
			values (${q(uid)}, ${q(p.name)}, ${q(p.handle)}, ${q(p.niche)}, ${q(p.status)}, ${q(gradient)}, ${q(p.name[0])}, ${p.fav}, ${p.fav ? q(groupId) : 'null'}, ${q(String(1200 + p.n * 830))}, ${(2 + (p.n % 5) * 0.7).toFixed(2)}, ${p.n % 3})
			returning id`);
		ids[p.handle] = rows[0].id;
		await pg(`insert into agent_configs (user_id, agent_id, autonomy_level, posts_per_day, active_hours_start, active_hours_end, timezone, ugc_character_ref, ugc_voice, ugc_format)
			values (${q(uid)}, ${q(ids[p.handle])}, 'advisor', 0, 8, 20, 'Australia/Brisbane', ${q(FACE(p.n))}, 'warm_female', 'auto')`);
	}

	for (const [h, plat, st, handle] of [
		['maravance', 'instagram', 'active', '@mara.vance'],
		['maravance', 'threads', 'active', '@mara.vance'],
		['jonahreid', 'tiktok', 'reauth_required', '@jonah.lifts'],
		['anaokafor', 'linkedin', 'error', 'ana-okafor'],
		['lenabrandt', 'pinterest', 'stale', 'lenabrandt']
	]) {
		await pg(`insert into connections (user_id, agent_id, platform, handle, verified, status, provider, followers, engagement_rate, last_sync)
			values (${q(uid)}, ${q(ids[h])}, ${q(plat)}, ${q(handle)}, ${st === 'active'}, ${q(st)}, 'zernio', ${3000 + Math.floor(Math.random() * 9000)}, ${(1 + Math.random() * 4).toFixed(2)}, now() - interval '6 hours')`);
	}

	const brief = {
		brandName: 'HoneyX',
		storeUrl: '',
		tagline: "Men's honey, made for the morning.",
		mission: 'Make one good habit effortless.',
		products: [{ name: 'Manly Plus 450g', price: 'A$39.00' }, { name: 'Manly Plus 200g', price: 'A$22.00' }],
		// Comma-separated strings, not arrays: that is how the brief editor
		// actually writes these three fields, confirmed against every real brief
		// in the database. Seeding arrays instead produced a white-screen crash
		// in the intel wizard that looked like an app bug and was this seed's
		// fault — realistic fixtures matter as much as realistic volume.
		platforms: 'instagram, tiktok',
		painPoints: 'the 3pm energy crash, paying for caffeine twice a day',
		interests: 'home espresso, trail running, meal prep',
		demographics: 'Australian men 28-45'
	};
	await pg(`insert into brand_briefs (user_id, name, version, data) values (${q(uid)}, 'HoneyX — Manly Plus', 1, ${q(JSON.stringify(brief))}::jsonb)`);

	const handles = PERSONAS.map((p) => p.handle);
	const rows = [];
	let ci = 0;
	const cap = () => CAPTIONS[ci++ % CAPTIONS.length];

	for (let i = 0; i < 9; i++)
		rows.push({ h: handles[i % 3], status: 'published', content: contentFor({ kind: i % 3 === 0 ? 'card' : 'photo', text: cap(), face: PERSONAS[i % 3].n }), date: dayOffset(-(i + 1)), time: '09:41:00', published: true, platforms: ['instagram'], fav: i === 2 });
	for (let i = 0; i < 7; i++)
		rows.push({ h: handles[i % 4], status: 'draft', content: contentFor({ kind: i % 2 === 0 ? 'photo' : 'card', text: cap(), face: PERSONAS[i % 4].n }), date: dayOffset(i), time: '14:00:00', platforms: ['instagram', 'threads'] });
	rows.push({ h: 'jonahreid', status: 'draft', content: contentFor({ kind: 'none', text: cap(), intended: { media: 'video', format: 'spokesperson' } }), date: dayOffset(1), time: '18:30:00', platforms: ['tiktok'] });
	rows.push({ h: 'theomarsh', status: 'draft', content: contentFor({ kind: 'none', text: cap(), intended: { media: 'cinematic', format: 'broll' } }), date: dayOffset(2), time: '11:00:00', platforms: ['youtube'] });
	for (let i = 0; i < 5; i++)
		rows.push({ h: handles[i % 3], status: 'scheduled', content: contentFor({ kind: 'photo', text: cap(), face: PERSONAS[i % 3].n }), date: dayOffset(3 + i), time: ['08:15:00', '12:00:00', '17:45:00'][i % 3], platforms: ['instagram'] });
	rows.push({ h: 'maravance', status: 'generating', content: contentFor({ kind: 'none', text: '', intended: { media: 'image', still: 'photo' } }), date: dayOffset(0), time: '10:05:00', platforms: ['instagram'] });
	rows.push({ h: 'jonahreid', status: 'publishing', content: contentFor({ kind: 'photo', text: cap(), face: 9 }), date: dayOffset(0), time: '10:20:00', platforms: ['tiktok'] });
	rows.push({ h: 'anaokafor', status: 'failed', content: contentFor({ kind: 'none', text: '', intended: { media: 'image', still: 'photo' }, err: 'Image provider returned 503 after 3 attempts. Nothing was charged for the failed attempt.' }), date: dayOffset(-1), time: '07:10:00', platforms: ['linkedin'] });
	rows.push({ h: 'maravance', status: 'partial', content: contentFor({ kind: 'photo', text: cap(), face: 5 }), date: dayOffset(-3), time: '09:00:00', platforms: ['instagram', 'facebook'], pubResults: { instagram: { status: 'published', permalink: 'https://instagram.com/p/ux-audit-demo' }, facebook: { status: 'failed', error: 'Page token expired' } } });
	rows.push({ h: 'lenabrandt', status: 'rejected', content: contentFor({ kind: 'card', text: cap(), face: 3 }), date: dayOffset(-4), time: '13:00:00', platforms: ['pinterest'] });
	rows.push({ h: 'theomarsh', status: 'draft', content: contentFor({ kind: 'photo', text: cap(), face: 7 }), date: dayOffset(-5), time: '15:00:00', platforms: ['youtube'], deleted: true });

	for (const r of rows) {
		const pr = r.pubResults ? `${q(JSON.stringify(r.pubResults))}::jsonb` : 'null';
		await pg(`insert into posts (user_id, agent_id, content, platforms, status, scheduled_date, scheduled_time, published_at, is_favorite, deleted_at, publication_results, fit_score)
			values (${q(uid)}, ${q(ids[r.h])}, ${q(r.content)}, array[${r.platforms.map(q).join(',')}]::text[], ${q(r.status)}, ${q(r.date)}, ${q(r.time)},
				${r.published ? `(${q(r.date)}::date + ${q(r.time)}::time)` : 'null'}, ${r.fav ? 'true' : 'false'}, ${r.deleted ? 'now()' : 'null'}, ${pr},
				${r.status === 'published' || r.status === 'draft' ? 60 + Math.floor(Math.random() * 39) : 'null'})`);
	}

	// Enough to render a real wallet and price a quote; never enough to matter.
	await pg(`insert into credit_accounts (user_id, balance_credits, billing_mode) values (${q(uid)}, 4200, 'credits')
		on conflict (user_id) do update set balance_credits = 4200`);

	await status();
}

async function unseed() {
	const uid = await userId();
	for (const t of ['generation_events', 'posts', 'connections', 'agent_configs', 'agents', 'brand_briefs', 'persona_groups']) {
		const r = await pg(`delete from ${t} where user_id = ${q(uid)} returning 1`);
		if (r?.length) console.log(`· removed ${r.length} row(s) from ${t}`);
	}
	await pg(`update credit_accounts set balance_credits = 0 where user_id = ${q(uid)}`);
	console.log('fixture is empty again');
}

async function status() {
	const uid = await userId();
	const r = await pg(`select
		(select count(*) from agents where user_id = ${q(uid)}) personas,
		(select count(*) from posts where user_id = ${q(uid)}) posts,
		(select count(*) from posts where user_id = ${q(uid)} and deleted_at is not null) trashed,
		(select count(distinct status) from posts where user_id = ${q(uid)}) distinct_statuses,
		(select count(*) from brand_briefs where user_id = ${q(uid)}) briefs,
		(select count(*) from connections where user_id = ${q(uid)}) connections,
		coalesce((select balance_credits from credit_accounts where user_id = ${q(uid)}),0) credits`);
	console.log('fixture content:', JSON.stringify(r[0]));
	const lvl = await pg(`select distinct autonomy_level, posts_per_day from agent_configs where user_id = ${q(uid)}`);
	console.log('autonomy (must be advisor / 0):', JSON.stringify(lvl));
}

if (cmd === 'seed') await seed();
else if (cmd === 'unseed') await unseed();
else await status();
