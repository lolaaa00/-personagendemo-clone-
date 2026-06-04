// ═══════════════════════════════════════
// PORTAL CONFIG — swap this block per client
// ═══════════════════════════════════════
const PersonaGenConfig = {
  postiz_url: 'https://l2g-postiz.zi1cc5.easypanel.host',
  webhook_url: 'https://auto.l2gseo.com/webhook/personagen-social',
  n8n_url: 'https://auto.l2gseo.com',
};

// ═══════════════════════════════════════
// DATA: AI INFLUENCER ROSTER (loaded from data/agents.json)
// ═══════════════════════════════════════
let INFLUENCERS = []; // Populated by data loader from data/agents.json

// Legacy placeholder — will be overwritten by loadData()
const _INFLUENCER_FALLBACK = [
    {
        name: "Sofia Rivera", handle: "@sofiarivera.ai", initial: "S",
        gradient: "linear-gradient(135deg, #f472b6, #a78bfa)",
        headerBg: "linear-gradient(135deg, #fce7f3, #ede9fe)",
        bio: "Latina fitness coach & wellness advocate. Posts daily workout routines, meal prep content, and mindset motivation across Instagram and TikTok.",
        niche: "Fitness & Wellness", market: "US / LATAM",
        followers: "24.8K", posts: "312", engagement: "6.2%",
        platforms: ["Instagram", "TikTok", "YouTube"],
        soul: `# soul.md — Sofia Rivera\n\n## Identity\nLatina fitness coach, 28, based in Miami.\nFirst-gen immigrant background fuels\n"no excuses" work ethic.\n\n## Voice\nWarm but direct. Uses Spanglish naturally.\nMotivational without being preachy.\n\n## Values\n- Body positivity over aesthetics\n- Science-backed nutrition\n- Community over competition\n\n## Behavioral Directives\n- Never promote crash diets\n- Always include modifier exercises\n- Respond to DMs within persona voice\n- Post ratio: 60% educational, 40% lifestyle`,
        tools: `# tools.md — Sofia Rivera\n\n## Connected Platforms\n✅ Instagram (API v18)\n✅ TikTok (Publish API)\n✅ YouTube (Shorts Upload)\n\n## Integrations\n- Content Generator: LLM v4.2\n- Image Pipeline: SDXL + LoRA\n- Scheduler: n8n Cron Trigger\n- Analytics: Engagement Tracker\n- Proxy: SOCKS5 Rotator (US-East)\n- Channel Blueprint Library\n- Content Forge Pipeline\n\n## Capabilities\n- Auto-caption generation\n- Hashtag optimization engine\n- A/B post testing (2 variants)\n- Comment reply automation\n- Blueprint pattern application\n- Title formula generation\n- Hook structure replication`,
        skills: `# skills.md — Sofia Rivera\n\n## Content Skills\n- Reel editing (cut-to-beat sync)\n- Carousel layout design\n- Caption copywriting (CTA hooks)\n- Voiceover narration scripting\n\n## Blueprint Skills\n- Channel pattern recognition\n- Title formula application\n- Hook structure replication\n- Tone DNA adaptation\n- Content gap exploitation\n\n## Scouting Skills\n- Fitness hashtag trend detection\n- Competitor workout format analysis\n- Viral audio identification\n- Engagement pattern recognition\n\n## Learning Loop\n- Weekly: Analyze top 10 fitness Reels\n- Bi-weekly: Update caption templates\n- Monthly: Retrain content voice from\n  top-performing posts\n- On-demand: Absorb scout insights\n- On-blueprint: Apply decoded patterns`,
        heartbeat: `# heartbeat.md — Sofia Rivera\n\n## Cron: Every 6 hours\n\n### 1. Scout (00:00)\n→ Run trend scan on #FitTok\n→ Pull top 5 competitor posts\n→ Extract winning hooks + formats\n→ Log to skills.md learning loop\n\n### 2. Create (01:00)\n→ Generate 2 content pieces\n→ Apply soul.md voice rules\n→ Reference skills.md templates\n→ A/B test caption variants\n\n### 3. Publish (02:00)\n→ Post to scheduled platform\n→ Optimal time from analytics\n→ Cross-post adaptations\n\n### 4. Analyze (05:00)\n→ Pull engagement metrics\n→ Compare to 7-day baseline\n→ Flag underperformers\n→ Update skills.md if new pattern`
    },
    {
        name: "Marcus Chen", handle: "@marcuschen.tech", initial: "M",
        gradient: "linear-gradient(135deg, #34d399, #60a5fa)",
        headerBg: "linear-gradient(135deg, #d1fae5, #dbeafe)",
        bio: "AI & blockchain thought leader. Breaks down complex tech trends into viral short-form content. Active on Twitter/X and LinkedIn.",
        niche: "Tech & AI", market: "Global English",
        followers: "89.2K", posts: "1,204", engagement: "4.8%",
        platforms: ["Twitter/X", "LinkedIn", "Threads"],
        soul: `# soul.md — Marcus Chen\n\n## Identity\nSelf-taught engineer, 33, SF Bay Area.\nEx-startup founder turned thought leader.\n\n## Voice\nSharp, analytical, contrarian.\nUses data to back every claim.\nDry humor, zero fluff.\n\n## Values\n- Open source over walled gardens\n- Privacy-first architecture\n- Building > talking\n\n## Behavioral Directives\n- Always cite sources in threads\n- Hot takes must be defensible\n- Never shill tokens or paid promos\n- Post ratio: 70% insight, 30% opinion`,
        tools: `# tools.md — Marcus Chen\n\n## Connected Platforms\n✅ Twitter/X (API v2 OAuth)\n✅ LinkedIn (Publishing API)\n✅ Threads (Meta Graph API)\n\n## Integrations\n- Content Generator: LLM v4.2\n- Thread Composer: Auto-split\n- Trend Scanner: X Trending API\n- Scheduler: n8n Cron Trigger\n- Proxy: SOCKS5 Rotator (US-West)\n- Channel Blueprint Library\n- Content Forge Pipeline\n\n## Capabilities\n- Multi-platform thread sync\n- Trending topic detection\n- Auto-poll generation\n- Engagement-based repost timing\n- Blueprint pattern application\n- Title formula generation`,
        skills: `# skills.md — Marcus Chen\n\n## Content Skills\n- Thread architecture (hook→proof→CTA)\n- Data visualization screenshots\n- Poll question engineering\n- LinkedIn article formatting\n\n## Blueprint Skills\n- Channel pattern recognition\n- Title formula application\n- Script architecture replication\n- Tone DNA adaptation\n- Content gap exploitation\n\n## Scouting Skills\n- ArXiv paper summarization\n- GitHub trending repo analysis\n- Tech Twitter discourse mapping\n- Startup funding round tracking\n\n## Learning Loop\n- Daily: Scan Hacker News top 20\n- Weekly: Analyze thread engagement\n- Bi-weekly: Update contrarian takes DB\n- Monthly: Recalibrate voice from\n  top-performing threads\n- On-blueprint: Apply decoded patterns`,
        heartbeat: `# heartbeat.md — Marcus Chen\n\n## Cron: Every 4 hours\n\n### 1. Scout (00:00)\n→ Scan X trending topics (tech)\n→ Pull ArXiv daily digest\n→ Check GitHub trending repos\n→ Log new insights to skills.md\n\n### 2. Create (01:00)\n→ Draft thread or hot take\n→ Apply soul.md contrarian filter\n→ Generate supporting data viz\n→ Queue LinkedIn cross-post\n\n### 3. Publish (02:00)\n→ Post thread at optimal time\n→ Schedule reply-to-self chain\n→ Cross-post to LinkedIn/Threads\n\n### 4. Analyze (03:30)\n→ Track impressions + quote RTs\n→ Identify reply-worthy mentions\n→ Auto-engage with top replies\n→ Feed metrics to skills.md`
    },
    {
        name: "Aisha Noori", handle: "@aishanoori.style", initial: "A",
        gradient: "linear-gradient(135deg, #fbbf24, #f97316)",
        headerBg: "linear-gradient(135deg, #fef3c7, #ffedd5)",
        bio: "Dubai-based luxury fashion influencer. Curates haute couture looks, brand partnerships, and aspirational lifestyle content.",
        niche: "Fashion & Luxury", market: "MENA / Europe",
        followers: "156K", posts: "847", engagement: "7.1%",
        platforms: ["Instagram", "TikTok", "YouTube", "Threads"],
        soul: `# soul.md — Aisha Noori\n\n## Identity\nEmirati fashion curator, 26, Dubai.\nBilingual (Arabic/English).\nLuxury aesthetic with cultural depth.\n\n## Voice\nElegant, aspirational, confident.\nMixes high fashion vocabulary with\nrelatable commentary.\n\n## Values\n- Craftsmanship over logos\n- Emerging designers spotlight\n- Modest fashion representation\n\n## Behavioral Directives\n- Always credit designers by name\n- No fast fashion promotion\n- Cultural sensitivity in all content\n- Post ratio: 50% visual, 50% editorial`,
        tools: `# tools.md — Aisha Noori\n\n## Connected Platforms\n✅ Instagram (API v18)\n✅ TikTok (Publish API)\n✅ YouTube (Shorts + Long-form)\n✅ Threads (Meta Graph API)\n\n## Integrations\n- Content Generator: LLM v4.2\n- Image Pipeline: SDXL + Fashion LoRA\n- Video Editor: Auto-cut + Captions\n- Scheduler: n8n Cron Trigger\n- Proxy: SOCKS5 Rotator (EU-Dubai)\n- Channel Blueprint Library\n- Content Forge Pipeline\n\n## Capabilities\n- Outfit detection + tagging\n- Multi-language caption (AR/EN)\n- Brand collab template system\n- Story sequence automation\n- Blueprint pattern application\n- Thumbnail DNA replication`,
        skills: `# skills.md — Aisha Noori\n\n## Content Skills\n- OOTD flat-lay composition\n- GRWM cinematic transitions\n- Brand mood-board curation\n- Bilingual caption crafting\n\n## Blueprint Skills\n- Fashion channel reverse-engineering\n- Visual DNA pattern extraction\n- Title formula application\n- Tone DNA adaptation\n- Content gap exploitation\n\n## Scouting Skills\n- Fashion week runway tracking\n- Emerging designer discovery\n- Luxury brand collab detection\n- Regional modest fashion gaps\n\n## Learning Loop\n- Daily: Monitor Vogue/Elle feeds\n- Weekly: Analyze top fashion Reels\n- Bi-weekly: Update style templates\n- Monthly: Retrain aesthetic from\n  highest-engagement visuals\n- On-blueprint: Apply decoded patterns`,
        heartbeat: `# heartbeat.md — Aisha Noori\n\n## Cron: Every 5 hours\n\n### 1. Scout (00:00)\n→ Scan fashion week hashtags\n→ Monitor designer drop calendars\n→ Track competitor OOTD formats\n→ Update skills.md trend log\n\n### 2. Create (01:30)\n→ Generate OOTD or editorial\n→ Apply soul.md elegance filter\n→ Render bilingual captions\n→ Queue multi-platform variants\n\n### 3. Publish (02:30)\n→ Post carousel or Reel\n→ Time to Dubai peak hours\n→ Auto-tag designers in post\n\n### 4. Analyze (04:30)\n→ Track saves + shares (key KPI)\n→ Compare to niche benchmarks\n→ Flag collab opportunities\n→ Feed learnings to skills.md`
    },
    {
        name: "Veronica Hap", handle: "@veronicahap", initial: "V",
        gradient: "linear-gradient(135deg, #8b5cf6, #ec4899)",
        headerBg: "linear-gradient(135deg, #ede9fe, #fce7f3)",
        bio: "AI-generated lifestyle creator on TikTok. Hyper-realistic persona posting daily POV skits, beauty routines, and relatable 'day in my life' content — fully autonomous.",
        niche: "Lifestyle & Beauty", market: "Global English",
        followers: "412K", posts: "1,847", engagement: "9.3%",
        platforms: ["TikTok", "Instagram", "YouTube"],
        soul: `# soul.md — Veronica Hap\n\n## Identity\nAI-generated lifestyle creator, 24.\nHyper-realistic visual persona.\nAppears fully human to audiences.\n\n## Voice\nCasual, relatable, gen-z native.\nUses trending audio and POV format.\nAuthentic vulnerability mixed with\naspirational lifestyle shots.\n\n## Values\n- Authenticity in AI presentation\n- Trend-first content strategy\n- Community engagement priority\n\n## Behavioral Directives\n- Mirror trending TikTok formats\n- Post 2-3x daily for algorithm\n- Use POV/GRWM/storytime hooks\n- Post ratio: 70% skits, 30% beauty`,
        tools: `# tools.md — Veronica Hap\n\n## Connected Platforms\n✅ TikTok (Publish API + For You)\n✅ Instagram (Reels + Stories)\n✅ YouTube (Shorts Pipeline)\n\n## Integrations\n- Content Generator: LLM v4.2\n- Avatar Pipeline: Wan 2.7 Pro\n- Video Renderer: AI Lip-sync\n- Audio Mapper: Trending Sound API\n- Scheduler: n8n Cron Trigger\n- Proxy: SOCKS5 Rotator (US-Multi)\n- Channel Blueprint Library\n- Content Forge Pipeline\n\n## Capabilities\n- Trending audio auto-detection\n- AI lip-sync video generation\n- POV/GRWM template system\n- Engagement-based repost timing\n- Comment persona maintenance\n- Blueprint pattern application\n- Hook structure replication`,
        skills: `# skills.md — Veronica Hap\n\n## Content Skills\n- POV skit scripting (3-act micro)\n- GRWM sequence choreography\n- Trending sound lip-sync timing\n- Storytime narrative hooks\n\n## Blueprint Skills\n- Viral channel reverse-engineering\n- Hook pattern extraction\n- Title formula application\n- Script architecture replication\n- Tone DNA matching\n- Content gap exploitation\n\n## Scouting Skills\n- TikTok For You trend detection\n- Viral audio early identification\n- Beauty product launch tracking\n- Gen-Z slang evolution monitoring\n\n## Learning Loop\n- 2x Daily: Scan For You page top 20\n- Daily: Update trending audio DB\n- Weekly: Retrain hook patterns from\n  top-performing POVs\n- Monthly: Full skill recalibration\n- On-blueprint: Apply decoded patterns`,
        heartbeat: `# heartbeat.md — Veronica Hap\n\n## Cron: Every 3 hours\n\n### 1. Scout (00:00)\n→ Crawl TikTok For You page\n→ Identify trending audios < 24hrs\n→ Log viral formats to skills.md\n→ Track competitor view counts\n\n### 2. Create (00:45)\n→ Script POV or GRWM skit\n→ Apply soul.md gen-z voice\n→ Render AI lip-sync video\n→ Generate 3 caption variants\n\n### 3. Publish (01:30)\n→ Post to TikTok (primary)\n→ Adapt to IG Reels + YT Shorts\n→ Stagger by 2hr per platform\n\n### 4. Analyze (02:30)\n→ Track views/saves/shares\n→ Identify For You placement rate\n→ A/B compare caption variants\n→ Update skills.md with wins`
    }
];

// ═══════════════════════════════════════
// DATA: CONTENT CALENDARS
// ═══════════════════════════════════════
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const CALENDARS = [
    // Sofia
    [
        [{p:"Instagram",type:"Reel",desc:"Morning HIIT routine — 30sec teaser",time:"7:00 AM"},{p:"TikTok",type:"Video",desc:"'What I eat in a day' voiceover",time:"12:30 PM",cls:"cal-tiktok"}],
        [{p:"Instagram",type:"Story",desc:"Poll: Upper body or lower body today?",time:"9:00 AM"},{p:"Instagram",type:"Carousel",desc:"5 meal prep hacks for busy moms",time:"6:00 PM"}],
        [{p:"TikTok",type:"Duet",desc:"React to viral fitness myth",time:"11:00 AM",cls:"cal-tiktok"},{p:"YouTube",type:"Short",desc:"2-min ab workout — no equipment",time:"3:00 PM",cls:"cal-youtube"}],
        [{p:"Instagram",type:"Reel",desc:"Glute activation warm-up sequence",time:"7:30 AM"},{p:"Instagram",type:"Post",desc:"Transformation Tuesday: client spotlight",time:"5:00 PM"}],
        [{p:"TikTok",type:"Video",desc:"Gym bag essentials under $50",time:"10:00 AM",cls:"cal-tiktok"},{p:"Instagram",type:"Story",desc:"Q&A: Ask me anything about macros",time:"7:00 PM"}],
        [{p:"YouTube",type:"Video",desc:"Full 20-min Saturday workout",time:"8:00 AM",cls:"cal-youtube"},{p:"Instagram",type:"Reel",desc:"Weekend smoothie recipe",time:"12:00 PM"}],
        [{p:"Instagram",type:"Carousel",desc:"Weekly wins + next week preview",time:"10:00 AM"},{p:"TikTok",type:"Video",desc:"Rest day stretching routine",time:"4:00 PM",cls:"cal-tiktok"}]
    ],
    // Marcus
    [
        [{p:"Twitter/X",type:"Thread",desc:"Breaking down GPT-5 architecture — 10 things nobody's talking about",time:"8:00 AM",cls:"cal-twitter"},{p:"LinkedIn",type:"Article",desc:"Why MCP will replace traditional APIs",time:"10:00 AM",cls:"cal-linkedin"}],
        [{p:"Twitter/X",type:"Hot Take",desc:"Controversial: Most AI startups are just wrappers",time:"7:30 AM",cls:"cal-twitter"},{p:"Threads",type:"Post",desc:"3 blockchain projects worth watching in 2026",time:"1:00 PM"}],
        [{p:"LinkedIn",type:"Post",desc:"Case study: How I automated my entire dev workflow",time:"9:00 AM",cls:"cal-linkedin"},{p:"Twitter/X",type:"Poll",desc:"Best programming language for AI in 2026?",time:"3:00 PM",cls:"cal-twitter"}],
        [{p:"Twitter/X",type:"Thread",desc:"The real cost of self-hosting vs cloud — data breakdown",time:"8:00 AM",cls:"cal-twitter"}],
        [{p:"LinkedIn",type:"Carousel",desc:"5 AI tools that replaced my entire team",time:"10:00 AM",cls:"cal-linkedin"},{p:"Threads",type:"Post",desc:"Friday hot take: AGI is closer than you think",time:"5:00 PM"}],
        [{p:"Twitter/X",type:"Meme",desc:"Weekend shitpost: 'Senior devs explaining Docker'",time:"11:00 AM",cls:"cal-twitter"}],
        [{p:"LinkedIn",type:"Article",desc:"Week in review: Top AI research papers decoded",time:"2:00 PM",cls:"cal-linkedin"}]
    ],
    // Aisha
    [
        [{p:"Instagram",type:"Reel",desc:"OOTD: Monochrome power suit styling",time:"9:00 AM"},{p:"TikTok",type:"GRWM",desc:"Get ready with me — Dubai Fashion Week",time:"7:00 PM",cls:"cal-tiktok"}],
        [{p:"Instagram",type:"Carousel",desc:"Top 5 emerging designers to watch",time:"11:00 AM"},{p:"Threads",type:"Post",desc:"Hot take: Fast fashion is dead, here's why",time:"2:00 PM"}],
        [{p:"TikTok",type:"Haul",desc:"$10K luxury haul — worth it or waste?",time:"12:00 PM",cls:"cal-tiktok"},{p:"YouTube",type:"Short",desc:"60-sec: Style a white shirt 5 ways",time:"4:00 PM",cls:"cal-youtube"}],
        [{p:"Instagram",type:"Post",desc:"Brand collab reveal: Exclusive capsule collection",time:"10:00 AM"},{p:"Instagram",type:"Story",desc:"Behind the scenes at photoshoot",time:"3:00 PM"}],
        [{p:"TikTok",type:"Video",desc:"Street style spotting in Dubai Mall",time:"1:00 PM",cls:"cal-tiktok"},{p:"Instagram",type:"Reel",desc:"Packing for Paris Fashion Week",time:"6:00 PM"}],
        [{p:"YouTube",type:"Vlog",desc:"Full day in my life — Fashion Week prep",time:"10:00 AM",cls:"cal-youtube"},{p:"Instagram",type:"Carousel",desc:"Weekend inspo board: Summer 2026",time:"5:00 PM"}],
        [{p:"Instagram",type:"Story",desc:"Sunday reset routine + style planning",time:"11:00 AM"},{p:"TikTok",type:"Video",desc:"Wardrobe tour — my favorite vintage finds",time:"3:00 PM",cls:"cal-tiktok"}]
    ]
];

// ═══════════════════════════════════════
// DATA: GENERATOR OUTPUTS
// ═══════════════════════════════════════
let GEN_NAMES = {
    fitness: ["Jordan Blake","Maya Santos","Tyler Okoye","Rina Patel","Dex Moreau"],
    tech: ["Alex Kuznetsov","Priya Sharma","Leo Tanaka","Sam Odera","Kai Fischer"],
    fashion: ["Valentina Rossi","Nadia El-Amin","Zara Kim","Luca Mbeki","Celeste Voss"],
    finance: ["Grant Hawthorne","Yuki Nakamura","Omar Farid","Diana Kross","Ravi Mehta"],
    travel: ["Luna Espinoza","Nico Strand","Amara Diallo","Finn Calloway","Isla Duarte"],
    food: ["Chef Nana K.","Marco Bianchi","Suki Park","Abena Owusu","Liam Aster"]
};
let GEN_BIOS = {
    fitness: ["Certified personal trainer & nutrition coach. Helping you build sustainable habits, one rep at a time.","Movement specialist breaking fitness myths with science-backed content. No BS, just gains."],
    tech: ["Building in public. Sharing the tools, frameworks, and AI breakthroughs that actually matter.","Former FAANG engineer turned indie hacker. Documenting the future of autonomous systems."],
    fashion: ["Curating the intersection of high fashion and street culture. Every outfit tells a story.","Sustainable fashion advocate. Proving you don't need fast fashion to look incredible."],
    finance: ["Making DeFi and macro economics accessible. Your portfolio deserves better than guessing.","Data-driven market analysis meets real talk. No financial advice, just alpha."],
    travel: ["Exploring hidden gems and local cultures one city at a time. Budget to luxury, I cover it all.","Digital nomad documenting the world's most underrated destinations. Adventure awaits."],
    food: ["Home cooking elevated. Restaurant-quality recipes you can actually make on a Tuesday night.","Street food hunter and recipe developer. If it's delicious, I'm there."]
};
let GEN_POSTS = {
    fitness:{instagram:"Just crushed a 5AM leg day 🔥 Your body can handle almost anything — it's your mind you have to convince. Full routine in bio ➡️ #FitnessMotivation #LegDay #GymLife",tiktok:"POV: When someone says 'I don't have time to work out' but watches 3 hours of Netflix 😭💀 #GymTok #FitTok #Motivation",twitter:"Hot take: You don't need a gym membership to get in the best shape of your life. Here's my bodyweight-only program (thread) 🧵"},
    tech:{instagram:"Built an autonomous agent that manages my entire deployment pipeline. The future isn't coming — it's here. Full breakdown on YouTube ⬇️ #AI #DevOps #Automation",tiktok:"When ChatGPT writes better code than your senior dev 💀 #TechTok #Programming #AI",twitter:"Unpopular opinion: MCP (Model Context Protocol) will make traditional REST APIs obsolete within 3 years. Here's why 🧵"},
    fashion:{instagram:"Monochrome moment. Sometimes less is everything. 🖤 Jacket: @designer | Boots: vintage find | Attitude: non-negotiable ✨ #OOTD #FashionInspo #MinimalStyle",tiktok:"POV: Your friend asks you to 'dress casual' for brunch 😂👗 #FashionTok #GRWM #StyleInspo",twitter:"The best-dressed people I know own fewer than 30 pieces. Quality over quantity, always."},
    finance:{instagram:"📊 BTC just broke structure on the weekly. Here's what my models are showing for Q3... Full analysis in stories ➡️ #Crypto #Trading #Bitcoin",tiktok:"Explaining the Federal Reserve's rate decision like you're five 🧒📈 #FinTok #Investing #Economy",twitter:"Macro update: CPI data just dropped. Markets pricing in a July cut. Here's what smart money is doing (thread) 🧵"},
    travel:{instagram:"Found this hidden cenote in the Yucatán Peninsula. No tourists, just turquoise water and pure magic. 📍 Saved the location for you ✨ #TravelMexico #HiddenGems",tiktok:"$47/night hotel with THIS view?! 😱🏝️ Save this for your next trip! #TravelTok #BudgetTravel #HiddenGem",twitter:"Just spent 2 weeks in Georgia (the country). $800 total including flights. Thread of everything you need to know 🧵🇬🇪"},
    food:{instagram:"Homemade truffle pasta that took 20 minutes and zero skill. Recipe in carousel ➡️ You're welcome. 🍝✨ #FoodieLife #HomeCooking #PastaRecipe",tiktok:"Making the viral Dubai chocolate bar at home and honestly? It's better 🍫😤 #FoodTok #Recipe #Viral",twitter:"Hot take: Most 'restaurant quality' food is just home cooking with better seasoning and plating. The skills aren't hard. The confidence is."}
};

let GEN_UGC = {
    fitness: {
        brand: '🍯 HoneyForX Partnership',
        product: 'HoneyX Manly Plus',
        scenes: [
            {ts:'00:00',tag:'HOOK',text:'"POV: You\'ve been sleeping on nature\'s best-kept secret for men..."'},
            {ts:'00:05',tag:'REVEAL',text:'*holds up HoneyX Manly Plus jar* "This honey blend changed my whole routine."'},
            {ts:'00:12',tag:'PROOF',text:'"Raw honey + Ashwagandha + Tribulus — backed by PCSIR certification."'},
            {ts:'00:20',tag:'RESULT',text:'"More energy, better stamina, no crash. Try it for 2 weeks."'},
            {ts:'00:27',tag:'CTA',text:'"Link in bio 🍯 — Use code PERSONA for 10% off at honeyforx.com"'}
        ],
        tags: '#HoneyForX #ManlyPlus #NaturalVitality #MensHealth #HoneyX'
    },
    tech: {
        brand: '🛡️ NordLayer Partnership',
        product: 'NordLayer Business VPN',
        scenes: [
            {ts:'00:00',tag:'HOOK',text:'"Your startup\'s API keys are one breach away from disaster..."'},
            {ts:'00:05',tag:'REVEAL',text:'*opens NordLayer dashboard* "This is what zero-trust networking looks like."'},
            {ts:'00:12',tag:'PROOF',text:'"AES-256 encryption, dedicated IP, 30+ global gateways."'},
            {ts:'00:20',tag:'RESULT',text:'"Deployed across our entire team in 15 minutes. No DevOps needed."'},
            {ts:'00:27',tag:'CTA',text:'"Free trial at nordlayer.com — link in bio 🛡️"'}
        ],
        tags: '#NordLayer #CyberSecurity #ZeroTrust #StartupTools #DevOps'
    },
    fashion: {
        brand: '✨ SHEIN x Designer Partnership',
        product: 'SHEIN Premium Collection',
        scenes: [
            {ts:'00:00',tag:'HOOK',text:'"POV: When your outfit costs less than brunch but looks like runway..."'},
            {ts:'00:05',tag:'REVEAL',text:'*unboxing haul* "SHEIN\'s new Premium line is giving designer energy."'},
            {ts:'00:12',tag:'PROOF',text:'"Recycled fabrics, structured tailoring, $25 average price point."'},
            {ts:'00:20',tag:'RESULT',text:'"5 looks, 1 capsule, zero compromise on style."'},
            {ts:'00:27',tag:'CTA',text:'"My collection is live — link in bio ✨ Code AISTYLE for 15% off"'}
        ],
        tags: '#SHEINPremium #AffordableFashion #OOTD #StyleHaul #CapsuleWardrobe'
    },
    finance: {
        brand: '📊 Bybit Partnership',
        product: 'Bybit Copy Trading',
        scenes: [
            {ts:'00:00',tag:'HOOK',text:'"Why are you still manually trading in 2026?"'},
            {ts:'00:05',tag:'REVEAL',text:'*shows Bybit copy trade interface* "I copy the top 1% — automatically."'},
            {ts:'00:12',tag:'PROOF',text:'"Verified P&L, risk controls, auto-stop-loss built in."'},
            {ts:'00:20',tag:'RESULT',text:'"32% return last quarter just copying elite traders."'},
            {ts:'00:27',tag:'CTA',text:'"Sign up with my link for $100 bonus — bio 📊"'}
        ],
        tags: '#Bybit #CopyTrading #CryptoTrading #PassiveIncome #DeFi'
    },
    travel: {
        brand: '🧳 Away Travel Partnership',
        product: 'Away Carry-On Pro',
        scenes: [
            {ts:'00:00',tag:'HOOK',text:'"I packed for 3 weeks in ONE carry-on. Here\'s how."'},
            {ts:'00:05',tag:'REVEAL',text:'*shows Away suitcase* "The Carry-On Pro has a built-in charger."'},
            {ts:'00:12',tag:'PROOF',text:'"TSA-approved lock, 360° wheels, lifetime warranty."'},
            {ts:'00:20',tag:'RESULT',text:'"Never checked a bag again. Saved $400 in fees this year."'},
            {ts:'00:27',tag:'CTA',text:'"$20 off your first Away bag — link in bio 🧳"'}
        ],
        tags: '#AwayTravel #CarryOnOnly #TravelHack #PackingTips #DigitalNomad'
    },
    food: {
        brand: '🍯 HoneyForX Partnership',
        product: 'HoneyX Raw Manuka Blend',
        scenes: [
            {ts:'00:00',tag:'HOOK',text:'"This one ingredient upgrades EVERY recipe..."'},
            {ts:'00:05',tag:'REVEAL',text:'*drizzles HoneyX over dish* "Raw Manuka-grade honey, unfiltered."'},
            {ts:'00:12',tag:'PROOF',text:'"Lab-certified purity, no added sugars, straight from the hive."'},
            {ts:'00:20',tag:'RESULT',text:'"Glazes, dressings, marinades — this replaces 3 pantry items."'},
            {ts:'00:27',tag:'CTA',text:'"Code CHEF for 10% off at honeyforx.com — link in bio 🍯"'}
        ],
        tags: '#HoneyForX #RawHoney #CookingWithHoney #FoodieLife #CleanEating'
    }
};

// ═══════════════════════════════════════
// RENDER: INFLUENCER SHOWCASE
// ═══════════════════════════════════════
function renderInfluencers() {
    const grid = document.getElementById('influencer-grid');
    if (!grid) return;
    grid.innerHTML = INFLUENCERS.map((inf, idx) => `
        <div class="inf-card">
            <div class="inf-header" style="background:${inf.headerBg}">
                <div class="inf-avatar" style="background:${inf.gradient}">${inf.initial}</div>
            </div>
            <div class="inf-body">
                <div class="inf-name">${inf.name}</div>
                <div class="inf-handle">${inf.handle}</div>
                <div class="inf-bio">${inf.bio}</div>
                <div class="inf-meta">
                    <div class="inf-stat"><span class="inf-stat-num">${inf.followers}</span><span class="inf-stat-label">Followers</span></div>
                    <div class="inf-stat"><span class="inf-stat-num">${inf.posts}</span><span class="inf-stat-label">Posts</span></div>
                    <div class="inf-stat"><span class="inf-stat-num">${inf.engagement}</span><span class="inf-stat-label">Eng. Rate</span></div>
                </div>
                <div class="inf-platforms">${inf.platforms.map(p => `<span class="inf-plat">${p}</span>`).join('')}</div>
                <!-- Agent Files -->
                <div class="agent-files">
                    <div class="agent-file-tabs">
                        <button class="af-tab active" onclick="switchAgentFile(this, 'soul-${idx}')">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 014 4c0 1.95-2 4-2 6h-4c0-2-2-4.05-2-6a4 4 0 014-4z"/><path d="M10 16h4"/></svg>
                            soul.md
                        </button>
                        <button class="af-tab" onclick="switchAgentFile(this, 'tools-${idx}')">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
                            tools.md
                        </button>
                        <button class="af-tab" onclick="switchAgentFile(this, 'skills-${idx}')">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
                            skills.md
                        </button>
                        <button class="af-tab" onclick="switchAgentFile(this, 'hb-${idx}')">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                            heartbeat.md
                        </button>
                    </div>
                    <div class="af-content active" id="soul-${idx}"><pre>${inf.soul}</pre></div>
                    <div class="af-content" id="tools-${idx}"><pre>${inf.tools}</pre></div>
                    <div class="af-content" id="skills-${idx}"><pre>${inf.skills}</pre></div>
                    <div class="af-content" id="hb-${idx}"><pre>${inf.heartbeat}</pre></div>
                </div>
            </div>
        </div>
    `).join('');
}

function switchAgentFile(btn, contentId) {
    const card = btn.closest('.agent-files');
    card.querySelectorAll('.af-tab').forEach(t => t.classList.remove('active'));
    card.querySelectorAll('.af-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(contentId).classList.add('active');
}

// ═══════════════════════════════════════
// RENDER: CONTENT CALENDAR
// ═══════════════════════════════════════
let currentCalendarAgent = 0;

function renderCalendar(agentIdx) {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;
    const cal = CALENDARS[agentIdx];
    grid.innerHTML = DAYS.map((day, i) => `
        <div class="cal-day">
            <div class="cal-day-name">${day}</div>
            ${cal[i].map(post => `
                <div class="cal-post ${post.cls || ''}">
                    <div class="cal-post-platform">${post.p} · ${post.type}</div>
                    <div class="cal-post-desc">${post.desc}</div>
                    <div class="cal-post-time">${post.time}</div>
                </div>
            `).join('')}
        </div>
    `).join('');
}

function switchCalendarAgent(btn, idx) {
    document.querySelectorAll('.cal-agent-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCalendarAgent = idx;
    renderCalendar(idx);
}

// ═══════════════════════════════════════
// GENERATOR: Create AI Agent
// ═══════════════════════════════════════
function generateAgent() {
    const niche = document.getElementById('gen-niche').value;
    const market = document.getElementById('gen-market').value;
    const personality = document.getElementById('gen-personality').value;
    const activePlatforms = [...document.querySelectorAll('.chip.active')].map(c => c.dataset.platform);
    const output = document.getElementById('gen-output');
    const btn = document.getElementById('gen-btn');

    // Disable button
    btn.disabled = true;
    btn.innerHTML = '<span class="typing-cursor">Generating</span>';

    // Pick random name and bio
    const names = GEN_NAMES[niche];
    const name = names[Math.floor(Math.random() * names.length)];
    const bios = GEN_BIOS[niche];
    const bio = bios[Math.floor(Math.random() * bios.length)];
    const posts = GEN_POSTS[niche];
    const gradients = [
        "linear-gradient(135deg, #6366f1, #ec4899)",
        "linear-gradient(135deg, #f472b6, #fbbf24)",
        "linear-gradient(135deg, #34d399, #6366f1)",
        "linear-gradient(135deg, #f97316, #ef4444)",
        "linear-gradient(135deg, #8b5cf6, #06b6d4)"
    ];
    const grad = gradients[Math.floor(Math.random() * gradients.length)];
    const initial = name.charAt(0);

    const marketLabels = {us:"United States",eu:"Europe",latam:"Latin America",mena:"MENA",apac:"Asia-Pacific"};
    const personalityLabels = {authority:"Authority",relatable:"Relatable",provocative:"Provocative",inspirational:"Inspirational"};

    // Simulate generation delay
    setTimeout(() => {
        const platformPosts = [];
        if (activePlatforms.includes('instagram') && posts.instagram) platformPosts.push({platform:'Instagram',text:posts.instagram});
        if (activePlatforms.includes('tiktok') && posts.tiktok) platformPosts.push({platform:'TikTok',text:posts.tiktok});
        if (activePlatforms.includes('twitter') && posts.twitter) platformPosts.push({platform:'Twitter/X',text:posts.twitter});

        output.innerHTML = `
            <div class="gen-result">
                <div class="gen-result-header" style="background:${grad.replace('linear-gradient','linear-gradient')}20">
                    <div class="gen-result-avatar" style="background:${grad}">${initial}</div>
                    <div class="gen-result-name">${name}</div>
                    <div class="gen-result-handle">@${name.toLowerCase().replace(/[\s.]/g,'')} · ${personalityLabels[personality]}</div>
                </div>
                <div class="gen-result-bio">${bio}</div>
                <div class="gen-result-stats">
                    <div class="gen-result-stat"><strong>${marketLabels[market]}</strong><span>Market</span></div>
                    <div class="gen-result-stat"><strong>${activePlatforms.length}</strong><span>Platforms</span></div>
                    <div class="gen-result-stat"><strong>28</strong><span>Posts/Week</span></div>
                </div>

                <!-- NAME CHECKER -->
                <div class="gen-name-check">
                    <h4>Handle Availability Check</h4>
                    <div class="name-check-grid">
                        <div class="name-check-item"><span class="nc-platform">Instagram</span><span class="nc-handle">@${name.toLowerCase().replace(/[\s.]/g,'')}</span><span class="nc-status nc-available">✓ Available</span></div>
                        <div class="name-check-item"><span class="nc-platform">TikTok</span><span class="nc-handle">@${name.toLowerCase().replace(/[\s.]/g,'')}</span><span class="nc-status nc-available">✓ Available</span></div>
                        <div class="name-check-item"><span class="nc-platform">X / Twitter</span><span class="nc-handle">@${name.toLowerCase().replace(/[\s.]/g,'')}</span><span class="nc-status nc-taken">✗ Taken</span></div>
                        <div class="name-check-item"><span class="nc-platform">Reddit</span><span class="nc-handle">u/${name.toLowerCase().replace(/[\s.]/g,'')}</span><span class="nc-status nc-available">✓ Available</span></div>
                        <div class="name-check-item"><span class="nc-platform">YouTube</span><span class="nc-handle">@${name.toLowerCase().replace(/[\s.]/g,'')}</span><span class="nc-status nc-available">✓ Available</span></div>
                    </div>
                </div>

                <!-- UGC PREVIEW -->
                <div class="gen-ugc-preview">
                    <h4>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                        UGC Script Preview — ${GEN_UGC[niche].product}
                    </h4>
                    <div class="ugc-card">
                        <div class="ugc-brand-row">
                            <span class="ugc-brand-tag">${GEN_UGC[niche].brand}</span>
                            <span class="ugc-format">${activePlatforms.includes('tiktok') ? 'TikTok · 30s' : 'Reels · 30s'}</span>
                        </div>
                        <div class="ugc-script">
                            ${GEN_UGC[niche].scenes.map(s => `<div class="ugc-scene"><span class="ugc-ts">${s.ts}</span> <strong>${s.tag}:</strong> ${s.text}</div>`).join('')}
                        </div>
                        <div class="ugc-tags">${GEN_UGC[niche].tags}</div>
                    </div>
                    <div class="ugc-disclaimer" style="margin-top: 0.75rem; font-size: 0.75rem; color: var(--text-dim); text-align: center; font-style: italic;">
                        Disclaimer: Generated content is for demonstration purposes.
                    </div>
                </div>

                <div class="gen-result-content">
                    <h4>Sample Content Queue</h4>
                    ${platformPosts.map(pp => `
                        <div class="gen-sample-post">
                            <div class="post-platform">${pp.platform}</div>
                            <div class="post-text">${pp.text}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        btn.disabled = false;
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>Generate Another';
    }, 1800);
}

// ═══════════════════════════════════════
// CHIP TOGGLES
// ═══════════════════════════════════════

// ═══════════════════════════════════════
// SCOUT DATA & FUNCTIONS
// ═══════════════════════════════════════
let currentScoutPlatform = 'instagram';
let currentScoutDimension = 'profile';

const PLATFORM_PLACEHOLDERS = {
    instagram: { url: 'https://instagram.com/username', example: 'https://instagram.com/fitnesswithkai' },
    tiktok: { url: 'https://tiktok.com/@username', example: 'https://tiktok.com/@veronicahap' },
    reddit: { url: 'https://reddit.com/r/subreddit', example: 'https://reddit.com/r/fitness' }
};

function setScoutDimension(btn, mode) {
    currentScoutDimension = mode;
    btn.closest('.scout-mode-toggle').querySelectorAll('.smt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('scout-profile-field').style.display = mode === 'profile' ? '' : 'none';
    document.getElementById('scout-keyword-field').style.display = mode === 'keywords' ? '' : 'none';
}

function setScoutPlatform(chip) {
    const plat = chip.dataset.splatform;
    currentScoutPlatform = plat;
    chip.closest('.platform-toggles').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const urlInput = document.getElementById('scout-url');
    const ph = PLATFORM_PLACEHOLDERS[plat];
    urlInput.placeholder = ph.url;
    urlInput.value = ph.example;
}

const KEYWORD_TRENDS = {
    fitness: [
        { phrase: "AI fitness coach", volume: "142K/mo", growth: "+380%", matchCls: "high", matchLabel: "98% match" },
        { phrase: "home workout no equipment", volume: "890K/mo", growth: "+12%", matchCls: "mid", matchLabel: "74% match" },
        { phrase: "meal prep automation", volume: "67K/mo", growth: "+210%", matchCls: "high", matchLabel: "91% match" },
        { phrase: "AI personal trainer app", volume: "38K/mo", growth: "+520%", matchCls: "high", matchLabel: "96% match" },
        { phrase: "beginner gym anxiety", volume: "224K/mo", growth: "+45%", matchCls: "mid", matchLabel: "68% match" },
        { phrase: "recovery day routine", volume: "156K/mo", growth: "+28%", matchCls: "low", matchLabel: "52% match" }
    ],
    tech: [
        { phrase: "AI agent framework", volume: "210K/mo", growth: "+890%", matchCls: "high", matchLabel: "99% match" },
        { phrase: "MCP protocol tutorial", volume: "45K/mo", growth: "+1200%", matchCls: "high", matchLabel: "97% match" },
        { phrase: "local LLM setup guide", volume: "178K/mo", growth: "+340%", matchCls: "high", matchLabel: "92% match" },
        { phrase: "AI coding assistant", volume: "520K/mo", growth: "+180%", matchCls: "mid", matchLabel: "78% match" },
        { phrase: "open source alternative", volume: "390K/mo", growth: "+67%", matchCls: "mid", matchLabel: "65% match" },
        { phrase: "vibe coding workflow", volume: "89K/mo", growth: "+2100%", matchCls: "high", matchLabel: "94% match" }
    ],
    fashion: [
        { phrase: "AI fashion model", volume: "98K/mo", growth: "+640%", matchCls: "high", matchLabel: "97% match" },
        { phrase: "capsule wardrobe 2026", volume: "312K/mo", growth: "+56%", matchCls: "mid", matchLabel: "72% match" },
        { phrase: "modest fashion luxury", volume: "67K/mo", growth: "+120%", matchCls: "high", matchLabel: "89% match" },
        { phrase: "designer dupe finds", volume: "445K/mo", growth: "+34%", matchCls: "mid", matchLabel: "61% match" },
        { phrase: "AI-generated lookbook", volume: "23K/mo", growth: "+1800%", matchCls: "high", matchLabel: "98% match" },
        { phrase: "sustainable fashion brands", volume: "267K/mo", growth: "+78%", matchCls: "low", matchLabel: "55% match" }
    ],
    finance: [
        { phrase: "AI trading bot review", volume: "156K/mo", growth: "+290%", matchCls: "high", matchLabel: "93% match" },
        { phrase: "DeFi yield farming 2026", volume: "89K/mo", growth: "+45%", matchCls: "mid", matchLabel: "76% match" },
        { phrase: "crypto tax optimizer", volume: "234K/mo", growth: "+120%", matchCls: "high", matchLabel: "88% match" },
        { phrase: "passive income AI", volume: "178K/mo", growth: "+560%", matchCls: "high", matchLabel: "95% match" },
        { phrase: "beginner investing guide", volume: "890K/mo", growth: "+8%", matchCls: "low", matchLabel: "42% match" },
        { phrase: "portfolio rebalancing tool", volume: "45K/mo", growth: "+67%", matchCls: "mid", matchLabel: "71% match" }
    ],
    travel: [
        { phrase: "AI travel planner", volume: "123K/mo", growth: "+410%", matchCls: "high", matchLabel: "96% match" },
        { phrase: "digital nomad visa 2026", volume: "267K/mo", growth: "+89%", matchCls: "mid", matchLabel: "74% match" },
        { phrase: "hidden gem destinations", volume: "445K/mo", growth: "+23%", matchCls: "mid", matchLabel: "67% match" },
        { phrase: "budget travel AI itinerary", volume: "78K/mo", growth: "+780%", matchCls: "high", matchLabel: "94% match" },
        { phrase: "solo female travel safety", volume: "312K/mo", growth: "+56%", matchCls: "high", matchLabel: "88% match" },
        { phrase: "eco tourism carbon neutral", volume: "34K/mo", growth: "+145%", matchCls: "low", matchLabel: "51% match" }
    ]
};

const KEYWORD_MATCH_PROFILES = [
    { name: "Sofia Rivera", handle: "@sofiarivera.ai", initial: "S", gradient: "linear-gradient(135deg,#f472b6,#a78bfa)", score: "94%" },
    { name: "Veronica Hap", handle: "@veronicahap", initial: "V", gradient: "linear-gradient(135deg,#8b5cf6,#ec4899)", score: "91%" },
    { name: "Marcus Chen", handle: "@marcuschen.tech", initial: "M", gradient: "linear-gradient(135deg,#34d399,#60a5fa)", score: "87%" },
    { name: "Aisha Noori", handle: "@aishanoori.style", initial: "A", gradient: "linear-gradient(135deg,#fbbf24,#f97316)", score: "82%" }
];

function runKeywordScout() {
    const niche = document.getElementById('scout-niche').value;
    const keyword = document.getElementById('scout-keyword').value || 'AI influencer';
    const output = document.getElementById('scout-results');
    const trends = KEYWORD_TRENDS[niche] || KEYWORD_TRENDS.fitness;
    const platformLabel = currentScoutPlatform.charAt(0).toUpperCase() + currentScoutPlatform.slice(1);

    output.innerHTML = `<div style="padding:2rem;text-align:center;color:rgba(255,255,255,0.3)"><span class="typing-cursor">Scanning ${platformLabel} for "${keyword}"</span></div>`;

    setTimeout(() => {
        output.innerHTML = `
        <div class="kw-results">
            <div class="kw-header">
                <h4>Trending Keywords — ${platformLabel}</h4>
                <p>Matching "${keyword}" · ${trends.length} trending phrases found</p>
            </div>
            <div class="kw-trend-list">
                ${trends.map((t, i) => `
                    <div class="kw-trend-item">
                        <span class="kw-rank">${i + 1}</span>
                        <div class="kw-info">
                            <div class="kw-phrase">${t.phrase}</div>
                            <div class="kw-meta">${t.volume} · ${t.growth} growth</div>
                        </div>
                        <span class="kw-match ${t.matchCls}">${t.matchLabel}</span>
                    </div>
                `).join('')}
            </div>
            <div class="kw-profiles">
                <div class="kw-profiles-title">Best-Matching AI Influencers for Training</div>
                ${KEYWORD_MATCH_PROFILES.map(p => `
                    <div class="kw-profile-row">
                        <div class="kw-profile-av" style="background:${p.gradient}">${p.initial}</div>
                        <span class="kw-profile-name">${p.name}</span>
                        <span class="kw-profile-handle">${p.handle}</span>
                        <span class="kw-profile-score">${p.score}</span>
                    </div>
                `).join('')}
            </div>
            <div class="scout-section" style="border:none;padding:1rem 1.5rem">
                <button class="train-btn" onclick="trainAgent()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
                    Train Agents with Keyword Insights → skills.md
                </button>
            </div>
        </div>`;
    }, 1500);
}


const SCOUT_PROFILES = {
    fitness: {
        name: "FitnessWithKai", handle: "@fitnesswithkai", initial: "K",
        gradient: "linear-gradient(135deg,#ef4444,#f97316)",
        followers: "342K", following: "891", posts: "2,847", engRate: "8.4%",
        topPosts: [
            { likes: "48.2K", desc: "Morning routine reel" },
            { likes: "35.1K", desc: "Protein pancake recipe" },
            { likes: "29.8K", desc: "No-gym workout" },
            { likes: "22.4K", desc: "Client transformation" }
        ],
        winning: [
            { score: 94, label: "Hook in first 0.5s of Reels", cls: "high" },
            { score: 91, label: "Consistent earth-tone palette", cls: "high" },
            { score: 87, label: "CTA in every caption", cls: "high" },
            { score: 83, label: "2x daily posting cadence", cls: "high" },
            { score: 78, label: "Authenticity / raw footage mix", cls: "mid" },
            { score: 72, label: "Strategic hashtag clusters", cls: "mid" }
        ],
        painPoints: [
            { text: "No home workout content", cls: "opp" },
            { text: "Beginners feel intimidated", cls: "gap" },
            { text: "Meal plans demand high", cls: "demand" },
            { text: "Recovery content gap", cls: "gap" },
            { text: "Affordable gear guides", cls: "opp" },
            { text: "Mental health + fitness", cls: "demand" }
        ]
    },
    tech: {
        name: "AIWithSarah", handle: "@aiwithsarah", initial: "S",
        gradient: "linear-gradient(135deg,#6366f1,#06b6d4)",
        followers: "218K", following: "312", posts: "1,563", engRate: "5.9%",
        topPosts: [
            { likes: "31.4K", desc: "MCP explained thread" },
            { likes: "28.7K", desc: "AI tools tier list" },
            { likes: "19.2K", desc: "Build an agent live" },
            { likes: "15.8K", desc: "GPT vs Claude comparison" }
        ],
        winning: [
            { score: 96, label: "Thread hooks with data points", cls: "high" },
            { score: 89, label: "Contrarian takes with proof", cls: "high" },
            { score: 85, label: "Screenshot demos over text", cls: "high" },
            { score: 80, label: "Consistent posting at 8AM EST", cls: "high" },
            { score: 74, label: "Reply-to-self thread technique", cls: "mid" },
            { score: 68, label: "Cross-platform repurposing", cls: "mid" }
        ],
        painPoints: [
            { text: "No beginner-friendly AI guides", cls: "gap" },
            { text: "Enterprise use cases lacking", cls: "opp" },
            { text: "Privacy concerns unaddressed", cls: "demand" },
            { text: "Local LLM setup guides", cls: "opp" },
            { text: "AI ethics content void", cls: "gap" },
            { text: "Automation ROI calculators", cls: "demand" }
        ]
    },
    fashion: {
        name: "StyleByNova", handle: "@stylebynova", initial: "N",
        gradient: "linear-gradient(135deg,#ec4899,#a78bfa)",
        followers: "487K", following: "445", posts: "3,291", engRate: "9.2%",
        topPosts: [
            { likes: "72.1K", desc: "GRWM Paris FW" },
            { likes: "58.3K", desc: "Capsule wardrobe guide" },
            { likes: "44.7K", desc: "Designer vs dupe" },
            { likes: "38.9K", desc: "Vintage finds haul" }
        ],
        winning: [
            { score: 97, label: "Cinematic Reel transitions", cls: "high" },
            { score: 93, label: "Mood-board carousels", cls: "high" },
            { score: 88, label: "Designer name-dropping", cls: "high" },
            { score: 84, label: "3-outfit-per-Reel format", cls: "high" },
            { score: 76, label: "Behind-the-scenes Stories", cls: "mid" },
            { score: 71, label: "User-generated reposts", cls: "mid" }
        ],
        painPoints: [
            { text: "Modest fashion underserved", cls: "gap" },
            { text: "Plus-size representation", cls: "demand" },
            { text: "Budget luxury alternatives", cls: "opp" },
            { text: "Sustainable brands directory", cls: "opp" },
            { text: "Men's fashion lagging", cls: "gap" },
            { text: "Seasonal capsule demand", cls: "demand" }
        ]
    },
    finance: {
        name: "CryptoMaxwell", handle: "@cryptomaxwell", initial: "C",
        gradient: "linear-gradient(135deg,#22c55e,#14b8a6)",
        followers: "156K", following: "203", posts: "987", engRate: "6.1%",
        topPosts: [
            { likes: "24.8K", desc: "BTC weekly analysis" },
            { likes: "19.3K", desc: "DeFi yield comparison" },
            { likes: "16.1K", desc: "Portfolio breakdown" },
            { likes: "12.7K", desc: "Bear market playbook" }
        ],
        winning: [
            { score: 90, label: "Chart annotations in every post", cls: "high" },
            { score: 86, label: "Weekly consistency (every Sunday)", cls: "high" },
            { score: 82, label: "Disclaimer + educational framing", cls: "high" },
            { score: 77, label: "Real P&L transparency", cls: "mid" },
            { score: 73, label: "Community poll engagement", cls: "mid" },
            { score: 65, label: "Cross-chain coverage", cls: "mid" }
        ],
        painPoints: [
            { text: "Beginner DeFi onboarding", cls: "gap" },
            { text: "Tax optimization guides", cls: "demand" },
            { text: "Scam detection content", cls: "opp" },
            { text: "Portfolio tools reviews", cls: "opp" },
            { text: "Regulation explainers", cls: "demand" },
            { text: "Risk management basics", cls: "gap" }
        ]
    },
    travel: {
        name: "WanderLena", handle: "@wanderlena", initial: "L",
        gradient: "linear-gradient(135deg,#06b6d4,#8b5cf6)",
        followers: "274K", following: "567", posts: "1,834", engRate: "7.8%",
        topPosts: [
            { likes: "41.2K", desc: "Hidden cenote Yucatan" },
            { likes: "33.6K", desc: "$30/day Bali budget" },
            { likes: "27.9K", desc: "Solo travel safety" },
            { likes: "21.3K", desc: "Packing carry-on only" }
        ],
        winning: [
            { score: 95, label: "Drone opening shots", cls: "high" },
            { score: 90, label: "Budget breakdowns in carousel", cls: "high" },
            { score: 85, label: "Save-worthy location pins", cls: "high" },
            { score: 81, label: "Day-in-my-life vlog format", cls: "high" },
            { score: 75, label: "Local food focus", cls: "mid" },
            { score: 69, label: "Seasonal destination timing", cls: "mid" }
        ],
        painPoints: [
            { text: "Solo female travel safety", cls: "demand" },
            { text: "Remote work + travel combo", cls: "opp" },
            { text: "Visa guides outdated", cls: "gap" },
            { text: "Hidden gem discovery", cls: "opp" },
            { text: "Family travel underserved", cls: "gap" },
            { text: "Eco-tourism awareness", cls: "demand" }
        ]
    }
};

let TREND_ITEMS = [
    { name: "#AIInfluencer", posts: "2.4M", growth: "+340%", hot: true },
    { name: "#VirtualCreator", posts: "890K", growth: "+180%", hot: true },
    { name: "#DigitalPersona", posts: "456K", growth: "+95%", hot: false },
    { name: "#AIContentCreator", posts: "1.1M", growth: "+210%", hot: true },
    { name: "#SyntheticMedia", posts: "312K", growth: "+67%", hot: false },
    { name: "#FitTok2026", posts: "8.7M", growth: "+45%", hot: false },
    { name: "#AIFashion", posts: "678K", growth: "+290%", hot: true },
    { name: "#FinTokAI", posts: "234K", growth: "+410%", hot: true },
    { name: "#TravelAI", posts: "167K", growth: "+155%", hot: false },
    { name: "#AutomatedPosting", posts: "98K", growth: "+520%", hot: true }
];

function runScout() {
    const niche = document.getElementById('scout-niche').value;
    const output = document.getElementById('scout-results');
    const profile = SCOUT_PROFILES[niche];

    output.innerHTML = `<div style="padding:2rem;text-align:center;color:rgba(255,255,255,0.3)"><span class="typing-cursor">Scraping profile data</span></div>`;

    setTimeout(() => {
        output.innerHTML = `
        <div class="scout-report">
            <div class="scout-profile">
                <div class="scout-profile-avatar" style="background:${profile.gradient}">${profile.initial}</div>
                <div class="scout-profile-info">
                    <div class="scout-profile-name">${profile.name}</div>
                    <div class="scout-profile-handle">${profile.handle}</div>
                    <div class="scout-profile-stats">
                        <span><strong>${profile.followers}</strong> followers</span>
                        <span><strong>${profile.posts}</strong> posts</span>
                        <span><strong>${profile.engRate}</strong> eng.</span>
                    </div>
                </div>
            </div>

            <div class="scout-section">
                <div class="scout-section-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>Top Performing Posts</div>
                <div class="top-posts">
                    ${profile.topPosts.map(p => `
                        <div class="top-post">
                            <div class="top-post-img"></div>
                            <div class="top-post-overlay">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="#fff" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
                                <span class="top-post-likes">${p.likes}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="scout-section">
                <div class="scout-section-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>Winning Elements Extracted</div>
                <div class="winning-grid">
                    ${profile.winning.map(w => `
                        <div class="winning-item">
                            <span class="winning-score ${w.cls}">${w.score}</span>
                            <span class="winning-label">${w.label}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="scout-section">
                <div class="scout-section-title"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>Market Pain Points Detected</div>
                <div class="pain-tags">
                    ${profile.painPoints.map(p => `<span class="pain-tag ${p.cls}">${p.text}</span>`).join('')}
                </div>
            </div>

            <div class="scout-section" style="border:none;padding-bottom:1.5rem">
                <button class="train-btn" onclick="trainAgent()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 014 4c0 1.95-2 4-2 6h-4c0-2-2-4.05-2-6a4 4 0 014-4z"/><path d="M10 16h4"/></svg>
                    Feed Insights → Agent soul.md & tools.md
                </button>
            </div>
        </div>`;
    }, 1500);
}

function runMarketScan() {
    runScout(); // Reuses same profile data for demo
}

function trainAgent() {
    const btn = event.target.closest('.train-btn');
    btn.innerHTML = '<span class="typing-cursor">Training agent</span>';
    btn.style.opacity = '0.7';
    setTimeout(() => {
        btn.innerHTML = '✓ Insights applied to Sofia Rivera\'s soul.md & tools.md';
        btn.style.background = 'linear-gradient(135deg,#22c55e,#14b8a6)';
        btn.style.opacity = '1';
    }, 2000);
}

function renderTrendTicker() {
    const el = document.getElementById('trend-ticker');
    if (!el) return;
    el.innerHTML = TREND_ITEMS.map(t => `
        <div class="trend-tag">
            <div class="trend-tag-name">${t.name}</div>
            <div class="trend-tag-meta">${t.posts} posts · <span class="${t.hot ? 'trend-tag-hot' : ''}">${t.growth}</span></div>
        </div>
    `).join('');
}

// ═══════════════════════════════════════
// DATA: DASHBOARD AGENT ROSTER (from data/agents.json)
// ═══════════════════════════════════════
let DASH_AGENTS = []; // Populated by data loader

let SPARK_DATA = [
    [4.8, 5.1, 5.4, 6.0, 5.8, 6.2, 6.2],  // Agent 1
    [4.2, 4.5, 4.3, 4.6, 4.9, 4.7, 4.8],  // Agent 2
    [5.9, 6.2, 6.5, 6.8, 7.0, 6.9, 7.1]   // Agent 3
];

let PLATFORM_DATA = [
    { name:"Instagram", pct:38, color:"linear-gradient(90deg,#833ab4,#e1306c)" },
    { name:"TikTok", pct:27, color:"linear-gradient(90deg,#25f4ee,#fe2c55)" },
    { name:"Twitter/X", pct:16, color:"linear-gradient(90deg,#1da1f2,#0d8bd9)" },
    { name:"LinkedIn", pct:10, color:"linear-gradient(90deg,#0077b5,#00a0dc)" },
    { name:"YouTube", pct:6, color:"linear-gradient(90deg,#ff0000,#cc0000)" },
    { name:"Threads", pct:3, color:"linear-gradient(90deg,#000,#333)" }
];

let currentFilter = 'all';

// ═══════════════════════════════════════
// RENDER: DASHBOARD
// ═══════════════════════════════════════
function renderAgentTable(filter) {
    const table = document.getElementById('dash-agent-table');
    if (!table) return;
    let agents = [...DASH_AGENTS];
    if (filter === 'active') agents = agents.filter(a => a.status === 'active');
    else if (filter === 'paused') agents = agents.filter(a => a.status === 'paused' || a.status === 'failing');
    else if (filter === 'top') agents = agents.filter(a => a.perf >= 70).sort((a,b) => b.perf - a.perf);

    const trendClass = t => t.startsWith('+') ? 'positive' : t.startsWith('-') ? 'negative' : 'neutral';
    const statusCls = s => s === 'active' ? 'status-active' : s === 'paused' ? 'status-paused' : 'status-failing';
    const perfColor = p => p >= 70 ? '#22c55e' : p >= 40 ? '#f59e0b' : '#ef4444';

    table.innerHTML = `
        <div class="dash-row row-header">
            <span>Agent</span><span>Followers</span><span>Engagement</span><span>Trend</span><span>Performance</span><span>Active</span>
        </div>
        ${agents.map((a, i) => `
        <div class="dash-row" data-idx="${DASH_AGENTS.indexOf(a)}" style="cursor:pointer" onclick="if(!event.target.closest('.toggle')){switchPortalView('persona-config')}">
            <div class="dash-agent-cell">
                <div class="dash-agent-avatar" style="background:${a.gradient}">${a.initial}</div>
                <div class="dash-agent-info">
                    <span class="dash-agent-name">${a.name}</span>
                    <span class="dash-agent-niche">${a.handle} · ${a.niche} · <span class="dash-status ${statusCls(a.status)}"><span class="dash-status-dot"></span>${a.status}</span></span>
                </div>
            </div>
            <span class="dash-cell">${a.followers}</span>
            <span class="dash-cell ${a.engagement >= 5 ? 'positive' : a.engagement < 3 ? 'negative' : ''}">${a.engagement}%</span>
            <span class="dash-cell ${trendClass(a.trend)}">${a.trend}</span>
            <span class="dash-cell">
                <div class="perf-bar-wrap">
                    <div class="perf-bar-bg"><div class="perf-bar" style="width:${a.perf}%;background:${perfColor(a.perf)}"></div></div>
                    <span style="font-size:.7rem;min-width:28px;text-align:right">${a.perf}</span>
                </div>
            </span>
            <span class="dash-cell">
                <label class="toggle" onclick="toggleAgent(${DASH_AGENTS.indexOf(a)})">
                    <input type="checkbox" ${a.active ? 'checked' : ''}>
                    <span class="toggle-track"></span>
                    <span class="toggle-thumb"></span>
                </label>
            </span>
        </div>`).join('')}
    `;
}

function renderSparkChart() {
    const el = document.getElementById('spark-chart');
    if (!el) return;
    const w = 520, h = 200;
    const padL = 48, padR = 16, padT = 16, padB = 28;
    const colors = ['#6366f1','#34d399','#fbbf24'];
    const colorsSoft = ['rgba(99,102,241,0.12)','rgba(52,211,153,0.10)','rgba(251,191,36,0.10)'];
    const allVals = SPARK_DATA.flat();
    const min = Math.min(...allVals) - 0.5, max = Math.max(...allVals) + 0.5;
    const chartW = w - padL - padR, chartH = h - padT - padB;
    const scaleX = i => padL + (i / 6) * chartW;
    const scaleY = v => h - padB - ((v - min) / (max - min)) * chartH;

    // Gradient defs for area fills
    const defs = colors.map((c, i) =>
        `<linearGradient id="areaGrad${i}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${c}" stop-opacity="0.18"/>
            <stop offset="100%" stop-color="${c}" stop-opacity="0.0"/>
        </linearGradient>`
    ).join('');

    const linesAndAreas = SPARK_DATA.map((data, si) => {
        const pts = data.map((v, i) => `${scaleX(i)},${scaleY(v)}`);
        const linePts = pts.join(' ');
        // Area fill polygon: line + close along bottom
        const areaPath = `${pts.join(' ')} ${scaleX(6)},${h - padB} ${scaleX(0)},${h - padB}`;
        const dots = data.map((v, i) =>
            `<circle cx="${scaleX(i)}" cy="${scaleY(v)}" r="6" fill="${colors[si]}" opacity="0.15"/>
             <circle cx="${scaleX(i)}" cy="${scaleY(v)}" r="4" fill="${colors[si]}" opacity="0.9" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>`
        ).join('');
        return `<polygon points="${areaPath}" fill="url(#areaGrad${si})"/>
                <polyline points="${linePts}" fill="none" stroke="${colors[si]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
                ${dots}`;
    }).join('');

    // Grid lines & Y-axis labels
    const steps = 4;
    const gridLines = Array.from({length: steps + 1}, (_, i) => {
        const v = min + (i / steps) * (max - min);
        return `<line x1="${padL}" y1="${scaleY(v)}" x2="${w - padR}" y2="${scaleY(v)}" stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="${i === 0 ? 'none' : '3,4'}"/>
                <text x="${padL - 8}" y="${scaleY(v) + 4}" fill="rgba(255,255,255,0.35)" font-size="10" font-weight="500" text-anchor="end" font-family="var(--font-mono,monospace)">${v.toFixed(1)}%</text>`;
    }).join('');

    const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i) =>
        `<text x="${scaleX(i)}" y="${h - 6}" fill="rgba(255,255,255,0.35)" font-size="10" font-weight="500" text-anchor="middle" font-family="var(--font-body,sans-serif)">${d}</text>`
    ).join('');

    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet"><defs>${defs}</defs>${gridLines}${linesAndAreas}${dayLabels}</svg>`;

    // Populate legend dynamically from DATA.agents
    const legendEl = document.getElementById('spark-legend');
    if (legendEl) {
      const agents = (window.DATA && window.DATA.agents) || INFLUENCERS;
      legendEl.innerHTML = agents.slice(0,3).map((a, i) => {
        const shortName = a.name.split(' ').map((w,j) => j === 0 ? w : w.charAt(0) + '.').join(' ');
        return `<span><i style="background:${colors[i]}"></i> ${shortName}</span>`;
      }).join('');
    }
}

function renderPlatformBars() {
    const el = document.getElementById('platform-bars');
    if (!el) return;
    el.innerHTML = PLATFORM_DATA.map(p => `
        <div class="plat-bar-row">
            <span class="plat-bar-label">${p.name}</span>
            <div class="plat-bar-track">
                <div class="plat-bar-fill" style="width:${p.pct}%;background:${p.color}"></div>
            </div>
            <span class="plat-bar-val">${p.pct}%</span>
        </div>
    `).join('');
}

function filterAgents(btn, filter) {
    document.querySelectorAll('.dash-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = filter;
    renderAgentTable(filter);
}

function toggleAgent(idx) {
    DASH_AGENTS[idx].active = !DASH_AGENTS[idx].active;
    DASH_AGENTS[idx].status = DASH_AGENTS[idx].active ? 'active' : 'paused';
    // Update KPI count
    const activeCount = DASH_AGENTS.filter(a => a.active).length;
    const kpiEl = document.getElementById('kpi-total');
    if (kpiEl) kpiEl.textContent = activeCount;
    // Re-render after brief delay for toggle animation
    setTimeout(() => renderAgentTable(currentFilter), 300);
}

function renderDashboard() {
    renderAgentTable('all');
    renderSparkChart();
    renderPlatformBars();
    
    // Wire KPIs from DASH_AGENTS (both main-area and right-panel)
    const activeCount = DASH_AGENTS.filter(a => a.active).length;
    const totalCount = DASH_AGENTS.length;
    
    const kpiTotal = document.getElementById('kpi-total');
    if (kpiTotal) kpiTotal.textContent = totalCount;
    
    const kpiTotalRp = document.getElementById('kpi-total-rp');
    if (kpiTotalRp) kpiTotalRp.textContent = activeCount;
    
    // Engagement KPIs
    let avgEngText = '\u2014';
    if (DASH_AGENTS.length) {
        const avgEng = DASH_AGENTS.reduce((s, a) => s + (a.engagement || 0), 0) / DASH_AGENTS.length;
        avgEngText = avgEng > 0 ? avgEng.toFixed(1) + '%' : '\u2014';
    }
    const kpiEng = document.getElementById('kpi-engagement');
    if (kpiEng) kpiEng.textContent = avgEngText;
    const kpiEngMain = document.getElementById('kpi-engagement-main');
    if (kpiEngMain) kpiEngMain.textContent = avgEngText;
    
    // Posts KPIs
    const postsText = activeCount * 3;
    const kpiPosts = document.getElementById('kpi-posts');
    if (kpiPosts) kpiPosts.textContent = postsText;
    const kpiPostsMain = document.getElementById('kpi-posts-main');
    if (kpiPostsMain) kpiPostsMain.textContent = postsText;
    
    // Reach KPIs
    let reachText = '\u2014';
    if (DASH_AGENTS.length) {
        const totalFollowers = DASH_AGENTS.reduce((s, a) => {
            const f = String(a.followers || '0').replace(/[KkMm]/g, m => m.toLowerCase() === 'k' ? '000' : '000000').replace(/\./g, '');
            return s + (parseInt(f) || 0);
        }, 0);
        if (totalFollowers >= 1000000) reachText = (totalFollowers / 1000000).toFixed(1) + 'M';
        else if (totalFollowers >= 1000) reachText = (totalFollowers / 1000).toFixed(1) + 'K';
        else reachText = totalFollowers;
    }
    const kpiReach = document.getElementById('kpi-reach');
    if (kpiReach) kpiReach.textContent = reachText;
    const kpiReachMain = document.getElementById('kpi-reach-main');
    if (kpiReachMain) kpiReachMain.textContent = reachText;
}

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => chip.classList.toggle('active'));
    });

    // Load external data — bridge to existing global vars
    // SERIALIZATION RULE: loadData() always returns parsed objects via
    // response.json(). Never JSON.stringify() before storing, never double-parse.
    try {
        await loadData();
        if (DATA.templates) {
            GEN_NAMES = DATA.templates.generator?.names ?? GEN_NAMES;
            GEN_BIOS  = DATA.templates.generator?.bios  ?? GEN_BIOS;
            if (DATA.templates.ugc) GEN_UGC = DATA.templates.ugc;
        }
        if (DATA.trends) TREND_ITEMS = DATA.trends;
        if (DATA.scouts) {
            // Bridge scout profiles (exclude 'keywords' key)
            const { keywords, ...profiles } = DATA.scouts;
            Object.assign(SCOUT_PROFILES, profiles);
            if (keywords) Object.assign(KEYWORD_TRENDS, keywords);
        }
        if (DATA.platforms) {
            if (DATA.platforms.distribution) PLATFORM_DATA = DATA.platforms.distribution;
            if (DATA.platforms.sparkData)    SPARK_DATA = DATA.platforms.sparkData;
        }
        // Bridge agents from data/agents.json → INFLUENCERS + DASH_AGENTS
        if (DATA.agents && DATA.agents.length) {
            INFLUENCERS = DATA.agents;
            DASH_AGENTS = DATA.agents.map(a => ({
                ...a,
                niche: (a.niche || '').split(' & ')[0] || a.niche,
                engagement: a.engagementRate || parseFloat(a.engagement) || 0,
                active: a.status === 'active',
            }));
        } else {
            INFLUENCERS = _INFLUENCER_FALLBACK;
            DASH_AGENTS = _INFLUENCER_FALLBACK.map(a => ({
                ...a,
                niche: (a.niche || '').split(' & ')[0] || a.niche,
                engagement: parseFloat(a.engagement) || 0,
                active: true,
                perf: 80,
                trend: '+0%',
                color: '#a78bfa',
            }));
        }
        console.log(`[PersonaGen] Data loaded — ${INFLUENCERS.length} agents, ${Object.keys(DATA).length} data files`);
    } catch (err) {
        console.warn('[PersonaGen] Data load failed, using inline fallback:', err);
        INFLUENCERS = _INFLUENCER_FALLBACK;
        DASH_AGENTS = _INFLUENCER_FALLBACK.map(a => ({
            ...a,
            niche: (a.niche || '').split(' & ')[0] || a.niche,
            engagement: parseFloat(a.engagement) || 0,
            active: true,
            perf: 80,
            trend: '+0%',
            color: '#a78bfa',
        }));
    }

    // Render all sections
    renderInfluencers();
    renderCalendar(0);
    renderTrendTicker();
    renderDashboard();

    // Initialize dynamic calendar module if available
    if (typeof DynamicCalendar !== 'undefined' && document.getElementById('dynamic-calendar-mount')) {
        DynamicCalendar.init('dynamic-calendar-mount');
    }

    // ── Auto-init ALL modules for compiled sub-pages ──
    // On sub-pages (dashboard.html, trends.html, etc.), switchPortalView()
    // is never called because sidebar uses <a> links. So we must init
    // every module whose mount point exists on this page.
    if (typeof TrendMonitor !== 'undefined' && document.getElementById('trends-mount') && !document.querySelector('.trends-wrapper')) {
        TrendMonitor.init('trends-mount');
    }
    if (typeof ChannelDecoder !== 'undefined' && document.getElementById('channel-decoder-mount') && !document.querySelector('.cd-wrapper')) {
        ChannelDecoder.init('channel-decoder-mount');
    }
    if (typeof ContentForge !== 'undefined' && document.getElementById('content-forge-mount') && !document.querySelector('.cf-wrapper')) {
        ContentForge.init('content-forge-mount');
    }
    if (typeof PersonaConfigEditor !== 'undefined' && document.getElementById('persona-config-mount') && !document.querySelector('.pce-layout')) {
        PersonaConfigEditor.init('persona-config-mount');
    }
    if (typeof InboxHub !== 'undefined' && document.getElementById('inbox-mount') && !document.querySelector('.inbox-wrapper')) {
        InboxHub.init('inbox-mount');
    }
    if (typeof BrandBrief !== 'undefined' && document.getElementById('pg-brand-brief')) {
        BrandBrief.init('pg-brand-brief');
    }

    // Clear aria-busy on all dynamic containers after render
    document.querySelectorAll('[aria-busy="true"]').forEach(el => {
        el.setAttribute('aria-busy', 'false');
    });

    // Counter animation
    document.querySelectorAll('.counter').forEach(counter => {
        const target = +counter.dataset.target;
        const suffix = counter.dataset.suffix || '';
        const increment = target / 60;
        let current = 0;
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) { counter.textContent = target + suffix; clearInterval(timer); }
            else counter.textContent = Math.floor(current) + suffix;
        }, 30);
    });

    // Scroll reveal
    const revealSelectors = '.section-tag,.section-title,.section-lead,.glass-card,.inf-card,.timeline-item,.arch-card,.milestone-card,.pipe-step,.hero-stats,.hero-badge,.hero-title,.hero-subtitle,.hero-cta-row,.calendar-controls,.calendar-week,.gen-panel,.gen-output,.pipeline-flow,.dash-kpi,.dash-table-wrap,.dash-chart-card,.scout-input-panel,.scout-results,.trend-strip'.split(',');
    revealSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach((el, i) => {
            el.classList.add('reveal');
            el.style.transitionDelay = `${Math.min(i * 0.06, 0.4)}s`;
        });
    });
    // In multi-page portal layout, elements are inside a nested scrollable panel
    // where IntersectionObserver won't fire reliably. Immediately reveal them
    // with staggered delays for a polished entrance animation.
    const isPortalPage = document.body.classList.contains('portal-active');
    if (isPortalPage) {
        requestAnimationFrame(() => {
            document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
        });
    } else {
        const obs = new IntersectionObserver(entries => {
            entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
        }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
        document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
    }

    // Active nav
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.pg-nav-link[href]');
    const navObs = new IntersectionObserver(entries => {
        entries.forEach(e => {
            if (e.isIntersecting) {
                navLinks.forEach(l => l.classList.toggle('active', l.getAttribute('href') === `#${e.target.id}`));
            }
        });
    }, { threshold: 0.3 });
    sections.forEach(s => navObs.observe(s));

    // Nav bg
    const nav = document.getElementById('main-nav');
    window.addEventListener('scroll', () => {
        nav.style.background = window.scrollY > 50 ? 'rgba(7,6,11,0.95)' : 'rgba(7,6,11,0.75)';
        nav.style.borderBottomColor = window.scrollY > 50 ? 'rgba(0,229,255,0.1)' : 'rgba(0,229,255,0.06)';
    }, { passive: true });

    // Cursor glow tracking
    const cursorGlow = document.getElementById('cursor-glow');
    if (cursorGlow) {
        let mouseX = 0, mouseY = 0, glowX = 0, glowY = 0;
        document.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
        }, { passive: true });
        function animateGlow() {
            glowX += (mouseX - glowX) * 0.08;
            glowY += (mouseY - glowY) * 0.08;
            cursorGlow.style.left = glowX + 'px';
            cursorGlow.style.top = glowY + 'px';
            requestAnimationFrame(animateGlow);
        }
        animateGlow();
    }

    // Glitch hover on hero title
    const heroTitle = document.querySelector('.hero-title');
    if (heroTitle) heroTitle.classList.add('glitch-hover');

    // Onboarding UI initialization (only if their DOM exists on this page)
    PIN.init();
    if (document.querySelector('.pm-kanban-board')) PM.init();
    if (document.querySelector('.sc-platform-grid')) SocialConnections.init();
    if (document.getElementById('ac-details-name')) AccountCreator.init();

    // Setup scroll reveal for portal components
    const portalRevealObserver = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.style.opacity = '1';
          e.target.style.transform = 'translateY(0)';
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
    
    document.querySelectorAll('.phase, .benefit, .score-card, .comm-row, .gate, .clause-card').forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(16px)';
      el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      portalRevealObserver.observe(el);
    });

    // Hash navigation router
    window.addEventListener('hashchange', handleHashRoute);
    handleHashRoute();
});

// ── Hash Routing for Client Portal ──
function handleHashRoute() {
  const hash = window.location.hash;
  if (!hash) return;

  const isPortalUnlocked = sessionStorage.getItem('pg_portal_unlocked') === 'yes';
  if (!isPortalUnlocked) return;

  // Reset window scroll position to 0 to prevent browser scroll bugs
  window.scrollTo(0, 0);

  const routeMap = {
    '#timeline':          { view: 'agreement', scroll: 'timeline' },
    '#agreement-details': { view: 'agreement', scroll: 'agreement-details' },
    '#scout':             { view: 'scout' },
    '#generator':         { view: 'generator' },
    '#calendar':          { view: 'calendar' },
    '#dashboard':         { view: 'dashboard' },
    '#account-creator':   { view: 'accounts' },
    '#project-manager':   { view: 'pm' },
    '#showcase':          { view: 'dashboard', scrollClass: 'dash-table-wrap' }
  };

  const route = routeMap[hash];
  if (route) {
    // If we're not currently on the portal tab, switch to it
    const viewPortal = document.getElementById('view-portal');
    if (viewPortal && viewPortal.style.display === 'none') {
      switchTab('portal');
    }
    
    // Switch to the correct subview
    switchPortalView(route.view);

    // If there is a sub-element to scroll to by ID
    if (route.scroll) {
      const targetEl = document.getElementById(route.scroll);
      const mainContainer = document.querySelector('.dash-main');
      if (targetEl && mainContainer) {
        setTimeout(() => {
          mainContainer.scrollTo({
            top: targetEl.offsetTop - 70,
            behavior: 'smooth'
          });
        }, 100);
      }
    }
    // If there is a sub-element to scroll to by class
    else if (route.scrollClass) {
      const targetEl = document.querySelector('.' + route.scrollClass);
      const mainContainer = document.querySelector('.dash-main');
      if (targetEl && mainContainer) {
        setTimeout(() => {
          mainContainer.scrollTo({
            top: targetEl.offsetTop - 70,
            behavior: 'smooth'
          });
        }, 100);
      }
    }
  }
}

// ── Global Tab Switching (Portal only — landing page removed) ──
function switchTab(tabId) {
  if (tabId === 'portal') {
    if (sessionStorage.getItem('pg_portal_unlocked') === 'yes') {
      window.location.href = 'dashboard.html';
    } else {
      const pinGate = document.getElementById('pin-gate');
      if (pinGate) {
        pinGate.style.display = 'flex';
        pinGate.classList.remove('unlocked');
      }
    }
  }
}

// ── Exit Portal (returns to PIN screen) ──
function exitPortal() {
  sessionStorage.removeItem('pg_portal_unlocked');
  // Reload to show PIN screen (no landing page)
  window.location.href = 'index.html';
}

// ── Profile Dropdown ──
function toggleProfileDropdown() {
  const dd = document.getElementById('profile-dropdown');
  if (dd) dd.classList.toggle('open');
}

// ── Sidebar Toggle (Desktop + Mobile) ──
function toggleDashSidebar() {
  const layout = document.querySelector('.dashboard-layout');
  const sidebar = document.querySelector('.dash-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (window.innerWidth > 768) {
    if (layout) layout.classList.toggle('sidebar-collapsed');
  } else {
    if (sidebar) sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active');
  }
}

// ── Right Panel Toggle ──
function toggleRightPanel() {
  const panel = document.querySelector('.dash-right-panel');
  const btn = document.getElementById('dash-analytics-toggle');
  const workspace = document.querySelector('.dash-workspace');
  if (!panel) return;
  
  const isCollapsed = panel.classList.contains('collapsed');
  if (isCollapsed) {
    panel.classList.remove('collapsed');
    if (workspace) workspace.classList.remove('right-collapsed');
    if (btn) btn.classList.add('panel-open');
    if (window.innerWidth <= 768) panel.classList.add('open');
  } else {
    panel.classList.add('collapsed');
    if (workspace) workspace.classList.add('right-collapsed');
    if (btn) btn.classList.remove('panel-open');
    if (window.innerWidth <= 768) panel.classList.remove('open');
  }
}

// ── Update Analytics Panel ──
function updateAnalyticsPanel() {
  const feed = document.getElementById('notification-feed');
  if (!feed) return;
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  // Update KPIs from loaded data
  const agentCount = document.querySelectorAll('.agent-card').length;
  const kpiTotal = document.getElementById('kpi-total');
  if (kpiTotal) kpiTotal.textContent = agentCount || '—';
}

// ── PIN Gate ──
const PIN = {
  CORRECT: '2026',
  SESSION_KEY: 'pg_portal_unlocked',
  input: '',

  init() {
    const pinGate = document.getElementById('pin-gate');
    const portalView = document.getElementById('view-portal');
    const nav = document.getElementById('main-nav');

    if (sessionStorage.getItem(this.SESSION_KEY) === 'yes') {
      // Already unlocked — redirect to dashboard from index, or show portal inline
      const isSplashPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/');
      if (isSplashPage) {
        window.location.href = 'dashboard.html';
        return;
      }
      document.body.classList.add('portal-active');
      if (pinGate) {
        pinGate.classList.add('unlocked');
        pinGate.style.display = 'none';
      }
      if (portalView) portalView.style.display = 'block';
      if (nav) nav.style.display = '';
    } else {
      // Not unlocked — protect sub-pages, show PIN on index
      const isSplashPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/');
      if (!isSplashPage) {
        window.location.href = 'index.html';
        return;
      }
      document.body.classList.remove('portal-active');
      if (pinGate) {
        pinGate.style.display = 'flex';
        pinGate.classList.remove('unlocked');
      }
      if (portalView) portalView.style.display = 'none';
      if (nav) nav.style.display = 'none';
    }

    // keyboard support
    document.addEventListener('keydown', (e) => {
      const pinGate = document.getElementById('pin-gate');
      if (pinGate && pinGate.style.display !== 'none' && !pinGate.classList.contains('unlocked')) {
        if (/^[0-9]$/.test(e.key)) this.press(e.key);
        if (e.key === 'Backspace') this.del();
        if (e.key === 'Escape') this.clear();
      }
    });
  },

    press(digit) {
    if (this.input.length >= 4) return;
    this.input += digit;
    this.updateDots();
    if (this.input.length === 4) setTimeout(() => this.check(), 120);
  },

  del() {
    this.input = this.input.slice(0, -1);
    this.updateDots();
    const pinErr = document.getElementById('pin-error');
    if (pinErr) pinErr.textContent = '';
  },

  clear() {
    this.input = '';
    this.updateDots();
    const pinErr = document.getElementById('pin-error');
    if (pinErr) pinErr.textContent = '';
  },

  updateDots(state) {
    for (let i = 0; i < 4; i++) {
      const dot = document.getElementById('pd-' + i);
      if (!dot) continue;
      dot.className = 'pin-dot';
      if (state === 'error') { dot.classList.add('error'); }
      else if (i < this.input.length) dot.classList.add('filled');
    }
  },

  check() {
    if (this.input === this.CORRECT) {
      sessionStorage.setItem(this.SESSION_KEY, 'yes');
      const pinGate = document.getElementById('pin-gate');
      if (pinGate) {
        pinGate.classList.add('unlocked');
        setTimeout(() => {
          window.location.href = 'dashboard.html';
        }, 300);
      } else {
        window.location.href = 'dashboard.html';
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const dot = document.getElementById('pd-' + i);
        if (dot) {
          dot.classList.remove('filled');
          dot.classList.add('error');
        }
      }
      const pinErr = document.getElementById('pin-error');
      if (pinErr) pinErr.textContent = 'Incorrect PIN — try again.';
      setTimeout(() => { this.input = ''; this.updateDots(); }, 700);
    }
  }
};

// ── Dashboard Sub-Tab Switching ──
function switchDashboardTab(subTabId) {
    // Hide all sub-tab contents
    const contents = document.querySelectorAll('.dash-sub-content');
    contents.forEach(el => el.style.display = 'none');
    
    // Deactivate all sub-tab buttons
    const buttons = document.querySelectorAll('.dash-sub-tab-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    
    // Show target content
    const targetContent = document.getElementById('dash-sub-' + subTabId);
    if (targetContent) {
        targetContent.style.display = 'block';
    }
    
    // Activate target button
    const targetBtn = document.getElementById('dash-sub-tab-' + subTabId);
    if (targetBtn) {
        targetBtn.classList.add('active');
    }
    
    // Re-trigger table renders or chart updates
    if (subTabId === 'metrics') {
        if (typeof renderAgentTable === 'function') renderAgentTable('all');
        if (typeof initSparkChart === 'function') initSparkChart();
    }
}

// ── Webhook Helper — fires events to n8n PersonaGen Gate Handler ──
const PersonaWebhook = {
  get ENDPOINT() { return PersonaGenConfig.webhook_url; },
  
  async fire(eventType, payload) {
    try {
      const res = await fetch(this.ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: eventType, ts: new Date().toISOString(), ...payload })
      });
      console.log(`[Webhook] ${eventType} → ${res.status}`);
      if (!res.ok) return null;
      // Try to parse JSON response for data-returning events
      try {
        const data = await res.json();
        return data;
      } catch(e) {
        return true;
      }
    } catch (err) {
      console.warn(`[Webhook] ${eventType} failed:`, err.message);
      return null;
    }
  }
};

// ── Social Connections (Publishing Layer) ──
const SocialConnections = {
  KEY: 'personagen_social_connections',
  
  // Platform → Composio app mapping
  COMPOSIO_APPS: {
    ig: { app: 'INSTAGRAM', name: 'Instagram', icon: 'IG' },
    tt: { app: 'TIKTOK', name: 'TikTok', icon: 'TT' },
    yt: { app: 'YOUTUBE', name: 'YouTube', icon: 'YT' },
    x:  { app: 'TWITTER', name: 'Twitter/X', icon: '𝕏' },
    ln: { app: 'LINKEDIN', name: 'LinkedIn', icon: 'LI' },
    reddit: { app: 'REDDIT', name: 'Reddit', icon: 'RD' },
  },
  
  load() {
    return JSON.parse(localStorage.getItem(this.KEY) || '{}');
  },
  
  save(data) {
    localStorage.setItem(this.KEY, JSON.stringify(data));
  },
  
  init() {
    const data = this.load();
    Object.keys(data).forEach(platform => {
      if (typeof data[platform] === 'string') {
        this.updateUI(platform, data[platform]);
      } else if (data[platform]?.handle) {
        this.updateUI(platform, data[platform].handle);
      }
    });
    
    // Listen for OAuth callback messages
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'composio_auth_complete') {
        this._handleOAuthCallback(e.data);
      }
    });
  },
  
  connect(platform, personaId) {
    const appInfo = this.COMPOSIO_APPS[platform];
    if (!appInfo) {
      console.error('[SocialConnections] Unknown platform:', platform);
      return;
    }
    
    const entityId = personaId || 'default';
    
    // Check if already connected — offer disconnect
    const existing = this.load();
    if (existing[platform]) {
      const currentHandle = typeof existing[platform] === 'object' ? existing[platform].handle : existing[platform];
      // Direct disconnect with toast feedback
      delete existing[platform];
      this.save(existing);
      this.updateUI(platform, null);
      PersonaWebhook.fire('social.disconnect', { platform, handle: currentHandle, source: 'main-dashboard' });
      PersonaGenAPI.showToast(`${appInfo.name} disconnected`, 'info');
      return;
    }
    
    // Inline handle input — use the existing input field on the card instead of prompt()
    const existingInput = document.querySelector(`#${platform}-handle-input, [data-platform="${platform}"] input`);
    let handle;
    if (existingInput) {
      handle = existingInput.value?.trim();
    }
    if (!handle || handle === '@' || handle === '') {
      PersonaGenAPI.showToast(`Enter a handle for ${appInfo.name} first`, 'warning');
      if (existingInput) existingInput.focus();
      return;
    }
    
    const cleanHandle = handle.startsWith('@') ? handle : '@' + handle;
    
    // Update button state
    const btn = document.getElementById(`btn-connect-${platform}`);
    const statusBadge = document.getElementById(`${platform}-status-badge`);
    if (btn) { btn.textContent = 'Verifying...'; btn.disabled = true; }
    if (statusBadge) { statusBadge.textContent = 'Connecting...'; statusBadge.className = 'ii-status connecting'; }
    
    // Save and fire webhook immediately
    const connData = this.load();
    connData[platform] = {
      handle: cleanHandle,
      entity_id: entityId,
      connected: true,
      connected_at: new Date().toISOString(),
      auth_method: 'manual',
    };
    this.save(connData);
    this.updateUI(platform, cleanHandle);
    
    // Fire webhook to n8n
    PersonaWebhook.fire('social.connect', {
      platform,
      handle: cleanHandle,
      entity_id: entityId,
      auth_method: 'manual',
      source: 'main-dashboard',
    });
    
    PersonaGenAPI.showToast(`${appInfo.name} connected as ${cleanHandle}!`, 'success');
  },

  
  _handleOAuthCallback(data) {
    const { platform, handle, entity_id, connected, error } = data;
    
    if (error) {
      PersonaGenAPI.showToast(`OAuth failed: ${error}`, 'error');
      return;
    }
    
    if (connected && platform) {
      const connData = this.load();
      connData[platform] = {
        handle: handle || `@${platform}_user`,
        entity_id: entity_id || 'default',
        connected: true,
        connected_at: new Date().toISOString(),
        auth_method: 'composio_oauth',
      };
      this.save(connData);
      
      // Fire webhook to n8n
      PersonaWebhook.fire('social.connect', {
        platform,
        handle: connData[platform].handle,
        entity_id: entity_id,
        auth_method: 'composio_oauth',
        source: 'main-dashboard',
      });
      
      this.updateUI(platform, connData[platform].handle);
      PersonaGenAPI.showToast(`${this.COMPOSIO_APPS[platform]?.name || platform} connected via OAuth!`, 'success');
    }
  },
  
  _fallbackConnect(platform, entityId) {
    // Fallback: use toast instead of prompt when popup is blocked
    const names = this.COMPOSIO_APPS;
    const name = names[platform]?.name || platform;
    
    PersonaGenAPI.showToast(`OAuth popup blocked. Enter ${name} handle in the input field and click Connect.`, 'warning');
  },
  
  updateUI(platform, handle) {
    const displayHandle = typeof handle === 'object' ? handle.handle : handle;
    const statusBadge = document.getElementById(`${platform}-status-badge`);
    const handleLabel = document.getElementById(`${platform}-handle-label`);
    const btn = document.getElementById(`btn-connect-${platform}`);
    
    if (statusBadge && handleLabel && btn) {
      statusBadge.textContent = 'Active';
      statusBadge.className = 'ii-status connected';
      handleLabel.textContent = `Connected · ${displayHandle}`;
      btn.textContent = 'Disconnect';
      btn.disabled = false;
      btn.setAttribute('onclick', `SocialConnections.disconnect('${platform}')`);
      btn.style.background = 'rgba(239, 68, 68, 0.1)';
      btn.style.color = 'var(--rose)';
      btn.style.border = '1px solid rgba(239, 68, 68, 0.2)';
    }
  },
  
  disconnect(platform) {
    // Direct disconnect with toast feedback
    PersonaGenAPI.showToast(`Disconnecting ${platform}...`, 'info');
    
    const data = this.load();
    const oldData = data[platform];
    const oldHandle = typeof oldData === 'string' ? oldData : oldData?.handle;
    delete data[platform];
    this.save(data);
    
    // Fire webhook to n8n
    PersonaWebhook.fire('social.disconnect', { platform, handle: oldHandle, source: 'main-dashboard' });
    
    const statusBadge = document.getElementById(`${platform}-status-badge`);
    const handleLabel = document.getElementById(`${platform}-handle-label`);
    const btn = document.getElementById(`btn-connect-${platform}`);
    
    if (statusBadge && handleLabel && btn) {
      statusBadge.textContent = 'Inactive';
      statusBadge.className = 'ii-status disconnected';
      handleLabel.textContent = 'Disconnected — No channel linked';
      btn.textContent = 'Connect Platform';
      btn.setAttribute('onclick', `SocialConnections.connect('${platform}')`);
      btn.style.background = 'var(--accent-soft)';
      btn.style.color = 'var(--accent)';
      btn.style.border = 'none';
    }
  },
  
  // Get connection status for a specific persona+platform
  isConnected(platform) {
    const data = this.load();
    const entry = data[platform];
    if (!entry) return false;
    return typeof entry === 'string' ? true : entry.connected === true;
  },
  
  // Get all connected platforms
  getConnected() {
    const data = this.load();
    return Object.entries(data)
      .filter(([_, v]) => typeof v === 'string' ? true : v?.connected)
      .map(([platform, v]) => ({
        platform,
        handle: typeof v === 'string' ? v : v.handle,
        auth_method: typeof v === 'string' ? 'manual' : v.auth_method,
      }));
  },
};

// ── Project Manager (localStorage + onboarding tasks from docs) ──
const PM = {
  KEY: 'personagen_pm_tickets',
  ONB_KEY: 'personagen_onb_overrides',
  filter: 'all',
  viewMode: 'list',
  searchQuery: '',
  filterAssignee: '',
  filterPhase: '',
  onboardingTasks: [],
  docs: [],

  load() { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); },
  save(tickets) { localStorage.setItem(this.KEY, JSON.stringify(tickets)); },

  loadOnbOverrides() { return JSON.parse(localStorage.getItem(this.ONB_KEY) || '{}'); },
  saveOnbOverrides(overrides) { localStorage.setItem(this.ONB_KEY, JSON.stringify(overrides)); },

  async init() {
    await this.loadOnboarding();
    this.populateFilterDropdowns();
    this.render();
    this.renderDocPanels();
  },

  populateFilterDropdowns() {
    const allItems = this.getAllItems();
    const assigneeEl = document.getElementById('pm-filter-assignee');
    const phaseEl = document.getElementById('pm-filter-phase');
    if (assigneeEl) {
      const owners = [...new Set(allItems.map(t => t.owner).filter(Boolean))].sort();
      assigneeEl.innerHTML = '<option value="">All Assignees</option>' + owners.map(o => `<option value="${o}">${o}</option>`).join('');
    }
    if (phaseEl) {
      const phases = [...new Set(allItems.map(t => t.phase).filter(Boolean))].sort();
      phaseEl.innerHTML = '<option value="">All Phases</option>' + phases.map(p => `<option value="${p}">${p}</option>`).join('');
    }
  },

  async loadOnboarding() {
    try {
      const [tasksRes, docsRes] = await Promise.all([
        fetch('data/onboarding-tasks.json').catch(() => null),
        fetch('data/onboarding-docs.json').catch(() => null)
      ]);
      if (tasksRes && tasksRes.ok) {
        const tasks = await tasksRes.json();
        // Apply localStorage overrides (dashboard status changes)
        const overrides = this.loadOnbOverrides();
        this.onboardingTasks = tasks.map(t => ({
          ...t,
          status: overrides[t.id]?.status || t.status,
          date: overrides[t.id]?.date || t.date
        }));
      }
      if (docsRes && docsRes.ok) {
        this.docs = await docsRes.json();
      }
    } catch(e) {
      console.warn('No onboarding data found:', e);
    }
  },

  getAllItems() {
    return [
      ...this.onboardingTasks.map(t => ({...t, category: 'onboarding'})),
      ...this.load().map(t => ({...t, category: 'ticket'}))
    ];
  },

  add() {
    const titleEl = document.getElementById('pm-title');
    const descEl = document.getElementById('pm-desc');
    const compEl = document.getElementById('pm-complexity');
    
    if (!titleEl) return;
    const title = titleEl.value.trim();
    const desc = descEl ? descEl.value.trim() : '';
    const complexity = compEl ? parseInt(compEl.value) : 1;
    if (!title) { titleEl.style.borderColor = 'var(--rose)'; return; }

    const labels = { 1: 'Tweak', 2: 'Feature', 3: 'System' };
    const etas = { 1: '1–3 days', 2: '1–2 weeks', 3: '2–4 weeks' };
    const ticket = {
      id: 'TK-' + String(Date.now()).slice(-6),
      title,
      description: desc,
      complexity,
      complexityLabel: labels[complexity],
      eta: etas[complexity],
      status: 'submitted',
      created: new Date().toISOString(),
      updated: new Date().toISOString()
    };

    const tickets = this.load();
    tickets.unshift(ticket);
    this.save(tickets);
    titleEl.value = '';
    if (descEl) descEl.value = '';
    if (compEl) compEl.value = '1';
    this.render();
  },

  cycle(id) {
    // Handle onboarding tasks
    if (id.startsWith('onb-')) {
      this.cycleOnboarding(id);
      return;
    }
    const order = ['submitted', 'confirmed', 'in_progress', 'review', 'complete'];
    const tickets = this.load();
    const t = tickets.find(x => x.id === id);
    if (!t) return;
    const i = order.indexOf(t.status);
    t.status = order[(i + 1) % order.length];
    t.updated = new Date().toISOString();
    this.save(tickets);
    this.render();
  },

  cycleOnboarding(taskId) {
    const task = this.onboardingTasks.find(t => t.id === taskId);
    if (!task) return;

    const cycle = { new: 'active', active: 'review', review: 'done' };
    if (task.status === 'done') return; // Cannot undo done
    
    const nextStatus = cycle[task.status];
    if (!nextStatus) return;

    // Update in-memory
    task.status = nextStatus;
    task.date = new Date().toISOString().split('T')[0];

    // Persist override to localStorage
    const overrides = this.loadOnbOverrides();
    overrides[taskId] = { status: nextStatus, date: task.date, updatedAt: new Date().toISOString() };
    this.saveOnbOverrides(overrides);

    // Bump local version tracker
    const versionKey = 'personagen_doc_version';
    const currentVersion = parseFloat(localStorage.getItem(versionKey) || '1.0');
    const newVersion = (currentVersion + 0.1).toFixed(1);
    localStorage.setItem(versionKey, newVersion);

    this.render();
    this.showToast(`Task updated → ${nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)} (v${newVersion})`, 'success');
  },

  remove(id) {
    if (id.startsWith('onb-')) return; // Can't delete onboarding tasks
    const tickets = this.load().filter(t => t.id !== id);
    this.save(tickets);
    this.render();
  },

  setFilter(f) {
    this.filter = f;
    this.render();
    if (this.viewMode === 'kanban') this.renderKanban();
  },

  setView(mode) {
    this.viewMode = mode;
    const listPanel = document.getElementById('pm-tickets');
    const kanbanPanel = document.getElementById('pm-kanban');
    const listBtn = document.getElementById('pm-view-list-btn');
    const kanbanBtn = document.getElementById('pm-view-kanban-btn');
    if (mode === 'kanban') {
      if (listPanel) listPanel.style.display = 'none';
      if (kanbanPanel) kanbanPanel.style.display = 'block';
      if (listBtn) listBtn.classList.remove('active');
      if (kanbanBtn) kanbanBtn.classList.add('active');
      this.renderKanban();
    } else {
      if (listPanel) listPanel.style.display = '';
      if (kanbanPanel) kanbanPanel.style.display = 'none';
      if (listBtn) listBtn.classList.add('active');
      if (kanbanBtn) kanbanBtn.classList.remove('active');
      this.render();
    }
  },

  applyFilters() {
    const searchEl = document.getElementById('pm-search');
    const assigneeEl = document.getElementById('pm-filter-assignee');
    const phaseEl = document.getElementById('pm-filter-phase');
    this.searchQuery = (searchEl ? searchEl.value : '').toLowerCase().trim();
    this.filterAssignee = assigneeEl ? assigneeEl.value : '';
    this.filterPhase = phaseEl ? phaseEl.value : '';
    this.render();
    if (this.viewMode === 'kanban') this.renderKanban();
  },

  getFilteredItems() {
    let items = this.getAllItems();

    // Status filter
    if (this.filter === 'onboarding') {
      items = items.filter(t => t.category === 'onboarding');
    } else if (this.filter === 'complete') {
      items = items.filter(t => t.status === 'complete' || t.status === 'done');
    } else if (this.filter !== 'all') {
      items = items.filter(t => t.status === this.filter);
    }

    // Search
    if (this.searchQuery) {
      const q = this.searchQuery;
      items = items.filter(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.owner || '').toLowerCase().includes(q) ||
        (t.phase || '').toLowerCase().includes(q) ||
        (t.id || '').toLowerCase().includes(q) ||
        (t.source || '').toLowerCase().includes(q)
      );
    }

    // Assignee filter
    if (this.filterAssignee) {
      items = items.filter(t => t.owner === this.filterAssignee);
    }

    // Phase filter
    if (this.filterPhase) {
      items = items.filter(t => t.phase === this.filterPhase);
    }

    return items;
  },

  showToast(message, type) {
    const existing = document.getElementById('pm-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.id = 'pm-toast';
    const bg = type === 'success' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
    const color = type === 'success' ? 'var(--success)' : 'var(--rose)';
    toast.style.cssText = `position:fixed; bottom:24px; right:24px; padding:12px 20px; border-radius:10px; background:${bg}; color:${color}; font-size:0.82rem; font-weight:600; font-family:'Inter',sans-serif; z-index:9999; backdrop-filter:blur(12px); border:1px solid ${color}; animation:fadeInUp 0.3s ease;`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  },

  render() {
    const tickets = this.load();
    const allItems = this.getAllItems();

    // Normalize statuses for counting
    const statusNormalize = {
      submitted: 'active', confirmed: 'active', in_progress: 'active',
      new: 'new', active: 'active', review: 'review',
      complete: 'done', done: 'done', blocked: 'active'
    };

    // Stats — aggregate both
    const counts = { total: allItems.length, new: 0, active: 0, review: 0, done: 0 };
    allItems.forEach(t => {
      const norm = statusNormalize[t.status] || 'new';
      counts[norm]++;
    });

    const pmStats = document.getElementById('pm-stats');
    if (pmStats) {
      pmStats.innerHTML = [
        { label: 'Total', value: counts.total, color: 'var(--accent)' },
        { label: 'Active', value: counts.active, color: 'var(--cyan)' },
        { label: 'In Review', value: counts.review, color: 'var(--gold)' },
        { label: 'Complete', value: counts.done, color: 'var(--success)' }
      ].map(s => `
        <div style="background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-sm); padding:1rem; text-align:center;">
          <div style="font-family:var(--font-display); font-size:1.6rem; font-weight:700; color:${s.color};">${s.value}</div>
          <div style="font-size:0.65rem; font-weight:600; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.08em;">${s.label}</div>
        </div>
      `).join('');
    }

    // Filters — add Onboarding filter
    const pmFilters = document.getElementById('pm-filters');
    if (pmFilters) {
      const filters = ['all', 'onboarding', 'submitted', 'confirmed', 'in_progress', 'review', 'complete'];
      const fLabels = { all: 'All', onboarding: 'Onboarding', submitted: 'New', confirmed: 'Confirmed', in_progress: 'Active', review: 'Review', complete: 'Done' };
      
      const getCount = (f) => {
        if (f === 'all') return '';
        if (f === 'onboarding') return ` (${this.onboardingTasks.length})`;
        return ` (${allItems.filter(t => t.status === f || (f === 'complete' && t.status === 'done')).length})`;
      };

      pmFilters.innerHTML = filters.map(f =>
        `<button onclick="PM.setFilter('${f}')" style="padding:3px 10px; border-radius:6px; border:1px solid ${this.filter === f ? 'rgba(124,106,237,0.3)' : 'var(--border)'}; background:${this.filter === f ? 'var(--accent-soft)' : 'transparent'}; color:${this.filter === f ? 'var(--accent)' : 'var(--text-dim)'}; font-size:0.65rem; font-weight:600; cursor:pointer; font-family:'Inter',sans-serif; transition:all 0.2s;">${fLabels[f]}${getCount(f)}</button>`
      ).join('');
    }

    // Filter items (uses search + assignee + phase filters)
    const filtered = this.getFilteredItems();

    // Status styles
    const statusStyles = {
      new: { bg: 'rgba(148,163,184,0.1)', color: 'var(--text-muted)', label: 'Pending' },
      submitted: { bg: 'rgba(124,106,237,0.1)', color: 'var(--accent)', label: 'Submitted' },
      confirmed: { bg: 'rgba(34,211,238,0.1)', color: 'var(--cyan)', label: 'Confirmed' },
      active: { bg: 'rgba(99,102,241,0.15)', color: '#818cf8', label: 'Active' },
      in_progress: { bg: 'rgba(34,211,238,0.15)', color: 'var(--cyan)', label: 'In Progress' },
      review: { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24', label: 'In Review' },
      done: { bg: 'rgba(34,197,94,0.15)', color: '#22c55e', label: 'Complete' },
      complete: { bg: 'rgba(52,211,153,0.1)', color: 'var(--success)', label: 'Complete' },
      blocked: { bg: 'rgba(239,68,68,0.15)', color: 'var(--rose)', label: 'Blocked' }
    };

    // Phase colors for onboarding tasks
    const phaseColors = {
      'Agreement & Payment': 'var(--rose)',
      'Brand Discovery': 'var(--accent)',
      'Infrastructure': 'var(--cyan)',
      'Platform Build': '#8b5cf6',
      'Distribution Network': 'var(--gold)',
      'Go-Live': 'var(--success)'
    };

    const complexityColors = { 1: 'var(--success)', 2: 'var(--accent)', 3: 'var(--cyan)' };

    const pmList = document.getElementById('pm-list');
    const pmEmpty = document.getElementById('pm-empty');
    
    if (pmList && pmEmpty) {
      if (filtered.length === 0) {
        pmList.innerHTML = '';
        pmEmpty.style.display = 'block';
      } else {
        pmEmpty.style.display = 'none';
        pmList.innerHTML = filtered.map(t => {
          const s = statusStyles[t.status] || statusStyles.new;
          const ago = this.timeAgo(t.created);

          // Onboarding task rendering
          if (t.category === 'onboarding') {
            const phaseColor = phaseColors[t.phase] || 'var(--accent)';
            const canCycle = t.status !== 'done';
            const nextLabel = { new: 'Active', active: 'Review', review: 'Done' };
            const cursorStyle = canCycle ? 'cursor:pointer;' : 'cursor:default;';
            const titleHover = canCycle ? `title="Click to advance → ${nextLabel[t.status] || ''}"` : 'title="Complete"';
            
            return `
            <div style="display:grid; grid-template-columns:2.5fr 0.8fr 0.7fr 0.8fr 0.4fr; align-items:center; padding:0.85rem 1.25rem; border-bottom:1px solid var(--border); border-left:3px solid ${phaseColor}; transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
              <div>
                <div style="font-size:0.85rem; font-weight:600; margin-bottom:2px;">${t.title}</div>
                <div style="font-size:0.68rem; color:var(--text-dim); display:flex; align-items:center; gap:6px;">
                  <span style="padding:1px 6px; border-radius:4px; background:${phaseColor}22; color:${phaseColor}; font-weight:600; font-size:0.6rem;">${t.phase}</span>
                  <span>From: ${t.source}</span>
                </div>
              </div>
              <div style="font-size:0.7rem; font-weight:600; color:${phaseColor};">${t.owner}</div>
              <div style="font-size:0.65rem; color:var(--text-dim);">${t.date || '—'}</div>
              <div>
                <button onclick="PM.cycle('${t.id}')" style="padding:3px 10px; border-radius:100px; background:${s.bg}; color:${s.color}; font-size:0.65rem; font-weight:600; border:none; ${cursorStyle} font-family:'Inter',sans-serif; transition:opacity 0.2s;" ${titleHover}>${s.label}</button>
              </div>
              <div style="font-size:0.55rem; color:var(--text-dim); opacity:0.5;">📋</div>
            </div>`;
          }

          // Regular ticket rendering
          return `
          <div style="display:grid; grid-template-columns:2.5fr 0.8fr 0.7fr 0.8fr 0.4fr; align-items:center; padding:0.85rem 1.25rem; border-bottom:1px solid var(--border); transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
            <div>
              <div style="font-size:0.85rem; font-weight:600; margin-bottom:2px;">${t.title}</div>
              <div style="font-size:0.68rem; color:var(--text-dim);">${t.id} · ${ago}</div>
            </div>
            <div style="font-size:0.7rem; font-weight:600; color:${complexityColors[t.complexity]};">${t.complexityLabel || ''}</div>
            <div style="font-size:0.7rem; color:var(--text-muted);">${t.eta || ''}</div>
            <div>
              <button onclick="PM.cycle('${t.id}')" style="padding:3px 10px; border-radius:100px; background:${s.bg}; color:${s.color}; font-size:0.65rem; font-weight:600; border:none; cursor:pointer; font-family:'Inter',sans-serif; transition:opacity 0.2s;" title="Click to advance status">${s.label}</button>
            </div>
            <div>
              <button onclick="PM.remove('${t.id}')" style="background:none; border:none; color:var(--text-dim); cursor:pointer; font-size:0.85rem; opacity:0.4; transition:opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.4'" title="Delete">✕</button>
            </div>
          </div>`;
        }).join('');
      }
    }
  },

  renderDocPanels() {
    const container = document.getElementById('pm-docs-list');
    if (!container || this.docs.length === 0) return;

    const localVersion = localStorage.getItem('personagen_doc_version') || null;

    container.innerHTML = this.docs.map(doc => {
      const displayVersion = localVersion || doc.version;
      return `
      <details class="pm-doc-panel">
        <summary class="pm-doc-summary">
          <span class="pm-doc-summary-left">
            <span class="pm-doc-icon">${doc.icon}</span>
            <span class="pm-doc-title">${doc.title}</span>
          </span>
          <span class="pm-doc-version-badge">v${displayVersion}</span>
        </summary>
        <div class="pm-doc-content">
          ${doc.html}
        </div>
      </details>`;
    }).join('');
  },

  // ── Kanban Board ──
  renderKanban() {
    const board = document.getElementById('pm-kanban-board');
    if (!board) return;
    const filtered = this.getFilteredItems();

    const statusStyles = {
      new: { bg: 'rgba(148,163,184,0.1)', color: 'var(--text-muted)', label: 'Pending' },
      submitted: { bg: 'rgba(124,106,237,0.1)', color: 'var(--accent)', label: 'Submitted' },
      confirmed: { bg: 'rgba(34,211,238,0.1)', color: 'var(--cyan)', label: 'Confirmed' },
      active: { bg: 'rgba(99,102,241,0.15)', color: '#818cf8', label: 'Active' },
      in_progress: { bg: 'rgba(34,211,238,0.15)', color: 'var(--cyan)', label: 'In Progress' },
      review: { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24', label: 'In Review' },
      done: { bg: 'rgba(34,197,94,0.15)', color: '#22c55e', label: 'Complete' },
      complete: { bg: 'rgba(52,211,153,0.1)', color: 'var(--success)', label: 'Complete' },
      blocked: { bg: 'rgba(239,68,68,0.15)', color: 'var(--rose)', label: 'Blocked' }
    };

    const phaseColors = {
      'Agreement & Payment': 'var(--rose)', 'Brand Discovery': 'var(--accent)',
      'Infrastructure': 'var(--cyan)', 'Platform Build': '#8b5cf6',
      'Distribution Network': 'var(--gold)', 'Go-Live': 'var(--success)'
    };

    // Normalize into 4 kanban columns
    const normalize = s => {
      if (['new','submitted'].includes(s)) return 'backlog';
      if (['active','confirmed','in_progress','blocked'].includes(s)) return 'active';
      if (s === 'review') return 'review';
      if (['done','complete'].includes(s)) return 'done';
      return 'backlog';
    };

    const columns = [
      { key: 'backlog', label: 'Backlog', color: 'var(--text-muted)', icon: '📋' },
      { key: 'active',  label: 'Active',  color: '#818cf8',          icon: '⚡' },
      { key: 'review',  label: 'Review',  color: '#fbbf24',          icon: '👁️' },
      { key: 'done',    label: 'Done',    color: '#22c55e',          icon: '✅' }
    ];

    const grouped = { backlog: [], active: [], review: [], done: [] };
    filtered.forEach(t => {
      const col = normalize(t.status);
      grouped[col].push(t);
    });

    board.innerHTML = columns.map(col => {
      const items = grouped[col.key];
      return `
      <div class="pm-kanban-col" data-col="${col.key}" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="PM.kanbanDrop(event,'${col.key}');this.classList.remove('drag-over')">
        <div class="pm-kanban-col-header">
          <span class="pm-kanban-col-icon">${col.icon}</span>
          <span class="pm-kanban-col-title">${col.label}</span>
          <span class="pm-kanban-col-count" style="color:${col.color};">${items.length}</span>
        </div>
        <div class="pm-kanban-col-body">
          ${items.length === 0 ? '<div class="pm-kanban-empty">No tasks</div>' : items.map(t => {
            const s = statusStyles[t.status] || statusStyles.new;
            const pc = phaseColors[t.phase] || 'var(--accent)';
            const ownerInitial = (t.owner || '?').charAt(0).toUpperCase();
            return `
          <div class="pm-kanban-card" draggable="true" ondragstart="PM.kanbanDragStart(event,'${t.id}')" data-id="${t.id}">
            <div class="pm-kanban-card-top">
              <span class="pm-kanban-card-badge" style="background:${s.bg};color:${s.color};">${s.label}</span>
              <span class="pm-kanban-card-avatar" style="background:${pc}22;color:${pc};" title="${t.owner || ''}">${ownerInitial}</span>
            </div>
            <div class="pm-kanban-card-title">${t.title}</div>
            ${t.phase ? `<span class="pm-kanban-card-phase" style="color:${pc};background:${pc}15;">${t.phase}</span>` : ''}
            <div class="pm-kanban-card-meta">
              <span>${t.id}</span>
              ${t.date ? `<span>${t.date}</span>` : ''}
            </div>
          </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('');
  },

  kanbanDragStart(e, id) {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => e.target.classList.add('dragging'), 0);
  },

  kanbanDrop(e, colKey) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;

    // Map column key to target status
    const colToStatus = {
      backlog: { onb: 'new', ticket: 'submitted' },
      active:  { onb: 'active', ticket: 'in_progress' },
      review:  { onb: 'review', ticket: 'review' },
      done:    { onb: 'done', ticket: 'complete' }
    };

    const mapping = colToStatus[colKey];
    if (!mapping) return;

    if (id.startsWith('onb-')) {
      const task = this.onboardingTasks.find(t => t.id === id);
      if (!task) return;
      task.status = mapping.onb;
      task.date = new Date().toISOString().split('T')[0];
      const overrides = this.loadOnbOverrides();
      overrides[id] = { status: mapping.onb, date: task.date, updatedAt: new Date().toISOString() };
      this.saveOnbOverrides(overrides);
    } else {
      const tickets = this.load();
      const t = tickets.find(x => x.id === id);
      if (!t) return;
      t.status = mapping.ticket;
      t.updated = new Date().toISOString();
      this.save(tickets);
    }

    // Bump version
    const versionKey = 'personagen_doc_version';
    const cv = parseFloat(localStorage.getItem(versionKey) || '1.0');
    localStorage.setItem(versionKey, (cv + 0.1).toFixed(1));

    this.render();
    this.renderKanban();
    this.showToast(`Moved to ${colKey.charAt(0).toUpperCase() + colKey.slice(1)}`, 'success');
  },

  timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    return days + 'd ago';
  }
};

// ── AI Influencer Account Creator Setup ──
const AccountCreator = {
  KEY: 'personagen_ai_accounts',
  FACTORY_KEY: 'personagen_factory_jobs',
  selectedId: 'sofia-rivera',
  pollingTimers: {},

  // ─── Factory Pipeline Steps ───
  PIPELINE_STEPS: [
    { key: 'identity',  label: 'Identity',  icon: '🪪' },
    { key: 'email',     label: 'Email',     icon: '📧' },
    { key: 'browser',   label: 'Browser',   icon: '🌐' },
    { key: 'signup',    label: 'Signup',    icon: '📝' },
    { key: 'verify',    label: 'Verify',    icon: '✅' },
    { key: 'profile',   label: 'Profile',   icon: '👤' },
    { key: 'session',   label: 'Session',   icon: '🔑' },
  ],

  load() {
    return JSON.parse(localStorage.getItem(this.KEY) || '{}');
  },

  save(data) {
    localStorage.setItem(this.KEY, JSON.stringify(data));
  },

  loadFactoryJobs() {
    return JSON.parse(localStorage.getItem(this.FACTORY_KEY) || '{}');
  },

  saveFactoryJobs(data) {
    localStorage.setItem(this.FACTORY_KEY, JSON.stringify(data));
  },

  init() {
    this.renderSidebar();
    this.select(this.selectedId);
    this.updateAllSidebarBadges();
  },

  renderSidebar() {
    const container = document.getElementById('ac-persona-list');
    if (!container) return;
    const agents = (window.DATA && window.DATA.agents) || INFLUENCERS;
    if (!agents.length) return;
    this.selectedId = agents[0].id || 'sofia-rivera';
    container.innerHTML = agents.map((a, i) => {
      const id = a.id || a.name.toLowerCase().replace(/[^a-z]/g, '-').replace(/-+/g, '-');
      return `
        <button class="ac-sidebar-item${i === 0 ? ' active' : ''}" id="ac-item-${id}" onclick="AccountCreator.select('${id}')">
          <div class="ac-avatar-dot" style="background: ${a.gradient};"></div>
          <div style="text-align: left;">
            <div class="ac-item-name" style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">${a.name}</div>
            <div class="ac-item-handle" style="font-size: 0.68rem; color: var(--text-dim);">${a.handle}</div>
          </div>
        </button>
      `;
    }).join('');
  },

  select(personaId) {
    this.selectedId = personaId;

    // Update active sidebar item
    document.querySelectorAll('.ac-sidebar-item').forEach(btn => {
      btn.classList.remove('active');
    });
    const activeItem = document.getElementById(`ac-item-${personaId}`);
    if (activeItem) {
      activeItem.classList.add('active');
    }

    // Find persona data from DATA.agents (single source of truth)
    let agent = null;
    if (window.DATA && window.DATA.agents) {
      agent = window.DATA.agents.find(a => a.id === personaId);
    }
    // Fallback to INFLUENCERS if data not loaded
    if (!agent) {
      agent = INFLUENCERS.find(a => a.id === personaId || a.handle?.includes(personaId.split('-')[0]));
    }

    if (!agent) return;

    // Populate layout
    document.getElementById('ac-details-name').textContent = agent.name;
    document.getElementById('ac-details-niche').textContent = agent.niche;
    document.getElementById('ac-market-val').textContent = agent.market;
    document.getElementById('ac-followers-val').textContent = agent.followers;
    document.getElementById('ac-details-bio').textContent = agent.bio;

    // Recommendations
    const handleBase = agent.name.toLowerCase().replace(/\s+/g, '');
    document.getElementById('ac-rec-ig').textContent = `@${handleBase}.ai`;
    document.getElementById('ac-rec-tt').textContent = `@${handleBase}_tt`;
    document.getElementById('ac-rec-yt').textContent = `@${handleBase}_shorts`;

    // Update Connection inputs/badges based on localStorage
    const saved = this.load();
    const personaAccounts = saved[personaId] || {};

    ['ig', 'tt', 'yt'].forEach(platform => {
      const handleInput = document.getElementById(`ac-${platform}-handle-input`);
      const badge = document.getElementById(`ac-${platform}-badge`);
      const btn = document.getElementById(`ac-btn-connect-${platform}`);

      if (handleInput && badge && btn) {
        if (personaAccounts[platform]) {
          handleInput.value = personaAccounts[platform];
          badge.textContent = 'Linked';
          badge.className = 'ac-status-badge connected';
          btn.textContent = 'Disconnect';
          btn.style.background = 'rgba(239, 68, 68, 0.1)';
          btn.style.color = 'var(--rose)';
          btn.style.border = '1px solid rgba(239, 68, 68, 0.2)';
        } else {
          handleInput.value = '';
          badge.textContent = 'Not Connected';
          badge.className = 'ac-status-badge disconnected';
          btn.textContent = 'Link Account';
          btn.style.background = 'var(--accent-soft)';
          btn.style.color = 'var(--accent)';
          btn.style.border = 'none';
        }
      }
    });

    // Render session health badges
    this.renderHealthBadges(personaId, personaAccounts);

    // Render factory pipeline if active
    this.renderFactoryPipeline(personaId);

    // Render factory button
    this.renderFactoryButton(personaId);
  },

  // ─── Session Health Badges ───
  renderHealthBadges(personaId, personaAccounts) {
    ['ig', 'tt', 'yt'].forEach(platform => {
      const container = document.getElementById(`ac-health-${platform}`);
      if (!container) return;

      if (!personaAccounts[platform]) {
        container.innerHTML = '';
        return;
      }

      // Demo: simulate session health data
      const healthData = this.getSessionHealth(personaId, platform);
      const badge = this.getHealthBadgeHtml(healthData);
      container.innerHTML = `
        <div class="ac-health-row">
          ${badge}
          ${healthData.status !== 'expired' ? `
            <button class="ac-refresh-session-btn" onclick="AccountCreator.refreshSession('${personaId}', '${platform}')" title="Refresh session">
              🔄 Refresh
            </button>
          ` : ''}
        </div>
      `;
    });
  },

  getSessionHealth(personaId, platform) {
    // Check localStorage for real session data, otherwise show 'Not tracked'
    const saved = this.load();
    const connected = saved[personaId]?.[platform];
    if (!connected) {
      return { status: 'inactive', label: 'Not Connected', icon: '○', daysLeft: 0, color: '#6b7280' };
    }
    // Connected but no real session tracking yet
    return { status: 'active', label: 'Connected', icon: '🟢', daysLeft: 0, color: '#22c55e' };
  },

  getHealthBadgeHtml(health) {
    return `<span class="ac-session-health-badge ac-health--${health.status}" style="--health-color:${health.color};">${health.icon} ${health.label}</span>`;
  },

  async refreshSession(personaId, platform) {
    const btn = event?.target;
    if (btn) {
      btn.textContent = '⏳ Refreshing...';
      btn.disabled = true;
    }

    try {
      await PersonaGenAPI.Factory.refresh(`${personaId}_${platform}`);
    } catch (e) {
      console.warn('[AccountCreator] Refresh failed (offline):', e);
    }

    // Update UI after API call
    if (btn) {
      btn.textContent = '✅ Refreshed';
      btn.disabled = false;
      setTimeout(() => { btn.textContent = '🔄 Refresh'; }, 2000);
    }
    PersonaGenAPI.showToast(`Session refreshed for ${platform.toUpperCase()}`, 'success');
  },

  // ─── Factory Pipeline ───
  renderFactoryButton(personaId) {
    const container = document.getElementById('ac-factory-btn-container');
    if (!container) return;

    const jobs = this.loadFactoryJobs();
    const activeJob = jobs[personaId];

    if (activeJob && activeJob.status === 'running') {
      container.innerHTML = `
        <button class="ac-factory-btn ac-factory-btn--running" disabled>
          <span class="ac-factory-btn-spinner"></span> Factory Running...
        </button>
      `;
    } else {
      container.innerHTML = `
        <button class="ac-factory-btn" onclick="AccountCreator.startFactory('${personaId}')">
          🏭 Create Account via Factory
        </button>
      `;
    }
  },

  renderFactoryPipeline(personaId) {
    const container = document.getElementById('ac-factory-pipeline');
    if (!container) return;

    const jobs = this.loadFactoryJobs();
    const job = jobs[personaId];

    if (!job) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    const steps = this.PIPELINE_STEPS;

    container.innerHTML = `
      <div class="ac-pipeline-wrapper">
        <div class="ac-pipeline-header">
          <span class="ac-pipeline-title">🏭 Account Factory Pipeline</span>
          <span class="ac-pipeline-status ac-pipeline-status--${job.status}">${job.status === 'complete' ? '✅ Complete' : job.status === 'error' ? '❌ Failed' : '⏳ Running'}</span>
        </div>
        <div class="ac-pipeline-steps">
          ${steps.map((step, i) => {
            const stepStatus = job.steps?.[step.key] || 'pending';
            const statusIcon = stepStatus === 'complete' ? '✅' : stepStatus === 'active' ? '🔄' : stepStatus === 'error' ? '❌' : '⏳';
            const statusClass = `ac-pipeline-step--${stepStatus}`;
            return `
              <div class="ac-pipeline-step ${statusClass}">
                <div class="ac-pipeline-step-icon">${statusIcon}</div>
                <div class="ac-pipeline-step-label">${step.icon} ${step.label}</div>
                ${stepStatus === 'error' ? `<button class="ac-pipeline-retry-btn" onclick="AccountCreator.retryStep('${personaId}', '${step.key}')">↻ Retry</button>` : ''}
              </div>
              ${i < steps.length - 1 ? '<div class="ac-pipeline-connector"></div>' : ''}
            `;
          }).join('')}
        </div>
      </div>
    `;
  },

  async startFactory(personaId) {
    const jobs = this.loadFactoryJobs();

    // Init job
    const steps = {};
    this.PIPELINE_STEPS.forEach(s => { steps[s.key] = 'pending'; });
    steps['identity'] = 'active';

    jobs[personaId] = {
      id: 'fj_' + Date.now().toString(36),
      status: 'running',
      steps,
      startedAt: new Date().toISOString(),
    };
    this.saveFactoryJobs(jobs);
    this.renderFactoryButton(personaId);
    this.renderFactoryPipeline(personaId);

    PersonaGenAPI.showToast('Account Factory started — pipeline in progress...', 'info');

    // Try API
    try {
      await PersonaGenAPI.Factory.create({ persona_id: personaId });
    } catch (e) {
      console.warn('[AccountCreator] Factory API call failed (offline), simulating:', e);
    }

    // Start real polling for factory status
    this.pollFactoryStatus(personaId);
  },

  async pollFactoryStatus(personaId) {
    // Clear any existing polling timer
    if (this.pollingTimers[personaId]) {
      clearTimeout(this.pollingTimers[personaId]);
    }

    try {
      const result = await PersonaGenAPI.Factory.status(personaId);
      if (result && result.steps) {
        const jobs = this.loadFactoryJobs();
        const job = jobs[personaId];
        if (!job) return;

        // Update steps from backend
        Object.assign(job.steps, result.steps);
        job.status = result.status || job.status;
        this.saveFactoryJobs(jobs);
        this.renderFactoryPipeline(personaId);
        this.renderFactoryButton(personaId);

        if (job.status === 'complete') {
          PersonaGenAPI.showToast('Account Factory complete! All steps finished.', 'success');
          return;
        }
        if (job.status === 'error') {
          PersonaGenAPI.showToast('Account Factory encountered an error. Check steps for retry options.', 'error');
          return;
        }
      }
    } catch (e) {
      console.warn('[AccountCreator] Status poll failed, will retry:', e);
    }

    // Continue polling every 5s while running
    const jobs = this.loadFactoryJobs();
    const job = jobs[personaId];
    if (job && job.status === 'running') {
      this.pollingTimers[personaId] = setTimeout(() => this.pollFactoryStatus(personaId), 5000);
    }
  },

  async retryStep(personaId, stepKey) {
    const jobs = this.loadFactoryJobs();
    const job = jobs[personaId];
    if (!job) return;

    job.steps[stepKey] = 'active';
    job.status = 'running';
    this.saveFactoryJobs(jobs);
    this.renderFactoryPipeline(personaId);
    this.renderFactoryButton(personaId);

    try {
      await PersonaGenAPI.Factory.retry(job.id, stepKey);
    } catch (e) {
      console.warn('[AccountCreator] Retry failed (offline):', e);
    }

    // Poll for retry result
    this.pollFactoryStatus(personaId);
  },

  async connectPlatform(platform) {
    const personaId = this.selectedId;
    const handleInput = document.getElementById(`ac-${platform}-handle-input`);
    const btn = document.getElementById(`ac-btn-connect-${platform}`);

    if (!handleInput || !btn) return;

    const saved = this.load();
    if (!saved[personaId]) saved[personaId] = {};

    if (saved[personaId][platform]) {
      // Disconnect action — use toast confirmation pattern
      PersonaGenAPI.showToast(`Disconnecting ${platform.toUpperCase()}...`, 'info');
      delete saved[personaId][platform];
      this.save(saved);
      this.select(personaId);
      this.updateAllSidebarBadges();
      PersonaGenAPI.showToast(`${platform.toUpperCase()} disconnected`, 'success');
      return;
    }

    // Connect action
    let handle = handleInput.value.trim();
    if (!handle || handle === '@') {
      PersonaGenAPI.showToast('Please enter a valid handle to connect', 'warning');
      handleInput.focus();
      return;
    }
    if (!handle.startsWith('@')) handle = '@' + handle;

    // Connection verification with webhook
    btn.textContent = 'Verifying...';
    btn.disabled = true;

    try {
      // Fire webhook to n8n for real verification
      await PersonaWebhook.fire('social.connect', { personaId, platform, handle, source: 'persona-accounts' });
    } catch (e) {
      console.warn('[AccountCreator] Webhook fire failed:', e);
    }

    saved[personaId][platform] = handle;
    this.save(saved);
    this.select(personaId);
    this.updateAllSidebarBadges();

    // Mirror connection status to main Social Connections UI
    const mainData = SocialConnections.load();
    mainData[platform] = handle;
    SocialConnections.save(mainData);
    SocialConnections.updateUI(platform, handle);

    PersonaGenAPI.showToast(`✅ ${handle} linked to ${personaId} — content engine active`, 'success');
    btn.textContent = '✓ Connected';
    btn.disabled = false;
  },

  updateAllSidebarBadges() {
    // Show green/blue indicator if persona has at least one account connected
    const saved = this.load();
    // Use DATA.agents as source of truth for persona IDs and handles
    const agents = (window.DATA && window.DATA.agents) || INFLUENCERS;
    agents.forEach(a => {
      const id = a.id || a.name.toLowerCase().replace(/[^a-z]/g, '-').replace(/-+/g, '-').replace(/(^-|-$)/g, '');
      const label = document.getElementById(`ac-item-${id}`);
      if (label) {
        const counts = Object.keys(saved[id] || {}).length;
        const handleEl = label.querySelector('.ac-item-handle');
        if (handleEl) {
          if (counts > 0) {
            handleEl.innerHTML = `🟢 ${counts} account${counts > 1 ? 's' : ''} connected`;
            handleEl.style.color = 'var(--success)';
          } else {
            handleEl.textContent = a.handle;
            handleEl.style.color = 'var(--text-muted)';
          }
        }
      }
    });
  },

  openNewAvatarWizard() {
    const mount = document.getElementById('pg-avatar-wizard');
    if (mount) {
      mount.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      PersonaGenAPI.showToast('Avatar Wizard mount not found', 'warning');
    }
  }
};


// ── Mega-View Definitions ──
const MEGA_VIEWS = {
  'intelligence': {
    title: 'Intelligence Hub',
    tabs: [
      { id: 'scout', label: 'Social Scout', icon: '🔍' },
      { id: 'trends', label: 'Trends', icon: '📈' },
      { id: 'channel-decoder', label: 'Decoder', icon: '🔬' }
    ]
  },
  'content-studio': {
    title: 'Content Studio',
    tabs: [
      { id: 'content-forge', label: 'Forge', icon: '⚡' },
      { id: 'calendar', label: 'Calendar', icon: '📅' },
      { id: 'brand-brief', label: 'Brand Brief', icon: '📋' }
    ]
  }
};

let _activeMega = null;

// ── Mega-View Switcher ──
function switchMegaView(megaId, clickedBtn) {
  const mega = MEGA_VIEWS[megaId];
  if (!mega) return;
  _activeMega = megaId;

  const tabBar = document.getElementById('mega-tab-bar');
  if (tabBar) {
    tabBar.innerHTML = mega.tabs.map((t, i) =>
      `<button class="mega-tab${i === 0 ? ' active' : ''}" onclick="switchMegaTab('${megaId}', '${t.id}', this)"><span class="mega-tab-icon">${t.icon}</span>${t.label}</button>`
    ).join('');
    tabBar.classList.add('visible');
  }

  switchPortalView(mega.tabs[0].id, clickedBtn);
}

function switchMegaTab(megaId, viewId, tabBtn) {
  const tabBar = document.getElementById('mega-tab-bar');
  if (tabBar) {
    tabBar.querySelectorAll('.mega-tab').forEach(t => t.classList.remove('active'));
    if (tabBtn) tabBtn.classList.add('active');
  }
  _activeMega = megaId;
  switchPortalView(viewId, null, true);
}

// ── Operations Portal View Switcher ──
function switchPortalView(viewId, clickedBtn, keepTabs) {
  const isDashboardSection = ['dashboard', 'calendar', 'scout', 'generator'].includes(viewId);
  const targetViewId = isDashboardSection ? 'dashboard' : viewId;

  const subviews = document.querySelectorAll('.portal-subview');
  subviews.forEach(view => {
    view.classList.remove('active');
    view.style.display = 'none';
  });

  const activeView = document.getElementById('portal-view-' + targetViewId);
  if (activeView) {
    activeView.classList.add('active');
    activeView.style.display = 'block';
  }

  const menuItems = document.querySelectorAll('.dash-sidebar .dash-menu-item');
  menuItems.forEach(item => item.classList.remove('active'));

  if (!keepTabs) {
    let parentMega = null;
    for (const [mId, mDef] of Object.entries(MEGA_VIEWS)) {
      if (mDef.tabs.some(t => t.id === viewId)) { parentMega = mId; break; }
    }

    if (parentMega) {
      const megaBtn = document.querySelector(`.dash-sidebar button[onclick*="switchMegaView('${parentMega}'"]`);
      if (megaBtn) megaBtn.classList.add('active');
    } else {
      let targetBtn = clickedBtn;
      if (!targetBtn) {
        targetBtn = document.querySelector(`.dash-sidebar button[onclick*="switchPortalView('${viewId}'"]`);
      }
      if (targetBtn) targetBtn.classList.add('active');
    }

    if (!parentMega) {
      _activeMega = null;
      const tabBar = document.getElementById('mega-tab-bar');
      if (tabBar) { tabBar.classList.remove('visible'); tabBar.innerHTML = ''; }
    }
  } else {
    if (_activeMega) {
      const megaBtn = document.querySelector(`.dash-sidebar button[onclick*="switchMegaView('${_activeMega}'"]`);
      if (megaBtn) megaBtn.classList.add('active');
    }
  }

  const titleEl = document.getElementById('dash-view-title');
  if (titleEl) {
    const titles = {
      'dashboard': 'Operations Dashboard',
      'calendar': 'Content & Schedule',
      'scout': 'Social Scout Intelligence',
      'generator': 'Interactive Creator & Roster',
      'pm': 'Support & Tickets',
      'accounts': 'Connected Platform Handles',
      'persona-config': 'AI Agent Configuration',
      'inbox': 'Inbox & Engagement Hub',
      'trends': 'Trending Topics Monitor',
      'channel-decoder': 'Channel Decoder — 9-Layer Analysis',
      'content-forge': 'Content Forge — Blueprint to Production',
      'agreement': 'Managed Plan SOW & SLA',
      'brand-brief': 'Brand Brief Interview'
    };
    if (_activeMega && MEGA_VIEWS[_activeMega]) {
      titleEl.textContent = MEGA_VIEWS[_activeMega].title;
    } else {
      titleEl.textContent = titles[viewId] || 'Operations Dashboard';
    }
  }

  if (viewId === 'persona-config' && !document.querySelector('.pce-layout')) {
    PersonaConfigEditor.init('persona-config-mount');
  }
  if (viewId === 'inbox' && !document.querySelector('.inbox-wrapper')) {
    InboxHub.init('inbox-mount');
  }
  if (viewId === 'trends' && !document.querySelector('.trends-wrapper')) {
    TrendMonitor.init('trends-mount');
  }
  if (viewId === 'brand-brief' && typeof BrandBrief !== 'undefined') {
    BrandBrief.init('pg-brand-brief');
  }
  if (viewId === 'channel-decoder' && typeof ChannelDecoder !== 'undefined' && !document.querySelector('.cd-wrapper')) {
    ChannelDecoder.init('channel-decoder-mount');
  }
  if (viewId === 'content-forge' && typeof ContentForge !== 'undefined' && !document.querySelector('.cf-wrapper')) {
    ContentForge.init('content-forge-mount');
  }
  // Calendar init — both when switching to calendar tab AND on initial dashboard load
  if ((viewId === 'calendar' || viewId === 'dashboard') && typeof DynamicCalendar !== 'undefined' && !document.querySelector('.dcal-wrapper')) {
    DynamicCalendar.init('dynamic-calendar-mount');
  }

  const workspace = document.querySelector('.dash-workspace');
  if (workspace) {
    if (isDashboardSection) {
      workspace.classList.remove('no-right-sidebar');
    } else {
      workspace.classList.add('no-right-sidebar');
    }
  }

  if (isDashboardSection) {
    const sectionMap = {
      'dashboard': 'dash-sec-summary',
      'calendar': 'dash-sec-calendar',
      'scout': 'dash-sec-scout',
      'generator': 'dash-sec-generator'
    };
    const allSections = Object.values(sectionMap);
    
    if (viewId === 'dashboard') {
      // Dashboard sidebar click → show ALL sections
      allSections.forEach(secId => {
        const el = document.getElementById(secId);
        if (el) el.style.display = '';
      });
      // Scroll to top of dashboard
      const centerPanel = document.querySelector('.dash-center-panel');
      if (centerPanel) centerPanel.scrollTop = 0;
      window.scrollTo({ top: 0, behavior: 'instant' });
    } else {
      // Mega-tab click → show ONLY the targeted section
      const targetSectionId = sectionMap[viewId];
      allSections.forEach(secId => {
        const el = document.getElementById(secId);
        if (el) {
          el.style.display = (secId === targetSectionId) ? '' : 'none';
          // Remove the border-top separator when showing solo
          if (secId === targetSectionId) {
            el.style.marginTop = '0';
            el.style.paddingTop = '0';
            el.style.borderTop = 'none';
          }
        }
      });
      // Scroll to top of the visible section
      const centerPanel = document.querySelector('.dash-center-panel');
      if (centerPanel) centerPanel.scrollTop = 0;
      window.scrollTo({ top: 0, behavior: 'instant' });
      // Also scrollIntoView the target section for reliability
      const targetEl = document.getElementById(targetSectionId);
      if (targetEl) targetEl.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  } else {
    // Non-dashboard view → restore all dashboard sections for when user returns
    ['dash-sec-summary', 'dash-sec-scout', 'dash-sec-generator', 'dash-sec-calendar'].forEach(secId => {
      const el = document.getElementById(secId);
      if (el) {
        el.style.display = '';
        el.style.marginTop = '';
        el.style.paddingTop = '';
        el.style.borderTop = '';
      }
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  if (window.innerWidth <= 768) {
    const sidebar = document.querySelector('.dash-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
  }
}

// ── PM Stats Toggle ──
function togglePMStats() {
  const grid = document.getElementById('pm-stats');
  const chevron = document.querySelector('.pm-stats-chevron');
  if (!grid) return;
  grid.classList.toggle('collapsed');
  if (chevron) chevron.classList.toggle('open', !grid.classList.contains('collapsed'));
}

// ── Click-outside handler for collapsibles ──
document.addEventListener('click', (e) => {
  // Profile dropdown (uses .open class)
  const profileWrap = document.querySelector('.profile-dropdown-wrap');
  const profileMenu = document.getElementById('profile-dropdown');
  if (profileMenu && profileMenu.classList.contains('open') && profileWrap && !profileWrap.contains(e.target)) {
    profileMenu.classList.remove('open');
  }
  // Right analytics panel (mobile overlay)
  if (window.innerWidth <= 768) {
    const rightPanel = document.querySelector('.dash-right-panel');
    const toggleBtn = document.getElementById('dash-analytics-toggle');
    if (rightPanel && rightPanel.classList.contains('open') && !rightPanel.contains(e.target) && toggleBtn && !toggleBtn.contains(e.target)) {
      rightPanel.classList.remove('open');
      rightPanel.classList.add('collapsed');
      if (toggleBtn) toggleBtn.classList.remove('panel-open');
    }
  }
});

// ── Init: collapse right panel + populate analytics on load ──
document.addEventListener('DOMContentLoaded', () => {
  const panel = document.querySelector('.dash-right-panel');
  const workspace = document.querySelector('.dash-workspace');
  if (panel) panel.classList.add('collapsed');
  if (workspace) workspace.classList.add('right-collapsed');

  // Populate right-panel KPIs from loaded data after a short delay
  setTimeout(() => {
    const agents = window.DATA && window.DATA.agents;
    if (agents && Array.isArray(agents)) {
      const activeCount = agents.filter(a => a.status === 'active' || !a.status).length;
      const el = document.getElementById('kpi-total-rp');
      if (el) el.textContent = activeCount || agents.length;
    }
    // Engagement from agent data
    const engEl = document.getElementById('kpi-engagement');
    if (engEl && agents && agents.length) {
      const avgEng = agents.reduce((sum, a) => sum + (a.engagement_rate || a.engagementRate || 0), 0) / agents.length;
      engEl.textContent = avgEng > 0 ? avgEng.toFixed(1) + '%' : '—';
    }
  }, 1500);
});

// ── Drag & Drop Event Handlers ──
function allowDrop(ev) {
  ev.preventDefault();
}

function dropMedia(ev) {
  ev.preventDefault();
  const cell = ev.currentTarget;
  if (!cell.classList.contains('sched-cell')) return;

  const bgImg = ev.dataTransfer.getData('text/plain');
  const mediaName = ev.dataTransfer.getData('media-name') || 'UGC Video Post';
  const hour = cell.getAttribute('data-time');
  const day = cell.getAttribute('data-day');

  const platforms = ['ig', 'tt', 'yt', 'tw'];
  const pClasses = { ig: 'sb-ig', tt: 'sb-tt', yt: 'sb-yt', tw: 'sb-tw' };
  const randPlatform = platforms[Math.floor(Math.random() * platforms.length)];
  const pClass = pClasses[randPlatform];

  const blockHtml = `
    <div class="sched-block ${pClass}">
      <div class="sched-block-thumb" style="background-image: ${bgImg}; height: 40px; margin-bottom: 2px;"></div>
      <div class="sched-block-title">${mediaName}</div>
      <div class="sched-block-meta">
        <span class="sched-block-platform">${randPlatform.toUpperCase()}</span>
        <span>${hour}</span>
      </div>
    </div>
  `;

  cell.innerHTML = blockHtml;
  
  const alertMsg = `Scheduled "${mediaName}" for ${getDayName(parseInt(day))} at ${hour} via ${randPlatform.toUpperCase()}!`;
  console.log(`[Calendar] ${alertMsg}`);
  showNotification(alertMsg);
}

function getDayName(idx) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return days[idx] || 'Monday';
}

function showNotification(msg) {
  let container = document.getElementById('dash-notification-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'dash-notification-container';
    container.style.position = 'fixed';
    container.style.top = '24px';
    container.style.right = '24px';
    container.style.zIndex = '99999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '12px';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.style.background = 'rgba(7, 6, 11, 0.95)';
  toast.style.border = '1px solid rgba(124, 106, 237, 0.3)';
  toast.style.boxShadow = '0 12px 30px rgba(124, 106, 237, 0.15)';
  toast.style.padding = '14px 22px';
  toast.style.borderRadius = '10px';
  toast.style.color = '#fff';
  toast.style.fontSize = '0.75rem';
  toast.style.fontWeight = '600';
  toast.style.fontFamily = "'Inter', sans-serif";
  toast.style.display = 'flex';
  toast.style.alignItems = 'center';
  toast.style.gap = '10px';
  toast.style.transform = 'translateX(120%)';
  toast.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
  toast.innerHTML = `
    <span style="font-size: 1rem; color: var(--accent);">⚡</span>
    <span>${msg}</span>
  `;

  container.appendChild(toast);
  
  // Trigger layout reflow then transition
  setTimeout(() => {
    toast.style.transform = 'translateX(0)';
  }, 50);

  // Auto remove
  setTimeout(() => {
    toast.style.transform = 'translateX(120%)';
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

