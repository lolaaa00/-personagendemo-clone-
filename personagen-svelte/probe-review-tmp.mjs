import { chromium } from '@playwright/test';
const BASE='http://localhost:5199';
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}})).newPage();
p.on('dialog', d=>d.accept());
await p.goto(`${BASE}/login`,{waitUntil:'networkidle'});
await p.fill('input[type="email"]','verify-manage@personagen.test');
await p.fill('input[type="password"]','VerifyManage!2026');
await Promise.all([p.waitForURL(u=>!u.pathname.includes('login'),{timeout:30000}),p.click('button[type="submit"]')]);
await p.goto(`${BASE}/review`,{waitUntil:'networkidle'}); await p.waitForTimeout(2500);
const del = p.locator('.btn-delete');
console.log('btn-delete count:', await del.count());
for (let i=0;i<Math.min(2, await del.count());i++){
  const el = del.nth(i);
  console.log(i, 'visible:', await el.isVisible(), '| enabled:', await el.isEnabled(), '| text:', (await el.textContent()||'').trim().slice(0,20));
  console.log('   box:', JSON.stringify(await el.boundingBox()));
}
console.log('card actions html sample:', (await p.locator('.queue-card').first().locator('.card-actions, .queue-actions').first().innerHTML().catch(()=>'n/a')).slice(0,400));
await b.close();
