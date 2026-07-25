import { chromium } from '@playwright/test';
const BASE='http://localhost:5199';
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}})).newPage();
await p.goto(`${BASE}/login`,{waitUntil:'networkidle'});
await p.fill('input[type="email"]','verify-manage@personagen.test');
await p.fill('input[type="password"]','VerifyManage!2026');
await Promise.all([p.waitForURL(u=>!u.pathname.includes('login'),{timeout:30000}),p.click('button[type="submit"]')]);

await p.goto(`${BASE}/brand-brief`,{waitUntil:'networkidle'}); await p.waitForTimeout(2500);
console.log('=== BRAND BRIEF tabs ===');
console.log(await p.locator('.tab-btn, [role=tab], nav button').allTextContents());
console.log('competitor cards now:', await p.locator('.competitor-card').count(), '| product cards:', await p.locator('.product-card').count());

const href = await p.locator('a[href^="/personas/"]').first().getAttribute('href').catch(()=>null);
console.log('=== PERSONA', href, '===');
if (href) {
  await p.goto(`${BASE}${href}`,{waitUntil:'networkidle'}); await p.waitForTimeout(3000);
  console.log('tab buttons:', (await p.locator('.tab-btn, .tabs button, [role=tab]').allTextContents()).slice(0,20));
  console.log('all buttons (first 30):', (await p.locator('button').allTextContents()).map(s=>s.trim().replace(/\s+/g,' ').slice(0,28)).filter(Boolean).slice(0,30));
  console.log('post tiles:', await p.locator('.post-tile').count(), '| asset cells:', await p.locator('.asset-cell').count());
  await p.screenshot({path:'C:/Users/nexal/AppData/Local/Temp/claude/c--Users-nexal-personagendemo/4e95539b-0f93-4073-b9d8-193148e5712e/scratchpad/shots/probe-persona.png', fullPage:false});
}
await b.close();
