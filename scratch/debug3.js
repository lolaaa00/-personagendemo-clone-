const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3456/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => sessionStorage.setItem('pg_portal_unlocked', 'yes'));
  await page.goto('http://localhost:3456/dashboard.html', { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  
  // Try forcing height via JS to see if it fixes it
  const result = await page.evaluate(() => {
    const cp = document.querySelector('.dash-center-panel');
    const before = { height: cp.offsetHeight, computedHeight: getComputedStyle(cp).height };
    
    // Force the height
    cp.style.height = 'calc(100vh - 60px)';
    
    const after = { height: cp.offsetHeight, computedHeight: getComputedStyle(cp).height };
    return { before, after };
  });
  
  console.log('Before:', JSON.stringify(result.before));
  console.log('After:', JSON.stringify(result.after));
  
  await new Promise(r => setTimeout(r, 500));
  const outDir = require('path').join(__dirname, 'scratch');
  require('fs').mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: require('path').join(outDir, 'dashboard_forced.png'), fullPage: false });
  console.log('Screenshot saved');
  
  await browser.close();
})();
