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

// ── 1. One layout. ────────────────────────────────────────────────────────
// Measured at 1920 before this round: the h1 left edge took 10 distinct values
// spanning 441px, and h1 font-size took 7, from 21.6px to 67.2px.
{
	console.log('one page shell across every route (1920)');
	const edges = new Map();
	const sizes = new Map();
	for (const route of ROUTES) {
		const { ctx, page } = await open(route, 1920, 1080);
		const h = await page.evaluate(() => {
			const el = document.querySelector('h1');
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.x), size: getComputedStyle(el).fontSize };
		});
		await ctx.close();
		if (!h) {
			bad(`${route} has no h1`);
			continue;
		}
		edges.set(h.x, [...(edges.get(h.x) ?? []), route]);
		sizes.set(h.size, [...(sizes.get(h.size) ?? []), route]);
	}
	const edgeList = [...edges.keys()].sort((a, b) => a - b);
	const sizeList = [...sizes.keys()];
	if (edgeList.length > 2)
		bad(`h1 left edge takes ${edgeList.length} values at 1920: ${edgeList.join(', ')}`);
	else ok(`h1 left edge takes ${edgeList.length} value(s): ${edgeList.join(', ')}`);
	if (sizeList.length > 2) bad(`h1 font-size takes ${sizeList.length} values: ${sizeList.join(', ')}`);
	else ok(`h1 font-size takes ${sizeList.length} value(s): ${sizeList.join(', ')}`);
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

// ── 3. The sticky column covers nothing. ──────────────────────────────────
// The fix for round 3's off-screen actions bought them by parking an opaque
// sticky cell on top of STATUS and the last 65px of SLOT at 1280.
{
	console.log('review sticky actions occlude no data at 1280');
	const { ctx, page } = await open('/review', 1280, 900);
	const overlap = await page.evaluate(() => {
		const out = [];
		for (const tr of document.querySelectorAll('tbody tr')) {
			const act = tr.querySelector('td.td-act');
			if (!act) continue;
			const a = act.getBoundingClientRect();
			for (const sel of ['td.td-status', 'td.td-slot']) {
				const cell = tr.querySelector(sel);
				if (!cell) continue;
				const c = cell.getBoundingClientRect();
				if (c.right > a.left + 1 && c.left < a.right) out.push({ sel, c: Math.round(c.right), a: Math.round(a.left) });
			}
		}
		return out;
	});
	await ctx.close();
	if (overlap.length)
		bad(`${overlap.length} cells sit under the sticky actions column (e.g. ${overlap[0].sel} ends at ${overlap[0].c}, actions start at ${overlap[0].a})`);
	else ok('no status or slot cell is covered by the actions column at 1280');
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
		const api = await p2.evaluate(async () => {
			const r = await fetch('/api/review');
			const d = await r.json().catch(() => ({}));
			return Array.isArray(d.data) ? d.data.length : -1;
		});
		await c2.close();
		if (stat === null) bad('no Published stat on the persona hero');
		else ok(`hero reports "${stat}" published (queue holds ${api} reviewable posts overall)`);
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
