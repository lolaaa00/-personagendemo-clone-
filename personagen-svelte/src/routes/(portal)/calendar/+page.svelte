<script lang="ts">
	import { untrack, onMount } from 'svelte';
	import type { Agent } from '$lib/types';
	import { showToast } from '$lib/stores/ui.svelte';
	import { Posts, ContentForge, Autopilot, type AutopilotView } from '$lib/services/api';
	import { page } from '$app/stores';
	import { goto, invalidateAll } from '$app/navigation';

	interface ScheduledPost {
		id: string;
		agentId: string;
		agentName: string;
		text: string;
		platforms: string[];
		date: string; // YYYY-MM-DD
		time: string;
		status: 'scheduled' | 'draft' | 'published' | 'failed' | 'publishing';
		external_id?: string | null;
		publication_results?: Record<string, any> | null;
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
		autopilotConfigs?: Record<string, AutopilotView>;
		allowDemoMode?: boolean;
	}

	let { data } = $props<{ data: PageData }>();

	// ── State ──
	let currentYear = $state(new Date().getFullYear());
	let currentMonth = $state(new Date().getMonth()); // 0-indexed
	let selectedAgentId = $state('');
	let selectedStatusFilter = $state('');
	let selectedDay = $state<number | null>(null);
	let selectedPost = $state<ScheduledPost | null>(null);
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

	let dbBlueprints = $derived(data.blueprints || []);
	let allBlueprints = $derived([...dbBlueprints, ...SAMPLE_BLUEPRINTS]);
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

		// Default selectedAgentId to first active agent
		const activeAgent = data.agents.find((a: any) => a.status === 'active' || a.active);
		if (activeAgent) {
			selectedAgentId = activeAgent.id;
		}
	});

	function handleBlueprintSelect(e: Event) {
		const target = e.target as HTMLSelectElement;
		selectedBlueprintId = target.value || '';

		if (selectedBlueprintId) {
			const bp = allBlueprints.find((b: SampleBlueprint) => b.id === selectedBlueprintId);
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
				if (data.allowDemoMode) {
					composerText = getMockForgedContent(enrichedTopic, selectedProd);
					showToast('Using forged demo template', 'info');
				} else {
					showToast(`Failed to forge content: ${res.error || 'Unknown error'}`, 'error');
				}
			}
		} catch (e: any) {
			if (data.allowDemoMode) {
				composerText = getMockForgedContent(enrichedTopic, selectedProd);
				showToast('Using forged demo template', 'info');
			} else {
				showToast(`Failed to forge content: ${e.message || e}`, 'error');
			}
		} finally {
			forging = false;
		}
	}

	function getMockForgedContent(topicText: string, product: any): string {
		const prodName = product?.name || 'HoneyX Manly Plus';
		const prodPrice = product?.price || 'Rs. 2,450';
		const prodDesc = product?.description || "Nature's premium superfood for energy.";

		return `🔥 ${topicText}\n\nIntroducing: ${prodName} (${prodPrice})!\n\n1️⃣ **Organic Vitality Power**: Unlocking natural daily drive.\n2️⃣ **Potent Herbal Active**: Sustainable energy with zero crash.\n\n${prodDesc}\n\nDrop a comment to grab exclusive early access 👇`;
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
		selectedDay = null;
		selectedPost = null;
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
		publishing: 'var(--cyan)',
		published: 'var(--success)',
		failed: 'var(--error)'
	};

	let generatingPost = $state(false);

	function getPostDisplay(content: string) {
		try {
			const trimmed = content.trim();
			if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
				const parsed = JSON.parse(trimmed);
				return {
					text: parsed.text || content,
					mediaUrl: parsed.media_url || parsed.mediaUrl || null,
					ugcPrompt: parsed.ugc_broll_prompt || parsed.ugcPrompt || null,
					script: parsed.script || null,
					product: parsed.product || null,
					autopilot: parsed.autopilot === true
				};
			}
		} catch (e) {}
		return { text: content, mediaUrl: null, ugcPrompt: null, script: null, product: null, autopilot: false };
	}

	// ── Autopilot (auto-generate UGC drafts every 2h in window) ──────────────
	const HOURS = Array.from({ length: 24 }, (_, i) => i);
	function fmtHour(h: number): string {
		const hr = h % 12 === 0 ? 12 : h % 12;
		return `${hr}${h < 12 ? 'AM' : 'PM'}`;
	}

	let autopilotAgentId = $derived(selectedAgentId || data.agents[0]?.id || '');
	let currentAutopilotAgent = $derived(data.agents.find((a: any) => a.id === autopilotAgentId));

	let autopilot = $state<AutopilotView | null>(null);
	let apWindowStart = $state(8);
	let apWindowEnd = $state(20);
	let apTimezone = $state('Australia/Sydney');
	let autopilotSaving = $state(false);
	let autopilotGenerating = $state(false);
	let approving = $state(false);

	// Sync the panel whenever the selected agent changes.
	$effect(() => {
		const id = autopilotAgentId;
		if (!id) {
			autopilot = null;
			return;
		}
		const cfg = data.autopilotConfigs?.[id] || {
			enabled: false,
			mode: 'semi_autonomous' as const,
			window_start: 8,
			window_end: 20,
			timezone: 'Australia/Sydney'
		};
		untrack(() => {
			autopilot = cfg;
			apWindowStart = cfg.window_start;
			apWindowEnd = cfg.window_end;
			apTimezone = cfg.timezone;
		});
	});

	async function persistAutopilot(enabled: boolean) {
		const id = autopilotAgentId;
		if (!id) return;
		autopilotSaving = true;
		try {
			const res = await Autopilot.setConfig(id, {
				enabled,
				mode: autopilot?.mode === 'fully_autonomous' ? 'fully_autonomous' : 'semi_autonomous',
				window_start: apWindowStart,
				window_end: apWindowEnd,
				timezone: apTimezone
			});
			if (res.success && res.data) {
				autopilot = res.data;
			} else {
				showToast(res.error || 'Failed to update autopilot', 'error');
			}
		} catch (err: any) {
			showToast(err.message || 'Error updating autopilot', 'error');
		} finally {
			autopilotSaving = false;
		}
	}

	function toggleAutopilot(e: Event) {
		const enabled = (e.target as HTMLInputElement).checked;
		persistAutopilot(enabled).then(() => {
			if (autopilot?.enabled) {
				showToast('Autopilot on — generating drafts for approval', 'success');
			} else {
				showToast('Autopilot off', 'info');
			}
		});
	}

	function saveAutopilotWindow() {
		if (!autopilot) return;
		persistAutopilot(autopilot.enabled);
	}

	async function generateDraftsNow() {
		const id = autopilotAgentId;
		if (!id) {
			showToast('Select an agent first', 'warning');
			return;
		}
		autopilotGenerating = true;
		try {
			const res = await Autopilot.generateNow(id);
			if (res.success) {
				const n = (res.data as any)?.generated ?? 0;
				if (n > 0) {
					showToast(`Generated ${n} draft${n === 1 ? '' : 's'} for approval`, 'success');
					await invalidateAll();
					posts = data.realPosts || [];
				} else {
					showToast('No empty slots to fill in the window', 'info');
				}
			} else {
				showToast(res.error || 'Failed to generate drafts', 'error');
			}
		} catch (err: any) {
			showToast(err.message || 'Error generating drafts', 'error');
		} finally {
			autopilotGenerating = false;
		}
	}

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

	async function generatePostNow() {
		const targetAgentId = selectedAgentId || (data.agents.length > 0 ? data.agents[0].id : '');
		if (!targetAgentId) {
			showToast('Please select or configure an agent first', 'warning');
			return;
		}
		generatingPost = true;
		try {
			const res = await fetch(`/api/agent/${targetAgentId}/generate-post`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				}
			});
			const result = await res.json();
			if (res.ok && result.success) {
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
		<div class="header-left">
			<h1>Content Calendar</h1>
			<p class="subtitle">Schedule and manage posts across all agents and platforms</p>
		</div>
		<div class="header-controls">
			<button
				class="btn-primary"
				disabled={generatingPost}
				onclick={generatePostNow}
				style="margin-top: auto; height: 38px; display: inline-flex; align-items: center; gap: 0.5rem; background: var(--gradient-subtle); border-color: transparent;"
			>
				{#if generatingPost}
					<span
						class="spinner"
						style="width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation: spin 0.6s linear infinite;"
					></span> Generating...
				{:else}
					✨ Generate Post Now
				{/if}
			</button>
			<div class="agent-filter">
				<label for="cal-agent">Filter Agent</label>
				<select id="cal-agent" bind:value={selectedAgentId}>
					<option value="">All Agents</option>
					{#each data.agents as agent}
						<option value={agent.id}>{agent.name}</option>
					{/each}
				</select>
			</div>
			<div class="agent-filter">
				<label for="cal-status">Filter Status</label>
				<select id="cal-status" bind:value={selectedStatusFilter}>
					<option value="">All Statuses</option>
					<option value="draft">Draft</option>
					<option value="scheduled">Scheduled</option>
					<option value="published">Published</option>
					<option value="failed">Failed</option>
				</select>
			</div>
		</div>
	</header>

	<!-- Autopilot bar -->
	{#if currentAutopilotAgent}
		<div class="autopilot-bar" class:active={autopilot?.enabled}>
			<div class="ap-main">
				<label class="ap-switch" title="Toggle autopilot">
					<input
						type="checkbox"
						checked={autopilot?.enabled ?? false}
						onchange={toggleAutopilot}
						disabled={autopilotSaving}
					/>
					<span class="ap-slider"></span>
				</label>
				<div class="ap-text">
					<span class="ap-title"
						>🤖 Autopilot {autopilot?.enabled ? 'ON' : 'OFF'} · {currentAutopilotAgent.name}</span
					>
					<span class="ap-sub">
						{#if autopilot?.enabled}
							Auto-generates UGC drafts every 2h, {fmtHour(apWindowStart)}–{fmtHour(apWindowEnd)} ({apTimezone}).
							Review &amp; approve — approved posts auto-publish at their slot.
						{:else}
							Turn on to auto-generate product UGC drafts every 2 hours for your approval.
						{/if}
					</span>
				</div>
			</div>
			<div class="ap-controls">
				<div class="ap-window">
					<label for="ap-start">From</label>
					<select
						id="ap-start"
						bind:value={apWindowStart}
						onchange={saveAutopilotWindow}
						disabled={autopilotSaving || !autopilot?.enabled}
					>
						{#each HOURS as h}<option value={h}>{fmtHour(h)}</option>{/each}
					</select>
					<label for="ap-end">to</label>
					<select
						id="ap-end"
						bind:value={apWindowEnd}
						onchange={saveAutopilotWindow}
						disabled={autopilotSaving || !autopilot?.enabled}
					>
						{#each HOURS as h}<option value={h}>{fmtHour(h)}</option>{/each}
					</select>
				</div>
				<button
					class="btn-ghost btn-sm"
					onclick={generateDraftsNow}
					disabled={autopilotGenerating || !autopilot?.enabled}
				>
					{#if autopilotGenerating}
						<span
							class="spinner"
							style="width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;"
						></span> Generating…
					{:else}
						⚡ Generate drafts now
					{/if}
				</button>
			</div>
		</div>
	{/if}

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
									<button class="modal-post-card" onclick={() => selectedPost = post}>
										<div class="post-card-status" style="background: {STATUS_COLORS[post.status] || 'var(--accent)'}"></div>
										<div class="post-card-body">
											<div class="post-card-time-row">
												<span class="post-card-time">{post.time}</span>
												{#if post.status === 'published'}
													<span class="live-indicator-badge">Live Tracker</span>
												{:else}
													<span class="status-badge" style="color: {STATUS_COLORS[post.status]}; border-color: {STATUS_COLORS[post.status]}">{post.status}</span>
												{/if}
											</div>
											<p class="post-card-text">{post.text}</p>
											<div class="post-card-footer">
												<span class="post-card-agent">{post.agentName}</span>
												<div class="post-card-platforms">
													{#each post.platforms as p}
														<span class="platform-dot" style="background: {PLATFORM_COLORS[p]}" title={p}></span>
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

		<!-- Full Post Detail Modal -->
		{#if selectedPost !== null}
			{@const postDisplay = getPostDisplay(selectedPost.text)}
			<div class="modal-backdrop z-top" onclick={() => (selectedPost = null)} role="presentation">
				<div class="full-post-modal" onclick={(e) => e.stopPropagation()} role="dialog">
					<div class="modal-header">
						<h3>Post Details</h3>
						<button class="modal-close" onclick={() => (selectedPost = null)} aria-label="Close modal">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
						</button>
					</div>
					<div class="modal-body scrollable">
						<div class="detail-header-row">
							<div class="detail-agent-info">
								<span class="detail-agent-avatar" style="background: var(--gradient-subtle)">{(selectedPost.agentName || 'A')[0]}</span>
								<div class="detail-agent-text">
									<span class="detail-agent-name">{selectedPost.agentName}</span>
									<span class="detail-time-date">{selectedPost.date} at {selectedPost.time}</span>
								</div>
							</div>
							<div class="detail-status">
								{#if postDisplay.autopilot}
									<span class="ai-draft-badge" title="Generated by Autopilot">✨ AI</span>
								{/if}
								{#if selectedPost.status === 'published'}
									<span class="live-indicator-badge pulse">Live Tracker</span>
								{:else}
									<span class="status-badge-lg" style="background: {STATUS_COLORS[selectedPost.status]}15; color: {STATUS_COLORS[selectedPost.status]}; border: 1px solid {STATUS_COLORS[selectedPost.status]}30;">
										{selectedPost.status}
									</span>
								{/if}
							</div>
						</div>

						<div class="detail-content-box" style="margin-bottom: 1rem;">
							<p class="detail-text" style="font-size: var(--text-sm); line-height: 1.6; white-space: pre-wrap; margin: 0;">{postDisplay.text}</p>
						</div>

						{#if postDisplay.mediaUrl}
							<div style="margin-bottom: 1rem; max-width: 400px; border-radius: var(--radius-sm); overflow: hidden; border: 1px solid var(--border);">
								<img src={postDisplay.mediaUrl} alt="Product focus" style="width: 100%; height: auto; display: block;" />
							</div>
						{/if}

						{#if postDisplay.ugcPrompt || postDisplay.script}
							<div style="margin-bottom: 1rem; padding: 1rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: var(--text-xs); color: var(--text-dim); display: flex; flex-direction: column; gap: 0.75rem;">
								{#if postDisplay.ugcPrompt}
									<div>
										<strong style="color: var(--accent); font-size: var(--text-xs);">🎥 UGC B-Roll Prompt:</strong>
										<p style="margin: 0.25rem 0 0 0; font-style: italic; font-size: var(--text-xs);">{postDisplay.ugcPrompt}</p>
									</div>
								{/if}
								{#if postDisplay.script}
									<div>
										<strong style="color: var(--cyan); font-size: var(--text-xs);">🎬 15s Script:</strong>
										<p style="margin: 0.25rem 0 0 0; white-space: pre-wrap; font-size: var(--text-xs);">{postDisplay.script}</p>
									</div>
								{/if}
							</div>
						{/if}

						<div class="detail-meta-section">
							<div class="meta-item">
								<span class="meta-label">Platforms</span>
								<div class="meta-platforms-list">
									{#each selectedPost.platforms as p}
										<span class="platform-badge" style="background: {PLATFORM_COLORS[p]}20; color: {PLATFORM_COLORS[p]}; border: 1px solid {PLATFORM_COLORS[p]}40;">
											{p}
										</span>
									{/each}
								</div>
							</div>

							{#if selectedPost.publication_results}
								<div class="meta-item">
									<span class="meta-label">Live Links</span>
									<div class="meta-links-list" style="display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.5rem;">
										{#each Object.keys(selectedPost.publication_results) as platform}
											{#if selectedPost.publication_results[platform]?.permalink}
												<a
													href={selectedPost.publication_results[platform].permalink}
													target="_blank"
													rel="noopener noreferrer"
													style="display: inline-flex; align-items: center; gap: 0.25rem; font-size: var(--text-xs); text-decoration: none; color: var(--accent); font-weight: 600;"
												>
													View on {platform.charAt(0).toUpperCase() + platform.slice(1)} ↗
												</a>
											{/if}
										{/each}
									</div>
								</div>
							{/if}
						</div>
					</div>
					<div class="modal-footer" style="justify-content: space-between;">
						<button
							class="btn-sm"
							style="background: var(--error)15; color: var(--error); border: 1px solid var(--error)40; font-weight: 600; opacity: {deletingPost ? 0.5 : 1}; cursor: {deletingPost ? 'not-allowed' : 'pointer'};"
							onclick={deletePost}
							disabled={deletingPost}
						>
							{deletingPost ? 'Deleting…' : 'Delete Post'}
						</button>
						<span style="display: inline-flex; gap: 0.5rem;">{#if selectedPost.status === 'draft'}<button class="btn-primary btn-sm" onclick={() => selectedPost && approvePost(selectedPost)} disabled={approving}>{approving ? 'Approving…' : '✓ Approve & Schedule'}</button>{/if}<button class="btn-ghost btn-sm" onclick={() => (selectedPost = null)}>Close</button></span>
					</div>
				</div>
			</div>
		{/if}

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
										<span class="platform-badge" style="background: {PLATFORM_COLORS[entry.platform] || 'var(--accent)'}20; color: {PLATFORM_COLORS[entry.platform] || 'var(--accent)'}; border: 1px solid {PLATFORM_COLORS[entry.platform] || 'var(--accent)'}40;">
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
											style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: var(--text-sm); font-weight: 700; text-decoration: none; color: {PLATFORM_COLORS[entry.platform] || 'var(--accent)'};"
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
								{#each allBlueprints as bp}
									<option value={bp.id}>{bp.name} ({bp.platform} - {bp.score} pts)</option>
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
								{@const color = PLATFORM_COLORS[key] || 'var(--accent)'}
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

	/* ── Autopilot bar ── */
	.autopilot-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 0.85rem 1.1rem;
		margin-bottom: 1.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		transition: border-color 0.2s, background 0.2s;
	}

	.autopilot-bar.active {
		border-color: var(--accent-mid);
		background: var(--accent-soft);
	}

	.ap-main {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		min-width: 0;
	}

	.ap-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.ap-title {
		font-size: var(--text-sm);
		font-weight: var(--weight-bold);
		color: var(--text);
	}

	.ap-sub {
		font-size: var(--text-xs);
		color: var(--text-muted);
		max-width: 64ch;
	}

	.ap-controls {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.ap-window {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: var(--text-xs);
		color: var(--text-dim);
	}

	.ap-window select {
		padding: 0.3rem 0.4rem;
		font-size: var(--text-xs);
		border-radius: var(--radius-xs);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
	}

	.ap-switch {
		position: relative;
		display: inline-block;
		width: 42px;
		height: 24px;
		flex-shrink: 0;
		cursor: pointer;
	}

	.ap-switch input {
		opacity: 0;
		width: 0;
		height: 0;
	}

	.ap-slider {
		position: absolute;
		inset: 0;
		background: var(--surface-3);
		border: 1px solid var(--border);
		border-radius: 999px;
		transition: background 0.2s;
	}

	.ap-slider::before {
		content: '';
		position: absolute;
		height: 18px;
		width: 18px;
		left: 2px;
		top: 2px;
		background: #fff;
		border-radius: 50%;
		transition: transform 0.2s;
	}

	.ap-switch input:checked + .ap-slider {
		background: var(--accent);
		border-color: var(--accent);
	}

	.ap-switch input:checked + .ap-slider::before {
		transform: translateX(18px);
	}

	.ai-draft-badge {
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		background: var(--gradient-subtle);
		color: #fff;
		padding: 3px 7px;
		border-radius: 4px;
		margin-right: 0.4rem;
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

	.day-modal,
	.full-post-modal {
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

	.full-post-modal {
		max-width: 600px;
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

	.modal-body.scrollable {
		max-height: 60vh;
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

	.live-indicator-badge.pulse {
		animation: heartBeat 2s infinite;
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

	/* Detail Modal Styles */
	.detail-header-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.detail-agent-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.detail-agent-avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: var(--text-md);
		box-shadow: 0 4px 10px rgba(124, 106, 237, 0.2);
	}

	.detail-agent-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.detail-agent-name {
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--text);
	}

	.detail-time-date {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.status-badge-lg {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		padding: 4px 10px;
		border-radius: 99px;
		letter-spacing: 0.05em;
	}

	.detail-content-box {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 1.25rem;
		margin-bottom: 1.5rem;
		white-space: pre-wrap;
	}

	.detail-text {
		font-size: var(--text-sm);
		line-height: var(--leading-relaxed);
		color: var(--text);
		margin: 0;
	}

	.detail-meta-section {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.meta-item {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.meta-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		color: var(--text-dim);
	}

	.meta-platforms-list {
		display: flex;
		gap: 0.5rem;
	}

	.platform-badge {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: capitalize;
		padding: 4px 10px;
		border-radius: 6px;
	}

	.analytics-detailed-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
		gap: 0.75rem;
	}

	.metric-card {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		padding: 0.75rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		transition: border-color 0.2s;
	}

	.metric-card:hover {
		border-color: var(--accent-mid);
	}

	.metric-icon {
		font-size: 1.25rem;
	}

	.metric-val {
		font-size: var(--text-base);
		font-weight: 700;
		color: var(--text);
		font-family: var(--font-display);
	}

	.metric-lbl {
		font-size: 10px;
		color: var(--text-muted);
		text-transform: uppercase;
		font-weight: 600;
	}

	.cost-item {
		background: rgba(16, 185, 129, 0.05);
		border: 1px dashed rgba(16, 185, 129, 0.2);
		border-radius: var(--radius-xs);
		padding: 0.75rem 1rem;
	}

	.cost-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-sm);
	}

	.cost-label {
		font-weight: 600;
		color: var(--text-dim);
		flex: 1;
	}

	.cost-value {
		font-family: var(--font-mono);
		font-weight: 700;
		color: #10b981;
	}

	.link-item {
		margin-top: 0.25rem;
	}

	.live-post-link {
		font-size: var(--text-sm);
		color: var(--accent);
		text-decoration: none;
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		width: fit-content;
	}

	.live-post-link:hover {
		color: var(--accent-mid);
		text-decoration: underline;
	}

	/* Animations */
	@keyframes heartBeat {
		0% { transform: scale(1); }
		14% { transform: scale(1.05); }
		28% { transform: scale(1); }
		42% { transform: scale(1.05); }
		70% { transform: scale(1); }
	}

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
