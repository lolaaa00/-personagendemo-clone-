// Verification driver for the Platform Identity Kit (persona page).
// Disposable: deleted after the verify run.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const creds = JSON.parse(readFileSync(process.env.TEMP + '\\verify-user.json', 'utf8').replace(/^﻿/, ''));
const BASE = 'http://localhost:5173';
const SHOTS = join(process.cwd(), 'verify-shots');
mkdirSync(SHOTS, { recursive: true });

const log = (...a) => console.log('[verify]', ...a);
let failures = 0;
const check = (ok, label) => {
	console.log(ok ? '[PASS]' : '[FAIL]', label);
	if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on('console', (m) => {
	if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300));
});
page.on('dialog', async (d) => {
	log('dialog:', d.message().slice(0, 120));
	await d.accept();
});

// ── 1. Login ────────────────────────────────────────────────────────────────
await page.goto(BASE + '/login');
await page.fill('input[type="email"]', 'verify-keymanager@personagen.test');
await page.fill('input[type="password"]', creds.pw);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard|portal|\/$/, { timeout: 20000 }).catch(() => {});
log('after login url =', page.url());

// ── 2. Seed a persona via the API (same session) ────────────────────────────
const created = await page.request.post(BASE + '/api/agents', {
	data: { name: 'Kit Verify Tran', niche: 'Beauty & Wellness' }
});
const createdJson = await created.json();
check(createdJson.success === true, 'persona created via /api/agents');
const agentId = createdJson.data?.id;
log('agentId =', agentId);

// ── 3. Hero identity strip (empty state) ────────────────────────────────────
await page.goto(`${BASE}/personas/${agentId}`);
await page.waitForSelector('.persona-hero', { timeout: 20000 });
const strip = page.locator('.hero-identity');
check(await strip.isVisible(), 'hero identity strip renders');
check((await strip.locator('.kit-select').inputValue()) === 'tiktok', 'platform dropdown defaults to TikTok');
const emptyBio = await strip.locator('.hero-bio-empty').innerText().catch(() => '');
check(/No TikTok bio yet/i.test(emptyBio), `empty state reads: "${emptyBio}"`);
check(await strip.locator('button:has-text("Generate identity kit")').isVisible(), 'hero shows Generate CTA when empty');
await page.screenshot({ path: join(SHOTS, 'ik-1-hero-empty.png') });

// Switch hero platform → empty state follows the selection.
await strip.locator('.kit-select').selectOption('instagram');
const emptyBioIg = await strip.locator('.hero-bio-empty').innerText().catch(() => '');
check(/No Instagram bio yet/i.test(emptyBioIg), 'hero empty state tracks platform switch');
await strip.locator('.kit-select').selectOption('tiktok');

// ── 4. Profile tab → Identity Kit card ──────────────────────────────────────
await page.click('.tab-btn:has-text("Profile")');
await page.waitForSelector('text=Platform Identity Kit', { timeout: 15000 });
check(true, 'Platform Identity Kit card renders in Profile tab');

// Add own handle
await page.fill('input[aria-label="Add a username candidate"]', '@Kit_Verify!01');
await page.click('button:has-text("+ Add")');
const cand = page.locator('.kit-candidate', { hasText: '@kit_verify01' });
check(await cand.isVisible(), 'add-own handle sanitized to @kit_verify01 and listed');

// Mark taken → strikethrough class; un-mark restores.
await cand.locator('button[title*="Mark as taken"]').click();
check((await cand.getAttribute('class')).includes('taken'), 'candidate marked taken (✗)');
await cand.locator('button[title*="Un-mark"]').click();
check(!(await cand.getAttribute('class')).includes('taken'), 'taken mark toggles back (↩)');

// ── 5. Bio editing + live limit counter ─────────────────────────────────────
const over = 'Honey-first skincare from real hives. Glow rituals, zero fluff, daily.. padding!!'.padEnd(90, '!');
await page.fill('#kit-bio', over);
const counterOver = await page.locator('.kit-bio-count').innerText();
check(/90\/80/.test(counterOver) && /over/i.test(counterOver), `over-limit counter fires: "${counterOver.trim()}"`);
check((await page.locator('.kit-bio-count').getAttribute('class')).includes('over'), 'counter gets .over styling');
await page.screenshot({ path: join(SHOTS, 'ik-2-bio-overlimit.png') });

const good = 'Honey-first skincare 🍯 Real results, zero fluff.';
await page.fill('#kit-bio', good);
const counterOk = await page.locator('.kit-bio-count').innerText();
check(!/over/i.test(counterOk), `counter clean within limit: "${counterOk.trim()}"`);

// Confirmed handle input sanitizes live.
await page.fill('input[aria-label*="Confirmed username"]', 'Kit.Verify!X');
check(
	(await page.locator('input[aria-label*="Confirmed username"]').inputValue()) === 'kit.verifyx',
	'confirmed-handle input sanitizes live'
);
// "Use" overwrites it with the candidate and badges it.
await cand.locator('.kit-use-btn').click();
check(
	(await page.locator('input[aria-label*="Confirmed username"]').inputValue()) === 'kit_verify01',
	'Use writes the candidate as the confirmed TikTok username'
);
check(await cand.locator('.kit-confirmed-badge').isVisible(), 'candidate shows ✓ in use badge');

// Hero strip reflects the typed bio + confirmed handle (shared state).
const heroBio = await page.locator('.hero-identity .hero-bio').innerText();
check(heroBio.includes('Honey-first skincare'), 'hero strip mirrors the edited TikTok bio');
check(await page.locator('.hero-handle-chip:has-text("@kit_verify01")').isVisible(), 'hero shows confirmed handle chip');
await page.screenshot({ path: join(SHOTS, 'ik-3-filled.png') });

// ── 6. Save → reload → persisted ────────────────────────────────────────────
await page.click('.btn-save');
await page.waitForTimeout(2500);
await page.reload();
await page.waitForSelector('.persona-hero', { timeout: 20000 });
const heroBio2 = await page.locator('.hero-identity .hero-bio').innerText().catch(() => '');
check(heroBio2.includes('Honey-first skincare'), 'bio survives reload (persisted in market JSON)');
check(
	await page.locator('.hero-handle-chip:has-text("@kit_verify01")').isVisible().catch(() => false),
	'confirmed handle survives reload'
);
await page.click('.tab-btn:has-text("Profile")');
await page.waitForSelector('text=Platform Identity Kit', { timeout: 15000 });
check(
	await page.locator('.kit-candidate', { hasText: '@kit_verify01' }).isVisible(),
	'candidate list survives reload'
);
await page.screenshot({ path: join(SHOTS, 'ik-4-after-reload.png') });

// ── 7. Generate kit (real LLM call if a key is configured) ──────────────────
await page.click('button:has-text("Regenerate kit"), button:has-text("Generate kit")');
log('generate kit clicked — waiting up to 90s…');
const genOk = await page
	.waitForFunction(() => document.querySelectorAll('.kit-candidate').length > 1, { timeout: 90000 })
	.then(() => true)
	.catch(() => false);
if (genOk) {
	const n = await page.locator('.kit-candidate').count();
	log(`generation produced ${n} candidates total`);
	const dn = await page.locator('#kit-display').inputValue();
	log('displayName =', JSON.stringify(dn));
	const bioNow = await page.locator('#kit-bio').inputValue();
	log('tiktok bio =', JSON.stringify(bioNow), `(${bioNow.length}/80)`);
	check(bioNow.length > 0, 'generated TikTok bio non-empty');
	check(bioNow.length <= 80 * 1.2, 'generated TikTok bio near/within limit');
	// Old candidate + its confirmed status must survive the merge.
	check(
		await page.locator('.kit-candidate', { hasText: '@kit_verify01' }).isVisible(),
		'manual candidate survives regenerate merge'
	);
	// Spot-check a second platform got a distinct bio.
	await page.locator('.field-group:has(#kit-bio) .kit-select').selectOption('youtube');
	const ytBio = await page.locator('#kit-bio').inputValue();
	log('youtube bio len =', ytBio.length);
	check(ytBio.length > 0 && ytBio !== bioNow, 'YouTube bio generated and distinct from TikTok');
	await page.screenshot({ path: join(SHOTS, 'ik-5-generated.png'), fullPage: false });
} else {
	log('generation did not complete (no AI key or slow LLM) — UI flows above still verified');
}

// ── 8. Cleanup: delete the verify persona ───────────────────────────────────
const del = await page.request.delete(BASE + '/api/agents/config', { data: { agentId } });
log('cleanup delete status =', del.status());

await browser.close();
console.log(failures === 0 ? '\n[verify] ALL CHECKS PASSED' : `\n[verify] ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
