// Generate stub pages for all portal routes
const fs = require('fs');
const path = require('path');

const pages = [
  { route: 'scout', title: 'Social Scout', icon: '🔍', desc: 'Monitor competitor channels and discover trending content' },
  { route: 'generator', title: 'Avatar Generator', icon: '✨', desc: 'Create and configure new AI agent personas' },
  { route: 'pm', title: 'Project Manager', icon: '📋', desc: 'Kanban board and onboarding task management' },
  { route: 'accounts', title: 'Connected Accounts', icon: '🔗', desc: 'Manage social platform connections for each agent' },
  { route: 'persona-config', title: 'Persona Config', icon: '⚙️', desc: 'Configure agent soul, skills, tools, and heartbeat' },
  { route: 'inbox', title: 'Inbox', icon: '📨', desc: 'Engagement inbox and email management' },
  { route: 'intel-wizard', title: 'Intel Wizard', icon: '🧠', desc: '6-step content intelligence and strategy wizard' },
  { route: 'trends', title: 'Trends', icon: '📈', desc: 'Real-time trending topics and niche insights' },
  { route: 'channel-decoder', title: 'Channel Decoder', icon: '🔬', desc: '9-layer reverse engineering of top-performing channels' },
  { route: 'content-forge', title: 'Content Forge', icon: '🔨', desc: 'Transform blueprints into production-ready content' },
  { route: 'brand-brief', title: 'Brand Brief', icon: '📝', desc: 'Define brand voice, target audience, and content guidelines' },
  { route: 'agreement', title: 'Agreement', icon: '📄', desc: 'Master Service Agreement and legal documents' },
  { route: 'settings', title: 'Settings', icon: '⚙️', desc: 'Account settings and preferences' },
  { route: 'settings/billing', title: 'Billing', icon: '💳', desc: 'Subscription management and payment history' },
];

const baseDir = path.join(__dirname, 'src', 'routes', '(portal)');

pages.forEach(({ route, title, icon, desc }) => {
  const dir = path.join(baseDir, route);
  fs.mkdirSync(dir, { recursive: true });

  const content = `<script lang="ts">
</script>

<svelte:head>
  <title>${title} — PersonaGen</title>
</svelte:head>

<div class="page-container">
  <div class="page-header">
    <h1>${title}</h1>
    <p class="page-subtitle">${desc}</p>
  </div>

  <div class="page-content">
    <div class="empty-state">
      <span class="empty-icon">${icon}</span>
      <h3>${title}</h3>
      <p>${desc}</p>
    </div>
  </div>
</div>

<style>
  .page-container {
    padding: 2rem;
    max-width: 1400px;
    margin: 0 auto;
  }
  .page-header {
    margin-bottom: 2rem;
  }
  .page-header h1 {
    font-family: var(--font-display);
    font-size: 1.75rem;
    color: var(--text);
    margin: 0 0 0.5rem;
  }
  .page-subtitle {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin: 0;
  }
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 1rem;
    text-align: center;
  }
  .empty-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }
  .empty-state h3 {
    color: var(--text);
    margin: 0 0 0.5rem;
    font-family: var(--font-display);
  }
  .empty-state p {
    color: var(--text-muted);
    margin: 0;
    font-size: 0.9rem;
  }
</style>
`;

  const filePath = path.join(dir, '+page.svelte');
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
    console.log(`✅ Created ${route}/+page.svelte`);
  } else {
    console.log(`⏭️  Skipped ${route}/+page.svelte (exists)`);
  }
});

console.log(`\n✅ Done — ${pages.length} pages`);
