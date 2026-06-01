// Nav test script - paste in browser console to verify all routes
(function() {
  const results = [];
  
  function testView(label, fn) {
    try {
      fn();
      // Check what's visible
      const visibleViews = [...document.querySelectorAll('.portal-subview')].filter(v => v.style.display !== 'none' && v.classList.contains('active'));
      const title = document.getElementById('dash-view-title')?.textContent;
      const tabBar = document.getElementById('mega-tab-bar');
      const tabsVisible = tabBar?.classList.contains('visible');
      const activeTabs = tabsVisible ? [...tabBar.querySelectorAll('.mega-tab.active')].map(t => t.textContent.trim()) : [];
      const visibleSections = ['dash-sec-summary','dash-sec-scout','dash-sec-generator','dash-sec-calendar']
        .filter(id => { const el = document.getElementById(id); return el && el.style.display !== 'none'; });
      const activeMenuItem = document.querySelector('.dash-sidebar .dash-menu-item.active')?.textContent.trim();
      
      const hasContent = visibleViews.length > 0 && visibleViews.some(v => v.innerHTML.trim().length > 50);
      
      results.push({
        label,
        status: hasContent ? '✅' : '❌ EMPTY',
        title,
        visibleViews: visibleViews.map(v => v.id),
        visibleSections,
        tabsVisible,
        activeTabs,
        activeMenuItem
      });
    } catch(e) {
      results.push({ label, status: '💥 ERROR: ' + e.message });
    }
  }

  // Test all sidebar items
  testView('Sidebar: Dashboard', () => switchPortalView('dashboard'));
  testView('Sidebar: Intelligence', () => switchMegaView('intelligence'));
  testView('Sidebar: Content Studio', () => switchMegaView('content-studio'));
  testView('Sidebar: Inbox', () => switchPortalView('inbox'));
  testView('Sidebar: Agents', () => switchPortalView('persona-config'));

  // Test Intelligence tabs
  switchMegaView('intelligence');
  testView('Intel Tab: Social Scout', () => switchMegaTab('intelligence', 'scout'));
  testView('Intel Tab: Trends', () => switchMegaTab('intelligence', 'trends'));
  testView('Intel Tab: Decoder', () => switchMegaTab('intelligence', 'channel-decoder'));

  // Test Content Studio tabs
  switchMegaView('content-studio');
  testView('Studio Tab: Forge', () => switchMegaTab('content-studio', 'content-forge'));
  testView('Studio Tab: Calendar', () => switchMegaTab('content-studio', 'calendar'));
  testView('Studio Tab: Brand Brief', () => switchMegaTab('content-studio', 'brand-brief'));

  // Test profile dropdown
  testView('Profile: Accounts', () => switchPortalView('accounts'));
  testView('Profile: PM', () => switchPortalView('pm'));
  testView('Profile: Agreement', () => switchPortalView('agreement'));

  // Return to dashboard
  switchPortalView('dashboard');

  console.table(results.map(r => ({
    Route: r.label,
    Status: r.status,
    Title: r.title,
    View: r.visibleViews?.join(', '),
    Sections: r.visibleSections?.join(', '),
    Tabs: r.tabsVisible ? r.activeTabs?.join(', ') : '-',
    MenuItem: r.activeMenuItem
  })));
  
  return results;
})();
