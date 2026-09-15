#!/usr/bin/env node
// Logs the audit tenant in through the REAL login form (not an API shortcut, so
// the session cookie is exactly the one a user gets) and saves one Playwright
// storage state per role to .ux-audit/state-<role>.json.
//
//   node scripts/ux/login.mjs [--base http://127.0.0.1:5174] [--role owner]
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { appRoot } from './sql.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('--base', 'http://127.0.0.1:5174').replace(/\/$/, '');
const only = opt('--role', null);

const DIR = join(appRoot, '.ux-audit');
const accounts = JSON.parse(readFileSync(join(DIR, 'accounts.json'), 'utf8')).accounts;
mkdirSync(DIR, { recursive: true });

// Vite compiles a route the first time it is requested, and the portal shell is
// large enough that the first /dashboard hit can take well over 30s. Warm the
// two routes every login touches before timing anything.
process.stdout.write('warming routes… ');
{
	const warm = await chromium.launch();
	const ctx = await warm.newContext();
	const p = await ctx.newPage();
	for (const path of ['/login', '/dashboard']) {
		await p.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 180000 }).catch(() => {});
	}
	await warm.close();
	console.log('done');
}

const browser = await chromium.launch();
const results = [];
for (const [role, acct] of Object.entries(accounts)) {
	if (only && role !== only) continue;
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const page = await ctx.newPage();
	let ok = false, detail = '';
	try {
		await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
		await page.fill('#email', acct.email);
		await page.fill('#password', acct.password);
		await Promise.all([
			page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 120000 }),
			page.click('button[type="submit"]')
		]);
		await page.waitForLoadState('networkidle').catch(() => {});
		ok = !page.url().includes('/login');
		detail = new URL(page.url()).pathname;
		if (ok) await ctx.storageState({ path: join(DIR, `state-${role}.json`) });
	} catch (e) {
		detail = String(e.message).split('\n')[0].slice(0, 120);
	}
	results.push({ role, email: acct.email, ok, detail });
	console.log(`${ok ? 'OK  ' : 'FAIL'} ${role.padEnd(9)} -> ${detail}`);
	await ctx.close();
}
await browser.close();
writeFileSync(join(DIR, 'login-report.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
if (failed.length) { console.error(`\n${failed.length} role(s) could not log in`); process.exit(1); }
console.log('\nall roles logged in; storage states written');
