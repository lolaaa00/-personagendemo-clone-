<script lang="ts">
	import { onMount } from 'svelte';
	import { platformLabel } from '$lib/platforms';
	import PostDrawer from '$lib/components/feed/PostDrawer.svelte';
	import ManualDeleteNotice from '$lib/components/feed/ManualDeleteNotice.svelte';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import { Posts } from '$lib/services/api';

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
		quality_score: number | null;
		quality_issue: string | null;
		platforms: string[];
		scheduled_date: string | null;
		scheduled_time: string | null;
	}

	let items = $state<ReviewItem[]>([]);
	let loading = $state(true);
	let working = $state(false);
	let error = $state('');
	let selected = $state<Set<string>>(new Set());
	let toast = $state('');

	// ── Hard delete (permanent, plus best-effort live platform teardown) ──
	// Kept separate from `working` (approve/reject) so the drawer's Approve
	// button doesn't read as busy while a delete is in flight.
	let deletingId = $state<string | null>(null);
	let bulkDeleting = $state(false);
	let deleteBusy = $derived(bulkDeleting || deletingId !== null);
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
	let filterAgent = $state('all');
	let filterPlatform = $state('all');
	let filterStatus = $state('all');

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
				(filterStatus === 'all' || i.status === filterStatus)
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
	let rejectReason = $state(REJECT_REASONS[0]);
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

	function showToast(msg: string) {
		toast = msg;
		setTimeout(() => (toast = ''), 3500);
	}

	async function act(action: 'approve' | 'reject', ids: string[], reason?: string) {
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
			items = items.filter((i) => !ids.includes(i.id));
			selected = new Set([...selected].filter((id) => !ids.includes(id)));
			if (drawerPost && ids.includes(drawerPost.id)) drawerPost = null;
			showToast(
				action === 'approve'
					? `✅ ${d.updated} post(s) approved & scheduled`
					: `🗑 ${d.updated} post(s) rejected`
			);
		} catch (e: any) {
			showToast(`⚠ ${e.message}`);
		} finally {
			working = false;
			rejectPickerOpen = false;
			rejectNote = '';
		}
	}

	function submitReject() {
		const reason = rejectNote.trim() ? `${rejectReason}: ${rejectNote.trim()}` : rejectReason;
		act('reject', [...selected], reason);
	}

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

	/** Names the teardown outcome in the toast so "deleted" never over-claims. */
	function deletedToast(count: number, teardown?: Teardown): string {
		const noun = `${count} post${count === 1 ? '' : 's'}`;
		if (teardown?.unpublished?.length) {
			return `🗑 Deleted ${noun} — also removed from ${teardown.unpublished.join(', ')}`;
		}
		return `🗑 Deleted ${noun} permanently`;
	}

	/**
	 * Single delete. `skipConfirm` is for the drawer, whose footer already has its
	 * own two-click "Confirm delete?" — a second native prompt would be noise.
	 */
	async function deletePost(id: string, opts: { skipConfirm?: boolean } = {}) {
		if (working || deleteBusy) return;
		const item = items.find((i) => i.id === id);
		if (!opts.skipConfirm) {
			const snippet = (item?.text ?? '').trim().slice(0, 60);
			const label = snippet
				? `"${snippet}${(item?.text ?? '').trim().length > 60 ? '…' : ''}"`
				: 'this post';
			if (
				!confirm(
					`Permanently delete ${label}? Anything already published is removed from the platforms that support API deletion. This cannot be undone.`
				)
			)
				return;
		}
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
		if (
			!confirm(
				`Permanently delete ${ids.length} post${ids.length === 1 ? '' : 's'}? Anything already published is removed from the platforms that support API deletion. This cannot be undone.`
			)
		)
			return;
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
					`⚠ Deleted ${gone} of ${asked} — the rest weren't found or aren't yours. Queue reloaded.`
				);
				await load();
				return;
			}
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
		selected = new Set([post.id]);
		drawerPost = null;
		rejectPickerOpen = true;
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
</script>

<div class="review-page">
	<header class="review-header">
		<div>
			<h1>Review Queue</h1>
			<p class="sub">
				Pending content from every persona — drafts to approve <em>and</em> scheduled posts not
				yet published. Approve to schedule, reject with a reason (reasons train the future QC
				agent).
			</p>
		</div>
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
	</header>

	{#if toast}<div class="toast" role="status" aria-live="polite">{toast}</div>{/if}

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
					<option value="all">Draft + Scheduled</option>
					<option value="draft">Draft only</option>
					<option value="scheduled">Scheduled only</option>
				</select>
			</label>
			<span class="filt-count" aria-live="polite">{filteredItems.length} of {items.length} shown</span>
		</div>

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
					disabled={selected.size === 0 || working || deleteBusy}
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
					disabled={selected.size === 0 || working || deleteBusy}
					onclick={() => (rejectPickerOpen = true)}
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
					title="Permanently delete — also removes published copies where the platform API allows it"
					disabled={selected.size === 0 || working || deleteBusy}
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

		{#if rejectPickerOpen}
			<h2 class="sr-only">Reject reason</h2>
			<div class="reject-picker">
				<span class="rp-label" id="rp-label">Reason:</span>
				<select bind:value={rejectReason} aria-labelledby="rp-label">
					{#each REJECT_REASONS as r}<option value={r}>{r}</option>{/each}
				</select>
				<input
					type="text"
					aria-label="Optional note about this rejection"
					placeholder="optional note…"
					bind:value={rejectNote}
					maxlength="300"
				/>
				<button class="btn-reject" onclick={submitReject} disabled={working}>Confirm reject</button>
				<button class="btn-ghost" onclick={() => (rejectPickerOpen = false)}>Cancel</button>
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
							{#if item.media_type === 'video' && (item.poster_url || item.media_url)}
								<img
									src={item.poster_url || item.media_url}
									alt="Video draft preview for {item.agent_name}"
									width="800"
									height="1000"
									loading="lazy"
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
									src={item.media_url}
									alt="Image draft preview for {item.agent_name}"
									width="800"
									height="1000"
									loading="lazy"
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
								title={item.media_type === 'video' ? 'Play full size' : 'Enlarge image'}
								aria-label={item.media_type === 'video' ? 'Play full size' : 'Enlarge image'}
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
									src={item.agent_avatar}
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
								<button class="btn-approve sm" disabled={working || deleteBusy} onclick={() => act('approve', [item.id])}>Approve</button>
							{/if}
							<button
								class="btn-reject sm"
								disabled={working || deleteBusy}
								onclick={() => {
									selected = new Set([item.id]);
									rejectPickerOpen = true;
								}}>{item.status === 'scheduled' ? 'Unschedule' : 'Reject'}</button
							>
							<button
								class="btn-delete sm"
								title="Delete permanently — removes it from connected platforms where possible"
								aria-label="Delete post permanently"
								disabled={working || deleteBusy}
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
	{/if}

	<PostDrawer
		post={drawerPost}
		onClose={() => (drawerPost = null)}
		onApprove={(p) => act('approve', [p.id])}
		onReject={drawerReject}
		onDelete={(p) => deletePost(p.id, { skipConfirm: true })}
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
</div>

<style>
	.review-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1.5rem;
	}
	.review-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 1.25rem;
	}
	.review-header h1 {
		margin: 0 0 0.25rem 0;
		font-size: 1.4rem;
	}
	.sub {
		margin: 0;
		color: var(--text-dim);
		font-size: var(--text-sm, 0.85rem);
		max-width: 640px;
	}
	.toast {
		position: fixed;
		bottom: 1.5rem;
		right: 1.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		padding: 0.75rem 1rem;
		border-radius: 10px;
		z-index: var(--z-toast);
	}
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
</style>
