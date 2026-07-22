// Verification driver for the Zernio Key Manager (Settings page).
// Disposable: deleted after the verify run.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const creds = JSON.parse(readFileSync(process.env.TEMP + '\\verify-user.json', 'utf8').replace(/^﻿/, ''));
const BASE = 'http://localhost:5173';
const SHOTS = join(process.cwd(), 'verify-shots');
mkdirSync(SHOTS, { recursive: true });

const log = (...a) => console.log('[verify]', ...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });

// Auto-accept confirm() dialogs, but record their text.
const dialogs = [];
page.on('dialog', async (d) => {
	dialogs.push(d.message());
	await d.accept();
});

// Surface app toasts + console errors.
page.on('console', (m) => {
	if (m.type() === 'error') console.log('[console.error]', m.text());
});

// ── 1. Login ────────────────────────────────────────────────────────────────
await page.goto(BASE + '/login');
await page.fill('input[type="email"]', 'verify-keymanager@personagen.test');
await page.fill('input[type="password"]', creds.pw);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard|portal|\/$/, { timeout: 20000 }).catch(() => {});
log('after login url =', page.url());

// ── 2. Settings → key manager card ──────────────────────────────────────────
await page.goto(BASE + '/settings');
await page.waitForSelector('text=Zernio Key Manager', { timeout: 20000 });
await page.waitForTimeout(1500); // let loadZernioKeys() resolve
await page.screenshot({ path: join(SHOTS, '1-card-empty.png'), fullPage: false });
const cardText = await page.locator('.settings-card', { hasText: 'Zernio Key Manager' }).innerText();
log('CARD INITIAL >>>', cardText.replace(/\n+/g, ' | ').slice(0, 400));

// ── 3. Add a key ─────────────────────────────────────────────────────────────
await page.fill('#zernio-key-label', 'verify-a@personagen.test');
await page.fill('#zernio-key-value', 'zk_test_verify_key_1234567890');
await page.click('button:has-text("Add Key")');
await page.waitForSelector('.provider-key-row:has-text("verify-a@personagen.test")', { timeout: 15000 });
log('key row appeared');
await page.screenshot({ path: join(SHOTS, '2-key-added.png') });

// ── 4. Test the key (fake → expect invalid/error) ───────────────────────────
await page.click('.provider-key-row:has-text("verify-a@personagen.test") button:has-text("Test")');
await page.waitForFunction(() => {
	const rows = [...document.querySelectorAll('.provider-key-row')];
	const row = rows.find((r) => r.textContent.includes('verify-a@personagen.test'));
	const pill = row?.querySelector('.status-pill');
	return pill && pill.textContent.trim() !== 'untested';
}, { timeout: 30000 });
const pillText = await page
	.locator('.provider-key-row:has-text("verify-a@personagen.test") .status-pill')
	.innerText();
log('status after test =', pillText);
await page.screenshot({ path: join(SHOTS, '3-key-tested.png') });

// ── 5. Assign persona "Verify Mia" to the key ────────────────────────────────
const miaRow = page.locator('.assign-row', { hasText: 'Verify Mia' });
const keyOptionValue = await page
	.locator('.assign-row select option', { hasText: 'verify-a@personagen.test' })
	.first()
	.getAttribute('value');
await miaRow.locator('select').selectOption(keyOptionValue);
await page.waitForTimeout(2000);
log('dialogs so far:', JSON.stringify(dialogs));
const miaVal = await miaRow.locator('select').inputValue();
log('mia select value after assign =', miaVal, '(expected', keyOptionValue + ')');
await page.screenshot({ path: join(SHOTS, '4-assigned.png') });

// ── 6. Reload → persistence ──────────────────────────────────────────────────
await page.reload();
await page.waitForSelector('text=Zernio Key Manager', { timeout: 20000 });
await page.waitForTimeout(1500);
const miaValAfterReload = await page
	.locator('.assign-row', { hasText: 'Verify Mia' })
	.locator('select')
	.inputValue();
log('mia select after reload =', miaValAfterReload, '(expected', keyOptionValue + ')');
const assignedNote = await page
	.locator('.provider-key-row:has-text("verify-a@personagen.test")')
	.innerText();
log('KEY ROW AFTER RELOAD >>>', assignedNote.replace(/\n+/g, ' | ').slice(0, 300));
await page.screenshot({ path: join(SHOTS, '5-persisted.png') });

// ── 7. Probe: cancel path — reassign Zoe but dismiss the confirm ─────────────
page.removeAllListeners('dialog');
page.on('dialog', async (d) => {
	dialogs.push('DISMISSED: ' + d.message());
	await d.dismiss();
});
const zoeRow = page.locator('.assign-row', { hasText: 'Verify Zoe' });
await zoeRow.locator('select').selectOption(keyOptionValue);
await page.waitForTimeout(1000);
const zoeVal = await zoeRow.locator('select').inputValue();
log('zoe select after CANCELLED assign =', JSON.stringify(zoeVal), '(expected "" = default)');

// ── 8. Delete the key (assigned to Mia → warning should mention revert) ─────
page.removeAllListeners('dialog');
page.on('dialog', async (d) => {
	dialogs.push('DELETE-CONFIRM: ' + d.message());
	await d.accept();
});
await page.click('.provider-key-row:has-text("verify-a@personagen.test") button:has-text("Delete Key")');
await page.waitForFunction(
	() => ![...document.querySelectorAll('.provider-key-row')].some((r) => r.textContent.includes('verify-a@personagen.test')),
	{ timeout: 15000 }
);
const miaAfterDelete = await page
	.locator('.assign-row', { hasText: 'Verify Mia' })
	.locator('select')
	.inputValue();
log('mia select after key delete =', JSON.stringify(miaAfterDelete), '(expected "" = default)');
await page.screenshot({ path: join(SHOTS, '6-deleted.png') });

log('ALL DIALOGS:', JSON.stringify(dialogs, null, 1));
await browser.close();
log('DONE');
