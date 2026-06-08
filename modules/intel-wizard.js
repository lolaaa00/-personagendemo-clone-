// ═══════════════════════════════════════════════════════════════
// PersonaGen Intelligence Wizard — End-to-End Content Pipeline
// 🧠 Trend Scanner ➔ Social Scout ➔ Channel Decoder ➔ AI Agent Training ➔ Content Forge
// ═══════════════════════════════════════════════════════════════

const IntelWizard = (() => {
  let container = null;
  let currentStep = 1;
  
  // State
  let state = {
    niche: 'fitness',
    trend: null,
    competitor: null,
    post: null,
    scannedPostId: null,
    agent: null,
    isScanning: false,
    isTraining: false,
    trainingComplete: false,
    drafts: null
  };

  // Mockup databases for high-fidelity interactive flow
  const NICHES = [
    { id: 'fitness', label: 'Fitness & Wellness', icon: '💪', color: '#ec4899', agent: '@sofiarivera.ai' },
    { id: 'tech', label: 'Tech & AI Automation', icon: '🧠', color: '#3b82f6', agent: '@marcuschen.tech' },
    { id: 'fashion', label: 'Fashion & Luxury', icon: '✨', color: '#f59e0b', agent: '@aishanoori.style' },
    { id: 'beauty', label: 'Lifestyle & Beauty', icon: '💄', color: '#8b5cf6', agent: '@veronicahap' }
  ];

  const TREND_DATA = {
    fitness: [
      { id: 't1', topic: '#Zone2Cardio', volume: '1.4M', growth: '+185%', platform: 'tiktok', hot: true, desc: 'Low intensity cardio for longevity and metabolic fitness.' },
      { id: 't2', topic: 'Cortisol-Conscious Gym', volume: '820K', growth: '+140%', platform: 'instagram', hot: true, desc: 'Workouts designed to limit adrenal fatigue and stress response.' },
      { id: 't3', topic: 'Spit-lit Meal Prepping', volume: '450K', growth: '+95%', platform: 'tiktok', hot: false, desc: 'Fast, high-protein recipes under 10 minutes.' },
      { id: 't4', topic: 'Micro-dose Exercises', volume: '320K', growth: '+60%', platform: 'youtube', hot: false, desc: '5-minute mobility and strength snacks during desk jobs.' }
    ],
    tech: [
      { id: 't1', topic: 'Local LLMs (Llama 3/Ollama)', volume: '3.8M', growth: '+260%', platform: 'x', hot: true, desc: 'Running powerful generative models locally on consumer hardware.' },
      { id: 't2', topic: 'Autonomous Coding Agents', volume: '2.5M', growth: '+195%', platform: 'youtube', hot: true, desc: 'Using AI systems to write, test, and deploy software autonomously.' },
      { id: 't3', topic: 'Prompt Chaining & DSPy', volume: '940K', growth: '+120%', platform: 'reddit', hot: false, desc: 'Moving from single prompts to programmatic LLM workflows.' },
      { id: 't4', topic: 'Privacy-First AI Smart Home', volume: '710K', growth: '+85%', platform: 'youtube', hot: false, desc: 'Integrating localized voice assistants and home automation.' }
    ],
    fashion: [
      { id: 't1', topic: 'Quiet Luxury / Old Money', volume: '4.9M', growth: '+150%', platform: 'instagram', hot: true, desc: 'Logo-less luxury styling, heritage craftsmanship, and minimalist looks.' },
      { id: 't2', topic: 'Bilingual Fashion GRWM', volume: '1.6M', growth: '+135%', platform: 'tiktok', hot: true, desc: 'Arabic-English high couture styling and routine transitions.' },
      { id: 't3', topic: 'Modest Runway Drops', volume: '1.1M', growth: '+90%', platform: 'instagram', hot: false, desc: 'Elegant high-fashion coverage adapted for modest luxury markets.' },
      { id: 't4', topic: 'Upcycled Thrift Couture', volume: '680K', growth: '+75%', platform: 'tiktok', hot: false, desc: 'Reconstructing vintage luxury pieces into modern styles.' }
    ],
    beauty: [
      { id: 't1', topic: 'Glass Skin Skincare Routine', volume: '5.4M', growth: '+210%', platform: 'tiktok', hot: true, desc: 'Ultra-dewy, intensely hydrated Korean skincare routines.' },
      { id: 't2', topic: 'AIGC Lifestyle POV Skits', volume: '3.2M', growth: '+250%', platform: 'tiktok', hot: true, desc: 'Hyper-realistic AI virtual influencers filming daily vlogs.' },
      { id: 't3', topic: 'Cold Plunge Beauty Routine', volume: '1.8M', growth: '+110%', platform: 'instagram', hot: false, desc: 'Ice baths and cold therapy for skin tighting and inflammation.' },
      { id: 't4', topic: 'Silent Review Hauls', volume: '950K', growth: '+85%', platform: 'youtube', hot: false, desc: 'Reviewing cosmetics solely via visual expressions and ASMR taps.' }
    ]
  };

  const COMPETITOR_DATA = {
    fitness: [
      {
        id: 'c1',
        name: 'Elena Active',
        handle: '@elena.active',
        platform: 'tiktok',
        followers: '142K',
        engagement: '7.8%',
        virality: '9.6/10',
        bio: 'Metabolic longevity & hormone-conscious performance coaching.',
        posts: [
          { id: 'p1_1', topic: '#Zone2Cardio', title: 'Why Zone 2 Cardio is the ultimate longevity drug (and why HIIT might be spiking your cortisol).', views: '1.8M', likes: '142K', engagement: '9.8%' },
          { id: 'p1_2', topic: 'Cortisol-Conscious Gym', title: 'Cortisol-friendly workouts that actually build lean muscle without burning you out.', views: '720K', likes: '45K', engagement: '8.4%' },
          { id: 'p1_3', topic: '#FitnessPrep', title: 'My 10-minute protein prep routine: 5 meals, 180g protein, no stoves.', views: '230K', likes: '12K', engagement: '5.1%' }
        ]
      },
      {
        id: 'c2',
        name: 'Nate Iron',
        handle: '@nate.irons',
        platform: 'instagram',
        followers: '89K',
        engagement: '5.9%',
        virality: '8.4/10',
        bio: 'High-protein culinary shortcuts and strength optimization.',
        posts: [
          { id: 'p2_1', topic: '#FitnessPrep', title: 'My 10-minute protein prep routine: 5 meals, 180g protein, no stoves.', views: '450K', likes: '29K', engagement: '7.2%' },
          { id: 'p2_2', topic: '#Zone2Cardio', title: 'How Zone 2 low-intensity runs fixed my high blood pressure in 30 days.', views: '210K', likes: '15K', engagement: '6.4%' }
        ]
      },
      {
        id: 'c3',
        name: 'Coach Spanglish',
        handle: '@coach.spanglish',
        platform: 'tiktok',
        followers: '210K',
        engagement: '6.9%',
        virality: '9.2/10',
        bio: 'Bilingual health hacks, metabolic restoration, and fatigue reduction.',
        posts: [
          { id: 'p3_1', topic: 'Cortisol-Conscious Gym', title: 'Cortisol-friendly workouts that actually build lean muscle without burning you out.', views: '1.2M', likes: '95K', engagement: '8.9%' },
          { id: 'p3_2', topic: '#Zone2Cardio', title: 'Why you feel like trash after high-intensity interval training.', views: '580K', likes: '42K', engagement: '7.8%' }
        ]
      }
    ],
    tech: [
      {
        id: 'c1',
        name: 'Devin Explains',
        handle: '@devinexplains',
        platform: 'youtube',
        followers: '320K',
        engagement: '8.4%',
        virality: '9.8/10',
        bio: 'Hacker tutorials, local AI setups, and autonomous agents builder.',
        posts: [
          { id: 'p4_1', topic: 'Autonomous Coding Agents', title: 'I built an autonomous AI coding agent in 30 lines of Python — here is the full blueprint.', views: '1.5M', likes: '120K', engagement: '10.2%' },
          { id: 'p4_2', topic: 'Local LLMs (Llama 3/Ollama)', title: 'Tutorial: Running Llama 3 locally on an M3 MacBook with GPU acceleration.', views: '840K', likes: '62K', engagement: '8.7%' }
        ]
      },
      {
        id: 'c2',
        name: 'ByteSize AI',
        handle: '@bytesize.ai',
        platform: 'x',
        followers: '115K',
        engagement: '6.2%',
        virality: '8.8/10',
        bio: 'Distilling complex production machine learning architectures into bite-sized summaries.',
        posts: [
          { id: 'p5_1', topic: 'Local LLMs (Llama 3/Ollama)', title: 'Why basic prompt engineering is dead. Prompt chaining with DSPy is the new standard.', views: '980K', likes: '54K', engagement: '8.1%' },
          { id: 'p5_2', topic: 'Autonomous Coding Agents', title: 'Building reliable agent networks: Why single agents fail in production workloads.', views: '320K', likes: '18K', engagement: '5.9%' }
        ]
      },
      {
        id: 'c3',
        name: 'Llama Pioneer',
        handle: '@llama.pioneer',
        platform: 'reddit',
        followers: '75K',
        engagement: '7.1%',
        virality: '9.0/10',
        bio: 'Open-source local LLM research and system fine-tuning pipelines.',
        posts: [
          { id: 'p6_1', topic: 'Local LLMs (Llama 3/Ollama)', title: 'Tutorial: Running Llama 3 locally on an M3 MacBook with GPU acceleration.', views: '610K', likes: '38K', engagement: '9.1%' },
          { id: 'p6_2', topic: 'Autonomous Coding Agents', title: 'Local code debugger agents that work without internet connection.', views: '140K', likes: '9K', engagement: '4.8%' }
        ]
      }
    ],
    fashion: [
      {
        id: 'c1',
        name: 'Amina Couture',
        handle: '@amina.couture',
        platform: 'instagram',
        followers: '510K',
        engagement: '9.1%',
        virality: '9.7/10',
        bio: 'Eastern haute couture and minimalist design aesthetics from Dubai.',
        posts: [
          { id: 'p7_1', topic: 'Bilingual Fashion GRWM', title: 'Bilingual GRWM: styling archival vintage pieces for a Dubai art gallery opening.', views: '1.9M', likes: '165K', engagement: '11.4%' },
          { id: 'p7_2', topic: 'Quiet Luxury / Old Money', title: 'Behind the scenes of modest haute couture drops in Dubai — elegance redefined.', views: '820K', likes: '61K', engagement: '8.3%' }
        ]
      },
      {
        id: 'c2',
        name: 'Quiet Luxury Insider',
        handle: '@quiet.luxury',
        platform: 'tiktok',
        followers: '280K',
        engagement: '6.4%',
        virality: '8.5/10',
        bio: 'Uncovering the codes of quiet, logo-less wealth styling and tailoring.',
        posts: [
          { id: 'p8_1', topic: 'Quiet Luxury / Old Money', title: 'How to assemble the Old Money aesthetic without paying retail luxury prices.', views: '3.2M', likes: '210K', engagement: '9.4%' },
          { id: 'p8_2', topic: 'Bilingual Fashion GRWM', title: 'GRWM: Styling structured minimalist linen drape jackets.', views: '410K', likes: '22K', engagement: '6.1%' }
        ]
      },
      {
        id: 'c3',
        name: 'Retro Chic',
        handle: '@retro.chic',
        platform: 'instagram',
        followers: '195K',
        engagement: '7.6%',
        virality: '9.1/10',
        bio: 'Vintage archiving, design composition, and retro couture lookbooks.',
        posts: [
          { id: 'p9_1', topic: 'Bilingual Fashion GRWM', title: 'Bilingual GRWM: styling archival vintage pieces for a Dubai art gallery opening.', views: '1.1M', likes: '84K', engagement: '8.9%' },
          { id: 'p9_2', topic: 'Quiet Luxury / Old Money', title: 'My 5 style rules to look expensive without any visible brand logos.', views: '670K', likes: '48K', engagement: '7.6%' }
        ]
      }
    ],
    beauty: [
      {
        id: 'c1',
        name: 'Mia Glass Skin',
        handle: '@mia.glassskin',
        platform: 'tiktok',
        followers: '890K',
        engagement: '10.5%',
        virality: '9.9/10',
        bio: 'Hyper-focused dewy skincare rituals and Korean formulation guides.',
        posts: [
          { id: 'p10_1', topic: 'Glass Skin Skincare Routine', title: 'The exact 5-step Korean skincare routine that gave me viral glass skin.', views: '4.1M', likes: '380K', engagement: '12.5%' },
          { id: 'p10_2', topic: 'AIGC Lifestyle POV Skits', title: 'Silent Review: testing viral Korean glass skin toners with ASMR taps.', views: '950K', likes: '62K', engagement: '8.8%' }
        ]
      },
      {
        id: 'c2',
        name: 'Siri POV',
        handle: '@siri.povs',
        platform: 'tiktok',
        followers: '450K',
        engagement: '9.3%',
        virality: '9.4/10',
        bio: 'Meta lifestyle diaries and virtual roommate comedy skits.',
        posts: [
          { id: 'p11_1', topic: 'AIGC Lifestyle POV Skits', title: 'POV: Your AI roommate takes over your daily beauty routine and it goes viral.', views: '5.2M', likes: '440K', engagement: '11.8%' },
          { id: 'p11_2', topic: 'Glass Skin Skincare Routine', title: 'A morning in the life of a digital creator: cold plunge and dewy skincare.', views: '1.1M', likes: '85K', engagement: '9.1%' }
        ]
      },
      {
        id: 'c3',
        name: 'Aesthetic Reset',
        handle: '@aesthetic.reset',
        platform: 'instagram',
        followers: '215K',
        engagement: '8.2%',
        virality: '8.9/10',
        bio: 'Calm slow mornings, ice facial therapies, and mental clarity logs.',
        posts: [
          { id: 'p12_1', topic: 'Glass Skin Skincare Routine', title: 'A slow morning: Cold plunge, facial massage, digital detox diary.', views: '1.8M', likes: '110K', engagement: '9.2%' },
          { id: 'p12_2', topic: 'AIGC Lifestyle POV Skits', title: 'How ice rolling and cold therapy cured my morning facial puffiness.', views: '610K', likes: '42K', engagement: '7.9%' }
        ]
      }
    ]
  };

  const BLUEPRINT_TEMPLATES = {
    '#Zone2Cardio': {
      score: 91,
      positioning: { promise: 'Optimizing physical longevity via unhurried, scientifically-grounded active coaching.', emotional: 'Empowered, calm, scientific confidence in personal biology.' },
      topicDNA: { clusters: 'Zone 2 Metabolic Science (40%), Low-stress Recovery (30%), Heart Rate Tech (30%)', evergreen: 'What is aerobic base?', trend: 'Zone 2 vs HIIT for stress management' },
      outliers: 'HIIT Spikes Cortisol video (1.8M views vs 20K avg) — leveraged wellness fatigue.',
      titleFormulas: 'Why 90% of Cardio is [Mistake] (And the [Number]-Minute Fix)',
      thumbnailDNA: 'Calm ocean/trail scenery, cyan-blue tones, minimal text overlay (3-4 words).',
      hookStructure: '"You are probably destroying your metabolism by working out too hard..." (0-12s pattern interrupt).',
      scriptArch: '0-15s Hook ➔ 15-45s Biological Mythbusting ➔ 45-90s Practical Formula ➔ 90-120s Call to Action.',
      tonePacing: 'Measured, friendly authority, 135 words per minute. Dry, supportive humor.',
      contentGaps: 'Zone 2 meal pairing guides, wearable tech calibration tutorials for older demographics.'
    },
    'Cortisol-Conscious Gym': {
      score: 88,
      positioning: { promise: 'Low-stress, high-efficacy routines for hormone-balanced physical health.', emotional: 'Stress-free, grounded fitness validation.' },
      topicDNA: { clusters: 'Hormonal Health (50%), Adrenal Fitness (30%), Anti-burnout Coaching (20%)', evergreen: 'Signs your workout is raising stress', trend: 'Low-impact muscle gains' },
      outliers: 'Why I quit intense CrossFit video (1.2M views) — tapped into extreme workout burnout.',
      titleFormulas: 'Stop Doing [Popular Workout]. Try [New Routine] Instead.',
      thumbnailDNA: 'Soft interior gym setting, pink/violet gradient accents, zero screaming faces.',
      hookStructure: '"If you are constantly exhausted after the gym, your routine is backfiring..."',
      scriptArch: '0-15s Exhaustion Hook ➔ 15-50s Adrenal/Cortisol Explanation ➔ 50-100s Low-Impact Substitution ➔ 100-120s Calm CTA.',
      tonePacing: 'Deep, calm, reassuring. Slow cadence, clear science terms simplified.',
      contentGaps: 'Cortisol-safe cardio, morning active stretching guides.'
    },
    'Local LLMs (Llama 3/Ollama)': {
      score: 95,
      positioning: { promise: 'Democratizing AI power by putting open-source cutting-edge tech onto private laptops.', emotional: 'Technological self-reliance, hacker excitement.' },
      topicDNA: { clusters: 'Open-Source AI (45%), Private Deployment (35%), GPU Optimization (20%)', evergreen: 'How to install Ollama', trend: 'Running Llama 3 locally' },
      outliers: 'Running Llama 3 on an old Macbook video (2.4M views) — high accessibility hook.',
      titleFormulas: 'I Ran [Frontier Model] Locally. It Changed Everything.',
      thumbnailDNA: 'Dark terminal screen, neon green/indigo code glows, high contrast bold labels.',
      hookStructure: '"Stop paying OpenAI for data leaks. You can run this model locally for $0..."',
      scriptArch: '0-15s Financial/Privacy Hook ➔ 15-45s Installation commands ➔ 45-100s Speed benchmarks ➔ 100-120s Next steps.',
      tonePacing: 'Fast-paced, highly analytical, exuding technical expertise. 165 words per minute.',
      contentGaps: 'Local model fine-tuning step-by-steps, voice assistant integrations.'
    },
    'Autonomous Coding Agents': {
      score: 94,
      positioning: { promise: '10x software leverage by letting autonomous AI engines write production code.', emotional: 'Mind-blown, forward-thinking tech command.' },
      topicDNA: { clusters: 'Autonomous Systems (40%), Agentic Architecture (30%), AI Engineering (30%)', evergreen: 'What is an AI agent?', trend: 'Building custom coder agents' },
      outliers: 'Building a coder agent in 30 lines of code (1.5M views) — extreme simplicity framing.',
      titleFormulas: 'I Built an AI Agent in [Number] Lines of Code (Full Blueprint)',
      thumbnailDNA: 'Minimalist canvas, glowing agent connection lines, schematic icons.',
      hookStructure: '"This single script replaced my junior software developer..."',
      scriptArch: '0-15s Disruptive Claim ➔ 15-60s Code walkthrough ➔ 60-100s Live demo execution ➔ 100-120s Repo link.',
      tonePacing: 'Confident, precise, highly informative. Energetic tech delivery.',
      contentGaps: 'Multi-agent testing frameworks, local code debugger agents.'
    },
    'Quiet Luxury / Old Money': {
      score: 93,
      positioning: { promise: 'Cultivating elevated elegance and subtle style command through logo-less sophistication.', emotional: 'Refined, aspirational, classy self-expression.' },
      topicDNA: { clusters: 'Minimalist Wardrobe (45%), Quality Materials (35%), Heritage Brands (20%)', evergreen: 'Essential capsule wardrobe layers', trend: 'How to spot cheap fabric' },
      outliers: 'Looking expensive with zero logos video (3.2M views) — accessible prestige hook.',
      titleFormulas: 'How to Look Expensive Without a Single Logo (My 5 Rules)',
      thumbnailDNA: 'Sleek linen/cashmere details, warm beige/gold color tones, clean elegant serif text.',
      hookStructure: '"Wearing big logos is actually the easiest way to look cheap. Here is what billionaires wear instead..."',
      scriptArch: '0-15s Anti-logo Pattern Interrupt ➔ 15-50s Fabric & drape analysis ➔ 50-100s Outfit comparisons ➔ 100-120s Brand brief.',
      tonePacing: 'Sleek, poise, soft-spoken but deeply confident. Slow pacing, meticulous styling.',
      contentGaps: 'Affordable quiet luxury dupes, caring for heritage wool/linen fabrics.'
    },
    'Bilingual Fashion GRWM': {
      score: 92,
      positioning: { promise: 'Global fashion fusion showing how to blend MENA culture with modern Western haute couture.', emotional: 'Cultural pride, elite styling aesthetic.' },
      topicDNA: { clusters: 'East-West Fusion (40%), Cinematic Transitions (30%), Event Styling (30%)', evergreen: 'Modest luxury draping styles', trend: 'Dubai gallery openings OOTD' },
      outliers: 'Dubai gallery opening GRWM video (1.9M views) — visual luxury ASMR cuts.',
      titleFormulas: 'Bilingual GRWM: Styling [Style] for [Glamorous Event] in Dubai',
      thumbnailDNA: 'Dynamic outfit reveal slide, high-end warm interior lighting, glowing jewelry accents.',
      hookStructure: '"Let\'s style a modest couture look for a high-end art event in Dubai tonight..."',
      scriptArch: '0-15s Event Intro / ASMR robe drop ➔ 15-50s Layering fabrics ➔ 50-100s Jewelry/Heels styling ➔ 100-120s Arabic closeout.',
      tonePacing: 'Warm, highly charismatic, bilingual (fluent EN/AR transitions). High elegance.',
      contentGaps: 'Modest summer desert fabrics, boutique designer spotlights.'
    },
    'Glass Skin Skincare Routine': {
      score: 96,
      positioning: { promise: 'Achieving luminous, intensely hydrated facial skin through hyper-disciplined skincare rituals.', emotional: 'Obsessively clean, deeply satisfied aesthetic glow.' },
      topicDNA: { clusters: 'Glass Skin Routine (50%), Korean Product DNA (30%), Skin Barrier (20%)', evergreen: 'How to layer toners', trend: '7 skin method explained' },
      outliers: 'My skin barrier was ruined. This 5-step saved it video (4.1M views) — high vulnerability.',
      titleFormulas: 'The Exact [Number]-Step Routine for Viral Glass Skin (No Filter)',
      thumbnailDNA: 'Dewy close-up skin texture, clean white/pastel purple styling, hydration drop motifs.',
      hookStructure: '"Stop buying expensive makeup to hide your dry skin. Do this 5-step hydration ritual instead..."',
      scriptArch: '0-15s Skin Glow Showoff ➔ 15-60s Product applying ASMR ➔ 60-100s Ingredient explanation ➔ 100-120s Direct skin check.',
      tonePacing: 'Relatable, energetic, Gen-Z native with rhythmic vocal fries and beauty excitement.',
      contentGaps: 'Glass skin for oily skin types, budget-friendly Korean toners.'
    },
    'AIGC Lifestyle POV Skits': {
      score: 95,
      positioning: { promise: 'Exploring hyper-realistic virtual creator lifestyle through engaging gen-z POV skits.', emotional: 'Mind-boggling tech curiosity, highly relatable Gen-Z humor.' },
      topicDNA: { clusters: 'AI Creator POV (45%), Gen-Z Slang Skits (35%), Beauty Hacks (20%)', evergreen: 'Day in my life as a virtual girl', trend: 'My AI roommate drama' },
      outliers: 'POV: Your AI roommate takes over your routine video (5.2M views) — meta-narrative appeal.',
      titleFormulas: 'POV: [Relatable Situation] as an AI Creator (It Got Weird)',
      thumbnailDNA: 'Hyper-realistic avatar face, subtle cyber glow details, neon pink/purple lighting.',
      hookStructure: '"POV: Your AI creator roommate forgot she is on camera and does this..."',
      scriptArch: '0-15s Bizarre POV Hook ➔ 15-60s Hilarious skit monologue ➔ 60-100s Realistic routine ASMR ➔ 100-120s Outro teaser.',
      tonePacing: 'Hyper-fluent Gen-Z speech, deadpan delivery, rapid-fire humor pacing.',
      contentGaps: 'AI creator bloopers/how-it\'s-made, styling virtual wardrobe tutorials.'
    }
  };

  function init(containerId) {
    container = document.getElementById(containerId);
    if (!container) return;
    
    // Default active agent based on starting niche
    const currentNicheDef = NICHES.find(n => n.id === state.niche);
    state.agent = currentNicheDef ? currentNicheDef.agent : '@sofiarivera.ai';

    injectStyles();
    render();
  }

  function injectStyles() {
    if (document.getElementById('intel-wizard-styles')) return;
    const style = document.createElement('style');
    style.id = 'intel-wizard-styles';
    style.textContent = `
      .wiz-container {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
        background: rgba(15, 23, 42, 0.35);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 1.75rem;
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        color: var(--text);
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      }

      /* Stepper */
      .wiz-stepper {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 1rem;
        margin-bottom: 1rem;
        position: relative;
      }
      .wiz-stepper::before {
        content: '';
        position: absolute;
        top: 24px;
        left: 4rem;
        right: 4rem;
        height: 2px;
        background: rgba(255,255,255,0.08);
        z-index: 1;
      }
      .wiz-stepper-progress {
        position: absolute;
        top: 24px;
        left: 4rem;
        height: 2px;
        background: linear-gradient(90deg, var(--accent) 0%, #a78bfa 100%);
        z-index: 2;
        transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .wiz-step-node {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        z-index: 3;
        position: relative;
        cursor: pointer;
        width: 80px;
      }
      .wiz-step-circle {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: #1e293b;
        border: 2px solid rgba(255,255,255,0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 1rem;
        transition: all 0.3s ease;
        color: var(--text-dim);
        box-shadow: 0 4px 10px rgba(0,0,0,0.3);
      }
      .wiz-step-node.active .wiz-step-circle {
        background: var(--accent);
        border-color: var(--accent);
        color: #fff;
        box-shadow: 0 0 15px rgba(99, 102, 241, 0.5);
        transform: scale(1.1);
      }
      .wiz-step-node.completed .wiz-step-circle {
        background: #10b981;
        border-color: #10b981;
        color: #fff;
        box-shadow: 0 0 10px rgba(16, 185, 129, 0.3);
      }
      .wiz-step-label {
        font-size: 0.72rem;
        font-weight: 500;
        text-align: center;
        color: var(--text-dim);
        transition: color 0.3s;
        white-space: nowrap;
      }
      .wiz-step-node.active .wiz-step-label {
        color: var(--text);
        font-weight: 600;
      }
      .wiz-step-node.completed .wiz-step-label {
        color: #10b981;
      }

      /* Step Views Content */
      .wiz-content {
        min-height: 420px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }

      /* Niche Select Grid */
      .wiz-niche-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        margin-top: 1rem;
      }
      .wiz-niche-card {
        background: rgba(30, 41, 59, 0.4);
        border: 1px solid rgba(255,255,255,0.05);
        border-radius: 12px;
        padding: 1.25rem;
        display: flex;
        align-items: center;
        gap: 1rem;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .wiz-niche-card:hover {
        transform: translateY(-3px);
        background: rgba(30, 41, 59, 0.75);
        box-shadow: 0 8px 20px rgba(0,0,0,0.3);
      }
      .wiz-niche-card.active {
        border-color: var(--accent);
        background: rgba(99, 102, 241, 0.1);
        box-shadow: 0 0 15px rgba(99, 102, 241, 0.15);
      }
      .wiz-niche-icon {
        width: 44px;
        height: 44px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
        background: rgba(255,255,255,0.05);
      }

      /* Keyword Trends Grid */
      .wiz-trend-title {
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--text-dim);
        margin: 1.5rem 0 0.5rem 0;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .wiz-trends-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1rem;
      }
      .wiz-trend-card {
        background: rgba(30, 41, 59, 0.3);
        border: 1px solid rgba(255,255,255,0.04);
        border-radius: 12px;
        padding: 1.15rem;
        cursor: pointer;
        transition: all 0.3s ease;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 0.75rem;
        position: relative;
        overflow: hidden;
      }
      .wiz-trend-card::before {
        content: '';
        position: absolute;
        top: 0; left: 0; width: 3px; height: 100%;
        background: transparent;
        transition: background 0.3s;
      }
      .wiz-trend-card:hover {
        background: rgba(30, 41, 59, 0.6);
        transform: translateY(-2px);
        box-shadow: 0 6px 15px rgba(0,0,0,0.25);
      }
      .wiz-trend-card.active {
        border-color: rgba(99,102,241,0.4);
        background: rgba(99,102,241,0.05);
      }
      .wiz-trend-card.active::before {
        background: var(--accent);
      }
      .wiz-trend-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .wiz-trend-topic {
        font-size: 1.1rem;
        font-weight: 700;
        color: #fff;
      }
      .wiz-trend-growth {
        font-size: 0.75rem;
        font-weight: 700;
        padding: 0.2rem 0.5rem;
        border-radius: 100px;
        background: rgba(16, 185, 129, 0.15);
        color: #10b981;
        box-shadow: 0 0 10px rgba(16, 185, 129, 0.1);
      }
      .wiz-trend-volume {
        font-size: 0.75rem;
        color: var(--text-dim);
        font-weight: 500;
      }
      .wiz-trend-desc {
        font-size: 0.8rem;
        color: rgba(255,255,255,0.6);
        line-height: 1.4;
      }
      .wiz-platform-tag {
        font-size: 0.65rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        background: rgba(255,255,255,0.05);
        padding: 0.15rem 0.4rem;
        border-radius: 4px;
        color: var(--text-dim);
      }
      .wiz-platform-tag.tiktok { background: rgba(0,242,234,0.1); color: #00f2ea; }
      .wiz-platform-tag.instagram { background: rgba(225,48,108,0.1); color: #e1306c; }
      .wiz-platform-tag.youtube { background: rgba(255,0,0,0.1); color: #ff0000; }
      .wiz-platform-tag.x { background: rgba(255,255,255,0.1); color: #fff; }

      /* Step 2: Scout Creator Cards */
      .wiz-scout-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 1.25rem;
        margin-top: 1rem;
      }
      .wiz-creator-card {
        background: rgba(30, 41, 59, 0.35);
        border: 1px solid rgba(255,255,255,0.05);
        border-radius: 14px;
        padding: 1.35rem;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        flex-direction: column;
        gap: 1rem;
        position: relative;
      }
      .wiz-creator-card:hover {
        transform: translateY(-4px);
        background: rgba(30, 41, 59, 0.7);
        border-color: rgba(255,255,255,0.1);
        box-shadow: 0 10px 25px rgba(0,0,0,0.3);
      }
      .wiz-creator-card.active {
        border-color: var(--accent);
        background: rgba(99, 102, 241, 0.08);
        box-shadow: 0 0 20px rgba(99, 102, 241, 0.15);
      }
      .wiz-creator-head {
        display: flex;
        align-items: center;
        gap: 0.85rem;
      }
      .wiz-creator-avatar {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--accent) 0%, #a78bfa 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 1.15rem;
        color: #fff;
        border: 2px solid rgba(255,255,255,0.1);
      }
      .wiz-creator-meta {
        display: flex;
        flex-direction: column;
      }
      .wiz-creator-name {
        font-weight: 600;
        color: #fff;
        font-size: 0.95rem;
      }
      .wiz-creator-handle {
        font-size: 0.75rem;
        color: var(--text-dim);
      }
      .wiz-creator-stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        background: rgba(0,0,0,0.15);
        border-radius: 8px;
        padding: 0.5rem 0.25rem;
        text-align: center;
        font-size: 0.8rem;
      }
      .wiz-stat-label {
        color: var(--text-dim);
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 0.15rem;
      }
      .wiz-stat-val {
        font-weight: 700;
        color: #fff;
      }
      .wiz-viral-post {
        background: rgba(255,255,255,0.03);
        border-left: 3px solid var(--accent);
        padding: 0.6rem 0.75rem;
        border-radius: 0 6px 6px 0;
        font-size: 0.78rem;
        line-height: 1.4;
        font-style: italic;
        color: rgba(255,255,255,0.85);
      }

      /* Step 3: Laser scan animation */
      .wiz-scan-box {
        background: rgba(15, 23, 42, 0.6);
        border: 1px dashed rgba(99, 102, 241, 0.4);
        border-radius: 12px;
        padding: 3rem 2rem;
        text-align: center;
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1.5rem;
        min-height: 350px;
      }
      .wiz-scan-bar {
        position: absolute;
        top: 0; left: 0; width: 100%; height: 4px;
        background: linear-gradient(90deg, transparent 10%, var(--accent) 50%, transparent 90%);
        box-shadow: 0 0 15px var(--accent);
        animation: laserScan 2.5s infinite linear;
      }
      @keyframes laserScan {
        0% { top: 0%; }
        50% { top: 100%; }
        100% { top: 0%; }
      }
      .wiz-scan-spinner {
        width: 60px;
        height: 60px;
        border: 3px solid rgba(99,102,241,0.1);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: spin 1s infinite linear;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      .wiz-scan-logs {
        font-family: monospace;
        font-size: 0.78rem;
        color: #10b981;
        background: rgba(0,0,0,0.4);
        padding: 1rem;
        border-radius: 8px;
        width: 100%;
        max-width: 500px;
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        box-shadow: inset 0 0 10px rgba(0,0,0,0.5);
      }

      /* Step 3 Scorecard Output */
      .wiz-score-wrapper {
        display: grid;
        grid-template-columns: 280px 1fr;
        gap: 1.5rem;
        margin-top: 1rem;
      }
      .wiz-score-sidebar {
        background: rgba(30, 41, 59, 0.4);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 14px;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1.25rem;
        text-align: center;
      }
      .wiz-score-ring-wrap {
        position: relative;
        width: 140px;
        height: 140px;
      }
      .wiz-score-circle-svg {
        transform: rotate(-90deg);
        width: 140px;
        height: 140px;
      }
      .wiz-score-circle-bg {
        fill: none;
        stroke: rgba(255,255,255,0.05);
        stroke-width: 10;
      }
      .wiz-score-circle-progress {
        fill: none;
        stroke: linear-gradient(135deg, var(--accent) 0%, #a78bfa 100%);
        stroke-width: 10;
        stroke-linecap: round;
        stroke-dasharray: 377;
        stroke-dashoffset: 40; /* modified by JS */
        transition: stroke-dashoffset 1s ease-out;
      }
      .wiz-score-number {
        position: absolute;
        top: 0; left: 0; width: 100%; height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }
      .wiz-score-num {
        font-size: 2.2rem;
        font-weight: 800;
        color: #fff;
        line-height: 1;
      }
      .wiz-score-lbl {
        font-size: 0.65rem;
        color: var(--text-dim);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-top: 2px;
      }

      /* Scorecard layers details */
      .wiz-layers-accordion {
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
        max-height: 480px;
        overflow-y: auto;
        padding-right: 0.5rem;
      }
      .wiz-layers-accordion::-webkit-scrollbar {
        width: 6px;
      }
      .wiz-layers-accordion::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.1);
        border-radius: 10px;
      }
      .wiz-layer-item {
        background: rgba(30, 41, 59, 0.25);
        border: 1px solid rgba(255,255,255,0.04);
        border-radius: 10px;
        overflow: hidden;
        transition: border-color 0.3s;
      }
      .wiz-layer-item:hover {
        border-color: rgba(255,255,255,0.08);
      }
      .wiz-layer-header {
        padding: 0.75rem 1rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        background: rgba(30, 41, 59, 0.15);
      }
      .wiz-layer-title-box {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        font-weight: 600;
        font-size: 0.85rem;
        color: #fff;
      }
      .wiz-layer-desc-brief {
        font-size: 0.78rem;
        color: var(--text-dim);
        max-width: 60%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .wiz-layer-body {
        padding: 1rem;
        background: rgba(15, 23, 42, 0.4);
        border-top: 1px solid rgba(255,255,255,0.03);
        font-size: 0.82rem;
        line-height: 1.5;
        color: rgba(255,255,255,0.8);
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      /* Step 4 Agent Training Capsules */
      .wiz-agents-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 1.25rem;
        margin-top: 1rem;
      }
      .wiz-agent-card {
        background: rgba(30, 41, 59, 0.3);
        border: 1px solid rgba(255,255,255,0.04);
        border-radius: 16px;
        padding: 1.25rem;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.85rem;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        overflow: hidden;
      }
      .wiz-agent-card::after {
        content: '';
        position: absolute;
        top: 0; left: 0; width: 100%; height: 4px;
        background: transparent;
      }
      .wiz-agent-card:hover {
        transform: translateY(-4px);
        background: rgba(30, 41, 59, 0.6);
        box-shadow: 0 10px 20px rgba(0,0,0,0.3);
      }
      .wiz-agent-card.active {
        border-color: var(--accent);
        background: rgba(99, 102, 241, 0.08);
      }
      .wiz-agent-card.active::after {
        background: linear-gradient(90deg, var(--accent) 0%, #a78bfa 100%);
      }
      .wiz-agent-av {
        width: 64px;
        height: 64px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        font-size: 1.5rem;
        color: #fff;
        border: 3px solid rgba(255,255,255,0.08);
        box-shadow: 0 4px 15px rgba(0,0,0,0.4);
      }
      .wiz-agent-name {
        font-weight: 700;
        color: #fff;
        font-size: 1rem;
      }
      .wiz-agent-niche {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-weight: 600;
        padding: 0.15rem 0.5rem;
        border-radius: 100px;
        background: rgba(255,255,255,0.05);
        color: var(--text-dim);
      }
      .wiz-agent-badge-trained {
        font-size: 0.68rem;
        font-weight: 700;
        color: #10b981;
        background: rgba(16, 185, 129, 0.12);
        padding: 0.15rem 0.5rem;
        border-radius: 100px;
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin-top: 0.25rem;
      }

      /* Training Load Grid overlay */
      .wiz-training-box {
        background: rgba(15, 23, 42, 0.7);
        border: 1px dashed #10b981;
        border-radius: 14px;
        padding: 3rem 2rem;
        text-align: center;
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1.5rem;
        min-height: 350px;
      }
      .wiz-matrix-loader {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0.5rem;
        width: 120px;
      }
      .wiz-matrix-bar {
        height: 40px;
        background: rgba(16, 185, 129, 0.15);
        border-radius: 3px;
        position: relative;
        overflow: hidden;
      }
      .wiz-matrix-bar::after {
        content: '';
        position: absolute;
        bottom: 0; left: 0; width: 100%; height: 0%;
        background: #10b981;
        box-shadow: 0 0 10px #10b981;
        animation: matrixFill 1.8s infinite ease-in-out;
      }
      .wiz-matrix-bar:nth-child(2)::after { animation-delay: 0.3s; }
      .wiz-matrix-bar:nth-child(3)::after { animation-delay: 0.6s; }
      .wiz-matrix-bar:nth-child(4)::after { animation-delay: 0.9s; }
      @keyframes matrixFill {
        0%, 100% { height: 0%; }
        50% { height: 100%; }
      }

      /* Step 5 Studio launchpad content drafts */
      .wiz-studio-grid {
        display: grid;
        grid-template-columns: 1.2fr 1fr;
        gap: 1.5rem;
        margin-top: 1rem;
      }
      .wiz-draft-section {
        background: rgba(30, 41, 59, 0.4);
        border: 1px solid rgba(255,255,255,0.05);
        border-radius: 14px;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .wiz-draft-card {
        background: rgba(15, 23, 42, 0.45);
        border: 1px solid rgba(255,255,255,0.03);
        border-radius: 10px;
        padding: 1.15rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .wiz-draft-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid rgba(255,255,255,0.04);
        padding-bottom: 0.5rem;
      }
      .wiz-draft-tag {
        font-size: 0.7rem;
        font-weight: 700;
        padding: 0.2rem 0.5rem;
        border-radius: 4px;
        background: rgba(99,102,241,0.15);
        color: #a5b4fc;
        text-transform: uppercase;
      }
      .wiz-draft-body {
        font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-size: 0.82rem;
        line-height: 1.5;
        color: rgba(255,255,255,0.9);
        white-space: pre-wrap;
        background: rgba(0,0,0,0.2);
        padding: 0.85rem;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.02);
      }
      .wiz-draft-actions {
        display: flex;
        gap: 0.75rem;
      }
      .wiz-actions-sidebar {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .wiz-action-capsule {
        background: rgba(30, 41, 59, 0.3);
        border: 1px solid rgba(255,255,255,0.04);
        border-radius: 14px;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        transition: all 0.3s;
      }
      .wiz-action-capsule:hover {
        border-color: rgba(255,255,255,0.08);
        background: rgba(30, 41, 59, 0.45);
      }
      .wiz-action-title {
        font-weight: 700;
        font-size: 0.95rem;
        color: #fff;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .wiz-action-desc {
        font-size: 0.78rem;
        color: var(--text-dim);
        line-height: 1.4;
      }

      /* Buttons & Toolbar bottom */
      .wiz-toolbar-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-top: 1px solid rgba(255,255,255,0.05);
        padding-top: 1.25rem;
        margin-top: 1rem;
      }
      .wiz-btn {
        padding: 0.65rem 1.25rem;
        font-size: 0.85rem;
        font-weight: 600;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.3s ease;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        border: 1px solid transparent;
      }
      .wiz-btn-primary {
        background: linear-gradient(135deg, var(--accent) 0%, #a78bfa 100%);
        color: #fff;
        box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
      }
      .wiz-btn-primary:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4);
      }
      .wiz-btn-secondary {
        background: rgba(255,255,255,0.05);
        border-color: rgba(255,255,255,0.08);
        color: #fff;
      }
      .wiz-btn-secondary:hover:not(:disabled) {
        background: rgba(255,255,255,0.1);
      }
      .wiz-btn-success {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: #fff;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);
      }
      .wiz-btn-success:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(16, 185, 129, 0.35);
      }
      .wiz-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `;
    document.head.appendChild(style);
  }

  function render() {
    if (!container) return;

    const progressWidth = ((currentStep - 1) / 5) * 100;

    container.innerHTML = `
      <div class="wiz-container">
        <!-- Wizard Header -->
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h2 class="section-title" style="margin-bottom:0.25rem; font-size:1.5rem;">🔮 Content Intelligence Wizard</h2>
            <p class="section-lead" style="margin-bottom:0;">End-to-End autonomous creator funnel: Trend ➔ Channel ➔ Scout ➔ Decode ➔ Train Agent ➔ Studio</p>
          </div>
          <button class="wiz-btn wiz-btn-secondary" onclick="IntelWizard.resetWizard()" style="padding:0.4rem 0.8rem; font-size:0.75rem;">
            🔄 Restart Journey
          </button>
        </div>

        <!-- Sleek Glassmorphic Stepper -->
        <div class="wiz-stepper">
          <div class="wiz-stepper-progress" style="width: ${progressWidth}%"></div>
          
          <div class="wiz-step-node ${currentStep === 1 ? 'active' : ''} ${currentStep > 1 ? 'completed' : ''}" onclick="IntelWizard.goToStep(1)">
            <div class="wiz-step-circle">📈</div>
            <div class="wiz-step-label">1. Trend</div>
          </div>

          <div class="wiz-step-node ${currentStep === 2 ? 'active' : ''} ${currentStep > 2 ? 'completed' : ''}" onclick="state.trend ? IntelWizard.goToStep(2) : null">
            <div class="wiz-step-circle">📡</div>
            <div class="wiz-step-label">2. Channel</div>
          </div>

          <div class="wiz-step-node ${currentStep === 3 ? 'active' : ''} ${currentStep > 3 ? 'completed' : ''}" onclick="state.competitor ? IntelWizard.goToStep(3) : null">
            <div class="wiz-step-circle">🔍</div>
            <div class="wiz-step-label">3. Scout</div>
          </div>

          <div class="wiz-step-node ${currentStep === 4 ? 'active' : ''} ${currentStep > 4 ? 'completed' : ''}" onclick="state.post ? IntelWizard.goToStep(4) : null">
            <div class="wiz-step-circle">🔬</div>
            <div class="wiz-step-label">4. Decoder</div>
          </div>

          <div class="wiz-step-node ${currentStep === 5 ? 'active' : ''} ${currentStep > 5 ? 'completed' : ''}" onclick="state.post ? IntelWizard.goToStep(5) : null">
            <div class="wiz-step-circle">🧬</div>
            <div class="wiz-step-label">5. Feed Agent</div>
          </div>

          <div class="wiz-step-node ${currentStep === 6 ? 'active' : ''} ${currentStep > 6 ? 'completed' : ''}" onclick="state.drafts ? IntelWizard.goToStep(6) : null">
            <div class="wiz-step-circle">⚡</div>
            <div class="wiz-step-label">6. Content</div>
          </div>
        </div>

        <!-- Render active step content -->
        <div class="wiz-content">
          ${renderStepContent()}
          
          <!-- Footer Buttons -->
          <div class="wiz-toolbar-footer">
            <div>
              ${currentStep > 1 ? `
                <button class="wiz-btn wiz-btn-secondary" onclick="IntelWizard.prevStep()">
                  ← Back
                </button>
              ` : ''}
            </div>
            <div>
              ${renderNextButton()}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderStepContent() {
    switch (currentStep) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
      case 5: return renderStep5();
      case 6: return renderStep6();
      default: return '';
    }
  }

  function renderNextButton() {
    if (currentStep === 1) {
      return `
        <button class="wiz-btn wiz-btn-primary" onclick="IntelWizard.nextStep()" ${!state.trend ? 'disabled' : ''}>
          Find competitor channels →
        </button>
      `;
    }
    if (currentStep === 2) {
      return `
        <button class="wiz-btn wiz-btn-primary" onclick="IntelWizard.nextStep()" ${!state.competitor ? 'disabled' : ''}>
          Scout channel feed →
        </button>
      `;
    }
    if (currentStep === 3) {
      return `
        <button class="wiz-btn wiz-btn-primary" onclick="IntelWizard.nextStep()" ${!state.post ? 'disabled' : ''}>
          Decode Selected Content →
        </button>
      `;
    }
    if (currentStep === 4) {
      if (state.isScanning) return '';
      return `
        <button class="wiz-btn wiz-btn-primary" onclick="IntelWizard.nextStep()">
          Train AI Agent →
        </button>
      `;
    }
    if (currentStep === 5) {
      if (state.isTraining) return '';
      return `
        <button class="wiz-btn wiz-btn-primary" onclick="IntelWizard.nextStep()" ${!state.trainingComplete ? 'disabled' : ''}>
          Content Studio Stages →
        </button>
      `;
    }
    return ''; // Step 6 has custom actions
  }

  // ────────────────────────────────────────
  // STEP 1: Trends & Keyword Picker
  // ────────────────────────────────────────
  function renderStep1() {
    const activeNicheDef = NICHES.find(n => n.id === state.niche);
    const trends = TREND_DATA[state.niche] || [];

    return `
      <div>
        <h3 style="margin-top:0; font-size:1.1rem; font-weight:700;">1. Trend Discovery — Pick Niche & Topic</h3>
        <p style="font-size:0.85rem; color:var(--text-dim); margin-bottom:1rem;">
          Select a niche to scan viral spikes, then select a trending keyword to search competitor channels.
        </p>

        <!-- Niche Pickers -->
        <div class="wiz-niche-grid">
          ${NICHES.map(n => `
            <div class="wiz-niche-card ${state.niche === n.id ? 'active' : ''}" onclick="IntelWizard.selectNiche('${n.id}')">
              <div class="wiz-niche-icon" style="color:${n.color}; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.04);">${n.icon}</div>
              <div>
                <div style="font-weight:700; font-size:0.92rem; color:#fff;">${n.label}</div>
                <div style="font-size:0.75rem; color:var(--text-dim);">Driven by ${n.agent.split('@')[1]}</div>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Keyword Grid -->
        <div class="wiz-trend-title">
          <span>⚡ Trending Now in ${activeNicheDef?.label}</span>
        </div>
        <div class="wiz-trends-grid">
          ${trends.map(t => `
            <div class="wiz-trend-card ${state.trend?.id === t.id ? 'active' : ''}" onclick="IntelWizard.selectTrend('${t.id}')">
              <div class="wiz-trend-header">
                <span class="wiz-trend-topic">${t.topic}</span>
                <span class="wiz-trend-growth">${t.growth} Growth</span>
              </div>
              <p class="wiz-trend-desc">${t.desc}</p>
              <div class="wiz-trend-header" style="margin-top:0.25rem;">
                <span class="wiz-trend-volume">🔥 ${t.volume} weekly searches</span>
                <span class="wiz-platform-tag ${t.platform}">${t.platform}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ────────────────────────────────────────
  // STEP 2: Channel Explorer (Select Competitor Creator)
  // ────────────────────────────────────────
  function renderStep2() {
    const competitors = COMPETITOR_DATA[state.niche] || [];
    return `
      <div>
        <h3 style="margin-top:0; font-size:1.1rem; font-weight:700;">2. Channel Explorer — Find Leading Competitors</h3>
        <p style="font-size:0.85rem; color:var(--text-dim); margin-bottom:1rem;">
          Select a competitor channel focused on <strong style="color:var(--accent);">${state.trend?.topic || 'the topic'}</strong>. We will scrape their media feed to locate organic outperformers.
        </p>

        <div class="wiz-scout-grid">
          ${competitors.map(c => `
            <div class="wiz-creator-card ${state.competitor?.id === c.id ? 'active' : ''}" onclick="IntelWizard.selectCompetitor('${c.id}')" style="cursor:pointer; transition:all 0.25s ease-in-out;">
              <div class="wiz-creator-head">
                <div class="wiz-creator-avatar" style="background:var(--accent-glow); border:1px solid var(--accent); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold; border-radius:50%; width:40px; height:40px;">${c.name.charAt(0)}</div>
                <div class="wiz-creator-meta">
                  <span class="wiz-creator-name" style="font-weight:700; color:#fff;">${c.name}</span>
                  <span class="wiz-creator-handle" style="font-size:0.75rem; color:var(--text-dim);">${c.handle}</span>
                </div>
                <span class="wiz-platform-tag ${c.platform}" style="margin-left:auto;">${c.platform}</span>
              </div>
              
              <div class="wiz-creator-stats" style="margin:1rem 0; padding:0.5rem 0; border-top:1px solid rgba(255,255,255,0.04); border-bottom:1px solid rgba(255,255,255,0.04); display:grid; grid-template-columns:repeat(3, 1fr); text-align:center;">
                <div>
                  <div class="wiz-stat-label" style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase;">Followers</div>
                  <div class="wiz-stat-val" style="font-weight:700; color:#fff; font-size:0.9rem; margin-top:2px;">${c.followers}</div>
                </div>
                <div>
                  <div class="wiz-stat-label" style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase;">Engagement</div>
                  <div class="wiz-stat-val" style="font-weight:700; color:#10b981; font-size:0.9rem; margin-top:2px;">${c.engagement}</div>
                </div>
                <div>
                  <div class="wiz-stat-label" style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase;">Virality</div>
                  <div class="wiz-stat-val" style="font-weight:700; color:var(--accent); font-size:0.9rem; margin-top:2px;">${c.virality}</div>
                </div>
              </div>

              <div>
                <div class="wiz-stat-label" style="margin-bottom:0.25rem; font-size:0.7rem; color:var(--text-dim); font-weight:600;">Channel Positioning</div>
                <p style="margin:0; font-size:0.78rem; color:var(--text-dim); line-height:1.4;">${c.bio}</p>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ────────────────────────────────────────
  // STEP 3: Social Scout (Find Winning Content)
  // ────────────────────────────────────────
  function renderStep3() {
    if (!state.competitor) {
      return `
        <div style="text-align:center; padding:3rem; color:var(--text-dim);">
          ⚠️ Please select a competitor channel in Step 2.
        </div>
      `;
    }
    const posts = state.competitor.posts || [];
    return `
      <div>
        <h3 style="margin-top:0; font-size:1.1rem; font-weight:700;">3. Social Scout — Find Winning Content</h3>
        <p style="font-size:0.85rem; color:var(--text-dim); margin-bottom:1rem;">
          Querying feed metrics of <strong style="color:var(--accent);">${state.competitor.name}</strong> to isolate high-retention post structures. Select a viral asset to reverse engineer.
        </p>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:1.25rem; margin-top:0.5rem;">
          ${posts.map(p => `
            <div class="wiz-creator-card ${state.post?.id === p.id ? 'active' : ''}" onclick="IntelWizard.selectPost('${p.id}')" style="cursor:pointer; display:flex; flex-direction:column; justify-content:space-between; min-height:160px; border:1px solid ${state.post?.id === p.id ? 'var(--accent)' : 'rgba(255,255,255,0.06)'}; padding:1.25rem; border-radius:12px; transition:all 0.25s ease-in-out;">
              <div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
                  <span class="wiz-draft-tag" style="background:rgba(99, 102, 241, 0.1); color:var(--accent); border:1px solid rgba(99, 102, 241, 0.2); font-size:0.65rem; padding:2px 8px; border-radius:12px; font-weight:600;">${p.topic}</span>
                  <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600;">🔥 ${p.views} views</span>
                </div>
                <div class="wiz-viral-post" style="font-size:0.85rem; color:#fff; line-height:1.5; font-style:normal; margin-bottom:1rem; border-left:2px solid var(--accent); padding-left:10px;">"${p.title}"</div>
              </div>
              
              <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid rgba(255,255,255,0.04); padding-top:0.75rem; margin-top:auto;">
                <span style="font-size:0.72rem; color:var(--text-dim);">Organic Engagement Rate</span>
                <span style="font-size:0.8rem; font-weight:700; color:#10b981;">${p.engagement}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ────────────────────────────────────────
  // STEP 4: Channel Decoder (Holographic Scan + 9-Layers)
  // ────────────────────────────────────────
  function renderStep4() {
    if (state.isScanning) {
      return `
        <div class="wiz-scan-box">
          <div class="wiz-scan-bar"></div>
          <div class="wiz-scan-spinner"></div>
          <div style="display:flex; flex-direction:column; gap:0.25rem;">
            <h4 style="margin:0; font-size:1.1rem; color:#fff; font-weight:700;">Scanning Competing Content...</h4>
            <p style="margin:0; font-size:0.8rem; color:var(--text-dim);">Reverse-engineering organic transcripts, visual anchors, and audio cues</p>
          </div>
          <div class="wiz-scan-logs" id="wiz-scan-logs-container">
            <div>[CONNECTING] Querying Social Scout APIs for ${state.competitor?.handle}...</div>
          </div>
        </div>
      `;
    }

    const bpKey = state.post?.topic || state.trend?.topic || '';
    const bp = BLUEPRINT_TEMPLATES[bpKey] || {
      score: 85,
      positioning: { promise: 'General Niche Value', emotional: 'Informed organic interest' },
      topicDNA: { clusters: 'Niche core (100%)', evergreen: 'Niche intro', trend: 'Niche trend' },
      outliers: 'Average content performance',
      titleFormulas: 'How to excel in ' + (state.post?.topic || state.trend?.topic || 'UGC'),
      thumbnailDNA: 'Clean topic representation',
      hookStructure: 'Intimate question opening.',
      scriptArch: 'Normal script layout.',
      tonePacing: 'Informative, calm pacing.',
      contentGaps: 'Advanced deep-dives.'
    };

    return `
      <div>
        <h3 style="margin-top:0; font-size:1.1rem; font-weight:700;">4. Channel Decoder — 9-Layer Blueprint Scorecard</h3>
        <p style="font-size:0.85rem; color:var(--text-dim); margin-bottom:1rem;">
          Reverse-engineering successful structural elements of <span style="color:var(--accent);">${state.competitor?.name}</span>'s content into a replicable model.
        </p>

        <div class="wiz-score-wrapper">
          <!-- Circular Progress Sidebar -->
          <div class="wiz-score-sidebar">
            <h4 style="margin:0; font-size:0.9rem; font-weight:700; color:#fff;">Content Scorecard</h4>
            
            <div class="wiz-score-ring-wrap">
              <svg class="wiz-score-circle-svg">
                <circle class="wiz-score-circle-bg" cx="70" cy="70" r="60"/>
                <circle class="wiz-score-circle-progress" id="wiz-score-progress-circle" cx="70" cy="70" r="60" style="stroke-dashoffset: ${377 - (377 * bp.score / 100)}"/>
              </svg>
              <div class="wiz-score-number">
                <span class="wiz-score-num">${bp.score}</span>
                <span class="wiz-score-lbl">Quality Index</span>
              </div>
            </div>

            <div style="font-size:0.75rem; color:var(--text-dim); line-height:1.4;">
              This competitor ranks in the <span style="color:#10b981; font-weight:700;">top 5%</span> of organic retention for ${state.trend?.topic}.
            </div>
            
            <button class="wiz-btn wiz-btn-primary" onclick="IntelWizard.nextStep()" style="width:100%; margin-top:auto;">
              ⚡ Feed Blueprint to Agent
            </button>
          </div>

          <!-- 9-Layer Accordion Grid -->
          <div class="wiz-layers-accordion">
            <div class="wiz-layer-item">
              <div class="wiz-layer-header" onclick="IntelWizard.toggleAccordion(this)">
                <span class="wiz-layer-title-box">🎯 Positioning Matrix</span>
                <span class="wiz-layer-desc-brief">${bp.positioning.promise}</span>
              </div>
              <div class="wiz-layer-body">
                <div><strong>Brand Promise:</strong> ${bp.positioning.promise}</div>
                <div><strong>Emotional Core:</strong> ${bp.positioning.emotional}</div>
              </div>
            </div>

            <div class="wiz-layer-item">
              <div class="wiz-layer-header" onclick="IntelWizard.toggleAccordion(this)">
                <span class="wiz-layer-title-box">🧬 Topic DNA Clusters</span>
                <span class="wiz-layer-desc-brief">${bp.topicDNA.clusters}</span>
              </div>
              <div class="wiz-layer-body">
                <div><strong>Clustering weight:</strong> ${bp.topicDNA.clusters}</div>
                <div><strong>Evergreen Anchor:</strong> ${bp.topicDNA.evergreen}</div>
                <div><strong>Trend Anchor:</strong> ${bp.topicDNA.trend}</div>
              </div>
            </div>

            <div class="wiz-layer-item">
              <div class="wiz-layer-header" onclick="IntelWizard.toggleAccordion(this)">
                <span class="wiz-layer-title-box">📈 Outlier Content Detection</span>
                <span class="wiz-layer-desc-brief">${bp.outliers.substring(0, 45)}...</span>
              </div>
              <div class="wiz-layer-body">
                <div><strong>Outlier Post analysis:</strong> ${bp.outliers}</div>
              </div>
            </div>

            <div class="wiz-layer-item">
              <div class="wiz-layer-header" onclick="IntelWizard.toggleAccordion(this)">
                <span class="wiz-layer-title-box">✍️ High-Retention Title Formulas</span>
                <span class="wiz-layer-desc-brief">"${bp.titleFormulas}"</span>
              </div>
              <div class="wiz-layer-body">
                <div><strong>Replicable Formula:</strong> <code style="color:var(--accent);">${bp.titleFormulas}</code></div>
              </div>
            </div>

            <div class="wiz-layer-item">
              <div class="wiz-layer-header" onclick="IntelWizard.toggleAccordion(this)">
                <span class="wiz-layer-title-box">🖼️ Thumbnail/Cover Layout</span>
                <span class="wiz-layer-desc-brief">${bp.thumbnailDNA}</span>
              </div>
              <div class="wiz-layer-body">
                <div><strong>Visual Composition:</strong> ${bp.thumbnailDNA}</div>
              </div>
            </div>

            <div class="wiz-layer-item">
              <div class="wiz-layer-header" onclick="IntelWizard.toggleAccordion(this)">
                <span class="wiz-layer-title-box">🪝 Hook Mechanics</span>
                <span class="wiz-layer-desc-brief">"${bp.hookStructure.substring(0, 40)}..."</span>
              </div>
              <div class="wiz-layer-body">
                <div><strong>0-15s Hook:</strong> ${bp.hookStructure}</div>
              </div>
            </div>

            <div class="wiz-layer-item">
              <div class="wiz-layer-header" onclick="IntelWizard.toggleAccordion(this)">
                <span class="wiz-layer-title-box">📝 Script Architecture</span>
                <span class="wiz-layer-desc-brief">${bp.scriptArch}</span>
              </div>
              <div class="wiz-layer-body">
                <div><strong>Timeline Structure:</strong> ${bp.scriptArch}</div>
              </div>
            </div>

            <div class="wiz-layer-item">
              <div class="wiz-layer-header" onclick="IntelWizard.toggleAccordion(this)">
                <span class="wiz-layer-title-box">🎙️ Vocal Tone & Pacing</span>
                <span class="wiz-layer-desc-brief">${bp.tonePacing}</span>
              </div>
              <div class="wiz-layer-body">
                <div><strong>Auditory DNA:</strong> ${bp.tonePacing}</div>
              </div>
            </div>

            <div class="wiz-layer-item">
              <div class="wiz-layer-header" onclick="IntelWizard.toggleAccordion(this)">
                <span class="wiz-layer-title-box">🕳️ Under-Saturated Content Gaps</span>
                <span class="wiz-layer-desc-brief">${bp.contentGaps}</span>
              </div>
              <div class="wiz-layer-body">
                <div><strong>Blue Ocean Gaps:</strong> ${bp.contentGaps}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ────────────────────────────────────────
  // STEP 5: AI Agent Injection
  // ────────────────────────────────────────
  function renderStep5() {
    if (state.isTraining) {
      return `
        <div class="wiz-training-box">
          <div class="wiz-matrix-loader">
            <div class="wiz-matrix-bar"></div>
            <div class="wiz-matrix-bar"></div>
            <div class="wiz-matrix-bar"></div>
            <div class="wiz-matrix-bar"></div>
          </div>
          <div style="display:flex; flex-direction:column; gap:0.25rem;">
            <h4 style="margin:0; font-size:1.1rem; color:#fff; font-weight:700;">Fine-Tuning Persona Agent Configuration...</h4>
            <p style="margin:0; font-size:0.8rem; color:var(--text-dim);">Compiling 9-layer blueprint parameters into Agent files: soul.md & skills.md</p>
          </div>
          <div class="wiz-scan-logs" id="wiz-train-logs-container">
            <div>[INJECTING] Injecting Positioning Matrix into soul.md...</div>
          </div>
        </div>
      `;
    }

    const agents = (typeof DASH_AGENTS !== 'undefined') ? DASH_AGENTS : [];

    return `
      <div>
        <h3 style="margin-top:0; font-size:1.1rem; font-weight:700;">5. Feed to Agent — Fine-Tune AI Creators</h3>
        <p style="font-size:0.85rem; color:var(--text-dim); margin-bottom:1rem;">
          Feed the decoded blueprint directly into an AI agent. This adapts their creative framework, hooks database, and writing style.
        </p>

        <div class="wiz-agents-grid">
          ${agents.map(a => `
            <div class="wiz-agent-card ${state.agent === a.handle ? 'active' : ''}" onclick="IntelWizard.selectAgent('${a.handle}')">
              <div class="wiz-agent-av" style="background:${a.gradient || 'linear-gradient(135deg, #a78bfa, #f472b6)'}">${a.initial || a.name.charAt(0)}</div>
              <div>
                <div class="wiz-agent-name">${a.name}</div>
                <div style="font-size:0.75rem; color:var(--text-dim); margin-top:2px;">${a.handle}</div>
              </div>
              <span class="wiz-agent-niche">${a.niche || 'General'}</span>

              ${state.trainingComplete && state.agent === a.handle ? `
                <span class="wiz-agent-badge-trained">
                  <span style="display:inline-block; width:6px; height:6px; background:#10b981; border-radius:50%"></span>
                  Blueprint Synchronized
                </span>
              ` : ''}
            </div>
          `).join('')}
        </div>

        ${!state.trainingComplete ? `
          <div style="text-align:center; margin-top:2rem;">
            <button class="wiz-btn wiz-btn-primary" onclick="IntelWizard.trainAgent()" style="font-size:0.95rem; padding:0.75rem 2rem;">
              🧠 Train ${state.agent ? state.agent.split('@')[1] : 'Selected Agent'} on Blueprint
            </button>
          </div>
        ` : `
          <div style="text-align:center; margin-top:2rem; background:rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius:10px; padding:1.25rem;">
            <div style="font-weight:700; color:#10b981; font-size:1rem; display:flex; align-items:center; justify-content:center; gap:0.5rem;">
              <span>✅ Agent Retrained Successfully!</span>
            </div>
            <p style="font-size:0.8rem; color:rgba(255,255,255,0.7); max-width:550px; margin:0.5rem auto 1rem auto;">
              The agent's configuration system memory has been dynamically updated. The structural style guidelines are locked into their content-generation profile.
            </p>
            <button class="wiz-btn wiz-btn-success" onclick="IntelWizard.nextStep()">
              🚀 Proceed to Content Studio
            </button>
          </div>
        `}
      </div>
    `;
  }

  // ────────────────────────────────────────
  // STEP 6: Content Studio Drafts
  // ────────────────────────────────────────
  function renderStep6() {
    const drafts = state.drafts || [];
    return `
      <div>
        <h3 style="margin-top:0; font-size:1.1rem; font-weight:700;">6. Content Studio — Launchpad</h3>
        <p style="font-size:0.85rem; color:var(--text-dim); margin-bottom:1rem;">
          Your trained AI agent has applied the decoded content formulas to draft customized, high-retention content ready for distribution.
        </p>

        <div class="wiz-studio-grid">
          <!-- Main Draft Area -->
          <div class="wiz-draft-section">
            <h4 style="margin:0; font-size:0.9rem; font-weight:700; color:#fff; display:flex; align-items:center; gap:0.5rem;">
              <span>📝 Draft Content Packages</span>
            </h4>
            
            ${drafts.map((d, idx) => `
              <div class="wiz-draft-card">
                <div class="wiz-draft-header">
                  <span class="wiz-draft-tag">Option ${idx + 1}: ${d.type}</span>
                  <span style="font-size:0.7rem; color:var(--text-dim);">${d.platform.toUpperCase()}</span>
                </div>
                <div style="font-weight:700; font-size:0.9rem; color:#fff; margin-bottom:0.25rem;">${d.title}</div>
                <div class="wiz-draft-body">${d.body}</div>
                <div class="wiz-draft-actions">
                  <button class="wiz-btn wiz-btn-secondary" onclick="IntelWizard.openInComposer(${idx})" style="padding:0.4rem 0.8rem; font-size:0.75rem;">
                    ✏️ Load in Composer
                  </button>
                  <button class="wiz-btn wiz-btn-secondary" onclick="IntelWizard.copyDraft(${idx})" style="padding:0.4rem 0.8rem; font-size:0.75rem;">
                    📋 Copy Text
                  </button>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Studio Actions Sidebar -->
          <div class="wiz-actions-sidebar">
            <div class="wiz-action-capsule">
              <div class="wiz-action-title">📅 Push to Live Calendar</div>
              <div class="wiz-action-desc">
                Schedule Option 1 to go live on your organic scheduler. This pushes the post directly into the dynamic calendar pipeline.
              </div>
              <button class="wiz-btn wiz-btn-success" onclick="IntelWizard.schedulePost()" style="width:100%;">
                📅 Schedule Option 1
              </button>
            </div>

            <div class="wiz-action-capsule">
              <div class="wiz-action-title">🛠️ Open in Content Forge</div>
              <div class="wiz-action-desc">
                Send this learned blueprint directly to Content Forge to customize media assets, thumbnail briefs, and generate hashtags.
              </div>
              <button class="wiz-btn wiz-btn-primary" onclick="IntelWizard.openInContentForge()" style="width:100%;">
                🛠️ Open in Content Forge
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ────────────────────────────────────────
  // INTERACTIVE TRIGGERS & CONTROLLERS
  // ────────────────────────────────────────
  function resetWizard() {
    currentStep = 1;
    state = {
      niche: 'fitness',
      trend: null,
      competitor: null,
      post: null,
      scannedPostId: null,
      agent: '@sofiarivera.ai',
      isScanning: false,
      isTraining: false,
      trainingComplete: false,
      drafts: null
    };
    render();
  }

  function selectNiche(nicheId) {
    state.niche = nicheId;
    state.trend = null;
    state.competitor = null;
    state.post = null;
    state.scannedPostId = null;
    state.drafts = null;
    state.trainingComplete = false;
    
    const activeNicheDef = NICHES.find(n => n.id === nicheId);
    state.agent = activeNicheDef ? activeNicheDef.agent : '';
    
    render();
  }

  function selectTrend(trendId) {
    const list = TREND_DATA[state.niche] || [];
    state.trend = list.find(t => t.id === trendId) || null;
    state.competitor = null;
    state.post = null;
    state.scannedPostId = null;
    render();
  }

  function selectCompetitor(compId) {
    const list = COMPETITOR_DATA[state.niche] || [];
    state.competitor = list.find(c => c.id === compId) || null;
    state.post = null;
    state.scannedPostId = null;
    render();
  }

  function selectPost(postId) {
    if (!state.competitor) return;
    const posts = state.competitor.posts || [];
    state.post = posts.find(p => p.id === postId) || null;
    render();
  }

  function selectAgent(handle) {
    state.agent = handle;
    render();
  }

  function toggleAccordion(header) {
    const item = header.parentElement;
    const body = item.querySelector('.wiz-layer-body');
    const allItems = document.querySelectorAll('.wiz-layer-item');
    
    // Close other bodies
    allItems.forEach(el => {
      const b = el.querySelector('.wiz-layer-body');
      if (el !== item && b) {
        b.style.display = 'none';
      }
    });

    if (body) {
      if (body.style.display === 'flex' || body.style.display === '') {
        body.style.display = 'none';
      } else {
        body.style.display = 'flex';
      }
    }
  }

  function goToStep(stepNum) {
    currentStep = stepNum;
    if (stepNum === 4 && state.post && state.scannedPostId !== state.post.id) {
      state.isScanning = true;
      render();
      simulateScanning();
      return;
    }
    render();
  }

  function prevStep() {
    if (currentStep > 1) {
      goToStep(currentStep - 1);
    }
  }

  function nextStep() {
    if (currentStep === 1 && state.trend) {
      goToStep(2);
    } else if (currentStep === 2 && state.competitor) {
      goToStep(3);
    } else if (currentStep === 3 && state.post) {
      goToStep(4);
    } else if (currentStep === 4) {
      goToStep(5);
    } else if (currentStep === 5 && state.trainingComplete) {
      goToStep(6);
    }
  }

  // Scanning effect logs
  function simulateScanning() {
    const logs = [
      `[CONNECTING] Querying Social Scout APIs for ${state.competitor?.handle}...`,
      `[SCRAPING] Analyzing viral post: "${state.post?.title || 'Selected post'}"...`,
      `[TRANSCRIBING] Decoding retention mechanics & pattern interrupts...`,
      `[DECODING] Dissecting visual hook overlays and pacing signatures...`,
      `[ANALYZING] Mapping performance outliers on trend ${state.post?.topic || state.trend?.topic || ''}...`,
      `[SUCCESS] Generated 9-layer Scorecard blueprint for ${state.competitor?.name}!`
    ];

    let index = 0;
    const timer = setInterval(() => {
      const containerLogs = document.getElementById('wiz-scan-logs-container');
      if (containerLogs) {
        index++;
        if (index < logs.length) {
          const div = document.createElement('div');
          div.textContent = logs[index];
          containerLogs.appendChild(div);
          containerLogs.scrollTop = containerLogs.scrollHeight;
        } else {
          clearInterval(timer);
          state.isScanning = false;
          state.scannedPostId = state.post?.id || null;
          render();
        }
      } else {
        clearInterval(timer);
      }
    }, 400);
  }

  // Train AI Creator Model
  function trainAgent() {
    state.isTraining = true;
    render();

    const logs = [
      `[INJECTING] Injecting decoded positioning matrix for ${state.post?.topic || state.trend?.topic || 'UGC'} into soul.md...`,
      `[UPGRADING] Writing high-retention Title Formulas into skills.md...`,
      `[ALIGNING] Syncing auditory hooks and pace patterns to heartbeat.md...`,
      `[SUCCESS] AI Creator trained on ${state.competitor?.name || 'competitor'}'s winning content framework!`
    ];

    let index = 0;
    const timer = setInterval(() => {
      const containerLogs = document.getElementById('wiz-train-logs-container');
      if (containerLogs) {
        index++;
        if (index < logs.length) {
          const div = document.createElement('div');
          div.textContent = logs[index];
          containerLogs.appendChild(div);
          containerLogs.scrollTop = containerLogs.scrollHeight;
        } else {
          clearInterval(timer);
          state.isTraining = false;
          state.trainingComplete = true;

          // Actually update the files in the global array DASH_AGENTS / INFLUENCERS
          const selectedAgentObj = DASH_AGENTS.find(a => a.handle === state.agent);
          if (selectedAgentObj) {
            // Append learned blueprint lines to their soul.md & skills.md
            selectedAgentObj.soul += `\n\n## Learned Blueprint: ${state.post?.topic || state.trend?.topic}\n- Adapt positioning: Replicated ${state.competitor?.name}'s core retention model.\n- Focus promise: Leveraged ${state.post?.topic || state.trend?.topic} high virality structure.`;
            selectedAgentObj.skills += `\n\n## Content Skills: ${state.post?.topic || state.trend?.topic}\n- Pattern Recognition: Applied decoded Title formulas & ${state.post?.topic || state.trend?.topic} pacing.\n- Script layout replication.`;
          }

          // Generate Step 5 Drafts
          generateStep5Drafts();
          render();
          
          if (typeof PersonaGenAPI !== 'undefined') {
            PersonaGenAPI.showToast(`${selectedAgentObj?.name || 'Agent'} retrained successfully!`, 'success');
          }
        }
      } else {
        clearInterval(timer);
      }
    }, 450);
  }

  function generateStep5Drafts() {
    const topic = state.post?.topic || state.trend?.topic || 'UGC Core';
    const compName = state.competitor?.name || 'Organic Competitor';
    const agentName = (typeof DASH_AGENTS !== 'undefined' && DASH_AGENTS.find(a => a.handle === state.agent))?.name || 'Sofia';

    if (state.niche === 'fitness') {
      const isMealPrep = topic.includes('Prep') || topic.includes('Meal');
      const isCortisol = topic.includes('Cortisol');
      
      if (isMealPrep) {
        state.drafts = [
          {
            type: 'Video Script',
            platform: 'tiktok',
            title: `My 10-Minute Protein Prep: 180g Protein (No Cooking)`,
            body: `[0:00 - 0:08] HOOK:\n"Stop cooking for hours just to hit your macros." *pours high-protein ingredients, energetic cuts*\n"I prep 5 high-protein meals in literally 10 minutes without turning on a single stove. Here's exactly how..."\n\n[0:08 - 0:25] THE MYTH:\n"You don't need dry chicken breast and cold rice to build muscle. Real meal prep is about speed, taste, and zero effort."\n\n[0:25 - 1:00] THE ASSEMBLY:\n"Layer 1: Greek yogurt and whey base. Layer 2: Overnight oats with chia seeds. Layer 3: No-bake protein bites. Pack them in separate glass containers. That is 180g of premium bioavailable protein."\n\n[1:00 - 1:20] CALL TO ACTION:\n"Try this prep today and stop skipping your meals. Follow for more high-protein hacks!"`
          },
          {
            type: 'Carousel Design Layout',
            platform: 'instagram',
            title: `10-Min Protein Prep Checklist`,
            body: `Slide 1: How to prep 180g of protein in 10 minutes (Zero cooking). (Hook)\nSlide 2: Ingredient Breakdown: Greek yogurt, whey isolate, hemp seeds, organic oats.\nSlide 3: Step-by-Step assembly: Layering wet & dry ingredients for maximum shelf life.\nSlide 4: Storage tips: Why glass containers keep no-cook preps perfectly fresh for 5 days.\nSlide 5: Macros layout: 5 meals, 36g protein each, under 300 calories.\nSlide 6: Drop a comment with 'PREP' and I will send you my complete shopping list!`
          }
        ];
      } else if (isCortisol) {
        state.drafts = [
          {
            type: 'Video Script',
            platform: 'tiktok',
            title: `Why Your Intense Gym Routine is Keeping You Tired`,
            body: `[0:00 - 0:08] HOOK:\n"If you are constantly exhausted after working out, your routine is backfiring." *measured, supportive look*\n"I see people destroying their hormones with daily extreme HIIT. Your cortisol spikes, your sleep suffers, and you hold onto fat. Here is the hormone-friendly fix..."\n\n[0:08 - 0:25] HORMONE SCIENCE:\n"When cortisol is chronically elevated, your body enters survival mode. You need low-stress resistance training to signal safety while building muscle."\n\n[0:25 - 1:00] THE FORMULA:\n"Switch to 3 slow-cadence full body workouts a week. Rest 2 full minutes between sets. Limit heavy cardio to Zone 2 walks. Keep your nervous system calm."\n\n[1:00 - 1:20] CALL TO ACTION:\n"Rebuild your fitness from the hormones up. Save this video and comment: how's your energy level lately?"`
          },
          {
            type: 'Carousel Design Layout',
            platform: 'instagram',
            title: `Hormone-Safe Workout Principles`,
            body: `Slide 1: Stop doing workouts that leave you exhausted and bloated. (Hook)\nSlide 2: Cortisol vs Lean Muscle: How excess stress signals your body to burn muscle and store fat.\nSlide 3: Slow Pacing: The magic of resting 2-3 minutes between resistance sets.\nSlide 4: Low-Impact Cardio: Why low incline walking is the ultimate stress-free metabolic booster.\nSlide 5: Sleep Integration: Training only when fully recovered, never on 5 hours of sleep.\nSlide 6: Save this for your next gym session. DM me 'REST' for my adrenal health workout guide!`
          }
        ];
      } else {
        // Zone 2 Cardio default
        state.drafts = [
          {
            type: 'Video Script',
            platform: 'tiktok',
            title: `Why 90% of Cardio Is Doing Nothing (And the 3-Min Fix)`,
            body: `[0:00 - 0:08] HOOK:\n"Stop destroying your metabolism by working out too hard." *close up, calm gaze*\n"I spent 5 years doing extreme HIIT thinking it was the secret. My cortisol went through the roof, and I actually gained weight. Here is what I do now..."\n\n[0:08 - 0:25] BIOLOGY MYTH:\n"Zone 2 Cardio means keeping your heart rate low. Where you can still hold a conversation but you're burning fat directly..."\n\n[0:25 - 1:00] THE METHOD:\n"How to set it up: Use the 180 formula. 180 minus your age is your target rate. Keep it steady for 30 minutes twice a week. That's literally it."\n\n[1:00 - 1:20] CALL TO ACTION:\n"Try this for two weeks and watch your energy double. Save this and tell me: what's your current routine?"`
          },
          {
            type: 'Carousel Design Layout',
            platform: 'instagram',
            title: `Cortisol-Friendly Cardio Checklist`,
            body: `Slide 1: Why your high-intensity gym routine is keeping you tired & bloated. (Hook)\nSlide 2: The Adrenal Gland Science: how extreme HIIT spikes cortisol, triggering fat storage.\nSlide 3: Enter Zone 2: The low-stress aerobic base. 135 bpm. Recharges physical engines.\nSlide 4: 3-Step Setup: 180 formula, low incline walk or slow jog, keep nasal breathing.\nSlide 5: The Schedule: 30 minutes, 2x a week. No soreness. Maximum health benefit.\nSlide 6: Save this for your next gym session. DM me 'ZONE2' for my complete workout tracker!`
          }
        ];
      }
    } else if (state.niche === 'tech') {
      const isAgents = topic.includes('Agent') || topic.includes('Autonomous');
      
      if (isAgents) {
        state.drafts = [
          {
            type: 'Video Script',
            platform: 'youtube',
            title: `I Built an Autonomous AI Coding Agent in 30 Lines of Python`,
            body: `[0:00 - 0:10] HOOK:\n"This single script literally debugs, tests, and deploys code autonomously while I make coffee." *glowing connections, code execution terminal*\n"Stop thinking AI agents are hard to build. Here is the 30-line Python blueprint that will change your engineering workflow..."\n\n[0:10 - 0:30] CODE ANATOMY:\n"We initialize the model with Ollama, define an execution loop, and feed the terminal output back as observations. It corrects its own syntax errors in real-time."\n\n[0:30 - 1:00] THE DEMO:\n"Watch it write a web scraper, run it, find a missing dependency, pip install it, and complete the job. Completely hands-free."\n\n[1:00 - 1:20] CALL TO ACTION:\n"Star the repository in the description below to clone the agent and start automating your tasks. Hit subscribe for more local AI hacks!"`
          },
          {
            type: 'Technical Post',
            platform: 'x',
            title: `Why single AI agents fail in production`,
            body: `Single AI agents break the moment they hit unexpected edge cases.\nHere is why Multi-Agent Networks are the production standard:\n\n1. Separation of Concerns: One agent writes code. A second agent writes tests. A third agent debugs.\n2. Self-Correction Loops: The debugger agent feeds errors directly back to the coder agent.\n3. Local execution: Running this network locally with Ollama/Llama 3 ensures zero cost and maximum data privacy.\n\nI built a complete agentic debugging network in under 100 lines of code.\n\nLink to repo in the comments below! 👇`
          }
        ];
      } else {
        // Local LLMs default
        state.drafts = [
          {
            type: 'Video Script',
            platform: 'youtube',
            title: `I Ran Llama 3 Locally on my laptop (Full Blueprint)`,
            body: `[0:00 - 0:10] HOOK:\n"Stop paying tech monopolies for subscription models when you can run a private, uncensored frontier LLM on your own laptop for absolute zero." *terminal display, green code glowing*\n\n[0:10 - 0:30] INSTALLATION:\n"Step 1: Download Ollama. Open terminal, run curl. It sets up the backend instantly..."\n\n[0:30 - 1:00] SETUP & SPEED:\n"Step 2: Run 'ollama run llama3:8b'. Notice the token generation speed. 45 tokens per second. Completely private, no data leaves this device."\n\n[1:00 - 1:20] NEXT LEVEL:\n"Let me know if you want the Python script to build a custom voice helper on top of this. Hit follow and check the description."`
          },
          {
            type: 'Technical Post',
            platform: 'x',
            title: `The death of simple prompts`,
            body: `Basic prompt engineering is dead.\nHere is why programmatic prompt chaining is the new AI standard in production:\n\n1. Single prompts break at scale. One minor model update, and your outputs shatter.\n2. Enter DSPy: compiling instead of prompt patching.\n3. The Blueprint: We chain tasks. Segment 1 extracts metadata. Segment 2 validates JSON schema. Segment 3 compiles tone.\n\nRunning this locally with Ollama provides private, super-reliable AI agents.\n\nFull Python framework attached in my repository 👇`
          }
        ];
      }
    } else if (state.niche === 'fashion') {
      const isGRWM = topic.includes('GRWM') || topic.includes('Bilingual');
      
      if (isGRWM) {
        state.drafts = [
          {
            type: 'Video Script',
            platform: 'tiktok',
            title: `Bilingual GRWM: Styling Modest Haute Couture for Dubai Art Week`,
            body: `[0:00 - 0:08] HOOK:\n"Let's style an archival modest couture look for a luxury art opening in Dubai tonight." *ASMR robe drop, warm gold lighting*\n"Today we are blending structured Western minimalism with traditional drape aesthetics..."\n\n[0:08 - 0:30] STYLING LAYERS:\n"Starting with a hand-woven silk underlayer, then draping this unstructured linen wrap jacket. Notice the lack of loud designer monograms. Elegance isn't about being noticed; it's about being remembered."\n\n[0:30 - 1:00] ACCESSORIES:\n"Adding vintage silver jewelry sourced from old souks and an artisanal leather saddle bag. Clean, balanced, sophisticated."\n\n[1:00 - 1:20] CLOSING:\n"Always stay true to your heritage while pushing boundaries. Comment below: how would you style this linen drape?"`
          },
          {
            type: 'Couture Editorial',
            platform: 'instagram',
            title: `Dubai Art Gala GRWM`,
            body: `GRWM: Blending heritage drapes with structured modern lines for tonight's art exhibition.\n\nTrue style doesn't need to shout its brand name. It speaks in the fall of the fabric, the precision of the cut, and the harmony of the layers.\n\nLook Breakdown:\n- Hand-stitched linen drape jacket\n- Silk under-drape in sandy beige\n- Artisanal leather saddle bag\n- Handcrafted souk-found silver cuffs\n\nElegant modesty Adapting quiet luxury for cultural celebrations. Tell me: would you wear this look?`
          }
        ];
      } else {
        // Quiet Luxury default
        state.drafts = [
          {
            type: 'Video Script',
            platform: 'tiktok',
            title: `Look Expensive Without Logos (My 3 Style Rules)`,
            body: `[0:00 - 0:08] HOOK:\n"Wearing giant designer logos is actually the quickest way to look cheap. True Old Money aesthetics don't shout. They whisper." *cut to clean luxury beige robe*\n\n[0:08 - 0:30] TEXTURE MATRIX:\n"Rule 1: Natural fabrics only. Linen, cashmere, organic cotton. Cheap polyester reflects artificial light, making garments look flat."\n\n[0:30 - 1:00] SILHOUETTE FIT:\n"Rule 2: Fit is 90% of style. A custom tailored $50 blazer will always outperform a $2,000 designer jacket that fits poorly."\n\n[1:00 - 1:20] COUTURE RULES:\n"Bilingual fashion secrets straight from Dubai art week. Drop a comment for my brand directory!"`
          },
          {
            type: 'Couture Editorial',
            platform: 'instagram',
            title: `How to Spot Quiet Luxury Quality`,
            body: `True quiet luxury is about craftsmanship, not conspicuous logos.\nHere is how to analyze fabric like an expert:\n\n1. Fiber Check: Always inspect the garment label. Synthetic poly-blends trap heat and look flat. Seek 100% cashmere, organic linen, and long-staple cotton.\n2. Seam Precision: Look inside. High-end pieces feature French seams or taped edges, never messy overlock stitching.\n3. Heavy Hardware: High-grade brass zippers and genuine horn buttons indicate a label that doesn't cut corners.\n\nElegance is quiet. Tell me: which fabric is your ultimate wardrobe staple?`
          }
        ];
      }
    } else { // Beauty / Lifestyle
      const isAIGC = topic.includes('AIGC') || topic.includes('AI');
      
      if (isAIGC) {
        state.drafts = [
          {
            type: 'Video Script',
            platform: 'tiktok',
            title: `POV: My AI Roommate Takes Over My Skincare Routine`,
            body: `[0:00 - 0:08] HOOK:\n"POV: Your AI roommate forgot she is a digital projection and tries to execute a 5-step morning skincare routine." *deadpan expression, robotic hand taps*\n"Things got weird immediately..."\n\n[0:08 - 0:30] THE SKIT:\n"Initializing dewy hydration matrix... Error: dermal layer not found. Attempting to apply toner to empty space." *Robotic arm swiping, glowing particles overlay*\n\n[0:30 - 1:00] THE RESOLUTION:\n"When she realizes she has a better glass skin render index than my actual physical skin anyway... 'Your hydration level is at 45%, physical user. Pathetic.'" *shows glowing holographic skincare scoreboard*\n\n[1:00 - 1:20] BEAUTY CLOSE:\n"Should I let her take over my makeup routine next? Comment below!"`
          },
          {
            type: 'POV Skit Layout',
            platform: 'tiktok',
            title: `When Your Virtual Roommate is Better at Skincare`,
            body: `POV: Trying to explain to your AI creator roommate why she doesn't need to double-cleanse her digital mesh.\n\nHer: "Double cleansing is vital to remove synthetic render noise and pixel oxidation."\nMe: "You're a hologram, Siri."\nHer: "My pixels are dewy. Yours are dry."\n\nHonestly, her skincare advice is 10/10. 😂\n\nShould she launch her own beauty channel? Drop your vote below!`
          }
        ];
      } else {
        // Glass Skin default
        state.drafts = [
          {
            type: 'Video Script',
            platform: 'tiktok',
            title: `My 5-Step Korean Skincare Glass Skin Secret`,
            body: `[0:00 - 0:08] HOOK:\n"Stop trying to cake on highlighter to look dewy. True glass skin starts beneath. Here is my exact 5-step Korean ritual." *extreme glow showcase, tap tap cheeks*\n\n[0:08 - 0:30] MOISTURE LAYERING:\n"Step 1: Double cleanse. Step 2: The 7-toner splash method. Patting multiple micro-layers of hyaluronic essence deeply into the dermis..."\n\n[0:30 - 1:00] BARRIER SEALING:\n"Step 3: Centella ampoule. Step 4: Ceramide moisturizer to lock the barrier. Step 5: Dewy sunscreen. No filter, just absolute skin biology."\n\n[1:00 - 1:20] BEAUTY CLOSE:\n"Save this skincare blueprint. What step are you skipping?"`
          },
          {
            type: 'POV Skit Layout',
            platform: 'tiktok',
            title: `My Glow Journey: Ruined to Glass Skin`,
            body: `My skin barrier was completely stripped 30 days ago. Red, dry, irritated.\nHere is the exact Korean glass skin routine that saved it:\n\n1. Double cleansing with a gentle oil-based cleanser then a hydrating milk cleanser.\n2. The 7-skin method: patting 3 separate layers of a thick, alcohol-free rice toner.\n3. Centella Asiatica ampoule to soothe active redness immediately.\n4. A heavy ceramide lock cream to rebuild the lipid barrier overnight.\n\nConsistency beats any filter. Save this blueprint to rebuild your own glow! ✨`
          }
        ];
      }
    }
  }

  function openInComposer(idx) {
    if (!state.drafts || !state.drafts[idx]) return;
    const d = state.drafts[idx];
    
    if (typeof PostComposer !== 'undefined') {
      PostComposer.open({
        content: { text: d.body, hashtags: [state.trend?.topic || '#Blueprint'] }
      });
      if (typeof PersonaGenAPI !== 'undefined') {
        PersonaGenAPI.showToast('Loaded into Post Composer!', 'success');
      }
    } else {
      if (typeof PersonaGenAPI !== 'undefined') {
        PersonaGenAPI.showToast('Post Composer not found', 'warning');
      }
    }
  }

  function copyDraft(idx) {
    if (!state.drafts || !state.drafts[idx]) return;
    const text = state.drafts[idx].body;
    navigator.clipboard.writeText(text).then(() => {
      if (typeof PersonaGenAPI !== 'undefined') {
        PersonaGenAPI.showToast('Draft text copied!', 'success');
      }
    }).catch(() => {});
  }

  function schedulePost() {
    if (!state.drafts || state.drafts.length === 0) return;
    const d = state.drafts[0]; // Option 1

    const agentObj = DASH_AGENTS.find(a => a.handle === state.agent) || DASH_AGENTS[0];
    const postDate = new Date();
    postDate.setDate(postDate.getDate() + 2); // Schedule 2 days out
    postDate.setHours(10, 30, 0, 0); // 10:30 AM

    const post = {
      id: (typeof PersonaGenAPI !== 'undefined') ? PersonaGenAPI.Local.uuid() : 'wiz_' + Date.now(),
      persona_id: agentObj.handle,
      persona_name: agentObj.name,
      persona_initial: agentObj.initial,
      persona_gradient: agentObj.gradient,
      platforms: [d.platform],
      content: {
        text: d.body,
        hashtags: [state.trend?.topic || '#WizardBlueprint'],
        media_url: null,
        privacy: 'public'
      },
      status: 'scheduled',
      type: d.type || 'Post',
      scheduled_at: postDate.toISOString(),
      timezone: 'America/New_York',
      created_at: new Date().toISOString(),
      generation_source: 'intel-wizard'
    };

    if (typeof PersonaGenAPI !== 'undefined') {
      PersonaGenAPI.Local.savePost(post);
      
      // Refresh dynamic calendar if available
      if (typeof DynamicCalendar !== 'undefined') {
        DynamicCalendar.refresh();
      }

      PersonaGenAPI.showToast('Option 1 Scheduled on Calendar for ' + postDate.toLocaleDateString(), 'success');
      
      // Redirect to Calendar view to see it live!
      setTimeout(() => {
        if (typeof switchPortalView === 'function') switchPortalView('calendar');
        else window.location.href = 'calendar.html';
      }, 800);
    }
  }

  function openInContentForge() {
    if (typeof ContentForge !== 'undefined') {
      // Build a custom blueprint to pass over
      const bp = {
        channelName: state.competitor?.name || 'Scouted Creator',
        niche: state.niche,
        trendTopic: state.trend?.topic
      };
      
      // Save blueprint to local storage list so Content Forge can select it
      try {
        const list = JSON.parse(localStorage.getItem('personagen_blueprints') || '[]');
        list.push(bp);
        localStorage.setItem('personagen_blueprints', JSON.stringify(list));
      } catch (err) {
        console.warn('Failed to save blueprint to localStorage list:', err);
      }

      // Forge content package using our blueprint
      ContentForge.forgeFromBlueprint(bp);
      
      // Switch view to content forge
      if (typeof switchPortalView === 'function') switchPortalView('content-forge');
      else window.location.href = 'content-forge.html';
      
      if (typeof PersonaGenAPI !== 'undefined') {
        PersonaGenAPI.showToast('Transferred blueprint to Content Forge!', 'success');
      }
    } else {
      if (typeof PersonaGenAPI !== 'undefined') {
        PersonaGenAPI.showToast('Content Forge not found', 'warning');
      }
    }
  }

  return {
    init,
    resetWizard,
    selectNiche,
    selectTrend,
    selectCompetitor,
    selectPost,
    selectAgent,
    toggleAccordion,
    goToStep,
    prevStep,
    nextStep,
    trainAgent,
    openInComposer,
    copyDraft,
    schedulePost,
    openInContentForge
  };
})();

// Auto-init on page load if mount is ready
document.addEventListener('DOMContentLoaded', () => {
  const mount = document.getElementById('intel-wizard-mount');
  if (mount && !mount.hasChildNodes()) {
    IntelWizard.init('intel-wizard-mount');
  }
});
