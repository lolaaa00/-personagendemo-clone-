import { chromium } from '@playwright/test';
const BASE='http://localhost:5199';
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}})).newPage();
p.on('dialog', d=>d.accept());
await p.goto(`${BASE}/login`,{waitUntil:'networkidle'});
await p.fill('input[type="email"]','verify-manage@personagen.test');
await p.fill('input[type="password"]','VerifyManage!2026');
await Promise.all([p.waitForURL(u=>!u.pathname.includes('login'),{timeout:30000}),p.click('button[type="submit"]')]);
const href = await p.locator('a[href^="/personas/"]').first().getAttribute('href');
await p.goto(`${BASE}${href}`,{waitUntil:'networkidle'}); await p.waitForTimeout(3000);
await p.locator('.tab-btn:has-text("Feed")').first().click(); await p.waitForTimeout(3000);
console.log('post tiles:', await p.locator('.post-tile').count());
console.log('tile-select inputs:', await p.locator('.tile-select input').count());
console.log('sel-toolbar:', await p.locator('.sel-toolbar').count());
const btns = (await p.locator('button').allTextContents()).map(s=>s.trim().replace(/\s+/g,' ')).filter(Boolean);
console.log('feed buttons:', JSON.stringify(btns.filter(t=>/asset|post|view/i.test(t)).slice(0,10)));
// try the Assets toggle
const at = p.locator('button:has-text("Assets")');
console.log('Assets toggle count:', await at.count());
if (await at.count()) { await at.first().click(); await p.waitForTimeout(2500); console.log('asset cells:', await p.locator('.asset-cell').count(), '| asset-select:', await p.locator('.asset-select input').count()); }
await b.close();
