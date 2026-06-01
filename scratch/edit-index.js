const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'index.html');
const content = fs.readFileSync(filePath, 'utf-8');

// --- Find markers by content, not line numbers ---

// Marker A: Start of nav (line starting with "    <!-- Shared Nav")
const navStart = content.indexOf('    <!-- Shared Nav');
if (navStart === -1) { console.error('FATAL: nav start marker not found'); process.exit(1); }

// Marker B: Start of view-portal div
const portalStart = content.indexOf('    <div id="view-portal"');
if (portalStart === -1) { console.error('FATAL: view-portal marker not found'); process.exit(1); }

console.log('Nav starts at char offset:', navStart);
console.log('Portal starts at char offset:', portalStart);

// New nav + comment block (replaces everything from navStart to portalStart)
const newNav = `    <!-- Shared Nav (hidden until portal unlocked) -->
    <nav class="pg-nav" id="main-nav" style="display:none;">
        <div class="pg-nav-inner">
            <a href="index.html" class="pg-nav-brand">
                <div class="pg-nav-logo">
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                </div>
                <span class="pg-nav-wordmark">PersonaGen</span>
            </a>
            <div class="pg-nav-links">
                <a href="#timeline" class="pg-nav-link portal-nav-item">Onboarding</a>
                <a href="#scout" class="pg-nav-link portal-nav-item">Scout</a>
                <a href="#generator" class="pg-nav-link portal-nav-item">Generate</a>
                <a href="#showcase" class="pg-nav-link portal-nav-item">Roster</a>
                <a href="#calendar" class="pg-nav-link portal-nav-item">Calendar</a>
                <a href="#dashboard" class="pg-nav-link portal-nav-item">Dashboard</a>
                <a href="#account-creator" class="pg-nav-link portal-nav-item">AI Accounts</a>
                <a href="#persona-config" class="pg-nav-link portal-nav-item" onclick="switchPortalView('persona-config')">Persona Config</a>
                <a href="#inbox" class="pg-nav-link portal-nav-item" onclick="switchPortalView('inbox')">Inbox</a>
                <a href="#trends" class="pg-nav-link portal-nav-item" onclick="switchPortalView('trends')">Trends</a>
                <a href="#channel-decoder" class="pg-nav-link portal-nav-item" onclick="switchPortalView('channel-decoder')">Decoder</a>
                <a href="#content-forge" class="pg-nav-link portal-nav-item" onclick="switchPortalView('content-forge')">Forge</a>
                <a href="#project-manager" class="pg-nav-link portal-nav-item">Projects</a>
                <a href="#agreement-details" class="pg-nav-link portal-nav-item">Agreement</a>
            </div>
            <div class="pg-nav-badge"><span class="pg-nav-pulse"></span>HoneyForX \u00b7 Live</div>
            <button class="pg-nav-hamburger" id="pg-hamburger" aria-label="Menu" onclick="toggleNav()">
              <span></span><span></span><span></span>
            </button>
        </div>
    </nav>
    <nav class="pg-nav-drawer" id="pg-drawer">
      <a href="#timeline" class="pg-nav-link portal-nav-item" onclick="toggleNav()">Onboarding</a>
      <a href="#scout" class="pg-nav-link portal-nav-item" onclick="toggleNav()">Scout</a>
      <a href="#generator" class="pg-nav-link portal-nav-item" onclick="toggleNav()">Generate</a>
      <a href="#showcase" class="pg-nav-link portal-nav-item" onclick="toggleNav()">Roster</a>
      <a href="#calendar" class="pg-nav-link portal-nav-item" onclick="toggleNav()">Calendar</a>
      <a href="#dashboard" class="pg-nav-link portal-nav-item" onclick="toggleNav()">Dashboard</a>
      <a href="#account-creator" class="pg-nav-link portal-nav-item" onclick="toggleNav()">AI Accounts</a>
      <a href="#persona-config" class="pg-nav-link portal-nav-item" onclick="switchPortalView('persona-config'); toggleNav()">Persona Config</a>
      <a href="#inbox" class="pg-nav-link portal-nav-item" onclick="switchPortalView('inbox'); toggleNav()">Inbox</a>
      <a href="#trends" class="pg-nav-link portal-nav-item" onclick="switchPortalView('trends'); toggleNav()">Trends</a>
      <a href="#channel-decoder" class="pg-nav-link portal-nav-item" onclick="switchPortalView('channel-decoder'); toggleNav()">Decoder</a>
      <a href="#content-forge" class="pg-nav-link portal-nav-item" onclick="switchPortalView('content-forge'); toggleNav()">Forge</a>
      <a href="#project-manager" class="pg-nav-link portal-nav-item" onclick="toggleNav()">Projects</a>
      <a href="#agreement-details" class="pg-nav-link portal-nav-item" onclick="toggleNav()">Agreement</a>
    </nav>

    <!-- Landing page removed \u2014 see backup/landing-page-content.md -->

`;

// Build new content: before nav + new nav + view-portal onwards
let result = content.slice(0, navStart) + newNav + content.slice(portalStart);

// Fix title
result = result.replace(
  '<title>PersonaGen \u2014 AI UGC Creator Automation for HoneyForX</title>',
  '<title>PersonaGen \u2014 Client Portal</title>'
);

// Fix meta description
result = result.replace(
  '<meta name="description" content="Generate hyper-realistic AI influencers that create content, build audiences, and post autonomously across every major platform.">',
  '<meta name="description" content="PersonaGen Client Portal \u2014 manage your AI UGC creator operations, agents, content calendar, and analytics.">'
);

// Fix pin-gate: display none -> flex
result = result.replace(
  '<div id="pin-gate" style="display: none;">',
  '<div id="pin-gate" style="display: flex;">'
);

// Add role="main" to view-portal
result = result.replace(
  '<div id="view-portal" class="tab-content" style="display: none;">',
  '<div id="view-portal" class="tab-content" role="main" style="display: none;">'
);

fs.writeFileSync(filePath, result, 'utf-8');

// Verify
const final = fs.readFileSync(filePath, 'utf-8');
const lineCount = final.split('\n').length;
console.log('Final line count:', lineCount);
console.log('Has pin-gate flex:', final.includes('pin-gate" style="display: flex;"'));
console.log('Has view-portal role:', final.includes('role="main"'));
console.log('Has landing page content:', final.includes('view-demo'));
console.log('Has old nav tabs:', final.includes('nav-tab-demo'));
console.log('Title updated:', final.includes('Client Portal</title>'));
console.log('\nDone!');
