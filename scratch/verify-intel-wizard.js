#!/usr/bin/env node
/**
 * PersonaGen IntelWizard End-to-End Verification Script
 * Launches a static server, runs Puppeteer to step through the entire 6-step content pipeline,
 * and ensures no console errors or UI dead-ends occur.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const PORT = 3456;
const PUBLIC_DIR = path.join(__dirname, '..', 'dist', 'honeyforx');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

// ── 1. Create a Lightweight Static HTTP Server ──
const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  let filePath = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);

  // Intercept favicon to prevent 404 console errors in headless browser
  if (urlPath === '/favicon.ico') {
    res.writeHead(204, { 'Content-Type': 'image/x-icon' });
    res.end();
    return;
  }

  // Security: check path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    res.end('Forbidden');
    console.log(`❌ Forbidden path: ${urlPath}`);
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to .html suffix if requested without it
      const withHtml = filePath + '.html';
      if (fs.existsSync(withHtml)) {
        filePath = withHtml;
      } else {
        res.statusCode = 404;
        res.end('Not Found');
        console.log(`❌ 404 Not Found: ${urlPath} (resolved as: ${filePath})`);
        return;
      }
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

// Start server
server.listen(PORT, async () => {
  console.log(`📡 Local verification server listening on http://localhost:${PORT}`);
  
  try {
    await runVerification();
  } catch (err) {
    console.error('❌ Verification failed:', err);
    process.exit(1);
  } finally {
    server.close(() => {
      console.log('🔌 Verification server stopped.');
      process.exit(0);
    });
  }
});

// ── 2. Run Puppeteer E2E Test ──
async () => {}; // keeps linter happy
async function runVerification() {
  console.log('🚀 Launching headless browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });

  // Capture console messages & errors
  const consoleErrors = [];
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleErrors.push(text);
      console.log(`[BROWSER ERROR] ${text}`);
    } else {
      consoleLogs.push(text);
    }
  });

  // Track 404 responses
  page.on('response', response => {
    if (response.status() === 404) {
      console.log(`[404 NOT FOUND] ${response.url()}`);
    }
  });

  // Inject session unlock on every new page load BEFORE the document scripts execute!
  await page.evaluateOnNewDocument(() => {
    sessionStorage.setItem('pg_portal_unlocked', 'yes');
  });

  console.log('🔄 Navigating straight to Intelligence Wizard subview with credentials...');
  await page.goto(`http://localhost:${PORT}/intel-wizard.html`, { waitUntil: 'networkidle2' });

  // Small delay to ensure scripts execute and mount finishes
  await new Promise(resolve => setTimeout(resolve, 1500));

  console.log('Current URL:', await page.url());
  
  // Screenshot directory
  const outDir = path.join(__dirname, '..', 'scratch');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('\n--- Pipeline Step 1: Trend Discovery ---');
  // Check that the wizard is mounted
  const mountExists = await page.evaluate(() => !!document.getElementById('intel-wizard-mount'));
  if (!mountExists) {
    const currentHTML = await page.evaluate(() => document.body.innerHTML);
    await page.screenshot({ path: path.join(outDir, 'mount_error_screenshot.png') });
    console.log('Mount Error Snapshot saved to scratch/mount_error_screenshot.png');
    console.log('Body HTML length:', currentHTML.length);
    console.log('Body HTML sample:', currentHTML.substring(0, 1500));
    throw new Error('Intelligence Wizard failed to mount in the DOM (#intel-wizard-mount not found).');
  }
  console.log('✅ Intelligence Wizard mounted successfully.');

  // Click Niche "Tech & AI Automation" (id 'tech' inside CARD or we can click tech card)
  await page.evaluate(() => {
    IntelWizard.selectNiche('tech');
  });
  console.log('👉 Selected Niche: Tech & AI Automation');
  await new Promise(resolve => setTimeout(resolve, 500));

  // Click Trend "Autonomous Coding Agents" (t2)
  await page.evaluate(() => {
    IntelWizard.selectTrend('t2');
  });
  console.log('👉 Selected Topic Trend: Autonomous Coding Agents');
  await new Promise(resolve => setTimeout(resolve, 500));

  await page.screenshot({ path: path.join(outDir, 'wizard_step1.png') });
  
  // Transition to Step 2
  console.log('👉 Transitioning to Step 2 (Channel Explorer)...');
  await page.evaluate(() => IntelWizard.nextStep());
  await new Promise(resolve => setTimeout(resolve, 800));

  console.log('\n--- Pipeline Step 2: Channel Explorer ---');
  // Verify Step 2 is active
  let step = await page.evaluate(() => document.querySelector('.wiz-step-node.active .wiz-step-circle')?.textContent?.trim());
  console.log(`Current Step Indicator: ${step}`);

  // Click competitor creator "Devin Explains" (c1)
  await page.evaluate(() => {
    IntelWizard.selectCompetitor('c1');
  });
  console.log('👉 Selected Competitor: Devin Explains (@devinexplains)');
  await new Promise(resolve => setTimeout(resolve, 500));

  await page.screenshot({ path: path.join(outDir, 'wizard_step2.png') });

  // Transition to Step 3
  console.log('👉 Transitioning to Step 3 (Social Scout)...');
  await page.evaluate(() => IntelWizard.nextStep());
  await new Promise(resolve => setTimeout(resolve, 800));

  console.log('\n--- Pipeline Step 3: Social Scout ---');
  // Click first viral post of Devin Explains (p4_1 - "I built an autonomous AI coding agent in 30 lines...")
  await page.evaluate(() => {
    IntelWizard.selectPost('p4_1');
  });
  console.log('👉 Selected Viral Post: "I built an autonomous AI coding agent..."');
  await new Promise(resolve => setTimeout(resolve, 500));

  await page.screenshot({ path: path.join(outDir, 'wizard_step3.png') });

  // Transition to Step 4 (Starts scanning automatically)
  console.log('👉 Transitioning to Step 4 (Content Decoder - Holographic Scan)...');
  await page.evaluate(() => IntelWizard.nextStep());
  await new Promise(resolve => setTimeout(resolve, 500));

  console.log('\n--- Pipeline Step 4: Content Decoder ---');
  // Wait for holographic scanner logs and animation to complete (usually takes around 2.4s)
  console.log('⏳ Waiting for holographic scan to complete...');
  let scanning = true;
  for (let attempt = 0; attempt < 15; attempt++) {
    scanning = await page.evaluate(() => {
      // check state via exposed object if accessible, or check if scanning logs container is gone or success rendered
      const isScanFinished = !document.getElementById('wiz-scan-logs-container');
      const hasScorecard = !!document.querySelector('.wiz-layer-item');
      return !hasScorecard || !isScanFinished;
    });
    if (!scanning) {
      console.log('✅ Holographic Scan complete. 9-Layer Scorecard rendered.');
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await page.screenshot({ path: path.join(outDir, 'wizard_step4.png') });

  // Transition to Step 5
  console.log('👉 Transitioning to Step 5 (Feed Agent)...');
  await page.evaluate(() => IntelWizard.nextStep());
  await new Promise(resolve => setTimeout(resolve, 800));

  console.log('\n--- Pipeline Step 5: Feed Agent (AI Agent Training) ---');
  // Verify agent Sofia/Marcus is active or selectable.
  // Click the "Train AI Creator" button
  console.log('👉 Triggering AI Creator Training...');
  await page.evaluate(() => {
    IntelWizard.trainAgent();
  });

  // Wait for training terminal feedback logs to complete (usually takes 1.8s)
  console.log('⏳ Training AI Agent with new parameters...');
  let training = true;
  for (let attempt = 0; attempt < 15; attempt++) {
    training = await page.evaluate(() => {
      const hasDrafts = !!document.querySelector('.wiz-draft-card');
      return !hasDrafts;
    });
    if (!training) {
      console.log('✅ AI Creator successfully retrained and custom drafts generated!');
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await page.screenshot({ path: path.join(outDir, 'wizard_step5.png') });

  // Transition to Step 6
  console.log('👉 Transitioning to Step 6 (Content Studio)...');
  await page.evaluate(() => IntelWizard.nextStep());
  await new Promise(resolve => setTimeout(resolve, 800));

  console.log('\n--- Pipeline Step 6: Content Studio Stages ---');
  // Check if draft items are correctly loaded in the list
  const finalChecks = await page.evaluate(() => {
    const titleText = document.querySelector('.wiz-draft-card .wiz-draft-header span')?.textContent;
    const cardsCount = document.querySelectorAll('.wiz-draft-card').length;
    return { titleText, cardsCount };
  });

  console.log(`Draft cards generated: ${finalChecks.cardsCount}`);
  console.log(`Niche Topic Verified: ${finalChecks.titleText}`);

  if (finalChecks.cardsCount === 0) {
    throw new Error('Failed to generate customized drafts in step 6.');
  }

  await page.screenshot({ path: path.join(outDir, 'wizard_step6_final.png') });
  console.log('📸 Final step screenshot saved to scratch/wizard_step6_final.png');

  // Verify there are no console errors
  console.log('\n--- Console Errors Check ---');
  if (consoleErrors.length > 0) {
    console.error(`⚠️ Found ${consoleErrors.length} browser console errors during E2E path:`);
    consoleErrors.forEach(err => console.error(`  - ${err}`));
    throw new Error('E2E pipeline completed, but console errors were thrown.');
  } else {
    console.log('✅ Zero console errors logged in the browser!');
  }

  console.log('\n🥇 End-to-End Pipeline Verification COMPLETE & SUCCESSFUL!');
  await browser.close();
}
