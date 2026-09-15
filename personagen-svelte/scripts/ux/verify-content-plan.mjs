#!/usr/bin/env node
// Drives the Content Plan wizard end to end and asserts it produces a real,
// persisted plan. Written because the rewrite was shipped, documented as fixed,
// and had never been clicked once: /api/engine refuses a request without
// ?path=, so every attempt returned 400 and the server handler was never
// reached. A feature is not fixed until something has actually run it.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appRoot } from './sql.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4180';
const DIR = join(appRoot, '.ux-audit');

const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: join(DIR, `state-${Object.keys(JSON.parse(readFileSync(join(DIR, 'accounts.json'), 'utf8')).accounts)[0]}.json`), viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const problems = [];
page.on('response', (r) => {
	if (r.url().includes('/api/engine') && r.status() >= 400) problems.push(`${r.status()} ${r.url().replace(BASE, '')}`);
});

// A brief must exist for the plan to be built from and saved onto.
await page.goto(`${BASE}/brand-brief`, { waitUntil: 'networkidle', timeout: 90000 });
const brandField = page.locator('input#brandName, input[name="brandName"]').first();
if (await brandField.count()) {
	await brandField.fill('Plan Verify Co');
	const save = page.locator('button:has-text("Save")').first();
	if (await save.count()) { await save.click(); await page.waitForTimeout(2500); }
}

await page.goto(`${BASE}/brand-brief/intel`, { waitUntil: 'networkidle', timeout: 90000 });

// Walk the wizard. Each step has its own gate (see canIntelProceed):
//   1 company name + industry · 2 one competitor URL · 3 content types · 4 a location
for (let step = 1; step <= 5; step++) {
	const company = page.locator('#intel-company-name');
	if ((await company.count()) && !(await company.inputValue())) await company.fill('Plan Verify Co');

	const industry = page.locator('#intel-industry-select');
	if ((await industry.count()) && !(await industry.inputValue())) {
		const value = await industry.evaluate((el) => {
			const opt = [...el.options].find((o) => o.value && !o.disabled);
			return opt ? opt.value : null;
		});
		if (value) await industry.selectOption(value).catch(() => {});
	}

	const audience = page.locator('#intel-target-audience');
	if ((await audience.count()) && !(await audience.inputValue())) {
		await audience.fill('Australian men 28-45 who already buy supplements');
	}

	// Step 2: at least one competitor URL.
	const compUrl = page.locator('main input[type="url"], main input[placeholder*="http" i], main input[placeholder*="competitor" i]').first();
	if ((await compUrl.count()) && !(await compUrl.inputValue())) {
		await compUrl.fill('https://example.test/a');
	}

	// Steps 3 and 4: toggle the first unselected chip (content type, location).
	const chip = page.locator('main button[aria-pressed="false"]').first();
	if (await chip.count()) await chip.click().catch(() => {});

	await page.waitForTimeout(350);

	if (await page.locator('button:has-text("Build my content plan")').count()) break;
	const next = page.locator('button:has-text("Next")').first();
	if (!(await next.count())) break;
	if (await next.isDisabled()) {
		const why = await page.evaluate(() => document.querySelector('main h2')?.textContent?.trim() ?? '');
		console.log(`stuck on "${why}" (step ${step}): Next is disabled`);
		break;
	}
	await next.click();
	await page.waitForTimeout(700);
}

const build = page.locator('button:has-text("Build my content plan")');
const reached = await build.count();
console.log('reached the build button:', reached > 0);
if (!reached) { console.log('could not reach step 5 — wizard gating changed'); await browser.close(); process.exit(1); }

await build.click();
await page.waitForTimeout(4000);

const result = await page.evaluate(() => ({
	heading: document.querySelector('.results-title h3')?.textContent?.trim() ?? null,
	pillars: document.querySelectorAll('.pillar-card').length,
	scheduleRows: document.querySelectorAll('.schedule-table .table-row').length,
	platforms: document.querySelectorAll('.plat-card').length,
	commitment: document.querySelectorAll('.commit-stat').length,
	provenance: !!document.querySelector('.provenance'),
	error: document.querySelector('.intel-error')?.textContent?.trim() ?? null,
	bodyHasRawError: /Missing path parameter|HTTP 4\d\d/.test(document.body.innerText)
}));
console.log(JSON.stringify(result, null, 1));

const fail = [];
if (result.error) fail.push(`error shown: ${result.error}`);
if (result.bodyHasRawError) fail.push('raw internal error string rendered to the user');
if (!result.heading) fail.push('no results heading — step 6 never rendered');
if (result.pillars < 1) fail.push('no content pillars');
if (result.scheduleRows < 1) fail.push('no weekly schedule');
if (result.platforms < 1) fail.push('no platform order');
if (!result.provenance) fail.push('no provenance section');
if (problems.length) fail.push(`engine returned ${problems.join(', ')}`);

// It must also have been SAVED onto the brief: reload and look for it.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const persisted = await page.evaluate(async () => {
	const r = await fetch('/api/engine?path=personagen-brand-brief', {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'get_brief' })
	});
	const b = await r.json();
	// get_brief has returned the brief under two shapes over its life; accept
	// either rather than reporting a false negative about the save.
	const brief = b?.data?.data ?? b?.data ?? b;
	const cs = brief?.contentStrategy;
	return { ok: r.ok, hasStrategy: !!cs, builtAt: cs?.builtAt ?? null, slots: cs?.schedule?.length ?? 0 };
});
console.log('persisted onto the brief:', JSON.stringify(persisted));
if (!persisted.hasStrategy) fail.push('the plan was not saved onto the brand brief');

await browser.close();
if (fail.length) { console.log('\nFAIL:\n' + fail.map((f) => '  · ' + f).join('\n')); process.exit(1); }
console.log('\nPASS — the wizard produces a real plan and saves it.');
