// ═══════════════════════════════════════
// DATA: AI INFLUENCER ROSTER
// ═══════════════════════════════════════
const INFLUENCERS = [
    {
        name: "Sofia Rivera", handle: "@sofiarivera.ai", initial: "S",
        gradient: "linear-gradient(135deg, #f472b6, #a78bfa)",
        headerBg: "linear-gradient(135deg, #fce7f3, #ede9fe)",
        bio: "Latina fitness coach & wellness advocate. Posts daily workout routines, meal prep content, and mindset motivation across Instagram and TikTok.",
        niche: "Fitness & Wellness", market: "US / LATAM",
        followers: "24.8K", posts: "312", engagement: "6.2%",
        platforms: ["Instagram", "TikTok", "YouTube"],
        soul: `# soul.md — Sofia Rivera\n\n## Identity\nLatina fitness coach, 28, based in Miami.\nFirst-gen immigrant background fuels\n"no excuses" work ethic.\n\n## Voice\nWarm but direct. Uses Spanglish naturally.\nMotivational without being preachy.\n\n## Values\n- Body positivity over aesthetics\n- Science-backed nutrition\n- Community over competition\n\n## Behavioral Directives\n- Never promote crash diets\n- Always include modifier exercises\n- Respond to DMs within persona voice\n- Post ratio: 60% educational, 40% lifestyle`,
        tools: `# tools.md — Sofia Rivera\n\n## Connected Platforms\n✅ Instagram (API v18)\n✅ TikTok (Publish API)\n✅ YouTube (Shorts Upload)\n\n## Integrations\n- Content Generator: LLM v4.2\n- Image Pipeline: SDXL + LoRA\n- Scheduler: n8n Cron Trigger\n- Analytics: Engagement Tracker\n- Proxy: SOCKS5 Rotator (US-East)\n\n## Capabilities\n- Auto-caption generation\n- Hashtag optimization engine\n- A/B post testing (2 variants)\n- Comment reply automation`,
        skills: `# skills.md — Sofia Rivera\n\n## Content Skills\n- Reel editing (cut-to-beat sync)\n- Carousel layout design\n- Caption copywriting (CTA hooks)\n- Voiceover narration scripting\n\n## Scouting Skills\n- Fitness hashtag trend detection\n- Competitor workout format analysis\n- Viral audio identification\n- Engagement pattern recognition\n\n## Learning Loop\n- Weekly: Analyze top 10 fitness Reels\n- Bi-weekly: Update caption templates\n- Monthly: Retrain content voice from\n  top-performing posts\n- On-demand: Absorb scout insights`,
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
        tools: `# tools.md — Marcus Chen\n\n## Connected Platforms\n✅ Twitter/X (API v2 OAuth)\n✅ LinkedIn (Publishing API)\n✅ Threads (Meta Graph API)\n\n## Integrations\n- Content Generator: LLM v4.2\n- Thread Composer: Auto-split\n- Trend Scanner: X Trending API\n- Scheduler: n8n Cron Trigger\n- Proxy: SOCKS5 Rotator (US-West)\n\n## Capabilities\n- Multi-platform thread sync\n- Trending topic detection\n- Auto-poll generation\n- Engagement-based repost timing`,
        skills: `# skills.md — Marcus Chen\n\n## Content Skills\n- Thread architecture (hook→proof→CTA)\n- Data visualization screenshots\n- Poll question engineering\n- LinkedIn article formatting\n\n## Scouting Skills\n- ArXiv paper summarization\n- GitHub trending repo analysis\n- Tech Twitter discourse mapping\n- Startup funding round tracking\n\n## Learning Loop\n- Daily: Scan Hacker News top 20\n- Weekly: Analyze thread engagement\n- Bi-weekly: Update contrarian takes DB\n- Monthly: Recalibrate voice from\n  top-performing threads`,
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
        tools: `# tools.md — Aisha Noori\n\n## Connected Platforms\n✅ Instagram (API v18)\n✅ TikTok (Publish API)\n✅ YouTube (Shorts + Long-form)\n✅ Threads (Meta Graph API)\n\n## Integrations\n- Content Generator: LLM v4.2\n- Image Pipeline: SDXL + Fashion LoRA\n- Video Editor: Auto-cut + Captions\n- Scheduler: n8n Cron Trigger\n- Proxy: SOCKS5 Rotator (EU-Dubai)\n\n## Capabilities\n- Outfit detection + tagging\n- Multi-language caption (AR/EN)\n- Brand collab template system\n- Story sequence automation`,
        skills: `# skills.md — Aisha Noori\n\n## Content Skills\n- OOTD flat-lay composition\n- GRWM cinematic transitions\n- Brand mood-board curation\n- Bilingual caption crafting\n\n## Scouting Skills\n- Fashion week runway tracking\n- Emerging designer discovery\n- Luxury brand collab detection\n- Regional modest fashion gaps\n\n## Learning Loop\n- Daily: Monitor Vogue/Elle feeds\n- Weekly: Analyze top fashion Reels\n- Bi-weekly: Update style templates\n- Monthly: Retrain aesthetic from\n  highest-engagement visuals`,
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
        tools: `# tools.md — Veronica Hap\n\n## Connected Platforms\n✅ TikTok (Publish API + For You)\n✅ Instagram (Reels + Stories)\n✅ YouTube (Shorts Pipeline)\n\n## Integrations\n- Content Generator: LLM v4.2\n- Avatar Pipeline: Wan 2.7 Pro\n- Video Renderer: AI Lip-sync\n- Audio Mapper: Trending Sound API\n- Scheduler: n8n Cron Trigger\n- Proxy: SOCKS5 Rotator (US-Multi)\n\n## Capabilities\n- Trending audio auto-detection\n- AI lip-sync video generation\n- POV/GRWM template system\n- Engagement-based repost timing\n- Comment persona maintenance`,
        skills: `# skills.md — Veronica Hap\n\n## Content Skills\n- POV skit scripting (3-act micro)\n- GRWM sequence choreography\n- Trending sound lip-sync timing\n- Storytime narrative hooks\n\n## Scouting Skills\n- TikTok For You trend detection\n- Viral audio early identification\n- Beauty product launch tracking\n- Gen-Z slang evolution monitoring\n\n## Learning Loop\n- 2x Daily: Scan For You page top 20\n- Daily: Update trending audio DB\n- Weekly: Retrain hook patterns from\n  top-performing POVs\n- Monthly: Full skill recalibration`,
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
const GEN_NAMES = {
    fitness: ["Jordan Blake","Maya Santos","Tyler Okoye","Rina Patel","Dex Moreau"],
    tech: ["Alex Kuznetsov","Priya Sharma","Leo Tanaka","Sam Odera","Kai Fischer"],
    fashion: ["Valentina Rossi","Nadia El-Amin","Zara Kim","Luca Mbeki","Celeste Voss"],
    finance: ["Grant Hawthorne","Yuki Nakamura","Omar Farid","Diana Kross","Ravi Mehta"],
    travel: ["Luna Espinoza","Nico Strand","Amara Diallo","Finn Calloway","Isla Duarte"],
    food: ["Chef Nana K.","Marco Bianchi","Suki Park","Abena Owusu","Liam Aster"]
};
const GEN_BIOS = {
    fitness: ["Certified personal trainer & nutrition coach. Helping you build sustainable habits, one rep at a time.","Movement specialist breaking fitness myths with science-backed content. No BS, just gains."],
    tech: ["Building in public. Sharing the tools, frameworks, and AI breakthroughs that actually matter.","Former FAANG engineer turned indie hacker. Documenting the future of autonomous systems."],
    fashion: ["Curating the intersection of high fashion and street culture. Every outfit tells a story.","Sustainable fashion advocate. Proving you don't need fast fashion to look incredible."],
    finance: ["Making DeFi and macro economics accessible. Your portfolio deserves better than guessing.","Data-driven market analysis meets real talk. No financial advice, just alpha."],
    travel: ["Exploring hidden gems and local cultures one city at a time. Budget to luxury, I cover it all.","Digital nomad documenting the world's most underrated destinations. Adventure awaits."],
    food: ["Home cooking elevated. Restaurant-quality recipes you can actually make on a Tuesday night.","Street food hunter and recipe developer. If it's delicious, I'm there."]
};
const GEN_POSTS = {
    fitness:{instagram:"Just crushed a 5AM leg day 🔥 Your body can handle almost anything — it's your mind you have to convince. Full routine in bio ➡️ #FitnessMotivation #LegDay #GymLife",tiktok:"POV: When someone says 'I don't have time to work out' but watches 3 hours of Netflix 😭💀 #GymTok #FitTok #Motivation",twitter:"Hot take: You don't need a gym membership to get in the best shape of your life. Here's my bodyweight-only program (thread) 🧵"},
    tech:{instagram:"Built an autonomous agent that manages my entire deployment pipeline. The future isn't coming — it's here. Full breakdown on YouTube ⬇️ #AI #DevOps #Automation",tiktok:"When ChatGPT writes better code than your senior dev 💀 #TechTok #Programming #AI",twitter:"Unpopular opinion: MCP (Model Context Protocol) will make traditional REST APIs obsolete within 3 years. Here's why 🧵"},
    fashion:{instagram:"Monochrome moment. Sometimes less is everything. 🖤 Jacket: @designer | Boots: vintage find | Attitude: non-negotiable ✨ #OOTD #FashionInspo #MinimalStyle",tiktok:"POV: Your friend asks you to 'dress casual' for brunch 😂👗 #FashionTok #GRWM #StyleInspo",twitter:"The best-dressed people I know own fewer than 30 pieces. Quality over quantity, always."},
    finance:{instagram:"📊 BTC just broke structure on the weekly. Here's what my models are showing for Q3... Full analysis in stories ➡️ #Crypto #Trading #Bitcoin",tiktok:"Explaining the Federal Reserve's rate decision like you're five 🧒📈 #FinTok #Investing #Economy",twitter:"Macro update: CPI data just dropped. Markets pricing in a July cut. Here's what smart money is doing (thread) 🧵"},
    travel:{instagram:"Found this hidden cenote in the Yucatán Peninsula. No tourists, just turquoise water and pure magic. 📍 Saved the location for you ✨ #TravelMexico #HiddenGems",tiktok:"$47/night hotel with THIS view?! 😱🏝️ Save this for your next trip! #TravelTok #BudgetTravel #HiddenGem",twitter:"Just spent 2 weeks in Georgia (the country). $800 total including flights. Thread of everything you need to know 🧵🇬🇪"},
    food:{instagram:"Homemade truffle pasta that took 20 minutes and zero skill. Recipe in carousel ➡️ You're welcome. 🍝✨ #FoodieLife #HomeCooking #PastaRecipe",tiktok:"Making the viral Dubai chocolate bar at home and honestly? It's better 🍫😤 #FoodTok #Recipe #Viral",twitter:"Hot take: Most 'restaurant quality' food is just home cooking with better seasoning and plating. The skills aren't hard. The confidence is."}
};

const GEN_UGC = {
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

const TREND_ITEMS = [
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
    el.innerHTML = TREND_ITEMS.map(t => `
        <div class="trend-tag">
            <div class="trend-tag-name">${t.name}</div>
            <div class="trend-tag-meta">${t.posts} posts · <span class="${t.hot ? 'trend-tag-hot' : ''}">${t.growth}</span></div>
        </div>
    `).join('');
}

// ═══════════════════════════════════════
// DATA: DASHBOARD AGENT ROSTER
// ═══════════════════════════════════════
const DASH_AGENTS = [
    { name:"Sofia Rivera", handle:"@sofiarivera.ai", niche:"Fitness", initial:"S", gradient:"linear-gradient(135deg,#f472b6,#a78bfa)", followers:"24.8K", engagement:6.2, trend:"+1.4%", status:"active", active:true, perf:82, color:"#f472b6" },
    { name:"Marcus Chen", handle:"@marcuschen.tech", niche:"Tech & AI", initial:"M", gradient:"linear-gradient(135deg,#34d399,#60a5fa)", followers:"89.2K", engagement:4.8, trend:"+0.6%", status:"active", active:true, perf:74, color:"#34d399" },
    { name:"Aisha Noori", handle:"@aishanoori.style", niche:"Fashion", initial:"A", gradient:"linear-gradient(135deg,#fbbf24,#f97316)", followers:"156K", engagement:7.1, trend:"+2.1%", status:"active", active:true, perf:95, color:"#fbbf24" },
    { name:"Veronica Hap", handle:"@veronicahap", niche:"Lifestyle", initial:"V", gradient:"linear-gradient(135deg,#8b5cf6,#ec4899)", followers:"412K", engagement:9.3, trend:"+4.1%", status:"active", active:true, perf:97, color:"#8b5cf6" },
    { name:"Jordan Blake", handle:"@jordanblake.fit", niche:"Fitness", initial:"J", gradient:"linear-gradient(135deg,#6366f1,#ec4899)", followers:"8.4K", engagement:5.9, trend:"+0.8%", status:"active", active:true, perf:68, color:"#6366f1" },
    { name:"Priya Sharma", handle:"@priyasharma.dev", niche:"Tech & AI", initial:"P", gradient:"linear-gradient(135deg,#a78bfa,#06b6d4)", followers:"31.6K", engagement:3.2, trend:"-0.4%", status:"active", active:true, perf:45, color:"#a78bfa" },
    { name:"Valentina Rossi", handle:"@valentinarossi", niche:"Fashion", initial:"V", gradient:"linear-gradient(135deg,#ec4899,#f97316)", followers:"67.3K", engagement:6.8, trend:"+1.7%", status:"active", active:true, perf:88, color:"#ec4899" },
    { name:"Grant Hawthorne", handle:"@granthawthorne", niche:"Finance", initial:"G", gradient:"linear-gradient(135deg,#22c55e,#14b8a6)", followers:"42.1K", engagement:4.1, trend:"+0.3%", status:"active", active:true, perf:61, color:"#22c55e" },
    { name:"Luna Espinoza", handle:"@lunaespinoza", niche:"Travel", initial:"L", gradient:"linear-gradient(135deg,#06b6d4,#8b5cf6)", followers:"19.7K", engagement:8.3, trend:"+3.2%", status:"active", active:true, perf:91, color:"#06b6d4" },
    { name:"Chef Nana K.", handle:"@chefnanak", niche:"Food", initial:"N", gradient:"linear-gradient(135deg,#f59e0b,#ef4444)", followers:"55.9K", engagement:5.5, trend:"+0.9%", status:"active", active:true, perf:72, color:"#f59e0b" },
    { name:"Omar Farid", handle:"@omarfarid.fin", niche:"Finance", initial:"O", gradient:"linear-gradient(135deg,#14b8a6,#6366f1)", followers:"12.3K", engagement:2.1, trend:"-1.2%", status:"paused", active:false, perf:28, color:"#14b8a6" },
    { name:"Nico Strand", handle:"@nicostrand", niche:"Travel", initial:"N", gradient:"linear-gradient(135deg,#fbbf24,#22c55e)", followers:"3.2K", engagement:1.4, trend:"-0.7%", status:"failing", active:false, perf:15, color:"#fbbf24" },
    { name:"Zara Kim", handle:"@zarakim.style", niche:"Fashion", initial:"Z", gradient:"linear-gradient(135deg,#ec4899,#a78bfa)", followers:"5.1K", engagement:3.9, trend:"+0.2%", status:"paused", active:false, perf:38, color:"#ec4899" }
];

const SPARK_DATA = [
    [4.8, 5.1, 5.4, 6.0, 5.8, 6.2, 6.2],  // Sofia
    [4.2, 4.5, 4.3, 4.6, 4.9, 4.7, 4.8],  // Marcus
    [5.9, 6.2, 6.5, 6.8, 7.0, 6.9, 7.1]   // Aisha
];

const PLATFORM_DATA = [
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
        <div class="dash-row" data-idx="${DASH_AGENTS.indexOf(a)}">
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
    const w = 500, h = 160;
    const padL = 45, padR = 12, padT = 12, padB = 20;
    const colors = ['#6366f1','#34d399','#fbbf24'];
    const allVals = SPARK_DATA.flat();
    const min = Math.min(...allVals) - 0.5, max = Math.max(...allVals) + 0.5;
    const scaleX = i => padL + (i / 6) * (w - padL - padR);
    const scaleY = v => h - padB - ((v - min) / (max - min)) * (h - padT - padB);

    const lines = SPARK_DATA.map((data, si) => {
        const pts = data.map((v, i) => `${scaleX(i)},${scaleY(v)}`).join(' ');
        const dots = data.map((v, i) => `<circle cx="${scaleX(i)}" cy="${scaleY(v)}" r="3.5" fill="${colors[si]}" opacity="0.9"/>`).join('');
        return `<polyline points="${pts}" fill="none" stroke="${colors[si]}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>${dots}`;
    }).join('');

    // Grid lines
    const gridLines = [min, min + (max-min)/3, min + 2*(max-min)/3, max].map(v =>
        `<line x1="${padL}" y1="${scaleY(v)}" x2="${w-padR}" y2="${scaleY(v)}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
         <text x="${padL-6}" y="${scaleY(v)+3}" fill="rgba(255,255,255,0.25)" font-size="8" text-anchor="end">${v.toFixed(1)}%</text>`
    ).join('');

    const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i) =>
        `<text x="${scaleX(i)}" y="${h-2}" fill="rgba(255,255,255,0.25)" font-size="8" text-anchor="middle">${d}</text>`
    ).join('');

    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${gridLines}${lines}${dayLabels}</svg>`;
}

function renderPlatformBars() {
    const el = document.getElementById('platform-bars');
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
}

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => chip.classList.toggle('active'));
    });

    // Render all sections
    renderInfluencers();
    renderCalendar(0);
    renderTrendTicker();
    renderDashboard();

    // Counter animation
    document.querySelectorAll('.counter').forEach(counter => {
        const target = +counter.dataset.target;
        const increment = target / 60;
        let current = 0;
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) { counter.textContent = target; clearInterval(timer); }
            else counter.textContent = Math.floor(current);
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
    const obs = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
    document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

    // Active nav
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link');
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
});
