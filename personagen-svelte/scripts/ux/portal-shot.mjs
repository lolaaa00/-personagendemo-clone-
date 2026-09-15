#!/usr/bin/env node
// Screenshots of the authenticated portal, for review.
//
//   node scripts/ux/portal-shot.mjs <outDir> [--role owner] [--route /review]
//                                   [--viewports 360,768,1280,1920] [--theme light,dark]
//                                   [--base http://127.0.0.1:4180] [--full]
//
// Defaults: every role, every route, 360/768/1280/1920, light + dark, fold only.
// `--full` adds a full-page capture per route.
//
// Sessions come from .ux-audit/state-<role>.json (run login.mjs first).
import { chromium } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appRoot } from './sql.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const OUT = args[0] && !args[0].startsWith('--') ? args[0] : join(appRoot, '.ux-audit', 'shots');
const BASE = opt('--base', 'http://127.0.0.1:4180').replace(/\/$/, '');
const DIR = join(appRoot, '.ux-audit');
const onlyRole = opt('--role', null);
const onlyRoute = opt('--route', null);
const FULL = args.includes('--full');
const VIEWPORTS = opt('--viewports', '360,768,1280,1920').split(',').map((w) => Number(w.trim()));
const THEMES = opt('--theme', 'light,dark').split(',').map((t) => t.trim());

const ROUTES = [
	'/dashboard', '/review', '/calendar', '/generations', '/favorites', '/trash',
	'/brand-brief', '/brand-brief/intel', '/generator', '/settings', '/developer',
	'/guides', '/billing', '/admin', '/models'
];

const accounts = JSON.parse(readFileSync(join(DIR, 'accounts.json'), 'utf8')).accounts;
mkdirSync(OUT, { recursive: true });

const height = (w) => (w <= 400 ? 780 : w <= 800 ? 1024 : 900);
const browser = await chromium.launch();
const manifest = [];

for (const [role] of Object.entries(accounts)) {
	if (onlyRole && role !== onlyRole) continue;
	const statePath = join(DIR, `state-${role}.json`);
	if (!existsSync(statePath)) { console.log(`skip ${role} (no session)`); continue; }

	for (const theme of THEMES) {
		for (const w of VIEWPORTS) {
			const ctx = await browser.newContext({
				storageState: statePath,
				viewport: { width: w, height: height(w) },
				deviceScaleFactor: w <= 400 ? 2 : 1,
				colorScheme: theme
			});
			// The portal stores its theme itself; set both so the shot is not a
			// light page inside a dark chrome.
			await ctx.addInitScript((t) => {
				try { localStorage.setItem('theme', t); localStorage.setItem('personagen-theme', t); } catch { /* private mode */ }
			}, theme);

			// Resolve this role's own persona page once.
			let personaRoute = null;
			{
				const p = await ctx.newPage();
				await p.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
				personaRoute = await p.evaluate(() => document.querySelector('a[href^="/personas/"]')?.getAttribute('href') ?? null);
				await p.close();
			}

			const list = onlyRoute ? [onlyRoute] : [...ROUTES, ...(personaRoute ? [personaRoute] : [])];
			for (const route of list) {
				const page = await ctx.newPage();
				try {
					await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 90000 });
					await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
					await page.waitForTimeout(500);
					const landed = new URL(page.url()).pathname;
					const slug = route.replace(/\//g, '_').replace(/^_/, '') || 'root';
					const tag = `${role}-${theme}-${w}-${slug}`;
					await page.screenshot({ path: join(OUT, `${tag}.png`) });
					if (FULL) await page.screenshot({ path: join(OUT, `${tag}-full.png`), fullPage: true });
					manifest.push({ role, theme, width: w, route, landed, file: `${tag}.png` });
				} catch (e) {
					manifest.push({ role, theme, width: w, route, error: String(e.message).split('\n')[0].slice(0, 120) });
				}
				await page.close();
			}
			await ctx.close();
			console.log(`${role} ${theme} ${w}px — done`);
		}
	}
}
await browser.close();
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n${manifest.length} shots → ${OUT}`);
