#!/usr/bin/env node
/**
 * Round 5's acceptance tests, asserted against the running portal.
 *
 * Each check is the critic's own acceptance criterion for a ranked issue,
 * measured the way they measured it — not a restatement of what the code now
 * says. The rule this session keeps relearning is that a fix which has never
 * been run is not a fix.
 *
 *   node --import ./scripts/ux/dns-fix.mjs scripts/ux/verify-round5.mjs
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appRoot } from './sql.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4180';
const DIR = join(appRoot, '.ux-audit');
const role = Object.keys(JSON.parse(readFileSync(join(DIR, 'accounts.json'), 'utf8')).accounts)[0];
const STATE = join(DIR, `state-${role}.json`);

const fails = [];
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => {
	fails.push(m);
	console.log('  ✗ ' + m);
};

const browser = await chromium.launch();
const open = async (path, width = 1280, height = 900) => {
	const ctx = await browser.newContext({ storageState: STATE, viewport: { width, height } });
	const page = await ctx.newPage();
	await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 90000 });
	await page.waitForTimeout(500);
	return { ctx, page };
};

const ROUTES = [
	'/dashboard',
	'/review',
	'/calendar',
	'/generations',
	'/favorites',
	'/trash',
	'/settings',
	'/billing',
	'/brand-brief',
	'/brand-brief/intel',
	'/generator',
	'/developer',
	'/guides'
];

// ── 0. Refuse to measure a logged-out portal. ────────────────────────────
// Without this the whole file is a check that cannot fail: an expired session
// redirects every route to /login, which has exactly one h1 in exactly one
// place, so the layout assertions PASS while measuring the wrong page. This
// run caught itself doing precisely that.
{
	console.log('session is authenticated');
	const { ctx, page } = await open('/review');
	const url = page.url();
	const configured = !/Configuration Required/i.test(await page.locator('body').innerText());
	await ctx.close();
	if (/\/login/.test(url)) {
		console.log(`  ✗ redirected to ${url} — the saved session is expired`);
		console.log('ABORTING: re-run scripts/ux/login.mjs --base ' + BASE);
		await browser.close();
		process.exit(2);
	}
	if (!configured) {
		console.log('  ✗ server is serving the "Configuration Required" page');
		console.log('ABORTING: start the server with --env-file=.env');
		await browser.close();
		process.exit(2);
	}
	ok(`signed in, portal rendering (${url})`);
}

// ── 1. One layout, at the widths people actually use. ────────────────────
// Measured before the shell: the h1 left edge took 10 values spanning 441px at
// 1920, and h1 font-size took 7, from 21.6px to 67.2px.
//
// This used to check 1920 only, and that is how /guides got certified as
// aligned while sitting 32px left of every other route at 1280 and 1440 — the
// widths most of this portal's users are on. Two assertions now: at most two
// distinct edges per width, AND no route alone at its own edge, because a
// single outlier among thirteen still satisfies "at most two".
{
	console.log('one page shell across every route');
	for (const width of [1280, 1440, 1920]) {
		const edges = new Map();
		const sizes = new Map();
		for (const route of ROUTES) {
			const { ctx, page } = await open(route, width, 1080);
			const h = await page.evaluate(() => {
				const el = document.querySelector('h1');
				if (!el) return null;
				const r = el.getBoundingClientRect();
				return { x: Math.round(r.x), size: getComputedStyle(el).fontSize };
			});
			await ctx.close();
			if (!h) {
				bad(`${route} has no h1 at ${width}`);
				continue;
			}
			edges.set(h.x, [...(edges.get(h.x) ?? []), route]);
			sizes.set(h.size, [...(sizes.get(h.size) ?? []), route]);
		}
		const edgeList = [...edges.keys()].sort((a, b) => a - b);
		const sizeList = [...sizes.keys()];
		if (edgeList.length > 2)
			bad(`@${width}: h1 left edge takes ${edgeList.length} values: ${edgeList.join(', ')}`);
		else ok(`@${width}: h1 left edge takes ${edgeList.length} value(s): ${edgeList.join(', ')}`);

		const lonely = edgeList.filter((x) => edges.get(x).length === 1);
		if (lonely.length)
			bad(
				`@${width}: ${lonely.map((x) => `${edges.get(x)[0]} alone at x=${x}`).join('; ')}`
			);
		else ok(`@${width}: every h1 position is shared by at least two routes`);

		if (sizeList.length > 1)
			bad(`@${width}: h1 font-size takes ${sizeList.length} values: ${sizeList.join(', ')}`);
		else ok(`@${width}: h1 font-size is ${sizeList[0]} everywhere`);
	}
}

// ── 2. The caption survives every width. ──────────────────────────────────
// At 768 the caption, platforms and status cells all computed to 0px, leaving
// QC — permanently "—" — as the only content-bearing column.
{
	console.log('review caption is readable at 768');
	const { ctx, page } = await open('/review', 768, 900);
	const rows = await page.evaluate(() =>
		[...document.querySelectorAll('td.td-cap')].map((td) => ({
			w: Math.round(td.getBoundingClientRect().width),
			text: (td.textContent || '').trim().slice(0, 40)
		}))
	);
	await ctx.close();
	if (!rows.length) bad('no caption cells found at 768 — is the queue empty?');
	else {
		const zero = rows.filter((r) => r.w === 0);
		if (zero.length) bad(`${zero.length} of ${rows.length} caption cells are 0px wide at 768`);
		else ok(`all ${rows.length} caption cells have width at 768 (min ${Math.min(...rows.map((r) => r.w))}px)`);
		const empty = rows.filter((r) => !r.text);
		if (empty.length) bad(`${empty.length} caption cells render no text at 768`);
		else ok('every caption renders its text at 768');
	}
}

// ── 2b. The caption survives every width in between, not just the two
//         widths that were measured. ─────────────────────────────────────────
// This is the check that was missing, and its absence is why a blocker shipped.
// The previous round measured 768 (311px) and 1280 (472px), concluded the
// caption was healthy, and never looked between them — where the portal's
// sidebar becomes persistent at 769px, takes 240px of content width, and left
// the caption at 67px: about eight of seventy-six characters, holding until
// ~1100. Endpoints are not a range.
{
	console.log('caption holds its width across the whole range');
	const MIN = 260; // ≈40 characters at the table's 13.12px
	const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1280, height: 900 } });
	const page = await ctx.newPage();
	await page.goto(`${BASE}/review`, { waitUntil: 'networkidle', timeout: 90000 });

	const samples = [];
	for (let w = 700; w <= 2560; w += 20) {
		await page.setViewportSize({ width: w, height: 900 });
		await page.waitForTimeout(60);
		const m = await page.evaluate(() => {
			const cap = document.querySelector('td.td-cap');
			if (!cap) return null; // below the table's own breakpoint — Deck view
			const cs = getComputedStyle(cap);
			if (cs.display === 'none') return { width: 0, hidden: true };
			const row = cap.closest('tr');
			const cols = [...row.children].filter((td) => getComputedStyle(td).display !== 'none').length;
			const main = document.querySelector('.portal-content') ?? document.body;
			return {
				width: Math.round(cap.getBoundingClientRect().width),
				cols,
				main: Math.round(main.getBoundingClientRect().width),
				hidden: false
			};
		});
		if (m) samples.push({ w, ...m });
	}
	await ctx.close();

	if (samples.length < 20) bad(`only ${samples.length} widths rendered a table — too few to judge`);
	else {
		// (a) The blocker property: the caption is readable at every width. This is
		//     the one that matters, and it is what caught 67px at 769.
		const starved = samples.filter((x) => x.width < MIN);
		if (starved.length) {
			const worst = starved.reduce((a, b) => (a.width < b.width ? a : b));
			bad(
				`caption is under ${MIN}px at ${starved.length} of ${samples.length} widths ` +
					`(worst ${worst.width}px at ${worst.w}px; range ${starved[0].w}–${starved[starved.length - 1].w})`
			);
		} else {
			const min = samples.reduce((a, b) => (a.width < b.width ? a : b));
			ok(`caption ≥ ${MIN}px at all ${samples.length} widths 700–2560 (narrowest ${min.width}px at ${min.w}px)`);
		}

		// (b) The coherence property. The critic's complaint was not that the
		//     caption changed width — it was that the table read as "three
		//     different tables with two cliff edges". Count the actual shapes.
		const shapes = [...new Set(samples.map((x) => x.cols))];
		if (shapes.length > 2)
			bad(`the table takes ${shapes.length} different column shapes across the range (${shapes.join(', ')} columns)`);
		else ok(`the table has ${shapes.length} column shape(s): ${shapes.join(' and ')} columns`);

		// (c) No unexplained narrowing. A caption may only lose width where
		//     something visibly changed: the column shape, or the space the table
		//     has to work in (the sidebar becomes persistent at 769 and takes
		//     240px the table cannot get back). A drop anywhere else is the
		//     reader's text shrinking for no reason they can see.
		//
		//     Deliberately NOT a flat "no change over N px" rule. That version
		//     fired on ordinary breakpoint reflow, I talked myself into calling it
		//     a false positive, and it turned out to be describing a real defect
		//     from the wrong angle. This asks the question that was actually meant.
		const unexplained = [];
		for (let i = 1; i < samples.length; i++) {
			const prev = samples[i - 1];
			const cur = samples[i];
			const drop = prev.width - cur.width;
			if (drop <= 50) continue;
			if (cur.cols !== prev.cols) continue; // the table changed shape — visible
			if (cur.main < prev.main) continue; // less room to work in — not ours
			unexplained.push(`${prev.w}→${cur.w}: ${prev.width}→${cur.width}px, same ${cur.cols} columns, same ${cur.main}px of room`);
		}
		if (unexplained.length)
			bad(`caption narrows with nothing to show for it at ${unexplained.length} step(s): ${unexplained.join('; ')}`);
		else ok('every caption narrowing is explained by a shape change or by lost room');
	}
}

// ── 2c. Nothing a column drops is actually lost. ──────────────────────────
// The fold onto the caption's meta line was described in a comment and dead in
// the stylesheet: the spans were switched on inside a media query and switched
// off again by a later base rule at equal specificity. So at 1280 the reviewer
// could not see the platform or the slot anywhere on the row.
{
	console.log('folded columns reappear on the caption meta line');
	for (const width of [1024, 1280, 1439]) {
		const { ctx, page } = await open('/review', width, 900);
		const r = await page.evaluate(() => {
			const cap = document.querySelector('td.td-cap');
			if (!cap) return null;
			const shown = (sel) => {
				const el = cap.querySelector(sel);
				return el && getComputedStyle(el).display !== 'none' ? (el.textContent || '').trim() : '';
			};
			const platCol = document.querySelector('td.td-plat');
			const slotCol = document.querySelector('td.td-slot');
			const colShown = (el) => !!el && getComputedStyle(el).display !== 'none';
			return {
				platInCol: colShown(platCol),
				slotInCol: colShown(slotCol),
				platInMeta: shown('.cm-plat'),
				slotInMeta: shown('.cm-slot')
			};
		});
		await ctx.close();
		if (!r) {
			bad(`@${width}: no table to check`);
			continue;
		}
		const platOk = r.platInCol || r.platInMeta.length > 0;
		const slotOk = r.slotInCol || r.slotInMeta.length > 0;
		if (!platOk) bad(`@${width}: platform is in neither a column nor the caption meta line`);
		if (!slotOk) bad(`@${width}: scheduled slot is in neither a column nor the caption meta line`);
		if (platOk && slotOk)
			ok(`@${width}: platform and slot are both readable (${r.platInCol ? 'column' : 'meta'} / ${r.slotInCol ? 'column' : 'meta'})`);
	}
}

// ── 2d. A decision is possible without scrolling. ────────────────────────
// Deck is what /review renders below 768, and it is the phone's triage mode:
// one card, approve or reject, next. Measured before this: at 360x780 the
// caption sat at y=830 and the approve control at y=984 against a 780px fold —
// past the bottom of the scroll container — so every single decision cost a
// scroll down and a scroll back, on the loop the product exists for.
//
// Tested at real device sizes rather than round numbers, and including the
// awkward wide-but-short case, which is the one that kept failing.
{
	console.log('a post can be decided without scrolling, on a phone');
	const SIZES = [
		[360, 780],
		[390, 844],
		[414, 896],
		[600, 800],
		[640, 900],
		[720, 1000],
		[767, 800]
	];
	const failed = [];
	for (const [w, h] of SIZES) {
		const { ctx, page } = await open('/review', w, h);
		const r = await page.evaluate(() => {
			const cap = document.querySelector('.deck-cap');
			const yes = document.querySelector('.dk-yes');
			if (!cap || !yes) return null;
			const inView = (el) => {
				const b = el.getBoundingClientRect();
				return b.top >= 0 && b.bottom <= window.innerHeight;
			};
			return { cap: inView(cap), approve: inView(yes) };
		});
		await ctx.close();
		if (!r) failed.push(`${w}x${h}: deck view did not render a card`);
		else if (!r.cap || !r.approve)
			failed.push(`${w}x${h}: ${[!r.cap && 'caption', !r.approve && 'approve'].filter(Boolean).join(' + ')} below the fold`);
	}
	if (failed.length) bad(`a decision needs scrolling at ${failed.length} of ${SIZES.length} sizes: ${failed.join('; ')}`);
	else ok(`caption and approve are both in the first viewport at all ${SIZES.length} device sizes`);
}

// ── 3. The sticky column covers nothing. ──────────────────────────────────
// The fix for round 3's off-screen actions bought them by parking an opaque
// sticky cell on top of STATUS and the last 65px of SLOT at 1280.
{
	console.log('review sticky actions occlude no data at 1280');
	const { ctx, page } = await open('/review', 1280, 900);
	const probe = await page.evaluate(() => {
		const out = [];
		let checked = 0;
		for (const tr of document.querySelectorAll('tbody tr')) {
			const act = tr.querySelector('td.td-act');
			if (!act) continue;
			const a = act.getBoundingClientRect();
			for (const sel of ['td.td-status', 'td.td-slot', 'td.td-cap']) {
				const cell = tr.querySelector(sel);
				// A cell that is not rendered cannot be occluded, and asserting that
				// it isn't proves nothing — only count cells that are actually on
				// screen, and report how many that was.
				if (!cell || getComputedStyle(cell).display === 'none') continue;
				const c = cell.getBoundingClientRect();
				if (c.width === 0) continue;
				checked++;
				if (c.right > a.left + 1 && c.left < a.right)
					out.push({ sel, c: Math.round(c.right), a: Math.round(a.left) });
			}
		}
		return { out, checked };
	});
	await ctx.close();
	if (!probe.checked) bad('no rendered data cells to test for occlusion at 1280 — the check would pass vacuously');
	else if (probe.out.length)
		bad(`${probe.out.length} of ${probe.checked} rendered cells sit under the sticky actions column (e.g. ${probe.out[0].sel} ends at ${probe.out[0].c}, actions start at ${probe.out[0].a})`);
	else ok(`none of ${probe.checked} rendered data cells is covered by the actions column at 1280`);
}

// ── 4. The legend counts what it names. ───────────────────────────────────
// It folded `partial` into published, `publishing` into scheduled and
// `rejected` into FAILED — verified dynamically at the time by rejecting a post
// and watching "failed" go up.
{
	console.log('calendar legend counts each status as itself');
	const { ctx, page } = await open('/calendar', 1280, 1000);
	const chips = await page.evaluate(() =>
		[...document.querySelectorAll('.stat-chip')].map((el) => {
			const n = el.querySelector('strong');
			return {
				label: (el.textContent || '').replace(/\s+/g, ' ').trim(),
				n: Number(n?.textContent ?? '-1')
			};
		})
	);
	await ctx.close();
	const labels = chips.map((c) => c.label.replace(/^\d+\s*/, '').split(' ')[0].toLowerCase());
	const dupes = labels.filter((l, i) => labels.indexOf(l) !== i);
	if (!chips.length) bad('no legend chips rendered');
	else if (dupes.length) bad(`legend has duplicate buckets: ${dupes.join(', ')}`);
	else if (labels.includes('failed') && labels.includes('rejected'))
		ok(`rejected and failed are separate chips (${chips.map((c) => `${c.n} ${c.label.replace(/^\d+\s*/, '')}`).join(' · ')})`);
	else ok(`legend chips: ${chips.map((c) => c.label).join(' · ')}`);
}

// ── 5. Focus is visible on the sidebar search. ────────────────────────────
// `.sidebar-persona-search-input:focus` kept `outline: none` with a 22%-alpha
// border one selector away from the ring that had just been fixed.
{
	console.log('sidebar search focus ring');
	const { ctx, page } = await open('/dashboard', 1280, 900);
	const input = page.locator('.sidebar-persona-search-input').first();
	if (!(await input.count())) ok('no sidebar search input on this account (nothing to check)');
	else {
		await input.focus();
		const style = await input.evaluate((el) => {
			const cs = getComputedStyle(el);
			return { w: cs.outlineWidth, s: cs.outlineStyle, c: cs.outlineColor };
		});
		if (style.s === 'none' || parseFloat(style.w) === 0)
			bad(`search input draws no ring (outline: ${style.w} ${style.s})`);
		else if (/rgba\([^)]*,\s*0(\.\d+)?\)/.test(style.c) && parseFloat(RegExp.$1 || '1') < 0.5)
			bad(`search input ring is near-transparent (${style.c})`);
		else ok(`visible ring: ${style.w} ${style.s} ${style.c}`);
	}
	await ctx.close();
}

// ── 6. A row action does not arm the bulk bar. ────────────────────────────
// Row Reject used to do `selected = new Set([item.id])`, ticking that row's
// checkbox and enabling Approve, Reject and Delete for a selection nobody made.
{
	console.log('row reject leaves the bulk selection alone');
	const { ctx, page } = await open('/review', 1600, 900);
	const before = await page.locator('.bulk-bar').count();
	const btn = page.locator('td.td-act button.row-no').first();
	if (!(await btn.count())) bad('no row reject button found');
	else {
		await btn.click();
		await page.waitForTimeout(300);
		const after = await page.locator('.bulk-bar').count();
		const checked = await page.locator('tbody input.tbl-check:checked').count();
		if (checked > 0) bad(`row reject ticked ${checked} row checkbox(es)`);
		else ok('no row checkbox was ticked');
		if (after > before) bad('row reject revealed the bulk action bar');
		else ok('the bulk action bar stayed hidden');
		const named = await page.locator('.rp-target').count();
		if (named) ok('the reason picker names the post it is about');
		else bad('the reason picker does not name its target post');
	}
	await ctx.close();
}

// ── 7. The persona hero counts on every tab. ──────────────────────────────
// "0 POSTS" came from deriving the count off a feed only fetched on two tabs.
{
	console.log('persona hero reports a real published count');
	const { ctx, page } = await open('/dashboard', 1440, 1000);
	const href = await page.locator('a[href^="/personas/"]').first().getAttribute('href');
	await ctx.close();
	if (!href) bad('no persona link on the dashboard to follow');
	else {
		const { ctx: c2, page: p2 } = await open(href, 1440, 1000);
		const stat = await p2.evaluate(() => {
			const chip = [...document.querySelectorAll('.stat-chip')].find((el) =>
				/published/i.test(el.textContent || '')
			);
			return chip ? (chip.querySelector('.stat-val')?.textContent ?? '').trim() : null;
		});
		await c2.close();
		// The old version fetched /api/review purely to print alongside the stat,
		// fell back to -1 when the shape did not match, and printed that -1 inside
		// a ✓ line as though it corroborated something. A number the check did not
		// validate does not belong in its output at all.
		if (stat === null) bad('no Published stat on the persona hero');
		else if (!/^\d+$/.test(stat)) bad(`the Published stat is not a number: "${stat}"`);
		else ok(`hero reports ${stat} published, from the server's count query`);
	}
}

// ── 8. The content plan is readable outside the wizard. ───────────────────
{
	console.log('content plan has a read-back surface');
	const { ctx, page } = await open('/brand-brief?tab=plan', 1280, 1000);
	const hasTab = await page.locator('button:has-text("Content Plan")').count();
	const body = (await page.locator('body').innerText()).toLowerCase();
	await ctx.close();
	if (!hasTab) bad('no Content Plan tab on /brand-brief');
	else ok('Content Plan tab is present');
	if (/content pillars|no content plan yet/.test(body)) ok('the tab renders the plan or an honest empty state');
	else bad('the Content Plan tab rendered neither a plan nor an empty state');
}

await browser.close();
console.log('');
if (fails.length) {
	console.log(`ROUND 5 CHECKS: ${fails.length} FAILED`);
	process.exit(1);
}
console.log('ROUND 5 CHECKS: all passed');
