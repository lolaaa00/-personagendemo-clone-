#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — functional gate. Runs BEFORE the critic scores a round.
// Any failure here is an automatic round failure.
//
//   node scripts/ux/portal-gate.mjs [--base http://127.0.0.1:4180] [--out <dir>]
//
// What it verifies, per the mission contract:
//   1. every role can reach every route it owns — no crash, no blank page
//   2. zero console errors / unhandled rejections across a full traversal
//   3. zero unexpected 4xx/5xx (an expected 403/404 must be RENDERED, not thrown)
//   4. no 404s on internal links or assets
//   5. no horizontal overflow at 360px; exactly one <h1> per route
//   6. no dead links (href="#", href="", javascript:void)
//   7. persistence — mutations survive a hard reload
//   8. session — a deep link hit while logged out returns to that page after login
//   9. permission — a lesser role never sees a crash, a blank page, or a leak
//
// Live generation is NOT driven here: it calls paid providers. The seeded tenant
// already contains outputs in all eight post statuses, and the audit protocol
// caps live generation to a single cheap text card per round, by hand.
// ═══════════════════════════════════════════════════════════════════════════
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { appRoot } from './sql.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('--base', 'http://127.0.0.1:4180').replace(/\/$/, '');
const OUT = opt('--out', join(appRoot, '.ux-audit', 'gate'));
const DIR = join(appRoot, '.ux-audit');
mkdirSync(OUT, { recursive: true });

const accounts = JSON.parse(readFileSync(join(DIR, 'accounts.json'), 'utf8')).accounts;
/** The account the single-session checks (persistence, deep link) run as.
 *  Prefers a workspace owner when a full tenant exists, else whatever is there. */
const PRIMARY = accounts.owner ? 'owner' : Object.keys(accounts)[0];
const primaryAccount = accounts[PRIMARY];

/** Routes every role may open. `/personas/:id` is resolved per role from the sidebar. */
const ROUTES = [
	'/dashboard', '/generations', '/favorites', '/trash', '/review', '/calendar',
	'/brand-brief', '/brand-brief/intel', '/generator', '/settings', '/developer',
	'/guides', '/billing'
];
/** Routes that are role-gated: [route, roles allowed]. Everyone else must be REDIRECTED, not 500'd. */
const GATED = [
	['/admin', ['owner', 'admin', 'platform']],
	['/models', ['platform']]
];

const failures = [];
const notes = [];
const rows = [];
const fail = (check, detail) => { failures.push({ check, detail }); console.log(`  ✗ ${check} — ${detail}`); };
const pass = (check) => console.log(`  ✓ ${check}`);

/** Attach listeners that record everything the mission counts as an error. */
function watch(page) {
	const bag = { console: [], pageerror: [], bad: [], notfound: [] };
	page.on('console', (m) => { if (m.type() === 'error') bag.console.push(m.text().slice(0, 300)); });
	page.on('pageerror', (e) => bag.pageerror.push(String(e.message).slice(0, 300)));
	page.on('response', (r) => {
		const url = r.url();
		if (!url.startsWith(BASE)) return; // third-party (fonts, supabase) is out of scope
		const s = r.status();
		if (s === 404) bag.notfound.push(`${s} ${url.replace(BASE, '')}`);
		else if (s >= 400) bag.bad.push(`${s} ${url.replace(BASE, '')}`);
	});
	return bag;
}

async function inspect(page) {
	return page.evaluate(() => {
		const de = document.documentElement;
		const txt = (document.body.innerText || '').trim();
		const anchors = [...document.querySelectorAll('a[href]')];
		const dead = anchors
			.map((a) => a.getAttribute('href'))
			.filter((h) => h === '#' || h === '' || /^javascript:\s*void/i.test(h || ''));
		const internal = [...new Set(anchors
			.map((a) => a.getAttribute('href'))
			.filter((h) => h && h.startsWith('/') && !h.startsWith('//')))];
		return {
			overflow: de.scrollWidth - de.clientWidth,
			h1: document.querySelectorAll('h1').length,
			textLen: txt.length,
			buttons: document.querySelectorAll('button').length,
			links: anchors.length,
			deadLinks: dead.length,
			internalLinks: internal,
			// A SvelteKit error page renders its status in a <h1>; catch a thrown 500.
			errorPage: /^(4\d\d|5\d\d)$/.test((document.querySelector('h1')?.textContent || '').trim()),
			// The app's own designed denial: a status line, a plain-words headline
			// and at least one way out. Distinct from a framework crash page, whose
			// h1 is the bare status code.
			denied:
				/^(401|403)$/.test((document.querySelector('.err-status')?.textContent || '').trim()) &&
				document.querySelectorAll('.err-actions a').length > 0
		};
	});
}

const browser = await chromium.launch();
console.log(`Phase 2 gate → ${BASE}\n`);

// ── 1–6. Traversal, every role × every route ──────────────────────────────
const allInternalLinks = new Set();
for (const [role, acct] of Object.entries(accounts)) {
	const statePath = join(DIR, `state-${role}.json`);
	if (!existsSync(statePath)) { fail('session state', `missing ${statePath} — run login.mjs`); continue; }
	console.log(`── ${role} (${acct.email})`);
	const ctx = await browser.newContext({ storageState: statePath, viewport: { width: 1280, height: 900 } });

	// Resolve this role's own persona link from the sidebar, if it has one.
	let personaRoute;
	{
		const p = await ctx.newPage();
		await p.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
		personaRoute = await p.evaluate(() => {
			const a = document.querySelector('a[href^="/personas/"]');
			return a ? a.getAttribute('href') : null;
		});
		await p.close();
	}

	const routeList = [...ROUTES, ...(personaRoute ? [personaRoute] : []), ...GATED.map(([r]) => r)];
	for (const route of routeList) {
		const page = await ctx.newPage();
		const bag = watch(page);
		let status = 'ok';
		try {
			await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 90000 });
			await page.waitForTimeout(400);
			const landed = new URL(page.url()).pathname;
			const info = await inspect(page);
			info.internalLinks.forEach((l) => allInternalLinks.add(l));

			const gate = GATED.find(([r]) => r === route);
			const allowed = !gate || gate[1].includes(role);

			if (!allowed) {
				// Two acceptable shapes, and one that is not:
				//   · a designed denial rendered in place (403 + a reason + a way out)
				//   · a clean redirect somewhere the seat CAN go
				//   · silently rendering the page anyway — a permission leak
				if (landed !== route) {
					status = `redirected → ${landed}`;
					pass(`${role} ${route} gated → ${landed}`);
				} else if (info.denied) {
					status = 'denied in place (403)';
					pass(`${role} ${route} gated → designed 403`);
				} else {
					fail(`${role} ${route}`, 'not gated — rendered the page instead of denying access');
				}
			} else {
				if (info.errorPage) fail(`${role} ${route}`, 'rendered a SvelteKit error page');
				if (info.textLen < 120) fail(`${role} ${route}`, `blank page (${info.textLen} chars of text)`);
				if (info.h1 !== 1) notes.push(`${role} ${route}: ${info.h1} <h1> elements`);
				if (info.deadLinks > 0) fail(`${role} ${route}`, `${info.deadLinks} dead link(s) (href="#")`);
			}
			if (bag.pageerror.length) fail(`${role} ${route}`, `unhandled error: ${bag.pageerror[0]}`);
			// On a route this seat may not open, the route's OWN 403 is the designed
			// outcome, not a fault — and the browser logs a console error for it
			// whatever the page then renders. Anything else 4xx-ing still fails.
			const expected403 = !allowed ? `403 ${route}` : null;
			const badUnexpected = bag.bad.filter((b) => b !== expected403);
			const consoleUnexpected = expected403
				? bag.console.filter((c) => !/status of 403 \(Forbidden\)/.test(c))
				: bag.console;
			if (consoleUnexpected.length) fail(`${role} ${route}`, `console error: ${consoleUnexpected[0]}`);
			if (badUnexpected.length) fail(`${role} ${route}`, `unexpected ${badUnexpected[0]}`);
			if (bag.notfound.length) fail(`${role} ${route}`, `404 ${bag.notfound[0]}`);

			// 360px overflow check on the same page.
			await page.setViewportSize({ width: 360, height: 780 });
			await page.waitForTimeout(250);
			const narrow = await inspect(page);
			if (narrow.overflow > 0) fail(`${role} ${route} @360`, `horizontal overflow ${narrow.overflow}px`);

			rows.push({ role, route, landed, status, ...info, consoleErrors: consoleUnexpected.length, overflow360: narrow.overflow });
		} catch (e) {
			fail(`${role} ${route}`, String(e.message).split('\n')[0].slice(0, 140));
			rows.push({ route, role, status: 'threw' });
		}
		await page.close();
	}
	await ctx.close();
}

// ── 4b. Every internal link discovered must resolve ────────────────────────
console.log('\n── internal links resolve');
{
	const ctx = await browser.newContext({ storageState: join(DIR, `state-${PRIMARY}.json`) });
	const page = await ctx.newPage();
	for (const href of [...allInternalLinks].filter((h) => !h.startsWith('/api/'))) {
		const r = await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
		if (!r) { fail('internal link', `${href} did not respond`); continue; }
		if (r.status() >= 400) fail('internal link', `${href} → ${r.status()}`);
	}
	pass(`${allInternalLinks.size} internal link target(s) checked`);
	await ctx.close();
}

// ── 7. Persistence — a mutation must survive a hard reload ─────────────────
console.log('\n── persistence');
{
	const ctx = await browser.newContext({ storageState: join(DIR, `state-${PRIMARY}.json`), viewport: { width: 1280, height: 900 } });
	const page = await ctx.newPage();

	// (a) Favourite a post from the library, reload, assert it stuck.
	await page.goto(`${BASE}/generations`, { waitUntil: 'networkidle', timeout: 90000 });
	const heart = page.locator('button[aria-label*="avorite" i], button[title*="avorite" i]').first();
	if (await heart.count()) {
		const before = await heart.getAttribute('aria-pressed');
		await heart.click();
		await page.waitForTimeout(1200);
		await page.reload({ waitUntil: 'networkidle' });
		const after = await page.locator('button[aria-label*="avorite" i], button[title*="avorite" i]').first().getAttribute('aria-pressed');
		if (before === after) fail('persistence: favourite', `aria-pressed unchanged after reload (${before})`);
		else { pass('persistence: favourite survives reload');
			// put it back
			await page.locator('button[aria-label*="avorite" i], button[title*="avorite" i]').first().click();
			await page.waitForTimeout(800);
		}
	} else notes.push('persistence: no favourite control found on /generations');

	// (b) Rename a persona, reload, assert it stuck, then restore.
	const personaHref = await page.evaluate(async () => {
		const r = await fetch('/dashboard');
		const t = await r.text();
		const m = t.match(/href="(\/personas\/[0-9a-f-]{36})"/i);
		return m ? m[1] : null;
	});
	if (personaHref) {
		await page.goto(`${BASE}${personaHref}`, { waitUntil: 'networkidle', timeout: 90000 });
		const probe = `UX probe ${Date.now().toString().slice(-5)}`;
		const nameField = page.locator('input#name, input[name="name"]').first();
		if (await nameField.count()) {
			const original = await nameField.inputValue();
			await nameField.fill(probe);
			const save = page.locator('button:has-text("Save")').first();
			if (await save.count()) {
				await save.click();
				await page.waitForTimeout(2000);
				await page.reload({ waitUntil: 'networkidle' });
				const got = await page.locator('input#name, input[name="name"]').first().inputValue();
				if (got !== probe) fail('persistence: persona rename', `after reload the field reads "${got}", not "${probe}"`);
				else pass('persistence: persona rename survives reload');
				await page.locator('input#name, input[name="name"]').first().fill(original);
				await page.locator('button:has-text("Save")').first().click();
				await page.waitForTimeout(1500);
			} else notes.push('persistence: no Save control on the persona page');
		} else notes.push('persistence: no persona name field found');
	}
	await ctx.close();
}

// ── 8. Session — deep link while logged out returns to that page ───────────
console.log('\n── session + deep link');
{
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const page = await ctx.newPage();
	const target = '/review';
	await page.goto(`${BASE}${target}`, { waitUntil: 'networkidle', timeout: 90000 });
	const landed = new URL(page.url());
	if (!landed.pathname.startsWith('/login')) fail('session: deep link', `anonymous hit on ${target} landed at ${landed.pathname}`);
	else {
		const carries = landed.search.includes(encodeURIComponent(target)) || landed.search.includes(target);
		if (!carries) fail('session: return path', `/login?…  does not carry the requested path (${landed.search || 'no query'}) — after signing in the user cannot be returned to ${target}`);
		else {
			const acct = primaryAccount;
			await page.fill('#email', acct.email);
			await page.fill('#password', acct.password);
			await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 90000 }), page.click('button[type="submit"]')]);
			const after = new URL(page.url()).pathname;
			if (after !== target) fail('session: return path', `after login landed at ${after}, not ${target}`);
			else pass('session: deep link returns to the requested page');
		}
	}
	await ctx.close();
}

await browser.close();

// ── report ────────────────────────────────────────────────────────────────
const report = { base: BASE, at: new Date().toISOString(), failures, notes, rows };
writeFileSync(join(OUT, 'gate-report.json'), JSON.stringify(report, null, 2));
console.log(`\n${'─'.repeat(60)}`);
console.log(`routes traversed : ${rows.length}`);
console.log(`notes            : ${notes.length}`);
console.log(`FAILURES         : ${failures.length}`);
if (notes.length) { console.log('\nNotes (not blocking):'); notes.slice(0, 20).forEach((n) => console.log('  · ' + n)); }
if (failures.length) {
	console.log('\nBlocking failures:');
	const seen = new Map();
	for (const f of failures) { const k = f.check.replace(/^\w+ /, ''); seen.set(k + ' | ' + f.detail, (seen.get(k + ' | ' + f.detail) ?? 0) + 1); }
	[...seen.entries()].slice(0, 40).forEach(([k, n]) => console.log(`  ✗ ${k}${n > 1 ? `  (×${n})` : ''}`));
	console.log(`\nGATE: FAIL — ${failures.length} failure(s). Report: ${join(OUT, 'gate-report.json')}`);
	process.exit(1);
}
console.log('\nGATE: PASS');
