// Continuation: cancel-path probe + delete-key flow (state: key exists, Mia assigned).
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
const dialogs = [];

await page.goto(BASE + '/login');
await page.fill('input[type="email"]', 'verify-keymanager@personagen.test');
await page.fill('input[type="password"]', creds.pw);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 20000 });
await page.goto(BASE + '/settings');
await page.waitForSelector('text=Zernio Key Manager', { timeout: 20000 });
await page.waitForTimeout(1500);

// Disambiguated: the KEY row is the one showing the masked value (code.key-value).
const keyRow = page.locator('.provider-key-row:has(code.key-value)', { hasText: 'verify-a@personagen.test' });
log('key row text:', (await keyRow.innerText()).replace(/\n+/g, ' | ').slice(0, 250));
await page.screenshot({ path: join(SHOTS, '5-persisted.png') });

// ── Probe: reassign Zoe but DISMISS the confirm → select must snap back ─────
page.on('dialog', async (d) => { dialogs.push('DISMISSED: ' + d.message()); await d.dismiss(); });
const zoeRow = page.locator('.assign-row', { hasText: 'Verify Zoe' });
const keyOptionValue = await zoeRow.locator('option', { hasText: 'verify-a@personagen.test' }).getAttribute('value');
await zoeRow.locator('select').selectOption(keyOptionValue);
await page.waitForTimeout(800);
const zoeVal = await zoeRow.locator('select').inputValue();
log('zoe select after CANCELLED assign =', JSON.stringify(zoeVal), '(expected "")');

// ── Delete the key while assigned to Mia ─────────────────────────────────────
page.removeAllListeners('dialog');
page.on('dialog', async (d) => { dialogs.push('DELETE-CONFIRM: ' + d.message()); await d.accept(); });
await keyRow.locator('button:has-text("Delete Key")').click();
await page.waitForFunction(
	() => ![...document.querySelectorAll('code.key-value')].some((c) => c.closest('.provider-key-row')?.textContent.includes('verify-a@personagen.test')),
	{ timeout: 15000 }
);
await page.waitForTimeout(800);
const miaAfterDelete = await page.locator('.assign-row', { hasText: 'Verify Mia' }).locator('select').inputValue();
log('mia select after key delete =', JSON.stringify(miaAfterDelete), '(expected "")');
await page.screenshot({ path: join(SHOTS, '6-deleted.png') });

log('DIALOGS:', JSON.stringify(dialogs, null, 1));
await browser.close();
log('DONE');
