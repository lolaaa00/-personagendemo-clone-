const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// Helper for delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
  const logFile = path.join(__dirname, 'browser_test_results.txt');
  const shotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(shotsDir)) {
    fs.mkdirSync(shotsDir, { recursive: true });
  }

  const logStream = fs.createWriteStream(logFile, { flags: 'w' });
  function log(msg) {
    console.log(msg);
    logStream.write(msg + '\n');
  }

  log(`[Test] Starting Browser Verification at ${new Date().toISOString()}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Monitor console messages
  page.on('console', msg => {
    log(`[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`);
  });

  // Monitor page errors
  page.on('pageerror', err => {
    log(`[Browser Error] ${err.toString()}`);
  });

  try {
    const url = process.argv[2] || 'https://honeyx.monarchstack.com/';
    log(`[Test] Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

    log(`[Test] Page title: "${await page.title()}"`);
    await page.screenshot({ path: path.join(shotsDir, '01_page_loaded.png') });

    let currentUrl = page.url();
    log(`[Test] Current URL after initial load: ${currentUrl}`);

    // If redirected to login, perform Supabase auth login
    if (currentUrl.includes('/login')) {
      log('[Test] On Login page. Filling credentials...');
      await page.waitForSelector('#email', { timeout: 10000 });
      await page.type('#email', 'client@personagen.ai', { delay: 50 });
      await page.type('#password', 'password123', { delay: 50 });

      log('[Test] Clicking Sign In...');
      await page.click('button.login-submit');
      log('[Test] Waiting for Dashboard page...');
      await page.waitForSelector('.dashboard-page', { timeout: 20000 });
      log(`[Test] Logged in successfully! Current URL: ${page.url()}`);
      await delay(2000);
      await page.screenshot({ path: path.join(shotsDir, '02_dashboard_loaded.png') });
    } else {
      log('[Test] Already logged in (bypassed login page).');
      await delay(1000);
      await page.screenshot({ path: path.join(shotsDir, '02_dashboard_loaded.png') });
    }

    // Clear localStorage to ensure a clean wizard state
    await page.evaluate(() => localStorage.clear());

    // Navigate directly to Intelligence Hub
    const intelUrl = url.endsWith('/') ? url + 'intel-wizard' : url + '/intel-wizard';
    log(`[Test] Navigating directly to Intel Wizard: ${intelUrl}`);
    await page.goto(intelUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    
    log('[Test] Waiting 4 seconds for Svelte hydration...');
    await delay(4000);

    log('[Test] Waiting for Intel Wizard page to load...');
    await page.waitForSelector('#company-name', { timeout: 20000 });
    log(`[Test] Arrived on Intelligence Hub page: ${page.url()}`);
    await delay(1000);
    await page.screenshot({ path: path.join(shotsDir, '03_intelligence_hub_wizard.png') });

    // Verify Svelte Intel Wizard exists
    const wizardExists = await page.evaluate(() => {
      const pageSec = document.querySelector('section.page');
      const hasProgress = !!document.querySelector('.progress-steps');
      return {
        pageSecExists: !!pageSec,
        hasProgress,
        html: pageSec ? pageSec.innerHTML.substring(0, 300) + '...' : 'none'
      };
    });
    log(`[Test] Intelligence Wizard container status: ${JSON.stringify(wizardExists)}`);

    // --- Step 1: Brand Discovery ---
    log('[Test] Step 1: Brand Discovery - filling form...');
    await page.waitForSelector('#company-name', { timeout: 10000 });
    await page.evaluate(() => {
      const coInput = document.getElementById('company-name');
      if (coInput) {
        coInput.value = 'MonarchStack';
        coInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const indSelect = document.getElementById('industry-select');
      if (indSelect) {
        indSelect.value = 'Technology';
        indSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const audText = document.getElementById('target-audience');
      if (audText) {
        audText.value = 'Small business owners seeking AI automation and analytics tools.';
        audText.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await delay(500);
    await page.screenshot({ path: path.join(shotsDir, '04_step1_filled.png') });

    log('[Test] Clicking Next to Step 2...');
    await page.evaluate(() => {
      document.querySelector('button.nav-btn.next')?.click();
    });
    await delay(1500);

    // --- Step 2: Competitor Analysis ---
    log('[Test] Step 2: Competitor Analysis - filling competitor details...');
    await page.waitForSelector('input.comp-url', { timeout: 10000 });
    await page.evaluate(() => {
      const compInput = document.querySelector('input.comp-url');
      if (compInput) {
        compInput.value = 'https://youtube.com/@competitor1';
        compInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await delay(500);
    await page.screenshot({ path: path.join(shotsDir, '05_step2_filled.png') });

    log('[Test] Clicking Next to Step 3...');
    await page.evaluate(() => {
      document.querySelector('button.nav-btn.next')?.click();
    });
    await delay(1500);

    // --- Step 3: Content Audit ---
    log('[Test] Step 3: Content Audit - filling content details...');
    await page.waitForSelector('#existing-content', { timeout: 10000 });
    await page.evaluate(() => {
      const extContent = document.getElementById('existing-content');
      if (extContent) {
        extContent.value = 'We currently publish 2 short tech videos per week on Instagram.';
        extContent.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await delay(500);
    await page.screenshot({ path: path.join(shotsDir, '06_step3_filled.png') });

    log('[Test] Clicking Next to Step 4...');
    await page.evaluate(() => {
      document.querySelector('button.nav-btn.next')?.click();
    });
    await delay(1500);

    // --- Step 4: Audience Mapping ---
    log('[Test] Step 4: Audience Mapping - using default and clicking Next...');
    await page.waitForSelector('button.nav-btn.next', { timeout: 10000 });
    await page.screenshot({ path: path.join(shotsDir, '07_step4_review.png') });
    await page.evaluate(() => {
      document.querySelector('button.nav-btn.next')?.click();
    });
    await delay(1500);

    // --- Step 5: Strategy Generation ---
    log('[Test] Step 5: Strategy Generation - reviewing and clicking Generate...');
    await page.waitForSelector('button.generate-btn', { timeout: 10000 });
    await page.screenshot({ path: path.join(shotsDir, '08_step5_review.png') });
    
    log('[Test] Clicking Generate Strategy...');
    await page.evaluate(() => {
      document.querySelector('button.generate-btn')?.click();
    });

    // --- Step 6: Results ---
    log('[Test] Step 6: Waiting for strategy generation to complete...');
    await page.waitForSelector('.results-container', { timeout: 15000 });
    log('✅ Strategy Report successfully generated and rendered!');
    await delay(2000);
    await page.screenshot({ path: path.join(shotsDir, '09_strategy_results.png'), fullPage: true });

    log('[Test] Automation test complete with zero fatal errors!');

    // --- Verify Connected Accounts Page ---
    const accUrl = url.endsWith('/') ? url + 'accounts' : url + '/accounts';
    log(`[Test] Navigating to Connected Accounts: ${accUrl}`);
    await page.goto(accUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    await page.waitForSelector('#agent-select', { timeout: 10000 });
    log('[Test] Accounts page loaded successfully. Selecting an agent...');
    
    // Select the first agent from the dropdown
    await page.evaluate(() => {
      const select = document.getElementById('agent-select');
      if (select && select.options.length > 1) {
        select.selectedIndex = 1;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    
    await delay(3000);
    await page.screenshot({ path: path.join(shotsDir, '10_accounts_loaded.png') });
    log('[Test] Accounts page verified successfully!');
  } catch (err) {
    log(`[Test Error] Critical failure in test-browser: ${err.message}`);
    log(err.stack);
    try {
      await page.screenshot({ path: path.join(shotsDir, 'failure_state.png'), fullPage: true });
      log('[Test] Saved failure state screenshot to scratch/screenshots/failure_state.png');
    } catch (e) {
      log(`[Test Error] Failed to take failure screenshot: ${e.message}`);
    }
  } finally {
    await browser.close();
    logStream.end();
    console.log('[Test] Closed browser.');
  }
}

runTest();

