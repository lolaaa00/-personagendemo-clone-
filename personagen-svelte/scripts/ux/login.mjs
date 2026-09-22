#!/usr/bin/env node
// Logs the audit tenant in through the REAL login form (not an API shortcut, so
// the session cookie is exactly the one a user gets) and saves one Playwright
// storage state per role.
//
//   node scripts/ux/login.mjs [--base http://localhost:5174] [--role owner]
//                             [--browser chromium|firefox|webkit] [--out .ux-audit/r3/money]
//
// ONE SESSION PER BROWSER. A storage state shared between browsers shares one
// GoTrue refresh-token family: when the first browser refreshes, the others
// present the old token, GoTrue treats that as token reuse and revokes the
// whole family — every browser of that role signed out mid-audit (round 2
// lost all 7 roles this way). With --browser the login runs IN that engine and
// the file is named state-<role>-<browser>.json, so each browser owns its own
// session. Use http://localhost, not 127.0.0.1: SvelteKit only drops the
// Secure cookie flag on localhost, and WebKit refuses Secure cookies over
// plain http on 127.0.0.1 — which is what forced the cookie-editing hack.
//
// Passwords are read from .ux-audit/accounts.json and never printed.
import { chromium, firefox, webkit } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { appRoot } from './sql.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('--base', 'http://localhost:5174').replace(/\/$/, '');
const only = opt('--role', null);
const engineName = opt('--browser', null);
const ENGINES = { chromium, firefox, webkit };
if (engineName && !ENGINES[engineName]) {
	console.error(`--browser must be one of ${Object.keys(ENGINES).join(', ')}`);
	process.exit(2);
}
const engine = ENGINES[engineName ?? 'chromium'];

const DIR = join(appRoot, '.ux-audit');
const OUT = resolve(appRoot, opt('--out', '.ux-audit'));
const accounts = JSON.parse(readFileSync(join(DIR, 'accounts.json'), 'utf8')).accounts;
mkdirSync(OUT, { recursive: true });
const stateName = (role) => (engineName ? `state-${role}-${engineName}.json` : `state-${role}.json`);

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

const browser = await engine.launch();
const results = [];
for (const [role, acct] of Object.entries(accounts)) {
	if (only && role !== only) continue;
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	const page = await ctx.newPage();
	let ok = false;
	let detail;
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
		if (ok) await ctx.storageState({ path: join(OUT, stateName(role)) });
	} catch (e) {
		detail = String(e.message).split('\n')[0].slice(0, 120);
	}
	results.push({ role, email: acct.email, browser: engineName ?? 'chromium', ok, detail });
	console.log(`${ok ? 'OK  ' : 'FAIL'} ${role.padEnd(9)} ${(engineName ?? 'chromium').padEnd(8)} -> ${detail}`);
	await ctx.close();
}
await browser.close();
writeFileSync(join(OUT, `login-report${engineName ? `-${engineName}` : ''}.json`), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
if (failed.length) { console.error(`\n${failed.length} role(s) could not log in`); process.exit(1); }
console.log(`\nall roles logged in; storage states written to ${OUT}`);
