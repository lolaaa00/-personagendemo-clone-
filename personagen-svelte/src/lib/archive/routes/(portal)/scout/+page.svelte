<script lang="ts">
	import type { Agent } from '$lib/types';
	import { Generate, Trends } from '$lib/services/api';
	import { showToast } from '$lib/stores/ui.svelte';

	interface PageData {
		agents: Agent[];
	}

	let { data } = $props<{ data: PageData }>();

	let selectedAgentId = $state('');
	let refreshing = $state(false);
	let generatingTrendId = $state('');
	let loadingTrends = $state(false);

	// ── Sample trend data ──
	interface Trend {
		id: string;
		name: string;
		momentum: 'rising' | 'stable' | 'falling';
		platform: string;
		niche: string;
		matchScore: number;
		hashtags: string[];
		description: string;
		volume: string;
		growth: string;
	}

	const SAMPLE_TRENDS: Trend[] = [
		{
			id: 't1',
			name: 'Glass Skin Routine',
			momentum: 'rising',
			platform: 'TikTok',
			niche: 'Beauty',
			matchScore: 92,
			hashtags: ['#glassskin', '#skincare', '#kbeauty', '#glowup'],
			description: 'Minimalist skincare routines achieving translucent, dewy finish',
			volume: '24.2K',
			growth: '+340%'
		},
		{
			id: 't2',
			name: 'AI Fashion Lookbooks',
			momentum: 'rising',
			platform: 'Instagram',
			niche: 'Fashion',
			matchScore: 88,
			hashtags: ['#aifashion', '#lookbook', '#ootd', '#styleai'],
			description: 'AI-generated outfit combinations and virtual try-on content',
			volume: '18.5K',
			growth: '+210%'
		},
		{
			id: 't3',
			name: 'Protein Coffee (Proffee)',
			momentum: 'rising',
			platform: 'TikTok',
			niche: 'Fitness',
			matchScore: 85,
			hashtags: ['#proffee', '#proteincoffee', '#fitfuel', '#gymlife'],
			description: 'High-protein iced coffee recipes replacing pre-workouts',
			volume: '40.5K',
			growth: '+525%'
		},
		{
			id: 't4',
			name: 'Quiet Luxury',
			momentum: 'stable',
			platform: 'Instagram',
			niche: 'Fashion',
			matchScore: 78,
			hashtags: ['#quietluxury', '#oldmoney', '#stealth wealth', '#minimal'],
			description: 'Understated designer pieces, no logos, premium fabrics',
			volume: '12.1K',
			growth: '+15%'
		},
		{
			id: 't5',
			name: 'Cortisol-Conscious Fitness',
			momentum: 'rising',
			platform: 'YouTube',
			niche: 'Fitness',
			matchScore: 90,
			hashtags: ['#cortisol', '#stressrelief', '#lowimpact', '#hormonehealth'],
			description: 'Low-impact workouts optimized for hormonal balance',
			volume: '33.1K',
			growth: '+122%'
		},
		{
			id: 't6',
			name: 'De-influencing',
			momentum: 'falling',
			platform: 'TikTok',
			niche: 'Lifestyle',
			matchScore: 62,
			hashtags: ['#deinfluencing', '#dontbuy', '#honest review'],
			description: 'Counter-trend calling out overhyped products',
			volume: '590',
			growth: '-12%'
		},
		{
			id: 't7',
			name: 'Mob Wife Aesthetic',
			momentum: 'stable',
			platform: 'Instagram',
			niche: 'Fashion',
			matchScore: 71,
			hashtags: ['#mobwife', '#aesthetic', '#faux fur', '#maximalism'],
			description: 'Bold furs, gold jewelry, dramatic makeup — anti-minimalism',
			volume: '3.1M',
			growth: '+8%'
		},
		{
			id: 't8',
			name: 'Walking Pad Workouts',
			momentum: 'rising',
			platform: 'TikTok',
			niche: 'Fitness',
			matchScore: 94,
			hashtags: ['#walkingpad', '#deskworkout', '#10ksteps', '#wfh'],
			description: 'Under-desk treadmill content for remote workers',
			volume: '92.4K',
			growth: '+688%'
		},
		{
			id: 't9',
			name: 'Sunset Blush Placement',
			momentum: 'rising',
			platform: 'Instagram',
			niche: 'Beauty',
			matchScore: 83,
			hashtags: ['#sunsetblush', '#blushtrend', '#makeuptutorial'],
			description: 'Draping blush upward toward temples for a sun-kissed glow',
			volume: '14.8K',
			growth: '+224%'
		},
		{
			id: 't10',
			name: 'Digital Detox Content',
			momentum: 'stable',
			platform: 'YouTube',
			niche: 'Lifestyle',
			matchScore: 67,
			hashtags: ['#digitaldetox', '#touchgrass', '#mindfulness', '#offline'],
			description: 'Vlogs and guides about reducing screen time intentionally',
			volume: '8.2K',
			growth: '+5%'
		}
	];

	let trends = $state<Trend[]>([]);
	let searchTrend = $state('');
	let timeRange = $state('2 Years');
	const TIME_RANGES = ['3 Months', '6 Months', '1 Year', '2 Years', '5 Years'];

	let selectedAgent = $derived(data.agents.find((a: Agent) => a.id === selectedAgentId));

	// Default to first agent on mount
	$effect(() => {
		if (data.agents && data.agents.length > 0 && !selectedAgentId) {
			selectedAgentId = data.agents[0].id;
		}
	});

	// Keep trends synchronized with initial server data on load or agent switch
	$effect(() => {
		if (selectedAgentId) {
			fetchTrendsForAgent(selectedAgentId);
		}
	});

	async function fetchTrendsForAgent(agentId: string) {
		loadingTrends = true;
		try {
			const res = await fetch('/api/engine?path=personagen-trends', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'load', agentId })
			});
			if (res.ok) {
				const result = await res.json();
				if (result.success && result.data?.trends) {
					trends = result.data.trends;
					loadingTrends = false;
					return;
				}
			}
		} catch (err) {
			console.error('Failed to load trends for agent:', err);
		} finally {
			loadingTrends = false;
		}
		// Fallback
		trends = [...SAMPLE_TRENDS];
	}

	let filteredTrends = $derived.by(() => {
		let result = trends;
		if (selectedAgentId && selectedAgent) {
			const agentNiche = selectedAgent.niche.toLowerCase();
			result = trends.filter((t) => {
				const tNiche = t.niche.toLowerCase();
				return (
					tNiche.includes(agentNiche) ||
					agentNiche.includes(tNiche) ||
					agentNiche.includes('lifestyle') ||
					agentNiche.includes('beauty') ||
					tNiche === 'lifestyle'
				);
			});
		}
		if (searchTrend.trim()) {
			const query = searchTrend.toLowerCase();
			result = result.filter(
				(t) =>
					t.name.toLowerCase().includes(query) ||
					t.description.toLowerCase().includes(query) ||
					t.hashtags.some((tag) => tag.toLowerCase().includes(query))
			);
		}
		return result;
	});

	let allHashtags = $derived.by(() => {
		const tags: Record<string, number> = {};
		filteredTrends.forEach((t) => {
			t.hashtags.forEach((h) => {
				tags[h] = (tags[h] || 0) + 1;
			});
		});
		return Object.entries(tags)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 20);
	});

	async function refreshTrends() {
		if (!selectedAgentId) return;
		refreshing = true;
		try {
			const res = await fetch('/api/engine?path=personagen-trends', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'refresh', agentId: selectedAgentId })
			});
			if (res.ok) {
				const result = await res.json();
				if (result.success && result.data?.trends) {
					trends = result.data.trends;
					showToast('Trends refreshed from API', 'success');
				} else {
					showToast('Trends recalculated locally', 'info');
				}
			} else {
				showToast('Trends recalculated locally', 'info');
			}
		} catch {
			showToast('Trends recalculated locally', 'info');
		} finally {
			refreshing = false;
		}
	}

	async function generateContent(trend: Trend) {
		if (!selectedAgentId) {
			showToast('Select an agent first', 'warning');
			return;
		}
		generatingTrendId = trend.id;
		try {
			const res = await Generate.trendPost(selectedAgentId, trend.name, [
				trend.platform.toLowerCase()
			]);
			if (res.success) {
				showToast(`Content generated for "${trend.name}"`, 'success');
			} else {
				showToast(res.error || 'Generation failed — API may not be connected', 'warning');
			}
		} catch {
			showToast('API unavailable — connect backend to generate content', 'warning');
		}
		generatingTrendId = '';
	}

	function getMomentumIcon(m: string): string {
		if (m === 'rising') return '↑';
		if (m === 'falling') return '↓';
		return '→';
	}

	function getMomentumColor(m: string): string {
		if (m === 'rising') return 'var(--success)';
		if (m === 'falling') return 'var(--error)';
		return 'var(--warning)';
	}

	function getGradientBorder(m: string): string {
		if (m === 'rising') return 'linear-gradient(135deg, var(--success), var(--cyan))';
		if (m === 'falling') return 'linear-gradient(135deg, var(--error), var(--rose))';
		return 'linear-gradient(135deg, var(--warning), var(--gold))';
	}

	function getPlatformColor(p: string): string {
		const map: Record<string, string> = {
			tiktok: '#fe2c55',
			instagram: '#e1306c',
			youtube: '#ff0000',
			x: '#1da1f2',
			facebook: '#1877f2',
			threads: '#999'
		};
		return map[p.toLowerCase()] || 'var(--accent)';
	}

	function getTrendChartPath(
		trendId: string,
		momentum: string
	): { linePath: string; fillPath: string } {
		const pointsCount = 15;
		const width = 300;
		const height = 100;
		const points: { x: number; y: number }[] = [];

		let seed = 0;
		for (let i = 0; i < trendId.length; i++) {
			seed += trendId.charCodeAt(i);
		}

		for (let i = 0; i < pointsCount; i++) {
			const x = (i / (pointsCount - 1)) * width;
			let y = 50;
			const rand = Math.sin(i * 1.5 + seed) * 7;

			if (momentum === 'rising') {
				const progress = i / (pointsCount - 1);
				const curve = Math.pow(progress, 4) * 60;
				y = 80 - curve + rand;
			} else if (momentum === 'falling') {
				const progress = i / (pointsCount - 1);
				const curve = Math.pow(progress, 3) * 60;
				y = 20 + curve + rand;
			} else {
				y = 55 + Math.sin(i * 2.5 + seed) * 12;
			}

			y = Math.max(12, Math.min(88, y));
			points.push({ x, y });
		}

		let linePath = `M ${points[0].x} ${points[0].y}`;
		for (let i = 1; i < points.length; i++) {
			linePath += ` L ${points[i].x} ${points[i].y}`;
		}

		const fillPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

		return { linePath, fillPath };
	}

	function getXAxisLabels(range: string): { start: string; end: string } {
		switch (range) {
			case '3 Months':
				return { start: 'Mar 2026', end: 'Jun 2026' };
			case '6 Months':
				return { start: 'Dec 2025', end: 'Jun 2026' };
			case '1 Year':
				return { start: 'Jun 2025', end: 'Jun 2026' };
			case '2 Years':
				return { start: '2025', end: '2026' };
			case '5 Years':
				return { start: '2021', end: '2026' };
			default:
				return { start: '2025', end: '2026' };
		}
	}

	// ── Unified Niche Insights Datasets (from Trends page) ──
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

	function seededRandom(seed: number): number {
		const x = Math.sin(seed * 9301 + 49297) * 233280;
		return x - Math.floor(x);
	}

	function generateHeatmapData(niche: string): number[][] {
		const nicheOffset: Record<string, number> = {
			beauty: 42,
			fashion: 87,
			lifestyle: 13,
			fitness: 56,
			food: 29,
			tech: 71,
			travel: 51,
			gaming: 93,
			sports: 22,
			entertainment: 64,
			art: 37,
			finance: 80,
			music: 18
		};
		const offset = nicheOffset[niche] ?? 0;
		return days.map((_, dayIdx) =>
			hours.map((_, hourIdx) => {
				const base = seededRandom(dayIdx * 24 + hourIdx + offset);
				let timeMultiplier = 0.15;
				if (hourIdx >= 8 && hourIdx <= 23) timeMultiplier = 0.4;
				if (hourIdx >= 11 && hourIdx <= 14) timeMultiplier = 0.75;
				if (hourIdx >= 18 && hourIdx <= 21) timeMultiplier = 0.9;
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
			{ tag: '#LipCombo', count: '1.1M', velocity: 'hot', change: '+210%' }
		],
		fashion: [
			{ tag: '#QuietLuxury', count: '3.1M', velocity: 'hot', change: '+280%' },
			{ tag: '#CapsuleWardrobe', count: '1.5M', velocity: 'rising', change: '+145%' },
			{ tag: '#StreetStyle', count: '8.9M', velocity: 'stable', change: '+6%' },
			{ tag: '#OOTDinspo', count: '6.2M', velocity: 'stable', change: '+3%' }
		],
		lifestyle: [
			{ tag: '#ThatGirlRoutine', count: '4.2M', velocity: 'stable', change: '+11%' },
			{ tag: '#AestheticVlog', count: '2.1M', velocity: 'rising', change: '+130%' },
			{ tag: '#SilentVlog', count: '1.7M', velocity: 'hot', change: '+310%' },
			{ tag: '#DayInMyLife', count: '7.8M', velocity: 'stable', change: '+4%' }
		],
		fitness: [
			{ tag: '#HotGirlWalk', count: '3.8M', velocity: 'stable', change: '+7%' },
			{ tag: '#GymTok', count: '6.1M', velocity: 'rising', change: '+89%' },
			{ tag: '#PilatesPrincess', count: '1.4M', velocity: 'hot', change: '+380%' },
			{ tag: '#ProteinRecipes', count: '2.2M', velocity: 'rising', change: '+110%' }
		],
		food: [
			{ tag: '#FoodTok', count: '9.2M', velocity: 'stable', change: '+5%' },
			{ tag: '#ProteinIceCream', count: '1.6M', velocity: 'hot', change: '+420%' },
			{ tag: '#MealPrep', count: '4.8M', velocity: 'stable', change: '+8%' },
			{ tag: '#DubaiChocolate', count: '2.1M', velocity: 'hot', change: '+350%' }
		],
		tech: [
			{ tag: '#BuildInPublic', count: '1.8M', velocity: 'rising', change: '+120%' },
			{ tag: '#AITools', count: '4.2M', velocity: 'hot', change: '+390%' },
			{ tag: '#CodingTips', count: '3.1M', velocity: 'stable', change: '+9%' },
			{ tag: '#VibeCode', count: '1.5M', velocity: 'hot', change: '+520%' }
		],
		travel: [
			{ tag: '#SoloTravel', count: '2.8M', velocity: 'hot', change: '+195%' },
			{ tag: '#Wanderlust2026', count: '4.5M', velocity: 'hot', change: '+310%' },
			{ tag: '#TravelDiaries', count: '5.9M', velocity: 'stable', change: '+4%' },
			{ tag: '#HiddenGems', count: '1.7M', velocity: 'hot', change: '+240%' }
		],
		gaming: [
			{ tag: '#CozyGaming', count: '1.9M', velocity: 'hot', change: '+290%' },
			{ tag: '#IndieGames', count: '2.4M', velocity: 'rising', change: '+115%' },
			{ tag: '#GamingSetup', count: '3.8M', velocity: 'stable', change: '+12%' },
			{ tag: '#SteamDeck', count: '1.5M', velocity: 'rising', change: '+85%' }
		],
		sports: [
			{ tag: '#Pickleball', count: '2.1M', velocity: 'hot', change: '+320%' },
			{ tag: '#ChampionsLeague', count: '8.4M', velocity: 'hot', change: '+480%' },
			{ tag: '#RunnersLife', count: '3.7M', velocity: 'stable', change: '+7%' },
			{ tag: '#HikingAdventures', count: '1.9M', velocity: 'rising', change: '+90%' }
		],
		entertainment: [
			{ tag: '#Cinephile', count: '1.5M', velocity: 'stable', change: '+14%' },
			{ tag: '#MovieReview', count: '3.8M', velocity: 'rising', change: '+85%' },
			{ tag: '#AnimeRecommend', count: '4.9M', velocity: 'hot', change: '+210%' },
			{ tag: '#OscarPredictions', count: '980K', velocity: 'hot', change: '+340%' }
		],
		art: [
			{ tag: '#DigitalArt', count: '7.8M', velocity: 'stable', change: '+8%' },
			{ tag: '#ProcreateTips', count: '2.1M', velocity: 'rising', change: '+140%' },
			{ tag: '#AestheticDesign', count: '3.4M', velocity: 'rising', change: '+95%' },
			{ tag: '#3DModeling', count: '1.2M', velocity: 'hot', change: '+210%' }
		],
		finance: [
			{ tag: '#FinTok', count: '5.4M', velocity: 'stable', change: '+12%' },
			{ tag: '#SideHustle', count: '4.1M', velocity: 'hot', change: '+290%' },
			{ tag: '#PersonalFinance', count: '3.9M', velocity: 'stable', change: '+8%' },
			{ tag: '#StartupTips', count: '2.2M', velocity: 'rising', change: '+115%' }
		],
		music: [
			{ tag: '#NewMusicFriday', count: '6.2M', velocity: 'hot', change: '+410%' },
			{ tag: '#IndieArtist', count: '1.9M', velocity: 'rising', change: '+140%' },
			{ tag: '#Songwriter', count: '2.4M', velocity: 'stable', change: '+9%' },
			{ tag: '#VinylCommunity', count: '1.1M', velocity: 'rising', change: '+75%' }
		]
	};

	const nicheSounds: Record<string, TrendSound[]> = {
		beauty: [
			{
				name: 'Get Ready With Me',
				artist: 'Doja Cat',
				uses: '1.2M',
				velocity: 'hot',
				platform: 'TikTok'
			},
			{
				name: 'Espresso (sped up)',
				artist: 'Sabrina Carpenter',
				uses: '890K',
				velocity: 'rising',
				platform: 'TikTok'
			},
			{
				name: 'Original Sound - SkincareSara',
				artist: 'SkincareSara',
				uses: '340K',
				velocity: 'hot',
				platform: 'Instagram'
			},
			{
				name: 'Glow Up Transition',
				artist: 'Trending Audio',
				uses: '560K',
				velocity: 'rising',
				platform: 'TikTok'
			}
		],
		fashion: [
			{
				name: 'I Look Good (Remix)',
				artist: 'O.T. Genasis',
				uses: '2.1M',
				velocity: 'hot',
				platform: 'TikTok'
			},
			{
				name: 'Outfit Check ✨',
				artist: 'Trending Audio',
				uses: '780K',
				velocity: 'rising',
				platform: 'Instagram'
			},
			{
				name: 'Walk Walk Fashion Baby',
				artist: 'Lady Gaga',
				uses: '1.5M',
				velocity: 'stable',
				platform: 'TikTok'
			}
		],
		lifestyle: [
			{
				name: 'Silent Vlog Background',
				artist: 'Cozy Beats',
				uses: '3.2M',
				velocity: 'hot',
				platform: 'YouTube'
			},
			{
				name: 'That Girl Morning',
				artist: 'Trending Audio',
				uses: '1.8M',
				velocity: 'stable',
				platform: 'TikTok'
			},
			{
				name: 'Soft Life Aesthetic',
				artist: 'lo-fi chill',
				uses: '670K',
				velocity: 'rising',
				platform: 'Instagram'
			}
		],
		fitness: [
			{
				name: 'Push It (Gym Remix)',
				artist: 'Salt-N-Pepa',
				uses: '1.4M',
				velocity: 'hot',
				platform: 'TikTok'
			},
			{
				name: 'Training Montage',
				artist: 'Trending Audio',
				uses: '920K',
				velocity: 'rising',
				platform: 'TikTok'
			},
			{
				name: 'Run Girl Run',
				artist: 'Dua Lipa',
				uses: '780K',
				velocity: 'rising',
				platform: 'Instagram'
			}
		],
		food: [
			{
				name: 'Cooking ASMR',
				artist: 'Trending Audio',
				uses: '4.1M',
				platform: 'TikTok',
				velocity: 'stable'
			},
			{
				name: 'Taste Test Reaction',
				artist: 'Trending Audio',
				uses: '1.3M',
				platform: 'TikTok',
				velocity: 'hot'
			},
			{
				name: 'Kitchen Vibes',
				artist: 'lo-fi cooking',
				uses: '890K',
				platform: 'YouTube',
				velocity: 'rising'
			}
		],
		tech: [
			{
				name: 'Hack The Planet',
				artist: 'Synthwave Mix',
				uses: '420K',
				platform: 'TikTok',
				velocity: 'rising'
			},
			{
				name: 'Coding Lo-Fi',
				artist: 'Trending Audio',
				uses: '2.8M',
				platform: 'YouTube',
				velocity: 'stable'
			},
			{
				name: 'Ship It Sound',
				artist: 'Trending Audio',
				uses: '180K',
				platform: 'TikTok',
				velocity: 'hot'
			}
		],
		travel: [
			{
				name: 'Adventure Awaits',
				artist: 'Trending Audio',
				uses: '1.5M',
				platform: 'TikTok',
				velocity: 'hot'
			},
			{
				name: 'Golden Hour (Lofi)',
				artist: 'JVKE',
				uses: '980K',
				platform: 'Instagram',
				velocity: 'rising'
			},
			{
				name: 'On The Road Again',
				artist: 'Chill Beats',
				uses: '620K',
				platform: 'YouTube',
				velocity: 'stable'
			}
		],
		gaming: [
			{
				name: '8-Bit Nostalgia',
				artist: 'Chiptune Mix',
				uses: '2.4M',
				platform: 'YouTube',
				velocity: 'stable'
			},
			{
				name: 'Victory Royale Theme',
				artist: 'Gamer Audio',
				uses: '1.1M',
				platform: 'TikTok',
				velocity: 'hot'
			},
			{
				name: 'Chill Quest (RPG)',
				artist: 'RPG Ambient',
				uses: '530K',
				platform: 'TikTok',
				velocity: 'rising'
			}
		],
		sports: [
			{
				name: 'Stadium Roar',
				artist: 'Crowd Audio',
				uses: '3.1M',
				platform: 'TikTok',
				velocity: 'hot'
			},
			{
				name: 'Fast Lane (Phonk)',
				artist: 'Phonk Remix',
				uses: '1.8M',
				platform: 'Instagram',
				velocity: 'hot'
			},
			{
				name: 'Run Wild',
				artist: 'Upbeat Pop',
				uses: '890K',
				platform: 'TikTok',
				velocity: 'rising'
			}
		],
		entertainment: [
			{
				name: 'Dramatic Suspense',
				artist: 'Cinema Soundtracks',
				uses: '2.7M',
				platform: 'TikTok',
				velocity: 'stable'
			},
			{
				name: 'Retro Synth Theme',
				artist: '80s Nostalgia',
				uses: '1.5M',
				platform: 'Instagram',
				velocity: 'rising'
			},
			{ name: 'Intro Theme', artist: 'Pop Mix', uses: '890K', platform: 'YouTube', velocity: 'hot' }
		],
		art: [
			{
				name: 'Lo-Fi Paint & Chill',
				artist: 'Lofi Beats',
				uses: '4.2M',
				platform: 'YouTube',
				velocity: 'stable'
			},
			{
				name: 'Drawing ASMR',
				artist: 'Studio Sounds',
				uses: '2.1M',
				platform: 'TikTok',
				velocity: 'hot'
			},
			{
				name: 'Satisfying Pour',
				artist: 'Creative Studio',
				uses: '980K',
				platform: 'Instagram',
				velocity: 'rising'
			}
		],
		finance: [
			{
				name: 'Success Frequency',
				artist: 'Chill Synth',
				uses: '1.2M',
				platform: 'TikTok',
				velocity: 'rising'
			},
			{
				name: 'Corporate Chill',
				artist: 'Lofi Business',
				uses: '780K',
				platform: 'YouTube',
				velocity: 'stable'
			},
			{
				name: 'Rise and Grind',
				artist: 'Upbeat Audio',
				uses: '540K',
				platform: 'Instagram',
				velocity: 'hot'
			}
		],
		music: [
			{
				name: 'Original Song - NewArtist',
				artist: 'NewArtist',
				uses: '1.8M',
				platform: 'TikTok',
				velocity: 'hot'
			},
			{
				name: 'Acoustic Guitar Cover',
				artist: 'Chill Guitar',
				uses: '950K',
				platform: 'YouTube',
				velocity: 'rising'
			},
			{
				name: 'Beat Drop 2026',
				artist: 'EDM Producer',
				uses: '720K',
				platform: 'TikTok',
				velocity: 'hot'
			}
		]
	};

	const nichePlatforms: Record<string, PlatformTrend[]> = {
		beauty: [
			{
				platform: 'TikTok',
				icon: '🎵',
				color: '#fe2c55',
				trends: ['Glass Skin', 'Lip Combos', 'GRWM'],
				trendCount: 12
			},
			{
				platform: 'Instagram',
				icon: '📸',
				color: '#e1306c',
				trends: ['Reels Tutorials', 'Before/After', 'Flat Lays'],
				trendCount: 8
			},
			{
				platform: 'YouTube',
				icon: '▶️',
				color: '#ff0000',
				trends: ['Long-form Reviews', 'Routines', 'Hauls'],
				trendCount: 5
			}
		],
		fashion: [
			{
				platform: 'Instagram',
				icon: '📸',
				color: '#e1306c',
				trends: ['OOTD Carousels', 'Quiet Luxury', 'Style Guides'],
				trendCount: 15
			},
			{
				platform: 'TikTok',
				icon: '🎵',
				color: '#fe2c55',
				trends: ['Outfit Checks', 'Thrift Flips', 'Hauls'],
				trendCount: 11
			}
		],
		lifestyle: [
			{
				platform: 'TikTok',
				icon: '🎵',
				color: '#fe2c55',
				trends: ['Day In My Life', 'POV Skits', 'Silent Vlogs'],
				trendCount: 14
			},
			{
				platform: 'YouTube',
				icon: '▶️',
				color: '#ff0000',
				trends: ['Aesthetic Vlogs', 'Room Tours', 'Routines'],
				trendCount: 9
			}
		],
		fitness: [
			{
				platform: 'TikTok',
				icon: '🎵',
				color: '#fe2c55',
				trends: ['GymTok', 'Form Checks', 'PR Videos'],
				trendCount: 13
			},
			{
				platform: 'Instagram',
				icon: '📸',
				color: '#e1306c',
				trends: ['Workout Carousels', 'Transformation', 'Reels'],
				trendCount: 10
			}
		],
		food: [
			{
				platform: 'TikTok',
				icon: '🎵',
				color: '#fe2c55',
				trends: ['Recipe Shorts', 'Taste Tests', 'ASMR Cooking'],
				trendCount: 16
			},
			{
				platform: 'YouTube',
				icon: '▶️',
				color: '#ff0000',
				trends: ['Full Recipes', 'Mukbang', 'Challenges'],
				trendCount: 11
			}
		],
		tech: [
			{
				platform: 'Twitter/X',
				icon: '𝕏',
				color: 'var(--text)',
				trends: ['Hot Takes', 'Threads', 'Launches'],
				trendCount: 18
			},
			{
				platform: 'LinkedIn',
				icon: '💼',
				color: '#0077b5',
				trends: ['Thought Leadership', 'Case Studies', 'Polls'],
				trendCount: 9
			}
		],
		travel: [
			{
				platform: 'Instagram',
				icon: '📸',
				color: '#e1306c',
				trends: ['Travel Reels', 'Hidden Gems', 'Carousels'],
				trendCount: 14
			},
			{
				platform: 'TikTok',
				icon: '🎵',
				color: '#fe2c55',
				trends: ['Travel Vlogs', 'Itinerary Hacks', 'Budget Guides'],
				trendCount: 11
			}
		],
		gaming: [
			{
				platform: 'YouTube',
				icon: '▶️',
				color: '#ff0000',
				trends: ['LetsPlays', 'Walkthroughs', 'Reviews'],
				trendCount: 16
			},
			{
				platform: 'TikTok',
				icon: '🎵',
				color: '#fe2c55',
				trends: ['Funny Clips', 'Setup Tours', 'Speedruns'],
				trendCount: 13
			}
		],
		sports: [
			{
				platform: 'Twitter/X',
				icon: '𝕏',
				color: 'var(--text)',
				trends: ['Live Commentary', 'Hot Takes', 'Fandom Debates'],
				trendCount: 17
			},
			{
				platform: 'TikTok',
				icon: '🎵',
				color: '#fe2c55',
				trends: ['Trickshots', 'Behind The Scenes', 'Drills'],
				trendCount: 12
			}
		],
		entertainment: [
			{
				platform: 'TikTok',
				icon: '🎵',
				color: '#fe2c55',
				trends: ['Fandom Edits', 'Movie Recaps', 'Theory Skits'],
				trendCount: 15
			},
			{
				platform: 'YouTube',
				icon: '▶️',
				color: '#ff0000',
				trends: ['Video Essays', 'Trailers', 'Reviews'],
				trendCount: 11
			}
		],
		art: [
			{
				platform: 'Pinterest',
				icon: '📌',
				color: '#bd081c',
				trends: ['Inspiration', 'Color Palettes', 'Moodboards'],
				trendCount: 18
			},
			{
				platform: 'Instagram',
				icon: '📸',
				color: '#e1306c',
				trends: ['Process Reels', 'Carousels', 'Studio Views'],
				trendCount: 14
			}
		],
		finance: [
			{
				platform: 'LinkedIn',
				icon: '💼',
				color: '#0077b5',
				trends: ['Career Advice', 'Market News', 'Thought Leadership'],
				trendCount: 15
			},
			{
				platform: 'Twitter/X',
				icon: '𝕏',
				color: 'var(--text)',
				trends: ['Market Charts', 'Crypto Space', 'FinThreads'],
				trendCount: 12
			}
		],
		music: [
			{
				platform: 'TikTok',
				icon: '🎵',
				color: '#fe2c55',
				trends: ['Sound Trends', 'LipSync Challenges', 'Duets'],
				trendCount: 19
			},
			{
				platform: 'YouTube',
				icon: '▶️',
				color: '#ff0000',
				trends: ['Music Videos', 'Behind The Scenes', 'Live Sessions'],
				trendCount: 10
			}
		]
	};

	let selectedNiche = $state('beauty');
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
		const icons: Record<VelocityType, string> = {
			hot: '🔥',
			rising: '📈',
			stable: '➡️',
			declining: '📉'
		};
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

	// Sync Agent Niche to static selector
	$effect(() => {
		if (selectedAgent) {
			const nicheKey = selectedAgent.niche.toLowerCase();
			const found = niches.find((n) => nicheKey.includes(n.id) || n.id.includes(nicheKey));
			if (found) {
				selectedNiche = found.id;
			}
		}
	});
</script>

<svelte:head>
	<title>Scout Intelligence — PersonaGen</title>
</svelte:head>

<section class="page">
	<!-- Exploding Topics style header -->
	<div class="exploding-header">
		<h1>Discover Exploding Topics</h1>

		<div class="exploding-filter-bar">
			<span class="filter-label">FILTER BY:</span>

			<div class="select-wrapper">
				<select class="exploding-select" bind:value={timeRange}>
					{#each TIME_RANGES as range}
						<option value={range}>{range}</option>
					{/each}
				</select>
			</div>

			<div class="select-wrapper">
				<select class="exploding-select" bind:value={selectedAgentId}>
					<option value="">All Categories</option>
					{#each data.agents as agent}
						<option value={agent.id}>{agent.name} — {agent.niche}</option>
					{/each}
				</select>
			</div>

			<div class="search-wrapper">
				<svg
					class="search-icon-svg"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="11" cy="11" r="8"></circle>
					<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
				</svg>
				<input
					type="text"
					class="exploding-search-input"
					placeholder="Search Trends"
					bind:value={searchTrend}
				/>
				<span class="pro-badge">PRO</span>
			</div>

			<button
				class="refresh-circle-btn"
				onclick={refreshTrends}
				disabled={refreshing}
				title="Refresh Trends"
			>
				<svg
					class="refresh-icon-svg"
					class:spinning={refreshing}
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<polyline points="23 4 23 10 17 10" />
					<polyline points="1 20 1 14 7 14" />
					<path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
				</svg>
			</button>
		</div>
	</div>

	<!-- Stats bar -->
	<div class="stats-bar">
		<div class="stat-item">
			<span class="stat-value">{filteredTrends.length}</span>
			<span class="stat-label">Trends Found</span>
		</div>
		<div class="stat-item">
			<span class="stat-value" style="color: var(--success)"
				>{filteredTrends.filter((t) => t.momentum === 'rising').length}</span
			>
			<span class="stat-label">Rising</span>
		</div>
		<div class="stat-item">
			<span class="stat-value" style="color: var(--warning)"
				>{filteredTrends.filter((t) => t.momentum === 'stable').length}</span
			>
			<span class="stat-label">Stable</span>
		</div>
		<div class="stat-item">
			<span class="stat-value" style="color: var(--error)"
				>{filteredTrends.filter((t) => t.momentum === 'falling').length}</span
			>
			<span class="stat-label">Falling</span>
		</div>
		<div class="stat-item">
			<span class="stat-value" style="color: var(--cyan)"
				>{Math.round(
					filteredTrends.reduce((a, t) => a + t.matchScore, 0) / (filteredTrends.length || 1)
				)}%</span
			>
			<span class="stat-label">Avg Match</span>
		</div>
	</div>

	<!-- Trend cards grid -->
	{#if loadingTrends}
		<div class="skeleton-trends-grid">
			{#each Array(6) as _}
				<div class="skeleton-card glass-card">
					<div class="skeleton-shimmer header-shimmer"></div>
					<div class="skeleton-shimmer chart-shimmer"></div>
					<div class="skeleton-shimmer footer-shimmer"></div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="trends-grid">
			{#each filteredTrends as trend (trend.id)}
				{@const chart = getTrendChartPath(trend.id, trend.momentum)}
				{@const labels = getXAxisLabels(timeRange)}
				<div class="trend-card">
					<div class="trend-card-body">
						<div class="trend-card-header-row">
							<h3 class="trend-card-title">{trend.name}</h3>

							<div class="trend-card-stats">
								<div class="stat-group">
									<span class="stat-num volume">{trend.volume}</span>
									<span class="stat-lbl">Volume</span>
								</div>
								<div class="stat-group">
									<span
										class="stat-num growth"
										style="color: {trend.momentum === 'rising'
											? 'var(--success)'
											: trend.momentum === 'falling'
												? 'var(--error)'
												: 'var(--warning)'}"
									>
										{trend.growth}
									</span>
									<span class="stat-lbl">Growth</span>
								</div>
							</div>
						</div>

						<!-- SVG Chart Block -->
						<div class="trend-chart-container">
							<svg class="trend-svg" viewBox="0 0 300 100" preserveAspectRatio="none">
								<defs>
									<linearGradient id="chartGrad-{trend.id}" x1="0%" y1="0%" x2="0%" y2="100%">
										<stop offset="0%" stop-color="var(--accent)" stop-opacity="0.18" />
										<stop offset="100%" stop-color="var(--accent)" stop-opacity="0.0" />
									</linearGradient>
								</defs>
								<!-- Grid Lines -->
								<svg:line
									x1="0"
									y1="25"
									x2="300"
									y2="25"
									stroke="var(--border-strong)"
									stroke-dasharray="2,3"
									stroke-width="0.7"
								></svg:line>
								<svg:line
									x1="0"
									y1="50"
									x2="300"
									y2="50"
									stroke="var(--border-strong)"
									stroke-dasharray="2,3"
									stroke-width="0.7"
								></svg:line>
								<svg:line
									x1="0"
									y1="75"
									x2="300"
									y2="75"
									stroke="var(--border-strong)"
									stroke-dasharray="2,3"
									stroke-width="0.7"
								></svg:line>

								<!-- Area path under line -->
								<path d={chart.fillPath} fill="url(#chartGrad-{trend.id})"></path>

								<!-- Smooth trend line -->
								<path
									d={chart.linePath}
									fill="none"
									stroke="var(--accent)"
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								></path>
							</svg>

							<!-- X-Axis Labels -->
							<div class="chart-axis-labels">
								<span>{labels.start}</span>
								<span>{labels.end}</span>
							</div>
						</div>

						<p class="trend-card-description">{trend.description}</p>

						<!-- Badges, Niche Match & Action Section -->
						<div class="trend-card-footer">
							<div class="meta-row">
								<span class="platform-pill" style="--p-color: {getPlatformColor(trend.platform)}">
									{trend.platform}
								</span>
								<span class="niche-pill">{trend.niche}</span>
								<span
									class="match-pill"
									style="color: {trend.matchScore >= 80
										? 'var(--success)'
										: trend.matchScore >= 60
											? 'var(--warning)'
											: 'var(--error)'}"
								>
									{trend.matchScore}% Match
								</span>
							</div>

							<div class="hashtags-row">
								{#each trend.hashtags.slice(0, 3) as tag}
									<span class="hashtag-tag">{tag}</span>
								{/each}
							</div>

							<button
								class="exploding-action-btn"
								disabled={generatingTrendId === trend.id || !selectedAgentId}
								onclick={() => generateContent(trend)}
							>
								{#if generatingTrendId === trend.id}
									<span class="action-spinner"></span>
									Generating…
								{:else}
									<span>Generate Content</span>
									<svg
										class="arrow-icon"
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="3"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<line x1="5" y1="12" x2="19" y2="12"></line>
										<polyline points="12 5 19 12 12 19"></polyline>
									</svg>
								{/if}
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Activity Heatmap Section -->
	<div class="card heatmap-card">
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

	<!-- Niche Performance Columns -->
	<div class="two-col">
		<!-- Trending Hashtags -->
		<div class="card analytics-list-card">
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
							<span class="velocity-change" style="color: {velocityColor(ht.velocity)}"
								>{ht.change}</span
							>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- Trending Sounds -->
		<div class="card analytics-list-card">
			<div class="card-title-row">
				<h3>Trending Sounds</h3>
			</div>
			<div class="sound-list">
				{#each sounds as sound (sound.name)}
					<div class="sound-row">
						<div class="sound-icon-wrap">
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="var(--accent)"
								stroke-width="2.5"
								><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle
									cx="18"
									cy="16"
									r="3"
								/></svg
							>
						</div>
						<div class="sound-info">
							<span class="sound-name">{sound.name}</span>
							<span class="sound-artist">{sound.artist}</span>
						</div>
						<div class="sound-meta">
							<span class="sound-uses">{sound.uses} uses</span>
							<div class="sound-tags">
								<span class="sound-platform">{sound.platform}</span>
								<span class="velocity-badge" style="color: {velocityColor(sound.velocity)}"
									>{velocityIcon(sound.velocity)}</span
								>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>

	<!-- Platform Concentration Breakdown -->
	<div class="card platform-breakdown-card">
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
						<div
							class="plat-bar-fill"
							style="width: {Math.min(100, plat.trendCount * 5.5)}%; background: {plat.color}"
						></div>
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

	/* ── Exploding Topics Header & Filter Bar ── */
	.exploding-header {
		text-align: center;
		margin-bottom: 2.5rem;
	}

	.exploding-header h1 {
		font-family: var(--font-display);
		font-size: 2.2rem;
		font-weight: 800;
		color: var(--text);
		margin: 0 0 1.75rem 0;
		letter-spacing: -0.02em;
	}

	.exploding-filter-bar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.5rem 1rem;
		box-shadow: var(--shadow-sm);
		flex-wrap: wrap;
	}

	.filter-label {
		font-family: var(--font-body);
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--text-dim);
		letter-spacing: 0.05em;
		margin-right: 0.25rem;
	}

	.select-wrapper {
		position: relative;
	}

	.exploding-select {
		appearance: none;
		background: var(--bg);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-xs);
		padding: 0.4rem 2rem 0.4rem 0.75rem;
		font-family: var(--font-body);
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text);
		cursor: pointer;
		min-width: 130px;
		transition: all 0.2s ease;
	}

	.exploding-select:hover {
		border-color: var(--accent-mid);
	}

	.select-wrapper::after {
		content: '';
		position: absolute;
		right: 0.75rem;
		top: 50%;
		transform: translateY(-20%);
		border-left: 4px solid transparent;
		border-right: 4px solid transparent;
		border-top: 5px solid var(--text-muted);
		pointer-events: none;
	}

	.search-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-icon-svg {
		position: absolute;
		left: 0.75rem;
		color: var(--text-dim);
		pointer-events: none;
	}

	.exploding-search-input {
		background: var(--bg) !important;
		border: 1px solid var(--border-strong) !important;
		border-radius: var(--radius-xs) !important;
		padding: 0.4rem 3.5rem 0.4rem 2.25rem !important;
		font-family: var(--font-body);
		font-size: 0.82rem;
		color: var(--text);
		width: 200px;
		transition: all 0.2s ease;
		outline: none;
		box-shadow: none !important;
	}

	.exploding-search-input:focus {
		border-color: var(--accent) !important;
		width: 240px;
	}

	.pro-badge {
		position: absolute;
		right: 0.5rem;
		background: #2563eb;
		color: #ffffff;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 800;
		padding: 1.5px 5px;
		border-radius: 3px;
		letter-spacing: 0.05em;
		pointer-events: none;
	}

	.refresh-circle-btn {
		background: var(--bg);
		border: 1px solid var(--border-strong);
		color: var(--text-muted);
		border-radius: var(--radius-xs);
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.refresh-circle-btn:hover:not(:disabled) {
		color: var(--accent);
		border-color: var(--accent-mid);
	}

	.refresh-circle-btn:disabled {
		opacity: 0.5;
		cursor: wait;
	}

	.refresh-icon-svg.spinning {
		animation: spin 0.8s linear infinite;
	}

	/* ── Stats Bar ── */
	.stats-bar {
		display: flex;
		gap: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		margin-bottom: 2.5rem;
		box-shadow: var(--shadow-sm);
		overflow: hidden;
	}

	.stat-item {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 1.25rem 1rem;
		border-right: 1px solid var(--border);
	}

	.stat-item:last-child {
		border-right: none;
	}

	.stat-value {
		font-size: var(--text-lg);
		font-weight: 800;
		font-family: var(--font-mono);
		color: var(--text);
	}

	.stat-label {
		font-size: 0.65rem;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		font-weight: 700;
		margin-top: 0.25rem;
	}

	/* ── Trend Grid ── */
	.trends-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--gap-lg);
		margin-bottom: 3rem;
	}

	/* ── Exploding Topics Card ── */
	.trend-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		transition:
			border-color 0.25s,
			box-shadow 0.25s,
			transform 0.2s;
		box-shadow: var(--shadow-sm);
	}

	.trend-card:hover {
		border-color: var(--border-hover);
		transform: translateY(-4px);
		box-shadow: var(--shadow-md);
	}

	.trend-card-body {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.trend-card-header-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}

	.trend-card-title {
		font-family: var(--font-body);
		font-size: 1.15rem;
		font-weight: 700;
		color: var(--text);
		margin: 0;
		line-height: 1.3;
		flex: 1;
	}

	.trend-card-stats {
		display: flex;
		gap: 1rem;
		flex-shrink: 0;
	}

	.stat-group {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}

	.stat-num {
		font-family: var(--font-mono);
		font-size: 0.95rem;
		font-weight: 700;
	}

	.stat-num.volume {
		color: #2563eb;
	}

	.stat-lbl {
		font-family: var(--font-body);
		font-size: 0.65rem;
		color: var(--text-dim);
		margin-top: 0.15rem;
	}

	/* ── SVG Chart Section ── */
	.trend-chart-container {
		position: relative;
		height: 110px;
		background: rgba(0, 0, 0, 0.02);
		border-radius: var(--radius-xs);
		overflow: hidden;
		border: 1px solid rgba(255, 255, 255, 0.04);
		padding: 4px 0 0 0;
	}

	.trend-svg {
		width: 100%;
		height: 100%;
		display: block;
	}

	.chart-axis-labels {
		position: absolute;
		bottom: 4px;
		left: 8px;
		right: 8px;
		display: flex;
		justify-content: space-between;
		font-family: var(--font-mono);
		font-size: 9px;
		color: var(--text-dim);
		pointer-events: none;
		font-weight: 600;
	}

	.trend-card-description {
		font-family: var(--font-body);
		font-size: 0.82rem;
		color: var(--text-muted);
		margin: 0;
		line-height: 1.5;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		min-height: 2.85rem;
	}

	/* ── Footer Elements ── */
	.trend-card-footer {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-top: auto;
		border-top: 1px solid var(--border);
		padding-top: 1rem;
	}

	.meta-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}

	.platform-pill {
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 700;
		color: #ffffff;
		background: var(--p-color);
		padding: 2.5px 8px;
		border-radius: var(--radius-xs);
		text-transform: capitalize;
	}

	.niche-pill {
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--surface-2);
		border: 1px solid var(--border);
		padding: 2px 8px;
		border-radius: var(--radius-xs);
	}

	.match-pill {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		font-weight: 700;
		background: var(--surface-2);
		border: 1px solid var(--border);
		padding: 2px 8px;
		border-radius: var(--radius-xs);
	}

	.hashtags-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.hashtag-tag {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		color: var(--accent);
		background: var(--accent-soft);
		padding: 1px 6px;
		border-radius: 3px;
	}

	/* ── Premium Link Action Button ── */
	.exploding-action-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: var(--accent-soft);
		color: var(--accent);
		border: none;
		font-family: var(--font-body);
		font-size: 0.8rem;
		font-weight: 700;
		padding: 0.6rem 1.25rem;
		border-radius: var(--radius-xs);
		cursor: pointer;
		transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
		width: 100%;
	}

	.exploding-action-btn:hover:not(:disabled) {
		background: var(--accent-mid);
		color: #ffffff;
		transform: translateY(-1px);
	}

	.exploding-action-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.arrow-icon {
		transition: transform 0.2s ease;
	}

	.exploding-action-btn:hover:not(:disabled) .arrow-icon {
		transform: translateX(3px);
	}

	/* ── Unified Dashboard Card & Widget Styles ── */
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.5rem;
		margin-bottom: 1.5rem;
		box-shadow: var(--shadow-sm);
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
		font-weight: 700;
		color: var(--text);
		margin: 0;
	}

	.card-label {
		font-size: var(--text-xs);
		color: var(--text-dim);
	}

	/* ── Heatmap Styles ── */
	.heatmap-wrap {
		overflow-x: auto;
		scrollbar-width: thin;
	}

	.heatmap {
		display: flex;
		gap: 0;
		min-width: 700px;
		padding-bottom: 0.5rem;
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
		transition:
			background 0.3s ease,
			transform 0.15s ease;
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

	/* ── Two Column Layout ── */
	.two-col {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--gap-lg);
		margin-bottom: 1.5rem;
	}

	/* ── Hashtag List ── */
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

	/* ── Sounds List ── */
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
		color: var(--text);
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

	/* ── Platform Concentration Breakdown ── */
	.platform-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--gap-md);
	}

	.platform-card {
		background: var(--surface-2);
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
		color: var(--text);
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
		background: var(--surface-3);
		border: 1px solid var(--border);
		padding: 2px 8px;
		border-radius: var(--radius-full);
		white-space: nowrap;
	}

	/* ── Action Spinners ── */
	.action-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(124, 106, 237, 0.3);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── Responsive breakpoints ── */
	@media (max-width: 1150px) {
		.trends-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 768px) {
		.page {
			padding: 1.25rem;
		}

		.exploding-header h1 {
			font-size: 1.8rem;
		}

		.exploding-filter-bar {
			width: 100%;
			flex-direction: column;
			align-items: stretch;
		}

		.exploding-select,
		.exploding-search-input,
		.refresh-circle-btn {
			width: 100% !important;
		}

		.stats-bar {
			flex-wrap: wrap;
		}

		.stat-item {
			flex: 1 1 calc(50% - 1px);
			border-bottom: 1px solid var(--border);
		}

		.stat-item:nth-child(even) {
			border-right: none;
		}

		.trends-grid {
			grid-template-columns: 1fr;
		}
	}

	/* ── Loading Skeleton ── */
	.skeleton-trends-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1.5rem;
		margin-top: 1.5rem;
	}

	.skeleton-card {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.5rem;
		height: 340px;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		position: relative;
		overflow: hidden;
	}

	.skeleton-shimmer {
		background: linear-gradient(
			90deg,
			var(--surface-3) 25%,
			var(--border) 50%,
			var(--surface-3) 75%
		);
		background-size: 200% 100%;
		animation: shimmer 1.5s infinite;
		border-radius: var(--radius-xs);
	}

	.header-shimmer {
		height: 24px;
		width: 70%;
	}

	.chart-shimmer {
		height: 100px;
		width: 100%;
		margin: 1.5rem 0;
	}

	.footer-shimmer {
		height: 36px;
		width: 100%;
	}

	@keyframes shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}
</style>
