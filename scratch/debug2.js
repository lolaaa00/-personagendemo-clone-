const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3456/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => sessionStorage.setItem('pg_portal_unlocked', 'yes'));
  await page.goto('http://localhost:3456/dashboard.html', { waitUntil: 'networkidle0', timeout: 15000 });
  
  // Wait longer for animations
  await new Promise(r => setTimeout(r, 3000));
  
  const debug = await page.evaluate(() => {
    const r = {};
    // Walk the DOM tree to find the height constraint
    const elements = [
      { sel: 'body', name: 'body' },
      { sel: '#view-portal', name: 'view-portal' },
      { sel: '.dashboard-layout', name: 'dashboard-layout' },
      { sel: '.dash-main', name: 'dash-main' },
      { sel: '.dash-header', name: 'dash-header' },
      { sel: '.dash-workspace', name: 'dash-workspace' },
      { sel: '.dash-center-panel', name: 'dash-center-panel' },
      { sel: '#dash-sec-summary', name: 'dash-sec-summary' },
      { sel: '.slide', name: 'slide' },
      { sel: '.slide-inner', name: 'slide-inner' },
    ];
    
    elements.forEach(({sel, name}) => {
      const el = document.querySelector(sel);
      if (el) {
        const cs = window.getComputedStyle(el);
        r[name] = {
          offsetHeight: el.offsetHeight,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          display: cs.display,
          overflow: cs.overflow,
          overflowY: cs.overflowY,
          height: cs.height,
          maxHeight: cs.maxHeight,
          minHeight: cs.minHeight,
          flex: cs.flex,
          gridRow: cs.gridRow,
          position: cs.position,
        };
      }
    });
    
    // Check reveal visibility
    const reveals = document.querySelectorAll('.reveal');
    const visibleReveals = document.querySelectorAll('.reveal.visible');
    r.reveals = { total: reveals.length, visible: visibleReveals.length };
    
    // Check section-title opacity now
    const title = document.querySelector('.section-title');
    if (title) r.sectionTitleOpacity = window.getComputedStyle(title).opacity;
    
    return r;
  });
  
  console.log(JSON.stringify(debug, null, 2));
  
  // Take a screenshot with a longer wait
  const outDir = path.join(__dirname, 'scratch');
  require('fs').mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, 'dashboard_debug.png'), fullPage: false });
  console.log('\nScreenshot saved');
  
  await browser.close();
})();
