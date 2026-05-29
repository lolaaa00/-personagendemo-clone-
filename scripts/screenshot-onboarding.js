#!/usr/bin/env node
/**
 * Screenshot each onboarding document's HTML for visual QA.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const DIST = path.join(__dirname, '..', 'dist', 'honeyforx');
const SHOTS = path.join(DIST, 'screenshots');

const FILES = [
  { html: '01-welcome-letter.html',   shots: ['01-welcome-header.png', '02-welcome-body.png'] },
  { html: '02-system-playbook.html',  shots: ['03-playbook-header.png', '04-playbook-tables.png', '05-playbook-setup.png'] },
  { html: '03-project-tracker.html',  shots: ['06-tracker-header.png', '07-tracker-board.png', '08-tracker-phases.png'] },
  { html: 'onboarding-packet.html',    shots: [
      'packet-01-cover.png',
      'packet-02-toc.png',
      'packet-03-welcome.png',
      'packet-04-playbook.png',
      'packet-05-tracker.png'
    ]
  }
];

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  for (const entry of FILES) {
    const htmlPath = path.join(DIST, entry.html);
    if (!fs.existsSync(htmlPath)) {
      console.log(`  ✗ Skipping ${entry.html} (not found)`);
      continue;
    }

    const page = await browser.newPage();
    await page.setViewport({ width: 850, height: 1100 });

    const html = fs.readFileSync(htmlPath, 'utf-8');
    await page.setContent(html, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluateHandle('document.fonts.ready');

    // Get total page height
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);

    // Divide into equal segments
    const numShots = entry.shots.length;
    const segHeight = Math.ceil(bodyHeight / numShots);

    for (let i = 0; i < numShots; i++) {
      const y = i * segHeight;
      const h = Math.min(segHeight, bodyHeight - y);
      const shotPath = path.join(SHOTS, entry.shots[i]);
      await page.screenshot({
        path: shotPath,
        clip: { x: 0, y, width: 850, height: h }
      });
      console.log(`✓ ${entry.shots[i]}`);
    }

    await page.close();
  }

  await browser.close();
  console.log(`\n✅ Screenshots saved to ${SHOTS}\n`);
})();
