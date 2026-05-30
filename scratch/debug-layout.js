const puppeteer = require('puppeteer');
const path = require('path');

async function main() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const htmlPath = 'file:///' + path.resolve('dist/honeyforx/02-system-playbook.html').replace(/\\/g, '/');
  await page.goto(htmlPath, { waitUntil: 'networkidle2' });

  // Emulate print media to apply print styles
  await page.emulateMediaType('print');
  // Set page dimensions matching Letter size at 96 DPI (8.5in x 11in => 816px x 1056px)
  await page.setViewport({ width: 816, height: 1056 });

  // Get table 5 details under print emulation
  const data = await page.evaluate(() => {
    const getTableInfo = (index) => {
      const table = document.querySelectorAll('table')[index];
      if (!table) return null;
      const rect = table.getBoundingClientRect();
      const rows = [];
      table.querySelectorAll('tr').forEach((tr, rowIndex) => {
        const trRect = tr.getBoundingClientRect();
        rows.push({
          index: rowIndex,
          text: tr.innerText.replace(/\n/g, ' ').trim(),
          top: trRect.top,
          bottom: trRect.bottom,
          height: trRect.height,
          display: window.getComputedStyle(tr).display,
          visibility: window.getComputedStyle(tr).visibility
        });
      });
      return { index, top: rect.top, bottom: rect.bottom, height: rect.height, rows };
    };
    
    // Let's also check all headers / page count estimations
    const bodyHeight = document.body.scrollHeight;
    
    return {
      bodyHeight,
      table5: getTableInfo(5),
      table6: getTableInfo(6)
    };
  });

  console.log(JSON.stringify(data, null, 2));
  await browser.close();
}

main().catch(console.error);
