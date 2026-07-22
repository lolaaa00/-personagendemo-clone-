// Element screenshot of the populated key manager card.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const creds = JSON.parse(readFileSync(process.env.TEMP + '\\verify-user.json', 'utf8').replace(/^﻿/, ''));
const BASE = 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 1400 } });
page.on('dialog', (d) => d.accept());

await page.goto(BASE + '/login');
await page.fill('input[type="email"]', 'verify-keymanager@personagen.test');
await page.fill('input[type="password"]', creds.pw);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 20000 });
await page.goto(BASE + '/settings');
await page.waitForSelector('text=Zernio Key Manager', { timeout: 20000 });
await page.waitForTimeout(1500);

await page.fill('#zernio-key-label', 'mia.agent@gmail.com');
await page.fill('#zernio-key-value', 'zk_live_demo_key_abcdef123456');
await page.click('button:has-text("Add Key")');
await page.waitForSelector('.provider-key-row:has(code.key-value)', { timeout: 15000 });

// Assign Mia so the card shows a real assignment.
const zoeRow = page.locator('.assign-row', { hasText: 'Verify Mia' });
const opt = await zoeRow.locator('option', { hasText: 'mia.agent@gmail.com' }).getAttribute('value');
await zoeRow.locator('select').selectOption(opt);
await page.waitForTimeout(1500);

const card = page.locator('.settings-card', { hasText: 'Zernio Key Manager' });
await card.scrollIntoViewIfNeeded();
await card.screenshot({ path: join(process.cwd(), 'verify-shots', '7-card-populated.png') });
await browser.close();
console.log('[verify] card screenshot captured');
