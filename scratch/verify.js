const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  // Set viewport to desktop
  await page.setViewport({ width: 1440, height: 900 });
  
  // Bypass PIN gate
  await page.goto('http://localhost:3456/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => sessionStorage.setItem('pg_portal_unlocked', 'yes'));
  await page.goto('http://localhost:3456/dashboard.html', { waitUntil: 'networkidle0', timeout: 15000 });
  
  // Wait for dashboard to render
  await new Promise(r => setTimeout(r, 2000));
  
  // Check for console errors
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  
  // Screenshot dashboard
  const outDir = path.join(__dirname, 'scratch');
  require('fs').mkdirSync(outDir, { recursive: true });
  
  await page.screenshot({ path: path.join(outDir, 'dashboard_desktop.png'), fullPage: false });
  console.log('✅ Dashboard desktop screenshot saved');
  
  // Check key elements exist
  const checks = await page.evaluate(() => {
    const results = {};
    results.kpiCards = document.querySelectorAll('.dash-kpi').length;
    results.kpiTotal = document.getElementById('kpi-total')?.textContent;
    results.kpiEngagement = document.getElementById('kpi-engagement-main')?.textContent;
    results.kpiPosts = document.getElementById('kpi-posts-main')?.textContent;
    results.kpiReach = document.getElementById('kpi-reach-main')?.textContent;
    results.agentTable = document.getElementById('dash-agent-table')?.innerHTML?.length;
    results.rightPanel = document.querySelector('.dash-right-panel')?.offsetWidth;
    results.sidebar = document.querySelector('.dash-sidebar')?.offsetWidth;
    results.workspaceGrid = window.getComputedStyle(document.querySelector('.dash-workspace'))?.gridTemplateColumns;
    results.sidebarLinks = document.querySelectorAll('.dash-menu-item').length;
    results.signOutTag = document.querySelector('[data-testid="sign-out"]')?.tagName;
    results.signOutText = document.querySelector('[data-testid="sign-out"]')?.textContent?.trim();
    results.sparkChart = document.getElementById('spark-chart')?.innerHTML?.length;
    results.platformBars = document.getElementById('platform-bars')?.innerHTML?.length;
    results.newPostHref = document.querySelector('a[href="calendar.html"]')?.textContent?.trim();
    results.createAgentHref = document.querySelector('a[href="generator.html"]')?.textContent?.trim();
    return results;
  });
  
  console.log('\n📊 Element checks:');
  console.log(JSON.stringify(checks, null, 2));
  
  // Screenshot scout page
  await page.goto('http://localhost:3456/scout.html', { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(outDir, 'scout_desktop.png'), fullPage: false });
  console.log('\n✅ Scout desktop screenshot saved');
  
  const scoutChecks = await page.evaluate(() => {
    const activeMenu = document.querySelector('.dash-menu-item.active')?.textContent?.trim();
    return { activeMenu };
  });
  console.log('Scout active menu:', scoutChecks.activeMenu);
  
  // Screenshot PM page 
  await page.goto('http://localhost:3456/pm.html', { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(outDir, 'pm_desktop.png'), fullPage: false });
  console.log('✅ PM desktop screenshot saved');
  
  const pmChecks = await page.evaluate(() => {
    const hasRightPanel = document.querySelector('.dash-right-panel');
    const workspaceClass = document.querySelector('.dash-workspace')?.className;
    return { hasRightPanel: !!hasRightPanel, workspaceClass };
  });
  console.log('PM checks:', JSON.stringify(pmChecks));
  
  // Mobile viewport dashboard
  await page.setViewport({ width: 375, height: 812 });
  await page.goto('http://localhost:3456/dashboard.html', { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(outDir, 'dashboard_mobile.png'), fullPage: false });
  console.log('\n✅ Dashboard mobile screenshot saved');
  
  const mobileChecks = await page.evaluate(() => {
    const sidebarDisplay = window.getComputedStyle(document.querySelector('.dash-sidebar'))?.transform;
    const rightPanelDisplay = window.getComputedStyle(document.querySelector('.dash-right-panel'))?.display;
    return { sidebarTransform: sidebarDisplay, rightPanelDisplay };
  });
  console.log('Mobile checks:', JSON.stringify(mobileChecks));
  
  if (errors.length) console.log('\n⚠️ Console errors:', errors);
  else console.log('\n✅ No console errors');
  
  await browser.close();
  console.log('\n🎯 Verification complete');
})();
