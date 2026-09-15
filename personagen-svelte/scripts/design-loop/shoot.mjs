// Usage: node shoot.mjs <outDir> [baseUrl]
// Shoots the public funnel from several viewpoints + zoom levels, light + dark.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'shots';
const base = process.argv[3] ?? 'http://127.0.0.1:5173';
mkdirSync(out, { recursive: true });

const pages = [
  { name: 'landing', path: '/' },
  { name: 'signup', path: '/signup' },
  { name: 'login', path: '/login' }
];
const views = [
  { name: 'desktop', width: 1440, height: 900, scale: 1 },
  { name: 'laptop', width: 1280, height: 800, scale: 1 },
  { name: 'tablet', width: 834, height: 1112, scale: 1 },
  { name: 'mobile', width: 390, height: 844, scale: 2 }
];

const browser = await chromium.launch();
const errors = [];
for (const theme of ['light', 'dark']) {
  for (const v of views) {
    const ctx = await browser.newContext({
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: v.scale,
      colorScheme: theme
    });
    for (const p of pages) {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`[${theme}/${v.name}/${p.name}] pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${theme}/${v.name}/${p.name}] console.error: ${m.text()}`); });
      await page.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('personagen-theme', t); } catch {} }, theme);
      await page.goto(base + p.path, { waitUntil: 'networkidle' });
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(600);
      // horizontal overflow check
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) errors.push(`[${theme}/${v.name}/${p.name}] horizontal overflow ${overflow}px`);
      const tag = `${p.name}-${theme}-${v.name}`;
      await page.screenshot({ path: join(out, `${tag}-fold.png`) });
      await page.screenshot({ path: join(out, `${tag}-full.png`), fullPage: true });
      if (p.name === 'landing' && v.name === 'desktop') {
        // zoomed-in detail crops of key areas (sticky nav hidden so it cannot bleed into a crop)
        await page.addStyleTag({ content: '.lp-nav{visibility:hidden}' });
        for (const [sel, label] of [['.lp-hero, header', 'nav-hero'], ['#compare', 'compare'], ['#pricing', 'pricing'], ['#how', 'how'], ['#features', 'features'], ['.lp-trust', 'trust'], ['.lp-receipt-row', 'receipt'], ['.lp-final', 'final'], ['.lp-footer', 'footer']]) {
          const el = page.locator(sel).first();
          if (await el.count()) { await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await el.screenshot({ path: join(out, `${tag}-zoom-${label}.png`) }).catch(()=>{}); }
        }
        await page.addStyleTag({ content: '.lp-nav{visibility:visible}' });
        // 2x zoom of hero CTA area
        const ctx2 = await browser.newContext({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2, colorScheme: theme });
        const pz = await ctx2.newPage();
        await pz.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
        await pz.goto(base + p.path, { waitUntil: 'networkidle' });
        await pz.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await pz.waitForTimeout(400);
        await pz.screenshot({ path: join(out, `${tag}-zoom2x-top.png`) });
        await ctx2.close();
      }
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
console.log(JSON.stringify({ errors }, null, 2));
