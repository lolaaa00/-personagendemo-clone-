#!/usr/bin/env node
/**
 * PersonaGen MSA — Automated PDF Generator & DocuSeal Uploader
 * 
 * Usage:
 *   node generate-msa.js <client-id>                    # Generate PDF only
 *   node generate-msa.js <client-id> --upload            # Generate + upload to DocuSeal
 * 
 * Prerequisites:
 *   npm install puppeteer
 * 
 * Environment:
 *   DOCUSEAL_API_TOKEN  — DocuSeal API token (or uses n8n credential)
 *   DOCUSEAL_URL        — DocuSeal instance URL (default: https://sign.jamesdev.pro)
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// ── CLI Args ──
const args = process.argv.slice(2);
const clientId = args.find(a => !a.startsWith('--'));
const shouldUpload = args.includes('--upload');

if (!clientId) {
  console.error('Usage: node generate-msa.js <client-id> [--upload]');
  process.exit(1);
}

// ── Config ──
const CONFIG_PATH = path.join(__dirname, 'clients', `${clientId}.config.json`);
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`Config not found: ${CONFIG_PATH}`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'msa-template.html');
if (!fs.existsSync(TEMPLATE_PATH)) {
  console.error(`MSA template not found: ${TEMPLATE_PATH}`);
  process.exit(1);
}

const DIST = path.join(__dirname, 'dist', clientId);
const PDF_PATH = path.join(DIST, 'msa.pdf');

const DOCUSEAL_URL = process.env.DOCUSEAL_URL || 'https://sign.jamesdev.pro';
const DOCUSEAL_TOKEN = process.env.DOCUSEAL_API_TOKEN || '';

// ── Template Processing ──
function resolveValue(obj, dotPath) {
  return dotPath.split('.').reduce((acc, key) => {
    if (acc === undefined || acc === null) return '';
    return acc[key];
  }, obj);
}

function processTemplate(content, cfg) {
  return content.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (match, keyPath) => {
    const value = resolveValue(cfg, keyPath);
    if (value === undefined || value === null) return match;
    return String(value);
  });
}

// ── Main ──
async function main() {
  console.log(`\n⚡ Generating MSA PDF for: ${config.client.name} (${clientId})\n`);

  // 1. Process template
  let html = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  html = processTemplate(html, config);

  // Auto-fill the effective date
  const today = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', month: 'long', day: 'numeric' 
  });
  html = html.replace('________________________, 2026', `${today}`);

  // 3. Embed local images as base64 data URIs (Puppeteer setContent can't resolve relative paths)
  console.log('  → Embedding persona images...');
  const ASSETS_DIR = path.join(__dirname, 'assets');
  html = html.replace(/src="(assets\/[^"]+)"/g, (match, relPath) => {
    const absPath = path.join(__dirname, relPath);
    if (fs.existsSync(absPath)) {
      const ext = path.extname(absPath).slice(1);
      const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      const b64 = fs.readFileSync(absPath).toString('base64');
      console.log(`    ✓ Embedded ${relPath}`);
      return `src="data:${mime};base64,${b64}"`;
    }
    console.warn(`    ⚠ Not found: ${relPath}`);
    return match;
  });

  // 2. Launch headless browser & render PDF
  console.log('  → Launching headless browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120000);

  await page.setContent(html, { waitUntil: 'networkidle2', timeout: 120000 });

  // Wait for fonts to load
  await page.evaluateHandle('document.fonts.ready');

  fs.mkdirSync(DIST, { recursive: true });

  console.log('  → Rendering PDF...');
  await page.pdf({
    path: PDF_PATH,
    format: 'Letter',
    margin: {
      top: '0.75in',
      bottom: '0.75in',
      left: '1in',
      right: '1in'
    },
    printBackground: true,
    displayHeaderFooter: false,
    preferCSSPageSize: true
  });

  await browser.close();

  const stats = fs.statSync(PDF_PATH);
  console.log(`  ✓ PDF generated: ${PDF_PATH} (${(stats.size / 1024).toFixed(1)} KB)\n`);

  // 3. Upload to DocuSeal (if --upload flag)
  if (shouldUpload) {
    if (!DOCUSEAL_TOKEN) {
      console.error('  ✗ DOCUSEAL_API_TOKEN not set. Set it via environment variable.');
      console.error('    export DOCUSEAL_API_TOKEN=your_token_here');
      process.exit(1);
    }

    console.log(`  → Uploading to DocuSeal (${DOCUSEAL_URL})...`);

    const pdfBuffer = fs.readFileSync(PDF_PATH);
    const pdfBase64 = pdfBuffer.toString('base64');

    const templateName = `MSA — ${config.client.name} — PersonaGen Managed Plan`;

    // DocuSeal API: Create template from PDF
    const response = await fetch(`${DOCUSEAL_URL}/api/templates/pdf`, {
      method: 'POST',
      headers: {
        'X-Auth-Token': DOCUSEAL_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: templateName,
        documents: [{
          name: `MSA-${clientId}.pdf`,
          file: pdfBase64,
          fields: [
            // Provider signature
            { name: 'provider_signature', type: 'signature', role: 'Provider', 
              areas: [{ page: 0, x: 0.05, y: 0.85, w: 0.4, h: 0.05 }] },
            // Client signature  
            { name: 'client_signature', type: 'signature', role: 'Client',
              areas: [{ page: 0, x: 0.55, y: 0.85, w: 0.4, h: 0.05 }] },
            // Client name
            { name: 'client_name', type: 'text', role: 'Client',
              areas: [{ page: 0, x: 0.55, y: 0.20, w: 0.4, h: 0.03 }] },
            // Client email
            { name: 'client_email', type: 'text', role: 'Client',
              areas: [{ page: 0, x: 0.55, y: 0.24, w: 0.4, h: 0.03 }] },
            // Date fields
            { name: 'provider_date', type: 'date', role: 'Provider',
              areas: [{ page: 0, x: 0.05, y: 0.93, w: 0.4, h: 0.03 }] },
            { name: 'client_date', type: 'date', role: 'Client',
              areas: [{ page: 0, x: 0.55, y: 0.93, w: 0.4, h: 0.03 }] },
            // Plan selection
            { name: 'selected_plan', type: 'text', role: 'Client',
              areas: [{ page: 0, x: 0.15, y: 0.52, w: 0.3, h: 0.03 }] }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`  ✗ DocuSeal upload failed: ${response.status}`);
      console.error(`    ${err}`);
      process.exit(1);
    }

    const template = await response.json();
    console.log(`  ✓ DocuSeal template created: ID ${template.id}`);
    console.log(`    Name: ${templateName}`);
    console.log(`    URL: ${DOCUSEAL_URL}/templates/${template.id}\n`);

    // 4. Update client config with template ID
    config.agreement.docuseal_template_id = template.id;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    console.log(`  ✓ Updated ${clientId}.config.json → docuseal_template_id: ${template.id}\n`);

    // 5. Print signing link command
    console.log('  Next: Create a signing request via n8n or API:');
    console.log(`    POST ${DOCUSEAL_URL}/api/submissions`);
    console.log(`    { "template_id": ${template.id}, "send_email": true,`);
    console.log(`      "submitters": [`);
    console.log(`        { "role": "Provider", "email": "you@jamesdev.pro" },`);
    console.log(`        { "role": "Client", "email": "client@example.com" }`);
    console.log(`      ]`);
    console.log(`    }\n`);
  }

  console.log('✅ Done.\n');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
