#!/usr/bin/env node
// Asserts round 3's blocker fixes at the surface they broke on, because the
// last round shipped a fix that had never been run.
//
//   node --import ./scripts/ux/dns-fix.mjs scripts/ux/verify-round3.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appRoot } from './sql.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4180';
const DIR = join(appRoot, '.ux-audit');
const role = Object.keys(JSON.parse(readFileSync(join(DIR, 'accounts.json'), 'utf8')).accounts)[0];

const fails = [];
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fails.push(m); console.log('  ✗ ' + m); };

const browser = await chromium.launch();

// ── 1. The sidebar focus ring must be VISIBLE, not merely present. ─────────
// It was `box-shadow: 0 0 0 2px var(--accent-mid)` with `outline: none`, and
// --accent-mid is 22% alpha, so the rule matched and drew nothing.
{
	console.log('sidebar focus ring');
	const ctx = await browser.newContext({ storageState: join(DIR, `state-${role}.json`), viewport: { width: 1280, height: 900 } });
	const page = await ctx.newPage();
	await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 90000 });
	const link = page.locator('.sidebar-nav-item').first();
	await link.focus();
	const style = await link.evaluate((el) => {
		const cs = getComputedStyle(el);
		return { matches: el.matches(':focus-visible'), width: cs.outlineWidth, style: cs.outlineStyle, color: cs.outlineColor };
	});
	if (!style.matches) bad('the sidebar link does not match :focus-visible');
	else if (style.style === 'none' || parseFloat(style.width) === 0) bad(`focus ring draws nothing (outline: ${style.width} ${style.style})`);
	else if (/rgba\([^)]*,\s*0\)/.test(style.color)) bad(`focus ring is fully transparent (${style.color})`);
	else ok(`visible ring: ${style.width} ${style.style} ${style.color}`);
	await ctx.close();
}

// ── 2. At 1280 the review actions must be ON SCREEN. ──────────────────────
// They sat ~149px past the right edge of a 926px scroller with no scrollbar,
// no fade and no shadow — the daily loop's primary verbs, invisible.
{
	console.log('review actions reachable at 1280');
	const ctx = await browser.newContext({ storageState: join(DIR, `state-${role}.json`), viewport: { width: 1280, height: 900 } });
	const page = await ctx.newPage();
	await page.goto(`${BASE}/review`, { waitUntil: 'networkidle', timeout: 90000 });
	await page.waitForTimeout(700);
	const btn = page.locator('td.td-act button').first();
	if (!(await btn.count())) bad('no row action buttons found — is the queue empty?');
	else {
		const box = await btn.boundingBox();
		if (!box) bad('the first row action has no box (not rendered)');
		else if (box.x + box.width > 1280) bad(`first row action extends to x=${Math.round(box.x + box.width)}, past the 1280 viewport`);
		else ok(`first row action ends at x=${Math.round(box.x + box.width)} (inside 1280)`);

		// And every row's Delete must share one x, so a pixel means one verb.
		const xs = await page.evaluate(() =>
			[...document.querySelectorAll('td.td-act')]
				.map((td) => td.querySelector('button:last-of-type')?.getBoundingClientRect().x)
				.filter((x) => x !== undefined)
				.map((x) => Math.round(x))
		);
		const distinct = [...new Set(xs)];
		if (xs.length < 2) bad('not enough rows to compare action alignment');
		else if (distinct.length > 1) bad(`Delete sits at ${distinct.length} different x positions (${distinct.join(', ')}) — a pixel is a different verb per row`);
		else ok(`Delete is at one x across all ${xs.length} rows (${distinct[0]})`);
	}
	await ctx.close();
}

// ── 3. The dashboard must not invent a score. ─────────────────────────────
// `70 + engagement*2.5 + connections*4` was floored at 70, so a persona with
// nothing scored 70/100 behind a green bar, and "Top Performers" returned all.
{
	console.log('dashboard reports measurement, not invention');
	const ctx = await browser.newContext({ storageState: join(DIR, `state-${role}.json`), viewport: { width: 1440, height: 1000 } });
	const page = await ctx.newPage();
	await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 90000 });
	await page.waitForTimeout(700);
	const headers = await page.evaluate(() => [...document.querySelectorAll('[role="columnheader"]')].map((e) => e.textContent.trim()));
	if (headers.includes('Performance')) bad('the invented Performance column is still rendered');
	else ok('no Performance column');
	if (await page.locator('.perf-bar').count()) bad('the score bar is still rendered');
	else ok('no score bar');

	const cells = await page.evaluate(() =>
		[...document.querySelectorAll('.published-cell')].map((e) => e.textContent.trim())
	);
	if (!cells.length) bad('no Published cells found');
	else if (!cells.some((c) => c === '—')) bad('no persona reports "—"; a roster with unpublished personas must');
	else if (!cells.some((c) => /^\d+$/.test(c))) bad('no persona reports a real count');
	else ok(`Published column mixes real counts and "—" (${cells.join(' ')})`);

	// "Top Performers" must be a strict subset whenever something has not published.
	const all = await page.locator('.dash-row:not(.row-header)').count();
	await page.locator('button:has-text("Top Performers")').first().click();
	await page.waitForTimeout(500);
	const top = await page.locator('.dash-row:not(.row-header)').count();
	if (top >= all && cells.includes('—')) bad(`Top Performers returned ${top} of ${all} — still not a filter`);
	else ok(`Top Performers narrows ${all} → ${top}`);
	await ctx.close();
}

// ── 4. The brand brief must not ship a third party's domain as a value. ────
{
	console.log('brand brief store URL');
	const ctx = await browser.newContext({ storageState: join(DIR, `state-${role}.json`), viewport: { width: 1280, height: 900 } });
	const page = await ctx.newPage();
	await page.goto(`${BASE}/brand-brief`, { waitUntil: 'networkidle', timeout: 90000 });
	await page.waitForTimeout(800);
	const field = page.locator('#scrape-store-url');
	if (!(await field.count())) ok('no store-url field on this brief (nothing to prefill)');
	else {
		const value = await field.inputValue();
		if (/honeyforx/i.test(value)) bad(`store URL still prefilled with "${value}"`);
		else ok(`store URL value is ${value ? `"${value}" (from the brief)` : 'empty'}`);
	}
	await ctx.close();
}

await browser.close();
console.log('');
if (fails.length) { console.log(`ROUND 3 CHECKS: ${fails.length} FAILED`); process.exit(1); }
console.log('ROUND 3 CHECKS: all passed');
