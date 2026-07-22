<script lang="ts">
	import { onMount } from 'svelte';
	import type { Agent } from '$lib/types';
	import { showToast } from '$lib/stores/ui.svelte';
	import { Posts, ContentForge, type AutopilotView } from '$lib/services/api';
	import { priceOf } from '$lib/pricing';
	import { page } from '$app/stores';
	import { goto, invalidateAll } from '$app/navigation';
	import GenerationComposer from '$lib/components/generation/GenerationComposer.svelte';
	import type { ComposerSpec } from '$lib/components/generation/types';
	import { startGeneration, finishGeneration, failGeneration } from '$lib/stores/generations.svelte';
	import PostDrawer from '$lib/components/feed/PostDrawer.svelte';
	import { getPostDisplay as sharedGetPostDisplay, getPostErrorSummary } from '$lib/components/feed/postDisplay';
	import { platformColor } from '$lib/platforms';

	interface ScheduledPost {
		id: string;
		agentId: string;
		agentName: string;
		text: string;
		platforms: string[];
		date: string; // YYYY-MM-DD
		time: string;
		status: 'scheduled' | 'draft' | 'published' | 'failed' | 'publishing' | 'partial' | 'rejected';
		external_id?: string | null;
		publication_results?: Record<string, any> | null;
		analytics?: { views: number; likes: number; comments: number; shares: number } | null;
		token_usage?: number | null;
		token_cost?: number | null;
	}

	interface Blueprint {
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
		blueprints?: Blueprint[];
		autopilotConfigs?: Record<string, AutopilotView>;
	}

	let { data } = $props<{ data: PageData }>();

	// ── State ──
	let currentYear = $state(new Date().getFullYear());
	let currentMonth = $state(new Date().getMonth()); // 0-indexed
	// '' = All Personas — the rail below is the only agent filter (Postiz-style).
	let selectedAgentId = $state('');
	let selectedStatusFilter = $state('');
	let selectedDay = $state<number | null>(null);
	let selectedPost = $state<ScheduledPost | null>(null);
	let showComposer = $state(false);
	let composerSubmitting = $state(false);
	let calendarView = $state<'day' | 'week' | 'month'>('month');
	// Day-of-month anchor for the day/week views; the month view only reads year+month.
	let cursorDay = $state(new Date().getDate());

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

	function capPickerDay() {
		const maxDays = getDaysInMonth(pickerYear, pickerMonth);
		if (pickerDay > maxDays) {
			pickerDay = maxDays;
		}
	}

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
		cursorDay = pickerDay;
		// Month view opens the picked day's post list; day/week views just navigate there.
		selectedDay = calendarView === 'month' ? pickerDay : null;
		showDatePicker = false;
	}

	function selectToday() {
		goToday();
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

	// Content Forge Integration inside Composer — real DB blueprints only.

	let dbBlueprints = $derived(data.blueprints || []);
	let selectedBlueprintId = $state<string | null>('');

	let forgeTopic = $state('');
	let forgeProductId = $state('');
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

		// Restore the last-used calendar view (day/week/month)
		const savedView = localStorage.getItem('pg-cal-view');
		if (savedView === 'day' || savedView === 'week' || savedView === 'month') {
			calendarView = savedView;
		}
	});

	function handleBlueprintSelect(e: Event) {
		const target = e.target as HTMLSelectElement;
		selectedBlueprintId = target.value || '';

		if (selectedBlueprintId) {
			const bp = dbBlueprints.find((b: Blueprint) => b.id === selectedBlueprintId);
			if (bp && bp.platform) {
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
	}

	async function runForge() {
		if (!selectedBlueprintId || !forgeTopic.trim()) return;
		forging = true;

		const selectedProd = products.find((p: any) => p.id === forgeProductId);
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
			const agent = data.agents.find((a: Agent) => a.id === composerAgentId);
			const res = await ContentForge.generate(
				composerAgentId,
				enrichedTopic,
				platforms[0],
				selectedBlueprintId || undefined,
				forgeProductId || undefined
			);

			if (res.success && res.data) {
				const data = res.data as any;
				composerText = data.content || '';
				showToast('Content forged successfully!', 'success');
			} else {
				showToast(`Failed to forge content: ${res.error || 'Unknown error'}`, 'error');
			}
		} catch (e: any) {
			showToast(`Failed to forge content: ${e.message || e}`, 'error');
		} finally {
			forging = false;
		}
	}

	function getScoreColor(score: number): string {
		if (score >= 90) return 'var(--success)';
		if (score >= 75) return 'var(--cyan)';
		if (score >= 60) return 'var(--gold)';
		return 'var(--rose)';
	}

	let currentComposerAgent = $derived(data.agents.find((a: any) => a.id === composerAgentId));
	let composerAgentPlatforms = $derived(
		currentComposerAgent?.connected_platforms || ['instagram', 'youtube']
	);

	function resetPlatforms() {
		composerPlatforms = {
			tiktok: false,
			instagram: false,
			youtube: false,
			x: false,
			facebook: false,
			threads: false
		};
	}

	function formatViews(v: number): string {
		if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
		if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
		return String(v);
	}

	let posts = $state<ScheduledPost[]>(data.realPosts || []);

	// The shared PostDrawer expects a DB-shaped post row; the calendar keeps a
	// view-mapped shape (text/date/time), so normalize on the way in.
	let drawerPost = $derived(
		selectedPost
			? {
					id: selectedPost.id,
					// The drawer's observability panel fetches the post's ACTUAL models/
					// cost/product-reference per agent — it needs the agent id to do so.
					agent_id: selectedPost.agentId,
					content: selectedPost.text,
					status: selectedPost.status,
					platforms: selectedPost.platforms,
					scheduled_date: selectedPost.date,
					scheduled_time:
						selectedPost.time && selectedPost.time.length === 5
							? `${selectedPost.time}:00`
							: selectedPost.time,
					published_at: null,
					publication_results: selectedPost.publication_results ?? null,
					analytics: selectedPost.analytics ?? null
				}
			: null
	);

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

	const WEEKDAYS_FULL = [
		'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
	];

	function fmtDate(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	const todayStr = fmtDate(new Date());

	// Anchor date the day/week views revolve around.
	let anchorDate = $derived(new Date(currentYear, currentMonth, cursorDay));

	// Monday-first week around the anchor, matching the DAYS header order.
	let weekDates = $derived.by(() => {
		const monday = new Date(anchorDate);
		monday.setDate(anchorDate.getDate() - ((anchorDate.getDay() + 6) % 7));
		return Array.from({ length: 7 }, (_, i) => {
			const d = new Date(monday);
			d.setDate(monday.getDate() + i);
			return d;
		});
	});

	// Toolbar label adapts to the active view: "July 2026" / "Jul 14 – 20, 2026" /
	// "Monday, July 13, 2026".
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
			if (selectedStatusFilter && p.status !== selectedStatusFilter) return false;
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
		cursorDay = 1;
		selectedDay = null;
		selectedPost = null;
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
		selectedPost = null;
	}

	/** Move the day/week anchor by N days, rolling months/years as needed. */
	function shiftCursor(days: number) {
		const d = new Date(currentYear, currentMonth, cursorDay + days);
		currentYear = d.getFullYear();
		currentMonth = d.getMonth();
		cursorDay = d.getDate();
		selectedDay = null;
		selectedPost = null;
	}

	// Prev/next step by the active view's unit: a month, a week, or a day.
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
		selectedPost = null;
	}

	function setView(v: 'day' | 'week' | 'month') {
		calendarView = v;
		selectedDay = null;
		try {
			localStorage.setItem('pg-cal-view', v);
		} catch {
			/* private mode */
		}
	}

	/** Week-column header click zooms into that day. */
	function openDayView(d: Date) {
		currentYear = d.getFullYear();
		currentMonth = d.getMonth();
		cursorDay = d.getDate();
		setView('day');
	}

	function postsForDateSorted(dateStr: string) {
		return getPostsForDate(dateStr).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
	}

	let dayViewPosts = $derived(postsForDateSorted(fmtDate(anchorDate)));

	function selectDay(day: number | null) {
		if (day === null) return;
		selectedDay = selectedDay === day ? null : day;
	}

	function openComposer() {
		showComposer = true;
		composerAgentId = selectedAgentId || data.agents[0]?.id || '';
		composerText = '';
		forgeTopic = '';
		selectedBlueprintId = '';
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

	let deletingPost = $state(false);
	// Platforms that couldn't be auto-removed and need manual deletion (e.g. Instagram)
	let manualDeleteNotice = $state<Array<{ platform: string; permalink: string | null }> | null>(null);

	async function deletePost() {
		if (!selectedPost) return;
		const targetId = selectedPost.id;
		deletingPost = true;
		try {
			const res = await Posts.delete(targetId);
			if (res.success) {
				const teardown = (res as any).teardown as
					| { unpublished: string[]; manualDeletion: Array<{ platform: string; permalink: string | null }>; errors: string[] }
					| undefined;

				posts = posts.filter((p) => p.id !== targetId);
				selectedPost = null;
				selectedDay = null;

				if (teardown?.unpublished?.length) {
					showToast(`Removed from ${teardown.unpublished.join(', ')} and deleted locally`, 'success');
				} else {
					showToast('Post deleted', 'success');
				}

				// Surface platforms that can't be removed via API (Instagram, etc.)
				if (teardown?.manualDeletion?.length) {
					manualDeleteNotice = teardown.manualDeletion;
				}
			} else {
				showToast(res.error || 'Failed to delete post', 'error');
			}
		} catch (err: any) {
			showToast(err.message || 'Error deleting post', 'error');
		} finally {
			deletingPost = false;
		}
	}

	function platformLabel(p: string): string {
		return p.charAt(0).toUpperCase() + p.slice(1);
	}

	// Caption editing from the drawer — same behavior as the persona feed
	// (note: editing a published post only changes OUR copy, not the live platform).
	async function handleSaveText(post: any, newText: string): Promise<boolean> {
		try {
			let parsed: any = {};
			try {
				parsed = JSON.parse(post.content);
			} catch {
				parsed = { text: String(post.content ?? '') };
			}
			parsed.text = newText;
			const res = await Posts.update(post.id, { content: parsed });
			if (res.success) {
				const serialized = JSON.stringify(parsed);
				posts = posts.map((p) => (p.id === post.id ? { ...p, text: serialized } : p));
				if (selectedPost && selectedPost.id === post.id)
					selectedPost = { ...selectedPost, text: serialized };
				showToast('Caption updated', 'success');
				return true;
			}
			showToast(res.error || 'Failed to update caption', 'error');
			return false;
		} catch (e: any) {
			showToast(e.message || 'Failed to update caption', 'error');
			return false;
		}
	}

	// Reschedule from the drawer — optimistic local update on success.
	async function handleReschedule(post: any, date: string, time: string): Promise<boolean> {
		try {
			const res = await fetch('/api/posts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'reschedule',
					id: post.id,
					scheduled_date: date,
					scheduled_time: time
				})
			});
			const result = await res.json();
			if (res.ok && result.success) {
				const shortTime = time.substring(0, 5);
				posts = posts.map((p) => (p.id === post.id ? { ...p, date, time: shortTime } : p));
				if (selectedPost && selectedPost.id === post.id)
					selectedPost = { ...selectedPost, date, time: shortTime };
				showToast('Post rescheduled', 'success');
				return true;
			}
			showToast(result.error || 'Failed to reschedule post', 'error');
			return false;
		} catch (err: any) {
			showToast(err.message || 'Error rescheduling post', 'error');
			return false;
		}
	}

	/** Short failure hint for grid/list chips — only failed/partial posts get one. */
	function postErrorHint(p: ScheduledPost): string | undefined {
		if (p.status !== 'failed' && p.status !== 'partial') return undefined;
		return getPostErrorSummary(p) || 'Publish failed — open the post for details';
	}

	async function saveAsDraft() {
		const selectedPlatforms = Object.entries(composerPlatforms)
			.filter(([, v]) => v)
			.map(([k]) => k);
		if (!composerAgentId) { showToast('Select an agent', 'warning'); return; }
		if (!composerText.trim()) { showToast('Write some content', 'warning'); return; }
		if (selectedPlatforms.length === 0) { showToast('Select at least one platform', 'warning'); return; }

		composerSubmitting = true;
		try {
			const draftDate = composerDate || new Date().toISOString().slice(0, 10);
			const res = await Posts.create({
				agent_id: composerAgentId,
				content: composerText,
				platforms: selectedPlatforms,
				scheduled_date: draftDate,
				scheduled_time: composerTime + ':00',
				status: 'draft'
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
						status: 'draft'
					}
				];
				showToast('Draft saved successfully', 'success');
				showComposer = false;
			} else {
				showToast(res.error || 'Failed to save draft', 'error');
			}
		} catch (err: any) {
			showToast(err.message || 'Error saving draft', 'error');
		} finally {
			composerSubmitting = false;
		}
	}

	const STATUS_COLORS: Record<string, string> = {
		scheduled: 'var(--accent)',
		draft: 'var(--warning)',
		publishing: 'var(--cyan)',
		published: 'var(--success)',
		partial: 'var(--gold)',
		rejected: 'var(--rose)',
		failed: 'var(--error)'
	};

	let generatingPost = $state(false);

	/** Bridges the calendar's view-mapped ScheduledPost (text, not content) onto the shared util. */
	function getPostDisplay(p: ScheduledPost) {
		return sharedGetPostDisplay({ content: p.text, publication_results: p.publication_results });
	}

	/** Best displayable thumbnail for a post: poster still first, else the image itself (never a raw video file). */
	function getPostThumb(p: ScheduledPost): string | null {
		const d = getPostDisplay(p);
		if (d.posterUrl) return d.posterUrl;
		if (d.mediaUrl && d.mediaType !== 'video') return d.mediaUrl;
		return null;
	}

	// Autopilot config now lives where it belongs — the persona's Profile →
	// Automation section. The calendar shows resulting drafts, nothing more.
	let approving = $state(false);

	async function approvePost(post: ScheduledPost) {
		approving = true;
		try {
			const res = await Posts.update(post.id, { status: 'scheduled' });
			if (res.success) {
				posts = posts.map((p) => (p.id === post.id ? { ...p, status: 'scheduled' } : p));
				if (selectedPost?.id === post.id) selectedPost = { ...selectedPost, status: 'scheduled' };
				showToast('Approved — will auto-publish at its scheduled time', 'success');
			} else {
				showToast(res.error || 'Failed to approve', 'error');
			}
		} catch (err: any) {
			showToast(err.message || 'Error approving', 'error');
		} finally {
			approving = false;
		}
	}

	// Post Now: publish a draft/scheduled post immediately, overriding its schedule.
	let postingNow = $state(false);
	async function postNow(post: ScheduledPost) {
		if (!post.agentId || postingNow) return;
		postingNow = true;
		try {
			const res = await fetch(`/api/agent/${post.agentId}/publish-post`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ postId: post.id })
			});
			const d = await res.json().catch(() => ({}));
			if (!res.ok || !d.success) throw new Error(d.error || 'Post now failed');
			const status = d.status || 'published';
			posts = posts.map((p) => (p.id === post.id ? { ...p, status } : p));
			if (selectedPost?.id === post.id) selectedPost = { ...selectedPost, status };
			showToast(
				status === 'published' ? 'Posted live!' : `Post ${status}`,
				status === 'failed' ? 'error' : 'success'
			);
			selectedPost = null;
		} catch (err: any) {
			showToast('Post now failed: ' + (err.message || 'error'), 'error');
		} finally {
			postingNow = false;
		}
	}

	async function approveAllDrafts() {
		const drafts = selectedDayPosts.filter((p) => p.status === 'draft');
		if (drafts.length === 0) return;
		approving = true;
		try {
			let ok = 0;
			for (const d of drafts) {
				const res = await Posts.update(d.id, { status: 'scheduled' });
				if (res.success) ok++;
			}
			const ids = new Set(drafts.map((d) => d.id));
			posts = posts.map((p) => (ids.has(p.id) ? { ...p, status: 'scheduled' } : p));
			showToast(`Approved ${ok} draft${ok === 1 ? '' : 's'}`, 'success');
		} finally {
			approving = false;
		}
	}

	// ── Generate confirmation (no surprise generations, no surprise spend) ──
	let showGenerateConfirm = $state(false);
	let composerSpec = $state<ComposerSpec | null>(null);
	let composerOpen = $state(false);
	let skipGenerateConfirm = $state(false);
	let confirmSkipNext = $state(false);
	onMount(() => {
		skipGenerateConfirm = localStorage.getItem('pg-skip-generate-confirm') === '1';
	});
	let confirmAgent = $derived(
		data.agents.find((a: any) => a.id === (selectedAgentId || data.agents[0]?.id))
	);
	// Estimated cost range: image+llm (spokesperson adds tts+talking-head; b-roll adds video)
	const EST_LOW = +(priceOf('fal', 'image', 'nano') + 3 * priceOf('openrouter', 'llm') + priceOf('fal', 'tts') + priceOf('fal', 'talking_head')).toFixed(2);
	const EST_HIGH = +(priceOf('fal', 'image', 'nano') + 3 * priceOf('openrouter', 'llm') + priceOf('fal', 'video', 'standard')).toFixed(2);

	/**
	 * The calendar used to POST with NO body and treat any 2xx as "published" — so a
	 * 202 ("generating", nothing published yet) still toasted success, and because
	 * the 202 carries no `result.post` the card never appeared. Now it goes through
	 * the same confirm-first composer as the persona page and actually polls the job.
	 */
	// The composer's target persona. Owned separately from the rail filter
	// (selectedAgentId) because the user can retarget INSIDE the composer —
	// confirm must generate for the persona shown in the dialog, not whatever
	// the rail happened to be on.
	let genAgentId = $state('');

	/** The date the user is looking at, as a schedule prefill (never the past). */
	function calendarPrefillDate(): string | null {
		if (calendarView === 'day') {
			const ds = fmtDate(anchorDate);
			if (ds >= todayStr) return ds;
		}
		return null;
	}

	function buildGenSpec(agentId: string): ComposerSpec {
		const agent = data.agents.find((a: Agent) => a.id === agentId);
		const prefill = calendarPrefillDate();
		return {
			endpoint: `/api/agent/${agentId}/generate-post`,
			...(prefill ? { baseBody: { scheduled_date: prefill } } : {}),
			title: `Generate a post for ${agent?.name ?? 'this persona'}`,
			subtitle: 'Everything below is what will actually be sent. Edit anything before approving.',
			confirmLabel: 'Approve & generate'
		};
	}

	function requestGeneratePost() {
		const targetAgentId = selectedAgentId || (data.agents.length > 0 ? data.agents[0].id : '');
		if (!targetAgentId) {
			showToast('Please select or configure an agent first', 'warning');
			return;
		}
		genAgentId = targetAgentId;
		composerSpec = buildGenSpec(targetAgentId);
		composerOpen = true;
	}

	/** Persona switched inside the composer: rebuild the spec so it re-resolves. */
	function handleComposerAgentChange(id: string) {
		genAgentId = id;
		composerSpec = buildGenSpec(id);
	}

	async function generatePostNow(approved: Record<string, unknown> = {}) {
		const targetAgentId =
			genAgentId || selectedAgentId || (data.agents.length > 0 ? data.agents[0].id : '');
		if (!targetAgentId) {
			showToast('Please select or configure an agent first', 'warning');
			return;
		}
		generatingPost = true;
		const jobId = `${targetAgentId}:calendar-post`;
		startGeneration({ id: jobId, kind: 'post', agentId: targetAgentId, label: 'UGC post' });
		try {
			const res = await fetch(`/api/agent/${targetAgentId}/generate-post`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(approved)
			});
			const result = await res.json();

			// 202 = accepted, still running. Poll the row until it leaves 'generating'.
			if (res.status === 202 && result?.post_id) {
				showToast('Generation started — it will appear here when it finishes', 'info');
				const deadline = Date.now() + 10 * 60_000;
				while (Date.now() < deadline) {
					await new Promise((r) => setTimeout(r, 5000));
					const pr = await Posts.get(result.post_id).catch(() => null);
					const post = pr?.data ?? null;
					if (!post || post.status === 'generating') continue;
					if (post.status === 'failed') {
						let msg = 'Generation failed';
						try {
							msg = JSON.parse(post.content)?.error || msg;
						} catch {
							/* keep the generic message */
						}
						failGeneration(jobId, msg);
						showToast(msg, 'error');
						return;
					}
					finishGeneration(jobId);
					showToast('Post generated', 'success');
					await invalidateAll();
					return;
				}
				failGeneration(jobId, 'Timed out waiting for the generation to finish');
				showToast('Still generating — check the feed shortly', 'warning');
				return;
			}

			if (res.ok && result.success) {
				finishGeneration(jobId);
				showToast('Post generated and published successfully!', 'success');
				if (result.post) {
					const agent = data.agents.find((a: any) => a.id === targetAgentId);
					posts = [
						...posts,
						{
							id: result.post.id,
							agentId: result.post.agent_id,
							agentName: agent?.name || 'Agent',
							text: result.post.content,
							platforms: result.post.platforms || [],
							date: result.post.scheduled_date,
							time: result.post.scheduled_time ? result.post.scheduled_time.substring(0, 5) : '10:00',
							status: result.post.status,
							publication_results: result.post.publication_results,
							analytics: result.post.analytics,
							token_usage: result.post.token_usage,
							token_cost: result.post.token_cost ? parseFloat(result.post.token_cost) : 0
						}
					];
				}
			} else {
				showToast(result.error || 'Failed to generate post', 'error');
			}
		} catch (e: any) {
			showToast(e.message || 'Error generating post', 'error');
		} finally {
			generatingPost = false;
		}
	}
</script>

<svelte:head>
	<title>Calendar — PersonaGen</title>
</svelte:head>

<section class="page">
	<!-- Header -->
	<header class="page-header">
		<div>
			<h1>Content Calendar</h1>
			<p class="subtitle">Schedule and manage posts across all agents and platforms</p>
		</div>
		<button
			class="btn-primary"
			disabled={generatingPost}
			onclick={requestGeneratePost}
			style="display: inline-flex; align-items: center; gap: 0.5rem; background: var(--gradient-subtle); border-color: transparent; white-space: nowrap;"
		>
			{#if generatingPost}
				<span class="spinner"></span> Generating...
			{:else}
				✨ Generate Post Now
			{/if}
		</button>
	</header>

	<!-- Toolbar: date nav + Today (left) · status filter + view switch (right) -->
	<div class="cal-toolbar">
		<div class="toolbar-left">
		<button class="nav-btn" onclick={goPrev} aria-label="Previous {calendarView}">
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
				<span>{toolbarLabel}</span>
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
							<select id="picker-month" bind:value={pickerMonth} onchange={capPickerDay}>
								{#each MONTHS as month, index}
									<option value={index}>{month}</option>
								{/each}
							</select>
						</div>
						<div class="datepicker-field">
							<label for="picker-year">Year</label>
							<select id="picker-year" bind:value={pickerYear} onchange={capPickerDay}>
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
		<button class="nav-btn" onclick={goNext} aria-label="Next {calendarView}">
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
		<button class="btn-ghost btn-sm today-btn" onclick={goToday}>Today</button>
		</div>

		<div class="toolbar-right">
			<select class="status-select" bind:value={selectedStatusFilter} aria-label="Filter by status">
				<option value="">All statuses</option>
				<option value="draft">Draft</option>
				<option value="scheduled">Scheduled</option>
				<option value="publishing">Publishing</option>
				<option value="published">Published</option>
				<option value="partial">Partial</option>
				<option value="rejected">Rejected</option>
				<option value="failed">Failed</option>
			</select>
			<div class="view-toggle" role="group" aria-label="Calendar view">
				<button class="view-btn" class:active={calendarView === 'day'} onclick={() => setView('day')}>Day</button>
				<button class="view-btn" class:active={calendarView === 'week'} onclick={() => setView('week')}>Week</button>
				<button class="view-btn" class:active={calendarView === 'month'} onclick={() => setView('month')}>Month</button>
			</div>
		</div>
	</div>

	<div class="calendar-layout">
		<!-- Personas rail: in-page sub-nav, sits INSIDE the content area
		     (never covers the app's global navigation) -->
		<aside class="personas-rail" aria-label="Filter by persona">
			<h3 class="rail-title">Personas</h3>
			<div class="rail-list">
				<button
					class="agent-item"
					class:active={!selectedAgentId}
					onclick={() => (selectedAgentId = '')}
				>
					<span class="agent-dot"></span>
					<span class="agent-name">All Personas</span>
				</button>
				{#each data.agents as agent}
					<button
						class="agent-item"
						class:active={selectedAgentId === agent.id}
						onclick={() => (selectedAgentId = agent.id)}
					>
						<span class="agent-dot" style="background: {agent.gradient || 'var(--accent)'}"></span>
						<span class="agent-name">{agent.name}</span>
					</button>
				{/each}
			</div>
		</aside>

		<!-- Calendar grid -->
		<div class="calendar-wrap">
			{#if calendarView === 'month'}
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
								<div class="cell-events">
									{#each dayPosts.slice(0, 3) as post}
										<div
											class="event-block"
											class:status-draft={post.status === 'draft'}
											class:status-scheduled={post.status === 'scheduled'}
											class:status-published={post.status === 'published'}
											class:status-failed={post.status === 'failed' || post.status === 'partial'}
											title={postErrorHint(post)}
										>
											<div class="event-status-bar" style="background: {STATUS_COLORS[post.status]}"></div>
											<div class="event-content">
												<span class="event-agent">{post.agentName.split(' ')[0]}</span>
												<span class="event-text">{getPostDisplay(post).text}</span>
											</div>
										</div>
									{/each}
									{#if dayPosts.length > 3}
										<div class="event-overflow">+{dayPosts.length - 3} more</div>
									{/if}
								</div>
							{/if}
						</button>
					{/if}
				{/each}
			</div>

			<!-- Mobile list view: tappable cards with thumbnails, opening the same
			     post drawer as desktop (the old read-only divs were the "can't
			     click anything / can't see pictures" complaint). -->
			<div class="mobile-list">
				<h3 class="mobile-list-title">Upcoming Posts</h3>
				{#each filteredPosts.sort((a, b) => a.date.localeCompare(b.date)) as post}
					{@const thumb = getPostThumb(post)}
					<button class="mobile-post-item" onclick={() => (selectedPost = post)}>
						{#if thumb}
							<img class="mobile-post-thumb" src={thumb} alt="" loading="lazy" />
						{:else}
							<div class="mobile-post-thumb mobile-post-thumb-empty">📝</div>
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
				<!-- Week view: 7 agenda columns, Monday-first like the month grid -->
				<div class="week-grid">
					{#each weekDates as wd, i}
						{@const dateStr = fmtDate(wd)}
						{@const dayPosts = postsForDateSorted(dateStr)}
						<div class="week-col" class:today={dateStr === todayStr}>
							<button class="week-col-head" onclick={() => openDayView(wd)} title="Open day view">
								<span class="week-dow">{DAYS[i]}</span>
								<span class="week-num">{wd.getDate()}</span>
							</button>
							<div class="week-col-body">
								{#each dayPosts as post}
									<button
										class="event-block week-event"
										onclick={() => (selectedPost = post)}
										title={postErrorHint(post)}
									>
										<div class="event-status-bar" style="background: {STATUS_COLORS[post.status]}"></div>
										<div class="event-content">
											<span class="event-time">{post.time}</span>
											<span class="event-agent">{post.agentName.split(' ')[0]}</span>
											<span class="event-text">{getPostDisplay(post).text}</span>
										</div>
									</button>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<!-- Day view: chronological agenda for the anchor date -->
				<div class="day-view">
					{#each dayViewPosts as post}
						{@const thumb = getPostThumb(post)}
						<button class="day-post" onclick={() => (selectedPost = post)} title={postErrorHint(post)}>
							<span class="day-post-time">{post.time}</span>
							<div class="day-post-bar" style="background: {STATUS_COLORS[post.status]}"></div>
							{#if thumb}
								<img class="day-post-thumb" src={thumb} alt="" loading="lazy" />
							{/if}
							<div class="day-post-body">
								<div class="day-post-top">
									<span class="day-post-agent">{post.agentName}</span>
									<span
										class="status-badge"
										style="color: {STATUS_COLORS[post.status]}; border-color: {STATUS_COLORS[post.status]}"
										>{post.status}</span
									>
								</div>
								<p class="day-post-text">{getPostDisplay(post).text}</p>
								<div class="day-post-platforms">
									{#each post.platforms as p}
										<span class="platform-tag" style="color: {platformColor(p)}">{p}</span>
									{/each}
								</div>
							</div>
						</button>
					{:else}
						<div class="day-empty">
							<p>Nothing scheduled for {toolbarLabel}.</p>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Day Posts Modal -->
		{#if selectedDay !== null}
			<div class="modal-backdrop" onclick={() => (selectedDay = null)} role="presentation">
				<div class="day-modal" onclick={(e) => e.stopPropagation()} role="dialog">
					<div class="modal-header">
						<h3>{MONTHS[currentMonth]} {selectedDay}, {currentYear}</h3>
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
									<button class="modal-post-card" onclick={() => selectedPost = post}>
										<div class="post-card-status" style="background: {STATUS_COLORS[post.status] || 'var(--accent)'}"></div>
										{#if thumb}
											<img class="post-card-thumb" src={thumb} alt="" loading="lazy" />
										{/if}
										<div class="post-card-body">
											<div class="post-card-time-row">
												<span class="post-card-time">{post.time}</span>
												{#if post.status === 'published'}
													<span class="live-indicator-badge">Live Tracker</span>
												{:else}
													<span class="status-badge" style="color: {STATUS_COLORS[post.status]}; border-color: {STATUS_COLORS[post.status]}" title={postErrorHint(post)}>{post.status}</span>
												{/if}
											</div>
											<p class="post-card-text">{dp.text}</p>
											<div class="post-card-footer">
												<span class="post-card-agent">{post.agentName}</span>
												<div class="post-card-platforms">
													{#each post.platforms as p}
														<span class="platform-dot" style="background: {platformColor(p)}" title={p}></span>
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
						<span style="display: inline-flex; gap: 0.5rem;">{#if selectedDayPosts.some((p) => p.status === 'draft')}<button class="btn-primary btn-sm" onclick={approveAllDrafts} disabled={approving}>{approving ? 'Approving…' : `✓ Approve all drafts (${selectedDayPosts.filter((p) => p.status === 'draft').length})`}</button>{/if}<button class="btn-ghost btn-sm" onclick={() => (selectedDay = null)}>Close</button></span>
					</div>
				</div>
			</div>
		{/if}

		<!-- Full post details: the same slide-in drawer the persona feed uses —
		     replaces the old second stacked modal so day-list → details flows
		     without modal-on-modal. -->
		<PostDrawer
			post={drawerPost}
			onClose={() => (selectedPost = null)}
			onDelete={() => deletePost()}
			onApprove={() => selectedPost && approvePost(selectedPost)}
			onSaveText={handleSaveText}
			onReschedule={handleReschedule}
			onPostNow={() => selectedPost && postNow(selectedPost)}
			posting={postingNow}
			approving={approving}
			deleting={deletingPost}
		/>

		<!-- Manual Deletion Notice (platforms with no API teardown, e.g. Instagram) -->
		{#if manualDeleteNotice !== null}
			<div class="modal-backdrop z-top" onclick={() => (manualDeleteNotice = null)} role="presentation">
				<div class="day-modal" onclick={(e) => e.stopPropagation()} role="dialog" style="max-width: 460px;">
					<div class="modal-header">
						<h3>Removed locally — 1 step left</h3>
						<button class="modal-close" onclick={() => (manualDeleteNotice = null)} aria-label="Close">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
						</button>
					</div>
					<div class="modal-body" style="padding: 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
						<p style="margin: 0; font-size: var(--text-sm); color: var(--text-dim); line-height: 1.6;">
							The post was deleted from your dashboard. These platforms don't allow deletion through their API, so the live post must be removed by hand:
						</p>
						<div style="display: flex; flex-direction: column; gap: 0.75rem;">
							{#each manualDeleteNotice as entry}
								<div style="display: flex; flex-direction: column; gap: 0.4rem; padding: 0.85rem 1rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm);">
									<div style="display: flex; align-items: center; gap: 0.5rem;">
										<span class="platform-badge" style="background: {platformColor(entry.platform)}20; color: {platformColor(entry.platform)}; border: 1px solid {platformColor(entry.platform)}40;">
											{platformLabel(entry.platform)}
										</span>
										{#if entry.platform === 'instagram'}
											<span style="font-size: var(--text-xs); color: var(--text-dim);">Open the post, tap ⋯ → Delete</span>
										{/if}
									</div>
									{#if entry.permalink}
										<a
											href={entry.permalink}
											target="_blank"
											rel="noopener noreferrer"
											style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: var(--text-sm); font-weight: 700; text-decoration: none; color: {platformColor(entry.platform)};"
										>
											Open {platformLabel(entry.platform)} post to delete ↗
										</a>
									{:else}
										<span style="font-size: var(--text-xs); color: var(--text-dim);">No direct link available — open {platformLabel(entry.platform)} and remove it manually.</span>
									{/if}
								</div>
							{/each}
						</div>
					</div>
					<div class="modal-footer">
						<button class="btn-primary btn-sm" onclick={() => (manualDeleteNotice = null)}>Got it</button>
					</div>
				</div>
			</div>
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
			<div
				class="composer"
				onclick={(e) => e.stopPropagation()}
				role="dialog"
				style="max-width: 600px;"
			>
				<div class="composer-header">
					<h3>Schedule New Post</h3>
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

				<div
					class="composer-body"
					style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; max-height: 70vh; overflow-y: auto;"
				>
					<!-- Target Agent -->
					<div class="field" style="display: flex; flex-direction: column; gap: 0.25rem;">
						<label
							for="comp-agent"
							style="font-size: var(--text-xs); font-weight: 700; text-transform: uppercase; color: var(--text-dim);"
							>Target Agent</label
						>
						<select
							id="comp-agent"
							bind:value={composerAgentId}
							onchange={resetPlatforms}
							style="font-size: var(--text-sm); padding: 0.5rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
						>
							{#each data.agents as agent}
								<option value={agent.id}>{agent.name}</option>
							{/each}
						</select>
					</div>

					<!-- Optional Content Forge section -->
					<div
						class="forge-collapsible glass-card"
						style="border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; background: var(--surface-2);"
					>
						<h4
							style="margin: 0; font-size: var(--text-xs); text-transform: uppercase; letter-spacing: var(--tracking-wider); color: var(--accent);"
						>
							✨ Optional: Forge with Competitor Blueprint
						</h4>

						<div class="field" style="display: flex; flex-direction: column; gap: 0.25rem;">
							<label
								for="comp-blueprint"
								style="font-size: 0.65rem; font-weight: 700; color: var(--text-muted);"
								>Select Blueprint</label
							>
							<select
								id="comp-blueprint"
								value={selectedBlueprintId}
								onchange={handleBlueprintSelect}
								style="font-size: var(--text-xs); padding: 0.4rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
							>
								<option value="">No blueprint selected</option>
								{#each dbBlueprints as bp}
									<option value={bp.id}>{bp.name} ({bp.platform} - {bp.score} pts)</option>
								{:else}
									<option value="" disabled>No blueprints yet — analyze a competitor first</option>
								{/each}
							</select>
						</div>

						{#if selectedBlueprintId}
							<div class="field" style="display: flex; flex-direction: column; gap: 0.25rem;">
								<label
									for="comp-topic"
									style="font-size: 0.65rem; font-weight: 700; color: var(--text-muted);"
									>Topic / Prompt</label
								>
								<input
									id="comp-topic"
									type="text"
									bind:value={forgeTopic}
									placeholder="e.g. Swapping pre-workout for adaptogenic honey..."
									style="font-size: var(--text-xs); padding: 0.4rem 0.6rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
								/>
							</div>

							<div class="field" style="display: flex; flex-direction: column; gap: 0.25rem;">
								<label
									for="comp-product"
									style="font-size: 0.65rem; font-weight: 700; color: var(--text-muted);"
									>Focus Product</label
								>
								<select
									id="comp-product"
									bind:value={forgeProductId}
									style="font-size: var(--text-xs); padding: 0.4rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
								>
									<option value="">No product focus</option>
									{#each products as product}
										<option value={product.id}>{product.name} ({product.price})</option>
									{/each}
								</select>
							</div>

							<button
								type="button"
								class="btn-forge-action"
								disabled={forging || !forgeTopic.trim()}
								onclick={runForge}
								style="background: var(--gradient-subtle); color: #fff; border: none; padding: 0.45rem; font-size: var(--text-xs); font-weight: 700; border-radius: var(--radius-xs); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; margin-top: 0.25rem;"
							>
								{#if forging}
									<span
										class="spinner"
										style="width: 12px; height: 12px; border: 2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation: spin 0.6s linear infinite;"
									></span> Forging...
								{:else}
									✨ Forge Copy
								{/if}
							</button>
						{/if}
					</div>

					<!-- Content & Copy -->
					<div class="field" style="display: flex; flex-direction: column; gap: 0.25rem;">
						<label
							for="comp-text"
							style="font-size: var(--text-xs); font-weight: 700; text-transform: uppercase; color: var(--text-dim);"
							>Content & Copy</label
						>
						<textarea
							id="comp-text"
							bind:value={composerText}
							rows="5"
							placeholder="Write your post content here directly, or use a blueprint above to auto-forge..."
							style="font-size: var(--text-sm); padding: 0.6rem 0.75rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text); resize: vertical; line-height: 1.5;"
						></textarea>
					</div>

					<!-- Target Platforms -->
					<div class="field" style="display: flex; flex-direction: column; gap: 0.25rem;">
						<label
							style="font-size: var(--text-xs); font-weight: 700; text-transform: uppercase; color: var(--text-dim);"
							>Target Platforms</label
						>
						<div
							class="platform-checkboxes"
							style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.25rem;"
						>
							{#each composerAgentPlatforms as key}
								{@const color = platformColor(key)}
								<label
									class="platform-checkbox"
									style="--p-color: {color}; display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.35rem 0.65rem; border: 1px solid var(--border); border-radius: var(--radius-xs); background: var(--surface-2); cursor: pointer; font-size: var(--text-xs); font-weight: 600;"
								>
									<input type="checkbox" bind:checked={composerPlatforms[key]} />
									<span class="checkbox-label" style="text-transform: capitalize;">{key}</span>
								</label>
							{/each}
						</div>
					</div>

					<!-- Schedule Date & Time -->
					<div class="field-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
						<div class="field" style="display: flex; flex-direction: column; gap: 0.25rem;">
							<label
								for="comp-date"
								style="font-size: var(--text-xs); font-weight: 700; text-transform: uppercase; color: var(--text-dim);"
								>Schedule Date</label
							>
							<input
								id="comp-date"
								type="date"
								bind:value={composerDate}
								style="font-size: var(--text-sm); padding: 0.5rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
							/>
						</div>
						<div class="field" style="display: flex; flex-direction: column; gap: 0.25rem;">
							<label
								for="comp-time"
								style="font-size: var(--text-xs); font-weight: 700; text-transform: uppercase; color: var(--text-dim);"
								>Schedule Time</label
							>
							<input
								id="comp-time"
								type="time"
								bind:value={composerTime}
								style="font-size: var(--text-sm); padding: 0.5rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
							/>
						</div>
					</div>
				</div>

				<div
					class="composer-footer"
					style="padding: 1rem 1.5rem; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 0.75rem; background: var(--surface-2);"
				>
					<button class="btn-ghost btn-sm" onclick={closeComposer}>Cancel</button>
					<button class="btn-ghost btn-sm" style="border: 1px solid var(--warning); color: var(--warning);" onclick={saveAsDraft} disabled={composerSubmitting}>
						{#if composerSubmitting}
							<span class="spinner"></span> Saving…
						{:else}
							📝 Save as Draft
						{/if}
					</button>
					<button class="btn-primary btn-sm" onclick={schedulePost} disabled={composerSubmitting}>
						{#if composerSubmitting}
							<span class="spinner"></span> Scheduling…
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

<!-- Same confirm-first composer as the persona page: the server resolves the real
     payload/cost, the user edits and approves, then we run exactly that. -->
<GenerationComposer
	open={composerOpen}
	spec={composerSpec}
	agents={data.agents}
	agentId={genAgentId}
	onAgentChange={handleComposerAgentChange}
	onClose={() => (composerOpen = false)}
	onConfirm={(body) => {
		composerOpen = false;
		void generatePostNow(body);
	}}
/>

<style>
	.page {
		padding: 2rem;
		max-width: 1400px;
		margin: 0 auto;
		position: relative;
		min-height: calc(100vh - 60px);
		display: flex;
		flex-direction: column;
	}

	/* ── Personas rail (in-flow sub-nav — never covers the app's global nav) ── */
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
		max-height: calc(100vh - 140px);
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

	/* ── Header ── */
	.page-header {
		display: flex;
		align-items: center;
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

	/* ── Toolbar (date nav + Today left · status filter + view switch right) ── */
	.cal-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1.25rem;
	}

	.toolbar-left,
	.toolbar-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.toolbar-right {
		gap: 0.75rem;
	}

	.today-btn {
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		margin-left: 0.25rem;
	}

	.status-select {
		min-width: 130px;
		padding: 0.45rem 0.6rem;
		font-size: var(--text-sm);
		border-radius: var(--radius-xs);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
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

	/* ── Generate confirmation ── */
	.gen-confirm-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 200;
		padding: 1rem;
	}

	.gen-confirm {
		width: min(480px, 100%);
		background: var(--surface, #17171f);
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 14px);
		padding: 1.25rem 1.4rem;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
	}

	.gen-confirm h3 {
		margin: 0 0 0.9rem;
		font-family: var(--font-display);
	}

	.gc-rows {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		margin-bottom: 1rem;
	}

	.gc-row {
		display: flex;
		gap: 0.75rem;
		font-size: var(--text-sm);
	}

	.gc-label {
		flex: 0 0 88px;
		color: var(--text-dim);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding-top: 2px;
	}

	.gc-skip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-xs);
		color: var(--text-muted);
		margin-bottom: 1rem;
		cursor: pointer;
	}

	.gc-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
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
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.35rem;
		cursor: pointer;
		transition:
			border-color 0.2s,
			background 0.2s;
		min-height: 120px;
		font-family: var(--font-body);
		color: var(--text);
		text-align: left;
		overflow: hidden;
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
		margin-bottom: 0.15rem;
	}

	.cell.today .cell-day {
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
		gap: 0.35rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		overflow: hidden;
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: var(--text-xs);
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
	}

	.event-text {
		color: var(--text);
		font-size: var(--text-xs);
		white-space: nowrap;
		text-overflow: ellipsis;
		overflow: hidden;
	}

	.event-overflow {
		padding: 0.3rem 0.45rem;
		font-size: 0.65rem;
		color: var(--text-dim);
		font-weight: 600;
		text-align: center;
	}

	.event-time {
		font-family: var(--font-mono);
		font-size: 0.65rem;
		color: var(--text-dim);
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
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 0.55rem 0;
		background: var(--surface-2);
		border: none;
		border-bottom: 1px solid var(--border);
		cursor: pointer;
		color: var(--text);
		font: inherit;
	}

	.week-col-head:hover .week-num {
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

	.week-event {
		width: 100%;
		padding: 0;
		text-align: left;
		font: inherit;
		color: inherit;
	}

	/* ── Day view ── */
	.day-view {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.day-post {
		display: flex;
		align-items: stretch;
		gap: 0.9rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.9rem 1rem;
		cursor: pointer;
		text-align: left;
		color: inherit;
		font: inherit;
		transition:
			border-color 0.2s,
			transform 0.2s;
	}

	.day-post:hover {
		border-color: var(--accent-mid);
		transform: translateY(-1px);
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

	.day-post-platforms {
		display: flex;
		gap: 0.5rem;
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

	/* ── Mobile list view (hidden on desktop) ── */
	.mobile-list {
		display: none;
	}

	/* ── Day panel (Deprecated in favor of centered modals) ── */
	/* ── Modals ── */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.75);
		backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
		padding: 1.5rem;
	}

	.modal-backdrop.z-top {
		z-index: 1100;
	}

	.day-modal {
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		width: 100%;
		max-width: 550px;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		box-shadow:
			var(--shadow-lg),
			0 20px 25px -5px rgba(0, 0, 0, 0.3),
			0 0 50px rgba(124, 106, 237, 0.15);
		animation: scaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
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
		width: 32px;
		height: 32px;
		border-radius: var(--radius-full);
		border: none;
		background: var(--surface-3);
		color: var(--text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background 0.2s, color 0.2s, transform 0.2s;
	}

	.modal-close:hover {
		color: var(--text);
		background: var(--border-strong);
		transform: rotate(90deg);
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

	/* Day Modal Post Cards */
	.modal-posts-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.modal-post-card {
		display: flex;
		text-align: left;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		cursor: pointer;
		width: 100%;
		padding: 0;
		transition: 
			transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
			border-color 0.2s,
			box-shadow 0.2s;
	}

	.modal-post-card:hover {
		transform: translateY(-2px);
		border-color: var(--accent-mid);
		box-shadow: var(--shadow-md), 0 4px 20px rgba(124, 106, 237, 0.08);
	}

	.post-card-status {
		width: 4px;
		flex-shrink: 0;
	}

	.post-card-body {
		padding: 1.25rem;
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

	.live-indicator-badge {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		background: var(--error);
		color: #fff;
		padding: 3px 8px;
		border-radius: 4px;
		letter-spacing: 0.05em;
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
		margin-top: 0.2rem;
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

	.platform-badge {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: capitalize;
		padding: 4px 10px;
		border-radius: 6px;
	}

	/* Animations */
	@keyframes scaleUp {
		from { transform: scale(0.95); opacity: 0; }
		to { transform: scale(1); opacity: 1; }
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

	.mobile-post-status.status-draft { color: #f59e0b; border-color: #f59e0b; }
	.mobile-post-status.status-scheduled { color: #38bdf8; border-color: #38bdf8; }
	.mobile-post-status.status-publishing { color: #22d3ee; border-color: #22d3ee; }
	.mobile-post-status.status-published { color: #10b981; border-color: #10b981; }
	.mobile-post-status.status-partial { color: #f97316; border-color: #f97316; }
	.mobile-post-status.status-rejected { color: #f43f5e; border-color: #f43f5e; }
	.mobile-post-status.status-failed { color: #ef4444; border-color: #ef4444; }

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
	@media (max-width: 1200px) {
		.personas-rail {
			flex-basis: 170px;
		}

		.page {
			padding: 1.5rem;
		}
	}

	@media (max-width: 900px) {
		/* Rail becomes a horizontal persona chip row above the calendar */
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
	}

	@media (max-width: 768px) {
		.page {
			padding: 1rem;
		}

		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 1rem;
		}

		.page-header .btn-primary {
			width: 100%;
			justify-content: center;
		}

		.calendar-grid {
			gap: 1px;
		}

		.cell {
			min-height: 85px;
			font-size: var(--text-xs);
		}

		.event-block {
			gap: 0.25rem;
		}

		.event-agent {
			font-size: 0.6rem;
		}

		.event-text {
			font-size: 0.7rem;
		}
	}

	@media (max-width: 640px) {
		/* Month grid gives way to the tappable list; week stacks into an agenda */
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
			flex-direction: row;
			gap: 0.5rem;
			padding: 0.5rem;
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

	/* ── Day-modal post card thumbnails ── */
	.modal-post-card {
		display: flex;
		align-items: stretch;
		gap: 0.6rem;
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
</style>
