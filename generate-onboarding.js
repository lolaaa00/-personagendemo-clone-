#!/usr/bin/env node
/**
 * PersonaGen Onboarding — 3 Separate Branded PDF Generator
 *
 * Converts each onboarding markdown doc into its own polished PDF
 * using the exact MSA template styling (light-mode, professional).
 *
 * Usage:
 *   node generate-onboarding.js <client-id>
 *
 * Prerequisites:
 *   npm install puppeteer marked
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { marked } = require('marked');

// ── CLI ──
const args = process.argv.slice(2);
const clientId = args.find(a => !a.startsWith('--'));

if (!clientId) {
  console.error('Usage: node generate-onboarding.js <client-id>');
  process.exit(1);
}

// ── Config ──
const CONFIG_PATH = path.join(__dirname, 'clients', `${clientId}.config.json`);
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`Config not found: ${CONFIG_PATH}`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

const DOCS_DIR = path.join(__dirname, 'docs', 'onboarding');
const DIST = path.join(__dirname, 'dist', clientId);

const DOCS = [
  {
    file: '01-welcome.md',
    title: 'Welcome Letter',
    subtitle: 'Your Fractional CTO Partnership',
    pdfName: '01-welcome-letter.pdf',
    htmlName: '01-welcome-letter.html',
  },
  {
    file: '02-system-playbook.md',
    title: 'System Playbook',
    subtitle: 'Architecture, Infrastructure & Operations Reference',
    pdfName: '02-system-playbook.pdf',
    htmlName: '02-system-playbook.html',
  },
  {
    file: '03-project-tracker.md',
    title: 'Project Tracker',
    subtitle: 'Milestones, Status Board & Operations Cadence',
    pdfName: '03-project-tracker.pdf',
    htmlName: '03-project-tracker.html',
  },
];

// ── Template Variable Hydration ──
function resolveValue(obj, dotPath) {
  return dotPath.split('.').reduce((acc, key) => {
    if (acc === undefined || acc === null) return '';
    return acc[key];
  }, obj);
}

function hydrate(content, cfg) {
  return content.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (match, keyPath) => {
    const value = resolveValue(cfg, keyPath);
    if (value === undefined || value === null) return match;
    return String(value);
  });
}

// ── Markdown → HTML ──
function renderMarkdown(md) {
  marked.setOptions({ gfm: true, breaks: true });
  return marked.parse(md);
}

function cleanHTMLTableRows(html) {
  // Strip out empty table rows (rows with only whitespace or empty cells) in Node.js
  // before rendering to guarantee no browser printing layout bugs.
  return html.replace(/<tr>\s*(?:<(?:td|th)>\s*(?:&nbsp;|\s)*<\/(?:td|th)>\s*)+<\/tr>/gi, '');
}

// ── MSA-Matching CSS ──
function getMSAStyles(accent) {
  return `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@500;600&display=swap');

  :root {
    --ink: #1a1a2e;
    --ink-light: #444;
    --ink-muted: #666;
    --accent: ${accent};
    --border: #e0e0e0;
    --bg: #fff;
    --surface: #fafafa;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  @page {
    size: letter;
    margin: 0.75in 1in;
  }

  body {
    font-family: 'Inter', -apple-system, sans-serif;
    font-size: 10.5pt;
    line-height: 1.65;
    color: var(--ink);
    background: var(--bg);
    max-width: 8.5in;
    margin: 0 auto;
    padding: 0;
    text-align: justify;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  h1, h2, h3, h4, h5, h6 {
    text-align: left;
  }

  h1, h2 {
    page-break-after: avoid;
    break-after: avoid;
  }

  /* ── Document Header ── */
  .doc-header {
    text-align: center;
    border-bottom: 2px solid var(--accent);
    padding-bottom: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .doc-header h1 {
    font-family: 'Playfair Display', serif;
    font-size: 22pt;
    font-weight: 600;
    color: var(--ink);
    margin-bottom: 0.25rem;
    text-align: center;
    border-bottom: none;
    padding-bottom: 0;
  }

  .doc-header .subtitle {
    font-size: 11pt;
    color: var(--accent);
    font-weight: 600;
    letter-spacing: 0.03em;
  }

  .doc-header .date {
    font-size: 9pt;
    color: var(--ink-muted);
    margin-top: 0.5rem;
  }

  /* ── Parties Block (mirrors MSA .parties) ── */
  .parties {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
    margin-bottom: 2.5rem;
    padding: 1.25rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    text-align: left;
  }

  .party-label {
    font-size: 8pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    margin-bottom: 0.4rem;
  }

  .party-name {
    font-size: 12pt;
    font-weight: 600;
  }

  .party-detail {
    font-size: 9pt;
    color: var(--ink-muted);
    margin-top: 0.15rem;
  }

  .party-field {
    margin-top: 0.6rem;
  }

  .party-field-label {
    font-size: 7.5pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-muted);
    margin-bottom: 0.1rem;
  }

  .party-field-value {
    font-size: 9.5pt;
    font-weight: 600;
    color: var(--ink);
  }

  /* ── Content Sections ── */
  .section {
    margin-bottom: 1rem;
    break-inside: auto;
  }

  .section h1:first-child {
    margin-top: 0;
  }

  h1 {
    font-family: 'Playfair Display', serif;
    font-size: 22pt;
    font-weight: 600;
    color: var(--ink);
    margin-bottom: 0.6rem;
    padding-bottom: 0.3rem;
    border-bottom: 2px solid var(--accent);
  }

  h2 {
    font-size: 13pt;
    font-weight: 700;
    margin-top: 1rem;
    margin-bottom: 0.4rem;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--border);
    break-after: avoid;
    page-break-after: avoid;
  }

  h3 {
    font-size: 11pt;
    font-weight: 600;
    margin: 0.75rem 0 0.35rem;
    color: var(--ink);
  }

  h4 {
    font-size: 10.5pt;
    font-weight: 600;
    margin: 0.6rem 0 0.3rem;
    color: var(--ink-muted);
  }

  p {
    font-size: 10.5pt;
    color: var(--ink-light);
    line-height: 1.65;
    margin-bottom: 0.4rem;
    orphans: 3;
    widows: 3;
  }

  strong {
    font-weight: 600;
    color: var(--ink);
  }

  a {
    color: var(--accent);
    text-decoration: none;
  }

  hr {
    border: none;
    height: 1px;
    background: var(--border);
    margin: 0.6rem 0;
  }

  /* ── Lists ── */
  ul, ol {
    padding-left: 1.5rem;
    margin: 0.4rem 0 0.6rem;
  }

  li {
    margin-bottom: 0.25rem;
    font-size: 10.5pt;
    color: var(--ink-light);
    line-height: 1.65;
    orphans: 2;
    widows: 2;
  }

  /* ── Tables (exact MSA match) ── */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.5rem 0 0.75rem;
    font-size: 10pt;
    break-inside: auto;
    page-break-inside: auto;
  }

  thead {
    break-after: avoid;
    page-break-after: avoid;
  }

  tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  th {
    background: var(--surface);
    font-weight: 600;
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-align: left;
    padding: 0.55rem 0.75rem;
    border-bottom: 2px solid var(--border);
    color: var(--ink);
  }

  td {
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid var(--border);
    color: var(--ink-light);
    line-height: 1.55;
  }

  tr:last-child td { border-bottom: none; }

  /* ── Blockquotes → highlight-box (exact MSA match) ── */
  blockquote {
    background: var(--surface);
    border-left: 3px solid var(--accent);
    padding: 0.6rem 1rem;
    margin: 0.75rem 0;
    border-radius: 0 4px 4px 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  blockquote p {
    color: var(--ink-light);
    margin-bottom: 0;
    font-size: 10pt;
    line-height: 1.65;
  }

  blockquote strong {
    color: var(--ink);
  }

  /* ── Code ── */
  code {
    font-family: 'Menlo', 'Consolas', monospace;
    font-size: 9pt;
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 1px 4px;
    border-radius: 3px;
    color: var(--ink);
  }

  pre {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.6rem 1rem;
    overflow-x: auto;
    margin: 0.5rem 0 0.75rem;
    font-size: 8.5pt;
    line-height: 1.55;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  pre code {
    background: none;
    border: none;
    padding: 0;
    color: var(--ink-light);
  }

  @media print {
    body { padding: 0; }
    h2 { page-break-after: avoid; }
    pre, blockquote { page-break-inside: avoid; }
  }

  /* ── Page Break ── */
  .page-break {
    page-break-before: always;
    break-before: page;
  }

  /* ── Cover Page ── */
  .cover {
    min-height: 80vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 1.5in 1in;
  }

  .cover-logo {
    font-size: 56pt;
    margin-bottom: 0.3in;
  }

  .cover-brand {
    font-size: 10pt;
    font-weight: 600;
    letter-spacing: 6px;
    text-transform: uppercase;
    color: var(--ink-muted);
    margin-bottom: 0.3in;
  }

  .cover h1 {
    font-family: 'Playfair Display', serif;
    font-size: 30pt;
    font-weight: 600;
    line-height: 1.2;
    color: var(--ink);
    margin-bottom: 0.15in;
    border-bottom: none;
    padding-bottom: 0;
  }

  .cover .subtitle {
    font-size: 11pt;
    color: var(--accent);
    font-weight: 600;
    letter-spacing: 0.03em;
    margin-bottom: 0.4in;
  }

  .cover-subtitle {
    font-size: 11pt;
    font-weight: 300;
    color: var(--ink-muted);
    max-width: 5in;
    margin-bottom: 0.5in;
    line-height: 1.7;
  }

  .cover-meta {
    font-size: 9.5pt;
    color: var(--ink-muted);
    border-top: 2px solid var(--accent);
    padding-top: 0.25in;
    width: 4in;
    line-height: 1.8;
  }

  .cover-meta span {
    font-weight: 600;
    color: var(--ink);
  }

  /* ── TOC Page ── */
  .toc {
    min-height: 80vh;
    padding: 1.5in 1in;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .toc h2 {
    font-family: 'Playfair Display', serif;
    font-size: 22pt;
    font-weight: 600;
    color: var(--ink);
    margin-bottom: 0.4in;
    padding-bottom: 0.15in;
    border-bottom: 2px solid var(--accent);
    display: inline-block;
  }

  .toc-item {
    display: flex;
    align-items: center;
    gap: 2rem;
    padding: 1rem 1.25rem;
    margin-bottom: 0.75rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    border-left: 3px solid var(--accent);
  }

  .toc-num {
    font-size: 20pt;
    font-weight: 800;
    color: var(--accent);
    min-width: 0.5in;
  }

  .toc-label {
    font-size: 12pt;
    font-weight: 600;
    color: var(--ink);
  }

  .toc-desc {
    font-size: 9pt;
    color: var(--ink-muted);
    margin-top: 2px;
  }

  /* ── Document Sections ── */
  .doc-section {
    padding-top: 0.5in;
    break-after: auto;
  }

  .doc-badge {
    display: inline-block;
    font-size: 8pt;
    font-weight: 700;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: var(--accent);
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 4px 12px;
    border-radius: 20px;
    margin-bottom: 1.5rem;
  }
`;
}

// ── Build combined HTML for the entire onboarding packet ──
function buildPacketHTML(html1, html2, html3, cfg) {
  const accent = cfg.branding?.accent || '#7c6aed';
  const clientName = cfg.client?.name || 'Client';
  const logoEmoji = cfg.client?.logo_emoji || '🍯';
  const effectiveDate = cfg.effective_date || new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${clientName} — Onboarding Packet | Monarch Stack</title>
<style>${getMSAStyles(accent)}</style>
</head>
<body>

  <!-- ═══ Cover ═══ -->
  <div class="cover">
    <div class="cover-logo">${logoEmoji}</div>
    <div class="cover-brand">Monarch Stack</div>
    <h1>Onboarding Packet</h1>
    <div class="subtitle">Managed Automation Partnership</div>
    <p class="cover-subtitle">
      Your complete partnership handbook — welcome letter, playbook, and live project tracker.
    </p>
    <div class="cover-meta">
      <span>Prepared for</span> ${clientName}<br>
      <span>Date</span> ${effectiveDate}<br>
      <span>Confidential</span> — Do not distribute
    </div>
  </div>

  <!-- ═══ TOC ═══ -->
  <div class="page-break"></div>
  <div class="toc">
    <h2>Contents</h2>
    <div class="toc-item">
      <div class="toc-num">01</div>
      <div>
        <div class="toc-label">Welcome Letter</div>
        <div class="toc-desc">Partnership overview, principles, and what sets this apart</div>
      </div>
    </div>
    <div class="toc-item">
      <div class="toc-num">02</div>
      <div>
        <div class="toc-label">System Playbook</div>
        <div class="toc-desc">Architecture, stack, setup guides, costs, and scaling roadmap</div>
      </div>
    </div>
    <div class="toc-item">
      <div class="toc-num">03</div>
      <div>
        <div class="toc-label">Project Tracker</div>
        <div class="toc-desc">Live milestones, status board, decision log, and operations cadence</div>
      </div>
    </div>
  </div>

  <!-- ═══ Welcome Letter ═══ -->
  <div class="page-break"></div>
  <section class="doc-section">
    <div class="doc-badge">01 — Welcome Letter</div>
    ${html1}
  </section>

  <!-- ═══ System Playbook ═══ -->
  <div class="page-break"></div>
  <section class="doc-section">
    <div class="doc-badge">02 — System Playbook</div>
    ${html2}
  </section>

  <!-- ═══ Project Tracker ═══ -->
  <div class="page-break"></div>
  <section class="doc-section">
    <div class="doc-badge">03 — Project Tracker</div>
    ${html3}
  </section>

</body>
</html>`;
}

// ── Build standalone HTML for a single document ──
function buildDocHTML(doc, bodyHTML, cfg) {
  const accent = cfg.branding?.accent || '#7c6aed';
  const clientName = cfg.client?.name || 'Client';
  const effectiveDate = cfg.effective_date || new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${doc.title} — ${clientName} | Monarch Stack</title>
<style>${getMSAStyles(accent)}</style>
</head>
<body>

<!-- HEADER -->
<div class="doc-header">
  <h1>${doc.title}</h1>
  <div class="subtitle">${doc.subtitle}</div>
  <div class="date">Prepared for ${clientName} · ${effectiveDate}</div>
</div>

<!-- CONTENT -->
<div class="section">
${bodyHTML}
</div>

</body>
</html>`;
}

// ── Build Welcome Letter with law-firm letterhead styling ──
function buildWelcomeHTML(bodyHTML, cfg) {
  const accent = cfg.branding?.accent || '#7c6aed';
  const clientName = cfg.client?.name || 'Client';
  const repName = cfg.client?.rep_name || '';
  const email = cfg.client?.email || '';
  const effectiveDate = cfg.effective_date || new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome Letter — ${clientName} | Monarch Stack</title>
<style>
${getMSAStyles(accent)}

  /* ── Letterhead ── */
  .letterhead {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid var(--accent);
    padding-bottom: 1rem;
    margin-bottom: 1.75rem;
  }

  .letterhead-left {
    text-align: left;
  }

  .letterhead-firm {
    font-family: 'Playfair Display', serif;
    font-size: 18pt;
    font-weight: 600;
    color: var(--ink);
    margin-bottom: 0.15rem;
    letter-spacing: -0.01em;
  }

  .letterhead-tagline {
    font-size: 8.5pt;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .letterhead-right {
    text-align: right;
    font-size: 8.5pt;
    color: var(--ink-muted);
    line-height: 1.7;
  }

  .letterhead-right strong {
    color: var(--ink);
    font-weight: 600;
  }

  /* ── Date & Recipient Block ── */
  .letter-meta {
    margin-bottom: 1.5rem;
    font-size: 10pt;
    color: var(--ink-light);
    line-height: 1.7;
  }

  .letter-meta .date {
    margin-bottom: 1rem;
    color: var(--ink-muted);
    font-size: 9.5pt;
  }

  .letter-meta .recipient {
    font-size: 10pt;
  }

  .letter-meta .recipient strong {
    font-weight: 600;
    color: var(--ink);
  }

  /* ── Letter body overrides ── */
  .letter-body h1 {
    display: none;
  }

  .letter-body h2 {
    font-size: 12pt;
    font-weight: 700;
    margin-top: 1.25rem;
    margin-bottom: 0.4rem;
    padding-bottom: 0.2rem;
    border-bottom: 1px solid var(--border);
  }

  .letter-body hr {
    display: none;
  }

  /* ── Signature Block ── */
  .signature {
    margin-top: 1.75rem;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .signature .closing {
    font-size: 10.5pt;
    color: var(--ink-light);
    margin-bottom: 2rem;
    font-style: italic;
  }

  .sig-line {
    width: 2.5in;
    border-bottom: 1px solid var(--ink);
    margin-bottom: 0.35rem;
  }

  .sig-name {
    font-size: 11pt;
    font-weight: 700;
    color: var(--ink);
  }

  .sig-title {
    font-size: 9pt;
    color: var(--ink-muted);
    margin-top: 0.1rem;
  }

  .sig-firm {
    font-size: 9pt;
    color: var(--accent);
    font-weight: 600;
    margin-top: 0.1rem;
  }
</style>
</head>
<body>

<!-- LETTERHEAD -->
<div class="letterhead">
  <div class="letterhead-left">
    <div class="letterhead-firm">Monarch Stack</div>
    <div class="letterhead-tagline">Fractional CTO Services</div>
  </div>
  <div class="letterhead-right">
    <strong>Managed Automation & AI Engineering</strong><br>
    WhatsApp · GitHub · Encrypted Channels
  </div>
</div>

<!-- DATE & RECIPIENT -->
<div class="letter-meta">
  <div class="date">${effectiveDate}</div>
  <div class="recipient">
    <strong>${repName}</strong><br>
    ${clientName}<br>
    ${email}
  </div>
</div>

<!-- LETTER BODY -->
<div class="section letter-body">
${bodyHTML}
</div>

</body>
</html>`;
}

// ── Main ──
async function main() {
  console.log(`\n⚡ Generating Onboarding Documents for: ${config.client.name} (${clientId})\n`);

  fs.mkdirSync(DIST, { recursive: true });

  // Launch browser once
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const htmls = [];

  for (const doc of DOCS) {
    // 1. Read + hydrate + render
    const mdPath = path.join(DOCS_DIR, doc.file);
    if (!fs.existsSync(mdPath)) {
      console.error(`  ✗ Missing: ${mdPath}`);
      process.exit(1);
    }
    let md = fs.readFileSync(mdPath, 'utf-8');
    md = hydrate(md, config);
    const html = cleanHTMLTableRows(renderMarkdown(md));
    htmls.push(html);

    // 2. Build standalone HTML (welcome letter gets letterhead treatment)
    const fullHTML = doc.file === '01-welcome.md'
      ? buildWelcomeHTML(html, config)
      : buildDocHTML(doc, html, config);

    // 3. Save HTML
    const htmlPath = path.join(DIST, doc.htmlName);
    fs.writeFileSync(htmlPath, fullHTML, 'utf-8');

    // 4. Render PDF
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(120000);
    await page.setContent(fullHTML, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.evaluateHandle('document.fonts.ready');

    const clientName = config.client?.name || 'Client';
    const accent = config.branding?.accent || '#7c6aed';
    const pdfPath = path.join(DIST, doc.pdfName);
    await page.pdf({
      path: pdfPath,
      format: 'Letter',
      margin: { top: '0.75in', bottom: '0.85in', left: '1in', right: '1in' },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="width:100%;text-align:center;font-family:'Inter',sans-serif;font-size:7pt;color:#666;padding:0 1in;">
          <div style="border-top:1.5px solid ${accent};padding-top:6px;">
            <span style="font-weight:700;font-size:6.5pt;letter-spacing:0.1em;text-transform:uppercase;color:${accent};">Monarch Stack · Fractional CTO Services</span><br>
            <span>Confidential — Prepared exclusively for ${clientName}</span>
          </div>
        </div>
      `,
      preferCSSPageSize: false
    });

    await page.close();

    const sz = fs.statSync(pdfPath);
    console.log(`  ✓ ${doc.title.padEnd(20)} → ${doc.pdfName} (${(sz.size / 1024).toFixed(1)} KB)`);
  }

  // ── Combined Onboarding Packet Generation ──
  if (htmls.length === 3) {
    const packetHTML = buildPacketHTML(htmls[0], htmls[1], htmls[2], config);
    const packetHtmlPath = path.join(DIST, 'onboarding-packet.html');
    fs.writeFileSync(packetHtmlPath, packetHTML, 'utf-8');

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(120000);
    await page.setContent(packetHTML, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.evaluateHandle('document.fonts.ready');

    const clientName = config.client?.name || 'Client';
    const accent = config.branding?.accent || '#7c6aed';
    const packetPdfPath = path.join(DIST, 'onboarding-packet.pdf');
    await page.pdf({
      path: packetPdfPath,
      format: 'Letter',
      margin: { top: '0.75in', bottom: '0.85in', left: '1in', right: '1in' },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `
        <div style="width:100%;text-align:center;font-family:'Inter',sans-serif;font-size:7pt;color:#666;padding:0 1in;">
          <div style="border-top:1.5px solid ${accent};padding-top:6px;">
            <span style="font-weight:700;font-size:6.5pt;letter-spacing:0.1em;text-transform:uppercase;color:${accent};">Monarch Stack · Onboarding Packet</span><br>
            <span>Confidential — Prepared exclusively for ${clientName}</span>
          </div>
        </div>
      `,
      preferCSSPageSize: false
    });

    await page.close();

    const sz = fs.statSync(packetPdfPath);
    console.log(`  ✓ Onboarding Packet    → onboarding-packet.pdf (${(sz.size / 1024).toFixed(1)} KB)`);
  }

  await browser.close();
  console.log('\n✅ All onboarding documents generated.\n');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
