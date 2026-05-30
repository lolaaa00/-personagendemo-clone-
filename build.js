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

// ── Recursive Directory Copy Helper ──
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ── Clean and Ensure dist directory ──
if (fs.existsSync(DIST)) {
  fs.readdirSync(DIST).forEach(file => {
    const filePath = path.join(DIST, file);
    if (fs.lstatSync(filePath).isDirectory()) {
      fs.rmSync(filePath, { recursive: true, force: true });
    } else {
      if (file !== 'msa.pdf') { // Preserve generated PDF if exists
        fs.unlinkSync(filePath);
      }
    }
  });
} else {
  fs.mkdirSync(DIST, { recursive: true });
}
fs.mkdirSync(path.join(DIST, 'data'), { recursive: true });

// ── Copy assets directory ──
const ASSETS_SRC = path.join(__dirname, 'assets');
if (fs.existsSync(ASSETS_SRC)) {
  copyDir(ASSETS_SRC, path.join(DIST, 'assets'));
  console.log(`  ✓ Copied assets/ directory`);
}

// ── Copy modules directory ──
const MODULES_SRC = path.join(__dirname, 'modules');
if (fs.existsSync(MODULES_SRC)) {
  copyDir(MODULES_SRC, path.join(DIST, 'modules'));
  console.log(`  ✓ Copied modules/ directory`);
}

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

// ── Onboarding Docs → JSON Pipeline ──

/**
 * Parse status emojis from markdown table rows and list items
 * Returns structured task objects for the PM dashboard
 */
function parseOnboardingTasks(mdContent, sourceFile) {
  const tasks = [];
  const lines = mdContent.split('\n');
  let currentPhase = '';
  let phaseIndex = 0;
  let taskIndex = 0;

  // Status emoji → dashboard status mapping
  const statusMap = {
    '🔲': 'new',
    '🔄': 'active',
    '👁️': 'review',
    '✅': 'done',
    '❌': 'blocked'
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track current phase heading (### Phase X — Name)
    const phaseMatch = line.match(/^###\s+(?:Phase\s+\d+\s*[—–-]\s*)?(.+)/);
    if (phaseMatch) {
      currentPhase = phaseMatch[1].trim();
      phaseIndex++;
      taskIndex = 0;
    }

    // Parse table rows with status emojis
    const tableMatch = line.match(/\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(🔲|🔄|👁️|✅|❌)\s*\|\s*(.*?)\s*\|/);
    if (tableMatch) {
      const title = tableMatch[1].trim();
      const owner = tableMatch[2].trim();
      const emoji = tableMatch[3];
      const date = tableMatch[4].trim() || null;

      // Skip header rows and status-board overview rows (where title is just a number)
      if (title === 'Milestone' || title === '#' || title.match(/^[-─]+$/) || title.match(/^\d+$/)) continue;
      // Skip filler rows
      if (title === '—' || title === '-') continue;

      taskIndex++;
      const source = sourceFile.replace(/^\d+-/, '').replace(/\.md$/, '');
      tasks.push({
        id: `onb-${source}-${phaseIndex}-${String(taskIndex).padStart(3, '0')}`,
        title: title.replace(/\*\*/g, ''),
        phase: currentPhase,
        status: statusMap[emoji] || 'new',
        owner: owner.replace(/\*\*/g, ''),
        source: sourceFile.replace('.md', ''),
        type: 'onboarding',
        date: date === '—' ? null : date,
        created: new Date().toISOString()
      });
    }

    // Also parse checklist items: - [ ] / - [x] with owner context
    const checkMatch = line.match(/^[-*]\s+\[([ xX/])\]\s+(.+)/);
    if (checkMatch) {
      const checked = checkMatch[1].toLowerCase();
      const title = checkMatch[2].trim().replace(/\*\*/g, '');
      const status = checked === 'x' ? 'done' : checked === '/' ? 'active' : 'new';

      // Skip sub-items (indented)
      if (line.match(/^\s{4,}/)) continue;

      taskIndex++;
      const source = sourceFile.replace(/^\d+-/, '').replace(/\.md$/, '');
      tasks.push({
        id: `onb-${source}-${phaseIndex}-${String(taskIndex).padStart(3, '0')}`,
        title: title.replace(/\[.*?\]\(.*?\)/g, (m) => m.match(/\[(.*?)\]/)[1]), // strip links, keep text
        phase: currentPhase || 'General',
        status,
        owner: 'Monarch',
        source: sourceFile.replace('.md', ''),
        type: 'onboarding',
        date: null,
        created: new Date().toISOString()
      });
    }
  }
  return tasks;
}

/**
 * Convert markdown to HTML for dashboard doc panels
 * Lightweight regex-based — handles tables, headers, lists, code, links, status emojis
 */
function convertMarkdownToHtml(md) {
  let html = md;

  // Remove YAML frontmatter if any
  html = html.replace(/^---[\s\S]*?---\n*/m, '');

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre class="pm-doc-code"><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim()}</code></pre>`
  );

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h5 class="pm-doc-h4">$1</h5>');
  html = html.replace(/^### (.+)$/gm, '<h4 class="pm-doc-h3">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="pm-doc-h2">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2 class="pm-doc-h1">$1</h2>');

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr class="pm-doc-hr">');

  // Blockquotes (including nested > [!NOTE] etc.)
  html = html.replace(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n((?:>.*\n?)*)/gm, (_, type, content) => {
    const cleanContent = content.replace(/^>\s?/gm, '').trim();
    return `<div class="pm-doc-callout pm-doc-callout-${type.toLowerCase()}">${cleanContent}</div>`;
  });
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote class="pm-doc-quote">$1</blockquote>');

  // Tables
  html = html.replace(/((?:\|.+\|[ \t]*\n){2,})/g, (tableBlock) => {
    const rows = tableBlock.trim().split('\n').filter(r => r.trim());
    if (rows.length < 2) return tableBlock;

    const parseRow = (row) => row.split('|').slice(1, -1).map(c => c.trim());
    const headers = parseRow(rows[0]);

    // Skip separator row
    const dataRows = rows.slice(2);
    let tableHtml = '<table class="pm-doc-table"><thead><tr>';
    headers.forEach(h => { tableHtml += `<th>${h}</th>`; });
    tableHtml += '</tr></thead><tbody>';
    dataRows.forEach(row => {
      const cells = parseRow(row);
      tableHtml += '<tr>';
      cells.forEach(c => {
        // Replace status emojis with badges
        let cell = c;
        cell = cell.replace(/🔲/g, '<span class="pm-status-badge pm-status-new">Pending</span>');
        cell = cell.replace(/🔄/g, '<span class="pm-status-badge pm-status-active">Active</span>');
        cell = cell.replace(/👁️/g, '<span class="pm-status-badge pm-status-review">Review</span>');
        cell = cell.replace(/✅/g, '<span class="pm-status-badge pm-status-done">Done</span>');
        cell = cell.replace(/❌/g, '<span class="pm-status-badge pm-status-blocked">Blocked</span>');
        tableHtml += `<td>${cell}</td>`;
      });
      tableHtml += '</tr>';
    });
    tableHtml += '</tbody></table>';
    return tableHtml;
  });

  // Checklist items
  html = html.replace(/^[-*]\s+\[x\]\s+(.+)$/gm, '<div class="pm-doc-check done">✅ $1</div>');
  html = html.replace(/^[-*]\s+\[\/\]\s+(.+)$/gm, '<div class="pm-doc-check active">🔄 $1</div>');
  html = html.replace(/^[-*]\s+\[ \]\s+(.+)$/gm, '<div class="pm-doc-check pending">🔲 $1</div>');

  // Regular list items
  html = html.replace(/^[-*]\s+(.+)$/gm, '<div class="pm-doc-li">• $1</div>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="pm-doc-inline-code">$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="pm-doc-link" target="_blank">$1</a>');

  // Status emojis in body text
  html = html.replace(/🔲/g, '<span class="pm-status-badge pm-status-new">Pending</span>');
  html = html.replace(/🔄/g, '<span class="pm-status-badge pm-status-active">Active</span>');
  html = html.replace(/✅/g, '<span class="pm-status-badge pm-status-done">Done</span>');

  // Paragraphs — wrap remaining plain lines
  html = html.replace(/^(?!<[a-zA-Z]|$)(.+)$/gm, '<p class="pm-doc-p">$1</p>');

  // Clean up empty paragraphs
  html = html.replace(/<p class="pm-doc-p">\s*<\/p>/g, '');

  return html;
}

/**
 * Extract version from markdown changelog table
 */
function extractDocVersion(mdContent) {
  const versionMatch = mdContent.match(/\|\s*([\d.]+)\s*\|/);
  return versionMatch ? versionMatch[1] : '1.0';
}

/**
 * Build onboarding data: tasks JSON + docs HTML JSON
 */
function buildOnboardingData(cfg) {
  const DOCS_DIR = path.join(__dirname, 'docs', 'onboarding');
  if (!fs.existsSync(DOCS_DIR)) {
    console.log('  ⚠ No docs/onboarding/ directory found, skipping');
    return;
  }

  const docFiles = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.md')).sort();
  if (docFiles.length === 0) return;

  let allTasks = [];
  const docPanels = [];

  // Icon + title mapping for doc panels
  const docMeta = {
    '01-welcome': { icon: '👋', label: 'Welcome Letter' },
    '02-system-playbook': { icon: '🏗️', label: 'System Playbook' },
    '03-project-tracker': { icon: '📊', label: 'Project Tracker' }
  };

  docFiles.forEach(file => {
    let content = fs.readFileSync(path.join(DOCS_DIR, file), 'utf-8');

    // Apply template token replacement
    content = processTemplate(content, cfg);

    // Extract tasks from tracker and playbook
    if (file !== '01-welcome.md') {
      const tasks = parseOnboardingTasks(content, file);
      allTasks = allTasks.concat(tasks);
    }

    // Convert to HTML for doc panels
    const html = convertMarkdownToHtml(content);
    const version = extractDocVersion(content);
    const baseName = file.replace('.md', '');
    const meta = docMeta[baseName] || { icon: '📄', label: baseName };

    docPanels.push({
      id: baseName,
      title: meta.label,
      icon: meta.icon,
      version: version,
      file: file,
      html: html
    });
  });

  // Write tasks JSON (only if no live state exists yet — preserve dashboard edits)
  const tasksPath = path.join(DIST, 'data', 'onboarding-tasks.json');
  fs.writeFileSync(tasksPath, JSON.stringify(allTasks, null, 2));
  console.log(`  ✓ Extracted ${allTasks.length} onboarding tasks → data/onboarding-tasks.json`);

  // Write docs HTML JSON (always regenerate — content may have changed)
  const docsPath = path.join(DIST, 'data', 'onboarding-docs.json');
  fs.writeFileSync(docsPath, JSON.stringify(docPanels, null, 2));
  console.log(`  ✓ Converted ${docPanels.length} docs → data/onboarding-docs.json`);
}

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

function compilePortalPages(content, DIST) {
  // Helper to extract substrings using matching tags
  function getElementContent(html, searchStr) {
    const startIdx = html.indexOf(searchStr);
    if (startIdx === -1) return '';
    
    const tagStartCloseIdx = html.indexOf('>', startIdx);
    if (tagStartCloseIdx === -1) return '';
    
    const tagTypeMatch = searchStr.match(/<([a-zA-Z0-9]+)/);
    const tagType = tagTypeMatch ? tagTypeMatch[1] : 'div';
    
    let depth = 1;
    let pos = tagStartCloseIdx + 1;
    const openTagPattern = new RegExp(`<${tagType}\\b`, 'i');
    const closeTagPattern = new RegExp(`</${tagType}>`, 'i');
    
    while (depth > 0 && pos < html.length) {
      const slice = html.slice(pos);
      const nextOpen = slice.search(openTagPattern);
      const nextClose = slice.search(closeTagPattern);
      
      if (nextClose === -1) {
        break;
      }
      
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos += nextOpen + 1;
      } else {
        depth--;
        pos += nextClose + tagType.length + 3;
      }
    }
    
    return html.slice(startIdx, pos);
  }

  // Extract base components
  const head = content.slice(content.indexOf('<head>'), content.indexOf('</head>') + 7);
  const rightPanel = getElementContent(content, '<aside class="dash-right-panel">');
  const footerAndScripts = content.slice(content.indexOf('<!-- ═══════ FOOTER ═══════ -->'));

  // Sidebar and Header (extracted from the first part of view-portal)
  const sidebarStart = content.indexOf('<aside class="dash-sidebar">');
  const centerPanelStart = content.indexOf('<div class="dash-center-panel">');
  if (sidebarStart === -1 || centerPanelStart === -1) {
    console.error('  ⚠ Could not find dash-sidebar or dash-center-panel, skipping sub-page build.');
    return;
  }
  const sidebarAndHeader = content.slice(sidebarStart, centerPanelStart + '<div class="dash-center-panel">'.length);

  // Extract individual contents
  const subContents = {
    dashboard: getElementContent(content, '<div id="dash-sec-summary">'),
    scout: getElementContent(content, '<div id="dash-sec-scout"').replace(/style="[^"]*margin-top[^"]*"/, 'style="margin-top: 0; padding-top: 0; border-top: none;"'),
    generator: getElementContent(content, '<div id="dash-sec-generator"').replace(/style="[^"]*margin-top[^"]*"/, 'style="margin-top: 0; padding-top: 0; border-top: none;"'),
    calendar: getElementContent(content, '<div id="dash-sec-calendar"').replace(/style="[^"]*margin-top[^"]*"/, 'style="margin-top: 0; padding-top: 0; border-top: none;"'),
    pm: getElementContent(content, '<div id="portal-view-pm"'),
    accounts: getElementContent(content, '<div id="portal-view-accounts"'),
    'persona-config': getElementContent(content, '<div id="portal-view-persona-config"'),
    inbox: getElementContent(content, '<div id="portal-view-inbox"'),
    trends: getElementContent(content, '<div id="portal-view-trends"'),
    agreement: getElementContent(content, '<div id="portal-view-agreement"')
  };

  // Define pages
  const pages = [
    { file: 'dashboard.html', title: 'Operations Dashboard', activeMenu: 'menu-dashboard', view: 'dashboard', hasRightPanel: true, workspaceClass: '' },
    { file: 'calendar.html', title: 'UGC Content Calendar', activeMenu: 'menu-calendar', view: 'calendar', hasRightPanel: true, workspaceClass: '' },
    { file: 'scout.html', title: 'Social Scout Intelligence', activeMenu: 'menu-scout', view: 'scout', hasRightPanel: true, workspaceClass: '' },
    { file: 'generator.html', title: 'Interactive Creator & Roster', activeMenu: 'menu-generator', view: 'generator', hasRightPanel: true, workspaceClass: '' },
    { file: 'pm.html', title: 'Support Tickets & Requests', activeMenu: 'menu-pm', view: 'pm', hasRightPanel: false, workspaceClass: 'no-right-sidebar' },
    { file: 'accounts.html', title: 'Connected Platform Handles', activeMenu: 'menu-accounts', view: 'accounts', hasRightPanel: false, workspaceClass: 'no-right-sidebar' },
    { file: 'persona-config.html', title: 'AI Agent Configuration', activeMenu: 'menu-persona-config', view: 'persona-config', hasRightPanel: false, workspaceClass: 'no-right-sidebar' },
    { file: 'inbox.html', title: 'Inbox & Engagement Hub', activeMenu: 'menu-inbox', view: 'inbox', hasRightPanel: false, workspaceClass: 'no-right-sidebar' },
    { file: 'trends.html', title: 'Trending Topics Monitor', activeMenu: 'menu-trends', view: 'trends', hasRightPanel: false, workspaceClass: 'no-right-sidebar' },
    { file: 'agreement.html', title: 'Managed Plan SOW & SLA', activeMenu: 'menu-agreement', view: 'agreement', hasRightPanel: false, workspaceClass: 'no-right-sidebar' }
  ];

  pages.forEach(p => {
    // Build sidebar replacement with active class
    let customizedSidebarAndHeader = sidebarAndHeader;
    
    // Replace button menus with links and activate correct menu item
    const menuItemsPattern = /<button class="dash-menu-item([^"]*)" onclick="switchPortalView\('([^']*)', this\)">([\s\S]*?)<\/button>/g;
    customizedSidebarAndHeader = customizedSidebarAndHeader.replace(menuItemsPattern, (match, classes, viewId, innerHtml) => {
      const isCurrent = viewId === p.view;
      const activeClass = isCurrent ? ' active' : '';
      const pageLinkMap = {
        dashboard: 'dashboard.html',
        calendar: 'calendar.html',
        scout: 'scout.html',
        generator: 'generator.html',
        pm: 'pm.html',
        accounts: 'accounts.html',
        agreement: 'agreement.html'
      };
      const href = pageLinkMap[viewId] || 'dashboard.html';
      return `<a href="${href}" class="dash-menu-item${activeClass}">\n                        ${innerHtml.trim()}\n                    </a>`;
    });

    // Customize top header title
    customizedSidebarAndHeader = customizedSidebarAndHeader.replace(
      /<h2 class="dash-header-title" id="dash-view-title">[^<]*<\/h2>/,
      `<h2 class="dash-header-title" id="dash-view-title">${p.title}</h2>`
    );

    // Customize + Submit Ticket button in header (change to link for pm page)
    customizedSidebarAndHeader = customizedSidebarAndHeader.replace(
      /<button class="dash-header-btn" onclick="switchPortalView\('pm'\)">/g,
      `<a href="pm.html" class="dash-header-btn" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center;">`
    ).replace(/<\/button>(\s*<div class="dash-user-badge">)/g, `</a>$1`);

    // Customize workspace grid classes
    customizedSidebarAndHeader = customizedSidebarAndHeader.replace(
      /<div class="dash-workspace">/g,
      `<div class="dash-workspace ${p.workspaceClass}">`
    );

    // Combine into full page HTML
    let pageContent = subContents[p.view];
    if (!pageContent) {
      console.warn(`  ⚠ Content empty for view: ${p.view}`);
      pageContent = '';
    }

    // If this view is pm, accounts, or agreement, ensure it has style display: block
    pageContent = pageContent.replace(/class="portal-subview"/, 'class="portal-subview active" style="display:block;"');
    
    const rightPanelHtml = p.hasRightPanel ? rightPanel : '';

    const fullHtml = `<!DOCTYPE html>
<html lang="en">
${head}
<body class="portal-active">
    <script>
        if (sessionStorage.getItem('pg_portal_unlocked') !== 'yes') {
            window.location.href = 'index.html?portal=trigger';
        }
    </script>
    <div id="view-portal" class="tab-content" style="display: block;">
        <div class="dashboard-layout">
            ${customizedSidebarAndHeader}
                ${pageContent}
            </div>
            ${rightPanelHtml}
        </div>
        </main>
    </div>
</div>
${footerAndScripts}`;

    fs.writeFileSync(path.join(DIST, p.file), fullHtml, 'utf-8');
    console.log(`  ✓ Compiled sub-page: ${p.file}`);
  });
}

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
  
  if (file === 'index.html') {
    // Compile separate portal sub-pages from content
    compilePortalPages(content, DIST);

    // Strip view-portal from landing page content to keep it clean
    const viewPortalStart = content.indexOf('<div id="view-portal"');
    const viewPortalEnd = content.indexOf('</div><!-- End #view-portal -->');
    if (viewPortalStart !== -1 && viewPortalEnd !== -1) {
      content = content.slice(0, viewPortalStart) + content.slice(viewPortalEnd + '</div><!-- End #view-portal -->'.length);
    }
  }

  // Write processed file
  fs.writeFileSync(path.join(DIST, file), content, 'utf-8');
  console.log(`  ✓ Processed ${file}`);
});
// ── Build onboarding data (docs → JSON for dashboard) ──
buildOnboardingData(config);

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
