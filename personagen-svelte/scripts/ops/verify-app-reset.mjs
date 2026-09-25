// End-to-end check of the APP-sent password reset (no GoTrue mail involved):
//   1. mint a recovery token hash for <email> with the service role (exactly what /api/auth/reset does),
//   2. open <base>/api/auth/recover?token_hash=… in a fresh browser,
//   3. expect to land signed in on Settings → Profile with the set-a-new-password dialog (`reset=1`).
// With --send it also asks <base>/api/auth/reset to send the real email through Resend (needs RESEND_API_KEY on that server).
//
//   node --env-file=.env scripts/ops/verify-app-reset.mjs <email> [--base https://honeyx.monarchstack.com] [--send]
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const [email, ...rest] = process.argv.slice(2);
const flag = (n, d) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : d; };
const BASE = (flag('--base', 'https://honeyx.monarchstack.com')).replace(/\/$/, '');
const SEND = rest.includes('--send');
if (!email) { console.error('usage: node --env-file=.env scripts/ops/verify-app-reset.mjs <email> [--base url] [--send]'); process.exit(2); }
const admin = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
let fails = 0;
const rec = (ok, what, ev) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}\n      ${ev}`); };

// 1. token hash
const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
rec(!error && !!data?.properties?.hashed_token, 'service role mints a recovery token hash for the account', error ? error.message : `hash length ${data.properties.hashed_token.length}`);
if (error) process.exit(1);
const link = `${BASE}/api/auth/recover?token_hash=${encodeURIComponent(data.properties.hashed_token)}&next=${encodeURIComponent('/settings?section=profile&reset=1#password')}`;

// 2. open it like a reader would
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.goto(link, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const landed = new URL(page.url());
const state = await page.evaluate(() => ({ dialog: !!document.querySelector('[role="dialog"]'), dialogText: (document.querySelector('[role="dialog"]')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120), signedIn: !!document.querySelector('.portal-user-badge, .credit-pill'), passwordInputs: document.querySelectorAll('[role="dialog"] input[type="password"], input[type="password"]').length }));
rec(landed.pathname === '/settings' && landed.searchParams.get('reset') === '1', 'the link lands on Settings → Profile with reset=1', `${landed.pathname}${landed.search}${landed.hash}`);
rec(state.signedIn, 'the reader is signed in (session cookies set by verifyOtp)', `signed-in chrome present: ${state.signedIn}`);
rec(state.passwordInputs > 0, 'the set-a-new-password dialog is open', `dialog=${state.dialog} password inputs=${state.passwordInputs} "${state.dialogText}"`);
await page.screenshot({ path: 'node_modules/.ux-tmp/app-reset-landing.png' });

// 3. a used link is refused and explained
await page.goto(link, { waitUntil: 'networkidle' });
const again = new URL(page.url());
rec(again.pathname === '/reset-password' && again.searchParams.get('error') === 'expired', 'the same link a second time goes back to the reset page with the expired note', `${again.pathname}${again.search}`);
const note = await page.evaluate(() => (document.querySelector('.reset-error')?.textContent || '').trim());
rec(/already been used|expired/i.test(note), 'the reset page explains it plainly', `"${note}"`);
await browser.close();

// 4. optionally send the real email through the server
if (SEND) {
	const r = await fetch(`${BASE}/api/auth/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
	const j = await r.json().catch(() => ({}));
	rec(r.ok && j.success, 'the reset endpoint accepted the request (email handed to Resend if RESEND_API_KEY is set there)', `${r.status} ${JSON.stringify(j).slice(0, 120)}`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
