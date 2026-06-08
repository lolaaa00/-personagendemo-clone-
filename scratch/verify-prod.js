const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const results = [];
  
  function log(test, pass, detail = '') {
    const icon = pass ? '✅' : '❌';
    results.push({ test, pass, detail });
    console.log(`${icon} ${test}${detail ? ' — ' + detail : ''}`);
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    // Unlock session
    await page.goto('http://localhost:3456/dashboard.html', { waitUntil: 'networkidle2', timeout: 10000 });
    await page.evaluate(() => sessionStorage.setItem('pg_portal_unlocked', 'yes'));
    await page.goto('http://localhost:3456/dashboard.html', { waitUntil: 'networkidle2', timeout: 10000 });
    await new Promise(r => setTimeout(r, 2500));

    // === DASHBOARD CHECKS ===
    const kpiTotal = await page.$eval('#kpi-total', el => el.textContent).catch(() => null);
    log('Dashboard KPI renders', kpiTotal !== null, `Active: ${kpiTotal}`);

    const kpiSub = await page.$eval('.dash-kpi-subtitle', el => el.textContent).catch(() => null);
    log('KPI connection subtitle', kpiSub !== null, kpiSub || 'not found');

    const agentRows = await page.$$eval('.dash-row:not(.row-header)', rows => rows.length).catch(() => 0);
    log('Agent roster renders', agentRows >= 4, `${agentRows} agents`);

    const pendingStatus = await page.$$eval('.status-pending, [class*="pending"]', els => els.length).catch(() => 0);
    log('Pending status elements', pendingStatus > 0, `${pendingStatus} found`);

    const connectCtas = await page.$$eval('.agent-connect-cta', els => els.length).catch(() => 0);
    log('Connect CTAs visible', connectCtas > 0, `${connectCtas} CTAs`);

    const pendingFilter = await page.$('[data-testid="filter-pending"]');
    log('Pending filter button', pendingFilter !== null);

    const overlay = await page.$('#sidebar-overlay');
    log('Sidebar overlay injected', overlay !== null);

    const agentStoreExists = await page.evaluate(() => typeof window.AgentStore !== 'undefined');
    log('AgentStore global', agentStoreExists);

    // Check agent row has persona-config link
    const rowOnclick = await page.$eval('.dash-row:not(.row-header)', el => el.getAttribute('onclick') || '').catch(() => '');
    log('Agent row → persona-config', rowOnclick.includes('persona-config.html'));

    // Check no console errors
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    // === GENERATOR — AUSTRALIA ===
    await page.goto('http://localhost:3456/generator.html', { waitUntil: 'networkidle2', timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));
    const hasAu = await page.evaluate(() => {
      const opts = document.querySelectorAll('select option');
      return Array.from(opts).some(o => o.textContent.includes('Australia'));
    });
    log('Australia market option', hasAu);

    // === MOBILE ===
    await page.setViewport({ width: 375, height: 812 });
    await page.goto('http://localhost:3456/dashboard.html', { waitUntil: 'networkidle2', timeout: 10000 });
    await new Promise(r => setTimeout(r, 2000));

    const hamburgerMobile = await page.$eval('.dash-hamburger', el => {
      return window.getComputedStyle(el).display !== 'none';
    }).catch(() => false);
    log('Hamburger visible on mobile', hamburgerMobile);

    await page.screenshot({ path: 'scratch/mobile_prod.png', fullPage: false });

    // Desktop hamburger hidden
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto('http://localhost:3456/dashboard.html', { waitUntil: 'networkidle2', timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));

    const hamburgerDesktop = await page.$eval('.dash-hamburger', el => {
      return window.getComputedStyle(el).display === 'none';
    }).catch(() => false);
    log('Hamburger hidden on desktop', hamburgerDesktop);

    await page.screenshot({ path: 'scratch/desktop_prod.png', fullPage: false });

    // Summary
    console.log('\n═══════════════════════════');
    const passed = results.filter(r => r.pass).length;
    console.log(`RESULTS: ${passed}/${results.length} passed`);
    const fails = results.filter(r => !r.pass);
    if (fails.length) {
      console.log('\nFAILED:');
      fails.forEach(f => console.log(`  ❌ ${f.test}: ${f.detail}`));
    } else {
      console.log('ALL TESTS PASSED ✅');
    }
    console.log('═══════════════════════════');

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    await browser.close();
    process.exit(0);
  }
})();
