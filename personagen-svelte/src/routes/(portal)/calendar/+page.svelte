<script lang="ts">
	import { untrack, onMount } from 'svelte';
	import type { Agent } from '$lib/types';
	import { showToast } from '$lib/stores/ui.svelte';
	import { Posts, ContentForge } from '$lib/services/api';
	import { page } from '$app/stores';
	import { goto, afterNavigate } from '$app/navigation';


	interface ScheduledPost {
		id: string;
		agentId: string;
		agentName: string;
		text: string;
		platforms: string[];
		date: string; // YYYY-MM-DD
		time: string;
		status: 'scheduled' | 'draft' | 'published' | 'failed';
		external_id?: string | null;
		analytics?: { views: number; likes: number; comments: number; shares: number } | null;
		token_usage?: number | null;
		token_cost?: number | null;
	}

	interface SampleBlueprint {
		id: string;
		name: string;
		platform: string;
		niche: string;
		score: number;
		date: string;
		layers: number;
	}

	interface PageData {
		agents: Agent[];
		realPosts?: ScheduledPost[];
		blueprints?: SampleBlueprint[];
	}

	let { data } = $props<{ data: PageData }>();

	// ── State ──
	let currentYear = $state(new Date().getFullYear());
	let currentMonth = $state(new Date().getMonth()); // 0-indexed
	let selectedAgentId = $state('');
	let selectedDay = $state<number | null>(null);
	let showComposer = $state(false);
	let composerSubmitting = $state(false);

	// Date Picker Dropdown State
	let showDatePicker = $state(false);
	let pickerYear = $state(currentYear);
	let pickerMonth = $state(currentMonth);
	let pickerDay = $state(selectedDay || 1);

	// Derived options for date picker
	let pickerYears = $derived.by(() => {
		const years = [];
		const base = new Date().getFullYear();
		for (let y = base - 5; y <= base + 5; y++) {
			years.push(y);
		}
		return years;
	});

	let pickerDays = $derived.by(() => {
		const total = getDaysInMonth(pickerYear, pickerMonth);
		return Array.from({ length: total }, (_, i) => i + 1);
	});

	// Ensure day selection is capped properly for the selected month/year
	$effect(() => {
		const maxDays = getDaysInMonth(pickerYear, pickerMonth);
		if (pickerDay > maxDays) {
			pickerDay = maxDays;
		}
	});

	function toggleDatePicker() {
		showDatePicker = !showDatePicker;
		if (showDatePicker) {
			pickerYear = currentYear;
			pickerMonth = currentMonth;
			pickerDay = selectedDay || 1;
		}
	}

	function applyDatePicker() {
		currentYear = pickerYear;
		currentMonth = pickerMonth;
		selectedDay = pickerDay;
		showDatePicker = false;
	}

	function selectToday() {
		const today = new Date();
		pickerYear = today.getFullYear();
		pickerMonth = today.getMonth();
		pickerDay = today.getDate();

		currentYear = pickerYear;
		currentMonth = pickerMonth;
		selectedDay = pickerDay;
		showDatePicker = false;
	}

	// Composer form
	let composerAgentId = $state('');
	let composerText = $state('');
	let composerPlatforms = $state<Record<string, boolean>>({
		tiktok: false,
		instagram: false,
		youtube: false,
		x: false,
		facebook: false,
		threads: false
	});
	let composerDate = $state('');
	let composerTime = $state('10:00');

	// Content Forge Integration inside Composer

	const SAMPLE_BLUEPRINTS: SampleBlueprint[] = [
		{
			id: 'bp-1',
			name: 'FitnessByKira',
			platform: 'youtube',
			niche: 'Fitness & Wellness',
			score: 92,
			date: '2 days ago',
			layers: 9
		},
		{
			id: 'bp-2',
			name: 'TechBroDaily',
			platform: 'x',
			niche: 'Tech & AI',
			score: 87,
			date: '1 week ago',
			layers: 9
		},
		{
			id: 'bp-3',
			name: 'StyleWithMaya',
			platform: 'instagram',
			niche: 'Fashion & Luxury',
			score: 95,
			date: '3 days ago',
			layers: 9
		},
		{
			id: 'bp-4',
			name: 'CookingVibes',
			platform: 'tiktok',
			niche: 'Food & Cooking',
			score: 78,
			date: '5 days ago',
			layers: 9
		}
	];

	const CONTENT_TYPES = [
		{ id: 'post', label: 'Post', icon: '📝' },
		{ id: 'script', label: 'Script', icon: '🎬' },
		{ id: 'titles', label: 'Title Ideas', icon: '💡' },
		{ id: 'thumbnail', label: 'Thumbnail Brief', icon: '🖼️' }
	];

	let dbBlueprints = $derived(data.blueprints || []);
	let allBlueprints = $derived([...dbBlueprints, ...SAMPLE_BLUEPRINTS]);
	let selectedBlueprintId = $state<string | null>(null);

	$effect(() => {
		if (!selectedBlueprintId && allBlueprints.length > 0) {
			selectedBlueprintId = allBlueprints[0].id;
		}
	});
	let forgeTopic = $state('');
	let forgeProductId = $state('');
	let forgeContentType = $state('post');
	let forging = $state(false);

	let brandName = $state('');
	let products = $state<any[]>([]);
	let ugcGuidelines = $state('');

	onMount(() => {
		const LS_KEY = 'personagen_brand_brief';
		try {
			const saved = localStorage.getItem(LS_KEY);
			if (saved) {
				const d = JSON.parse(saved);
				brandName = d.brandName || '';
				products = d.products || [];
				ugcGuidelines = d.ugcGuidelines || '';
				if (products.length > 0 && !forgeProductId) {
					forgeProductId = products[0].id;
				}
			}
		} catch {
			/* ignore */
		}
	});

	// Handle auto-open/close composer on navigation
	afterNavigate((navigation) => {
		const isForge = navigation.to?.url.searchParams.get('forge') === 'true';
		if (isForge) {
			openComposer();
		} else {
			// Only close composer if we are still on the calendar route
			if (navigation.to?.url.pathname === '/calendar') {
				showComposer = false;
			}
		}
	});


	function selectBlueprint(bp: SampleBlueprint) {
		selectedBlueprintId = bp.id;
		// Auto-select platform and check it
		if (bp.platform) {
			const normPlat = bp.platform.toLowerCase();
			if (composerAgentPlatforms.includes(normPlat)) {
				composerPlatforms = {
					tiktok: false,
					instagram: false,
					youtube: false,
					x: false,
					facebook: false,
					threads: false,
					[normPlat]: true
				};
			}
		}
	}

	async function runForge() {
		if (!selectedBlueprintId || !forgeTopic.trim()) return;
		forging = true;

		const selectedProd = products.find((p) => p.id === forgeProductId);
		let enrichedTopic = forgeTopic;

		if (selectedProd) {
			enrichedTopic += `\n\nProduct Focus Details:\nName: ${selectedProd.name}\nPrice: ${selectedProd.price}\nDescription: ${selectedProd.description}`;
		}

		if (ugcGuidelines) {
			enrichedTopic += `\n\nBrand UGC Guidelines & Format Style to incorporate:\n${ugcGuidelines}`;
		}

		const activePlatforms = Object.entries(composerPlatforms)
			.filter(([, v]) => v)
			.map(([k]) => k);
		
		const platforms = activePlatforms.length > 0 ? activePlatforms : ['instagram'];

		try {
			let res;
			if (forgeContentType === 'post') {
				res = await ContentForge.generate(
					selectedBlueprintId,
					enrichedTopic,
					composerAgentId,
					platforms
				);
			} else if (forgeContentType === 'script') {
				res = await ContentForge.script(selectedBlueprintId, enrichedTopic, composerAgentId);
			} else if (forgeContentType === 'titles') {
				res = await ContentForge.titles(selectedBlueprintId, enrichedTopic);
			} else {
				res = await ContentForge.thumbnailBrief(selectedBlueprintId, enrichedTopic);
			}

			if (res.success && res.data) {
				const data = res.data as any;
				if (forgeContentType === 'titles' && data.titles) {
					composerText = data.titles.join('\n\n');
				} else if (forgeContentType === 'thumbnail' && data.thumbnailNotes) {
					composerText = data.thumbnailNotes.join('\n\n');
				} else {
					composerText = data.content || '';
				}
				showToast('Content forged successfully!', 'success');
			} else {
				composerText = getMockForgedContent(enrichedTopic, selectedProd);
				showToast('Using forged demo template', 'info');
			}
		} catch (e) {
			composerText = getMockForgedContent(enrichedTopic, selectedProd);
			showToast('Using forged demo template', 'info');
		} finally {
			forging = false;
		}
	}

	function getMockForgedContent(topicText: string, product: any): string {
		const prodName = product?.name || 'HoneyX Manly Plus';
		const prodPrice = product?.price || 'Rs. 2,450';
		const prodDesc = product?.description || "Nature's premium superfood for energy.";
		
		if (forgeContentType === 'post') {
			return `🔥 ${topicText}\n\nIntroducing: ${prodName} (${prodPrice})!\n\n1️⃣ **Organic Vitality Power**: Unlocking natural daily drive.\n2️⃣ **Potent Herbal Active**: Sustainable energy with zero crash.\n\n${prodDesc}\n\nDrop a comment to grab exclusive early access 👇`;
		} else if (forgeContentType === 'script') {
			return `[SCENE: Close-up of ${prodName}]\n"Ditch the synthetic energy drinks. This is pure raw honey packed with performance herbs. All-natural stamina, zero crashes."\n\n[CTA: Link in bio!]`;
		} else if (forgeContentType === 'titles') {
			return `- Why Athletes Are Raving About ${prodName}\n- I Ditched Synthetic Pre-Workouts For Active Honey\n- The Secret to Organic Workout Stamina`;
		} else {
			return `Layout: Close-up pouch of ${prodName} with amber lighting\nText: "BYE BYE CHEMICALS"\nBackground: Dark luxury graphite with honey drips`;
		}
	}

	function getPlatformColor(id: string): string {
		const colors: Record<string, string> = {
			youtube: '#ff0000',
			tiktok: '#00f2ea',
			instagram: '#e1306c',
			x: '#1da1f2',
			facebook: '#1877f2',
			threads: '#999'
		};
		return colors[id] || 'var(--accent)';
	}

	function getScoreColor(score: number): string {
		if (score >= 90) return 'var(--success)';
		if (score >= 75) return 'var(--cyan)';
		if (score >= 60) return 'var(--gold)';
		return 'var(--rose)';
	}

	let currentComposerAgent = $derived(data.agents.find((a: any) => a.id === composerAgentId));
	let composerAgentPlatforms = $derived(currentComposerAgent?.connected_platforms || ['instagram', 'youtube']);

	$effect(() => {
		if (composerAgentId) {
			composerPlatforms = {
				tiktok: false,
				instagram: false,
				youtube: false,
				x: false,
				facebook: false,
				threads: false
			};
		}
	});

	function formatViews(v: number): string {
		if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
		if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
		return String(v);
	}

	let posts = $state<ScheduledPost[]>(data.realPosts || []);

	// ── Calendar helpers ──
	const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const MONTHS = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];

	let monthLabel = $derived(`${MONTHS[currentMonth]} ${currentYear}`);

	function getDaysInMonth(year: number, month: number): number {
		return new Date(year, month + 1, 0).getDate();
	}

	function getFirstDayOfMonth(year: number, month: number): number {
		const d = new Date(year, month, 1).getDay();
		return d === 0 ? 6 : d - 1; // Mon=0
	}

	interface CalendarCell {
		day: number | null;
		isToday: boolean;
		dateStr: string;
	}

	let calendarCells = $derived.by(() => {
		const daysInMonth = getDaysInMonth(currentYear, currentMonth);
		const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
		const cells: CalendarCell[] = [];
		const today = new Date();
		const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

		// leading empties
		for (let i = 0; i < firstDay; i++) {
			cells.push({ day: null, isToday: false, dateStr: '' });
		}
		for (let d = 1; d <= daysInMonth; d++) {
			const mm = String(currentMonth + 1).padStart(2, '0');
			const dd = String(d).padStart(2, '0');
			const dateStr = `${currentYear}-${mm}-${dd}`;
			cells.push({ day: d, isToday: dateStr === todayStr, dateStr });
		}
		// trailing
		while (cells.length % 7 !== 0) {
			cells.push({ day: null, isToday: false, dateStr: '' });
		}
		return cells;
	});

	let filteredPosts = $derived(
		posts.filter((p) => {
			if (selectedAgentId && p.agentId !== selectedAgentId) return false;
			return true;
		})
	);

	function getPostsForDate(dateStr: string) {
		return filteredPosts.filter((p) => p.date === dateStr);
	}

	let selectedDayPosts = $derived.by(() => {
		if (selectedDay === null) return [];
		const mm = String(currentMonth + 1).padStart(2, '0');
		const dd = String(selectedDay).padStart(2, '0');
		const dateStr = `${currentYear}-${mm}-${dd}`;
		return getPostsForDate(dateStr);
	});

	function prevMonth() {
		if (currentMonth === 0) {
			currentMonth = 11;
			currentYear--;
		} else {
			currentMonth--;
		}
		selectedDay = null;
	}

	function nextMonth() {
		if (currentMonth === 11) {
			currentMonth = 0;
			currentYear++;
		} else {
			currentMonth++;
		}
		selectedDay = null;
	}

	function selectDay(day: number | null) {
		if (day === null) return;
		selectedDay = selectedDay === day ? null : day;
	}

	function openComposer() {
		showComposer = true;
		composerAgentId = selectedAgentId || data.agents[0]?.id || '';
		composerText = '';
		forgeTopic = '';
		selectedBlueprintId = allBlueprints[0]?.id || null;
		composerPlatforms = {
			tiktok: false,
			instagram: false,
			youtube: false,
			x: false,
			facebook: false,
			threads: false
		};
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		composerDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
		composerTime = '10:00';
	}

	function closeComposer() {
		showComposer = false;
		if ($page.url.searchParams.get('forge') === 'true') {
			goto('/calendar', { replaceState: true, noScroll: true });
		}
	}

	async function schedulePost() {
		const selectedPlatforms = Object.entries(composerPlatforms)
			.filter(([, v]) => v)
			.map(([k]) => k);
		if (!composerAgentId) {
			showToast('Select an agent', 'warning');
			return;
		}
		if (!composerText.trim()) {
			showToast('Write some content', 'warning');
			return;
		}
		if (selectedPlatforms.length === 0) {
			showToast('Select at least one platform', 'warning');
			return;
		}
		if (!composerDate) {
			showToast('Pick a date', 'warning');
			return;
		}

		composerSubmitting = true;
		try {
			const res = await Posts.create({
				agent_id: composerAgentId,
				content: composerText,
				platforms: selectedPlatforms,
				scheduled_date: composerDate,
				scheduled_time: composerTime + ':00',
				status: 'scheduled'
			});
			if (res.success && res.data) {
				const created = res.data as any;
				const agent = data.agents.find((a: Agent) => a.id === composerAgentId);
				posts = [
					...posts,
					{
						id: created.id,
						agentId: created.agent_id,
						agentName: agent?.name || 'Agent',
						text: created.content,
						platforms: created.platforms || [],
						date: created.scheduled_date,
						time: created.scheduled_time ? created.scheduled_time.substring(0, 5) : '10:00',
						status: 'scheduled'
					}
				];
				showToast('Post scheduled successfully', 'success');
				showComposer = false;
			} else {
				showToast(res.error || 'Failed to schedule post', 'error');
			}
		} catch (err: any) {
			showToast(err.message || 'Error scheduling post', 'error');
		} finally {
			composerSubmitting = false;
		}
	}

	const PLATFORM_COLORS: Record<string, string> = {
		tiktok: '#fe2c55',
		instagram: '#e1306c',
		youtube: '#ff0000',
		x: '#1da1f2',
		facebook: '#1877f2',
		threads: '#999'
	};

	const STATUS_COLORS: Record<string, string> = {
		scheduled: 'var(--accent)',
		draft: 'var(--warning)',
		published: 'var(--success)'
	};
</script>

<svelte:head>
	<title>Calendar — PersonaGen</title>
</svelte:head>

<section class="page">
	<!-- Header -->
	<header class="page-header">
		<div class="header-left">
			<h1>Content Calendar</h1>
			<p class="subtitle">Schedule and manage posts across all agents and platforms</p>
		</div>
		<div class="header-controls">
			<div class="agent-filter">
				<label for="cal-agent">Filter Agent</label>
				<select id="cal-agent" bind:value={selectedAgentId}>
					<option value="">All Agents</option>
					{#each data.agents as agent}
						<option value={agent.id}>{agent.name}</option>
					{/each}
				</select>
			</div>
		</div>
	</header>

	<!-- Month nav -->
	<div class="month-nav">
		<button class="nav-btn" onclick={prevMonth} aria-label="Previous month">
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg
			>
		</button>
		<div class="month-selector-wrapper">
			<button
				class="month-selector-btn"
				onclick={toggleDatePicker}
				aria-label="Choose specific month and year"
			>
				<span>{monthLabel}</span>
				<svg
					class="dropdown-icon"
					class:open={showDatePicker}
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<polyline points="6 9 12 15 18 9" />
				</svg>
			</button>

			{#if showDatePicker}
				<div
					class="datepicker-backdrop"
					onclick={() => (showDatePicker = false)}
					role="presentation"
				></div>
				<div class="datepicker-dropdown">
					<h4 class="datepicker-title">Jump to Date</h4>
					<div class="datepicker-fields">
						<div class="datepicker-field">
							<label for="picker-month">Month</label>
							<select id="picker-month" bind:value={pickerMonth}>
								{#each MONTHS as month, index}
									<option value={index}>{month}</option>
								{/each}
							</select>
						</div>
						<div class="datepicker-field">
							<label for="picker-year">Year</label>
							<select id="picker-year" bind:value={pickerYear}>
								{#each pickerYears as year}
									<option value={year}>{year}</option>
								{/each}
							</select>
						</div>
						<div class="datepicker-field">
							<label for="picker-day">Day</label>
							<select id="picker-day" bind:value={pickerDay}>
								{#each pickerDays as day}
									<option value={day}>{day}</option>
								{/each}
							</select>
						</div>
					</div>
					<div class="datepicker-actions">
						<button class="btn-ghost btn-sm" onclick={selectToday}>Today</button>
						<button class="btn-primary btn-sm" onclick={applyDatePicker}>Apply</button>
					</div>
				</div>
			{/if}
		</div>
		<button class="nav-btn" onclick={nextMonth} aria-label="Next month">
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg
			>
		</button>
	</div>

	<div class="calendar-layout">
		<!-- Calendar grid -->
		<div class="calendar-wrap">
			<!-- Day headers -->
			<div class="day-headers">
				{#each DAYS as day}
					<div class="day-header">{day}</div>
				{/each}
			</div>

			<!-- Cells -->
			<div class="calendar-grid">
				{#each calendarCells as cell}
					{#if cell.day === null}
						<div class="cell empty"></div>
					{:else}
						{@const dayPosts = getPostsForDate(cell.dateStr)}
						<button
							class="cell"
							class:today={cell.isToday}
							class:selected={selectedDay === cell.day}
							class:has-posts={dayPosts.length > 0}
							onclick={() => selectDay(cell.day)}
						>
							<span class="cell-day">{cell.day}</span>
							{#if dayPosts.length > 0}
								<div class="cell-dots">
									{#each dayPosts.slice(0, 4) as post}
										<span
											class="dot"
											style="background: {PLATFORM_COLORS[post.platforms[0]] || 'var(--accent)'}"
										></span>
									{/each}
									{#if dayPosts.length > 4}
										<span class="dot-more">+{dayPosts.length - 4}</span>
									{/if}
								</div>
								{@const totalViews = dayPosts.reduce(
									(acc, p) => acc + (p.analytics?.views || 0),
									0
								)}
								{#if totalViews > 0}
									<span class="views-badge">🔥 {formatViews(totalViews)}</span>
								{/if}
							{/if}
						</button>
					{/if}
				{/each}
			</div>

			<!-- Mobile list view -->
			<div class="mobile-list">
				<h3 class="mobile-list-title">Upcoming Posts</h3>
				{#each filteredPosts.sort((a, b) => a.date.localeCompare(b.date)) as post}
					<div class="mobile-post-item">
						<div class="mobile-post-date">{post.date} · {post.time}</div>
						<div class="mobile-post-text">{post.text}</div>
						<div class="mobile-post-meta">
							<span class="mobile-post-agent">{post.agentName}</span>
							<div class="mobile-post-platforms">
								{#each post.platforms as p}
									<span class="platform-tag" style="color: {PLATFORM_COLORS[p]}">{p}</span>
								{/each}
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- Side panel (selected day) -->
		{#if selectedDay !== null}
			<aside class="day-panel">
				<div class="panel-header">
					<h3>{MONTHS[currentMonth]} {selectedDay}</h3>
					<button class="panel-close" onclick={() => (selectedDay = null)}>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg
						>
					</button>
				</div>

				{#if selectedDayPosts.length === 0}
					<div class="panel-empty">
						<svg
							width="32"
							height="32"
							viewBox="0 0 24 24"
							fill="none"
							stroke="var(--text-dim)"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							><rect x="3" y="4" width="18" height="18" rx="2" /><line
								x1="16"
								y1="2"
								x2="16"
								y2="6"
							/><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg
						>
						<p>No posts scheduled</p>
					</div>
				{:else}
					<div class="panel-posts">
						{#each selectedDayPosts as post}
							<div class="panel-post">
								<div
									class="post-status-bar"
									style="background: {STATUS_COLORS[post.status] || 'var(--accent)'}"
								></div>
								<div class="post-content">
									<div class="post-time-status">
										<span class="post-time">{post.time}</span>
										{#if post.status === 'published'}
											<span class="live-indicator">Live Tracker</span>
										{:else}
											<span
												class="post-status-tag"
												style="color: {STATUS_COLORS[post.status] || 'var(--accent)'}"
												>{post.status}</span
											>
										{/if}
									</div>
									<p class="post-text">{post.text}</p>

									{#if post.status === 'published' && post.analytics}
										<div class="analytics-row">
											<div class="metric" title="Views">
												<span class="emoji">👁️</span>
												{formatViews(post.analytics.views)}
											</div>
											<div class="metric" title="Likes">
												<span class="emoji">❤️</span>
												{formatViews(post.analytics.likes)}
											</div>
											<div class="metric" title="Comments">
												<span class="emoji">💬</span>
												{formatViews(post.analytics.comments)}
											</div>
											{#if post.token_cost !== undefined && post.token_cost !== null && post.token_cost > 0}
												<div class="metric token-cost" title="Gemini Cost">
													<span class="emoji">🪙</span> ${post.token_cost.toFixed(4)}
												</div>
											{/if}
										</div>
									{/if}

									<div class="post-meta">
										<span class="post-agent">{post.agentName}</span>
										<div class="post-platforms">
											{#each post.platforms as p}
												<span
													class="platform-dot"
													style="background: {PLATFORM_COLORS[p]}"
													title={p}
												></span>
											{/each}
										</div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</aside>
		{/if}
	</div>

	<!-- FAB -->
	<button class="fab" onclick={openComposer} aria-label="New Post">
		<svg
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.5"
			stroke-linecap="round"
			stroke-linejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg
		>
	</button>

	<!-- Composer overlay -->
	{#if showComposer}
		<div class="composer-overlay" onclick={closeComposer} role="presentation">
			<div class="composer" onclick={(e) => e.stopPropagation()} role="dialog">
				<div class="composer-header">
					<div class="header-title-group" style="display: flex; align-items: center; gap: 8px;">
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="url(#forgeGrad)"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<defs>
								<linearGradient id="forgeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
									<stop offset="0%" stop-color="var(--rose)" />
									<stop offset="100%" stop-color="var(--gold)" />
								</linearGradient>
							</defs>
							<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
						</svg>
						<h3>Content Forge & Schedule Post</h3>
					</div>
					<button class="panel-close" onclick={closeComposer}>
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg
						>
					</button>
				</div>

				<div class="composer-grid">
					<!-- Left Column: Blueprint Selector & Forge Settings -->
					<div class="composer-left-panel">
						<div class="panel-section-title">Select Blueprint</div>
						<div class="blueprint-mini-list">
							{#each allBlueprints as bp}
								<button
									type="button"
									class="blueprint-mini-item"
									class:active={selectedBlueprintId === bp.id}
									onclick={() => selectBlueprint(bp)}
								>
									<div class="bp-mini-header">
										<span class="bp-mini-score" style="color: {getScoreColor(bp.score)}">{bp.score} pts</span>
										<span class="bp-mini-platform" style="color: {getPlatformColor(bp.platform)}">{bp.platform}</span>
									</div>
									<div class="bp-mini-name">{bp.name}</div>
									<div class="bp-mini-meta">{bp.niche}</div>
								</button>
							{/each}
						</div>

						<div class="panel-divider" style="margin: 0.5rem 0;"></div>

						<div class="field">
							<label for="forge-topic" class="panel-section-title" style="margin-bottom: 0.25rem;">Topic / Prompt</label>
							<input
								id="forge-topic"
								type="text"
								bind:value={forgeTopic}
								placeholder="e.g. Biohacking stamina with raw clover honey..."
								style="font-size: var(--text-sm); padding: 0.5rem 0.75rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
							/>
						</div>

						<div class="field">
							<label for="forge-product" class="panel-section-title" style="margin-bottom: 0.25rem;">Focus Product</label>
							<select
								id="forge-product"
								bind:value={forgeProductId}
								style="font-size: var(--text-sm); padding: 0.5rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
							>
								<option value="">No Product (General Content)</option>
								{#each products as product}
									<option value={product.id}>{product.name} ({product.price})</option>
								{/each}
							</select>
						</div>

						<div class="field">
							<label class="panel-section-title" style="margin-bottom: 0.25rem;">Content Type</label>
							<div class="type-selector-mini">
								{#each CONTENT_TYPES as ct}
									<button
										type="button"
										class="type-btn-mini"
										class:active={forgeContentType === ct.id}
										onclick={() => (forgeContentType = ct.id)}
									>
										<span class="type-icon">{ct.icon}</span>
										<span>{ct.label}</span>
									</button>
								{/each}
							</div>
						</div>

						<button
							type="button"
							class="btn-forge-action"
							disabled={forging || !forgeTopic.trim()}
							onclick={runForge}
						>
							{#if forging}
								<span class="spinner"></span> Forging...
							{:else}
								✨ Forge Content
							{/if}
						</button>
					</div>

					<!-- Right Column: Content Preview, Platform selection, and DateTime scheduler -->
					<div class="composer-right-panel">
						<div class="field-row">
							<div class="field" style="flex: 1;">
								<label for="comp-agent" class="panel-section-title" style="margin-bottom: 0.25rem;">Target Agent</label>
								<select
									id="comp-agent"
									bind:value={composerAgentId}
									style="font-size: var(--text-sm); padding: 0.5rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
								>
									{#each data.agents as agent}
										<option value={agent.id}>{agent.name}</option>
									{/each}
								</select>
							</div>
						</div>

						<div class="field">
							<label for="comp-text" class="panel-section-title" style="margin-bottom: 0.25rem;">Content & Copy</label>
							<textarea
								id="comp-text"
								bind:value={composerText}
								rows="5"
								placeholder="Select blueprint and prompt to Forge, or write/edit your post content here directly…"
								style="font-size: var(--text-sm); padding: 0.75rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text); resize: vertical; line-height: 1.5;"
							></textarea>
						</div>

						<div class="field">
							<label class="panel-section-title" style="margin-bottom: 0.25rem;">Target Platforms</label>
							<div class="platform-checkboxes">
								{#each composerAgentPlatforms as key}
									{@const color = PLATFORM_COLORS[key] || 'var(--accent)'}
									<label class="platform-checkbox" style="--p-color: {color}">
										<input type="checkbox" bind:checked={composerPlatforms[key]} />
										<span class="checkbox-label">{key}</span>
									</label>
								{/each}
							</div>
						</div>

						<div class="field-row">
							<div class="field" style="flex: 1;">
								<label for="comp-date" class="panel-section-title" style="margin-bottom: 0.25rem;">Schedule Date</label>
								<input
									id="comp-date"
									type="date"
									bind:value={composerDate}
									style="font-size: var(--text-sm); padding: 0.5rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
								/>
							</div>
							<div class="field" style="flex: 1;">
								<label for="comp-time" class="panel-section-title" style="margin-bottom: 0.25rem;">Schedule Time</label>
								<input
									id="comp-time"
									type="time"
									bind:value={composerTime}
									style="font-size: var(--text-sm); padding: 0.5rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
								/>
							</div>
						</div>
					</div>
				</div>

				<div class="composer-footer">
					<button class="btn-ghost btn-sm" onclick={closeComposer}>Cancel</button>
					<button class="btn-primary btn-sm" onclick={schedulePost} disabled={composerSubmitting}>
						{#if composerSubmitting}
							<span class="spinner"></span>
							Scheduling…
						{:else}
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								><rect x="3" y="4" width="18" height="18" rx="2" /><line
									x1="16"
									y1="2"
									x2="16"
									y2="6"
								/><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg
							>
							Schedule Post
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}
</section>

<style>
	.page {
		padding: 2rem;
		max-width: 1400px;
		margin: 0 auto;
		position: relative;
		min-height: calc(100vh - 60px);
	}

	/* ── Header ── */
	.page-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 2rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.page-header h1 {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		margin: 0 0 0.3rem;
	}

	.subtitle {
		color: var(--text-muted);
		font-size: var(--text-base);
		margin: 0;
	}

	.agent-filter select {
		min-width: 200px;
	}

	/* ── Month nav ── */
	.month-nav {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.nav-btn {
		width: 36px;
		height: 36px;
		border-radius: var(--radius-full);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s,
			background 0.2s;
	}

	.nav-btn:hover {
		border-color: var(--accent-mid);
		color: var(--text);
		background: var(--surface-2);
	}

	.month-selector-wrapper {
		position: relative;
		display: inline-block;
		z-index: 80;
	}

	.month-selector-btn {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: var(--weight-semi);
		color: var(--text);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		padding: 0.5rem 1.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		cursor: pointer;
		transition:
			background-color 0.2s,
			border-color 0.2s,
			color 0.2s;
		user-select: none;
		min-width: 220px;
	}

	.month-selector-btn:hover {
		background: var(--surface-2);
		border-color: var(--border-strong);
		color: var(--accent);
	}

	.dropdown-icon {
		color: var(--text-dim);
		transition:
			transform var(--ease-fast),
			color 0.2s;
	}

	.month-selector-btn:hover .dropdown-icon {
		color: var(--accent);
	}

	.dropdown-icon.open {
		transform: rotate(180deg);
	}

	/* Datepicker dropdown popup */
	.datepicker-backdrop {
		position: fixed;
		inset: 0;
		z-index: 85;
		background: transparent;
	}

	.datepicker-dropdown {
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%) translateY(8px);
		z-index: 90;
		min-width: 320px;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-lg);
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		animation: fadeDown 0.2s var(--ease-out);
	}

	.datepicker-title {
		font-size: var(--text-base);
		font-family: var(--font-display);
		margin: 0;
		color: var(--text);
		border-bottom: 1px solid var(--border);
		padding-bottom: 0.5rem;
	}

	.datepicker-fields {
		display: flex;
		gap: 0.5rem;
	}

	.datepicker-field {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.datepicker-field label {
		font-size: 0.55rem;
		margin-bottom: 0;
	}

	.datepicker-field select {
		padding: 6px 20px 6px 8px;
		font-size: var(--text-xs);
		border-radius: var(--radius-xs);
	}

	.datepicker-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
	}

	/* ── Calendar layout ── */
	.calendar-layout {
		display: flex;
		gap: 1.5rem;
		align-items: flex-start;
	}

	.calendar-wrap {
		flex: 1;
		min-width: 0;
	}

	.day-headers {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
		margin-bottom: 2px;
	}

	.day-header {
		text-align: center;
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		color: var(--text-dim);
		padding: 0.5rem 0;
	}

	.calendar-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
	}

	.cell {
		aspect-ratio: 1;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.3rem;
		cursor: pointer;
		transition:
			border-color 0.2s,
			background 0.2s;
		min-height: 75px;
		font-family: var(--font-body);
		color: var(--text);
		text-align: left;
	}

	.cell.empty {
		background: transparent;
		border-color: transparent;
		cursor: default;
	}

	.cell:not(.empty):hover {
		border-color: var(--border-hover);
		background: var(--surface-2);
	}

	.cell.today {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent-mid);
	}

	.cell.selected {
		border-color: var(--accent);
		background: var(--accent-soft);
	}

	.cell-day {
		font-size: var(--text-sm);
		font-weight: var(--weight-semi);
		color: var(--text);
	}

	.cell.today .cell-day {
		color: var(--accent);
	}

	.cell-dots {
		display: flex;
		gap: 3px;
		flex-wrap: wrap;
		align-items: center;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.dot-more {
		font-size: 0.55rem;
		color: var(--text-dim);
		font-weight: var(--weight-bold);
	}

	/* ── Mobile list view (hidden on desktop) ── */
	.mobile-list {
		display: none;
	}

	/* ── Day panel ── */
	.day-panel {
		width: 340px;
		flex-shrink: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		animation: fadeDown 0.25s var(--ease-out);
		position: sticky;
		top: 80px;
		max-height: calc(100vh - 120px);
		overflow-y: auto;
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border);
	}

	.panel-header h3 {
		font-size: var(--text-md);
		font-family: var(--font-display);
		margin: 0;
	}

	.panel-close {
		width: 28px;
		height: 28px;
		border-radius: var(--radius-full);
		border: none;
		background: var(--surface-2);
		color: var(--text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}

	.panel-close:hover {
		color: var(--text);
		background: var(--surface-3);
	}

	.panel-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 3rem 1.5rem;
		text-align: center;
	}

	.panel-empty p {
		color: var(--text-dim);
		font-size: var(--text-sm);
		margin: 0;
	}

	.panel-posts {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.panel-post {
		display: flex;
		gap: 0;
		border-bottom: 1px solid var(--border);
		transition: background 0.15s;
	}

	.panel-post:last-child {
		border-bottom: none;
	}

	.panel-post:hover {
		background: var(--surface-2);
	}

	.post-status-bar {
		width: 3px;
		flex-shrink: 0;
	}

	.post-content {
		padding: 1rem 1.25rem;
		flex: 1;
		min-width: 0;
	}

	.post-time-status {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.4rem;
	}

	.post-time {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--text-muted);
	}

	.post-status-tag {
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
	}

	.post-text {
		font-size: var(--text-sm);
		color: var(--text);
		margin: 0 0 0.5rem;
		line-height: var(--leading-snug);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.post-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.post-agent {
		font-size: var(--text-xs);
		color: var(--text-dim);
	}

	.post-platforms {
		display: flex;
		gap: 4px;
	}

	.platform-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	/* ── FAB ── */
	.fab {
		position: fixed;
		bottom: 2rem;
		right: 2rem;
		width: 56px;
		height: 56px;
		border-radius: var(--radius-full);
		background: var(--gradient-subtle);
		border: none;
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		box-shadow: var(--shadow-lg), var(--shadow-accent);
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
		z-index: var(--z-sticky);
	}

	.fab:hover {
		transform: translateY(-3px) scale(1.05);
		box-shadow:
			var(--shadow-lg),
			0 0 40px rgba(124, 106, 237, 0.3);
	}

	/* ── Composer overlay ── */
	.composer-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-modal);
		animation: fadeIn 0.2s ease;
		padding: 1rem;
	}

	.composer {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		width: 100%;
		max-width: 1000px;
		max-height: 90vh;
		display: flex;
		flex-direction: column;
		animation: fadeDown 0.3s var(--ease-out);
		overflow: hidden;
	}

	.composer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border);
	}

	.composer-header h3 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--text-lg);
	}

	.composer-body {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.field {
		display: flex;
		flex-direction: column;
	}

	.field-row {
		display: flex;
		gap: 1rem;
	}

	.field-row .field {
		flex: 1;
	}

	.platform-checkboxes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.platform-checkbox {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.65rem;
		border-radius: var(--radius-xs);
		background: var(--surface-2);
		border: 1px solid var(--border);
		cursor: pointer;
		font-size: var(--text-xs);
		font-weight: var(--weight-semi);
		text-transform: capitalize;
		transition: border-color 0.2s;
		margin-bottom: 0;
		letter-spacing: 0;
		color: var(--text-muted);
	}

	.platform-checkbox:has(input:checked) {
		border-color: var(--p-color);
		color: var(--p-color);
		background: rgba(255, 255, 255, 0.03);
	}

	.platform-checkbox input {
		width: 14px;
		height: 14px;
		accent-color: var(--p-color);
	}

	.checkbox-label {
		pointer-events: none;
	}

	.composer-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--border);
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.2);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes fadeDown {
		from {
			opacity: 0;
			transform: translateY(-12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	/* ── Mobile list items ── */
	.mobile-post-item {
		padding: 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		margin-bottom: 0.5rem;
	}

	.mobile-post-date {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--text-dim);
		margin-bottom: 0.35rem;
	}

	.mobile-post-text {
		font-size: var(--text-sm);
		color: var(--text);
		margin-bottom: 0.5rem;
		line-height: var(--leading-snug);
	}

	.mobile-post-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.mobile-post-agent {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.mobile-post-platforms {
		display: flex;
		gap: 0.4rem;
	}

	.platform-tag {
		font-size: var(--text-xs);
		font-weight: var(--weight-semi);
		text-transform: capitalize;
	}

	.mobile-list-title {
		font-size: var(--text-md);
		font-family: var(--font-display);
		margin: 1rem 0 0.75rem;
	}

	/* ── Responsive ── */
	@media (max-width: 900px) {
		.calendar-layout {
			flex-direction: column;
		}

		.day-panel {
			width: 100%;
			position: static;
			max-height: none;
		}
	}

	@media (max-width: 640px) {
		.page {
			padding: 1rem;
		}

		.page-header {
			flex-direction: column;
			gap: 1rem;
		}

		.calendar-grid,
		.day-headers {
			display: none;
		}

		.mobile-list {
			display: block;
		}

		.fab {
			bottom: 1.25rem;
			right: 1.25rem;
		}

		.field-row {
			flex-direction: column;
			gap: 1rem;
		}
	}

	/* Live indicators & Analytics aesthetics */
	.live-indicator {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
		padding: 3px 8px;
		border-radius: var(--radius-xs);
		font-size: 0.65rem;
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		box-shadow: 0 0 10px rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.2);
	}

	.live-indicator::before {
		content: '';
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #ef4444;
		animation: live-pulse 1.5s infinite;
	}

	@keyframes live-pulse {
		0% {
			transform: scale(0.9);
			box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
		}
		70% {
			transform: scale(1.1);
			box-shadow: 0 0 0 4px rgba(239, 68, 68, 0);
		}
		100% {
			transform: scale(0.9);
			box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
		}
	}

	.views-badge {
		font-size: 0.65rem;
		font-weight: var(--weight-bold);
		color: #10b981;
		background: rgba(16, 185, 129, 0.1);
		padding: 2px 6px;
		border-radius: 4px;
		margin-top: auto;
		align-self: flex-end;
		border: 1px solid rgba(16, 185, 129, 0.2);
		text-shadow: 0 0 8px rgba(16, 185, 129, 0.1);
	}

	.analytics-row {
		display: flex;
		gap: 12px;
		margin-top: 0.5rem;
		margin-bottom: 0.75rem;
		padding: 8px 12px;
		background: rgba(255, 255, 255, 0.02);
		border-radius: var(--radius-xs);
		border: 1px solid var(--border);
	}

	.metric {
		font-size: var(--text-xs);
		color: var(--text-muted);
		display: flex;
		align-items: center;
		gap: 4px;
		font-family: var(--font-mono);
	}

	.metric .emoji {
		font-size: 0.85rem;
	}

	.metric.token-cost {
		color: #f59e0b;
		margin-left: auto;
		font-weight: var(--weight-semi);
	}

	/* ── Composer Grid ── */
	.composer-grid {
		display: grid;
		grid-template-columns: 280px 1fr;
		height: 70vh;
		min-height: 520px;
		overflow: hidden;
	}

	@media (max-width: 768px) {
		.composer-grid {
			grid-template-columns: 1fr;
			height: auto;
			overflow-y: auto;
		}
	}

	.composer-left-panel {
		border-right: 1px solid var(--border);
		background: var(--surface-2);
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		overflow-y: auto;
	}

	@media (max-width: 768px) {
		.composer-left-panel {
			border-right: none;
			border-bottom: 1px solid var(--border);
		}
	}

	.panel-section-title {
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		color: var(--text-muted);
		letter-spacing: 0.05em;
		margin-bottom: 0.25rem;
	}

	.blueprint-mini-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.blueprint-mini-item {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		padding: 0.75rem;
		text-align: left;
		cursor: pointer;
		transition: all 0.2s ease;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.blueprint-mini-item:hover {
		border-color: var(--accent);
		transform: translateY(-1px);
	}

	.blueprint-mini-item.active {
		border-color: var(--accent);
		background: rgba(124, 106, 237, 0.05);
		box-shadow: 0 0 12px rgba(124, 106, 237, 0.1);
	}

	.bp-mini-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.bp-mini-score {
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		font-family: var(--font-mono);
	}

	.bp-mini-platform {
		font-size: 10px;
		font-weight: var(--weight-bold);
		text-transform: uppercase;
	}

	.bp-mini-name {
		font-size: var(--text-sm);
		font-weight: var(--weight-semi);
		color: var(--text);
	}

	.bp-mini-meta {
		font-size: 10px;
		color: var(--text-muted);
	}

	.composer-right-panel {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		overflow-y: auto;
		background: var(--surface);
	}

	.type-selector-mini {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.35rem;
	}

	.type-btn-mini {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 0.45rem 0.25rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		cursor: pointer;
		font-size: 11px;
		color: var(--text-muted);
		transition: all 0.2s ease;
		gap: 0.25rem;
		border: 1px solid var(--border);
	}

	.type-btn-mini:hover {
		border-color: var(--accent);
		color: var(--text);
	}

	.type-btn-mini.active {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}

	.type-btn-mini .type-icon {
		font-size: var(--text-base);
	}

	.btn-forge-action {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.65rem;
		background: linear-gradient(135deg, var(--rose), var(--gold));
		color: #fff;
		border: none;
		border-radius: var(--radius-xs);
		font-weight: var(--weight-bold);
		font-size: var(--text-sm);
		cursor: pointer;
		transition: opacity 0.2s;
		margin-top: auto;
	}

	.btn-forge-action:hover:not(:disabled) {
		opacity: 0.95;
	}

	.btn-forge-action:disabled {
		background: var(--surface-3);
		color: var(--text-muted);
		cursor: not-allowed;
	}

	.panel-divider {
		height: 1px;
		background: var(--border);
		margin: 0.25rem 0;
	}
</style>
