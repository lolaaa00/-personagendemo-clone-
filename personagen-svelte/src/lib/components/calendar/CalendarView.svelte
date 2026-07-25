<script lang="ts">
	/**
	 * Shared content calendar — one component behind BOTH the global /calendar
	 * page and each persona's Calendar tab.
	 *
	 * Design goals (in priority order):
	 * 1. Fewest clicks to the golden actions: any visible post is ONE click from
	 *    its drawer; drafts are ONE click from approved (inline ✓); any future
	 *    day is ONE click from a date-prefilled composer (hover ＋).
	 * 2. Dual duty as an analytics surface: a range summary strip (posts, views,
	 *    likes for whatever month/week/day is on screen) whose chips are also
	 *    the status filter — information and drill-down in the same control.
	 * 3. Identical views everywhere: Month / Week / Day, Monday-first, with the
	 *    view choice shared via localStorage.
	 *
	 * The component owns view state and read-only presentation. Every mutation
	 * (open drawer, approve, generate) is emitted to the parent, which owns the
	 * server calls — so the persona page and global page reuse their existing,
	 * already-verified flows.
	 */
	import { onMount } from 'svelte';
	import {
		getPostDisplay as sharedGetPostDisplay,
		getPostErrorSummary
	} from '$lib/components/feed/postDisplay';
	import { platformColor } from '$lib/platforms';
	import type { CalendarPost } from './types';

	interface RailAgent {
		id: string;
		name: string;
		gradient?: string;
	}

	interface Props {
		posts: CalendarPost[];
		/** Personas rail (shown when more than one). Omit on single-persona surfaces. */
		agents?: RailAgent[];
		selectedAgentId?: string;
		/** Open the post drawer — parent owns it. */
		onOpenPost: (post: CalendarPost) => void;
		/** Approve one draft (schedule it). Enables inline ✓ and Approve-all. */
		onApprove?: (post: CalendarPost) => void | Promise<void>;
		/** Open the generation composer prefilled for this YYYY-MM-DD. */
		onGenerateForDate?: (dateStr: string) => void;
		/** localStorage key for the Day/Week/Month choice. */
		storageKey?: string;
	}

	let {
		posts,
		agents = [],
		selectedAgentId = $bindable(''),
		onOpenPost,
		onApprove,
		onGenerateForDate,
		storageKey = 'pg-cal-view'
	}: Props = $props();

	let showRail = $derived(agents.length > 1);

	// ── View + cursor state ────────────────────────────────────────────────
	let calendarView = $state<'day' | 'week' | 'month'>('month');
	let currentYear = $state(new Date().getFullYear());
	let currentMonth = $state(new Date().getMonth()); // 0-indexed
	let cursorDay = $state(new Date().getDate());
	let selectedDay = $state<number | null>(null); // month view's day modal

	onMount(() => {
		const saved = localStorage.getItem(storageKey);
		if (saved === 'day' || saved === 'week' || saved === 'month') calendarView = saved;
	});

	function setView(v: 'day' | 'week' | 'month') {
		calendarView = v;
		selectedDay = null;
		try {
			localStorage.setItem(storageKey, v);
		} catch {
			/* private mode */
		}
	}

	// ── Date helpers ───────────────────────────────────────────────────────
	const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const MONTHS = [
		'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December'
	];
	const WEEKDAYS_FULL = [
		'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
	];

	function fmtDate(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	const todayStr = fmtDate(new Date());

	let anchorDate = $derived(new Date(currentYear, currentMonth, cursorDay));

	let weekDates = $derived.by(() => {
		const monday = new Date(anchorDate);
		monday.setDate(anchorDate.getDate() - ((anchorDate.getDay() + 6) % 7));
		return Array.from({ length: 7 }, (_, i) => {
			const d = new Date(monday);
			d.setDate(monday.getDate() + i);
			return d;
		});
	});

	let toolbarLabel = $derived.by(() => {
		if (calendarView === 'day') {
			return `${WEEKDAYS_FULL[anchorDate.getDay()]}, ${MONTHS[anchorDate.getMonth()]} ${anchorDate.getDate()}, ${anchorDate.getFullYear()}`;
		}
		if (calendarView === 'week') {
			const start = weekDates[0];
			const end = weekDates[6];
			const s = `${MONTHS[start.getMonth()].slice(0, 3)} ${start.getDate()}`;
			const e =
				start.getMonth() === end.getMonth()
					? `${end.getDate()}`
					: `${MONTHS[end.getMonth()].slice(0, 3)} ${end.getDate()}`;
			return `${s} – ${e}, ${end.getFullYear()}`;
		}
		return `${MONTHS[currentMonth]} ${currentYear}`;
	});

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
		for (let i = 0; i < firstDay; i++) cells.push({ day: null, isToday: false, dateStr: '' });
		for (let d = 1; d <= daysInMonth; d++) {
			const mm = String(currentMonth + 1).padStart(2, '0');
			const dd = String(d).padStart(2, '0');
			const dateStr = `${currentYear}-${mm}-${dd}`;
			cells.push({ day: d, isToday: dateStr === todayStr, dateStr });
		}
		while (cells.length % 7 !== 0) cells.push({ day: null, isToday: false, dateStr: '' });
		return cells;
	});

	// ── Navigation ─────────────────────────────────────────────────────────
	function prevMonth() {
		if (currentMonth === 0) {
			currentMonth = 11;
			currentYear--;
		} else {
			currentMonth--;
		}
		cursorDay = 1;
		selectedDay = null;
	}

	function nextMonth() {
		if (currentMonth === 11) {
			currentMonth = 0;
			currentYear++;
		} else {
			currentMonth++;
		}
		cursorDay = 1;
		selectedDay = null;
	}

	function shiftCursor(days: number) {
		const d = new Date(currentYear, currentMonth, cursorDay + days);
		currentYear = d.getFullYear();
		currentMonth = d.getMonth();
		cursorDay = d.getDate();
		selectedDay = null;
	}

	function goPrev() {
		if (calendarView === 'month') prevMonth();
		else shiftCursor(calendarView === 'week' ? -7 : -1);
	}

	function goNext() {
		if (calendarView === 'month') nextMonth();
		else shiftCursor(calendarView === 'week' ? 7 : 1);
	}

	function goToday() {
		const t = new Date();
		currentYear = t.getFullYear();
		currentMonth = t.getMonth();
		cursorDay = t.getDate();
		selectedDay = null;
	}

	function openDayView(d: Date) {
		currentYear = d.getFullYear();
		currentMonth = d.getMonth();
		cursorDay = d.getDate();
		setView('day');
	}

	// ── Jump-to-date dropdown ──────────────────────────────────────────────
	let showDatePicker = $state(false);
	let pickerYear = $state(currentYear);
	let pickerMonth = $state(currentMonth);
	let pickerDay = $state(1);

	let pickerYears = $derived.by(() => {
		const base = new Date().getFullYear();
		const years = [];
		for (let y = base - 5; y <= base + 5; y++) years.push(y);
		return years;
	});

	let pickerDays = $derived.by(() => {
		const total = getDaysInMonth(pickerYear, pickerMonth);
		return Array.from({ length: total }, (_, i) => i + 1);
	});

	function capPickerDay() {
		const maxDays = getDaysInMonth(pickerYear, pickerMonth);
		if (pickerDay > maxDays) pickerDay = maxDays;
	}

	function toggleDatePicker() {
		showDatePicker = !showDatePicker;
		if (showDatePicker) {
			pickerYear = currentYear;
			pickerMonth = currentMonth;
			pickerDay = cursorDay;
		}
	}

	function applyDatePicker() {
		currentYear = pickerYear;
		currentMonth = pickerMonth;
		cursorDay = pickerDay;
		selectedDay = calendarView === 'month' ? pickerDay : null;
		showDatePicker = false;
	}

	function pickToday() {
		goToday();
		showDatePicker = false;
	}

	// ── Filtering: rail (persona) + summary chips (status group) ──────────
	// The status chips group real statuses into the four states users think in.
	const STATUS_GROUPS: Record<string, string[]> = {
		published: ['published', 'partial'],
		scheduled: ['scheduled', 'publishing'],
		draft: ['draft'],
		failed: ['failed', 'rejected']
	};
	let statusChip = $state<'all' | 'published' | 'scheduled' | 'draft' | 'failed'>('all');

	function toggleChip(chip: typeof statusChip) {
		statusChip = statusChip === chip ? 'all' : chip;
	}

	let agentFiltered = $derived(
		posts.filter((p) => p.date && (!selectedAgentId || p.agentId === selectedAgentId))
	);

	let filteredPosts = $derived(
		statusChip === 'all'
			? agentFiltered
			: agentFiltered.filter((p) => STATUS_GROUPS[statusChip].includes(p.status))
	);

	function getPostsForDate(dateStr: string) {
		return filteredPosts.filter((p) => p.date === dateStr);
	}

	function postsForDateSorted(dateStr: string) {
		return getPostsForDate(dateStr).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
	}

	let dayViewPosts = $derived(postsForDateSorted(fmtDate(anchorDate)));

	let selectedDayPosts = $derived.by(() => {
		if (selectedDay === null) return [];
		const mm = String(currentMonth + 1).padStart(2, '0');
		const dd = String(selectedDay).padStart(2, '0');
		return postsForDateSorted(`${currentYear}-${mm}-${dd}`);
	});

	// ── Analytics summary for the visible range ────────────────────────────
	// The calendar doubles as the analytics surface: what's live, what's
	// waiting, and how the live posts performed — for exactly the dates on
	// screen, honoring the persona filter (but NOT the status chips, since the
	// strip is what drives them).
	let inRange = $derived.by(() => {
		if (calendarView === 'day') {
			const d = fmtDate(anchorDate);
			return (dateStr: string) => dateStr === d;
		}
		if (calendarView === 'week') {
			const set = new Set(weekDates.map(fmtDate));
			return (dateStr: string) => set.has(dateStr);
		}
		const prefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
		return (dateStr: string) => dateStr.startsWith(prefix);
	});

	let rangeStats = $derived.by(() => {
		const s = {
			published: 0,
			scheduled: 0,
			draft: 0,
			failed: 0,
			views: 0,
			likes: 0,
			comments: 0
		};
		for (const p of agentFiltered) {
			if (!inRange(p.date)) continue;
			if (STATUS_GROUPS.published.includes(p.status)) {
				s.published++;
				s.views += p.analytics?.views ?? 0;
				s.likes += p.analytics?.likes ?? 0;
				s.comments += p.analytics?.comments ?? 0;
			} else if (STATUS_GROUPS.scheduled.includes(p.status)) s.scheduled++;
			else if (p.status === 'draft') s.draft++;
			else if (STATUS_GROUPS.failed.includes(p.status)) s.failed++;
		}
		return s;
	});

	function fmtNum(v: number): string {
		if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
		if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
		return String(v);
	}

	// ── Display bridges ────────────────────────────────────────────────────
	const STATUS_COLORS: Record<string, string> = {
		scheduled: 'var(--accent)',
		draft: 'var(--warning)',
		publishing: 'var(--cyan)',
		published: 'var(--success)',
		partial: 'var(--gold)',
		rejected: 'var(--rose)',
		failed: 'var(--error)'
	};

	function getPostDisplay(p: CalendarPost) {
		return sharedGetPostDisplay({ content: p.text, publication_results: p.publication_results });
	}

	function getPostThumb(p: CalendarPost): string | null {
		const d = getPostDisplay(p);
		if (d.posterUrl) return d.posterUrl;
		if (d.mediaUrl && d.mediaType !== 'video') return d.mediaUrl;
		return null;
	}

	function postErrorHint(p: CalendarPost): string | undefined {
		if (p.status !== 'failed' && p.status !== 'partial') return undefined;
		return getPostErrorSummary(p) || 'Publish failed — open the post for details';
	}

	// ── Inline approve (the golden action for approval-mode autopilot) ─────
	let approvingIds = $state<Set<string>>(new Set());
	let approvingAll = $state(false);

	async function approveOne(post: CalendarPost) {
		if (!onApprove || approvingIds.has(post.id)) return;
		approvingIds = new Set(approvingIds).add(post.id);
		try {
			await onApprove(post);
		} finally {
			const next = new Set(approvingIds);
			next.delete(post.id);
			approvingIds = next;
		}
	}

	async function approveAllDrafts(list: CalendarPost[]) {
		if (!onApprove || approvingAll) return;
		approvingAll = true;
		try {
			for (const p of list.filter((x) => x.status === 'draft')) {
				await onApprove(p);
			}
		} finally {
			approvingAll = false;
		}
	}
</script>

<!-- Shared inline icons. Snippets rather than emoji so they inherit currentColor,
     scale with the surrounding text, and stay invisible to screen readers. -->
{#snippet iconEye()}
	<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
{/snippet}
{#snippet iconHeart()}
	<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg>
{/snippet}
{#snippet iconComment()}
	<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>
{/snippet}
{#snippet iconPlus()}
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
{/snippet}
{#snippet iconCheck()}
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
{/snippet}
{#snippet iconNote()}
	<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v5h5" /><path d="M8 13h8M8 17h5" /></svg>
{/snippet}

<!-- ── Toolbar: date nav + Today (left) · view switch (right) ── -->
<div class="cal-toolbar">
	<div class="toolbar-left">
		<button class="nav-btn" onclick={goPrev} aria-label="Previous {calendarView}">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
		</button>
		<div class="month-selector-wrapper">
			<button
				class="month-selector-btn"
				onclick={toggleDatePicker}
				aria-label="Jump to a specific date. Currently showing {toolbarLabel}"
				aria-expanded={showDatePicker}
			>
				<span>{toolbarLabel}</span>
				<svg class="dropdown-icon" class:open={showDatePicker} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
			</button>
			{#if showDatePicker}
				<div class="datepicker-backdrop" onclick={() => (showDatePicker = false)} role="presentation"></div>
				<div class="datepicker-dropdown">
					<h4 class="datepicker-title">Jump to Date</h4>
					<div class="datepicker-fields">
						<div class="datepicker-field">
							<label for="cal-picker-month">Month</label>
							<select id="cal-picker-month" bind:value={pickerMonth} onchange={capPickerDay}>
								{#each MONTHS as month, index}
									<option value={index}>{month}</option>
								{/each}
							</select>
						</div>
						<div class="datepicker-field">
							<label for="cal-picker-year">Year</label>
							<select id="cal-picker-year" bind:value={pickerYear} onchange={capPickerDay}>
								{#each pickerYears as year}
									<option value={year}>{year}</option>
								{/each}
							</select>
						</div>
						<div class="datepicker-field">
							<label for="cal-picker-day">Day</label>
							<select id="cal-picker-day" bind:value={pickerDay}>
								{#each pickerDays as day}
									<option value={day}>{day}</option>
								{/each}
							</select>
						</div>
					</div>
					<div class="datepicker-actions">
						<button class="btn-ghost btn-sm" onclick={pickToday}>Today</button>
						<button class="btn-primary btn-sm" onclick={applyDatePicker}>Apply</button>
					</div>
				</div>
			{/if}
		</div>
		<button class="nav-btn" onclick={goNext} aria-label="Next {calendarView}">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
		</button>
		<button class="today-btn" onclick={goToday}>Today</button>
	</div>

	<div class="view-toggle" role="radiogroup" aria-label="Calendar view">
		<button class="view-btn" class:active={calendarView === 'day'} role="radio" aria-checked={calendarView === 'day'} onclick={() => setView('day')}>Day</button>
		<button class="view-btn" class:active={calendarView === 'week'} role="radio" aria-checked={calendarView === 'week'} onclick={() => setView('week')}>Week</button>
		<button class="view-btn" class:active={calendarView === 'month'} role="radio" aria-checked={calendarView === 'month'} onclick={() => setView('month')}>Month</button>
	</div>
</div>

<!-- ── Analytics strip: range metrics that double as the status filter ── -->
<div class="summary-strip" role="group" aria-label="Range summary and status filter">
	<button class="stat-chip" class:on={statusChip === 'published'} aria-pressed={statusChip === 'published'} onclick={() => toggleChip('published')}>
		<span class="stat-dot" style="background: var(--success)" aria-hidden="true"></span>
		<strong>{rangeStats.published}</strong> published
		{#if rangeStats.views > 0}
			<span class="stat-metric">{@render iconEye()} <span class="sr-only">views</span>{fmtNum(rangeStats.views)}</span>
		{/if}
		{#if rangeStats.likes > 0}
			<span class="stat-metric">{@render iconHeart()} <span class="sr-only">likes</span>{fmtNum(rangeStats.likes)}</span>
		{/if}
	</button>
	<button class="stat-chip" class:on={statusChip === 'scheduled'} aria-pressed={statusChip === 'scheduled'} onclick={() => toggleChip('scheduled')}>
		<span class="stat-dot" style="background: var(--accent)" aria-hidden="true"></span>
		<strong>{rangeStats.scheduled}</strong> scheduled
	</button>
	<button class="stat-chip" class:on={statusChip === 'draft'} aria-pressed={statusChip === 'draft'} onclick={() => toggleChip('draft')}>
		<span class="stat-dot" style="background: var(--warning)" aria-hidden="true"></span>
		<strong>{rangeStats.draft}</strong> drafts
	</button>
	{#if rangeStats.failed > 0}
		<button class="stat-chip chip-failed" class:on={statusChip === 'failed'} aria-pressed={statusChip === 'failed'} onclick={() => toggleChip('failed')}>
			<span class="stat-dot" style="background: var(--error)" aria-hidden="true"></span>
			<strong>{rangeStats.failed}</strong> failed
		</button>
	{/if}
	{#if statusChip !== 'all'}
		<button class="stat-clear" onclick={() => (statusChip = 'all')}>Show all</button>
	{/if}
</div>

<div class="calendar-layout">
	{#if showRail}
		<!-- Personas rail: in-page sub-nav (never covers the app's global nav) -->
		<aside class="personas-rail" aria-label="Filter by persona">
			<h3 class="rail-title">Personas</h3>
			<div class="rail-list">
				<button class="agent-item" class:active={!selectedAgentId} aria-pressed={!selectedAgentId} onclick={() => (selectedAgentId = '')}>
					<span class="agent-dot" aria-hidden="true"></span>
					<span class="agent-name">All Personas</span>
				</button>
				{#each agents as agent}
					<button
						class="agent-item"
						class:active={selectedAgentId === agent.id}
						aria-pressed={selectedAgentId === agent.id}
						onclick={() => (selectedAgentId = agent.id)}
					>
						<!-- The dot repeats the persona's brand colour; the name beside it
						     carries the same identity as text, so it's decorative here. -->
						<span class="agent-dot" style="background: {agent.gradient || 'var(--accent)'}" aria-hidden="true"></span>
						<span class="agent-name">{agent.name}</span>
					</button>
				{/each}
			</div>
		</aside>
	{/if}

	<div class="calendar-wrap">
		{#if calendarView === 'month'}
			<div class="day-headers">
				{#each DAYS as day}
					<div class="day-header">{day}</div>
				{/each}
			</div>

			<div class="calendar-grid">
				{#each calendarCells as cell}
					{#if cell.day === null}
						<div class="cell empty"></div>
					{:else}
						{@const dayPosts = postsForDateSorted(cell.dateStr)}
						<div class="cell" class:today={cell.isToday} class:has-posts={dayPosts.length > 0}>
							<div class="cell-top">
								<button
									class="cell-day-btn"
									onclick={() => (selectedDay = cell.day)}
									title="Open this day's posts"
									aria-label="{MONTHS[currentMonth]} {cell.day}, {currentYear}{cell.isToday
										? ' (today)'
										: ''} — {dayPosts.length} post{dayPosts.length === 1 ? '' : 's'}"
								>
									{cell.day}
								</button>
								{#if onGenerateForDate && cell.dateStr >= todayStr}
									<button
										class="cell-add"
										onclick={() => onGenerateForDate(cell.dateStr)}
										title="Generate a post for this day"
										aria-label="Generate a post for {cell.dateStr}"
									>{@render iconPlus()}</button>
								{/if}
							</div>
							{#if dayPosts.length > 0}
								<div class="cell-events">
									{#each dayPosts.slice(0, 3) as post}
										{@const views = post.analytics?.views ?? 0}
										<button
											class="event-block"
											onclick={() => onOpenPost(post)}
											title={postErrorHint(post)}
										>
											<!-- Status is carried by the colour stripe visually; the sr-only
											     text below is the non-colour equivalent. -->
											<div class="event-status-bar" style="background: {STATUS_COLORS[post.status]}" aria-hidden="true"></div>
											<div class="event-content">
												<span class="sr-only">{post.status} · {post.time}</span>
												<span class="event-agent">
													{post.agentName.split(' ')[0]}
													{#if views > 0}<span class="event-views">{@render iconEye()} <span class="sr-only">views</span>{fmtNum(views)}</span>{/if}
												</span>
												<span class="event-text">{getPostDisplay(post).text}</span>
											</div>
										</button>
									{/each}
									{#if dayPosts.length > 3}
										<button
											class="event-overflow"
											onclick={() => (selectedDay = cell.day)}
											aria-label="Show all {dayPosts.length} posts for {MONTHS[currentMonth]} {cell.day}"
										>
											+{dayPosts.length - 3} more
										</button>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				{/each}
			</div>

			<!-- Mobile fallback: tappable list (month grid is unusable at phone width) -->
			<div class="mobile-list">
				<h3 class="mobile-list-title">Upcoming Posts</h3>
				{#each [...filteredPosts].sort((a, b) => a.date.localeCompare(b.date)) as post}
					{@const thumb = getPostThumb(post)}
					<button class="mobile-post-item" onclick={() => onOpenPost(post)}>
						{#if thumb}
							<img class="mobile-post-thumb" src={thumb} alt="" width="64" height="80" loading="lazy" />
						{:else}
							<div class="mobile-post-thumb mobile-post-thumb-empty">{@render iconNote()}</div>
						{/if}
						<div class="mobile-post-body">
							<div class="mobile-post-date">
								{post.date} · {post.time}
								<span class="mobile-post-status status-{post.status}" title={postErrorHint(post)}>{post.status}</span>
							</div>
							<div class="mobile-post-text">{getPostDisplay(post).text}</div>
							<div class="mobile-post-meta">
								<span class="mobile-post-agent">{post.agentName}</span>
								<div class="mobile-post-platforms">
									{#each post.platforms as p}
										<span class="platform-tag" style="color: {platformColor(p)}">{p}</span>
									{/each}
								</div>
							</div>
						</div>
					</button>
				{:else}
					<p class="mobile-list-empty">No posts match the current filters.</p>
				{/each}
			</div>
		{:else if calendarView === 'week'}
			<div class="week-grid">
				{#each weekDates as wd, i}
					{@const dateStr = fmtDate(wd)}
					{@const dayPosts = postsForDateSorted(dateStr)}
					<div class="week-col" class:today={dateStr === todayStr}>
						<div class="week-col-head">
							<button
								class="week-head-btn"
								onclick={() => openDayView(wd)}
								title="Open day view"
								aria-label="Open day view for {WEEKDAYS_FULL[wd.getDay()]}, {MONTHS[
									wd.getMonth()
								]} {wd.getDate()}, {wd.getFullYear()} — {dayPosts.length} post{dayPosts.length === 1
									? ''
									: 's'}"
							>
								<span class="week-dow">{DAYS[i]}</span>
								<span class="week-num">{wd.getDate()}</span>
							</button>
							{#if onGenerateForDate && dateStr >= todayStr}
								<button
									class="cell-add week-add"
									onclick={() => onGenerateForDate(dateStr)}
									title="Generate a post for this day"
									aria-label="Generate a post for {dateStr}"
								>{@render iconPlus()}</button>
							{/if}
						</div>
						<div class="week-col-body">
							{#each dayPosts as post}
								{@const views = post.analytics?.views ?? 0}
								<div class="event-block week-event">
									<div class="event-status-bar" style="background: {STATUS_COLORS[post.status]}" aria-hidden="true"></div>
									<button class="event-main" onclick={() => onOpenPost(post)} title={postErrorHint(post)}>
										<span class="sr-only">{post.status}</span>
										<span class="event-time">{post.time}</span>
										<span class="event-agent">
											{post.agentName.split(' ')[0]}
											{#if views > 0}<span class="event-views">{@render iconEye()} <span class="sr-only">views</span>{fmtNum(views)}</span>{/if}
										</span>
										<span class="event-text">{getPostDisplay(post).text}</span>
									</button>
									{#if post.status === 'draft' && onApprove}
										<button
											class="event-approve"
											onclick={() => approveOne(post)}
											disabled={approvingIds.has(post.id)}
											title="Approve — publishes at its scheduled time"
											aria-label="Approve draft at {post.time} by {post.agentName} — publishes at its scheduled time"
										>
											{#if approvingIds.has(post.id)}…{:else}{@render iconCheck()}{/if}
										</button>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="day-view">
				{#if onGenerateForDate && fmtDate(anchorDate) >= todayStr}
					<button class="day-generate" onclick={() => onGenerateForDate(fmtDate(anchorDate))}>
						{@render iconPlus()}
						Generate a post for this day
					</button>
				{/if}
				{#each dayViewPosts as post}
					{@const thumb = getPostThumb(post)}
					{@const a = post.analytics}
					<div class="day-post">
						<button class="day-post-main" onclick={() => onOpenPost(post)} title={postErrorHint(post)}>
							<span class="day-post-time">{post.time}</span>
							<!-- Colour-only status stripe; .status-badge below states it in words. -->
							<div class="day-post-bar" style="background: {STATUS_COLORS[post.status]}" aria-hidden="true"></div>
							{#if thumb}
								<img class="day-post-thumb" src={thumb} alt="" width="56" height="56" loading="lazy" />
							{/if}
							<div class="day-post-body">
								<div class="day-post-top">
									<span class="day-post-agent">{post.agentName}</span>
									<span
										class="status-badge"
										style="color: {STATUS_COLORS[post.status]}; border-color: {STATUS_COLORS[post.status]}"
									>{post.status}</span>
								</div>
								<p class="day-post-text">{getPostDisplay(post).text}</p>
								<div class="day-post-foot">
									<div class="day-post-platforms">
										{#each post.platforms as p}
											<span class="platform-tag" style="color: {platformColor(p)}">{p}</span>
										{/each}
									</div>
									{#if a && (a.views || a.likes || a.comments)}
										<div class="day-post-metrics">
											<span>{@render iconEye()} <span class="sr-only">views</span>{fmtNum(a.views ?? 0)}</span>
											<span>{@render iconHeart()} <span class="sr-only">likes</span>{fmtNum(a.likes ?? 0)}</span>
											<span>{@render iconComment()} <span class="sr-only">comments</span>{fmtNum(a.comments ?? 0)}</span>
										</div>
									{/if}
								</div>
							</div>
						</button>
						{#if post.status === 'draft' && onApprove}
							<button
								class="day-approve"
								onclick={() => approveOne(post)}
								disabled={approvingIds.has(post.id)}
								title="Approve — publishes at its scheduled time"
								aria-label="Approve draft at {post.time} by {post.agentName} — publishes at its scheduled time"
							>
								{#if approvingIds.has(post.id)}
									Approving…
								{:else}
									{@render iconCheck()}
									Approve
								{/if}
							</button>
						{/if}
					</div>
				{:else}
					<div class="day-empty">
						<p>Nothing scheduled for {toolbarLabel}.</p>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<!-- ── Day modal (month view): all of one day's posts + approve-all ── -->
{#if selectedDay !== null}
	<div class="modal-backdrop" onclick={() => (selectedDay = null)} role="presentation">
		<!-- The click handler is a backdrop-dismiss guard, not an interaction, so
		     there is no keyboard equivalent to add. -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="day-modal"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			aria-labelledby="cal-day-modal-title"
			tabindex="-1"
		>
			<div class="modal-header">
				<h3 id="cal-day-modal-title">{MONTHS[currentMonth]} {selectedDay}, {currentYear}</h3>
				<button class="modal-close" onclick={() => (selectedDay = null)} aria-label="Close modal">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
				</button>
			</div>
			<div class="modal-body">
				{#if selectedDayPosts.length === 0}
					<div class="panel-empty">
						<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
						<p>No content scheduled or published for this day.</p>
					</div>
				{:else}
					<div class="modal-posts-list">
						{#each selectedDayPosts as post}
							{@const dp = getPostDisplay(post)}
							{@const thumb = getPostThumb(post)}
							<button class="modal-post-card" onclick={() => onOpenPost(post)}>
								<div class="post-card-status" style="background: {STATUS_COLORS[post.status] || 'var(--accent)'}" aria-hidden="true"></div>
								{#if thumb}
									<img class="post-card-thumb" src={thumb} alt="" width="52" height="52" loading="lazy" />
								{/if}
								<div class="post-card-body">
									<div class="post-card-time-row">
										<span class="post-card-time">{post.time}</span>
										<span
											class="status-badge"
											style="color: {STATUS_COLORS[post.status]}; border-color: {STATUS_COLORS[post.status]}"
											title={postErrorHint(post)}
										>{post.status}</span>
									</div>
									<p class="post-card-text">{dp.text}</p>
									<div class="post-card-footer">
										<span class="post-card-agent">{post.agentName}</span>
										<div class="post-card-platforms">
											{#each post.platforms as p}
												<!-- Platform is encoded by colour alone here, so each dot
												     carries the platform name as its accessible name. -->
												<span class="platform-dot" style="background: {platformColor(p)}" title={p} role="img" aria-label={p}></span>
											{/each}
										</div>
									</div>
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>
			<div class="modal-footer">
				<span style="display: inline-flex; gap: 0.5rem;">
					{#if onApprove && selectedDayPosts.some((p) => p.status === 'draft')}
						<button
							class="btn-primary btn-sm"
							onclick={() => approveAllDrafts(selectedDayPosts)}
							disabled={approvingAll}
						>
							{#if approvingAll}
								Approving…
							{:else}
								{@render iconCheck()}
								Approve all drafts ({selectedDayPosts.filter((p) => p.status === 'draft').length})
							{/if}
						</button>
					{/if}
					<button class="btn-ghost btn-sm" onclick={() => (selectedDay = null)}>Close</button>
				</span>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ── Toolbar ── */
	.cal-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 0.9rem;
	}

	.toolbar-left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.nav-btn {
		width: 44px;
		height: 44px;
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

	.today-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		min-width: 44px;
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		background: var(--surface);
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 600;
		padding: 0.45rem 0.8rem;
		cursor: pointer;
		margin-left: 0.25rem;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.today-btn:hover {
		border-color: var(--accent-mid);
		color: var(--text);
	}

	/* Lifts the jump-to-date popover above ordinary page content while staying
	   below the app nav, drawers and modals. The 1/2 values on the backdrop and
	   dropdown below are LOCAL to this stacking context, not global scale values. */
	.month-selector-wrapper {
		position: relative;
		display: inline-block;
		z-index: var(--z-header);
	}

	.month-selector-btn {
		min-height: 44px;
		font-family: var(--font-display);
		font-size: var(--text-lg);
		font-weight: var(--weight-semi);
		color: var(--text);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		padding: 0.5rem 1rem;
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

	.datepicker-backdrop {
		position: fixed;
		inset: 0;
		z-index: 1;
		background: transparent;
	}

	.datepicker-dropdown {
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%) translateY(8px);
		z-index: 2;
		min-width: 320px;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-lg);
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
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
		min-height: 44px;
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

	.view-toggle {
		display: inline-flex;
		gap: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		padding: 2px;
	}

	.view-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		min-width: 44px;
		padding: 0.5rem 0.85rem;
		background: transparent;
		border: none;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		border-radius: 4px;
		transition: all 0.2s ease;
	}

	.view-btn:hover {
		color: var(--text);
	}

	.view-btn.active {
		background: var(--accent);
		color: #fff;
	}

	/* ── Analytics strip / status chips ── */
	.summary-strip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 1.1rem;
	}

	.stat-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 44px;
		min-width: 44px;
		padding: 0.4rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: var(--text-xs);
		color: var(--text-muted);
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s,
			background 0.2s;
	}

	.stat-chip strong {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	.stat-chip:hover {
		border-color: var(--accent-mid);
	}

	.stat-chip.on {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--text);
	}

	.stat-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.stat-metric {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}

	.chip-failed strong {
		color: var(--error);
	}

	.stat-clear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		min-width: 44px;
		border: none;
		background: transparent;
		color: var(--accent-text);
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
		padding: 0.4rem 0.5rem;
	}

	/* ── Layout: rail + calendar ── */
	.calendar-layout {
		display: flex;
		gap: 1.5rem;
		align-items: flex-start;
	}

	.personas-rail {
		flex: 0 0 190px;
		position: sticky;
		top: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-height: calc(100dvh - 140px);
		overflow-y: auto;
	}

	.rail-title {
		margin: 0;
		padding: 0.35rem 0.6rem 0;
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		color: var(--text-dim);
	}

	.rail-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.agent-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 44px;
		padding: 0.55rem 0.6rem;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-xs);
		cursor: pointer;
		color: var(--text-muted);
		font-size: var(--text-sm);
		transition:
			background 0.2s,
			color 0.2s,
			border-color 0.2s;
		text-align: left;
		font-weight: 500;
	}

	.agent-item:hover {
		background: var(--surface-3);
		color: var(--text);
	}

	.agent-item.active {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--accent);
	}

	.agent-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		background: var(--text-dim);
	}

	.agent-name {
		flex: 1;
		min-width: 0;
		text-overflow: ellipsis;
		overflow: hidden;
		white-space: nowrap;
	}

	.calendar-wrap {
		flex: 1;
		min-width: 0;
	}

	/* ── Month grid ── */
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
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		padding: 0.4rem 0.5rem 0.5rem;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.3rem;
		/* Taller than before so a 44px day-number row still leaves room for two
		   event chips — the touch-target floor has to come out of somewhere. */
		min-height: 140px;
		color: var(--text);
		overflow: hidden;
		transition: border-color 0.2s;
	}

	.cell.empty {
		background: transparent;
		border-color: transparent;
	}

	.cell:not(.empty):hover {
		border-color: var(--border-hover);
	}

	.cell.today {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent-mid);
	}

	.cell-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.25rem;
		/* Bounds the 44px targets inside it so neither bleeds over the events list. */
		min-height: 44px;
	}

	.cell-day-btn {
		display: inline-flex;
		align-items: center;
		min-width: 44px;
		min-height: 44px;
		border: none;
		background: transparent;
		font: inherit;
		font-size: var(--text-sm);
		font-weight: var(--weight-semi);
		font-variant-numeric: tabular-nums;
		color: var(--text);
		cursor: pointer;
		padding: 0.1rem 0.35rem;
		border-radius: var(--radius-xs);
	}

	.cell-day-btn:hover {
		background: var(--surface-2);
		color: var(--accent);
	}

	.cell.today .cell-day-btn {
		color: var(--accent);
	}

	/* Hover-revealed one-click generate for a specific day */
	.cell-add {
		position: relative;
		width: 22px;
		height: 22px;
		flex: none;
		border-radius: var(--radius-full);
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-muted);
		font-size: 0.9rem;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		opacity: 0;
		transition:
			opacity 0.15s,
			border-color 0.15s,
			color 0.15s;
	}

	/* The visible affordance stays a 22px dot (a 44px circle would swallow a
	   narrow month cell); this invisible overlay supplies the 44×44 tap target.
	   .cell-top's 44px min-height keeps it from covering any event chip. */
	.cell-add::before {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 44px;
		height: 44px;
	}

	.cell:hover .cell-add,
	.cell-add:focus-visible,
	.week-col:hover .cell-add {
		opacity: 1;
	}

	.cell-add:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.cell-events {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		width: 100%;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.event-block {
		display: flex;
		align-items: stretch;
		gap: 0;
		min-height: 44px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		overflow: hidden;
		cursor: pointer;
		transition:
			border-color 0.2s,
			transform 0.2s;
		font-size: var(--text-xs);
		padding: 0;
		text-align: left;
		font: inherit;
		color: inherit;
		width: 100%;
	}

	.event-block:hover {
		border-color: var(--accent-mid);
		transform: translateY(-1px);
	}

	.event-status-bar {
		width: 3px;
		flex-shrink: 0;
	}

	.event-content {
		padding: 0.35rem 0.45rem;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		flex: 1;
	}

	.event-agent {
		font-weight: 600;
		color: var(--text-muted);
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.3rem;
	}

	.event-views {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		text-transform: none;
		letter-spacing: 0;
		color: var(--success-text);
		font-variant-numeric: tabular-nums;
	}

	.event-text {
		color: var(--text);
		font-size: var(--text-xs);
		white-space: nowrap;
		text-overflow: ellipsis;
		overflow: hidden;
	}

	.event-time {
		font-family: var(--font-mono);
		font-size: 0.65rem;
		color: var(--text-dim);
	}

	.event-overflow {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		border: none;
		background: transparent;
		padding: 0.3rem 0.45rem;
		font-size: 0.65rem;
		color: var(--text-dim);
		font-weight: 600;
		text-align: center;
		cursor: pointer;
		border-radius: var(--radius-xs);
	}

	.event-overflow:hover {
		color: var(--accent);
		background: var(--surface-2);
	}

	/* ── Week view ── */
	.week-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
	}

	.week-col {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		min-height: 440px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.week-col.today {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent-mid);
	}

	.week-col-head {
		display: flex;
		align-items: center;
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
		padding-right: 0.35rem;
	}

	.week-head-btn {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		min-height: 44px;
		padding: 0.55rem 0;
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--text);
		font: inherit;
	}

	.week-head-btn:hover .week-num {
		color: var(--accent);
	}

	.week-dow {
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		color: var(--text-dim);
	}

	.week-num {
		font-size: var(--text-md);
		font-weight: var(--weight-semi);
		font-variant-numeric: tabular-nums;
	}

	.week-col.today .week-num {
		color: var(--accent);
	}

	.week-col-body {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.4rem;
		flex: 1;
		overflow-y: auto;
	}

	/* Week event = chip wrapper (div) + main button + optional inline approve,
	   so approve is one click without nesting buttons. */
	.week-event {
		cursor: default;
	}

	.event-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.1rem;
		min-height: 44px;
		padding: 0.35rem 0.45rem;
		background: transparent;
		border: none;
		text-align: left;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.event-approve {
		position: relative;
		flex-shrink: 0;
		align-self: center;
		width: 22px;
		height: 22px;
		margin-right: 0.3rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--success);
		background: transparent;
		color: var(--success-text);
		font-size: 0.75rem;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	/* Same trick as .cell-add: keep the 22px pip, expand the target to 44×44.
	   The parent chip is min-height 44 so nothing outside the chip is covered. */
	.event-approve::before {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 44px;
		height: 44px;
	}

	.event-approve:hover:not(:disabled) {
		background: var(--success);
		color: #fff;
	}

	.event-approve:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	/* ── Day view ── */
	.day-view {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.day-generate {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		min-height: 44px;
		border: 1px dashed var(--border-strong);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 600;
		padding: 0.5rem 0.9rem;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.day-generate:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.day-post {
		display: flex;
		align-items: stretch;
		gap: 0.6rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.9rem 1rem;
		transition:
			border-color 0.2s,
			transform 0.2s;
	}

	.day-post:hover {
		border-color: var(--accent-mid);
		transform: translateY(-1px);
	}

	.day-post-main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: stretch;
		gap: 0.9rem;
		background: transparent;
		border: none;
		padding: 0;
		text-align: left;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.day-post-time {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--text-muted);
		flex: 0 0 48px;
		padding-top: 2px;
	}

	.day-post-bar {
		width: 3px;
		border-radius: 2px;
		flex-shrink: 0;
	}

	.day-post-thumb {
		width: 56px;
		height: 56px;
		border-radius: 8px;
		object-fit: cover;
		border: 1px solid var(--border);
		flex-shrink: 0;
		align-self: center;
	}

	.day-post-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.day-post-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.day-post-agent {
		font-size: var(--text-xs);
		font-weight: var(--weight-semi);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-muted);
	}

	.day-post-text {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text);
		line-height: var(--leading-snug);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.day-post-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.day-post-platforms {
		display: flex;
		gap: 0.5rem;
	}

	.day-post-metrics {
		display: flex;
		gap: 0.7rem;
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}

	.day-post-metrics span {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.day-approve {
		flex-shrink: 0;
		align-self: center;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		min-height: 44px;
		min-width: 44px;
		border: 1px solid var(--success);
		background: transparent;
		color: var(--success-text);
		font-size: var(--text-xs);
		font-weight: 700;
		padding: 0.45rem 0.75rem;
		border-radius: var(--radius-xs);
		cursor: pointer;
		white-space: nowrap;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.day-approve:hover:not(:disabled) {
		background: var(--success);
		color: #fff;
	}

	.day-approve:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.day-empty {
		padding: 2.5rem 1rem;
		text-align: center;
		color: var(--text-dim);
		border: 1px dashed var(--border);
		border-radius: var(--radius-sm);
	}

	.day-empty p {
		margin: 0;
		font-size: var(--text-sm);
	}

	.status-badge {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid currentColor;
		background: transparent;
	}

	.platform-tag {
		font-size: var(--text-xs);
		font-weight: var(--weight-semi);
		text-transform: capitalize;
	}

	/* ── Day modal ── */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.75);
		backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-modal);
		padding: 1.5rem;
	}

	.day-modal {
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		width: 100%;
		max-width: 550px;
		max-height: 80dvh;
		display: flex;
		flex-direction: column;
		box-shadow:
			var(--shadow-lg),
			0 20px 25px -5px rgba(0, 0, 0, 0.3);
		overflow: hidden;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
	}

	.modal-header h3 {
		font-size: var(--text-md);
		font-family: var(--font-display);
		font-weight: 600;
		margin: 0;
		color: var(--text);
	}

	.modal-close {
		width: 44px;
		height: 44px;
		flex: none;
		border-radius: var(--radius-full);
		border: none;
		background: var(--surface-3);
		color: var(--text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition:
			background 0.2s,
			color 0.2s;
	}

	.modal-close:hover {
		color: var(--text);
		background: var(--border-strong);
	}

	.modal-body {
		padding: 1.5rem;
		overflow-y: auto;
		flex: 1;
	}

	.modal-footer {
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--border);
		background: var(--surface-2);
		display: flex;
		justify-content: flex-end;
	}

	.panel-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 1.5rem 0;
		color: var(--text-dim);
		font-size: var(--text-sm);
		text-align: center;
	}

	.modal-posts-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.modal-post-card {
		display: flex;
		align-items: stretch;
		gap: 0.6rem;
		text-align: left;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		cursor: pointer;
		width: 100%;
		padding: 0;
		font: inherit;
		color: inherit;
		transition:
			transform 0.2s,
			border-color 0.2s;
	}

	.modal-post-card:hover {
		transform: translateY(-2px);
		border-color: var(--accent-mid);
	}

	.post-card-status {
		width: 4px;
		flex-shrink: 0;
	}

	.post-card-thumb {
		width: 52px;
		height: 52px;
		border-radius: 8px;
		object-fit: cover;
		align-self: center;
		flex-shrink: 0;
		border: 1px solid var(--border);
	}

	.post-card-body {
		padding: 1rem 1.1rem;
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.post-card-time-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.post-card-time {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		color: var(--text-muted);
		font-weight: 500;
	}

	.post-card-text {
		font-size: var(--text-sm);
		color: var(--text);
		margin: 0;
		line-height: var(--leading-relaxed);
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.post-card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		border-top: 1px solid var(--border);
		padding-top: 0.6rem;
	}

	.post-card-agent {
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-weight: 500;
	}

	.post-card-platforms {
		display: flex;
		gap: 4px;
	}

	.platform-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.btn-ghost,
	.btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		min-height: 44px;
		min-width: 44px;
		border-radius: var(--radius-xs);
		padding: 0.45rem 0.85rem;
		font-weight: 600;
		cursor: pointer;
		font-size: var(--text-sm);
	}

	.btn-ghost {
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text);
	}

	.btn-primary {
		background: var(--accent);
		border: 1px solid var(--accent);
		color: #fff;
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.btn-sm {
		font-size: var(--text-xs);
		padding: 0.4rem 0.7rem;
	}

	/* ── Mobile list (month fallback) ── */
	.mobile-list {
		display: none;
	}

	.mobile-post-item {
		display: flex;
		gap: 0.75rem;
		width: 100%;
		text-align: left;
		padding: 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		margin-bottom: 0.5rem;
		cursor: pointer;
		color: inherit;
		font: inherit;
	}

	.mobile-post-item:active {
		border-color: var(--accent-mid);
		background: var(--surface-2);
	}

	.mobile-post-thumb {
		width: 64px;
		height: 80px;
		object-fit: cover;
		border-radius: var(--radius-xs);
		flex-shrink: 0;
	}

	.mobile-post-thumb-empty {
		display: grid;
		place-items: center;
		background: var(--surface-2);
		color: var(--text-dim);
		font-size: 1.25rem;
	}

	.mobile-post-body {
		min-width: 0;
		flex: 1;
	}

	.mobile-post-status {
		margin-left: 0.5rem;
		padding: 1px 7px;
		border-radius: 999px;
		border: 1px solid var(--border);
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	/* Mirrors STATUS_COLORS above, but through the theme tokens so the Brand Theme
	   repaints these too. Text uses the AA `-text` variants; the ring keeps the
	   saturated brand fill. */
	.mobile-post-status.status-draft { color: var(--warning-text); border-color: var(--warning); }
	.mobile-post-status.status-scheduled { color: var(--accent-text); border-color: var(--accent); }
	.mobile-post-status.status-publishing { color: var(--cyan-text); border-color: var(--cyan); }
	.mobile-post-status.status-published { color: var(--success-text); border-color: var(--success); }
	.mobile-post-status.status-partial { color: var(--gold); border-color: var(--gold); }
	.mobile-post-status.status-rejected { color: var(--rose-text); border-color: var(--rose); }
	.mobile-post-status.status-failed { color: var(--error-text); border-color: var(--error); }

	.mobile-list-empty {
		color: var(--text-dim);
		font-size: var(--text-sm);
		text-align: center;
		padding: 1.5rem 0;
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

	.mobile-list-title {
		font-size: var(--text-md);
		font-family: var(--font-display);
		margin: 1rem 0 0.75rem;
	}

	/* ── Responsive ── */
	@media (max-width: 1200px) {
		.personas-rail {
			flex-basis: 170px;
		}
	}

	@media (max-width: 900px) {
		.calendar-layout {
			flex-direction: column;
		}

		.personas-rail {
			position: static;
			flex: none;
			width: 100%;
			max-height: none;
			padding: 0.5rem;
		}

		.rail-title {
			display: none;
		}

		.rail-list {
			flex-direction: row;
			overflow-x: auto;
			gap: 0.4rem;
			padding-bottom: 2px;
		}

		.agent-item {
			flex: 0 0 auto;
		}

		.cal-toolbar {
			justify-content: center;
		}

		/* Touch has no hover — keep the quick-add always visible */
		.cell-add {
			opacity: 1;
		}
	}

	@media (max-width: 768px) {
		.calendar-grid {
			gap: 1px;
		}

		.cell {
			/* 44px header row + one event chip; the grid is replaced by .mobile-list
			   below 640px anyway. */
			min-height: 110px;
			font-size: var(--text-xs);
		}

		.event-agent {
			font-size: 0.6rem;
		}

		.event-text {
			font-size: 0.7rem;
		}
	}

	@media (max-width: 640px) {
		.calendar-grid,
		.day-headers {
			display: none;
		}

		.mobile-list {
			display: block;
		}

		.week-grid {
			grid-template-columns: 1fr;
		}

		.week-col {
			min-height: 0;
		}

		.week-col-head {
			padding-right: 0.5rem;
		}

		.week-head-btn {
			flex-direction: row;
			gap: 0.5rem;
			padding: 0.5rem;
		}
	}
</style>
