<script lang="ts">
  import { showToast } from '$lib/stores/ui.svelte';

  const niches = [
    { id: 'beauty', label: 'Beauty', icon: '💄' },
    { id: 'fashion', label: 'Fashion', icon: '👗' },
    { id: 'lifestyle', label: 'Lifestyle', icon: '✨' },
    { id: 'fitness', label: 'Fitness', icon: '💪' },
    { id: 'food', label: 'Food', icon: '🍳' },
    { id: 'tech', label: 'Tech', icon: '💻' },
    { id: 'travel', label: 'Travel', icon: '✈️' },
    { id: 'gaming', label: 'Gaming', icon: '🎮' },
    { id: 'sports', label: 'Sports', icon: '⚽' },
    { id: 'entertainment', label: 'Entertainment', icon: '🎬' },
    { id: 'art', label: 'Art & Design', icon: '🎨' },
    { id: 'finance', label: 'Finance & Biz', icon: '💸' },
    { id: 'music', label: 'Music', icon: '🎵' }
  ];

  let selectedNiche = $state('beauty');
  let refreshing = $state(false);

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  type VelocityType = 'hot' | 'rising' | 'stable' | 'declining';

  interface TrendHashtag {
    tag: string;
    count: string;
    velocity: VelocityType;
    change: string;
  }

  interface TrendSound {
    name: string;
    artist: string;
    uses: string;
    velocity: VelocityType;
    platform: string;
  }

  interface PlatformTrend {
    platform: string;
    icon: string;
    color: string;
    trends: string[];
    trendCount: number;
  }

  // Seed-based pseudo-random for stable heatmap data
  function seededRandom(seed: number): number {
    const x = Math.sin(seed * 9301 + 49297) * 233280;
    return x - Math.floor(x);
  }

  function generateHeatmapData(niche: string): number[][] {
    const nicheOffset: Record<string, number> = {
      beauty: 42, fashion: 87, lifestyle: 13, fitness: 56, food: 29, tech: 71,
      travel: 51, gaming: 93, sports: 22, entertainment: 64, art: 37, finance: 80, music: 18
    };
    const offset = nicheOffset[niche] ?? 0;
    return days.map((_, dayIdx) =>
      hours.map((_, hourIdx) => {
        const base = seededRandom(dayIdx * 24 + hourIdx + offset);
        // Higher activity 8am-11pm, peaks at 12pm and 7pm
        let timeMultiplier = 0.15;
        if (hourIdx >= 8 && hourIdx <= 23) timeMultiplier = 0.4;
        if (hourIdx >= 11 && hourIdx <= 14) timeMultiplier = 0.75;
        if (hourIdx >= 18 && hourIdx <= 21) timeMultiplier = 0.9;
        // Weekends slightly higher
        if (dayIdx >= 5) timeMultiplier *= 1.15;
        return Math.min(1, base * timeMultiplier + (timeMultiplier > 0.5 ? 0.2 : 0));
      })
    );
  }

  const nicheHashtags: Record<string, TrendHashtag[]> = {
    beauty: [
      { tag: '#GlassSkin2026', count: '2.4M', velocity: 'hot', change: '+340%' },
      { tag: '#CleanGirlMakeup', count: '1.8M', velocity: 'rising', change: '+120%' },
      { tag: '#SkincareRoutine', count: '5.2M', velocity: 'stable', change: '+8%' },
      { tag: '#SoftGlam', count: '890K', velocity: 'rising', change: '+95%' },
      { tag: '#LipCombo', count: '1.1M', velocity: 'hot', change: '+210%' },
      { tag: '#SunscreenCheck', count: '720K', velocity: 'stable', change: '+12%' },
      { tag: '#DrugstoreDupes', count: '3.1M', velocity: 'declining', change: '-15%' },
      { tag: '#MorningRoutine', count: '4.6M', velocity: 'stable', change: '+5%' }
    ],
    fashion: [
      { tag: '#QuietLuxury', count: '3.1M', velocity: 'hot', change: '+280%' },
      { tag: '#CapsuleWardrobe', count: '1.5M', velocity: 'rising', change: '+145%' },
      { tag: '#StreetStyle', count: '8.9M', velocity: 'stable', change: '+6%' },
      { tag: '#OOTDinspo', count: '6.2M', velocity: 'stable', change: '+3%' },
      { tag: '#ThriftFlip', count: '2.8M', velocity: 'declining', change: '-22%' },
      { tag: '#ModestFashion', count: '1.9M', velocity: 'rising', change: '+88%' },
      { tag: '#MilanFW', count: '420K', velocity: 'hot', change: '+560%' },
      { tag: '#Y2KRevival', count: '4.1M', velocity: 'declining', change: '-18%' }
    ],
    lifestyle: [
      { tag: '#ThatGirlRoutine', count: '4.2M', velocity: 'stable', change: '+11%' },
      { tag: '#AestheticVlog', count: '2.1M', velocity: 'rising', change: '+130%' },
      { tag: '#SilentVlog', count: '1.7M', velocity: 'hot', change: '+310%' },
      { tag: '#DayInMyLife', count: '7.8M', velocity: 'stable', change: '+4%' },
      { tag: '#ProductivityHacks', count: '3.4M', velocity: 'rising', change: '+67%' },
      { tag: '#HomeOrganization', count: '1.2M', velocity: 'stable', change: '+9%' },
      { tag: '#MorningMotivation', count: '5.1M', velocity: 'declining', change: '-8%' },
      { tag: '#SlowLiving', count: '980K', velocity: 'hot', change: '+245%' }
    ],
    fitness: [
      { tag: '#HotGirlWalk', count: '3.8M', velocity: 'stable', change: '+7%' },
      { tag: '#GymTok', count: '6.1M', velocity: 'rising', change: '+89%' },
      { tag: '#75Hard', count: '2.9M', velocity: 'declining', change: '-25%' },
      { tag: '#PilatesPrincess', count: '1.4M', velocity: 'hot', change: '+380%' },
      { tag: '#ProteinRecipes', count: '2.2M', velocity: 'rising', change: '+110%' },
      { tag: '#RunningCommunity', count: '1.8M', velocity: 'stable', change: '+14%' },
      { tag: '#MobilityWork', count: '870K', velocity: 'hot', change: '+290%' },
      { tag: '#BodyRecomp', count: '1.1M', velocity: 'rising', change: '+76%' }
    ],
    food: [
      { tag: '#FoodTok', count: '9.2M', velocity: 'stable', change: '+5%' },
      { tag: '#ProteinIceCream', count: '1.6M', velocity: 'hot', change: '+420%' },
      { tag: '#MealPrep', count: '4.8M', velocity: 'stable', change: '+8%' },
      { tag: '#AirFryerRecipes', count: '3.4M', velocity: 'declining', change: '-12%' },
      { tag: '#WhatIEatInADay', count: '5.7M', velocity: 'stable', change: '+3%' },
      { tag: '#CottageCoreBaking', count: '890K', velocity: 'rising', change: '+145%' },
      { tag: '#DubaiChocolate', count: '2.1M', velocity: 'hot', change: '+350%' },
      { tag: '#15MinuteMeals', count: '1.3M', velocity: 'rising', change: '+98%' }
    ],
    tech: [
      { tag: '#BuildInPublic', count: '1.8M', velocity: 'rising', change: '+120%' },
      { tag: '#AITools', count: '4.2M', velocity: 'hot', change: '+390%' },
      { tag: '#CodingTips', count: '3.1M', velocity: 'stable', change: '+9%' },
      { tag: '#StartupLife', count: '2.4M', velocity: 'stable', change: '+6%' },
      { tag: '#TechLayoffs', count: '890K', velocity: 'declining', change: '-35%' },
      { tag: '#VibeCode', count: '1.5M', velocity: 'hot', change: '+520%' },
      { tag: '#SaaSMetrics', count: '420K', velocity: 'rising', change: '+88%' },
      { tag: '#DevSetup', count: '2.8M', velocity: 'stable', change: '+11%' }
    ],
    travel: [
      { tag: '#SoloTravel', count: '2.8M', velocity: 'hot', change: '+195%' },
      { tag: '#Wanderlust2026', count: '4.5M', velocity: 'hot', change: '+310%' },
      { tag: '#TravelDiaries', count: '5.9M', velocity: 'stable', change: '+4%' },
      { tag: '#BudgetTravel', count: '3.2M', velocity: 'rising', change: '+125%' },
      { tag: '#HiddenGems', count: '1.7M', velocity: 'hot', change: '+240%' },
      { tag: '#BucketList', count: '6.4M', velocity: 'stable', change: '+8%' },
      { tag: '#CabinCore', count: '910K', velocity: 'rising', change: '+75%' },
      { tag: '#JapanTravel', count: '2.2M', velocity: 'hot', change: '+160%' }
    ],
    gaming: [
      { tag: '#CozyGaming', count: '1.9M', velocity: 'hot', change: '+290%' },
      { tag: '#IndieGames', count: '2.4M', velocity: 'rising', change: '+115%' },
      { tag: '#GamingSetup', count: '3.8M', velocity: 'stable', change: '+12%' },
      { tag: '#NintendoSwitch', count: '7.2M', velocity: 'stable', change: '+3%' },
      { tag: '#SteamDeck', count: '1.5M', velocity: 'rising', change: '+85%' },
      { tag: '#Speedrun', count: '850K', velocity: 'declining', change: '-10%' },
      { tag: '#ZeldaTears', count: '4.6M', velocity: 'stable', change: '+5%' },
      { tag: '#GamerGirl', count: '3.1M', velocity: 'hot', change: '+180%' }
    ],
    sports: [
      { tag: '#Pickleball', count: '2.1M', velocity: 'hot', change: '+320%' },
      { tag: '#ChampionsLeague', count: '8.4M', velocity: 'hot', change: '+480%' },
      { tag: '#RunnersLife', count: '3.7M', velocity: 'stable', change: '+7%' },
      { tag: '#HomeGym', count: '4.2M', velocity: 'stable', change: '+6%' },
      { tag: '#HikingAdventures', count: '1.9M', velocity: 'rising', change: '+90%' },
      { tag: '#AthleticDrills', count: '950K', velocity: 'rising', change: '+110%' },
      { tag: '#F1Testing', count: '1.5M', velocity: 'hot', change: '+220%' },
      { tag: '#StreetBall', count: '1.2M', velocity: 'declining', change: '-12%' }
    ],
    entertainment: [
      { tag: '#Cinephile', count: '1.5M', velocity: 'stable', change: '+14%' },
      { tag: '#MovieReview', count: '3.8M', velocity: 'rising', change: '+85%' },
      { tag: '#AnimeRecommend', count: '4.9M', velocity: 'hot', change: '+210%' },
      { tag: '#OscarPredictions', count: '980K', velocity: 'hot', change: '+340%' },
      { tag: '#BehindTheScenes', count: '5.2M', velocity: 'stable', change: '+9%' },
      { tag: '#KDramaList', count: '2.7M', velocity: 'rising', change: '+130%' },
      { tag: '#PopCulture', count: '6.8M', velocity: 'stable', change: '+4%' },
      { tag: '#BingeWatch', count: '3.1M', velocity: 'declining', change: '-15%' }
    ],
    art: [
      { tag: '#DigitalArt', count: '7.8M', velocity: 'stable', change: '+8%' },
      { tag: '#ProcreateTips', count: '2.1M', velocity: 'rising', change: '+140%' },
      { tag: '#AestheticDesign', count: '3.4M', velocity: 'rising', change: '+95%' },
      { tag: '#3DModeling', count: '1.2M', velocity: 'hot', change: '+210%' },
      { tag: '#CeramicsStudio', count: '850K', velocity: 'hot', change: '+185%' },
      { tag: '#SketchbookPage', count: '2.9M', velocity: 'stable', change: '+5%' },
      { tag: '#HandmadeWithLove', count: '4.1M', velocity: 'declining', change: '-8%' },
      { tag: '#Blender3D', count: '1.8M', velocity: 'rising', change: '+110%' }
    ],
    finance: [
      { tag: '#FinTok', count: '5.4M', velocity: 'stable', change: '+12%' },
      { tag: '#SideHustle', count: '4.1M', velocity: 'hot', change: '+290%' },
      { tag: '#PersonalFinance', count: '3.9M', velocity: 'stable', change: '+8%' },
      { tag: '#StartupTips', count: '2.2M', velocity: 'rising', change: '+115%' },
      { tag: '#PassiveIncome', count: '2.8M', velocity: 'declining', change: '-18%' },
      { tag: '#StockMarket', count: '4.9M', velocity: 'stable', change: '+4%' },
      { tag: '#CryptoNews', count: '3.1M', velocity: 'hot', change: '+190%' },
      { tag: '#CareerGrowth', count: '1.7M', velocity: 'rising', change: '+85%' }
    ],
    music: [
      { tag: '#NewMusicFriday', count: '6.2M', velocity: 'hot', change: '+410%' },
      { tag: '#IndieArtist', count: '1.9M', velocity: 'rising', change: '+140%' },
      { tag: '#Songwriter', count: '2.4M', velocity: 'stable', change: '+9%' },
      { tag: '#Covers', count: '4.8M', velocity: 'stable', change: '+5%' },
      { tag: '#VinylCommunity', count: '1.1M', velocity: 'rising', change: '+75%' },
      { tag: '#MusicProducer', count: '2.2M', velocity: 'rising', change: '+98%' },
      { tag: '#ConcertVibes', count: '3.7M', velocity: 'hot', change: '+280%' },
      { tag: '#Synthesizer', count: '850K', velocity: 'declining', change: '-14%' }
    ]
  };

  const nicheSounds: Record<string, TrendSound[]> = {
    beauty: [
      { name: 'Get Ready With Me', artist: 'Doja Cat', uses: '1.2M', velocity: 'hot', platform: 'TikTok' },
      { name: 'Espresso (sped up)', artist: 'Sabrina Carpenter', uses: '890K', velocity: 'rising', platform: 'TikTok' },
      { name: 'Original Sound - SkincareSara', artist: 'SkincareSara', uses: '340K', velocity: 'hot', platform: 'Instagram' },
      { name: 'Glow Up Transition', artist: 'Trending Audio', uses: '560K', velocity: 'rising', platform: 'TikTok' }
    ],
    fashion: [
      { name: 'I Look Good (Remix)', artist: 'O.T. Genasis', uses: '2.1M', velocity: 'hot', platform: 'TikTok' },
      { name: 'Outfit Check ✨', artist: 'Trending Audio', uses: '780K', velocity: 'rising', platform: 'Instagram' },
      { name: 'Walk Walk Fashion Baby', artist: 'Lady Gaga', uses: '1.5M', velocity: 'stable', platform: 'TikTok' },
      { name: 'Original Sound - StyleBy.Al', artist: 'StyleBy.Al', uses: '420K', velocity: 'hot', platform: 'TikTok' }
    ],
    lifestyle: [
      { name: 'Silent Vlog Background', artist: 'Cozy Beats', uses: '3.2M', velocity: 'hot', platform: 'YouTube' },
      { name: 'That Girl Morning', artist: 'Trending Audio', uses: '1.8M', velocity: 'stable', platform: 'TikTok' },
      { name: 'Soft Life Aesthetic', artist: 'lo-fi chill', uses: '670K', velocity: 'rising', platform: 'Instagram' },
      { name: 'Day In My Life', artist: 'Trending Audio', uses: '2.4M', velocity: 'stable', platform: 'TikTok' }
    ],
    fitness: [
      { name: 'Push It (Gym Remix)', artist: 'Salt-N-Pepa', uses: '1.4M', velocity: 'hot', platform: 'TikTok' },
      { name: 'Training Montage', artist: 'Trending Audio', uses: '920K', velocity: 'rising', platform: 'TikTok' },
      { name: 'Run Girl Run', artist: 'Dua Lipa', uses: '780K', velocity: 'rising', platform: 'Instagram' },
      { name: 'PR Day Sound', artist: 'GymBro Beats', uses: '340K', velocity: 'hot', platform: 'TikTok' }
    ],
    food: [
      { name: 'Cooking ASMR', artist: 'Trending Audio', uses: '4.1M', velocity: 'stable', platform: 'TikTok' },
      { name: 'Taste Test Reaction', artist: 'Trending Audio', uses: '1.3M', velocity: 'hot', platform: 'TikTok' },
      { name: 'Kitchen Vibes', artist: 'lo-fi cooking', uses: '890K', velocity: 'rising', platform: 'YouTube' },
      { name: 'Original Sound - ChefTok', artist: 'ChefTok', uses: '560K', velocity: 'hot', platform: 'TikTok' }
    ],
    tech: [
      { name: 'Hack The Planet', artist: 'Synthwave Mix', uses: '420K', velocity: 'rising', platform: 'TikTok' },
      { name: 'Coding Lo-Fi', artist: 'Trending Audio', uses: '2.8M', velocity: 'stable', platform: 'YouTube' },
      { name: 'Ship It Sound', artist: 'Trending Audio', uses: '180K', velocity: 'hot', platform: 'TikTok' },
      { name: 'Debug Mode', artist: 'DevBeats', uses: '95K', velocity: 'rising', platform: 'TikTok' }
    ],
    travel: [
      { name: 'Adventure Awaits', artist: 'Trending Audio', uses: '1.5M', velocity: 'hot', platform: 'TikTok' },
      { name: 'Golden Hour (Lofi)', artist: 'JVKE', uses: '980K', velocity: 'rising', platform: 'Instagram' },
      { name: 'On The Road Again', artist: 'Chill Beats', uses: '620K', velocity: 'stable', platform: 'YouTube' },
      { name: 'Aloha Vibes', artist: 'Island Lo-Fi', uses: '450K', velocity: 'hot', platform: 'TikTok' }
    ],
    gaming: [
      { name: '8-Bit Nostalgia', artist: 'Chiptune Mix', uses: '2.4M', velocity: 'stable', platform: 'YouTube' },
      { name: 'Victory Royale Theme', artist: 'Gamer Audio', uses: '1.1M', velocity: 'hot', platform: 'TikTok' },
      { name: 'Chill Quest (RPG)', artist: 'RPG Ambient', uses: '530K', velocity: 'rising', platform: 'TikTok' },
      { name: 'Original Sound - StreamerGuy', artist: 'StreamerGuy', uses: '310K', velocity: 'hot', platform: 'Twitch' }
    ],
    sports: [
      { name: 'Stadium Roar', artist: 'Crowd Audio', uses: '3.1M', velocity: 'hot', platform: 'TikTok' },
      { name: 'Fast Lane (Phonk)', artist: 'Phonk Remix', uses: '1.8M', velocity: 'hot', platform: 'Instagram' },
      { name: 'Run Wild', artist: 'Upbeat Pop', uses: '890K', velocity: 'rising', platform: 'TikTok' },
      { name: 'Victory Lap', artist: 'Epic Orchestral', uses: '420K', velocity: 'stable', platform: 'YouTube' }
    ],
    entertainment: [
      { name: 'Dramatic Suspense', artist: 'Cinema Soundtracks', uses: '2.7M', velocity: 'stable', platform: 'TikTok' },
      { name: 'Retro Synth Theme', artist: '80s Nostalgia', uses: '1.5M', velocity: 'rising', platform: 'Instagram' },
      { name: 'Intro Theme', artist: 'Pop Mix', uses: '890K', velocity: 'hot', platform: 'YouTube' },
      { name: 'Original Sound - MovieCritic', artist: 'MovieCritic', uses: '340K', velocity: 'hot', platform: 'TikTok' }
    ],
    art: [
      { name: 'Lo-Fi Paint & Chill', artist: 'Lofi Beats', uses: '4.2M', velocity: 'stable', platform: 'YouTube' },
      { name: 'Drawing ASMR', artist: 'Studio Sounds', uses: '2.1M', velocity: 'hot', platform: 'TikTok' },
      { name: 'Satisfying Pour', artist: 'Creative Studio', uses: '980K', velocity: 'rising', platform: 'Instagram' },
      { name: 'Creative Process', artist: 'Ambient Chill', uses: '650K', velocity: 'hot', platform: 'TikTok' }
    ],
    finance: [
      { name: 'Success Frequency', artist: 'Chill Synth', uses: '1.2M', velocity: 'rising', platform: 'TikTok' },
      { name: 'Corporate Chill', artist: 'Lofi Business', uses: '780K', velocity: 'stable', platform: 'YouTube' },
      { name: 'Rise and Grind', artist: 'Upbeat Audio', uses: '540K', velocity: 'hot', platform: 'Instagram' },
      { name: 'Original Sound - MoneyMindset', artist: 'MoneyMindset', uses: '320K', velocity: 'hot', platform: 'TikTok' }
    ],
    music: [
      { name: 'Original Song - NewArtist', artist: 'NewArtist', uses: '1.8M', velocity: 'hot', platform: 'TikTok' },
      { name: 'Acoustic Guitar Cover', artist: 'Chill Guitar', uses: '950K', velocity: 'rising', platform: 'YouTube' },
      { name: 'Beat Drop 2026', artist: 'EDM Producer', uses: '720K', velocity: 'hot', platform: 'TikTok' },
      { name: 'Synth Pop Hook', artist: 'Retro Wave', uses: '390K', velocity: 'stable', platform: 'Instagram' }
    ]
  };

  const nichePlatforms: Record<string, PlatformTrend[]> = {
    beauty: [
      { platform: 'TikTok', icon: '🎵', color: 'var(--rose)', trends: ['Glass Skin', 'Lip Combos', 'GRWM'], trendCount: 12 },
      { platform: 'Instagram', icon: '📸', color: 'var(--gold)', trends: ['Reels Tutorials', 'Before/After', 'Flat Lays'], trendCount: 8 },
      { platform: 'YouTube', icon: '▶️', color: 'var(--error)', trends: ['Long-form Reviews', 'Routines', 'Hauls'], trendCount: 5 }
    ],
    fashion: [
      { platform: 'Instagram', icon: '📸', color: 'var(--gold)', trends: ['OOTD Carousels', 'Quiet Luxury', 'Style Guides'], trendCount: 15 },
      { platform: 'TikTok', icon: '🎵', color: 'var(--rose)', trends: ['Outfit Checks', 'Thrift Flips', 'Hauls'], trendCount: 11 },
      { platform: 'Pinterest', icon: '📌', color: 'var(--error)', trends: ['Mood Boards', 'Capsule Wardrobe', 'Color Theory'], trendCount: 7 }
    ],
    lifestyle: [
      { platform: 'TikTok', icon: '🎵', color: 'var(--rose)', trends: ['Day In My Life', 'POV Skits', 'Silent Vlogs'], trendCount: 14 },
      { platform: 'YouTube', icon: '▶️', color: 'var(--error)', trends: ['Aesthetic Vlogs', 'Room Tours', 'Routines'], trendCount: 9 },
      { platform: 'Instagram', icon: '📸', color: 'var(--gold)', trends: ['Aesthetic Grids', 'Reels', 'Stories'], trendCount: 6 }
    ],
    fitness: [
      { platform: 'TikTok', icon: '🎵', color: 'var(--rose)', trends: ['GymTok', 'Form Checks', 'PR Videos'], trendCount: 13 },
      { platform: 'Instagram', icon: '📸', color: 'var(--gold)', trends: ['Workout Carousels', 'Transformation', 'Reels'], trendCount: 10 },
      { platform: 'YouTube', icon: '▶️', color: 'var(--error)', trends: ['Full Workouts', 'Meal Prep', 'Challenges'], trendCount: 8 }
    ],
    food: [
      { platform: 'TikTok', icon: '🎵', color: 'var(--rose)', trends: ['Recipe Shorts', 'Taste Tests', 'ASMR Cooking'], trendCount: 16 },
      { platform: 'YouTube', icon: '▶️', color: 'var(--error)', trends: ['Full Recipes', 'Mukbang', 'Challenges'], trendCount: 11 },
      { platform: 'Instagram', icon: '📸', color: 'var(--gold)', trends: ['Food Photography', 'Reels', 'Stories'], trendCount: 7 }
    ],
    tech: [
      { platform: 'Twitter/X', icon: '𝕏', color: 'var(--text)', trends: ['Hot Takes', 'Threads', 'Launches'], trendCount: 18 },
      { platform: 'LinkedIn', icon: '💼', color: 'var(--info)', trends: ['Thought Leadership', 'Case Studies', 'Polls'], trendCount: 9 },
      { platform: 'YouTube', icon: '▶️', color: 'var(--error)', trends: ['Tutorials', 'Reviews', 'Dev Vlogs'], trendCount: 6 }
    ],
    travel: [
      { platform: 'Instagram', icon: '📸', color: 'var(--gold)', trends: ['Travel Reels', 'Hidden Gems', 'Carousels'], trendCount: 14 },
      { platform: 'TikTok', icon: '🎵', color: 'var(--rose)', trends: ['Travel Vlogs', 'Itinerary Hacks', 'Budget Guides'], trendCount: 11 },
      { platform: 'Pinterest', icon: '📌', color: 'var(--error)', trends: ['Wanderlust Moodboards', 'Packing Lists', 'Destinations'], trendCount: 9 }
    ],
    gaming: [
      { platform: 'YouTube', icon: '▶️', color: 'var(--error)', trends: ['LetsPlays', 'Walkthroughs', 'Reviews'], trendCount: 16 },
      { platform: 'TikTok', icon: '🎵', color: 'var(--rose)', trends: ['Funny Clips', 'Setup Tours', 'Speedruns'], trendCount: 13 },
      { platform: 'Twitch', icon: '🎮', color: 'var(--info)', trends: ['Live Streams', 'Esports', 'Just Chatting'], trendCount: 10 }
    ],
    sports: [
      { platform: 'Twitter/X', icon: '𝕏', color: 'var(--text)', trends: ['Live Commentary', 'Hot Takes', 'Fandom Debates'], trendCount: 17 },
      { platform: 'TikTok', icon: '🎵', color: 'var(--rose)', trends: ['Trickshots', 'Behind The Scenes', 'Drills'], trendCount: 12 },
      { platform: 'YouTube', icon: '▶️', color: 'var(--error)', trends: ['Game Highlights', 'Vlogs', 'Tutorials'], trendCount: 8 }
    ],
    entertainment: [
      { platform: 'TikTok', icon: '🎵', color: 'var(--rose)', trends: ['Fandom Edits', 'Movie Recaps', 'Theory Skits'], trendCount: 15 },
      { platform: 'YouTube', icon: '▶️', color: 'var(--error)', trends: ['Video Essays', 'Trailers', 'Reviews'], trendCount: 11 },
      { platform: 'Twitter/X', icon: '𝕏', color: 'var(--text)', trends: ['Live-tweeting', 'Meme Threads', 'Casting News'], trendCount: 8 }
    ],
    art: [
      { platform: 'Pinterest', icon: '📌', color: 'var(--error)', trends: ['Inspiration', 'Color Palettes', 'Moodboards'], trendCount: 18 },
      { platform: 'Instagram', icon: '📸', color: 'var(--gold)', trends: ['Process Reels', 'Carousels', 'Studio Views'], trendCount: 14 },
      { platform: 'TikTok', icon: '🎵', color: 'var(--rose)', trends: ['Speedpaints', 'ASMR Studio Vlogs', 'Tips'], trendCount: 11 }
    ],
    finance: [
      { platform: 'LinkedIn', icon: '💼', color: 'var(--info)', trends: ['Career Advice', 'Market News', 'Thought Leadership'], trendCount: 15 },
      { platform: 'Twitter/X', icon: '𝕏', color: 'var(--text)', trends: ['Market Charts', 'Crypto Space', 'FinThreads'], trendCount: 12 },
      { platform: 'YouTube', icon: '▶️', color: 'var(--error)', trends: ['Tutorials', 'Stock Analysis', 'Side Hustles'], trendCount: 9 }
    ],
    music: [
      { platform: 'TikTok', icon: '🎵', color: 'var(--rose)', trends: ['Sound Trends', 'LipSync Challenges', 'Duets'], trendCount: 19 },
      { platform: 'YouTube', icon: '▶️', color: 'var(--error)', trends: ['Music Videos', 'Behind The Scenes', 'Live Sessions'], trendCount: 10 },
      { platform: 'Instagram', icon: '📸', color: 'var(--gold)', trends: ['Reels Covers', 'Concert Snippets', 'Promos'], trendCount: 7 }
    ]
  };

  let heatmapData = $derived(generateHeatmapData(selectedNiche));
  let hashtags = $derived(nicheHashtags[selectedNiche] ?? []);
  let sounds = $derived(nicheSounds[selectedNiche] ?? []);
  let platforms = $derived(nichePlatforms[selectedNiche] ?? []);

  function heatColor(value: number): string {
    if (value < 0.15) return 'var(--surface-3)';
    if (value < 0.3) return 'rgba(124, 106, 237, 0.15)';
    if (value < 0.5) return 'rgba(124, 106, 237, 0.3)';
    if (value < 0.7) return 'rgba(124, 106, 237, 0.5)';
    if (value < 0.85) return 'rgba(124, 106, 237, 0.7)';
    return 'rgba(124, 106, 237, 0.9)';
  }

  function velocityIcon(v: VelocityType): string {
    const icons: Record<VelocityType, string> = { hot: '🔥', rising: '📈', stable: '➡️', declining: '📉' };
    return icons[v];
  }

  function velocityColor(v: VelocityType): string {
    const colors: Record<VelocityType, string> = {
      hot: 'var(--error)',
      rising: 'var(--success)',
      stable: 'var(--text-muted)',
      declining: 'var(--warning)'
    };
    return colors[v];
  }

  function refresh() {
    refreshing = true;
    setTimeout(() => {
      refreshing = false;
      showToast('Trend data refreshed', 'success');
    }, 1200);
  }
</script>

<svelte:head>
  <title>Trends — PersonaGen</title>
</svelte:head>

<section class="page">
  <header class="page-header">
    <div class="header-row">
      <div>
        <h1>Trend <span class="grad">Analysis</span></h1>
        <p class="subtitle">Real-time trending content, hashtags, and platform insights for your niche.</p>
      </div>
      <button class="refresh-btn" onclick={refresh} disabled={refreshing}>
        <svg class:spinning={refreshing} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  </header>

  <!-- Niche Selector -->
  <div class="niche-bar">
    {#each niches as niche (niche.id)}
      <button
        class="niche-btn"
        class:active={selectedNiche === niche.id}
        onclick={() => selectedNiche = niche.id}
      >
        <span class="niche-icon">{niche.icon}</span>
        {niche.label}
      </button>
    {/each}
  </div>

  <!-- Heatmap -->
  <div class="card">
    <div class="card-title-row">
      <h3>Activity Heatmap</h3>
      <span class="card-label">7-day × 24-hour engagement density</span>
    </div>
    <div class="heatmap-wrap">
      <div class="heatmap">
        <div class="heatmap-ylabels">
          <div class="heatmap-corner"></div>
          {#each days as day (day)}
            <span class="y-label">{day}</span>
          {/each}
        </div>
        <div class="heatmap-grid-area">
          <div class="heatmap-xlabels">
            {#each hours as h (h)}
              <span class="x-label">{h % 3 === 0 ? `${h}` : ''}</span>
            {/each}
          </div>
          {#each heatmapData as row, dayIdx (dayIdx)}
            <div class="heatmap-row">
              {#each row as val, hourIdx (hourIdx)}
                <div
                  class="heat-cell"
                  style="background: {heatColor(val)}"
                  title="{days[dayIdx]} {hourIdx}:00 — {Math.round(val * 100)}% activity"
                ></div>
              {/each}
            </div>
          {/each}
        </div>
      </div>
      <div class="heatmap-legend">
        <span class="legend-label">Low</span>
        <div class="legend-bar">
          <div class="legend-cell" style="background: var(--surface-3)"></div>
          <div class="legend-cell" style="background: rgba(124, 106, 237, 0.15)"></div>
          <div class="legend-cell" style="background: rgba(124, 106, 237, 0.3)"></div>
          <div class="legend-cell" style="background: rgba(124, 106, 237, 0.5)"></div>
          <div class="legend-cell" style="background: rgba(124, 106, 237, 0.7)"></div>
          <div class="legend-cell" style="background: rgba(124, 106, 237, 0.9)"></div>
        </div>
        <span class="legend-label">High</span>
      </div>
    </div>
  </div>

  <div class="two-col">
    <!-- Trending Hashtags -->
    <div class="card">
      <div class="card-title-row">
        <h3>Trending Hashtags</h3>
      </div>
      <div class="hashtag-list">
        {#each hashtags as ht, i (ht.tag)}
          <div class="hashtag-row">
            <span class="ht-rank">#{i + 1}</span>
            <div class="ht-info">
              <span class="ht-tag">{ht.tag}</span>
              <span class="ht-count">{ht.count} posts</span>
            </div>
            <div class="ht-velocity">
              <span class="velocity-icon">{velocityIcon(ht.velocity)}</span>
              <span class="velocity-change" style="color: {velocityColor(ht.velocity)}">{ht.change}</span>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Trending Sounds -->
    <div class="card">
      <div class="card-title-row">
        <h3>Trending Sounds</h3>
      </div>
      <div class="sound-list">
        {#each sounds as sound (sound.name)}
          <div class="sound-row">
            <div class="sound-icon-wrap">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            </div>
            <div class="sound-info">
              <span class="sound-name">{sound.name}</span>
              <span class="sound-artist">{sound.artist}</span>
            </div>
            <div class="sound-meta">
              <span class="sound-uses">{sound.uses} uses</span>
              <div class="sound-tags">
                <span class="sound-platform">{sound.platform}</span>
                <span class="velocity-badge" style="color: {velocityColor(sound.velocity)}">{velocityIcon(sound.velocity)}</span>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- Platform Breakdown -->
  <div class="card">
    <div class="card-title-row">
      <h3>Platform Breakdown</h3>
      <span class="card-label">Where trends are concentrated</span>
    </div>
    <div class="platform-grid">
      {#each platforms as plat (plat.platform)}
        <div class="platform-card">
          <div class="plat-header">
            <span class="plat-icon">{plat.icon}</span>
            <span class="plat-name">{plat.platform}</span>
            <span class="plat-count" style="color: {plat.color}">{plat.trendCount} trends</span>
          </div>
          <div class="plat-bar-track">
            <div class="plat-bar-fill" style="width: {Math.min(100, plat.trendCount * 5.5)}%; background: {plat.color}"></div>
          </div>
          <div class="plat-trends">
            {#each plat.trends as trend (trend)}
              <span class="plat-trend-tag">{trend}</span>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  .page {
    padding: 2rem;
    max-width: 1400px;
    margin: 0 auto;
  }

  .page-header {
    margin-bottom: 1.5rem;
  }

  .header-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .page-header h1 {
    font-size: var(--text-3xl);
    font-family: var(--font-display);
    margin-bottom: 0.5rem;
  }

  .grad {
    background: var(--gradient);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtitle {
    color: var(--text-muted);
    font-size: var(--text-base);
  }

  .refresh-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1.25rem;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition: color 0.2s ease, border-color 0.2s ease;
    font-family: var(--font-body);
    flex-shrink: 0;
  }

  .refresh-btn:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--accent-mid);
  }

  .refresh-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .spinning {
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Niche Selector ── */
  .niche-bar {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    overflow-x: auto;
    scrollbar-width: none;
    padding-bottom: 0.25rem;
  }

  .niche-bar::-webkit-scrollbar {
    display: none;
  }

  .niche-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.6rem 1.25rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.2s ease;
    font-family: var(--font-body);
  }

  .niche-btn:hover {
    border-color: var(--border-hover);
    color: var(--text);
  }

  .niche-btn.active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }

  .niche-icon {
    font-size: 1rem;
  }

  /* ── Card ── */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    margin-bottom: 1.25rem;
  }

  .card-title-row {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }

  .card-title-row h3 {
    font-family: var(--font-display);
    font-size: var(--text-lg);
  }

  .card-label {
    font-size: var(--text-xs);
    color: var(--text-dim);
  }

  /* ── Heatmap ── */
  .heatmap-wrap {
    overflow-x: auto;
  }

  .heatmap {
    display: flex;
    gap: 0;
    min-width: 700px;
  }

  .heatmap-ylabels {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-right: 0.5rem;
    flex-shrink: 0;
  }

  .heatmap-corner {
    height: 18px;
  }

  .y-label {
    height: 22px;
    display: flex;
    align-items: center;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text-dim);
  }

  .heatmap-grid-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .heatmap-xlabels {
    display: flex;
    gap: 3px;
    height: 18px;
  }

  .x-label {
    flex: 1;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-dim);
    text-align: center;
  }

  .heatmap-row {
    display: flex;
    gap: 3px;
  }

  .heat-cell {
    flex: 1;
    height: 22px;
    border-radius: 3px;
    transition: background 0.3s ease, transform 0.15s ease;
    cursor: crosshair;
  }

  .heat-cell:hover {
    transform: scale(1.3);
    z-index: 2;
    position: relative;
    box-shadow: 0 0 8px rgba(124, 106, 237, 0.4);
  }

  .heatmap-legend {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1rem;
    justify-content: flex-end;
  }

  .legend-label {
    font-size: 10px;
    color: var(--text-dim);
    font-family: var(--font-mono);
  }

  .legend-bar {
    display: flex;
    gap: 2px;
  }

  .legend-cell {
    width: 20px;
    height: 12px;
    border-radius: 2px;
  }

  /* ── Two Column ── */
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
  }

  /* ── Hashtags ── */
  .hashtag-list {
    display: flex;
    flex-direction: column;
  }

  .hashtag-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--border);
  }

  .hashtag-row:last-child {
    border-bottom: none;
  }

  .ht-rank {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-dim);
    width: 24px;
    text-align: right;
    flex-shrink: 0;
  }

  .ht-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .ht-tag {
    font-weight: 600;
    font-size: var(--text-sm);
    color: var(--accent);
  }

  .ht-count {
    font-size: 10px;
    color: var(--text-dim);
  }

  .ht-velocity {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  .velocity-icon {
    font-size: 0.85rem;
  }

  .velocity-change {
    font-size: var(--text-xs);
    font-weight: 700;
    font-family: var(--font-mono);
  }

  /* ── Sounds ── */
  .sound-list {
    display: flex;
    flex-direction: column;
  }

  .sound-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--border);
  }

  .sound-row:last-child {
    border-bottom: none;
  }

  .sound-icon-wrap {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-soft);
    border-radius: 10px;
    flex-shrink: 0;
  }

  .sound-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .sound-name {
    font-weight: 600;
    font-size: var(--text-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sound-artist {
    font-size: 10px;
    color: var(--text-dim);
  }

  .sound-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.2rem;
    flex-shrink: 0;
  }

  .sound-uses {
    font-size: 10px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .sound-tags {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .sound-platform {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    background: var(--surface-3);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .velocity-badge {
    font-size: 0.75rem;
  }

  /* ── Platform Breakdown ── */
  .platform-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }

  .platform-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 1.25rem;
    transition: border-color 0.2s ease;
  }

  .platform-card:hover {
    border-color: var(--border-hover);
  }

  .plat-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .plat-icon {
    font-size: 1.25rem;
  }

  .plat-name {
    font-weight: 600;
    font-size: var(--text-base);
    flex: 1;
  }

  .plat-count {
    font-size: var(--text-xs);
    font-weight: 700;
    font-family: var(--font-mono);
  }

  .plat-bar-track {
    height: 6px;
    background: var(--surface-3);
    border-radius: 3px;
    margin-bottom: 0.75rem;
    overflow: hidden;
  }

  .plat-bar-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.5s ease;
  }

  .plat-trends {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .plat-trend-tag {
    font-size: 10px;
    color: var(--text-muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
    padding: 2px 8px;
    border-radius: var(--radius-full);
    white-space: nowrap;
  }

  @media (max-width: 900px) {
    .two-col {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 768px) {
    .page {
      padding: 1rem;
    }

    .header-row {
      flex-direction: column;
    }

    .niche-bar {
      gap: 0.35rem;
    }

    .niche-btn {
      padding: 0.5rem 1rem;
      font-size: var(--text-xs);
    }

    .platform-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
