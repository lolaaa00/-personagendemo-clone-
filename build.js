#!/usr/bin/env node
/**
 * PersonaGen Meta-Template Build Script
 * 
 * Usage: node build.js <client-id>
 * Example: node build.js honeyforx
 * 
 * Reads clients/<client-id>.config.json, processes template files,
 * and outputs a deploy-ready site to dist/<client-id>/
 */

const fs = require('fs');
const path = require('path');

// ── CLI Args ──
const clientId = process.argv[2];
if (!clientId) {
  console.error('Usage: node build.js <client-id>');
  console.error('Example: node build.js honeyforx');
  process.exit(1);
}

const CONFIG_PATH = path.join(__dirname, 'clients', `${clientId}.config.json`);
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`Config not found: ${CONFIG_PATH}`);
  console.error(`Available clients: ${fs.readdirSync(path.join(__dirname, 'clients')).filter(f => f.endsWith('.config.json')).map(f => f.replace('.config.json', '')).join(', ')}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const DIST = path.join(__dirname, 'dist', clientId);

console.log(`\n⚡ Building PersonaGen for: ${config.client.name} (${clientId})`);
console.log(`   Output: ${DIST}\n`);

// ── Ensure dist directory ──
fs.mkdirSync(DIST, { recursive: true });
fs.mkdirSync(path.join(DIST, 'data'), { recursive: true });

// ── Template Processing ──

/**
 * Replace {{path.to.value}} placeholders with config values
 * Supports dot-notation access: {{client.name}} → config.client.name
 */
function resolveValue(obj, dotPath) {
  return dotPath.split('.').reduce((acc, key) => {
    if (acc === undefined || acc === null) return '';
    return acc[key];
  }, obj);
}

function processTemplate(content, cfg) {
  // Simple {{key.path}} replacement
  return content.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (match, keyPath) => {
    const value = resolveValue(cfg, keyPath);
    if (value === undefined || value === null) {
      console.warn(`  ⚠ Unresolved: ${match}`);
      return match;
    }
    return String(value);
  });
}

// ── Copy static assets (CSS, JS) ──
const STATIC_FILES = [
  'tokens.css',
  'styles.css', 
  'data-loader.js'
];

STATIC_FILES.forEach(file => {
  const src = path.join(__dirname, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(DIST, file));
    console.log(`  ✓ Copied ${file}`);
  }
});

// ── Copy data files ──
const DATA_DIR = path.join(__dirname, 'data');
if (fs.existsSync(DATA_DIR)) {
  fs.readdirSync(DATA_DIR).forEach(file => {
    if (file.endsWith('.json') || file.endsWith('.md')) {
      fs.copyFileSync(path.join(DATA_DIR, file), path.join(DIST, 'data', file));
    }
  });
  console.log(`  ✓ Copied data/ directory`);
}

// ── Process MSA template ──
const MSA_SRC = path.join(__dirname, 'templates', 'msa-template.html');
if (fs.existsSync(MSA_SRC)) {
  let msa = fs.readFileSync(MSA_SRC, 'utf-8');
  msa = processTemplate(msa, config);
  fs.writeFileSync(path.join(DIST, 'msa.html'), msa, 'utf-8');
  console.log(`  ✓ Processed msa.html`);
}

// ── Process script.js (replace PIN) ──
const SCRIPT_SRC = path.join(__dirname, 'script.js');
if (fs.existsSync(SCRIPT_SRC)) {
  let scriptContent = fs.readFileSync(SCRIPT_SRC, 'utf-8');
  // Replace PIN code
  scriptContent = scriptContent.replace(
    /CORRECT:\s*'[^']*'/,
    `CORRECT: '${config.client.pin}'`
  );
  fs.writeFileSync(path.join(DIST, 'script.js'), scriptContent, 'utf-8');
  console.log(`  ✓ Processed script.js`);
}

// ── Process HTML templates ──
const HTML_FILES = ['index.html'];

HTML_FILES.forEach(file => {
  const src = path.join(__dirname, file);
  if (!fs.existsSync(src)) {
    console.warn(`  ⚠ Template not found: ${file}`);
    return;
  }
  
  let content = fs.readFileSync(src, 'utf-8');
  
  // ─── Brand replacements ───
  // Replace brand name in nav, hero, footer
  content = content.replace(/HoneyForX/g, config.client.name);
  
  // Replace Stripe links
  if (config.pricing.tiers[0]?.stripe_link) {
    content = content.replace(
      /https:\/\/buy\.stripe\.com\/YOUR_STRIPE_LINK/g,
      config.pricing.tiers[0].stripe_link
    );
    content = content.replace(
      /https:\/\/buy\.stripe\.com\/YOUR_STRIPE_STARTER/g,
      config.pricing.tiers[0].stripe_link
    );
  }
  if (config.pricing.tiers[1]?.stripe_link) {
    content = content.replace(
      /https:\/\/buy\.stripe\.com\/YOUR_STRIPE_SCALE/g,
      config.pricing.tiers[1].stripe_link
    );
  }
  
  // Replace agreement link
  if (config.agreement?.docuseal_url) {
    content = content.replace(
      /https:\/\/app\.pandadoc\.com\/YOUR_AGREEMENT_LINK/g,
      config.agreement.docuseal_url
    );
  }
  
  // Replace WhatsApp link
  if (config.client.whatsapp) {
    content = content.replace(
      /https:\/\/wa\.me\/YOUR_WHATSAPP/g,
      config.client.whatsapp
    );
  }
  
  // Replace hero content for demo page
  if (file === 'index.html' && config.demo) {
    if (config.demo.hero_badge) {
      content = content.replace(
        /🍯 Built for HoneyForX · AI-Powered UGC Automation/,
        config.demo.hero_badge
      );
    }
  }
  
  // Process any remaining {{}} template markers
  content = processTemplate(content, config);
  
  // Write processed file
  fs.writeFileSync(path.join(DIST, file), content, 'utf-8');
  console.log(`  ✓ Processed ${file}`);
});

// ── Generate build manifest ──
const manifest = {
  client_id: clientId,
  client_name: config.client.name,
  built_at: new Date().toISOString(),
  config_hash: require('crypto').createHash('md5').update(JSON.stringify(config)).digest('hex'),
  files: fs.readdirSync(DIST, { recursive: true }).filter(f => !f.startsWith('.')),
  version: '1.0.0'
};
fs.writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`  ✓ Generated manifest.json`);

console.log(`\n✅ Build complete: ${DIST}`);
console.log(`   Deploy with: npx wrangler pages deploy ${DIST} --project-name=personagen-${clientId}`);
console.log(`   MSA PDF:     node generate-msa.js ${clientId}`);
console.log(`   MSA + Upload: node generate-msa.js ${clientId} --upload\n`);
