// ═══════════════════════════════════════════════════════════════
// PersonaGen Channel Decoder — 9-Layer Reverse-Engineering Engine
// Decodes any YouTube/TikTok/Instagram channel into a reusable
// content blueprint across positioning, topics, outliers, titles,
// thumbnails, hooks, scripts, tone, and content gaps.
// ═══════════════════════════════════════════════════════════════

const ChannelDecoder = (() => {
  let container;
  let isLoading = false;
  let currentBlueprint = null;
  let savedBlueprints = [];

  const STORAGE_KEY = 'personagen_blueprints';
  const DECODE_URL = 'https://auto.l2gseo.com/webhook/personagen-channel-decode';

  const PLATFORMS = {
    youtube:   { icon: '📺', label: 'YouTube',   color: '#ff0000' },
    tiktok:    { icon: '♪',  label: 'TikTok',    color: '#000000' },
    instagram: { icon: '📷', label: 'Instagram', color: '#e1306c' },
  };

  const LAYER_META = [
    { key: 'positioning',    num: 1, icon: '🎯', title: 'Channel Positioning',  tag: 'tag-teal' },
    { key: 'topicDNA',       num: 2, icon: '🧬', title: 'Topic DNA',            tag: 'tag-pink' },
    { key: 'outliers',       num: 3, icon: '📈', title: 'Outlier Videos',        tag: 'tag-green' },
    { key: 'titleFormulas',  num: 4, icon: '✍️', title: 'Title Formulas',        tag: 'tag-teal' },
    { key: 'thumbnailDNA',   num: 5, icon: '🖼️', title: 'Thumbnail DNA',        tag: 'tag-pink' },
    { key: 'hookStructure',  num: 6, icon: '🪝', title: 'Hook Structure',        tag: 'tag-green' },
    { key: 'scriptArch',     num: 7, icon: '📝', title: 'Script Architecture',   tag: 'tag-teal' },
    { key: 'tonePacing',     num: 8, icon: '🎙️', title: 'Tone & Pacing',        tag: 'tag-pink' },
    { key: 'contentGaps',    num: 9, icon: '🕳️', title: 'Content Gaps',         tag: 'tag-green' },
  ];

  // ── Demo Blueprint: AI Explained ──
  const DEMO_BLUEPRINT = {
    id: 'demo_ai_explained_' + Date.now(),
    channelName: 'AI Explained',
    platform: 'youtube',
    url: 'https://youtube.com/@aiexplained-official',
    decodedAt: new Date().toISOString(),
    scorecard: {
      positioning: 9, topicDNA: 8, outliers: 9, titleFormulas: 8,
      thumbnailDNA: 7, hookStructure: 9, scriptArch: 9, tonePacing: 8, contentGaps: 7,
      overall: 82,
    },
    layers: {
      positioning: {
        audience: 'Tech-savvy professionals, AI researchers, curious generalists aged 25-45',
        promise: 'Making frontier AI research accessible without dumbing it down',
        emotionalSell: 'Feel smarter and ahead of the curve on AI breakthroughs',
        niche: 'AI & Machine Learning Explainers',
        differentiator: 'Deep technical rigor with calm, unhurried delivery — no hype',
        subscriberProfile: 'Engineers, product managers, grad students, and AI-curious founders',
      },
      topicDNA: {
        clusters: [
          { name: 'Foundation Models', weight: 35, examples: ['GPT-5 predictions', 'Claude architecture', 'Gemini benchmarks'] },
          { name: 'AI Safety & Alignment', weight: 25, examples: ['Alignment tax', 'Interpretability breakthroughs', 'Governance frameworks'] },
          { name: 'Benchmark Deep-Dives', weight: 20, examples: ['MMLU analysis', 'HumanEval breakdowns', 'ARC-AGI progress'] },
          { name: 'Industry Impact', weight: 20, examples: ['AI in medicine', 'Coding assistants', 'Autonomous agents'] },
        ],
        evergreen: ['What is an LLM?', 'Transformer architecture explained', 'AI safety fundamentals'],
        trendDriven: ['GPT-5 leaks analysis', 'New Anthropic paper breakdown', 'OpenAI board drama implications'],
      },
      outliers: [
        { title: 'GPT-5 Is Coming — Here\'s What We Know', views: '2.8M', outlierScore: 14.2, why: 'Speculation on unreleased model + first-mover on leaks' },
        { title: 'The AI That Beat Every Benchmark', views: '1.9M', outlierScore: 11.8, why: 'Superlative framing + comprehensive benchmark comparison' },
        { title: 'Why AI Alignment Matters More Than You Think', views: '1.4M', outlierScore: 9.6, why: 'Emotional stakes + contrarian take on popular dismissal' },
        { title: 'I Tested 10 AI Coding Tools — The Results Shocked Me', views: '1.1M', outlierScore: 7.3, why: 'Comparison format + personal testing + curiosity gap' },
        { title: 'The Paper That Changed Everything About AI Safety', views: '890K', outlierScore: 6.1, why: 'Historical weight framing + niche expertise credibility' },
      ],
      titleFormulas: [
        { name: 'Speculation Hook', template: '[Subject] Is Coming — Here\'s What We Know', example: 'GPT-5 Is Coming — Here\'s What We Know' },
        { name: 'Superlative Claim', template: 'The [Subject] That [Extreme Result]', example: 'The AI That Beat Every Benchmark' },
        { name: 'Contrarian Reframe', template: 'Why [Topic] Matters More Than You Think', example: 'Why AI Alignment Matters More Than You Think' },
        { name: 'Test & Reveal', template: 'I Tested [N] [Things] — [Reaction]', example: 'I Tested 10 AI Coding Tools — The Results Shocked Me' },
        { name: 'Historical Weight', template: 'The [Thing] That Changed Everything About [Field]', example: 'The Paper That Changed Everything About AI Safety' },
      ],
      thumbnailDNA: {
        focalPoint: 'Centered text overlay with subtle AI-themed gradient background',
        dominantColors: ['#1a1a2e', '#6366f1', '#e2e8f0', '#f43f5e'],
        textLength: '4-7 words, bold sans-serif, high contrast',
        facePresence: 'No face — abstract/diagram style thumbnails',
        style: 'Minimalist dark backgrounds with glowing accent elements, resembling a research paper aesthetic',
        patterns: ['Gradient mesh backgrounds', 'Circuit-board motifs', 'Model architecture diagrams simplified'],
      },
      hookStructure: {
        openingStyle: 'Cold open with a bold claim or surprising data point within first 5 seconds',
        stakes: 'Immediately frames why this matters to the viewer\'s career or understanding',
        curiosityLoop: 'Teases a "but there\'s a catch" or "what nobody\'s talking about" reversal at ~15s mark',
        avgHookLength: '12-18 seconds',
        examples: [
          'GPT-5 might already exist. Here\'s the evidence, and why it changes everything.',
          'This single paper might be the most important thing published in AI this year. Let me explain why.',
          'Everyone\'s celebrating this benchmark result. But there\'s a problem nobody\'s talking about.',
        ],
      },
      scriptArch: [
        { section: 'Cold Open / Hook', timestamp: '0:00 – 0:15', purpose: 'Bold claim, data point, or question to arrest attention' },
        { section: 'Context Setup', timestamp: '0:15 – 2:00', purpose: 'Background context — what happened, who\'s involved' },
        { section: 'Deep Dive #1', timestamp: '2:00 – 6:00', purpose: 'Technical explanation of the core concept or paper' },
        { section: 'Visual Breakdown', timestamp: '6:00 – 8:00', purpose: 'Diagrams, charts, benchmark comparisons' },
        { section: 'Deep Dive #2', timestamp: '8:00 – 12:00', purpose: 'Implications, edge cases, competing perspectives' },
        { section: 'Nuanced Take', timestamp: '12:00 – 14:00', purpose: 'Host\'s personal analysis — neither hype nor doom' },
        { section: 'Future Outlook', timestamp: '14:00 – 15:30', purpose: 'What to watch for, predictions, open questions' },
        { section: 'CTA + Close', timestamp: '15:30 – 16:00', purpose: 'Subscribe prompt, related video, community mention' },
      ],
      tonePacing: {
        toneLabel: 'Measured Academic',
        energy: 'Calm, deliberate — 6/10 energy level. Never shouts or rushes.',
        vocabulary: 'Technical but accessible. Uses precise ML terminology with brief inline definitions.',
        humor: 'Dry, understated wit. Occasional self-deprecating aside. Never slapstick.',
        authority: 'Earned through depth of analysis, not credentials-dropping. Cites sources consistently.',
        pacing: 'Slower than average YouTube — ~140 wpm. Strategic pauses for emphasis.',
        personality: 'The thoughtful friend who actually reads the papers and distills them for you.',
      },
      contentGaps: {
        missingTopics: [
          'Open-source model ecosystem deep-dives (Llama, Mistral, Qwen)',
          'Practical tutorials: how to fine-tune, deploy, or evaluate models',
          'Non-English AI landscape (Chinese AI labs, EU regulation impact)',
          'AI hardware & infrastructure (GPU economics, inference optimization)',
        ],
        outdatedContent: [
          'Early GPT-4 coverage — needs updated benchmarks post-turbo/omni',
          'AI regulation video predates EU AI Act final text',
        ],
        formatGaps: [
          'No short-form content (Shorts/TikTok) — massive reach opportunity',
          'No podcast/interview format — could bring in researchers as guests',
          'No community-driven Q&A episodes',
        ],
      },
    },
  };

  // ── CSS Injection ──
  function injectStyles() {
    if (document.getElementById('cd-styles')) return;
    const style = document.createElement('style');
    style.id = 'cd-styles';
    style.textContent = `
      /* ═══ Channel Decoder ═══ */
      .cd-wrapper { display:flex; gap:1.25rem; min-height:600px; }
      .cd-main { flex:1; display:flex; flex-direction:column; gap:1rem; min-width:0; }
      .cd-sidebar { width:280px; flex-shrink:0; display:flex; flex-direction:column; gap:0.75rem; }

      /* Header */
      .cd-header { display:flex; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; gap:1rem; }
      .cd-header-left {}
      .cd-title { font-size:var(--text-xl); font-weight:700; display:flex; align-items:center; gap:0.5rem; }
      .cd-subtitle { font-size:var(--text-sm); color:var(--text-dim); margin-top:0.25rem; }

      /* Input Bar */
      .cd-input-bar {
        display:flex; gap:0.5rem; align-items:center;
        background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-sm);
        padding:0.5rem 0.75rem;
      }
      .cd-platform-select {
        height:38px; padding:0 0.6rem; border-radius:var(--radius-xs);
        background:var(--surface-2); border:1px solid var(--border);
        color:var(--text); font-size:var(--text-sm); font-family:var(--font-body);
        outline:none; cursor:pointer; flex-shrink:0;
      }
      .cd-url-input {
        flex:1; height:38px; padding:0 0.85rem;
        background:var(--surface-2); border:1px solid var(--border); border-radius:var(--radius-xs);
        color:var(--text); font-size:var(--text-base); font-family:var(--font-body); outline:none;
        transition:border-color var(--ease-fast); min-width:200px;
      }
      .cd-url-input:focus { border-color:var(--accent); }
      .cd-url-input::placeholder { color:var(--text-dim); }
      .cd-decode-btn {
        height:38px; padding:0 1.25rem; border-radius:var(--radius-xs);
        background:var(--accent); border:none; color:#fff;
        font-size:var(--text-sm); font-weight:700; cursor:pointer;
        font-family:inherit; transition:all var(--ease-fast);
        display:flex; align-items:center; gap:0.4rem; white-space:nowrap;
      }
      .cd-decode-btn:hover { background:#6b5ace; box-shadow:var(--shadow-accent); }
      .cd-decode-btn:disabled { opacity:0.5; cursor:not-allowed; }

      /* Scorecard */
      .cd-scorecard {
        background:var(--surface); border:1px solid var(--border); border-radius:var(--radius);
        padding:1.25rem; position:relative; overflow:hidden;
      }
      .cd-scorecard::before {
        content:''; position:absolute; inset:0; opacity:0.03;
        background:linear-gradient(135deg, var(--accent), var(--cyan), var(--rose));
        pointer-events:none;
      }
      .cd-scorecard-header {
        display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem;
        position:relative; z-index:1;
      }
      .cd-scorecard-title { font-size:var(--text-lg); font-weight:700; }
      .cd-scorecard-total {
        display:flex; align-items:baseline; gap:0.35rem;
      }
      .cd-scorecard-num {
        font-size:1.75rem; font-weight:800;
        background:var(--gradient); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
      }
      .cd-scorecard-max { font-size:var(--text-sm); color:var(--text-dim); font-weight:600; }
      .cd-scorecard-bars { display:grid; grid-template-columns:repeat(auto-fill, minmax(180px,1fr)); gap:0.6rem 1.25rem; position:relative; z-index:1; }
      .cd-score-item { display:flex; flex-direction:column; gap:0.2rem; }
      .cd-score-label {
        display:flex; align-items:center; justify-content:space-between;
        font-size:var(--text-xs); font-weight:600; color:var(--text-muted);
      }
      .cd-score-value { font-family:var(--font-mono); color:var(--accent); }
      .cd-score-track {
        height:6px; background:rgba(255,255,255,0.04); border-radius:3px; overflow:hidden;
      }
      .cd-score-fill {
        height:100%; border-radius:3px; transition:width 0.8s var(--ease-out);
        background:var(--accent);
      }
      .cd-score-fill[data-score="10"] { background:var(--success); }
      .cd-score-fill[data-score="9"] { background:var(--cyan); }
      .cd-score-fill[data-score="8"] { background:var(--accent); }
      .cd-score-fill[data-score="7"] { background:var(--gold); }

      /* Channel Badge */
      .cd-channel-badge {
        display:flex; align-items:center; gap:0.75rem;
        padding:0.75rem 1rem; background:var(--surface); border:1px solid var(--border);
        border-radius:var(--radius-sm); margin-bottom:0.5rem;
      }
      .cd-channel-icon {
        width:40px; height:40px; border-radius:var(--radius-xs);
        display:flex; align-items:center; justify-content:center;
        font-size:1.25rem; flex-shrink:0;
      }
      .cd-channel-name { font-size:var(--text-lg); font-weight:700; }
      .cd-channel-meta { font-size:var(--text-xs); color:var(--text-dim); }
      .cd-channel-platform {
        margin-left:auto; font-size:var(--text-xs); font-weight:700;
        padding:0.2rem 0.5rem; border-radius:var(--radius-xs);
        text-transform:uppercase; letter-spacing:var(--tracking-wide);
      }

      /* Layer Grid */
      .cd-layers-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(380px,1fr)); gap:0.75rem; }
      .cd-layer-card {
        background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-sm);
        overflow:hidden; transition:border-color var(--ease-fast);
      }
      .cd-layer-card:hover { border-color:var(--border-hover); }
      .cd-layer-header {
        display:flex; align-items:center; gap:0.5rem;
        padding:0.75rem 1rem; background:var(--surface-2); border-bottom:1px solid var(--border);
      }
      .cd-layer-num {
        width:22px; height:22px; border-radius:50%;
        display:flex; align-items:center; justify-content:center;
        font-size:0.6rem; font-weight:800; color:#fff; background:var(--accent); flex-shrink:0;
      }
      .cd-layer-icon { font-size:0.9rem; }
      .cd-layer-title { font-size:var(--text-sm); font-weight:700; flex:1; }
      .cd-layer-tag {
        font-size:0.55rem; font-weight:700; padding:0.1rem 0.4rem; border-radius:3px;
        text-transform:uppercase; letter-spacing:var(--tracking-wide);
      }
      .cd-layer-tag.tag-teal { background:rgba(34,211,238,0.12); color:var(--cyan); }
      .cd-layer-tag.tag-pink { background:rgba(244,114,182,0.12); color:var(--rose); }
      .cd-layer-tag.tag-green { background:rgba(52,211,153,0.12); color:var(--success); }
      .cd-layer-body { padding:0.85rem 1rem; font-size:var(--text-sm); color:var(--text-muted); line-height:var(--leading-normal); }

      /* Layer content helpers */
      .cd-kv { display:flex; gap:0.4rem; margin-bottom:0.4rem; }
      .cd-kv-label { color:var(--text-dim); font-weight:600; min-width:90px; flex-shrink:0; font-size:var(--text-xs); text-transform:uppercase; letter-spacing:var(--tracking-wide); padding-top:1px; }
      .cd-kv-value { color:var(--text-muted); font-size:var(--text-sm); }

      .cd-cluster { display:flex; align-items:center; gap:0.5rem; margin-bottom:0.35rem; }
      .cd-cluster-name { font-weight:600; color:var(--text); font-size:var(--text-sm); min-width:140px; }
      .cd-cluster-bar-track { flex:1; height:5px; background:rgba(255,255,255,0.04); border-radius:3px; overflow:hidden; }
      .cd-cluster-bar-fill { height:100%; border-radius:3px; background:var(--accent); }
      .cd-cluster-pct { font-size:var(--text-xs); color:var(--accent); font-family:var(--font-mono); min-width:28px; text-align:right; }
      .cd-cluster-examples { font-size:var(--text-xs); color:var(--text-dim); padding-left:140px; margin-top:-2px; margin-bottom:0.5rem; }

      .cd-mini-table { width:100%; border-collapse:collapse; font-size:var(--text-xs); }
      .cd-mini-table th {
        text-align:left; padding:0.35rem 0.5rem; font-weight:700; color:var(--text-dim);
        text-transform:uppercase; letter-spacing:var(--tracking-wide); border-bottom:1px solid var(--border);
        font-size:0.6rem;
      }
      .cd-mini-table td { padding:0.4rem 0.5rem; border-bottom:1px solid rgba(255,255,255,0.03); color:var(--text-muted); }
      .cd-mini-table tr:last-child td { border-bottom:none; }
      .cd-mini-table tr:hover td { background:rgba(255,255,255,0.02); }
      .cd-outlier-score { color:var(--cyan); font-weight:700; font-family:var(--font-mono); }

      .cd-color-row { display:flex; gap:0.35rem; flex-wrap:wrap; margin-top:0.3rem; }
      .cd-color-swatch {
        width:28px; height:28px; border-radius:var(--radius-xs); border:1px solid rgba(255,255,255,0.1);
      }

      .cd-hook-example {
        padding:0.5rem 0.75rem; margin-bottom:0.35rem;
        background:rgba(255,255,255,0.02); border-left:2px solid var(--accent);
        border-radius:0 var(--radius-xs) var(--radius-xs) 0;
        font-size:var(--text-xs); color:var(--text-muted); font-style:italic;
      }

      .cd-gap-list { list-style:none; padding:0; }
      .cd-gap-list li {
        padding:0.3rem 0; padding-left:1rem; position:relative;
        font-size:var(--text-sm); color:var(--text-muted);
      }
      .cd-gap-list li::before {
        content:'→'; position:absolute; left:0; color:var(--accent); font-weight:700;
      }
      .cd-gap-label {
        font-size:var(--text-xs); font-weight:700; color:var(--text-dim);
        text-transform:uppercase; letter-spacing:var(--tracking-wide);
        margin-top:0.6rem; margin-bottom:0.25rem;
      }
      .cd-gap-label:first-child { margin-top:0; }

      /* Tag chips inside layers */
      .cd-tag-row { display:flex; flex-wrap:wrap; gap:0.3rem; margin-top:0.3rem; }
      .cd-tag {
        font-size:var(--text-xs); padding:0.15rem 0.45rem; border-radius:var(--radius-full);
        background:var(--accent-soft); color:var(--accent); font-weight:500;
      }

      /* Actions Bar */
      .cd-actions {
        display:flex; gap:0.5rem; flex-wrap:wrap; padding:0.75rem 0;
      }
      .cd-action-btn {
        height:36px; padding:0 1rem; border-radius:var(--radius-xs);
        font-size:var(--text-xs); font-weight:700; cursor:pointer;
        font-family:inherit; transition:all var(--ease-fast);
        display:flex; align-items:center; gap:0.35rem; white-space:nowrap;
      }
      .cd-action-btn--primary { background:var(--accent); border:none; color:#fff; }
      .cd-action-btn--primary:hover { background:#6b5ace; box-shadow:var(--shadow-accent); }
      .cd-action-btn--secondary { background:var(--surface-2); border:1px solid var(--border); color:var(--text-muted); }
      .cd-action-btn--secondary:hover { border-color:var(--accent-mid); color:var(--text); }
      .cd-action-btn--success { background:var(--success); border:none; color:#000; font-weight:800; }
      .cd-action-btn--success:hover { filter:brightness(1.1); }

      /* Sidebar */
      .cd-sidebar-card {
        background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-sm);
        overflow:hidden;
      }
      .cd-sidebar-header {
        padding:0.65rem 0.85rem; background:var(--surface-2); border-bottom:1px solid var(--border);
        font-size:var(--text-xs); font-weight:700; color:var(--text-dim);
        text-transform:uppercase; letter-spacing:var(--tracking-wide);
        display:flex; align-items:center; justify-content:space-between;
      }
      .cd-sidebar-count {
        font-size:0.6rem; background:var(--accent-soft); color:var(--accent);
        padding:0.1rem 0.35rem; border-radius:3px; font-weight:700;
      }
      .cd-saved-list { max-height:400px; overflow-y:auto; }
      .cd-saved-item {
        padding:0.6rem 0.85rem; border-bottom:1px solid rgba(255,255,255,0.03);
        cursor:pointer; transition:background var(--ease-fast);
      }
      .cd-saved-item:last-child { border-bottom:none; }
      .cd-saved-item:hover { background:var(--surface-2); }
      .cd-saved-item-name { font-size:var(--text-sm); font-weight:600; color:var(--text); }
      .cd-saved-item-meta {
        display:flex; align-items:center; justify-content:space-between;
        font-size:var(--text-xs); color:var(--text-dim); margin-top:0.15rem;
      }
      .cd-saved-item-score { color:var(--accent); font-weight:700; font-family:var(--font-mono); }
      .cd-saved-item-actions { display:flex; gap:0.25rem; margin-top:0.3rem; }
      .cd-saved-micro-btn {
        font-size:0.6rem; padding:0.15rem 0.4rem; border-radius:3px;
        background:var(--surface-2); border:1px solid var(--border);
        color:var(--text-dim); cursor:pointer; font-family:inherit;
        transition:all var(--ease-fast);
      }
      .cd-saved-micro-btn:hover { border-color:var(--accent); color:var(--text); }
      .cd-saved-micro-btn--del:hover { border-color:#ef4444; color:#ef4444; }

      /* Empty / Loading states */
      .cd-empty {
        text-align:center; padding:3rem 1.5rem;
        background:var(--surface); border:1px solid var(--border); border-radius:var(--radius);
      }
      .cd-empty-icon { font-size:2.5rem; display:block; margin-bottom:0.5rem; opacity:0.6; }
      .cd-empty h4 { font-size:var(--text-lg); margin-bottom:0.25rem; }
      .cd-empty p { color:var(--text-dim); font-size:var(--text-sm); max-width:400px; margin:0 auto; }
      .cd-loading-overlay {
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        padding:4rem 2rem; gap:1rem; text-align:center;
        background:var(--surface); border:1px solid var(--border); border-radius:var(--radius);
      }
      .cd-loading-text { font-size:var(--text-sm); color:var(--text-muted); }
      .cd-loading-sub { font-size:var(--text-xs); color:var(--text-dim); }

      /* Sidebar empty */
      .cd-sidebar-empty {
        padding:1.25rem 0.85rem; text-align:center;
        font-size:var(--text-xs); color:var(--text-dim); line-height:var(--leading-normal);
      }

      /* Animations */
      @keyframes cdFadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
      .cd-layer-card { animation:cdFadeIn 0.4s var(--ease-out) both; }
      .cd-layer-card:nth-child(1) { animation-delay:0.05s; }
      .cd-layer-card:nth-child(2) { animation-delay:0.1s; }
      .cd-layer-card:nth-child(3) { animation-delay:0.15s; }
      .cd-layer-card:nth-child(4) { animation-delay:0.2s; }
      .cd-layer-card:nth-child(5) { animation-delay:0.25s; }
      .cd-layer-card:nth-child(6) { animation-delay:0.3s; }
      .cd-layer-card:nth-child(7) { animation-delay:0.35s; }
      .cd-layer-card:nth-child(8) { animation-delay:0.4s; }
      .cd-layer-card:nth-child(9) { animation-delay:0.45s; }

      /* Responsive */
      @media (max-width:1024px) {
        .cd-wrapper { flex-direction:column; }
        .cd-sidebar { width:100%; flex-direction:row; flex-wrap:wrap; }
        .cd-sidebar-card { flex:1; min-width:260px; }
        .cd-layers-grid { grid-template-columns:1fr; }
      }
      @media (max-width:640px) {
        .cd-input-bar { flex-direction:column; }
        .cd-url-input { min-width:100%; }
        .cd-scorecard-bars { grid-template-columns:1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Utility: HTML Escape ──
  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ── LocalStorage ──
  function loadSavedBlueprints() {
    try { savedBlueprints = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { savedBlueprints = []; }
  }

  function persistBlueprints() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedBlueprints));
  }

  function saveBlueprint(bp) {
    if (!bp) return;
    const existing = savedBlueprints.findIndex(b => b.id === bp.id);
    const entry = {
      id: bp.id || 'bp_' + Date.now(),
      channelName: bp.channelName,
      platform: bp.platform,
      url: bp.url,
      decodedAt: bp.decodedAt,
      score: bp.scorecard?.overall || 0,
      data: bp,
    };
    if (existing >= 0) savedBlueprints[existing] = entry;
    else savedBlueprints.unshift(entry);
    persistBlueprints();
    if (typeof PersonaGenAPI !== 'undefined') PersonaGenAPI.showToast(`Blueprint "${bp.channelName}" saved`, 'success');
    renderSidebar();
  }

  function deleteBlueprint(id) {
    savedBlueprints = savedBlueprints.filter(b => b.id !== id);
    persistBlueprints();
    if (typeof PersonaGenAPI !== 'undefined') PersonaGenAPI.showToast('Blueprint deleted', 'info');
    renderSidebar();
  }

  function loadBlueprint(id) {
    const entry = savedBlueprints.find(b => b.id === id);
    if (entry?.data) {
      currentBlueprint = entry.data;
      renderResults();
    }
  }

  // ── Init ──
  function init(containerId) {
    container = document.getElementById(containerId);
    if (!container) return;
    injectStyles();
    loadSavedBlueprints();
    currentBlueprint = DEMO_BLUEPRINT;
    render();
  }

  // ── Full Render ──
  function render() {
    container.innerHTML = `
      <div class="cd-wrapper">
        <div class="cd-main">
          ${renderHeader()}
          ${renderInputBar()}
          <div id="cd-results">${renderResultsContent()}</div>
        </div>
        <div class="cd-sidebar" id="cd-sidebar">
          ${renderSidebarContent()}
        </div>
      </div>
    `;
  }

  function renderHeader() {
    return `
      <div class="cd-header">
        <div class="cd-header-left">
          <h3 class="cd-title">🔬 Channel Decoder</h3>
          <p class="cd-subtitle">Reverse-engineer any channel into a reusable blueprint</p>
        </div>
      </div>
    `;
  }

  function renderInputBar() {
    return `
      <div class="cd-input-bar">
        <select class="cd-platform-select" id="cd-platform">
          ${Object.entries(PLATFORMS).map(([k, p]) =>
            `<option value="${k}">${p.icon} ${p.label}</option>`
          ).join('')}
        </select>
        <input type="url" class="cd-url-input" id="cd-url"
               placeholder="Paste channel URL… e.g. youtube.com/@aiexplained-official"
               onkeydown="if(event.key==='Enter')ChannelDecoder.decode()">
        <button class="cd-decode-btn" id="cd-decode-btn" onclick="ChannelDecoder.decode()" ${isLoading ? 'disabled' : ''}>
          ${isLoading ? '<div class="pg-spinner pg-spinner--sm"></div> Decoding…' : '🔬 Decode Channel'}
        </button>
      </div>
    `;
  }

  // ── Results Area ──
  function renderResults() {
    const el = document.getElementById('cd-results');
    if (el) el.innerHTML = renderResultsContent();
  }

  function renderResultsContent() {
    if (isLoading) {
      return `
        <div class="cd-loading-overlay">
          <div class="pg-spinner" style="width:32px;height:32px;border-width:3px;"></div>
          <span class="cd-loading-text">Decoding channel across 9 layers…</span>
          <span class="cd-loading-sub">Analyzing positioning, topics, outliers, titles, thumbnails, hooks, scripts, tone & gaps</span>
        </div>
      `;
    }
    if (!currentBlueprint) {
      return `
        <div class="cd-empty">
          <span class="cd-empty-icon">🔬</span>
          <h4>No Blueprint Loaded</h4>
          <p>Paste a channel URL above and click Decode, or load a saved blueprint from the sidebar.</p>
        </div>
      `;
    }
    return renderBlueprint(currentBlueprint);
  }

  function renderBlueprint(bp) {
    const sc = bp.scorecard || {};
    const ly = bp.layers || {};
    const plat = PLATFORMS[bp.platform] || PLATFORMS.youtube;

    return `
      <!-- Channel Badge -->
      <div class="cd-channel-badge">
        <div class="cd-channel-icon" style="background:${plat.color}20; color:${plat.color};">${plat.icon}</div>
        <div>
          <div class="cd-channel-name">${esc(bp.channelName)}</div>
          <div class="cd-channel-meta">${esc(bp.url)} · Decoded ${new Date(bp.decodedAt).toLocaleDateString()}</div>
        </div>
        <span class="cd-channel-platform" style="background:${plat.color}18; color:${plat.color};">${plat.label}</span>
      </div>

      <!-- Scorecard -->
      ${renderScorecard(sc)}

      <!-- Actions -->
      <div class="cd-actions">
        <button class="cd-action-btn cd-action-btn--primary" onclick="ChannelDecoder.feedToAgent()">🤖 Feed Blueprint → Agent</button>
        <button class="cd-action-btn cd-action-btn--secondary" onclick="ChannelDecoder.openInForge()">⚡ Open in Content Forge</button>
        <button class="cd-action-btn cd-action-btn--success" onclick="ChannelDecoder.saveCurrent()">💾 Save Blueprint</button>
      </div>

      <!-- 9 Layer Grid -->
      <div class="cd-layers-grid">
        ${renderLayerPositioning(ly.positioning)}
        ${renderLayerTopicDNA(ly.topicDNA)}
        ${renderLayerOutliers(ly.outliers)}
        ${renderLayerTitleFormulas(ly.titleFormulas)}
        ${renderLayerThumbnailDNA(ly.thumbnailDNA)}
        ${renderLayerHookStructure(ly.hookStructure)}
        ${renderLayerScriptArch(ly.scriptArch)}
        ${renderLayerTonePacing(ly.tonePacing)}
        ${renderLayerContentGaps(ly.contentGaps)}
      </div>
    `;
  }

  // ── Scorecard ──
  function renderScorecard(sc) {
    const total = sc.overall || Object.values(sc).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
    return `
      <div class="cd-scorecard">
        <div class="cd-scorecard-header">
          <span class="cd-scorecard-title">📊 Blueprint Scorecard</span>
          <div class="cd-scorecard-total">
            <span class="cd-scorecard-num">${total}</span>
            <span class="cd-scorecard-max">/ 100</span>
          </div>
        </div>
        <div class="cd-scorecard-bars">
          ${LAYER_META.map(lm => {
            const score = sc[lm.key] || 0;
            return `
              <div class="cd-score-item">
                <div class="cd-score-label">
                  <span>${lm.icon} L${lm.num}: ${lm.title}</span>
                  <span class="cd-score-value">${score}/10</span>
                </div>
                <div class="cd-score-track">
                  <div class="cd-score-fill" data-score="${score}" style="width:${score * 10}%"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // ── Layer Renderers ──
  function layerShell(num, content) {
    const meta = LAYER_META[num - 1];
    return `
      <div class="cd-layer-card">
        <div class="cd-layer-header">
          <div class="cd-layer-num">${num}</div>
          <span class="cd-layer-icon">${meta.icon}</span>
          <span class="cd-layer-title">${meta.title}</span>
          <span class="cd-layer-tag ${meta.tag}">L${num}</span>
        </div>
        <div class="cd-layer-body">${content}</div>
      </div>
    `;
  }

  function renderLayerPositioning(d) {
    if (!d) return layerShell(1, '<em style="color:var(--text-dim)">No data</em>');
    return layerShell(1, `
      <div class="cd-kv"><span class="cd-kv-label">Audience</span><span class="cd-kv-value">${esc(d.audience)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Promise</span><span class="cd-kv-value">${esc(d.promise)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Emotional</span><span class="cd-kv-value">${esc(d.emotionalSell)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Niche</span><span class="cd-kv-value">${esc(d.niche)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Edge</span><span class="cd-kv-value">${esc(d.differentiator)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Subscribers</span><span class="cd-kv-value">${esc(d.subscriberProfile)}</span></div>
    `);
  }

  function renderLayerTopicDNA(d) {
    if (!d) return layerShell(2, '<em style="color:var(--text-dim)">No data</em>');
    const clusters = (d.clusters || []).map(c => `
      <div class="cd-cluster">
        <span class="cd-cluster-name">${esc(c.name)}</span>
        <div class="cd-cluster-bar-track"><div class="cd-cluster-bar-fill" style="width:${c.weight}%"></div></div>
        <span class="cd-cluster-pct">${c.weight}%</span>
      </div>
      ${c.examples ? `<div class="cd-cluster-examples">${c.examples.map(e => esc(e)).join(' · ')}</div>` : ''}
    `).join('');
    const evergreen = (d.evergreen || []).length ? `
      <div class="cd-gap-label" style="margin-top:0.75rem;">Evergreen</div>
      <div class="cd-tag-row">${d.evergreen.map(t => `<span class="cd-tag">${esc(t)}</span>`).join('')}</div>
    ` : '';
    const trend = (d.trendDriven || []).length ? `
      <div class="cd-gap-label">Trend-Driven</div>
      <div class="cd-tag-row">${d.trendDriven.map(t => `<span class="cd-tag" style="background:var(--rose-soft);color:var(--rose);">${esc(t)}</span>`).join('')}</div>
    ` : '';
    return layerShell(2, clusters + evergreen + trend);
  }

  function renderLayerOutliers(d) {
    if (!d || !d.length) return layerShell(3, '<em style="color:var(--text-dim)">No data</em>');
    return layerShell(3, `
      <table class="cd-mini-table">
        <thead><tr><th>Title</th><th>Views</th><th>Score</th><th>Why It Worked</th></tr></thead>
        <tbody>
          ${d.map(v => `
            <tr>
              <td style="font-weight:600;color:var(--text);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(v.title)}">${esc(v.title)}</td>
              <td style="font-family:var(--font-mono);white-space:nowrap;">${esc(v.views)}</td>
              <td><span class="cd-outlier-score">${v.outlierScore}×</span></td>
              <td style="font-size:0.6rem;max-width:140px;">${esc(v.why)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `);
  }

  function renderLayerTitleFormulas(d) {
    if (!d || !d.length) return layerShell(4, '<em style="color:var(--text-dim)">No data</em>');
    return layerShell(4, `
      <table class="cd-mini-table">
        <thead><tr><th>Formula</th><th>Template</th><th>Example</th></tr></thead>
        <tbody>
          ${d.map(f => `
            <tr>
              <td style="font-weight:600;color:var(--accent);white-space:nowrap;">${esc(f.name)}</td>
              <td style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-muted);">${esc(f.template)}</td>
              <td style="font-size:0.6rem;font-style:italic;">${esc(f.example)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `);
  }

  function renderLayerThumbnailDNA(d) {
    if (!d) return layerShell(5, '<em style="color:var(--text-dim)">No data</em>');
    return layerShell(5, `
      <div class="cd-kv"><span class="cd-kv-label">Focal Point</span><span class="cd-kv-value">${esc(d.focalPoint)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Text</span><span class="cd-kv-value">${esc(d.textLength)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Face</span><span class="cd-kv-value">${esc(d.facePresence)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Style</span><span class="cd-kv-value">${esc(d.style)}</span></div>
      <div class="cd-kv" style="align-items:center;">
        <span class="cd-kv-label">Colors</span>
        <div class="cd-color-row">
          ${(d.dominantColors || []).map(c => `<div class="cd-color-swatch" style="background:${c};" title="${c}"></div>`).join('')}
        </div>
      </div>
      ${(d.patterns || []).length ? `
        <div class="cd-gap-label" style="margin-top:0.5rem;">Patterns</div>
        <div class="cd-tag-row">${d.patterns.map(p => `<span class="cd-tag">${esc(p)}</span>`).join('')}</div>
      ` : ''}
    `);
  }

  function renderLayerHookStructure(d) {
    if (!d) return layerShell(6, '<em style="color:var(--text-dim)">No data</em>');
    return layerShell(6, `
      <div class="cd-kv"><span class="cd-kv-label">Style</span><span class="cd-kv-value">${esc(d.openingStyle)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Stakes</span><span class="cd-kv-value">${esc(d.stakes)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Loop</span><span class="cd-kv-value">${esc(d.curiosityLoop)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Duration</span><span class="cd-kv-value">${esc(d.avgHookLength)}</span></div>
      ${(d.examples || []).length ? `
        <div class="cd-gap-label" style="margin-top:0.5rem;">Examples</div>
        ${d.examples.map(e => `<div class="cd-hook-example">"${esc(e)}"</div>`).join('')}
      ` : ''}
    `);
  }

  function renderLayerScriptArch(d) {
    if (!d || !d.length) return layerShell(7, '<em style="color:var(--text-dim)">No data</em>');
    return layerShell(7, `
      <table class="cd-mini-table">
        <thead><tr><th>Section</th><th>Time</th><th>Purpose</th></tr></thead>
        <tbody>
          ${d.map(s => `
            <tr>
              <td style="font-weight:600;color:var(--text);white-space:nowrap;">${esc(s.section)}</td>
              <td style="font-family:var(--font-mono);color:var(--cyan);white-space:nowrap;font-size:0.6rem;">${esc(s.timestamp)}</td>
              <td style="font-size:0.6rem;">${esc(s.purpose)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `);
  }

  function renderLayerTonePacing(d) {
    if (!d) return layerShell(8, '<em style="color:var(--text-dim)">No data</em>');
    return layerShell(8, `
      <div class="cd-kv"><span class="cd-kv-label">Tone</span><span class="cd-kv-value" style="color:var(--accent);font-weight:700;">${esc(d.toneLabel)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Energy</span><span class="cd-kv-value">${esc(d.energy)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Vocabulary</span><span class="cd-kv-value">${esc(d.vocabulary)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Humor</span><span class="cd-kv-value">${esc(d.humor)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Authority</span><span class="cd-kv-value">${esc(d.authority)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Pacing</span><span class="cd-kv-value">${esc(d.pacing)}</span></div>
      <div class="cd-kv"><span class="cd-kv-label">Persona</span><span class="cd-kv-value" style="font-style:italic;">${esc(d.personality)}</span></div>
    `);
  }

  function renderLayerContentGaps(d) {
    if (!d) return layerShell(9, '<em style="color:var(--text-dim)">No data</em>');
    let html = '';
    if (d.missingTopics?.length) {
      html += `<div class="cd-gap-label">Missing Topics</div><ul class="cd-gap-list">${d.missingTopics.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
    }
    if (d.outdatedContent?.length) {
      html += `<div class="cd-gap-label">Outdated Content</div><ul class="cd-gap-list">${d.outdatedContent.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
    }
    if (d.formatGaps?.length) {
      html += `<div class="cd-gap-label">Format Gaps</div><ul class="cd-gap-list">${d.formatGaps.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
    }
    return layerShell(9, html || '<em style="color:var(--text-dim)">No gaps identified</em>');
  }

  // ── Sidebar ──
  function renderSidebar() {
    const el = document.getElementById('cd-sidebar');
    if (el) el.innerHTML = renderSidebarContent();
  }

  function renderSidebarContent() {
    return `
      <div class="cd-sidebar-card">
        <div class="cd-sidebar-header">
          <span>💾 Saved Blueprints</span>
          <span class="cd-sidebar-count">${savedBlueprints.length}</span>
        </div>
        ${savedBlueprints.length > 0 ? `
          <div class="cd-saved-list">
            ${savedBlueprints.map(bp => `
              <div class="cd-saved-item" onclick="ChannelDecoder.loadBlueprint('${bp.id}')">
                <div class="cd-saved-item-name">${esc(bp.channelName)}</div>
                <div class="cd-saved-item-meta">
                  <span>${PLATFORMS[bp.platform]?.icon || '📺'} ${new Date(bp.decodedAt).toLocaleDateString()}</span>
                  <span class="cd-saved-item-score">${bp.score}/100</span>
                </div>
                <div class="cd-saved-item-actions">
                  <button class="cd-saved-micro-btn" onclick="event.stopPropagation();ChannelDecoder.loadBlueprint('${bp.id}')">Load</button>
                  <button class="cd-saved-micro-btn cd-saved-micro-btn--del" onclick="event.stopPropagation();ChannelDecoder.deleteBlueprint('${bp.id}')">Delete</button>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="cd-sidebar-empty">
            No saved blueprints yet.<br>Decode a channel and click 💾 Save to keep it here.
          </div>
        `}
      </div>

      <div class="cd-sidebar-card">
        <div class="cd-sidebar-header">
          <span>ℹ️ How It Works</span>
        </div>
        <div style="padding:0.75rem 0.85rem; font-size:var(--text-xs); color:var(--text-dim); line-height:var(--leading-normal);">
          <strong style="color:var(--text-muted);">9 Analysis Layers:</strong><br>
          ${LAYER_META.map(lm => `<span style="color:var(--text-muted);">${lm.icon} L${lm.num}</span> ${lm.title}`).join('<br>')}
          <div style="margin-top:0.5rem; padding-top:0.5rem; border-top:1px solid var(--border);">
            Paste any YouTube, TikTok, or Instagram channel URL to generate a comprehensive content blueprint you can feed directly to your AI agent.
          </div>
        </div>
      </div>
    `;
  }

  // ── API Integration ──
  async function decode() {
    const urlInput = document.getElementById('cd-url');
    const platformSelect = document.getElementById('cd-platform');
    const url = urlInput?.value?.trim();
    const platform = platformSelect?.value || 'youtube';

    if (!url) {
      if (typeof PersonaGenAPI !== 'undefined') PersonaGenAPI.showToast('Paste a channel URL to decode', 'warning');
      urlInput?.focus();
      return;
    }

    isLoading = true;
    currentBlueprint = null;
    renderResults();
    const btn = document.getElementById('cd-decode-btn');
    if (btn) { btn.innerHTML = '<div class="pg-spinner pg-spinner--sm"></div> Decoding…'; btn.disabled = true; }

    try {
      const res = await fetch(DECODE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decode', url, platform, ts: Date.now() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data && (data.layers || data.scorecard || data.channelName)) {
        currentBlueprint = {
          id: 'bp_' + Date.now(),
          channelName: data.channelName || extractChannelName(url),
          platform,
          url,
          decodedAt: new Date().toISOString(),
          scorecard: data.scorecard || {},
          layers: data.layers || {},
        };
        if (typeof PersonaGenAPI !== 'undefined') PersonaGenAPI.showToast(`Decoded ${currentBlueprint.channelName} successfully!`, 'success');
      } else {
        throw new Error('Invalid response structure');
      }
    } catch (err) {
      console.warn('[ChannelDecoder] API decode failed, using demo fallback:', err);
      currentBlueprint = {
        ...DEMO_BLUEPRINT,
        id: 'bp_' + Date.now(),
        channelName: extractChannelName(url) || DEMO_BLUEPRINT.channelName,
        platform,
        url,
        decodedAt: new Date().toISOString(),
      };
      if (typeof PersonaGenAPI !== 'undefined') PersonaGenAPI.showToast('Using demo blueprint — API unavailable', 'info');
    } finally {
      isLoading = false;
      renderResults();
      if (btn) { btn.innerHTML = '🔬 Decode Channel'; btn.disabled = false; }
    }
  }

  function extractChannelName(url) {
    if (!url) return '';
    const match = url.match(/@([^\/\?]+)/);
    if (match) return match[1].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const parts = url.replace(/https?:\/\//, '').split('/').filter(Boolean);
    return parts[parts.length - 1] || 'Unknown Channel';
  }

  // ── Action Buttons ──
  function feedToAgent() {
    if (!currentBlueprint) return;
    if (typeof PersonaGenAPI !== 'undefined') {
      PersonaGenAPI.showToast(`Blueprint "${currentBlueprint.channelName}" sent to agent pipeline`, 'success');
    }
    // Fire webhook if PersonaWebhook exists
    if (typeof PersonaWebhook !== 'undefined') {
      PersonaWebhook.fire('blueprint.feed', { blueprint: currentBlueprint });
    }
  }

  function openInForge() {
    if (!currentBlueprint) return;
    if (typeof ContentForge !== 'undefined' && ContentForge.forgeFromBlueprint) {
      // Switch to Content Forge view if portal switcher is available
      if (typeof switchPortalView === 'function') switchPortalView('content-forge');
      ContentForge.forgeFromBlueprint(currentBlueprint);
      if (typeof PersonaGenAPI !== 'undefined') PersonaGenAPI.showToast('Blueprint loaded into Content Forge', 'success');
    } else {
      if (typeof PersonaGenAPI !== 'undefined') PersonaGenAPI.showToast('Content Forge module not loaded', 'warning');
    }
  }

  function saveCurrent() {
    if (currentBlueprint) saveBlueprint(currentBlueprint);
  }

  // ── Public API ──
  return {
    init,
    decode,
    saveCurrent,
    saveBlueprint,
    deleteBlueprint,
    loadBlueprint,
    feedToAgent,
    openInForge,
    getBlueprint: () => currentBlueprint,
  };
})();

// Auto-init on page load
document.addEventListener('DOMContentLoaded', () => {
  const mount = document.getElementById('channel-decoder-mount');
  if (mount && !mount.hasChildNodes()) {
    ChannelDecoder.init('channel-decoder-mount');
  }
});
