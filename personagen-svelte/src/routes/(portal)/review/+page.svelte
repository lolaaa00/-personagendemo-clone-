<script lang="ts">
	import { showToast as globalToast } from '$lib/stores/ui.svelte';
	import { thumbUrl, restoreOriginal } from '$lib/image-url';
	import { syncParam, readParam } from '$lib/url-state';
	import { onMount } from 'svelte';
	import { platformLabel } from '$lib/platforms';
	import PostDrawer from '$lib/components/feed/PostDrawer.svelte';
	import ManualDeleteNotice from '$lib/components/feed/ManualDeleteNotice.svelte';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import { Posts } from '$lib/services/api';
	import { SURFACE_LABEL, type PostSurface } from '$lib/components/feed/postDisplay';
	import { confirmDeletePosts } from '$lib/confirm-preview';
	import PageShell from '$lib/components/ui/PageShell.svelte';
	import { capabilities, seatBlockedReason, type SeatRole } from '$lib/seat';

	interface ReviewItem {
		id: string;
		agent_id: string;
		agent_name: string;
		agent_avatar: string | null;
		status: string;
		text: string;
		media_url: string | null;
		poster_url: string | null;
		media_type: 'image' | 'video';
		/** Output class from the SHARED classifier (same vocabulary as the library). */
		surface: PostSurface;
		template_title: string | null;
		quality_score: number | null;
		quality_issue: string | null;
		platforms: string[];
		scheduled_date: string | null;
		scheduled_time: string | null;
		/** Why this post was rejected, from the post_reviews log. */
		reject_reason: string | null;
		/** This seat's role on the post's persona, resolved by the server; absent on an older server. */
		role?: SeatRole;
	}

	/** Thumbnail-safe source: a video's mp4 URL must never land in an <img> —
	 * poster only for videos; images may fall back to their media URL. */
	function cardThumb(item: ReviewItem): string {
		if (item.media_type === 'video') return item.poster_url ?? '';
		// Was `cardThumb(item)` — an unconditional self-call, so every IMAGE item
		// (the default media_type) recursed until the stack blew and the whole
		// queue failed to render. Table is the default view and calls this on
		// every row, so one image draft took the page down.
		return item.media_url ?? item.poster_url ?? '';
	}

	let items = $state<ReviewItem[]>([]);
	let loading = $state(true);
	let working = $state(false);
	let error = $state('');
	let selected = $state<Set<string>>(new Set());

	// ── Hard delete (permanent, plus best-effort live platform teardown) ──
	// Kept separate from `working` (approve/reject) so the drawer's Approve
	// button doesn't read as busy while a delete is in flight.
	let deletingId = $state<string | null>(null);
	let bulkDeleting = $state(false);
	let deleteBusy = $derived(bulkDeleting || deletingId !== null);

	// What this seat may decide, per row. The role is the server's, resolved per
	// persona: one queue can mix personas where the same account is manager on
	// one and viewer on another. `owner` is the never-brick default for a server
	// that sends no role — nothing that could be approved yesterday is blocked.
	const blockFor = (item: ReviewItem) =>
		seatBlockedReason(capabilities(item.role ?? 'owner'), 'manager');
	/** The first reason among the selection — the bulk bar acts on all or none. */
	let bulkBlock = $derived(
		[...selected]
			.map((id) => items.find((i) => i.id === id))
			.map((i) => (i ? blockFor(i) : null))
			.find(Boolean) ?? null
	);
	/** Every row is out of this seat's reach: the queue is read-only, and says so once. */
	let queueBlock = $derived(
		items.length > 0 && items.every((i) => blockFor(i)) ? blockFor(items[0]) : null
	);
	// Platforms with no API deletion path (Instagram, TikTok, Snapchat) — the
	// live post has to be removed by hand, so we tell the user which and where.
	let manualDeleteNotice = $state<Array<{ platform: string; permalink: string | null }> | null>(
		null
	);

	// Enlarge overlay on the card media (the drawer stays the primary click).
	let lightbox = $state<{
		url: string;
		label: string;
		type: 'image' | 'video';
		poster: string | null;
	} | null>(null);

	// ── Filters (agent / platform / status), applied client-side ──
	// Filters live in the URL so a narrowed queue survives a refresh and can be
	// handed to someone else. Agent/platform are open-ended (they come from the
	// data), so they are read raw; status has a known set.
	const qp = (k: string) =>
		typeof window === 'undefined'
			? null
			: new URL(window.location.href).searchParams.get(k);
	let filterAgent = $state(qp('agent') ?? 'all');
	let filterPlatform = $state(qp('platform') ?? 'all');
	let filterStatus = $state(
		readParam('status', ['all', 'draft', 'scheduled', 'rejected'] as const, 'all')
	);
	$effect(() => syncParam('agent', filterAgent, 'all'));
	$effect(() => syncParam('platform', filterPlatform, 'all'));
	$effect(() => syncParam('status', filterStatus, 'all'));

	// Options built from whatever is actually in the queue.
	let agentOptions = $derived(
		[...new Map(items.map((i) => [i.agent_id, i.agent_name])).entries()].map(([id, name]) => ({
			id,
			name
		}))
	);
	let platformOptions = $derived([...new Set(items.flatMap((i) => i.platforms))].sort());

	let filteredItems = $derived(
		items.filter(
			(i) =>
				(filterAgent === 'all' || i.agent_id === filterAgent) &&
				(filterPlatform === 'all' || i.platforms.includes(filterPlatform)) &&
				// 'all' is the actionable queue, not literally everything: a rejected
				// post is only shown when explicitly asked for.
				(filterStatus === 'all'
					? i.status === 'draft' || i.status === 'scheduled'
					: i.status === filterStatus)
		)
	);

	const REJECT_REASONS = [
		'Warped hands / anatomy',
		'Off-brand look',
		'Wrong product',
		'Bad caption',
		'Low quality image',
		'Other'
	];
	let rejectPickerOpen = $state(false);
	/** Who the open picker acts on. Separate from `selected` on purpose: a row's
	 *  Reject targets that row and leaves the bulk selection untouched, so the
	 *  three destructive bulk buttons cannot be armed by a single-row action. */
	let rejectTargets = $state<string[]>([]);
	// No default: the page states these reasons train a QC reviewer, and a
	// pre-selected specific value makes the most common stored reason "whichever
	// was first in the array" rather than what the reviewer meant.
	let rejectReason = $state('');
	let rejectNote = $state('');

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/review');
			const d = await res.json();
			if (!res.ok || !d.success) throw new Error(d.error || 'Failed to load queue');
			items = d.items;
			selected = new Set();
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	}
	onMount(load);

	function toggle(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}
	function toggleAll() {
		const allShownSelected =
			filteredItems.length > 0 && filteredItems.every((i) => selected.has(i.id));
		selected = allShownSelected ? new Set() : new Set(filteredItems.map((i) => i.id));
	}

	// This page shipped its own toast — a third stack, at a third position, with
	// a locally-shadowed showToast() that hid the global one. Same call sites,
	// one renderer.
	function showToast(msg: string) {
		globalToast(msg, /fail|error|could not|couldn't|rejected/i.test(msg) ? 'error' : 'success');
	}

	async function act(action: 'approve' | 'reject' | 'restore', ids: string[], reason?: string) {
		if (ids.length === 0 || working) return;
		working = true;
		try {
			const res = await fetch('/api/review', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, post_ids: ids, reason })
			});
			const d = await res.json();
			if (!res.ok || !d.success) throw new Error(d.error || 'Action failed');
			// Update the row in place rather than removing it.
			//
			// This used to be `items.filter(i => !ids.includes(i.id))`, which
			// dropped the row unconditionally. The default filter is "all", which
			// still matches an approved post, so the count went 14 → 13 while the
			// server held 14 — press Back and all 14 returned. Approving the whole
			// queue showed "Queue is clear" over work that was still there. The one
			// number telling an operator whether their morning is done was wrong.
			//
			// `filteredItems` already hides anything the active filter excludes, so
			// setting the new status is enough: the row stays under "all" and
			// disappears under "Draft only", which is what each filter means.
			const nextStatus =
				action === 'approve' ? 'scheduled' : action === 'restore' ? 'draft' : 'rejected';
			items = items.map((i) =>
				ids.includes(i.id)
					? { ...i, status: nextStatus, reject_reason: action === 'restore' ? null : i.reject_reason }
					: i
			);
			selected = new Set([...selected].filter((id) => !ids.includes(id)));
			if (drawerPost && ids.includes(drawerPost.id)) drawerPost = null;
			const noun = d.updated === 1 ? 'post' : 'posts';
			showToast(
				action === 'approve'
					? `✅ ${d.updated} ${noun} approved & scheduled`
					: action === 'restore'
						? `↩ ${d.updated} ${noun} returned to draft`
						: `🗑 ${d.updated} ${noun} rejected`
			);
		} catch (e: any) {
			showToast(`⚠ ${e.message}`);
		} finally {
			working = false;
			rejectPickerOpen = false;
			rejectTargets = [];
			rejectNote = '';
		}
	}

	function submitReject() {
		const reason = rejectNote.trim() ? `${rejectReason}: ${rejectNote.trim()}` : rejectReason;
		act('reject', [...rejectTargets], reason);
	}

	/** Open the picker against an explicit list, without disturbing `selected`. */
	function openRejectPicker(ids: string[]) {
		if (!ids.length) return;
		rejectTargets = ids;
		rejectReason = '';
		rejectNote = '';
		rejectPickerOpen = true;
	}

	/** The captions the open picker is about, so the user can see what they are
	 *  rejecting — the picker renders above the table, far from the row. */
	let rejectTargetLabels = $derived(
		rejectTargets
			.map((id) => items.find((i) => i.id === id))
			.filter(Boolean)
			.map((i: any) => (i.text || '').slice(0, 80))
	);

	// ── Hard delete ────────────────────────────────────────────────────────
	// Reject/Unschedule only changes status (the row survives, with a logged
	// reason). Delete is the permanent one: the row is destroyed and anything
	// already live is torn down on-platform where the API allows it.

	/** The posts API puts `teardown` / `deleted` / `requested` at the TOP level of
	 *  the response body, not under `data` — same read the calendar and persona
	 *  feed do. Tolerates both shapes so it can't silently return undefined. */
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

	/** Names the teardown outcome in the toast so it never over-claims. */
	function deletedToast(count: number, teardown?: Teardown): string {
		const noun = `${count} post${count === 1 ? '' : 's'}`;
		if (teardown?.unpublished?.length) {
			return `🗑 Trashed ${noun} — also removed from ${teardown.unpublished.join(', ')}`;
		}
		return `🗑 Moved ${noun} to Trash — restorable for 30 days`;
	}

	/**
	 * Single delete. Every entry point (card trash can AND the drawer) goes through
	 * the same dialog now — the drawer's old two-click footer confirm is gone, so
	 * there is no longer a `skipConfirm` path that deletes without asking.
	 */
	async function deletePost(id: string) {
		if (working || deleteBusy) return;
		const item = items.find((i) => i.id === id);
		if (!(await confirmDeletePosts([item ?? { id }]))) return;
		deletingId = id;
		try {
			const res = await Posts.delete(id);
			if (!res.success) {
				showToast(`⚠ ${res.error || 'Failed to delete post'}`);
				return;
			}
			const { teardown } = deleteBody(res);
			items = items.filter((i) => i.id !== id);
			selected = new Set([...selected].filter((s) => s !== id));
			if (drawerPost?.id === id) drawerPost = null;
			showToast(deletedToast(1, teardown));
			if (teardown?.manualDeletion?.length) manualDeleteNotice = teardown.manualDeletion;
		} catch (e: any) {
			showToast(`⚠ ${e.message}`);
		} finally {
			deletingId = null;
		}
	}

	/** Bulk delete for the multi-select bar. */
	async function deleteSelected() {
		const ids = [...selected];
		if (ids.length === 0 || working || deleteBusy) return;
		const targets = items.filter((i) => ids.includes(i.id));
		if (!(await confirmDeletePosts(targets.length ? targets : ids.map((id) => ({ id }))))) return;
		bulkDeleting = true;
		try {
			const res = await Posts.deleteMany(ids);
			if (!res.success) {
				showToast(`⚠ ${res.error || 'Bulk delete failed'}`);
				return;
			}
			const { deleted, requested, teardown } = deleteBody(res);
			const gone = deleted ?? ids.length;
			const asked = requested ?? ids.length;
			if (teardown?.manualDeletion?.length) manualDeleteNotice = teardown.manualDeletion;

			if (gone < asked) {
				// The API returns counts, not which ids survived, so guessing which
				// cards to drop would lie. Resync from the server instead.
				showToast(
					`⚠ Trashed ${gone} of ${asked} — the rest weren't found or aren't yours. Queue reloaded.`
				);
				await load();
				return;
			}
			// A deleted post really does leave the queue — unlike approve/reject,
			// which only change its status.
			items = items.filter((i) => !ids.includes(i.id));
			selected = new Set();
			if (drawerPost && ids.includes(drawerPost.id)) drawerPost = null;
			showToast(deletedToast(gone, teardown));
		} catch (e: any) {
			showToast(`⚠ ${e.message}`);
		} finally {
			bulkDeleting = false;
		}
	}

	/** Enlarge the card media. Videos play in the lightbox (poster while buffering). */
	function openLightbox(item: ReviewItem) {
		const isVideo = item.media_type === 'video' && !!item.media_url;
		const url = item.media_url || item.poster_url;
		if (!url) return;
		lightbox = {
			url,
			label: `${item.agent_name} · ${slotLabel(item)}`,
			type: isVideo ? 'video' : 'image',
			poster: isVideo ? item.poster_url : null
		};
	}

	// ── Inline caption editing (persists via the same /api/posts 'update'
	// action the persona feed's drawer uses — no duplicate endpoint) ──
	let editingId = $state<string | null>(null);
	let editDraft = $state('');
	let savingEdit = $state(false);

	function startEdit(item: ReviewItem) {
		editingId = item.id;
		editDraft = item.text;
	}

	async function saveEdit(item: ReviewItem) {
		if (savingEdit) return;
		savingEdit = true;
		try {
			// Fetch the full stored content first so non-caption fields
			// (media_url, script, product…) survive the edit.
			const getRes = await fetch('/api/posts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'get', id: item.id })
			});
			const got = await getRes.json();
			if (!getRes.ok || !got.success) throw new Error(got.error || 'Failed to load post');

			let parsed: any = {};
			try {
				parsed = JSON.parse(got.data.content);
			} catch {
				parsed = { text: String(got.data.content ?? '') };
			}
			parsed.text = editDraft;

			const res = await fetch('/api/posts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'update', id: item.id, content: parsed })
			});
			const d = await res.json();
			if (!res.ok || !d.success) throw new Error(d.error || 'Failed to save caption');

			items = items.map((i) => (i.id === item.id ? { ...i, text: editDraft } : i));
			editingId = null;
			showToast('✏️ Caption updated');
		} catch (e: any) {
			showToast(`⚠ ${e.message}`);
		} finally {
			savingEdit = false;
		}
	}

	function slotLabel(i: ReviewItem): string {
		if (!i.scheduled_date) return 'Unscheduled';
		return `${i.scheduled_date} · ${(i.scheduled_time || '').slice(0, 5)}`;
	}

	// ── Details drawer (same PostDrawer as the persona feed) ───────────────
	// Clicking a card's media opens the full post — playable video, generation
	// provenance (models, cost, prompts, reference images), caption edit, and
	// reschedule — while the ✓ badge keeps handling multi-select. The queue's
	// lightweight items don't carry the full content JSON, so the row is
	// fetched on open via the same /api/posts 'get' the persona feed uses.
	let drawerPost = $state<any | null>(null);
	let drawerAvatar = $state<string | null>(null);
	let drawerLoadingId = $state<string | null>(null);

	async function openDrawer(item: ReviewItem) {
		if (drawerLoadingId) return;
		drawerLoadingId = item.id;
		try {
			const res = await fetch('/api/posts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'get', id: item.id })
			});
			const d = await res.json();
			if (!res.ok || !d.success) throw new Error(d.error || 'Failed to load post details');
			drawerAvatar = item.agent_avatar;
			drawerPost = d.data;
		} catch (e: any) {
			showToast(`⚠ ${e.message}`);
		} finally {
			drawerLoadingId = null;
		}
	}

	// Reject from the drawer routes through the existing reason picker so the
	// decision (+ reason) still lands in post_reviews.
	function drawerReject(post: any) {
		drawerPost = null;
		openRejectPicker([post.id]);
	}

	async function drawerSaveText(post: any, newText: string): Promise<boolean> {
		try {
			let parsed: any = {};
			try {
				parsed = JSON.parse(post.content);
			} catch {
				parsed = { text: String(post.content ?? '') };
			}
			parsed.text = newText;
			const res = await fetch('/api/posts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'update', id: post.id, content: parsed })
			});
			const d = await res.json();
			if (!res.ok || !d.success) throw new Error(d.error || 'Failed to save caption');
			const serialized = JSON.stringify(parsed);
			items = items.map((i) => (i.id === post.id ? { ...i, text: newText } : i));
			if (drawerPost?.id === post.id) drawerPost = { ...drawerPost, content: serialized };
			showToast('✏️ Caption updated');
			return true;
		} catch (e: any) {
			showToast(`⚠ ${e.message}`);
			return false;
		}
	}

	async function drawerReschedule(post: any, date: string, time: string): Promise<boolean> {
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
			const d = await res.json();
			if (!res.ok || !d.success) throw new Error(d.error || 'Failed to reschedule');
			items = items.map((i) =>
				i.id === post.id ? { ...i, scheduled_date: date, scheduled_time: time } : i
			);
			if (drawerPost?.id === post.id)
				drawerPost = { ...drawerPost, scheduled_date: date, scheduled_time: time };
			showToast(`📅 Rescheduled to ${date} · ${time.slice(0, 5)}`);
			return true;
		} catch (e: any) {
			showToast(`⚠ ${e.message}`);
			return false;
		}
	}

	// ═══ View modes ════════════════════════════════════════════════════════
	// Five ways to see the same queue, all driving the same handlers above.
	// Preference persists per-browser; first visit defaults by pointer type
	// (deck for phones, table for desktops).
	type ViewMode = 'table' | 'split' | 'deck' | 'board' | 'grid';
	const VIEW_STORE = 'pg-review-view';
	const VIEWS: Array<{ id: ViewMode; label: string; hint: string }> = [
		{ id: 'table', label: 'Table', hint: 'Sortable table — bulk-first' },
		{ id: 'split', label: 'Split', hint: 'List + preview pane — j/k/a/r keyboard triage' },
		{ id: 'deck', label: 'Deck', hint: 'One card at a time — built for phones' },
		{ id: 'board', label: 'Board', hint: 'Pipeline lanes: needs review · scheduled · flagged' },
		{ id: 'grid', label: 'Grid', hint: 'The original card grid' }
	];
	let viewMode = $state<ViewMode>('table');
	onMount(() => {
		const saved = localStorage.getItem(VIEW_STORE) as ViewMode | null;
		if (saved && VIEWS.some((v) => v.id === saved)) viewMode = saved;
		else if (window.matchMedia('(max-width: 767px)').matches) viewMode = 'deck';
	});
	function setView(v: ViewMode) {
		viewMode = v;
		try {
			localStorage.setItem(VIEW_STORE, v);
		} catch {
			/* private browsing — preference just won't stick */
		}
	}

	// ── Sort (table headers; split/deck/board follow the same order) ──
	let sortKey = $state<'slot' | 'qc' | 'agent'>('slot');
	let sortDir = $state<1 | -1>(1);
	function setSort(k: 'slot' | 'qc' | 'agent') {
		if (sortKey === k) sortDir = sortDir === 1 ? -1 : 1;
		else {
			sortKey = k;
			sortDir = 1; // qc ascending = worst first, the sweep-the-bottom workflow
		}
	}
	let sortedItems = $derived.by(() => {
		const arr = [...filteredItems];
		arr.sort((a, b) => {
			let cmp = 0;
			if (sortKey === 'qc') cmp = (a.quality_score ?? 11) - (b.quality_score ?? 11);
			else if (sortKey === 'agent') cmp = a.agent_name.localeCompare(b.agent_name);
			else
				cmp = `${a.scheduled_date ?? '9999'} ${a.scheduled_time ?? ''}`.localeCompare(
					`${b.scheduled_date ?? '9999'} ${b.scheduled_time ?? ''}`
				);
			return cmp * sortDir;
		});
		return arr;
	});

	// ── Cursor: the "current" item in split and deck ──
	let cursor = $state(0);
	$effect(() => {
		// Approving/rejecting removes the row; keep the cursor on a real item so
		// the next card slides into place instead of the pane going blank.
		if (cursor > sortedItems.length - 1) cursor = Math.max(0, sortedItems.length - 1);
	});
	let current = $derived(sortedItems[cursor] ?? null);

	// ── Board lanes ──
	const isFlagged = (i: ReviewItem) => i.quality_score != null && i.quality_score < 6;

	/** Nothing writes `quality_score` yet, so rendering the column spends a column
	 *  of horizontal budget on a cell reading "—" on every row — and at narrow
	 *  widths QC was one of the few columns that survived, displacing the caption
	 *  the reviewer is there to judge. It returns by itself the day scores do. */
	let hasQc = $derived(items.some((i) => i.quality_score != null));
	let laneFlagged = $derived(sortedItems.filter(isFlagged));
	let laneNeeds = $derived(sortedItems.filter((i) => i.status === 'draft' && !isFlagged(i)));
	let laneScheduled = $derived(sortedItems.filter((i) => i.status === 'scheduled' && !isFlagged(i)));
	let laneRejected = $derived(sortedItems.filter((i) => i.status === 'rejected' && !isFlagged(i)));

	/** The lanes, as statuses a post can actually be in. The flagged lane only
	 *  appears once something writes a QC score — same reason the QC column is
	 *  conditional. */
	let boardLanes = $derived([
		{ title: 'Needs review', cls: 'needs', status: 'draft', list: laneNeeds },
		{ title: 'Scheduled', cls: 'sched', status: 'scheduled', list: laneScheduled },
		{ title: 'Rejected', cls: 'rej', status: 'rejected', list: laneRejected },
		...(hasQc
			? [{ title: 'Flagged · QC < 6.0', cls: 'flag', status: '', list: laneFlagged }]
			: [])
	]);

	// ── Board drag and drop ───────────────────────────────────────────────
	// Every move maps onto an action the API already exposes, so a drag is the
	// same operation as the button — not a second, divergent code path.
	let dragId = $state<string | null>(null);
	let dragOverLane = $state<string>('');

	/** null = this move is not offered. Rejecting needs a reason, so a drop into
	 *  Rejected opens the reason picker rather than silently inventing one. */
	function moveFor(from: string, to: string): 'approve' | 'reject' | 'restore' | null {
		if (from === to) return null;
		if (from === 'draft' && to === 'scheduled') return 'approve';
		if (from === 'rejected' && to === 'draft') return 'restore';
		if (to === 'rejected' && (from === 'draft' || from === 'scheduled')) return 'reject';
		return null;
	}

	function draggedItem() {
		return dragId ? sortedItems.find((i) => i.id === dragId) : undefined;
	}

	function laneAccepts(laneStatus: string) {
		const item = draggedItem();
		return !!item && !!laneStatus && moveFor(item.status, laneStatus) !== null;
	}

	function onLaneDrop(laneStatus: string) {
		const item = draggedItem();
		dragOverLane = '';
		dragId = null;
		if (!item) return;
		const move = moveFor(item.status, laneStatus);
		if (!move) return;
		if (move === 'reject') openRejectPicker([item.id]);
		else void act(move, [item.id]);
	}

	// ── Keyboard triage (split / deck / table) ──
	function overlayOpen() {
		return (
			!!drawerPost || !!lightbox || !!manualDeleteNotice || rejectPickerOpen || editingId !== null
		);
	}
	function rejectOne(item: ReviewItem) {
		openRejectPicker([item.id]);
	}
	function onQueueKeydown(e: KeyboardEvent) {
		if (loading || working || deleteBusy || overlayOpen()) return;
		if (viewMode === 'board' || viewMode === 'grid') return;
		const t = e.target as HTMLElement | null;
		if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
		const k = e.key;
		if (k === 'j' || k === 'ArrowDown' || (viewMode === 'deck' && k === 'ArrowRight')) {
			e.preventDefault();
			if (cursor < sortedItems.length - 1) cursor++;
		} else if (k === 'k' || k === 'ArrowUp' || (viewMode === 'deck' && k === 'ArrowLeft')) {
			e.preventDefault();
			if (cursor > 0) cursor--;
		} else if (k === 'a' && current) {
			e.preventDefault();
			if (current.status === 'draft') act('approve', [current.id]);
		} else if (k === 'r' && current) {
			e.preventDefault();
			rejectOne(current);
		} else if ((k === 'o' || k === 'Enter') && current) {
			e.preventDefault();
			openDrawer(current);
		} else if (k === 'z' && current) {
			e.preventDefault();
			openLightbox(current);
		}
	}
</script>

<svelte:window onkeydown={onQueueKeydown} />

<PageShell
	title="Review Queue"
	width="wide"
	description="Pending content from every persona — drafts to approve and scheduled posts not yet published. Approve to schedule, or reject with a reason."
>
	{#snippet actions()}
		<div class="header-actions">
			<button class="btn-ghost" onclick={load} disabled={loading || working}>
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
					><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path
						d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"
					/></svg
				>
				Refresh
			</button>
		</div>
	{/snippet}

	{#if loading}
		<div class="empty" role="status" aria-live="polite">Loading queue…</div>
	{:else if error}
		<div class="empty err" role="alert">{error}</div>
	{:else if items.length === 0}
		<div class="empty empty-state">
			<svg
				width="40"
				height="40"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg
			>
			<h2 class="empty-title">Queue is clear</h2>
			<p class="empty-hint">
				Nothing is waiting on your approval right now. New UGC drafts land here as your personas
				generate them — approve one to schedule it, or reject it with a reason.
			</p>
		</div>
	{:else}
		<h2 class="sr-only">Filter the queue</h2>
		<div class="queue-toolbar">
		<div class="filter-bar">
			<label class="filt">
				<span>Persona</span>
				<select bind:value={filterAgent}>
					<option value="all">All personas</option>
					{#each agentOptions as a}
						<option value={a.id}>{a.name}</option>
					{/each}
				</select>
			</label>
			<label class="filt">
				<span>Platform</span>
				<select bind:value={filterPlatform}>
					<option value="all">All platforms</option>
					{#each platformOptions as p}
						<option value={p}>{platformLabel(p)}</option>
					{/each}
				</select>
			</label>
			<label class="filt">
				<span>Status</span>
				<select bind:value={filterStatus}>
					<option value="all">Needs a decision (draft + scheduled)</option>
					<option value="draft">Draft only</option>
					<option value="scheduled">Scheduled only</option>
					<option value="rejected">Rejected</option>
				</select>
			</label>
			<span class="filt-count" aria-live="polite">{filteredItems.length} of {items.length} shown</span>
		</div>

		<h2 class="sr-only">Queue view</h2>
		<div class="view-switch" role="group" aria-label="Queue view">
			{#each VIEWS as v (v.id)}
				<button
					type="button"
					class="vs-btn"
					class:on={viewMode === v.id}
					aria-pressed={viewMode === v.id}
					title={v.hint}
					onclick={() => setView(v.id)}
				>
					{#if v.id === 'table'}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
					{:else if v.id === 'split'}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="10" y1="3" x2="10" y2="21" /></svg>
					{:else if v.id === 'deck'}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="12" height="16" rx="2" /><path d="M3 8v10a2 2 0 002 2" /><path d="M21 8v10a2 2 0 01-2 2" /></svg>
					{:else if v.id === 'board'}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="5" height="18" rx="1" /><rect x="10" y="3" width="5" height="12" rx="1" /><rect x="17" y="3" width="5" height="8" rx="1" /></svg>
					{:else}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
					{/if}
					{v.label}
				</button>
			{/each}
			{#if viewMode === 'split' || viewMode === 'deck' || viewMode === 'table'}
				<span class="kbd-hints" aria-hidden="true">
					<kbd>j</kbd>/<kbd>k</kbd> move · <kbd>a</kbd> approve · <kbd>r</kbd> reject ·
					<kbd>o</kbd> open · <kbd>z</kbd> zoom
				</span>
			{/if}
		</div>
		</div>

		{#if queueBlock}
			<!-- A read-only seat is told once, up front — before anything is selected —
			     instead of discovering every disabled button one hover at a time. -->
			<p class="seat-note" role="note">{queueBlock}</p>
		{/if}
		{#if selected.size > 0}
		<h2 class="sr-only">Bulk actions</h2>
		<div class="bulk-bar">
			<label class="check-all">
				<input
					type="checkbox"
					checked={filteredItems.length > 0 && filteredItems.every((i) => selected.has(i.id))}
					onchange={toggleAll}
				/>
				{selected.size} / {filteredItems.length} selected
			</label>
			<div class="bulk-actions">
				<button
					class="btn-approve"
					disabled={selected.size === 0 || working || deleteBusy || !!bulkBlock}
					title={bulkBlock ?? undefined}
					onclick={() => act('approve', [...selected])}
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
						aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg
					>
					Approve &amp; Schedule ({selected.size})
				</button>
				<button
					class="btn-reject"
					disabled={selected.size === 0 || working || deleteBusy || !!bulkBlock}
					title={bulkBlock ?? undefined}
					onclick={() => openRejectPicker([...selected])}
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
						><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
					>
					Reject ({selected.size})
				</button>
				<button
					class="btn-delete"
					title={bulkBlock ?? 'Permanently delete — also removes published copies where the platform API allows it'}
					disabled={selected.size === 0 || working || deleteBusy || !!bulkBlock}
					onclick={deleteSelected}
				>
					{#if bulkDeleting}
						Deleting…
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
							><polyline points="3 6 5 6 21 6" /><path
								d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
							/></svg
						>
						Delete selected ({selected.size})
					{/if}
				</button>
			</div>
		</div>
		{/if}

		{#if rejectPickerOpen}
			<h2 class="sr-only">Reject reason</h2>
			<div class="reject-picker">
				<span class="rp-label" id="rp-label">
					Reject {rejectTargets.length === 1 ? '1 post' : `${rejectTargets.length} posts`}:
				</span>
				{#if rejectTargetLabels.length === 1}
					<span class="rp-target" title={rejectTargetLabels[0]}>“{rejectTargetLabels[0]}”</span>
				{/if}
				<select bind:value={rejectReason} aria-labelledby="rp-label">
					<option value="" disabled>— Choose a reason —</option>
					{#each REJECT_REASONS as r}<option value={r}>{r}</option>{/each}
				</select>
				<input
					type="text"
					aria-label="Optional note about this rejection"
					placeholder="optional note…"
					bind:value={rejectNote}
					maxlength="300"
				/>
				<button class="btn-reject" onclick={submitReject} disabled={working || !rejectReason}
					>Confirm reject</button
				>
				<button
					class="btn-ghost"
					onclick={() => {
						rejectPickerOpen = false;
						rejectTargets = [];
					}}>Cancel</button
				>
			</div>
		{/if}

		{#if filteredItems.length === 0}
			<div class="empty empty-state" role="status" aria-live="polite">
				<svg
					width="40"
					height="40"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg
				>
				<h2 class="empty-title">No matching posts</h2>
				<p class="empty-hint">
					{items.length} post{items.length === 1 ? '' : 's'} in the queue, but none match the persona,
					platform and status filters above. Widen a filter to see them.
				</p>
			</div>
		{/if}

		<h2 class="sr-only">Pending posts</h2>
		{#if viewMode === 'grid'}
			<div class="queue-grid">
			{#each filteredItems as item (item.id)}
				<div class="queue-card" class:selected={selected.has(item.id)}>
					<div class="card-media">
						<button
							type="button"
							class="media-open"
							title="Open post details"
							aria-label="Open post details for {item.agent_name}"
							onclick={() => openDrawer(item)}
						>
							{#if item.media_type === 'video' && cardThumb(item)}
								<img
									src={thumbUrl(cardThumb(item), 480)}
									onerror={(e) => restoreOriginal(e, cardThumb(item))}
									alt="Video draft preview for {item.agent_name}"
									width="800"
									height="1000"
									loading="lazy"
									decoding="async"
								/>
								<span class="media-badge">
									<svg
										width="11"
										height="11"
										viewBox="0 0 24 24"
										fill="currentColor"
										stroke="none"
										aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3" /></svg
									>
									video
								</span>
							{:else if item.media_url}
								<img
									src={thumbUrl(item.media_url, 480)}
									onerror={(e) => restoreOriginal(e, item.media_url)}
									alt="Image draft preview for {item.agent_name}"
									width="800"
									height="1000"
									loading="lazy"
									decoding="async"
								/>
							{:else}
								<div class="no-media">no media</div>
							{/if}
							{#if drawerLoadingId === item.id}
								<span class="media-loading">Opening…</span>
							{/if}
						</button>
						{#if item.media_url || item.poster_url}
							<button
								type="button"
								class="media-zoom"
								title={item.media_type === 'video' && item.media_url ? 'Play full size' : 'Enlarge image'}
								aria-label={item.media_type === 'video' && item.media_url ? 'Play full size' : 'Enlarge image'}
								onclick={(e) => {
									e.stopPropagation();
									openLightbox(item);
								}}
								><svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
									><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line
										x1="21"
										y1="3"
										x2="14"
										y2="10"
									/><line x1="3" y1="21" x2="10" y2="14" /></svg
								></button
							>
						{/if}
						<button
							type="button"
							class="pick"
							class:on={selected.has(item.id)}
							aria-label={selected.has(item.id) ? 'Deselect' : 'Select'}
							aria-pressed={selected.has(item.id)}
							onclick={() => toggle(item.id)}
							><svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="3"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg
							></button
						>
					</div>
					<div class="card-body">
						<div class="card-agent">
							{#if item.agent_avatar}<img
									src={thumbUrl(item.agent_avatar, 96)}
									alt=""
									width="40"
									height="40"
									loading="lazy"
								/>{/if}
							<span class="agent-name">{item.agent_name}</span>
							{#if item.quality_score != null}
								<span
									class="qc-badge"
									class:qc-high={item.quality_score >= 7.5}
									class:qc-low={item.quality_score < 6}
									title={item.quality_issue || 'Independent QC grade'}
								>QC {item.quality_score.toFixed(1)}</span>
							{/if}
							<span class="slot">{slotLabel(item)}</span>
							<span class="status-badge status-{item.status}">
								{#if item.status === 'scheduled'}
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
										><rect x="3" y="4" width="18" height="18" rx="2" /><line
											x1="16"
											y1="2"
											x2="16"
											y2="6"
										/><line x1="8" y1="2" x2="8" y2="6" /><line
											x1="3"
											y1="10"
											x2="21"
											y2="10"
										/></svg
									>
									Scheduled
								{:else}
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
										><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline
											points="14 2 14 8 20 8"
										/></svg
									>
									Draft
								{/if}
							</span>
						</div>
						{#if editingId === item.id}
							<div class="caption-edit">
								<textarea
									rows="4"
									aria-label="Post caption"
									bind:value={editDraft}
									disabled={savingEdit}
								></textarea>
								<div class="caption-edit-actions">
									<button class="btn-ghost sm" disabled={savingEdit} onclick={() => (editingId = null)}>Cancel</button>
									<button class="btn-approve sm" disabled={savingEdit} onclick={() => saveEdit(item)}>
										{savingEdit ? 'Saving…' : 'Save caption'}
									</button>
								</div>
							</div>
						{:else}
							<div class="caption-row">
								<p class="caption">{item.text}</p>
								<button
									class="edit-btn"
									title="Edit caption"
									aria-label="Edit caption"
									disabled={working || deleteBusy}
									onclick={() => startEdit(item)}
									><svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
										><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path
											d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
										/></svg
									></button
								>
							</div>
						{/if}
						<div class="plat-row">
							{#each item.platforms as p}<span class="plat-chip">{platformLabel(p)}</span>{/each}
						</div>
						<div class="card-actions">
							{#if item.status === 'draft'}
								<button
									class="btn-approve sm"
									disabled={working || deleteBusy || !!blockFor(item)}
									title={blockFor(item) ?? undefined}
									onclick={() => act('approve', [item.id])}>Approve</button
								>
							{/if}
							<button
								class="btn-reject sm"
								disabled={working || deleteBusy || !!blockFor(item)}
								title={blockFor(item) ?? undefined}
								onclick={() => openRejectPicker([item.id])}
								>{item.status === 'scheduled' ? 'Unschedule' : 'Reject'}</button
							>
							<button
								class="btn-delete sm"
								title={blockFor(item) ?? 'Delete permanently — removes it from connected platforms where possible'}
								aria-label="Delete post permanently"
								disabled={working || deleteBusy || !!blockFor(item)}
								onclick={() => deletePost(item.id)}
							>
								{#if deletingId === item.id}
									…
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
										><polyline points="3 6 5 6 21 6" /><path
											d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
										/></svg
									>
								{/if}
							</button>
						</div>
					</div>
				</div>
			{/each}
			</div>
		{:else if viewMode === 'table'}
			<!-- ═══ TABLE — bulk-first, sortable. Row click opens the drawer (the
			     preview-beside pattern); everything routes through the same handlers. ═══ -->
			<div class="tbl-wrap">
				<table class="queue-tbl">
					<thead>
						<tr>
							<th class="th-check">
								<input
									type="checkbox"
									class="tbl-check"
									checked={filteredItems.length > 0 && filteredItems.every((i) => selected.has(i.id))}
									onchange={toggleAll}
									aria-label="Select all shown"
								/>
							</th>
							<th><span class="sr-only">Media</span></th>
							<th>
								<button class="th-sort" class:on={sortKey === 'agent'} onclick={() => setSort('agent')}>
									Persona{sortKey === 'agent' ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
								</button>
							</th>
							<th class="th-cap">Caption</th>
							<th class="th-plat">Platforms</th>
							{#if hasQc}
							<th>
								<button class="th-sort" class:on={sortKey === 'qc'} onclick={() => setSort('qc')}>
									QC{sortKey === 'qc' ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
								</button>
							</th>
							{/if}
							<th class="th-slot">
								<button class="th-sort" class:on={sortKey === 'slot'} onclick={() => setSort('slot')}>
									Slot{sortKey === 'slot' ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
								</button>
							</th>
							<th class="th-status">Status</th>
							<th><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{#each sortedItems as item, i (item.id)}
							<tr class:checked={selected.has(item.id)} class:cursor-row={i === cursor}>
								<td>
									<input
										type="checkbox"
										class="tbl-check"
										checked={selected.has(item.id)}
										onchange={() => toggle(item.id)}
										aria-label="Select post by {item.agent_name}"
									/>
								</td>
								<td>
									<button
										type="button"
										class="tbl-thumb"
										onclick={() => {
											cursor = i;
											openDrawer(item);
										}}
										aria-label="Open post details for {item.agent_name}"
									>
										{#if cardThumb(item)}
											<img
												src={thumbUrl(cardThumb(item), 96)}
												onerror={(e) => restoreOriginal(e, cardThumb(item))}
												alt=""
												width="40"
												height="50"
												loading="lazy"
												decoding="async"
											/>
										{:else}
											<span class="tbl-nomedia" aria-hidden="true"></span>
										{/if}
									</button>
								</td>
								<td class="td-agent">
									{#if item.agent_avatar}<img src={thumbUrl(item.agent_avatar, 64)} onerror={(e) => restoreOriginal(e, item.agent_avatar)} alt="" width="22" height="22" loading="lazy" decoding="async" />{/if}
									<span>{item.agent_name}</span>
								</td>
								<td class="td-cap">
									<button
										type="button"
										class="cap-open"
										title="Open post details"
										onclick={() => {
											cursor = i;
											openDrawer(item);
										}}>{item.text}</button>
									<p class="cap-meta">{item.agent_name} · {slotLabel(item)}</p>
								</td>
								<td class="td-plat">
									{#each item.platforms as p}<span class="plat-chip">{platformLabel(p)}</span>{/each}
								</td>
								{#if hasQc}
								<td class="td-qc">
									{#if item.quality_score != null}
										<span
											class="qc-badge"
											class:qc-high={item.quality_score >= 7.5}
											class:qc-low={item.quality_score < 6}
											title={item.quality_issue || 'Independent QC grade'}>QC {item.quality_score.toFixed(1)}</span>
									{:else}
										<span class="td-dash" aria-label="No QC score">—</span>
									{/if}
								</td>
								{/if}
								<td class="td-slot">{slotLabel(item)}</td>
								<td class="td-status">
									<span class="status-badge status-{item.status}">{item.status}</span>
									{#if item.status === 'rejected' && item.reject_reason}
										<span class="reject-why" title={item.reject_reason}>{item.reject_reason}</span>
									{/if}
								</td>
								<td class="td-act">
									{#if item.status === 'draft'}
										<button
											type="button"
											class="row-btn row-ok"
											disabled={working || deleteBusy || !!blockFor(item)}
											title={blockFor(item) ?? 'Approve & schedule'}
											aria-label="Approve post by {item.agent_name}"
											onclick={() => act('approve', [item.id])}
											><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg></button>
									{:else if item.status === 'rejected'}
										<button
											type="button"
											class="row-btn row-restore"
											disabled={working || deleteBusy || !!blockFor(item)}
											title={blockFor(item) ?? 'Return to draft'}
											aria-label="Return post by {item.agent_name} to draft"
											onclick={() => act('restore', [item.id])}
											><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6" /><path d="M3.51 13a9 9 0 105.36-8.36L3 10" /></svg></button>
									{:else}
										<!-- Holds the Approve slot open so Reject and Delete never
										     move between rows of different status. -->
										<span class="row-btn-gap" aria-hidden="true"></span>
									{/if}
									<button
										type="button"
										class="row-btn row-no"
										disabled={working || deleteBusy || !!blockFor(item)}
										title={blockFor(item) ??
											(item.status === 'draft'
												? 'Reject with a reason'
												: item.status === 'rejected'
													? 'Change the rejection reason'
													: 'Unschedule with a reason')}
										aria-label="Reject post by {item.agent_name}"
										onclick={() => rejectOne(item)}
										><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
									<button
										type="button"
										class="row-btn row-del"
										disabled={working || deleteBusy || !!blockFor(item)}
										title={blockFor(item) ?? 'Delete permanently'}
										aria-label="Delete post by {item.agent_name} permanently"
										onclick={() => deletePost(item.id)}
										><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg></button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else if viewMode === 'split'}
			<!-- ═══ SPLIT — dense list left, full preview right, j/k/a/r triage ═══ -->
			<div class="split">
				<div class="split-list">
					{#each sortedItems as item, i (item.id)}
						<div class="sp-row" class:active={i === cursor}>
							<input
								type="checkbox"
								class="tbl-check"
								checked={selected.has(item.id)}
								onchange={() => toggle(item.id)}
								aria-label="Select post by {item.agent_name}"
							/>
							<button
								type="button"
								class="sp-main"
								aria-current={i === cursor ? 'true' : undefined}
								onclick={() => (cursor = i)}
							>
								{#if cardThumb(item)}
									<img class="sp-thumb" src={thumbUrl(cardThumb(item), 96)} onerror={(e) => restoreOriginal(e, cardThumb(item))} alt="" width="34" height="42" loading="lazy" decoding="async" />
								{:else}
									<span class="sp-thumb tbl-nomedia" aria-hidden="true"></span>
								{/if}
								<span class="sp-meta">
									<span class="sp-who">{item.agent_name} · {item.platforms.map(platformLabel).join(', ')}</span>
									<span class="sp-cap">{item.text}</span>
								</span>
								{#if item.quality_score != null}
									<span
										class="qc-badge sp-qc"
										class:qc-high={item.quality_score >= 7.5}
										class:qc-low={item.quality_score < 6}>{item.quality_score.toFixed(1)}</span>
								{/if}
							</button>
						</div>
					{/each}
				</div>
				{#if current}
					<div class="split-detail">
						<button
							type="button"
							class="sd-media"
							title={current.media_type === 'video' && current.media_url ? 'Play full size' : 'Enlarge image'}
							aria-label={current.media_type === 'video' && current.media_url ? 'Play full size' : 'Enlarge image'}
							onclick={() => openLightbox(current!)}
						>
							{#if cardThumb(current)}
								<img src={thumbUrl(cardThumb(current), 800)} onerror={(e) => restoreOriginal(e, cardThumb(current))} alt="Draft media for {current.agent_name}" width="800" height="1000" decoding="async" />
								{#if current.media_type === 'video'}
									<span class="media-badge"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3" /></svg> {SURFACE_LABEL[current.surface] ?? 'Video'}</span>
								{/if}
							{:else}
								<div class="no-media">no media</div>
							{/if}
						</button>
						<div class="sd-body">
							<div class="card-agent">
								{#if current.agent_avatar}<img src={thumbUrl(current.agent_avatar, 96)} onerror={(e) => restoreOriginal(e, current.agent_avatar)} alt="" width="40" height="40" loading="lazy" decoding="async" />{/if}
								<span class="agent-name">{current.agent_name}</span>
								{#if current.quality_score != null}
									<span
										class="qc-badge"
										class:qc-high={current.quality_score >= 7.5}
										class:qc-low={current.quality_score < 6}
										title={current.quality_issue || 'Independent QC grade'}>QC {current.quality_score.toFixed(1)}</span>
								{/if}
								<span class="slot">{slotLabel(current)}</span>
								<span class="status-badge status-{current.status}">{current.status}</span>
							</div>
							{#if current.quality_issue}
								<p class="sd-issue">QC note: {current.quality_issue}</p>
							{/if}
							<p class="sd-caption">{current.text}</p>
							<div class="sd-actions">
								{#if current.status === 'draft'}
									<button
										class="btn-approve"
										disabled={working || deleteBusy || !!blockFor(current!)}
										title={blockFor(current!) ?? undefined}
										onclick={() => act('approve', [current!.id])}
									>
										Approve &amp; schedule
									</button>
								{/if}
								<button
									class="btn-reject"
									disabled={working || deleteBusy || !!blockFor(current!)}
									title={blockFor(current!) ?? undefined}
									onclick={() => rejectOne(current!)}
								>
									{current.status === 'draft' ? 'Reject…' : 'Unschedule…'}
								</button>
								<button class="btn-ghost" onclick={() => openDrawer(current!)}>
									{drawerLoadingId === current.id ? 'Opening…' : 'Full details'}
								</button>
								<button
									class="btn-delete sm"
									disabled={working || deleteBusy || !!blockFor(current!)}
									title={blockFor(current!) ?? undefined}
									aria-label="Delete post permanently"
									onclick={() => deletePost(current!.id)}
									><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg></button>
							</div>
							<p class="sd-pos">{cursor + 1} of {sortedItems.length}</p>
						</div>
					</div>
				{/if}
			</div>
		{:else if viewMode === 'deck'}
			<!-- ═══ DECK — one post, full attention. Approve/reject advances. ═══ -->
			{#if current}
				<div class="deck">
					<div class="deck-stack">
						{#if sortedItems[cursor + 2]}<div class="deck-under u2" aria-hidden="true"></div>{/if}
						{#if sortedItems[cursor + 1]}<div class="deck-under u1" aria-hidden="true"></div>{/if}
						<div class="deck-card">
							<button
								type="button"
								class="deck-media"
								title={current.media_type === 'video' && current.media_url ? 'Play full size' : 'Enlarge image'}
								aria-label={current.media_type === 'video' && current.media_url ? 'Play full size' : 'Enlarge image'}
								onclick={() => openLightbox(current!)}
							>
								{#if cardThumb(current)}
									<img src={thumbUrl(cardThumb(current), 800)} onerror={(e) => restoreOriginal(e, cardThumb(current))} alt="Draft media for {current.agent_name}" width="800" height="1000" decoding="async" />
								{:else}
									<div class="no-media">no media</div>
								{/if}
								{#if current.quality_score != null}
									<span class="deck-qc" class:dk-low={current.quality_score < 6}>QC {current.quality_score.toFixed(1)}</span>
								{/if}
								{#if current.media_type === 'video'}
									<span class="media-badge"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3" /></svg> {SURFACE_LABEL[current.surface] ?? 'Video'}</span>
								{/if}
							</button>
							<div class="deck-body">
								<div class="card-agent">
									{#if current.agent_avatar}<img src={thumbUrl(current.agent_avatar, 96)} onerror={(e) => restoreOriginal(e, current.agent_avatar)} alt="" width="40" height="40" loading="lazy" decoding="async" />{/if}
									<span class="agent-name">{current.agent_name}</span>
									<span class="slot">{slotLabel(current)}</span>
								</div>
								<p class="deck-cap">{current.text}</p>
								<div class="plat-row">
									{#each current.platforms as p}<span class="plat-chip">{platformLabel(p)}</span>{/each}
								</div>
							</div>
						</div>
					</div>
					<div class="deck-controls">
						<button
							type="button"
							class="dk-round dk-nav"
							disabled={cursor === 0}
							aria-label="Previous post"
							onclick={() => cursor--}
							><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg></button>
						<button
							type="button"
							class="dk-round dk-no"
							disabled={working || deleteBusy || !!blockFor(current)}
							title={blockFor(current) ?? undefined}
							aria-label={current.status === 'draft' ? 'Reject with a reason' : 'Unschedule with a reason'}
							onclick={() => rejectOne(current!)}
							><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
						<button
							type="button"
							class="dk-round dk-info"
							aria-label="Open full details"
							onclick={() => openDrawer(current!)}
							><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg></button>
						<button
							type="button"
							class="dk-round dk-yes"
							disabled={working || deleteBusy || current.status !== 'draft' || !!blockFor(current)}
							title={blockFor(current) ?? (current.status === 'draft' ? 'Approve & schedule' : 'Already scheduled')}
							aria-label="Approve and schedule"
							onclick={() => act('approve', [current!.id])}
							><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg></button>
						<button
							type="button"
							class="dk-round dk-nav"
							disabled={cursor >= sortedItems.length - 1}
							aria-label="Next post"
							onclick={() => cursor++}
							><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg></button>
					</div>
					<p class="deck-progress" aria-live="polite">
						{cursor + 1} of {sortedItems.length}
						<span class="deck-track" aria-hidden="true"><i style="width: {((cursor + 1) / Math.max(1, sortedItems.length)) * 100}%"></i></span>
					</p>
				</div>
			{/if}
		{:else if viewMode === 'board'}
			<!-- ═══ BOARD — pipeline lanes. Flagged (QC < 6) gets its own lane so
			     low-quality drafts stop hiding among good ones. ═══ -->
			<div class="board">
				{#each boardLanes as lane (lane.cls)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<section
						class="lane {lane.cls}"
						class:drop-ok={dragOverLane === lane.cls && laneAccepts(lane.status)}
						ondragover={(e) => {
							if (!laneAccepts(lane.status)) return;
							e.preventDefault();
							dragOverLane = lane.cls;
						}}
						ondragleave={() => {
							if (dragOverLane === lane.cls) dragOverLane = '';
						}}
						ondrop={(e) => {
							e.preventDefault();
							onLaneDrop(lane.status);
						}}
					>
						<header class="lane-head">
							<h3 class="lane-title">{lane.title}</h3>
							<span class="lane-count">{lane.list.length}</span>
						</header>
						{#each lane.list as item (item.id)}
							<div
								class="lane-card"
								class:flagged={lane.cls === 'flag'}
								class:dragging={dragId === item.id}
								draggable="true"
								ondragstart={(e) => {
									dragId = item.id;
									if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
								}}
								ondragend={() => {
									dragId = null;
									dragOverLane = '';
								}}
							>
								<button
									type="button"
									class="lane-thumb"
									onclick={() => openDrawer(item)}
									aria-label="Open post details for {item.agent_name}"
								>
									{#if cardThumb(item)}
										<img src={thumbUrl(cardThumb(item), 120)} onerror={(e) => restoreOriginal(e, cardThumb(item))} alt="" width="46" height="58" loading="lazy" decoding="async" />
									{:else}
										<span class="tbl-nomedia" aria-hidden="true"></span>
									{/if}
								</button>
								<div class="lane-info">
									<span class="lane-who">{item.agent_name}</span>
									<span class="lane-cap">{item.text}</span>
									<span class="lane-foot">
										{#each item.platforms as p}<span class="plat-chip">{platformLabel(p)}</span>{/each}
										<span class="slot">{slotLabel(item)}</span>
										{#if lane.cls === 'flag' && item.quality_score != null}
											<span class="qc-badge qc-low">QC {item.quality_score.toFixed(1)}{item.quality_issue ? ` · ${item.quality_issue}` : ''}</span>
										{/if}
									</span>
									<span class="lane-quick">
										{#if item.status === 'draft'}
											<button type="button" class="lq-btn lq-ok" disabled={working || deleteBusy || !!blockFor(item)} title={blockFor(item) ?? undefined} onclick={() => act('approve', [item.id])}>Approve</button>
										{/if}
										<button type="button" class="lq-btn" onclick={() => openDrawer(item)}>Open</button>
									</span>
								</div>
							</div>
						{/each}
						{#if lane.list.length === 0}
							<p class="lane-empty">Nothing here</p>
						{/if}
					</section>
				{/each}
			</div>
		{/if}
	{/if}

	<PostDrawer
		post={drawerPost}
		onClose={() => (drawerPost = null)}
		onApprove={(p) => act('approve', [p.id])}
		approveBlock={drawerPost ? blockFor(drawerPost) : null}
		onReject={drawerPost && blockFor(drawerPost) ? null : drawerReject}
		onDelete={drawerPost && blockFor(drawerPost) ? undefined : (p) => deletePost(p.id)}
		onSaveText={drawerSaveText}
		onReschedule={drawerReschedule}
		onRefined={(p) => {
			drawerPost = p;
			void load();
		}}
		characterRef={drawerAvatar}
		approving={working}
		deleting={deletingId === drawerPost?.id}
	/>

	{#if manualDeleteNotice}
		<ManualDeleteNotice entries={manualDeleteNotice} onClose={() => (manualDeleteNotice = null)} />
	{/if}

	<ImageLightbox
		url={lightbox?.url ?? null}
		label={lightbox?.label ?? ''}
		type={lightbox?.type ?? null}
		poster={lightbox?.poster ?? null}
		onClose={() => (lightbox = null)}
	/>
</PageShell>

<style>
	/* The page frame, masthead and h1 scale now come from PageShell — see the
	   note there on why routes no longer choose their own width. */
	.empty {
		padding: 3rem;
		text-align: center;
		color: var(--text-dim);
	}
	.empty.err {
		color: var(--error-text);
	}
	/* An approval queue with nothing pending has to say what happens next, not
	   leave a blank band where the cards were. */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 3.5rem 1.5rem;
	}
	.empty-state svg {
		color: var(--text-dim);
		opacity: 0.7;
	}
	.empty-title {
		margin: 0.25rem 0 0 0;
		font-size: 1.05rem;
		color: var(--text);
	}
	.empty-hint {
		margin: 0;
		max-width: 46ch;
		font-size: var(--text-sm, 0.85rem);
		line-height: 1.55;
		color: var(--text-dim);
	}
	.filter-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.75rem;
		padding: 0.6rem 0.25rem;
		margin-bottom: 0.75rem;
	}
	.filt {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.68rem;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.filt select {
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		/* >=16px or iOS Safari force-zooms the viewport on focus. */
		font-size: 1rem;
		min-height: 44px;
		text-transform: none;
		letter-spacing: 0;
	}
	.filt-count {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--muted);
	}
	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 0.62rem;
		font-weight: 700;
		padding: 0.1rem 0.42rem;
		border-radius: 999px;
		white-space: nowrap;
	}
	.status-draft {
		background: color-mix(in srgb, var(--text-dim) 18%, transparent);
		color: var(--text-dim);
	}
	.status-scheduled {
		background: color-mix(in srgb, var(--info) 18%, transparent);
		color: var(--info-text);
	}

	.seat-note {
		margin: 0 0 0.75rem;
		padding: 0.6rem 0.85rem;
		border-radius: 10px;
		background: color-mix(in srgb, var(--accent) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
		font-size: 0.85rem;
	}
	.bulk-bar {
		display: flex;
		/* Wrap so the select-all label and the Approve/Reject bulk buttons stack
		   instead of overflowing a phone (this page has no other breakpoints). */
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		margin-bottom: 1rem;
		position: sticky;
		top: 0.5rem;
		background: var(--bg);
		z-index: var(--z-sticky);
	}
	.check-all {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
		font-size: var(--text-sm, 0.85rem);
		cursor: pointer;
	}
	.check-all input {
		width: 20px;
		height: 20px;
	}
	.bulk-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	/* Delete destroys the row for good — keep it off the Approve/Reject pair so it
	   can't be hit by momentum. */
	.bulk-actions .btn-delete {
		margin-left: 0.75rem;
	}
	.reject-picker {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		padding: 0.75rem 1rem;
		border: 1px solid var(--danger);
		border-radius: 12px;
		margin-bottom: 1rem;
	}
	.rp-label {
		font-size: var(--text-sm, 0.85rem);
		color: var(--text-dim);
	}
	.reject-picker select,
	.reject-picker input {
		padding: 0.45rem 0.6rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: transparent;
		color: inherit;
		font-size: 1rem;
		min-height: 44px;
	}
	.reject-picker input {
		flex: 1;
		min-width: 180px;
	}
	.queue-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 1rem;
	}
	.queue-card {
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
		transition: border-color 0.15s ease;
	}
	.queue-card.selected {
		border-color: var(--accent);
	}
	.card-media {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 4 / 5;
		background: rgba(255, 255, 255, 0.03);
	}
	.media-open {
		display: block;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
	}
	.card-media img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.media-loading {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(0, 0, 0, 0.45);
		color: #fff;
		font-size: var(--text-sm, 0.85rem);
		font-weight: 600;
	}
	.no-media {
		display: grid;
		place-items: center;
		height: 100%;
		color: var(--text-dim);
		font-size: var(--text-sm, 0.85rem);
	}
	.media-badge {
		position: absolute;
		top: 8px;
		left: 8px;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: rgba(0, 0, 0, 0.65);
		color: #fff;
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
	}
	/* Enlarge overlay — bottom-right so it clears .media-badge (top-left) and
	   .pick (top-right). Sits above .media-open, which is unpositioned. */
	.media-zoom {
		position: absolute;
		bottom: 8px;
		right: 8px;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: 7px;
		background: rgba(0, 0, 0, 0.55);
		color: rgba(255, 255, 255, 0.85);
		border: 1px solid rgba(255, 255, 255, 0.35);
		font-size: 13px;
		line-height: 1;
		padding: 0;
		cursor: pointer;
	}
	/* 26px chip, 44px target: the pseudo-element grows the hit area without
	   making the overlay itself visually bigger. */
	.media-zoom::after,
	.pick::after {
		content: '';
		position: absolute;
		inset: -9px;
	}
	.media-zoom:hover {
		background: rgba(0, 0, 0, 0.75);
		border-color: #fff;
		color: #fff;
	}
	.pick {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.5);
		color: transparent;
		border: 1.5px solid rgba(255, 255, 255, 0.7);
		font-size: 13px;
		padding: 0;
		cursor: pointer;
	}
	.pick:hover {
		border-color: #fff;
		color: rgba(255, 255, 255, 0.85);
	}
	.pick.on {
		background: var(--accent);
		color: #fff;
		border-color: var(--accent);
	}
	.card-body {
		padding: 0.75rem;
	}
	.card-agent {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
	}
	.card-agent img {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		object-fit: cover;
	}
	.agent-name {
		font-size: var(--text-sm, 0.85rem);
		font-weight: 600;
	}
	.slot {
		margin-left: auto;
		font-size: 11px;
		color: var(--text-dim);
		font-family: var(--font-mono, monospace);
		font-variant-numeric: tabular-nums;
	}
	.qc-badge {
		font-size: 10px;
		font-weight: 700;
		padding: 1px 7px;
		border-radius: 999px;
		border: 1px solid var(--border);
		color: var(--text-dim);
		font-family: var(--font-mono, monospace);
		font-variant-numeric: tabular-nums;
	}
	.qc-badge.qc-high {
		color: var(--success-text);
		border-color: var(--success);
	}
	.qc-badge.qc-low {
		color: var(--error-text);
		border-color: var(--danger);
	}
	.caption-row {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
	}
	.caption-row .caption {
		flex: 1;
		min-width: 0;
	}
	.edit-btn {
		position: relative;
		flex-shrink: 0;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		padding: 0;
		border-radius: 7px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-dim);
		cursor: pointer;
	}
	/* Same 26px-visual / 44px-target trick as the media overlays. */
	.edit-btn::after {
		content: '';
		position: absolute;
		inset: -9px;
	}
	.edit-btn:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--text);
	}
	.caption-edit {
		margin-bottom: 0.5rem;
	}
	.caption-edit textarea {
		width: 100%;
		padding: 0.45rem 0.6rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: transparent;
		color: inherit;
		font: inherit;
		/* >=16px or iOS Safari force-zooms and never zooms back out. */
		font-size: 1rem;
		resize: vertical;
	}
	.caption-edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.4rem;
		margin-top: 0.4rem;
	}
	.caption {
		margin: 0 0 0.5rem 0;
		font-size: var(--text-sm, 0.85rem);
		color: var(--text);
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.plat-row {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 0.6rem;
	}
	.plat-chip {
		font-size: 10px;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid var(--border);
		color: var(--text-dim);
	}
	.card-actions {
		display: flex;
		gap: 0.5rem;
	}
	.btn-approve,
	.btn-reject,
	.btn-delete,
	.btn-ghost {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.5rem 0.9rem;
		/* 44px floor: these were ~32-40px tall, under the minimum touch target. */
		min-height: 44px;
		border-radius: 9px;
		border: 1px solid transparent;
		font-weight: 600;
		font-size: var(--text-sm, 0.85rem);
		cursor: pointer;
	}
	.btn-approve {
		background: var(--success);
		color: #fff;
	}
	.btn-reject {
		background: transparent;
		border-color: var(--danger);
		color: var(--error-text);
	}
	/* Delete is the destructive twin of Reject: Reject keeps the row (status +
	   logged reason), Delete destroys it. Muted until hover so it can't be
	   mistaken for the primary action. */
	.btn-delete {
		background: transparent;
		border-color: var(--border-strong);
		color: var(--text-dim);
	}
	.btn-delete:hover:not(:disabled) {
		border-color: var(--danger);
		color: var(--error-text);
	}
	.btn-ghost {
		background: transparent;
		border-color: var(--border-strong);
		color: var(--text-dim);
	}
	.btn-approve.sm,
	.btn-reject.sm {
		flex: 1;
		padding: 0.4rem 0.5rem;
	}
	/* Icon-width so Approve/Reject keep the room on a 260px card. */
	.btn-delete.sm {
		flex: 0 0 auto;
		padding: 0.4rem 0.6rem;
		min-width: 44px;
	}
	.btn-ghost.sm {
		padding: 0.4rem 0.7rem;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ═══════════════════════════════════════════════════════════════
	   VIEW SWITCHER
	   ═══════════════════════════════════════════════════════════════ */
	.view-switch {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-bottom: var(--space-4);
	}
	.vs-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 44px;
		padding: 0 0.85rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border-strong);
		background: transparent;
		color: var(--text-dim);
		font-size: 0.8rem;
		font-weight: var(--weight-semi);
		cursor: pointer;
	}
	.vs-btn:hover:not(:disabled) {
		border-color: var(--accent-mid);
		color: var(--text);
		background: var(--surface-2);
	}
	.vs-btn.on {
		background: var(--accent-soft);
		border-color: var(--accent-mid);
		color: var(--accent-text);
	}
	.vs-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.kbd-hints {
		margin-left: auto;
		font-size: 0.7rem;
		color: var(--text-dim);
	}
	.kbd-hints kbd {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		border: 1px solid var(--border-strong);
		border-bottom-width: 2px;
		border-radius: 5px;
		padding: 1px 5px;
		background: var(--surface-2);
	}
	@media (hover: none), (max-width: 900px) {
		.kbd-hints {
			display: none;
		}
	}

	/* ═══════════════════════════════════════════════════════════════
	   TABLE VIEW
	   ═══════════════════════════════════════════════════════════════ */
	.tbl-wrap {
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
	}
	.queue-tbl {
		width: 100%;
		/* `separate`, not `collapse`: a sticky cell loses its borders under
		   border-collapse, and the actions column below is sticky. */
		border-collapse: separate;
		border-spacing: 0;
		font-size: 0.82rem;
	}
	/* The actions column stays on screen at every width. */
	.queue-tbl th:last-child,
	.queue-tbl td.td-act {
		position: sticky;
		right: 0;
		background: var(--surface);
		/* Only visible while there is content scrolled underneath. */
		box-shadow: -8px 0 12px -8px rgba(15, 23, 42, 0.28);
	}
	.queue-tbl tbody tr:hover td.td-act {
		background: var(--surface-2);
	}
	/* Matches .row-btn's rendered width exactly (44px). A narrower spacer still
	   shifts Reject and Delete between rows, which is the whole defect. */
	.row-btn-gap {
		display: inline-block;
		width: 44px;
	}
	.queue-tbl thead th {
		text-align: left;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--text-dim);
		font-weight: var(--weight-semi);
		padding: 0.35rem 0.6rem;
		border-bottom: 1px solid var(--border-strong);
		white-space: nowrap;
	}
	.th-sort {
		font: inherit;
		color: inherit;
		text-transform: inherit;
		letter-spacing: inherit;
		background: none;
		border: none;
		cursor: pointer;
		min-height: 44px;
		padding: 0;
	}
	.th-sort:hover,
	.th-sort.on {
		color: var(--accent-text);
	}
	.th-sort:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.queue-tbl tbody td {
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
	}
	.queue-tbl tbody tr:last-child td {
		border-bottom: none;
	}
	.queue-tbl tbody tr:hover {
		background: color-mix(in srgb, var(--accent) 5%, transparent);
	}
	.queue-tbl tbody tr.checked {
		background: var(--accent-soft);
	}
	.queue-tbl tbody tr.cursor-row {
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.tbl-check {
		width: 17px;
		height: 17px;
		accent-color: var(--accent);
		cursor: pointer;
	}
	.tbl-thumb {
		display: block;
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		border-radius: 5px;
		overflow: hidden;
		min-width: 44px;
		min-height: 50px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.tbl-thumb img {
		width: 40px;
		height: 50px;
		object-fit: cover;
		border-radius: 5px;
		display: block;
	}
	.tbl-thumb:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.tbl-nomedia {
		display: inline-block;
		width: 40px;
		height: 50px;
		border-radius: 5px;
		background: var(--surface-3);
	}
	.td-agent {
		white-space: nowrap;
	}
	.td-agent img {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		object-fit: cover;
		vertical-align: middle;
		margin-right: 0.4rem;
	}
	.td-agent span {
		font-weight: var(--weight-semi);
	}
	.td-cap {
		width: 100%; /* absorbs whatever the fixed columns do not use */
		max-width: 0; /* with width:100%, lets the cell shrink below its content */
	}
	.cap-open {
		display: block;
		width: 100%;
		max-width: 100%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: left;
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: var(--text-muted);
		cursor: pointer;
		min-height: 44px;
	}
	.cap-open:hover {
		color: var(--text);
	}
	.cap-open:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.td-plat {
		white-space: nowrap;
	}
	.td-qc,
	.td-slot {
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.td-slot {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--text-dim);
	}
	.td-dash {
		color: var(--text-dim);
	}
	.td-act {
		white-space: nowrap;
	}
	.row-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		border-radius: 8px;
		border: 1px solid transparent;
		background: none;
		cursor: pointer;
		color: var(--text-dim);
	}
	.row-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.row-ok:hover:not(:disabled) {
		background: var(--success-soft);
		color: var(--success-text);
		border-color: var(--success);
	}
	/* Filters and view modes share a row and wrap together. They used to be two
	   stacked full-width bands, which with the always-on bulk bar put the first
	   post below the fold at 640px and at 200% zoom. */
	/* Drag affordances. A lane only lights up for a move the API can perform,
	   so an impossible drag reads as impossible before the user commits to it. */
	.lane-card {
		cursor: grab;
	}
	.lane-card.dragging {
		opacity: 0.45;
		cursor: grabbing;
	}
	.lane.drop-ok {
		outline: 2px dashed var(--accent);
		outline-offset: -2px;
		background: var(--accent-soft);
	}
	@media (prefers-reduced-motion: reduce) {
		.lane-card.dragging {
			opacity: 1;
		}
	}
	.queue-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}
	.reject-why {
		display: block;
		max-width: 22ch;
		margin-top: 2px;
		overflow: hidden;
		font-size: var(--text-xs);
		line-height: var(--leading-snug);
		color: var(--text-dim);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rp-target {
		max-width: 34ch;
		overflow: hidden;
		font-style: italic;
		color: var(--text-muted);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row-restore:hover:not(:disabled) {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--accent-text);
	}
	.row-no:hover:not(:disabled),
	.row-del:hover:not(:disabled) {
		background: var(--error-soft);
		color: var(--error-text);
		border-color: var(--error);
	}
	@media (max-width: 1023px) {
		/* Platforms and the media thumbnail are context, not the decision. */
		.th-plat,
		.td-plat,
		.queue-tbl thead th:nth-child(2),
		.queue-tbl tbody td:nth-child(2) {
			display: none;
		}
	}
	@media (max-width: 767px) {
		/* Persona and slot fold into the caption cell's meta line rather than
		   disappearing — see .cap-meta, which is in the DOM at every width. */
		.td-agent,
		.queue-tbl thead th:nth-child(3),
		.th-slot,
		.td-slot {
			display: none;
		}
	}
	/* The caption's supporting facts, shown only once their columns fold away. */
	.cap-meta {
		display: none;
		margin-top: 2px;
		font-size: var(--text-xs);
		color: var(--text-dim);
	}
	@media (max-width: 767px) {
		.cap-meta {
			display: block;
		}
		.cap-open {
			white-space: normal;
			min-height: 0;
			line-height: var(--leading-snug);
		}
		.td-cap {
			padding-block: var(--space-2);
		}
	}

	/* ═══════════════════════════════════════════════════════════════
	   SPLIT VIEW
	   ═══════════════════════════════════════════════════════════════ */
	.split {
		display: grid;
		grid-template-columns: minmax(280px, 360px) 1fr;
		gap: var(--space-4);
		align-items: start;
	}
	.split-list {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		max-height: 72vh;
		max-height: 72dvh;
		overflow-y: auto;
	}
	.sp-row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.3rem 0.45rem 0.3rem 0.6rem;
		border-bottom: 1px solid var(--border);
	}
	.sp-row:last-child {
		border-bottom: none;
	}
	.sp-row.active {
		background: var(--accent-soft);
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.sp-main {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-width: 0;
		min-height: 52px;
		background: none;
		border: none;
		padding: 0.2rem 0;
		cursor: pointer;
		text-align: left;
		font: inherit;
		color: inherit;
	}
	.sp-main:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.sp-thumb {
		width: 34px;
		height: 42px;
		border-radius: 5px;
		object-fit: cover;
		flex-shrink: 0;
	}
	.sp-meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 1px;
	}
	.sp-who {
		font-size: 0.74rem;
		font-weight: var(--weight-semi);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sp-cap {
		font-size: 0.7rem;
		color: var(--text-dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sp-qc {
		margin-left: auto;
		flex-shrink: 0;
	}
	.split-detail {
		display: grid;
		grid-template-columns: minmax(200px, 300px) 1fr;
		gap: var(--space-5);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--surface);
		padding: var(--space-5);
		position: sticky;
		top: calc(var(--header-height, 60px) + var(--space-4));
	}
	.sd-media {
		position: relative;
		padding: 0;
		border: none;
		background: var(--surface-3);
		border-radius: var(--radius-sm);
		overflow: hidden;
		cursor: zoom-in;
		aspect-ratio: 4 / 5;
	}
	.sd-media img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.sd-media:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.sd-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.sd-issue {
		font-size: 0.78rem;
		color: var(--warning-text);
		background: var(--warning-soft);
		border-radius: 8px;
		padding: 0.4rem 0.6rem;
	}
	.sd-caption {
		font-size: 0.9rem;
		color: var(--text-muted);
		line-height: 1.55;
	}
	.sd-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		margin-top: auto;
	}
	.sd-pos {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 900px) {
		.split {
			grid-template-columns: 1fr;
		}
		.split-detail {
			position: static;
			order: -1;
			grid-template-columns: 1fr;
		}
		.sd-media {
			max-width: 320px;
		}
		.split-list {
			max-height: 45vh;
			max-height: 45dvh;
		}
	}

	/* ═══════════════════════════════════════════════════════════════
	   DECK VIEW
	   ═══════════════════════════════════════════════════════════════ */
	.deck {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding-top: var(--space-2);
	}
	.deck-stack {
		position: relative;
		width: min(340px, 92vw);
		display: grid;
		place-items: center;
	}
	.deck-under {
		position: absolute;
		inset: 0 0 6% 0;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.deck-under.u1 {
		transform: translateX(12px) rotate(2deg);
		opacity: 0.65;
	}
	.deck-under.u2 {
		transform: translateX(-12px) rotate(-1.6deg);
		opacity: 0.4;
	}
	.deck-card {
		position: relative;
		z-index: 2;
		width: 100%;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
	}
	.deck-media {
		position: relative;
		display: block;
		width: 100%;
		padding: 0;
		border: none;
		background: var(--surface-3);
		cursor: zoom-in;
		aspect-ratio: 4 / 5;
	}
	.deck-media img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.deck-media:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -3px;
	}
	.deck-qc {
		position: absolute;
		top: 10px;
		right: 10px;
		font-family: var(--font-mono);
		font-size: 0.68rem;
		font-variant-numeric: tabular-nums;
		color: #fff;
		background: rgba(10, 10, 16, 0.55);
		backdrop-filter: blur(6px);
		border-radius: 999px;
		padding: 3px 9px;
	}
	.deck-qc.dk-low {
		background: color-mix(in srgb, var(--error) 75%, #000);
	}
	.deck-body {
		padding: 0.75rem 0.9rem 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.deck-cap {
		font-size: 0.84rem;
		color: var(--text-muted);
		line-height: 1.5;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.deck-controls {
		display: flex;
		gap: 0.7rem;
		align-items: center;
		padding: var(--space-5) 0 var(--space-2);
	}
	.dk-round {
		width: 50px;
		height: 50px;
		border-radius: 50%;
		border: 1.5px solid var(--border-strong);
		background: var(--surface);
		color: var(--text-muted);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: transform 0.15s ease;
	}
	.dk-round:hover:not(:disabled) {
		transform: scale(1.07);
	}
	.dk-round:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.dk-yes {
		width: 62px;
		height: 62px;
		border-color: var(--success);
		color: var(--success-text);
		background: var(--success-soft);
	}
	.dk-no {
		border-color: var(--error);
		color: var(--error-text);
		background: var(--error-soft);
	}
	.dk-nav {
		width: 44px;
		height: 44px;
	}
	.deck-progress {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}
	.deck-track {
		width: 180px;
		height: 3px;
		border-radius: 2px;
		background: var(--surface-3);
		overflow: hidden;
	}
	.deck-track i {
		display: block;
		height: 100%;
		background: var(--accent);
		border-radius: 2px;
		transition: width 0.25s ease;
	}
	@media (prefers-reduced-motion: reduce) {
		.dk-round,
		.deck-track i {
			transition: none;
		}
	}

	/* ═══════════════════════════════════════════════════════════════
	   BOARD VIEW
	   ═══════════════════════════════════════════════════════════════ */
	.board {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-4);
		align-items: start;
	}
	.lane {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.65rem;
	}
	.lane-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 0.25rem 0.55rem;
	}
	.lane-title {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-weight: var(--weight-semi);
	}
	.lane.needs .lane-title {
		color: var(--warning-text);
	}
	.lane.sched .lane-title {
		color: var(--success-text);
	}
	.lane.flag .lane-title {
		color: var(--error-text);
	}
	.lane-count {
		font-family: var(--font-mono);
		font-size: 0.68rem;
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}
	.lane-card {
		display: grid;
		grid-template-columns: 46px 1fr;
		gap: 0.55rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.55rem;
		margin-bottom: 0.55rem;
		box-shadow: var(--shadow-sm, none);
	}
	.lane-card:hover {
		border-color: var(--accent-mid);
	}
	.lane-card.flagged {
		border-left: 3px solid var(--error);
	}
	.lane-thumb {
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		border-radius: 6px;
		overflow: hidden;
		align-self: start;
	}
	.lane-thumb img {
		width: 46px;
		height: 58px;
		object-fit: cover;
		display: block;
		border-radius: 6px;
	}
	.lane-thumb:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.lane-info {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.lane-who {
		font-size: 0.74rem;
		font-weight: var(--weight-semi);
	}
	.lane-cap {
		font-size: 0.68rem;
		color: var(--text-dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lane-foot {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.lane-quick {
		display: flex;
		gap: 0.35rem;
		margin-top: 0.3rem;
	}
	.lq-btn {
		flex: 1;
		font-size: 0.66rem;
		font-weight: var(--weight-semi);
		min-height: 34px;
		border-radius: 7px;
		border: 1px solid var(--border-strong);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.lq-btn:hover:not(:disabled) {
		background: var(--surface-2);
		color: var(--text);
	}
	.lq-btn.lq-ok:hover:not(:disabled) {
		background: var(--success-soft);
		color: var(--success-text);
		border-color: var(--success);
	}
	.lq-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.lane-empty {
		font-size: 0.74rem;
		color: var(--text-dim);
		text-align: center;
		padding: 1rem 0;
	}
	@media (max-width: 900px) {
		.board {
			grid-template-columns: 1fr;
		}
	}
</style>
