<script lang="ts">
  import { showToast } from '$lib/stores/ui.svelte';
  import { browser } from '$app/environment';

  const STORAGE_KEY = 'personagen_intel_wizard';

  const STEPS = [
    { id: 1, label: 'Brand Discovery', icon: '🏢' },
    { id: 2, label: 'Competitor Analysis', icon: '🔍' },
    { id: 3, label: 'Content Audit', icon: '📋' },
    { id: 4, label: 'Audience Mapping', icon: '🎯' },
    { id: 5, label: 'Strategy Generation', icon: '⚡' },
    { id: 6, label: 'Results', icon: '📊' }
  ];

  const INDUSTRIES = [
    'Technology', 'Finance', 'Healthcare', 'Education', 'E-Commerce',
    'Real Estate', 'Food & Beverage', 'Fashion', 'Fitness & Wellness',
    'Entertainment', 'SaaS', 'Marketing', 'Travel', 'Automotive', 'Other'
  ];

  const PLATFORMS_LIST = [
    { id: 'youtube', label: 'YouTube' },
    { id: 'tiktok', label: 'TikTok' },
    { id: 'instagram', label: 'Instagram' },
    { id: 'x', label: 'X / Twitter' },
    { id: 'linkedin', label: 'LinkedIn' }
  ];

  const CONTENT_TYPES_LIST = [
    'Blog Posts', 'Social Posts', 'Videos', 'Podcasts', 'Newsletters',
    'Case Studies', 'Infographics', 'Webinars', 'Stories/Reels'
  ];

  const LOCATIONS = [
    'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide',
    'Gold Coast', 'Canberra', 'Hobart', 'Darwin', 'National (AU)',
    'United States', 'United Kingdom', 'Global'
  ];

  const INTEREST_SUGGESTIONS = [
    'AI & Technology', 'Entrepreneurship', 'Fitness', 'Fashion',
    'Cooking', 'Gaming', 'Travel', 'Photography', 'Music',
    'Finance', 'Sustainability', 'Self-improvement', 'Parenting'
  ];

  // ─── State ───
  let currentStep = $state(1);
  let generating = $state(false);

  // Step 1: Brand
  let companyName = $state('');
  let industry = $state('');
  let targetAudience = $state('');

  // Step 2: Competitors
  interface Competitor { url: string; platform: string; }
  let competitors = $state<Competitor[]>([{ url: '', platform: 'youtube' }]);

  // Step 3: Content Audit
  let existingContent = $state('');
  let contentTypes = $state<string[]>([]);

  // Step 4: Audience
  let ageMin = $state(18);
  let ageMax = $state(44);
  let interests = $state<string[]>([]);
  let interestInput = $state('');
  let locations = $state<string[]>(['Sydney']);

  // Step 6: Results
  interface StrategyResults {
    pillars: { name: string; description: string; priority: string }[];
    schedule: { day: string; time: string; type: string; platform: string }[];
    platformPriority: { platform: string; score: number; reason: string }[];
    targets: { metric: string; current: string; target30: string; target90: string }[];
  }
  let strategyResults = $state<StrategyResults | null>(null);

  // ─── Persistence ───
  function saveToStorage() {
    if (!browser) return;
    const data = {
      currentStep, companyName, industry, targetAudience,
      competitors, existingContent, contentTypes,
      ageMin, ageMax, interests, locations
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function loadFromStorage() {
    if (!browser) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.currentStep) currentStep = Math.min(data.currentStep, 5);
      if (data.companyName) companyName = data.companyName;
      if (data.industry) industry = data.industry;
      if (data.targetAudience) targetAudience = data.targetAudience;
      if (data.competitors) competitors = data.competitors;
      if (data.existingContent) existingContent = data.existingContent;
      if (data.contentTypes) contentTypes = data.contentTypes;
      if (data.ageMin != null) ageMin = data.ageMin;
      if (data.ageMax != null) ageMax = data.ageMax;
      if (data.interests) interests = data.interests;
      if (data.locations) locations = data.locations;
    } catch { /* ignore */ }
  }

  $effect(() => {
    loadFromStorage();
  });

  $effect(() => {
    // Auto-save whenever any field changes
    if (browser && currentStep < 6) {
      saveToStorage();
    }
  });

  // ─── Validation ───
  let step1Valid = $derived(companyName.trim().length > 0 && industry.length > 0);
  let step2Valid = $derived(competitors.some(c => c.url.trim().length > 0));
  let step3Valid = $derived(existingContent.trim().length > 0 || contentTypes.length > 0);
  let step4Valid = $derived(locations.length > 0);

  function canProceed(step: number): boolean {
    switch (step) {
      case 1: return step1Valid;
      case 2: return step2Valid;
      case 3: return step3Valid;
      case 4: return step4Valid;
      case 5: return true;
      default: return false;
    }
  }

  function nextStep() {
    if (currentStep < 6 && canProceed(currentStep)) {
      currentStep++;
      saveToStorage();
    }
  }

  function prevStep() {
    if (currentStep > 1) {
      currentStep--;
    }
  }

  function goToStep(step: number) {
    if (step <= currentStep || (step <= 5 && canProceed(step - 1))) {
      currentStep = step;
    }
  }

  // ─── Competitor management ───
  function addCompetitor() {
    if (competitors.length < 5) {
      competitors = [...competitors, { url: '', platform: 'youtube' }];
    }
  }

  function removeCompetitor(index: number) {
    if (competitors.length > 1) {
      competitors = competitors.filter((_, i) => i !== index);
    }
  }

  // ─── Content type toggle ───
  function toggleContentType(ct: string) {
    if (contentTypes.includes(ct)) {
      contentTypes = contentTypes.filter(c => c !== ct);
    } else {
      contentTypes = [...contentTypes, ct];
    }
  }

  // ─── Interest tags ───
  function addInterest(tag: string) {
    const trimmed = tag.trim();
    if (trimmed && !interests.includes(trimmed)) {
      interests = [...interests, trimmed];
      interestInput = '';
    }
  }

  function removeInterest(tag: string) {
    interests = interests.filter(i => i !== tag);
  }

  function handleInterestKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && interestInput.trim()) {
      e.preventDefault();
      addInterest(interestInput);
    }
  }

  // ─── Location toggle ───
  function toggleLocation(loc: string) {
    if (locations.includes(loc)) {
      locations = locations.filter(l => l !== loc);
    } else {
      locations = [...locations, loc];
    }
  }

  // ─── Strategy Generation ───
  function generateDemoResults(): StrategyResults {
    return {
      pillars: [
        {
          name: 'Educational Authority',
          description: `Deep-dive content establishing ${companyName || 'your brand'} as the go-to source for ${industry || 'industry'} knowledge. Focus on data-backed insights, how-to guides, and myth-busting.`,
          priority: 'Primary'
        },
        {
          name: 'Behind-the-Scenes',
          description: 'Humanize the brand with process reveals, team spotlights, and day-in-the-life content. Builds trust and relatability with your audience.',
          priority: 'Secondary'
        },
        {
          name: 'Community Stories',
          description: 'User-generated content, testimonials, and audience Q&A sessions. Drives engagement and creates social proof at scale.',
          priority: 'Secondary'
        },
        {
          name: 'Trend Commentary',
          description: `Real-time takes on ${industry || 'industry'} trends and news. Positions the brand as a thought leader and drives discovery through timely, shareable content.`,
          priority: 'Tertiary'
        }
      ],
      schedule: [
        { day: 'Monday', time: '8:00 AM', type: 'Educational Post', platform: 'Instagram' },
        { day: 'Tuesday', time: '12:00 PM', type: 'Short-form Video', platform: 'TikTok' },
        { day: 'Wednesday', time: '9:00 AM', type: 'Thread / Carousel', platform: 'X / Twitter' },
        { day: 'Thursday', time: '7:00 AM', type: 'BTS Content', platform: 'Instagram' },
        { day: 'Friday', time: '11:00 AM', type: 'Long-form Video', platform: 'YouTube' },
        { day: 'Saturday', time: '10:00 AM', type: 'Community Q&A', platform: 'Instagram' },
        { day: 'Sunday', time: '6:00 PM', type: 'Week Preview', platform: 'X / Twitter' }
      ],
      platformPriority: [
        { platform: 'Instagram', score: 92, reason: `Best fit for ${targetAudience || 'your target audience'}. High engagement potential in ${industry || 'your niche'} with Reels + Carousel format.` },
        { platform: 'TikTok', score: 87, reason: 'Highest organic reach potential. Ideal for short-form educational and trend content targeting 18-34 demo.' },
        { platform: 'YouTube', score: 81, reason: 'Long-form authority building. SEO benefits drive passive discovery. Best for evergreen educational content.' },
        { platform: 'X / Twitter', score: 74, reason: 'Real-time engagement and thought leadership. Thread format works well for breaking down complex topics.' },
        { platform: 'LinkedIn', score: 68, reason: 'Professional credibility builder. Effective for B2B reach and industry networking.' }
      ],
      targets: [
        { metric: 'Total Followers', current: '2,400', target30: '3,800', target90: '12,500' },
        { metric: 'Engagement Rate', current: '2.1%', target30: '4.5%', target90: '6.8%' },
        { metric: 'Weekly Posts', current: '3', target30: '5', target90: '7' },
        { metric: 'Avg. Reach / Post', current: '450', target30: '1,200', target90: '4,800' },
        { metric: 'Content Saves', current: '12/wk', target30: '45/wk', target90: '180/wk' },
        { metric: 'Brand Mentions', current: '5/mo', target30: '20/mo', target90: '80/mo' }
      ]
    };
  }

  async function generateStrategy() {
    generating = true;
    await new Promise(r => setTimeout(r, 2500 + Math.random() * 1500));
    strategyResults = generateDemoResults();
    generating = false;
    currentStep = 6;
    if (browser) localStorage.removeItem(STORAGE_KEY);
  }

  function startOver() {
    currentStep = 1;
    companyName = '';
    industry = '';
    targetAudience = '';
    competitors = [{ url: '', platform: 'youtube' }];
    existingContent = '';
    contentTypes = [];
    ageMin = 18;
    ageMax = 44;
    interests = [];
    interestInput = '';
    locations = ['Sydney'];
    strategyResults = null;
    if (browser) localStorage.removeItem(STORAGE_KEY);
  }

  function getScoreColor(score: number): string {
    if (score >= 85) return 'var(--success)';
    if (score >= 70) return 'var(--cyan)';
    if (score >= 55) return 'var(--gold)';
    return 'var(--rose)';
  }
</script>

<svelte:head>
  <title>Intel Wizard — PersonaGen</title>
</svelte:head>

<section class="page">
  <header class="page-header">
    <div class="title-row">
      <div class="title-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="url(#intelGrad)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <defs><linearGradient id="intelGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="var(--cyan)"/><stop offset="100%" stop-color="var(--accent)"/></linearGradient></defs>
          <path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 2a7 7 0 0 1 7 7"/><circle cx="12" cy="12" r="1"/><path d="M12 8v3"/>
        </svg>
      </div>
      <div>
        <h1>Intel Wizard</h1>
        <p class="subtitle">6-step content intelligence and strategy wizard</p>
      </div>
    </div>
  </header>

  <!-- ─── Step Progress Bar ─── -->
  <div class="progress-steps">
    {#each STEPS as s, i}
      <button
        class="step-dot-group"
        class:active={currentStep === s.id}
        class:completed={currentStep > s.id}
        class:disabled={s.id > currentStep + 1}
        onclick={() => goToStep(s.id)}
        disabled={s.id > currentStep + 1}
      >
        <div class="step-dot">
          {#if currentStep > s.id}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          {:else}
            <span>{s.id}</span>
          {/if}
        </div>
        <span class="step-label">{s.label}</span>
      </button>
      {#if i < STEPS.length - 1}
        <div class="step-line" class:filled={currentStep > s.id}></div>
      {/if}
    {/each}
  </div>

  <!-- ─── Step Content ─── -->
  <div class="step-container">

    <!-- STEP 1: Brand Discovery -->
    {#if currentStep === 1}
      <div class="step-card" style="animation: fadeUp 0.4s var(--ease-out)">
        <div class="step-card-header">
          <span class="step-icon">🏢</span>
          <div>
            <h2>Brand Discovery</h2>
            <p>Tell us about your brand and target market</p>
          </div>
        </div>

        <div class="form-fields">
          <div class="field">
            <label for="company-name">Company / Brand Name <span class="req">*</span></label>
            <input id="company-name" type="text" bind:value={companyName} placeholder="e.g. PersonaGen" />
          </div>

          <div class="field">
            <label for="industry-select">Industry <span class="req">*</span></label>
            <select id="industry-select" bind:value={industry}>
              <option value="">Select industry...</option>
              {#each INDUSTRIES as ind}
                <option value={ind}>{ind}</option>
              {/each}
            </select>
          </div>

          <div class="field">
            <label for="target-audience">Target Audience</label>
            <textarea id="target-audience" bind:value={targetAudience} placeholder="Describe your ideal customer / audience. E.g. 'Small business owners aged 25-45 in Australia looking to grow their social media presence'" rows="4"></textarea>
          </div>
        </div>
      </div>

    <!-- STEP 2: Competitor Analysis -->
    {:else if currentStep === 2}
      <div class="step-card" style="animation: fadeUp 0.4s var(--ease-out)">
        <div class="step-card-header">
          <span class="step-icon">🔍</span>
          <div>
            <h2>Competitor Analysis</h2>
            <p>Add up to 5 competitor channels to analyze</p>
          </div>
        </div>

        <div class="competitors-list">
          {#each competitors as comp, i}
            <div class="competitor-row">
              <span class="comp-num">{i + 1}</span>
              <input
                type="url"
                bind:value={comp.url}
                placeholder="https://youtube.com/@competitor"
                class="comp-url"
              />
              <select bind:value={comp.platform} class="comp-platform">
                {#each PLATFORMS_LIST as p}
                  <option value={p.id}>{p.label}</option>
                {/each}
              </select>
              <button
                class="comp-remove"
                onclick={() => removeCompetitor(i)}
                disabled={competitors.length <= 1}
                title="Remove"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          {/each}
        </div>

        {#if competitors.length < 5}
          <button class="add-comp-btn" onclick={addCompetitor}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Competitor ({competitors.length}/5)
          </button>
        {/if}
      </div>

    <!-- STEP 3: Content Audit -->
    {:else if currentStep === 3}
      <div class="step-card" style="animation: fadeUp 0.4s var(--ease-out)">
        <div class="step-card-header">
          <span class="step-icon">📋</span>
          <div>
            <h2>Content Audit</h2>
            <p>Share your existing content for analysis</p>
          </div>
        </div>

        <div class="form-fields">
          <div class="field">
            <label for="existing-content">Existing Content (paste URLs or descriptions)</label>
            <textarea id="existing-content" bind:value={existingContent} placeholder="Paste links to your existing content, or describe what you've been posting. E.g.&#10;&#10;- Instagram: @mybrand (3 posts/week, mostly product photos)&#10;- Blog: mybrand.com/blog (monthly articles)&#10;- YouTube: 2 videos total" rows="6"></textarea>
          </div>

          <div class="field">
            <label>Content Types You Currently Produce</label>
            <div class="content-type-grid">
              {#each CONTENT_TYPES_LIST as ct}
                <button
                  class="ct-btn"
                  class:active={contentTypes.includes(ct)}
                  onclick={() => toggleContentType(ct)}
                >
                  {ct}
                </button>
              {/each}
            </div>
          </div>
        </div>
      </div>

    <!-- STEP 4: Audience Mapping -->
    {:else if currentStep === 4}
      <div class="step-card" style="animation: fadeUp 0.4s var(--ease-out)">
        <div class="step-card-header">
          <span class="step-icon">🎯</span>
          <div>
            <h2>Audience Mapping</h2>
            <p>Define your ideal audience demographics and interests</p>
          </div>
        </div>

        <div class="form-fields">
          <div class="field">
            <label>Age Range: {ageMin} — {ageMax}</label>
            <div class="range-group">
              <div class="range-row">
                <span class="range-label">Min</span>
                <input type="range" min="13" max="65" bind:value={ageMin} class="slider" oninput={() => { if (ageMin > ageMax) ageMax = ageMin; }} />
                <span class="range-val">{ageMin}</span>
              </div>
              <div class="range-row">
                <span class="range-label">Max</span>
                <input type="range" min="13" max="65" bind:value={ageMax} class="slider" oninput={() => { if (ageMax < ageMin) ageMin = ageMax; }} />
                <span class="range-val">{ageMax}</span>
              </div>
            </div>
          </div>

          <div class="field">
            <label for="interest-input">Interest Tags</label>
            <div class="tags-input-wrapper">
              <div class="tags-display">
                {#each interests as tag}
                  <span class="tag">
                    {tag}
                    <button class="tag-remove" onclick={() => removeInterest(tag)}>×</button>
                  </span>
                {/each}
                <input
                  id="interest-input"
                  type="text"
                  bind:value={interestInput}
                  placeholder={interests.length > 0 ? 'Add more...' : 'Type and press Enter'}
                  onkeydown={handleInterestKeydown}
                  class="tag-input"
                />
              </div>
            </div>
            <div class="suggestions">
              {#each INTEREST_SUGGESTIONS.filter(s => !interests.includes(s)) as sug}
                <button class="sug-btn" onclick={() => addInterest(sug)}>{sug}</button>
              {/each}
            </div>
          </div>

          <div class="field">
            <label>Locations <span class="req">*</span></label>
            <div class="location-grid">
              {#each LOCATIONS as loc}
                <button
                  class="loc-btn"
                  class:active={locations.includes(loc)}
                  onclick={() => toggleLocation(loc)}
                >
                  {loc}
                </button>
              {/each}
            </div>
          </div>
        </div>
      </div>

    <!-- STEP 5: Strategy Generation -->
    {:else if currentStep === 5}
      <div class="step-card" style="animation: fadeUp 0.4s var(--ease-out)">
        <div class="step-card-header">
          <span class="step-icon">⚡</span>
          <div>
            <h2>Strategy Generation</h2>
            <p>Review your inputs and generate a custom strategy</p>
          </div>
        </div>

        <div class="review-grid">
          <div class="review-item">
            <h4>Brand</h4>
            <p><strong>{companyName || '—'}</strong> • {industry || '—'}</p>
            {#if targetAudience}
              <p class="review-sub">{targetAudience}</p>
            {/if}
          </div>

          <div class="review-item">
            <h4>Competitors</h4>
            {#each competitors.filter(c => c.url.trim()) as comp}
              <p class="review-url">{comp.url} <span class="review-plat">{PLATFORMS_LIST.find(p => p.id === comp.platform)?.label}</span></p>
            {/each}
            {#if !competitors.some(c => c.url.trim())}
              <p class="review-sub">None added</p>
            {/if}
          </div>

          <div class="review-item">
            <h4>Content Types</h4>
            <div class="review-tags">
              {#each contentTypes as ct}
                <span class="review-tag">{ct}</span>
              {/each}
              {#if contentTypes.length === 0}
                <span class="review-sub">None selected</span>
              {/if}
            </div>
          </div>

          <div class="review-item">
            <h4>Audience</h4>
            <p>Ages {ageMin}–{ageMax} • {locations.join(', ') || '—'}</p>
            {#if interests.length > 0}
              <div class="review-tags">
                {#each interests as int}
                  <span class="review-tag accent">{int}</span>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <button class="generate-btn" onclick={generateStrategy} disabled={generating}>
          {#if generating}
            <div class="gen-spinner"></div>
            Generating Strategy...
          {:else}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            Generate Strategy
          {/if}
        </button>

        {#if generating}
          <div class="gen-progress" style="animation: fadeUp 0.3s var(--ease-out)">
            <div class="gen-bar"><div class="gen-fill"></div></div>
            <p>Analyzing competitors, mapping audience, building strategy...</p>
          </div>
        {/if}
      </div>

    <!-- STEP 6: Results -->
    {:else if currentStep === 6 && strategyResults}
      <div class="results-container" style="animation: fadeUp 0.4s var(--ease-out)">
        <div class="results-header-card">
          <div class="results-title">
            <h2>Strategy Report</h2>
            <p>{companyName} • {industry}</p>
          </div>
          <button class="start-over-btn" onclick={startOver}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            Start Over
          </button>
        </div>

        <!-- Content Pillars -->
        <div class="result-section">
          <h3 class="section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            Content Pillars
          </h3>
          <div class="pillars-grid">
            {#each strategyResults.pillars as pillar, i}
              <div class="pillar-card" style="animation-delay: {i * 0.08}s">
                <div class="pillar-header">
                  <h4>{pillar.name}</h4>
                  <span class="priority-tag" class:primary={pillar.priority === 'Primary'} class:secondary={pillar.priority === 'Secondary'}>{pillar.priority}</span>
                </div>
                <p>{pillar.description}</p>
              </div>
            {/each}
          </div>
        </div>

        <!-- Posting Schedule -->
        <div class="result-section">
          <h3 class="section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Posting Schedule
          </h3>
          <div class="schedule-table">
            <div class="table-header">
              <span>Day</span><span>Time</span><span>Content Type</span><span>Platform</span>
            </div>
            {#each strategyResults.schedule as row}
              <div class="table-row">
                <span class="day-cell">{row.day}</span>
                <span class="time-cell">{row.time}</span>
                <span>{row.type}</span>
                <span class="plat-cell">{row.platform}</span>
              </div>
            {/each}
          </div>
        </div>

        <!-- Platform Priority -->
        <div class="result-section">
          <h3 class="section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Platform Priority
          </h3>
          <div class="platform-cards">
            {#each strategyResults.platformPriority as plat, i}
              <div class="plat-card" style="animation-delay: {i * 0.06}s">
                <div class="plat-card-header">
                  <span class="plat-name">{plat.platform}</span>
                  <div class="plat-score-bar">
                    <div class="plat-score-fill" style="width: {plat.score}%; background: {getScoreColor(plat.score)}"></div>
                  </div>
                  <span class="plat-score-num" style="color: {getScoreColor(plat.score)}">{plat.score}</span>
                </div>
                <p class="plat-reason">{plat.reason}</p>
              </div>
            {/each}
          </div>
        </div>

        <!-- Growth Targets -->
        <div class="result-section">
          <h3 class="section-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>
            Growth Targets
          </h3>
          <div class="targets-table">
            <div class="table-header targets-header">
              <span>Metric</span><span>Current</span><span>30 Days</span><span>90 Days</span>
            </div>
            {#each strategyResults.targets as target}
              <div class="table-row targets-row">
                <span class="metric-cell">{target.metric}</span>
                <span class="current-cell">{target.current}</span>
                <span class="t30-cell">{target.target30}</span>
                <span class="t90-cell">{target.target90}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- ─── Navigation Buttons ─── -->
  {#if currentStep < 6}
    <div class="nav-buttons">
      <button class="nav-btn back" onclick={prevStep} disabled={currentStep === 1}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        Back
      </button>
      {#if currentStep < 5}
        <button class="nav-btn next" onclick={nextStep} disabled={!canProceed(currentStep)}>
          Next
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .page {
    padding: 2rem;
    max-width: 900px;
    margin: 0 auto;
  }

  .page-header { margin-bottom: 2rem; }

  .title-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .title-icon {
    width: 48px; height: 48px;
    display: flex; align-items: center; justify-content: center;
    background: var(--cyan-soft);
    border: 1px solid var(--cyan-mid);
    border-radius: var(--radius-sm);
  }

  .title-row h1 {
    font-family: var(--font-display);
    font-size: 1.75rem;
    color: var(--text);
    margin: 0;
  }

  .subtitle {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin: 0.25rem 0 0;
  }

  /* ─── Progress Steps ─── */
  .progress-steps {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    margin-bottom: 2.5rem;
    padding: 1.5rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow-x: auto;
  }

  .step-dot-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.5rem;
    min-width: 80px;
    transition: opacity 0.2s ease;
  }

  .step-dot-group.disabled {
    cursor: not-allowed;
    opacity: 0.35;
  }

  .step-dot {
    width: 36px; height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--text-dim);
    background: var(--surface-2);
    border: 2px solid var(--border-strong);
    transition: all 0.3s ease;
  }

  .step-dot-group.active .step-dot {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
    box-shadow: 0 0 20px rgba(124,106,237,0.2);
  }

  .step-dot-group.completed .step-dot {
    background: var(--success-soft);
    border-color: var(--success);
    color: var(--success);
  }

  .step-label {
    font-size: 0.68rem;
    font-weight: 600;
    color: var(--text-dim);
    text-align: center;
    white-space: nowrap;
  }

  .step-dot-group.active .step-label {
    color: var(--accent);
  }

  .step-dot-group.completed .step-label {
    color: var(--success);
  }

  .step-line {
    width: 40px;
    height: 2px;
    background: var(--border-strong);
    flex-shrink: 0;
    margin-bottom: 1.5rem;
    transition: background 0.3s ease;
  }

  .step-line.filled {
    background: var(--success);
  }

  /* ─── Step Card ─── */
  .step-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 2rem;
  }

  .step-card-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .step-icon {
    font-size: 2rem;
  }

  .step-card-header h2 {
    font-family: var(--font-display);
    font-size: 1.3rem;
    color: var(--text);
    margin: 0;
  }

  .step-card-header p {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin: 0.2rem 0 0;
  }

  .form-fields {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .field label {
    margin-bottom: 0.5rem;
  }

  .req { color: var(--rose); }

  /* ─── Competitors ─── */
  .competitors-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .competitor-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .comp-num {
    width: 24px; height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-soft);
    border-radius: var(--radius-full);
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--accent);
    flex-shrink: 0;
  }

  .comp-url {
    flex: 1;
  }

  .comp-platform {
    width: 140px;
    flex-shrink: 0;
  }

  .comp-remove {
    width: 32px; height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    color: var(--text-dim);
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.2s ease;
  }

  .comp-remove:hover:not(:disabled) {
    border-color: var(--error);
    color: var(--error);
    background: var(--error-soft);
  }

  .comp-remove:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .add-comp-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.65rem;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-dim);
    font-size: 0.82rem;
    cursor: pointer;
    transition: all 0.2s ease;
    width: 100%;
  }

  .add-comp-btn:hover {
    border-color: var(--accent-mid);
    color: var(--accent);
  }

  /* ─── Content Types ─── */
  .content-type-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .ct-btn {
    padding: 0.5rem 1rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    color: var(--text-muted);
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .ct-btn:hover {
    border-color: var(--border-hover);
    color: var(--text);
  }

  .ct-btn.active {
    border-color: var(--accent-mid);
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* ─── Range Sliders ─── */
  .range-group {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .range-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .range-label {
    font-size: 0.75rem;
    color: var(--text-dim);
    width: 30px;
    flex-shrink: 0;
  }

  .slider {
    flex: 1;
    -webkit-appearance: none;
    appearance: none;
    height: 6px;
    background: var(--surface-3);
    border-radius: var(--radius-full);
    outline: none;
    border: none;
    padding: 0;
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px; height: 20px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: 2px solid var(--bg);
    box-shadow: 0 0 10px rgba(124,106,237,0.3);
  }

  .slider::-moz-range-thumb {
    width: 20px; height: 20px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: 2px solid var(--bg);
  }

  .range-val {
    font-family: var(--font-mono);
    font-size: 0.82rem;
    color: var(--text);
    width: 30px;
    text-align: right;
    flex-shrink: 0;
  }

  /* ─── Tags Input ─── */
  .tags-input-wrapper {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .tags-display {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }

  .tag {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.6rem;
    background: var(--accent-soft);
    border: 1px solid var(--accent-mid);
    border-radius: var(--radius-full);
    font-size: 0.75rem;
    color: var(--accent);
  }

  .tag-remove {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 1rem;
    padding: 0;
    line-height: 1;
    transition: color 0.2s ease;
  }

  .tag-remove:hover { color: var(--error); }

  .tag-input {
    border: none !important;
    background: transparent !important;
    padding: 0.3rem 0.5rem !important;
    font-size: 0.85rem;
    flex: 1;
    min-width: 120px;
    outline: none;
    box-shadow: none !important;
  }

  .suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .sug-btn {
    padding: 0.25rem 0.6rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    color: var(--text-dim);
    font-size: 0.7rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .sug-btn:hover {
    border-color: var(--accent-mid);
    color: var(--accent);
  }

  /* ─── Locations ─── */
  .location-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .loc-btn {
    padding: 0.5rem 1rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    color: var(--text-muted);
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .loc-btn:hover {
    border-color: var(--border-hover);
    color: var(--text);
  }

  .loc-btn.active {
    border-color: var(--cyan-mid);
    background: var(--cyan-soft);
    color: var(--cyan);
  }

  /* ─── Step 5: Review ─── */
  .review-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
    margin-bottom: 2rem;
  }

  .review-item {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 1.25rem;
  }

  .review-item h4 {
    font-family: var(--font-display);
    font-size: 0.85rem;
    color: var(--text);
    margin: 0 0 0.5rem;
  }

  .review-item p {
    font-size: 0.82rem;
    color: var(--text-muted);
    margin: 0 0 0.25rem;
    line-height: 1.5;
  }

  .review-item p strong {
    color: var(--text);
  }

  .review-sub {
    font-size: 0.78rem;
    color: var(--text-dim);
  }

  .review-url {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    word-break: break-all;
  }

  .review-plat {
    color: var(--accent);
    font-weight: 600;
    margin-left: 0.5rem;
    font-family: var(--font-body);
  }

  .review-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .review-tag {
    padding: 0.2rem 0.6rem;
    background: var(--surface-3);
    border-radius: var(--radius-full);
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .review-tag.accent {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .generate-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 1rem;
    background: var(--gradient);
    border: none;
    border-radius: var(--radius-sm);
    color: #fff;
    font-weight: 600;
    font-size: 1rem;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.3s ease;
  }

  .generate-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(124,106,237,0.3);
  }

  .generate-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .gen-spinner {
    width: 18px; height: 18px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .gen-progress {
    text-align: center;
    margin-top: 1.5rem;
  }

  .gen-bar {
    width: 100%;
    height: 4px;
    background: var(--surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
    margin-bottom: 0.75rem;
  }

  .gen-fill {
    height: 100%;
    width: 40%;
    background: var(--gradient);
    border-radius: var(--radius-full);
    animation: genSlide 1.8s ease-in-out infinite;
  }

  @keyframes genSlide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }

  .gen-progress p {
    color: var(--text-dim);
    font-size: 0.82rem;
  }

  /* ─── Step 6: Results ─── */
  .results-header-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem 2rem;
    margin-bottom: 1.5rem;
  }

  .results-title h2 {
    font-family: var(--font-display);
    font-size: 1.4rem;
    color: var(--text);
    margin: 0;
  }

  .results-title p {
    color: var(--text-muted);
    font-size: 0.85rem;
    margin: 0.2rem 0 0;
  }

  .start-over-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1.2rem;
    background: transparent;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .start-over-btn:hover {
    border-color: var(--accent-mid);
    color: var(--accent);
  }

  .result-section {
    margin-bottom: 1.5rem;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-family: var(--font-display);
    font-size: 1.1rem;
    color: var(--text);
    margin: 0 0 1rem;
  }

  .pillars-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .pillar-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem;
    transition: border-color 0.2s ease;
    animation: fadeUp 0.4s var(--ease-out) both;
  }

  .pillar-card:hover {
    border-color: var(--border-hover);
  }

  .pillar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .pillar-header h4 {
    font-family: var(--font-display);
    font-size: 0.95rem;
    color: var(--text);
    margin: 0;
  }

  .priority-tag {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.2rem 0.6rem;
    border-radius: var(--radius-full);
    background: var(--surface-3);
    color: var(--text-dim);
  }

  .priority-tag.primary {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .priority-tag.secondary {
    background: var(--cyan-soft);
    color: var(--cyan);
  }

  .pillar-card p {
    font-size: 0.82rem;
    color: var(--text-muted);
    line-height: 1.6;
    margin: 0;
  }

  /* ─── Schedule Table ─── */
  .schedule-table, .targets-table {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .table-header {
    display: grid;
    grid-template-columns: 1fr 1fr 1.5fr 1fr;
    padding: 0.75rem 1.25rem;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-dim);
  }

  .targets-header {
    grid-template-columns: 1.5fr 1fr 1fr 1fr;
  }

  .table-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1.5fr 1fr;
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.82rem;
    color: var(--text-muted);
    transition: background 0.15s ease;
  }

  .table-row:hover {
    background: var(--surface-2);
  }

  .table-row:last-child {
    border-bottom: none;
  }

  .targets-row {
    grid-template-columns: 1.5fr 1fr 1fr 1fr;
  }

  .day-cell { color: var(--text); font-weight: 600; }
  .time-cell { font-family: var(--font-mono); font-size: 0.78rem; }
  .plat-cell { color: var(--accent); font-weight: 500; }
  .metric-cell { color: var(--text); font-weight: 500; }
  .current-cell { color: var(--text-dim); }
  .t30-cell { color: var(--gold); font-weight: 600; }
  .t90-cell { color: var(--success); font-weight: 600; }

  /* ─── Platform Cards ─── */
  .platform-cards {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .plat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 1rem 1.25rem;
    transition: border-color 0.2s ease;
    animation: fadeUp 0.4s var(--ease-out) both;
  }

  .plat-card:hover {
    border-color: var(--border-hover);
  }

  .plat-card-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }

  .plat-name {
    font-weight: 600;
    font-size: 0.88rem;
    color: var(--text);
    min-width: 100px;
  }

  .plat-score-bar {
    flex: 1;
    height: 6px;
    background: var(--surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .plat-score-fill {
    height: 100%;
    border-radius: var(--radius-full);
    transition: width 0.5s var(--ease-out);
  }

  .plat-score-num {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    font-weight: 700;
    min-width: 30px;
    text-align: right;
  }

  .plat-reason {
    font-size: 0.8rem;
    color: var(--text-dim);
    line-height: 1.5;
    margin: 0;
  }

  /* ─── Navigation ─── */
  .nav-buttons {
    display: flex;
    justify-content: space-between;
    margin-top: 2rem;
  }

  .nav-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border-radius: var(--radius-sm);
    font-weight: 600;
    font-size: 0.88rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .nav-btn.back {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--text-muted);
  }

  .nav-btn.back:hover:not(:disabled) {
    border-color: var(--border-hover);
    color: var(--text);
  }

  .nav-btn.next {
    background: var(--gradient);
    border: none;
    color: #fff;
    margin-left: auto;
  }

  .nav-btn.next:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: var(--shadow-accent);
  }

  .nav-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  /* ─── Responsive ─── */
  @media (max-width: 768px) {
    .page { padding: 1rem; }

    .progress-steps {
      padding: 1rem;
      gap: 0;
      justify-content: flex-start;
    }

    .step-dot-group { min-width: 60px; }
    .step-label { font-size: 0.6rem; }
    .step-line { width: 20px; }

    .step-card { padding: 1.5rem; }

    .competitor-row {
      flex-wrap: wrap;
    }

    .comp-url { flex: 1 1 100%; order: 2; }
    .comp-platform { width: 100%; order: 3; }
    .comp-num { order: 1; }
    .comp-remove { order: 1; }

    .review-grid { grid-template-columns: 1fr; }
    .pillars-grid { grid-template-columns: 1fr; }

    .table-header, .table-row {
      grid-template-columns: 1fr 1fr;
      gap: 0.25rem;
    }

    .targets-header, .targets-row {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
