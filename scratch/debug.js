const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3456/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => sessionStorage.setItem('pg_portal_unlocked', 'yes'));
  await page.goto('http://localhost:3456/dashboard.html', { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  
  const debug = await page.evaluate(() => {
    const r = {};
    // Check section-title visibility
    const title = document.querySelector('.section-title');
    if (title) {
      const cs = window.getComputedStyle(title);
      r.sectionTitle = { text: title.textContent.trim(), color: cs.color, display: cs.display, visibility: cs.visibility, opacity: cs.opacity };
    }
    // Check section-lead
    const lead = document.querySelector('.section-lead');
    if (lead) {
      const cs = window.getComputedStyle(lead);
      r.sectionLead = { text: lead.textContent.substring(0,40), color: cs.color, display: cs.display, opacity: cs.opacity };
    }
    // Check dash-kpi
    const kpi = document.querySelector('.dash-kpi');
    if (kpi) {
      const cs = window.getComputedStyle(kpi);
      r.kpi = { display: cs.display, opacity: cs.opacity, visibility: cs.visibility, height: kpi.offsetHeight };
    }
    // Check dash-kpi-row
    const kpiRow = document.querySelector('.dash-kpi-row');
    if (kpiRow) {
      const cs = window.getComputedStyle(kpiRow);
      r.kpiRow = { display: cs.display, gridTemplateColumns: cs.gridTemplateColumns, height: kpiRow.offsetHeight };
    }
    // Check the slide element
    const slide = document.querySelector('.slide');
    if (slide) {
      const cs = window.getComputedStyle(slide);
      r.slide = { display: cs.display, overflow: cs.overflow, height: slide.offsetHeight, scrollHeight: slide.scrollHeight };
    }
    // Check slide-inner
    const inner = document.querySelector('.slide-inner');
    if (inner) {
      const cs = window.getComputedStyle(inner);
      r.slideInner = { display: cs.display, maxWidth: cs.maxWidth, height: inner.offsetHeight, scrollHeight: inner.scrollHeight, overflow: cs.overflow };
    }
    // Check center panel
    const cp = document.querySelector('.dash-center-panel');
    if (cp) {
      const cs = window.getComputedStyle(cp);
      r.centerPanel = { height: cp.offsetHeight, scrollHeight: cp.scrollHeight, overflow: cs.overflow, overflowY: cs.overflowY };
    }
    // Check workspace
    const ws = document.querySelector('.dash-workspace');
    if (ws) {
      const cs = window.getComputedStyle(ws);
      r.workspace = { display: cs.display, gridTemplateColumns: cs.gridTemplateColumns, height: ws.offsetHeight, flex: cs.flex };
    }
    // Check right panel
    const rp = document.querySelector('.dash-right-panel');
    if (rp) {
      const cs = window.getComputedStyle(rp);
      r.rightPanel = { display: cs.display, width: rp.offsetWidth, height: rp.offsetHeight, overflow: cs.overflow };
    }
    // Check dash-main
    const dm = document.querySelector('.dash-main');
    if (dm) {
      const cs = window.getComputedStyle(dm);
      r.dashMain = { display: cs.display, flexDirection: cs.flexDirection, height: dm.offsetHeight };
    }
    // Check right-collapsed
    const collapsed = document.querySelector('.right-collapsed');
    r.hasRightCollapsed = !!collapsed;
    r.workspaceClasses = ws?.className;
    r.rightPanelClasses = rp?.className;
    
    return r;
  });
  
  console.log(JSON.stringify(debug, null, 2));
  await browser.close();
})();
