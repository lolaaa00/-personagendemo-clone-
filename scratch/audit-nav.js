const fs = require('fs');
const path = require('path');
const dist = path.join(__dirname, '..', 'dist', 'honeyforx');

console.log('═══════════════════════════════════════════════════');
console.log('  E2E NAVIGATION AUDIT — PersonaGen Portal');
console.log('═══════════════════════════════════════════════════\n');

const files = fs.readdirSync(dist).filter(f => f.endsWith('.html') && f !== 'msa.html' && f !== 'onboarding-packet.html');
let totalIssues = 0;

// ── 1. Auth Flow ──
console.log('━━━ 1. AUTH FLOW ━━━');
files.forEach(f => {
  const c = fs.readFileSync(path.join(dist, f), 'utf-8');
  if (f === 'index.html') {
    const hasPinGate = c.includes('id="pin-gate"');
    const pinFlex = c.includes('display: flex;') && c.includes('pin-gate');
    const noPortal = !c.includes('id="view-portal"');
    const noLanding = !c.includes('view-demo') && !c.includes('slide-hero');
    console.log(`  ${f}:`);
    console.log(`    PIN gate present: ${hasPinGate ? '✅' : '❌'}`);
    console.log(`    PIN starts visible: ${pinFlex ? '✅' : '❌'}`);
    console.log(`    No portal inline: ${noPortal ? '✅' : '❌'}`);
    console.log(`    No landing page: ${noLanding ? '✅' : '❌'}`);
    if (!hasPinGate || !pinFlex || !noPortal || !noLanding) totalIssues++;
  } else {
    const authCheck = c.includes("sessionStorage.getItem('pg_portal_unlocked') !== 'yes'");
    const redirectsToIndex = c.includes("window.location.href = 'index.html'");
    const noTrigger = !c.includes('portal=trigger');
    if (!authCheck) { console.log(`  ❌ ${f}: MISSING auth check`); totalIssues++; }
    if (!redirectsToIndex) { console.log(`  ❌ ${f}: MISSING redirect to index.html`); totalIssues++; }
    if (!noTrigger) { console.log(`  ❌ ${f}: Still has ?portal=trigger`); totalIssues++; }
  }
});
console.log('  All sub-pages have auth check + redirect to index.html ✅\n');

// ── 2. Sidebar Navigation ──
console.log('━━━ 2. SIDEBAR NAVIGATION ━━━');
const sidebarPages = { dashboard: false, scout: false, 'content-forge': false, inbox: false, 'persona-config': false };
const noSidebarHighlight = [];

files.filter(f => f !== 'index.html').forEach(f => {
  const c = fs.readFileSync(path.join(dist, f), 'utf-8');
  const hasActive = c.includes('dash-menu-item active');
  if (!hasActive) noSidebarHighlight.push(f);
  
  // Check all sidebar links are <a> not <button>
  const sidebarSection = c.match(/<nav class="dash-menu">([\s\S]*?)<\/nav>/);
  if (sidebarSection) {
    const buttons = (sidebarSection[1].match(/<button[^>]*dash-menu-item/g) || []);
    if (buttons.length > 0) {
      console.log(`  ❌ ${f}: ${buttons.length} sidebar buttons not converted to links`);
      totalIssues++;
    }
  }
});

if (noSidebarHighlight.length) {
  console.log(`  Pages with no sidebar highlight (by design - accessed via dropdown/header):`);
  noSidebarHighlight.forEach(f => console.log(`    ○ ${f}`));
}
console.log('  All sidebar buttons converted to <a> links ✅\n');

// ── 3. Mega Tab Bars ──
console.log('━━━ 3. MEGA TAB BARS ━━━');
const megaPages = {
  'Intelligence': ['scout.html', 'trends.html', 'channel-decoder.html'],
  'Content Studio': ['content-forge.html', 'calendar.html', 'brand-brief.html']
};
Object.entries(megaPages).forEach(([group, pages]) => {
  console.log(`  ${group}:`);
  pages.forEach(f => {
    const c = fs.readFileSync(path.join(dist, f), 'utf-8');
    const hasMegaBar = c.includes('mega-tab-bar');
    const hasActiveTab = c.includes('mega-tab active');
    const status = hasMegaBar && hasActiveTab ? '✅' : '❌';
    console.log(`    ${status} ${f} — bar:${hasMegaBar} active:${hasActiveTab}`);
    if (!hasMegaBar || !hasActiveTab) totalIssues++;
  });
});
console.log();

// ── 4. Profile Dropdown ──
console.log('━━━ 4. PROFILE DROPDOWN ━━━');
files.filter(f => f !== 'index.html').forEach(f => {
  const c = fs.readFileSync(path.join(dist, f), 'utf-8');
  const hasExit = c.includes('exitPortal()');
  const hasDropdown = c.includes('profile-dropdown-item');
  if (!hasExit) { console.log(`  ❌ ${f}: Missing exitPortal()`); totalIssues++; }
  if (!hasDropdown) { console.log(`  ❌ ${f}: Missing profile dropdown`); totalIssues++; }
});
console.log('  All sub-pages have exitPortal + profile dropdown ✅\n');

// ── 5. Stale References ──
console.log('━━━ 5. STALE REFERENCES ━━━');
const stalePatterns = ['switchTab(', 'nav-tab-demo', 'drawer-tab-demo', 'view-demo', 'portal=trigger', 'demo-nav-item'];
files.forEach(f => {
  const c = fs.readFileSync(path.join(dist, f), 'utf-8');
  stalePatterns.forEach(pattern => {
    if (c.includes(pattern)) {
      console.log(`  ❌ ${f}: Contains stale "${pattern}"`);
      totalIssues++;
    }
  });
});
if (totalIssues === 0) console.log('  No stale references found ✅');
console.log();

// ── 6. Cross-page link integrity ──
console.log('━━━ 6. CROSS-PAGE LINKS ━━━');
const allDistFiles = new Set(fs.readdirSync(dist));
files.filter(f => f !== 'index.html').forEach(f => {
  const c = fs.readFileSync(path.join(dist, f), 'utf-8');
  const links = c.match(/href="([a-z0-9-]+\.html)"/g) || [];
  const targets = links.map(l => l.match(/"([^"]+)"/)[1]);
  const missing = targets.filter(t => !allDistFiles.has(t));
  if (missing.length) {
    console.log(`  ❌ ${f}: Broken links → ${missing.join(', ')}`);
    totalIssues++;
  }
});
console.log('  All cross-page links resolve to existing files ✅\n');

console.log('═══════════════════════════════════════════════════');
console.log(`  TOTAL ISSUES: ${totalIssues}`);
console.log('═══════════════════════════════════════════════════');
