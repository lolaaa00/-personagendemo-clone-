const puppeteer = require('puppeteer');
const path = require('path');

async function main() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.setViewport({ width: 1200, height: 1600 });
  
  const pdfPath = 'file:///' + path.resolve('dist/honeyforx/onboarding-packet.pdf').replace(/\\/g, '/');
  
  for (let i = 1; i <= 3; i++) {
    await page.goto(`${pdfPath}#page=${i}`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: `dist/honeyforx/screenshots/pdf-packet-page-${i}.png` });
    console.log(`✓ Captured pdf-packet-page-${i}.png`);
  }
  
  await browser.close();
}

main().catch(console.error);
