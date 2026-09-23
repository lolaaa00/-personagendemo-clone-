<script lang="ts">
	import { resolve } from '$app/paths';
	import { dialog } from '$lib/actions/dialog';
	import { onMount } from 'svelte';
	import type { Agent, AutonomyLevel } from '$lib/types';
	import { showToast } from '$lib/stores/ui.svelte';
	import { Posts, ContentForge, type AutopilotView } from '$lib/services/api';
	import { invalidateAll } from '$app/navigation';
	import GenerationComposer from '$lib/components/generation/GenerationComposer.svelte';
	import CampaignPlanner from '$lib/components/generation/CampaignPlanner.svelte';
	import type { ComposerSpec } from '$lib/components/generation/types';
	import { startGeneration, finishGeneration, failGeneration } from '$lib/stores/generations.svelte';
	import PostDrawer from '$lib/components/feed/PostDrawer.svelte';
	import CalendarView from '$lib/components/calendar/CalendarView.svelte';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import SelectionToolbar from '$lib/components/ui/SelectionToolbar.svelte';
	import { getPostDisplay as sharedGetPostDisplay } from '$lib/components/feed/postDisplay';
	import { platformColor } from '$lib/platforms';
	import { confirmDeletePosts } from '$lib/confirm-preview';
	import { countLabel } from '$lib/plural';
	import PageShell from '$lib/components/ui/PageShell.svelte';
	import { refreshCredits } from '$lib/credits-refresh';

	interface ScheduledPost {
		id: string;
		agentId: string;
		agentName: string;
		text: string;
		platforms: string[];
		date: string; // YYYY-MM-DD
		time: string;
		status: 'scheduled' | 'draft' | 'published' | 'failed' | 'publishing' | 'partial' | 'rejected' | 'generating';
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
	// '' = All Personas — bound to CalendarView's rail; also the composer's
	// default target persona.
	let selectedAgentId = $state('');
	let selectedPost = $state<ScheduledPost | null>(null);
	let showComposer = $state(false);
	let composerSubmitting = $state(false);

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

	/** The distinct zones the calendar's slots are written in. */
	let calendarZones = $derived([
		...new Set((Object.values(data?.autopilotConfigs ?? {}) as AutopilotView[]).map((c) => c.timezone).filter(Boolean))
	] as string[]);
	let dbBlueprints = $derived(data.blueprints || []);
	let selectedBlueprintId = $state<string | null>('');

	let forgeTopic = $state('');
	let forgeProductId = $state('');
	let forging = $state(false);

	let products = $state<any[]>([]);
	let ugcGuidelines = $state('');

	onMount(() => {
		const LS_KEY = 'personagen_brand_brief';
		try {
			const saved = localStorage.getItem(LS_KEY);
			if (saved) {
				const d = JSON.parse(saved);
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
			const res = await ContentForge.generate(
				composerAgentId,
				enrichedTopic,
				platforms[0],
				selectedBlueprintId || undefined,
				forgeProductId || undefined
			);

			if (res.success && res.data) {
				// The engine returns a full UgcContent pack — its caption field is
				// `text`. Reading `.content` (always undefined) silently discarded a
				// PAID generation while toasting success.
				const forged = res.data as any;
				composerText = forged.text || '';
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

	// Calendar view logic (dates, cells, views, filters) lives in CalendarView.

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
			showToast('Select a persona', 'warning');
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
						agentName: agent?.name || 'Persona',
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
		// The drawer forwards its Delete straight here now — its old two-click
		// footer confirm was replaced by this dialog, which shows what's going.
		if (!(await confirmDeletePosts([selectedPost]))) return;
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
				pruneSelection();

				if (teardown?.unpublished?.length) {
					showToast(
						`Removed from ${teardown.unpublished.join(', ')} and moved to Trash`,
						'success'
					);
				} else {
					showToast('Moved to Trash — restorable for 30 days', 'success');
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

	// ── Manageability: multi-select, bulk delete/approve, enlarge ─────────────
	// CalendarView is read-only presentation (it emits open/approve/generate and
	// owns no mutations), so the bulk half of the contract lives here: one list
	// of everything in scope with checkboxes, the shared SelectionToolbar, and
	// thumbs that open the shared lightbox. Row click still opens the same
	// PostDrawer that does edit / reschedule / single delete.
	let manageOpen = $state(false);
	let manageStatusFilter = $state('');
	let selectedPostIds = $state<Set<string>>(new Set());
	let bulkDeleting = $state(false);
	let bulkApproving = $state(false);
	let lightbox = $state<{ url: string; label: string } | null>(null);

	/** Bridges the page's view-mapped ScheduledPost (text, not content) onto the shared util. */
	function getPostDisplay(p: ScheduledPost) {
		return sharedGetPostDisplay({ content: p.text, publication_results: p.publication_results });
	}

	/** Best displayable still: poster first, else the image (never a raw video file). */
	function getPostThumb(p: ScheduledPost): string | null {
		const d = getPostDisplay(p);
		if (d.posterUrl) return d.posterUrl;
		if (d.mediaUrl && d.mediaType !== 'video') return d.mediaUrl;
		return null;
	}

	function openLightbox(p: ScheduledPost) {
		const url = getPostThumb(p);
		// A video with no poster still has nothing to enlarge — the drawer plays it.
		if (!url) return;
		const text = getPostDisplay(p).text;
		lightbox = {
			url,
			label: text ? String(text).slice(0, 80) : `${p.agentName} · ${p.date} ${p.time}`
		};
	}

	/** Everything the manage list can act on: the rail's persona scope + status filter. */
	let managePosts = $derived(
		posts
			.filter((p) => !selectedAgentId || p.agentId === selectedAgentId)
			.filter((p) => !manageStatusFilter || p.status === manageStatusFilter)
			.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
	);

	// Counts are scoped to the visible list, so a selection made under one
	// persona filter can never be bulk-deleted from behind another one.
	let manageSelectedIds = $derived(
		managePosts.filter((p) => selectedPostIds.has(p.id)).map((p) => p.id)
	);
	let manageSelectedDrafts = $derived(
		managePosts.filter((p) => selectedPostIds.has(p.id) && p.status === 'draft')
	);

	function togglePostSelected(id: string) {
		const next = new Set(selectedPostIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedPostIds = next;
	}

	function selectAllManage() {
		const next = new Set(selectedPostIds);
		for (const p of managePosts) next.add(p.id);
		selectedPostIds = next;
	}

	function clearManageSelection() {
		const next = new Set(selectedPostIds);
		for (const p of managePosts) next.delete(p.id);
		selectedPostIds = next;
	}

	/** Drops ids whose rows no longer exist, so a selection can't outlive its posts. */
	function pruneSelection() {
		const live = new Set(posts.map((p) => p.id));
		const kept = [...selectedPostIds].filter((id) => live.has(id));
		if (kept.length !== selectedPostIds.size) selectedPostIds = new Set(kept);
	}

	/** The posts API puts `deleted` / `requested` / `teardown` at the TOP level of the
	 *  body, not under `data` — read both shapes so this can't silently be undefined. */
	type Teardown = {
		unpublished: string[];
		manualDeletion: Array<{ platform: string; permalink: string | null }>;
		errors: string[];
	};
	function deleteBody(res: unknown) {
		const body = (res as any) ?? {};
		const nested = body.data ?? {};
		return {
			deleted: (body.deleted ?? nested.deleted) as number | undefined,
			requested: (body.requested ?? nested.requested) as number | undefined,
			teardown: (body.teardown ?? nested.teardown) as Teardown | undefined
		};
	}

	/** Pulls the server's truth back in — the load function is the only place that
	 *  maps DB rows into this page's shape. */
	async function resyncPosts() {
		await invalidateAll();
		posts = data.realPosts ?? [];
		const open = selectedPost;
		if (open && !posts.some((p) => p.id === open.id)) selectedPost = null;
		pruneSelection();
	}

	async function bulkDeleteSelected() {
		const ids = manageSelectedIds;
		if (ids.length === 0 || bulkDeleting) return;
		const targets = posts.filter((p) => ids.includes(p.id));
		if (!(await confirmDeletePosts(targets.length ? targets : ids.map((id) => ({ id }))))) return;

		bulkDeleting = true;
		try {
			const res = await Posts.deleteMany(ids);
			if (!res.success) {
				showToast(res.error || 'Bulk delete failed', 'error');
				return;
			}
			const { deleted, requested, teardown } = deleteBody(res);
			const gone = deleted ?? ids.length;
			const asked = requested ?? ids.length;

			// Platforms with no API teardown (Instagram, TikTok…) reuse the same
			// manual-deletion notice the single delete shows.
			if (teardown?.manualDeletion?.length) manualDeleteNotice = teardown.manualDeletion;

			if (gone < asked) {
				// The API answers with counts, not with which ids survived — dropping
				// all of them locally would claim deletions that never happened.
				showToast(
					`Trashed ${gone} of ${asked} — the rest weren't found or aren't yours. Reloading the calendar.`,
					'warning'
				);
				await resyncPosts();
				return;
			}

			const removed = new Set(ids);
			posts = posts.filter((p) => !removed.has(p.id));
			if (selectedPost && removed.has(selectedPost.id)) selectedPost = null;
			pruneSelection();
			showToast(
				teardown?.unpublished?.length
					? `Moved ${countLabel(gone, 'post')} to Trash — also removed from ${teardown.unpublished.join(', ')}`
					: `Moved ${countLabel(gone, 'post')} to Trash — restorable for 30 days`,
				'success'
			);
		} catch (err: any) {
			showToast(err.message || 'Error deleting posts', 'error');
		} finally {
			bulkDeleting = false;
		}
	}

	/** Bulk approve — the same per-post update the drawer's Approve does, so a
	 *  batch of autopilot drafts is one click from scheduled. */
	async function bulkApproveSelected() {
		const drafts = manageSelectedDrafts;
		if (drafts.length === 0 || bulkApproving) return;
		bulkApproving = true;
		try {
			const done = new Set<string>();
			for (const d of drafts) {
				const res = await Posts.update(d.id, { status: 'scheduled' });
				if (res.success) done.add(d.id);
			}
			if (done.size > 0) {
				posts = posts.map((p) => (done.has(p.id) ? { ...p, status: 'scheduled' } : p));
				if (selectedPost && done.has(selectedPost.id))
					selectedPost = { ...selectedPost, status: 'scheduled' };
			}
			if (done.size === drafts.length) {
				showToast(`Approved ${countLabel(done.size, 'draft')}`, 'success');
			} else {
				showToast(
					`Approved ${done.size} of ${countLabel(drafts.length, 'draft')} — the rest failed and are still drafts`,
					'warning'
				);
			}
		} catch (err: any) {
			showToast(err.message || 'Error approving drafts', 'error');
		} finally {
			bulkApproving = false;
		}
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

	async function saveAsDraft() {
		const selectedPlatforms = Object.entries(composerPlatforms)
			.filter(([, v]) => v)
			.map(([k]) => k);
		if (!composerAgentId) { showToast('Select a persona', 'warning'); return; }
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
						agentName: agent?.name || 'Persona',
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

	let generatingPost = $state(false);

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

	// ── Generate confirmation (no surprise generations, no surprise spend) ──
	// All cost/consequence claims live in GenerationComposer's server-resolved
	// preview — this page keeps NO client-side price math that could drift.
	let composerSpec = $state<ComposerSpec | null>(null);
	let composerOpen = $state(false);

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

	// Date context from the calendar's day "+" buttons; null = no prefill.
	let genDate = $state<string | null>(null);

	// Campaign planner: fill a horizon with a content-mix of drafts in one pass.
	let campaignOpen = $state(false);
	// Deep entry from Studio's "Plan a campaign" button: /calendar?campaign=1
	// opens the planner immediately, then drops the param so refresh/back
	// doesn't re-open it.
	onMount(() => {
		const url = new URL(window.location.href);
		if (url.searchParams.get('campaign') === '1') {
			campaignOpen = true;
			url.searchParams.delete('campaign');
			history.replaceState(history.state, '', url);
		}
	});
	async function handleCampaignLaunched(queued: number) {
		if (queued > 0) {
			showToast(
				`${countLabel(queued, 'draft')} queued — they appear on their slots as they generate`,
				'success'
			);
			await resyncPosts();
		}
	}

	function buildGenSpec(agentId: string): ComposerSpec {
		const agent = data.agents.find((a: Agent) => a.id === agentId);
		return {
			endpoint: `/api/agent/${agentId}/generate-post`,
			...(genDate ? { baseBody: { scheduled_date: genDate } } : {}),
			title: `Generate a post for ${agent?.name ?? 'this persona'}`,
			subtitle: 'Everything below is what will actually be sent. Edit anything before approving.',
			confirmLabel: 'Approve & generate'
		};
	}

	function requestGeneratePost(dateStr?: string | null) {
		const targetAgentId = selectedAgentId || (data.agents.length > 0 ? data.agents[0].id : '');
		if (!targetAgentId) {
			showToast('Please select or configure a persona first', 'warning');
			return;
		}
		// The header button passes a MouseEvent; only the calendar passes a date.
		genDate = typeof dateStr === 'string' ? dateStr : null;
		genAgentId = targetAgentId;
		composerSpec = buildGenSpec(targetAgentId);
		composerOpen = true;
	}

	/** Persona switched inside the composer: rebuild the spec so it re-resolves. */
	function handleComposerAgentChange(id: string) {
		genAgentId = id;
		composerSpec = buildGenSpec(id);
	}

	/**
	 * The SAVED autonomy level of the persona the composer is aimed at.
	 *
	 * Read from `autopilotConfigs`, not from `data.agents[].autonomy_level`: the
	 * column lives on `agent_configs`, which is the row generate-post reads, and
	 * is the one `autopilotConfigs[].mode` mirrors. (`agents.autonomy_level` does
	 * not exist, so the load's `a.autonomy_level ?? 'advisor'` is always the
	 * fallback.) Undefined stays undefined → the composer treats it as held,
	 * which is what the route does too.
	 */
	let composerAutonomy = $derived(
		(data?.autopilotConfigs?.[genAgentId]?.mode ?? null) as AutonomyLevel | null
	);

	/**
	 * What actually happened to the row, in the words of the row itself.
	 *
	 * "Post generated" was said for a draft the server had deliberately held for
	 * review — the one case where the user has to go somewhere to finish the job.
	 */
	function postOutcomeMessage(status: string | null | undefined): string {
		if (status === 'published') return 'Post generated and published!';
		if (status === 'scheduled') return 'Post generated and scheduled.';
		return 'Post generated — held as a draft in the review queue. Approve it there to publish.';
	}

	async function generatePostNow(approved: Record<string, unknown> = {}) {
		if (generatingPost) return; // a second approve mid-poll would double-spend
		const targetAgentId =
			genAgentId || selectedAgentId || (data.agents.length > 0 ? data.agents[0].id : '');
		if (!targetAgentId) {
			showToast('Please select or configure a persona first', 'warning');
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
					showToast(postOutcomeMessage(post.status), 'success');
					await resyncPosts();
					return;
				}
				failGeneration(jobId, 'Timed out waiting for the generation to finish');
				showToast('Still generating — check the feed shortly', 'warning');
				return;
			}

			if (res.ok && result.success) {
				finishGeneration(jobId);
				// Legacy synchronous completion. The response says which of the three
				// endings happened — read it rather than assuming the happy one.
				showToast(
					postOutcomeMessage(
						result?.draft ? 'draft' : result?.published ? 'published' : 'scheduled'
					),
					'success'
				);
				if (result.post) {
					const agent = data.agents.find((a: any) => a.id === targetAgentId);
					posts = [
						...posts,
						{
							id: result.post.id,
							agentId: result.post.agent_id,
							agentName: agent?.name || 'Persona',
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
			// The wallet may have moved; the pill is loaded by the layout and would
			// otherwise keep showing the pre-generation number until a navigation.
			void refreshCredits();
		}
	}
</script>

<PageShell
	title="Content Calendar"
	width="wide"
	description="Schedule and manage posts across all personas and platforms."
>
	{#snippet actions()}
		<div class="header-actions">
			<button
				class="btn-ghost btn-campaign"
				disabled={data.agents.length === 0}
				title={data.agents.length === 0
					? 'Create a persona first — a campaign fills the calendar for one'
					: 'Fill the calendar with a mix of content — drafts for your review'}
				onclick={() => (campaignOpen = true)}
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path
						d="M8 2v4"
					/><path d="M3 10h18" /><path d="M8 14h.01" /><path d="M12 14h.01" /><path
						d="M16 14h.01"
					/><path d="M8 18h.01" /><path d="M12 18h.01" /></svg
				>
				Plan Campaign
			</button>
			<!-- With no persona there is nobody to post as: the form opened with an empty
			     Persona select and enabled Save/Schedule (re-audit N14). Disabled, with
			     the reason, like Plan Campaign beside it. -->
			<button
				class="btn-ghost"
				onclick={openComposer}
				disabled={data.agents.length === 0}
				title={data.agents.length === 0
					? 'Create a persona first — a post needs someone to post as'
					: 'Write a post yourself — nothing is generated until you ask for it'}
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg
				>
				Write a post
			</button>
			<button
				class="btn-primary"
				disabled={generatingPost || data.agents.length === 0}
				title={data.agents.length === 0 ? 'Create a persona first — generation writes as one' : undefined}
				onclick={() => requestGeneratePost()}
				style="display: inline-flex; align-items: center; gap: 0.5rem; background: var(--gradient-cta); border-color: transparent; white-space: nowrap;"
			>
				{#if generatingPost}
					<span class="spinner"></span> Generating...
				{:else}
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
						><path d="M9.94 14.06 3 21" /><path
							d="M14 4.5 15.5 8l3.5 1.5-3.5 1.5L14 14.5 12.5 11 9 9.5 12.5 8 14 4.5z"
						/><path d="M5 3v4" /><path d="M3 5h4" /><path d="M19 17v4" /><path d="M17 19h4" /></svg
					>
					Generate Post Now
				{/if}
			</button>
		</div>
	{/snippet}

	<!-- Bulk manage: the calendar grid is read-only presentation, so multi-select,
	     bulk delete / approve and enlarge live on the page next to it. -->
	<div class="manage-bar">
		<button
			type="button"
			class="btn-ghost btn-sm"
			onclick={() => (manageOpen = !manageOpen)}
			aria-expanded={manageOpen}
		>
			{#if manageOpen}
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg
				>
				Close manage
			{:else}
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m9 12 2 2 4-4" /></svg
				>
				Manage posts
			{/if}
			{#if manageSelectedIds.length > 0}<span class="manage-count"
					>{manageSelectedIds.length} selected</span
				>{/if}
		</button>
		{#if manageOpen}
			<select
				class="manage-filter"
				bind:value={manageStatusFilter}
				aria-label="Filter the manage list by status"
			>
				<option value="">All statuses</option>
				<option value="generating">Generating</option>
				<option value="draft">Draft</option>
				<option value="scheduled">Scheduled</option>
				<option value="publishing">Publishing</option>
				<option value="published">Published</option>
				<option value="partial">Partly published</option>
				<option value="rejected">Rejected</option>
				<option value="failed">Failed</option>
			</select>
			<span class="manage-hint">Tap a row to edit · tap a thumbnail to enlarge</span>
		{/if}
	</div>

	{#if manageOpen}
		<div class="manage-panel">
			<SelectionToolbar
				total={managePosts.length}
				selectedCount={manageSelectedIds.length}
				noun="post"
				busy={bulkDeleting}
				onSelectAll={selectAllManage}
				onClear={clearManageSelection}
				onDelete={bulkDeleteSelected}
			>
				{#snippet actions()}
					{#if manageSelectedDrafts.length > 0}
						<button
							type="button"
							class="btn-ghost btn-sm"
							onclick={bulkApproveSelected}
							disabled={bulkApproving || bulkDeleting}
						>
							{#if !bulkApproving}
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg
								>
							{/if}
							{bulkApproving
								? 'Approving…'
								: `Approve ${countLabel(manageSelectedDrafts.length, 'draft')}`}
						</button>
					{/if}
				{/snippet}
			</SelectionToolbar>

			<div class="manage-list">
				{#each managePosts as post (post.id)}
					{@const thumb = getPostThumb(post)}
					<div class="manage-row" class:row-selected={selectedPostIds.has(post.id)}>
						<!-- The checkbox stops propagation so selecting never opens the drawer. -->
						<label class="row-pick">
							<input
								type="checkbox"
								checked={selectedPostIds.has(post.id)}
								onclick={(e) => e.stopPropagation()}
								onchange={() => togglePostSelected(post.id)}
								aria-label="Select the {post.date} {post.time} post"
							/>
						</label>
						{#if thumb}
							<button
								type="button"
								class="thumb-zoom"
								onclick={() => openLightbox(post)}
								title="Enlarge"
								aria-label="Enlarge this post's image"
							>
								<img
									class="manage-thumb"
									src={thumb}
									alt=""
									width="44"
									height="44"
									loading="lazy"
								/>
								<span class="thumb-zoom-badge">
									<svg
										width="10"
										height="10"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2.5"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
										><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path
											d="M3 21l7-7"
										/></svg
									>
								</span>
							</button>
						{:else}
							<div class="manage-thumb manage-thumb-empty">
								<svg
									width="18"
									height="18"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
									><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path
										d="M14 2v5h5"
									/><path d="M8 13h8" /><path d="M8 17h5" /></svg
								>
							</div>
						{/if}
						<button
							type="button"
							class="manage-open"
							onclick={() => (selectedPost = post)}
							title="Open this post"
						>
							<span class="manage-when">{post.date} · {post.time}</span>
							<span class="manage-text">{getPostDisplay(post).text}</span>
							<span class="manage-meta">
								<span class="manage-agent">{post.agentName}</span>
								{#each post.platforms as p}
									<span class="platform-tag" style="color: {platformColor(p)}">{p}</span>
								{/each}
							</span>
						</button>
						<span class="manage-status status-{post.status}">{post.status}</span>
					</div>
				{:else}
					<p class="manage-empty">No posts match this filter.</p>
				{/each}
			</div>
		</div>
	{/if}

	<!-- With no persona every create action is disabled — and a disabled button
	     cannot say why to a keyboard or touch user (its title is unreachable). So
	     the reason is visible text, and the per-day "+" is not offered at all
	     (it was live, and answered with a toast). Round-2 re-audit, N14. -->
	{#if data.agents.length === 0}
		<p class="cal-no-persona">
			You don't have a persona yet, so there is no one to post as. <a
				href={resolve('/(portal)/generator')}>Create your first persona</a
			> — then plan, write or generate posts here.
		</p>
	{/if}

	<!-- A slot is a wall-clock time in its persona's own zone, not the
	     viewer's. Say which, or "10:00" is ambiguous across zones (re-audit). -->
	{#if calendarZones.length === 1}
		<p class="cal-zone-note">Times are in {calendarZones[0].replace(/_/g, ' ')} — the persona's own time zone.</p>
	{:else if calendarZones.length > 1}
		<p class="cal-zone-note">Times are in each persona's own time zone ({calendarZones.map((z) => z.replace(/_/g, ' ')).join(', ')}).</p>
	{/if}

	<!-- Shared calendar: views, rail, analytics strip, day modal. The page
	     keeps ownership of every mutation (drawer, approve, generate). -->
	<CalendarView
		posts={posts}
		agents={data.agents}
		bind:selectedAgentId
		onOpenPost={(p) => (selectedPost = p as any)}
		onApprove={(p) => approvePost(p as any)}
		onGenerateForDate={data.agents.length > 0 ? (d) => requestGeneratePost(d) : undefined}
	/>

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

		<!-- Enlarge: one shared lightbox for every thumbnail on the page -->
		<ImageLightbox
			url={lightbox?.url ?? null}
			label={lightbox?.label ?? ''}
			type={null}
			poster={null}
			onClose={() => (lightbox = null)}
		/>

		<!-- Manual Deletion Notice (platforms with no API teardown, e.g. Instagram) -->
		{#if manualDeleteNotice !== null}
			<div class="modal-backdrop z-top">
				<button
					type="button"
					class="overlay-dismiss"
					aria-label="Close the manual deletion notice"
					onclick={() => (manualDeleteNotice = null)}
				></button>
				<div
					class="day-modal"
					role="dialog"
					aria-modal="true"
					aria-labelledby="manual-delete-title"
					tabindex="-1"
					style="max-width: 460px;"
					use:dialog={{ onClose: () => (manualDeleteNotice = null) }}
				>
					<div class="modal-header">
						<h2 id="manual-delete-title">Removed locally — 1 step left</h2>
						<button type="button" class="modal-close" onclick={() => (manualDeleteNotice = null)} aria-label="Close">
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
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
											style="display: inline-flex; align-items: center; gap: 0.4rem; min-height: 44px; font-size: var(--text-sm); font-weight: 700; text-decoration: none; color: {platformColor(entry.platform)};"
										>
											Open {platformLabel(entry.platform)} post to delete
											<svg
												width="14"
												height="14"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												aria-hidden="true"
												><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path
													d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
												/></svg
											>
											<span class="sr-only">(opens in a new tab)</span>
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

	<!-- Composer overlay -->
	{#if showComposer}
		<div class="composer-overlay">
			<button
				type="button"
				class="overlay-dismiss"
				aria-label="Close the new post composer"
				onclick={closeComposer}
			></button>
			<div
				class="composer"
				role="dialog"
				aria-modal="true"
				aria-labelledby="composer-title"
				tabindex="-1"
				style="max-width: 600px;"
				use:dialog={{ onClose: closeComposer }}
			>
				<div class="composer-header">
					<h2 id="composer-title">Schedule New Post</h2>
					<button type="button" class="panel-close" onclick={closeComposer} aria-label="Close the composer">
						<svg
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg
						>
					</button>
				</div>

				<div
					class="composer-body"
					style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; max-height: 70dvh; overflow-y: auto;"
				>
					<!-- Persona -->
					<div class="field" style="display: flex; flex-direction: column; gap: 0.25rem;">
						<label
							for="comp-agent"
							style="font-size: var(--text-xs); font-weight: 700; text-transform: uppercase; color: var(--text-dim);"
							>Persona</label
						>
						<select
							id="comp-agent"
							bind:value={composerAgentId}
							onchange={resetPlatforms}
							style="font-size: 1rem; padding: 0.5rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
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
						<h3
							style="margin: 0; display: flex; align-items: center; gap: 0.4rem; font-size: var(--text-xs); text-transform: uppercase; letter-spacing: var(--tracking-wider); color: var(--accent-text);"
						>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
								><path d="M9.94 14.06 3 21" /><path
									d="M14 4.5 15.5 8l3.5 1.5-3.5 1.5L14 14.5 12.5 11 9 9.5 12.5 8 14 4.5z"
								/><path d="M5 3v4" /><path d="M3 5h4" /></svg
							>
							Optional: Forge with Competitor Blueprint
						</h3>

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
								style="font-size: 1rem; padding: 0.4rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
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
									style="font-size: 1rem; padding: 0.4rem 0.6rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
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
									style="font-size: 1rem; padding: 0.4rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
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
								style="background: var(--gradient-cta); color: #fff; border: none; padding: 0.45rem; min-height: 44px; font-size: var(--text-xs); font-weight: 700; border-radius: var(--radius-xs); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; margin-top: 0.25rem;"
							>
								{#if forging}
									<span
										class="spinner"
										style="width: 12px; height: 12px; border: 2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation: spin 0.6s linear infinite;"
									></span> Forging...
								{:else}
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
										><path d="M9.94 14.06 3 21" /><path
											d="M14 4.5 15.5 8l3.5 1.5-3.5 1.5L14 14.5 12.5 11 9 9.5 12.5 8 14 4.5z"
										/><path d="M5 3v4" /><path d="M3 5h4" /></svg
									>
									Forge Copy
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
							style="font-size: 1rem; padding: 0.6rem 0.75rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text); resize: vertical; line-height: 1.5;"
						></textarea>
					</div>

					<!-- Target Platforms -->
					<div
						class="field"
						role="group"
						aria-labelledby="comp-platforms-label"
						style="display: flex; flex-direction: column; gap: 0.25rem;"
					>
						<span
							id="comp-platforms-label"
							style="font-size: var(--text-xs); font-weight: 700; text-transform: uppercase; color: var(--text-dim);"
							>Target Platforms</span
						>
						<div
							class="platform-checkboxes"
							style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.25rem;"
						>
							{#each composerAgentPlatforms as key}
								{@const color = platformColor(key)}
								<label
									class="platform-checkbox"
									style="--p-color: {color}; display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.35rem 0.65rem; min-height: 44px; border: 1px solid var(--border); border-radius: var(--radius-xs); background: var(--surface-2); cursor: pointer; font-size: var(--text-xs); font-weight: 600;"
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
								style="font-size: 1rem; padding: 0.5rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
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
								style="font-size: 1rem; padding: 0.5rem; border-radius: var(--radius-xs); border: 1px solid var(--border); background: var(--surface); color: var(--text);"
							/>
						</div>
					</div>
				</div>

				<div
					class="composer-footer"
					style="padding: 1rem 1.5rem; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 0.75rem; background: var(--surface-2);"
				>
					<button type="button" class="btn-ghost btn-sm" onclick={closeComposer}>Cancel</button>
					<button type="button" class="btn-ghost btn-sm" style="border: 1px solid var(--warning); color: var(--warning-text);" onclick={saveAsDraft} disabled={composerSubmitting}>
						{#if composerSubmitting}
							<span class="spinner"></span> Saving…
						{:else}
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
								><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path
									d="M14 2v5h5"
								/><path d="M8 13h8" /><path d="M8 17h5" /></svg
							>
							Save as Draft
						{/if}
					</button>
					<button type="button" class="btn-primary btn-sm" onclick={schedulePost} disabled={composerSubmitting}>
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
								aria-hidden="true"
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
</PageShell>

<!-- Same confirm-first composer as the persona page: the server resolves the real
     payload/cost, the user edits and approves, then we run exactly that. -->
<GenerationComposer
	open={composerOpen}
	spec={composerSpec}
	cinematicBlocked={data?.entitlements?.cinematic === false
		? `Cinematic video is not included in the ${data?.entitlements?.plan ?? 'free'} plan.`
		: null}
	agents={data.agents}
	agentId={genAgentId}
	autonomyLevel={composerAutonomy}
	onAgentChange={handleComposerAgentChange}
	onClose={() => (composerOpen = false)}
	onConfirm={(body) => {
		composerOpen = false;
		void generatePostNow(body);
	}}
	onOpenPlanner={() => {
		// A run of posts is a different question from one post — cadence, horizon
		// and a format mix. The planner already asks it, so the composer hands off
		// instead of growing a second, worse version of the same screen.
		composerOpen = false;
		campaignOpen = true;
	}}
/>

<CampaignPlanner
	open={campaignOpen}
	agents={data.agents}
	initialAgentId={selectedAgentId || data.agents[0]?.id || ''}
	onClose={() => (campaignOpen = false)}
	onLaunched={handleCampaignLaunched}
/>

<style>
	.cal-no-persona {
		margin: 0 0 var(--space-4);
		padding: 0.7rem 0.9rem;
		border: 1px solid var(--border);
		border-left: 3px solid var(--text-dim);
		border-radius: var(--radius-xs);
		background: var(--surface-2);
		color: var(--text-muted);
		font-size: 0.85rem;
	}
	.page {
		position: relative;
		min-height: calc(100vh - 60px);
		display: flex;
		flex-direction: column;
	}

	/* ── Header ── */


	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.btn-campaign {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
		white-space: nowrap;
	}


	/* ── Modals (manual-deletion notice) ── */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.75);
		backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-modal);
		animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
		padding: 1.5rem;
	}

	.modal-backdrop.z-top {
		z-index: var(--z-overlay);
	}

	/* A real button behind the dialog: clicking outside stays dismissible without
	   hanging a click handler off a plain <div>, and it is keyboard reachable. */
	.overlay-dismiss {
		position: absolute;
		inset: 0;
		width: 100%;
		border: none;
		padding: 0;
		background: transparent;
		cursor: default;
	}

	.day-modal {
		position: relative;
		z-index: 1;
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
			0 20px 25px -5px rgba(0, 0, 0, 0.3),
			0 0 50px color-mix(in srgb, var(--accent) 15%, transparent);
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

	.modal-header h2 {
		font-size: var(--text-md);
		font-family: var(--font-display);
		font-weight: 600;
		margin: 0;
		color: var(--text);
	}

	/* 44x44 hit area; the glyph inside stays 18px. */
	.modal-close {
		width: 44px;
		height: 44px;
		flex-shrink: 0;
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

	.platform-badge {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: capitalize;
		padding: 4px 10px;
		border-radius: var(--radius-xs);
	}

	/* Animations */
	@keyframes scaleUp {
		from { transform: scale(0.95); opacity: 0; }
		to { transform: scale(1); opacity: 1; }
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
		position: relative;
		z-index: 1;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		width: 100%;
		max-width: 1000px;
		max-height: 90dvh;
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

	.composer-header h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: var(--text-lg);
	}

	/* Was an unstyled default button; 44x44 hit area, 18px glyph. */
	.panel-close {
		width: 44px;
		height: 44px;
		flex-shrink: 0;
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

	.panel-close:hover {
		color: var(--text);
		background: var(--border-strong);
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
		min-height: 44px;
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

	/* ── Responsive ── */
	@media (max-width: 1200px) {
		.page {
			padding: 1.5rem;
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

		.header-actions {
			width: 100%;
		}

		.header-actions .btn-campaign {
			flex: 1;
			justify-content: center;
		}
	}

	@media (max-width: 640px) {
		.field-row {
			flex-direction: column;
			gap: 1rem;
		}
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

	/* ── Bulk manage (multi-select · bulk delete/approve · enlarge) ── */
	.manage-bar {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		margin-bottom: 0.9rem;
	}

	.manage-count {
		margin-left: 0.45rem;
		color: var(--accent-text);
		font-weight: var(--weight-bold);
	}

	.manage-filter {
		/* Must stay >=16px — iOS Safari force-zooms a focused control below that. */
		font-size: 1rem;
		padding: 0.35rem 0.5rem;
		border-radius: var(--radius-xs);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
	}

	.manage-hint {
		font-size: var(--text-xs);
		color: var(--text-dim);
	}

	.manage-panel {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		padding: 0.75rem;
		margin-bottom: 1.25rem;
	}

	.manage-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		max-height: 55dvh;
		overflow-y: auto;
	}

	.manage-row {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.5rem 0.6rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		transition:
			border-color 0.2s,
			background 0.2s;
	}

	.manage-row:hover {
		border-color: var(--accent-mid);
	}

	.row-selected {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}

	/* The 16px box stays 16px; the label around it carries the 44x44 hit area. */
	.row-pick {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		flex-shrink: 0;
		cursor: pointer;
	}

	.row-pick input {
		width: 16px;
		height: 16px;
		margin: 0;
		accent-color: var(--accent);
		cursor: pointer;
	}

	/* The thumbnail enlarges; the rest of the row opens the drawer. */
	.thumb-zoom {
		position: relative;
		display: flex;
		flex-shrink: 0;
		padding: 0;
		border: none;
		background: none;
		border-radius: 8px;
		line-height: 0;
		cursor: zoom-in;
	}

	.thumb-zoom-badge {
		position: absolute;
		right: 2px;
		bottom: 2px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2px 3px;
		border-radius: 4px;
		background: rgba(10, 14, 26, 0.72);
		color: #fff;
		font-size: 0.6rem;
		line-height: 1.4;
		pointer-events: none;
	}

	.thumb-zoom:hover .thumb-zoom-badge {
		background: var(--accent-dark);
	}

	.manage-thumb {
		width: 44px;
		height: 44px;
		border-radius: 8px;
		object-fit: cover;
		border: 1px solid var(--border);
		flex-shrink: 0;
	}

	.manage-thumb-empty {
		display: grid;
		place-items: center;
		background: var(--surface-3);
		color: var(--text-dim);
		font-size: 1rem;
	}

	.manage-open {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0;
		background: none;
		border: none;
		text-align: left;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.manage-when {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text-dim);
	}

	.manage-text {
		font-size: var(--text-sm);
		color: var(--text);
		line-height: var(--leading-snug);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.manage-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.manage-agent {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.platform-tag {
		font-size: var(--text-xs);
		font-weight: var(--weight-semi);
		text-transform: capitalize;
	}

	.manage-status {
		flex-shrink: 0;
		padding: 1px 7px;
		border-radius: var(--radius-full);
		border: 1px solid var(--border);
		color: var(--text-muted);
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	/* Status is carried by the label text; colour is a redundant cue, and the -text
	   variants keep it legible in both themes. */
	.manage-status.status-draft {
		color: var(--warning-text);
		border-color: var(--warning);
	}
	.manage-status.status-scheduled {
		color: var(--info-text);
		border-color: var(--info);
	}
	.manage-status.status-publishing {
		color: var(--cyan-text);
		border-color: var(--cyan);
	}
	.manage-status.status-published {
		color: var(--success-text);
		border-color: var(--success);
	}
	.manage-status.status-partial {
		color: var(--gold);
		border-color: var(--gold);
	}
	.manage-status.status-rejected {
		color: var(--rose-text);
		border-color: var(--rose);
	}
	.manage-status.status-failed {
		color: var(--error-text);
		border-color: var(--error);
	}

	.manage-empty {
		margin: 0;
		padding: 1.25rem 0;
		text-align: center;
		font-size: var(--text-sm);
		color: var(--text-dim);
	}

	@media (max-width: 640px) {
		.manage-hint {
			display: none;
		}

		.manage-list {
			max-height: none;
		}
	}
	.cal-zone-note {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
</style>
