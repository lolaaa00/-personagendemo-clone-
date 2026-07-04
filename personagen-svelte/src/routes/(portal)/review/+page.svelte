<script lang="ts">
	import { onMount } from 'svelte';
	import { platformLabel } from '$lib/platforms';

	interface ReviewItem {
		id: string;
		agent_id: string;
		agent_name: string;
		agent_avatar: string | null;
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
		selected = selected.size === items.length ? new Set() : new Set(items.map((i) => i.id));
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

	function slotLabel(i: ReviewItem): string {
		if (!i.scheduled_date) return 'Unscheduled';
		return `${i.scheduled_date} · ${(i.scheduled_time || '').slice(0, 5)}`;
	}
</script>

<div class="review-page">
	<header class="review-header">
		<div>
			<h1>Review Queue</h1>
			<p class="sub">
				Drafts from every persona in one place — approve to schedule, reject with a reason
				(reasons train the future QC agent).
			</p>
		</div>
		<div class="header-actions">
			<button class="btn-ghost" onclick={load} disabled={loading || working}>↻ Refresh</button>
		</div>
	</header>

	{#if toast}<div class="toast">{toast}</div>{/if}

	{#if loading}
		<div class="empty">Loading queue…</div>
	{:else if error}
		<div class="empty err">{error}</div>
	{:else if items.length === 0}
		<div class="empty">🎉 Queue is clear — no drafts awaiting review.</div>
	{:else}
		<div class="bulk-bar">
			<label class="check-all">
				<input
					type="checkbox"
					checked={selected.size === items.length && items.length > 0}
					onchange={toggleAll}
				/>
				{selected.size} / {items.length} selected
			</label>
			<div class="bulk-actions">
				<button
					class="btn-approve"
					disabled={selected.size === 0 || working}
					onclick={() => act('approve', [...selected])}
				>
					✅ Approve & Schedule ({selected.size})
				</button>
				<button
					class="btn-reject"
					disabled={selected.size === 0 || working}
					onclick={() => (rejectPickerOpen = true)}
				>
					✕ Reject ({selected.size})
				</button>
			</div>
		</div>

		{#if rejectPickerOpen}
			<div class="reject-picker">
				<span class="rp-label">Reason:</span>
				<select bind:value={rejectReason}>
					{#each REJECT_REASONS as r}<option value={r}>{r}</option>{/each}
				</select>
				<input type="text" placeholder="optional note…" bind:value={rejectNote} maxlength="300" />
				<button class="btn-reject" onclick={submitReject} disabled={working}>Confirm reject</button>
				<button class="btn-ghost" onclick={() => (rejectPickerOpen = false)}>Cancel</button>
			</div>
		{/if}

		<div class="queue-grid">
			{#each items as item (item.id)}
				<div class="queue-card" class:selected={selected.has(item.id)}>
					<button type="button" class="card-media" onclick={() => toggle(item.id)}>
						{#if item.media_type === 'video' && (item.poster_url || item.media_url)}
							<img src={item.poster_url || item.media_url} alt="draft preview" loading="lazy" />
							<span class="media-badge">▶ video</span>
						{:else if item.media_url}
							<img src={item.media_url} alt="draft preview" loading="lazy" />
						{:else}
							<div class="no-media">no media</div>
						{/if}
						<span class="pick" class:on={selected.has(item.id)}>✓</span>
					</button>
					<div class="card-body">
						<div class="card-agent">
							{#if item.agent_avatar}<img src={item.agent_avatar} alt={item.agent_name} />{/if}
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
						</div>
						<p class="caption">{item.text}</p>
						<div class="plat-row">
							{#each item.platforms as p}<span class="plat-chip">{platformLabel(p)}</span>{/each}
						</div>
						<div class="card-actions">
							<button class="btn-approve sm" disabled={working} onclick={() => act('approve', [item.id])}>Approve</button>
							<button
								class="btn-reject sm"
								disabled={working}
								onclick={() => {
									selected = new Set([item.id]);
									rejectPickerOpen = true;
								}}>Reject</button
							>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
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
		color: var(--text-dim, #889);
		font-size: var(--text-sm, 0.85rem);
		max-width: 640px;
	}
	.toast {
		position: fixed;
		bottom: 1.5rem;
		right: 1.5rem;
		background: var(--surface, #1c1c28);
		border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
		padding: 0.75rem 1rem;
		border-radius: 10px;
		z-index: 50;
	}
	.empty {
		padding: 3rem;
		text-align: center;
		color: var(--text-dim, #889);
	}
	.empty.err {
		color: var(--danger, #f66);
	}
	.bulk-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
		border-radius: 12px;
		margin-bottom: 1rem;
		position: sticky;
		top: 0.5rem;
		background: var(--bg, #101018);
		z-index: 10;
	}
	.check-all {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-sm, 0.85rem);
		cursor: pointer;
	}
	.bulk-actions {
		display: flex;
		gap: 0.5rem;
	}
	.reject-picker {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		padding: 0.75rem 1rem;
		border: 1px solid var(--danger, #f66);
		border-radius: 12px;
		margin-bottom: 1rem;
	}
	.rp-label {
		font-size: var(--text-sm, 0.85rem);
		color: var(--text-dim, #889);
	}
	.reject-picker select,
	.reject-picker input {
		padding: 0.45rem 0.6rem;
		border-radius: 8px;
		border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
		background: transparent;
		color: inherit;
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
		border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
		border-radius: 14px;
		overflow: hidden;
		transition: border-color 0.15s ease;
	}
	.queue-card.selected {
		border-color: var(--accent-mid, #7c6aed);
	}
	.card-media {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 4 / 5;
		padding: 0;
		border: 0;
		background: rgba(255, 255, 255, 0.03);
		cursor: pointer;
	}
	.card-media img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.no-media {
		display: grid;
		place-items: center;
		height: 100%;
		color: var(--text-dim, #889);
		font-size: var(--text-sm, 0.85rem);
	}
	.media-badge {
		position: absolute;
		top: 8px;
		left: 8px;
		background: rgba(0, 0, 0, 0.65);
		color: #fff;
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
	}
	.pick {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 24px;
		height: 24px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.5);
		color: transparent;
		border: 1.5px solid rgba(255, 255, 255, 0.7);
		font-size: 13px;
	}
	.pick.on {
		background: var(--accent-mid, #7c6aed);
		color: #fff;
		border-color: var(--accent-mid, #7c6aed);
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
		color: var(--text-dim, #889);
		font-family: var(--font-mono, monospace);
	}
	.qc-badge {
		font-size: 10px;
		font-weight: 700;
		padding: 1px 7px;
		border-radius: 999px;
		border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
		color: var(--text-dim, #99a);
		font-family: var(--font-mono, monospace);
	}
	.qc-badge.qc-high {
		color: var(--success, #10b981);
		border-color: var(--success, #10b981);
	}
	.qc-badge.qc-low {
		color: var(--danger, #f66);
		border-color: var(--danger, #f66);
	}
	.caption {
		margin: 0 0 0.5rem 0;
		font-size: var(--text-sm, 0.85rem);
		color: var(--text, #eee);
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
		border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
		color: var(--text-dim, #889);
	}
	.card-actions {
		display: flex;
		gap: 0.5rem;
	}
	.btn-approve,
	.btn-reject,
	.btn-ghost {
		padding: 0.5rem 0.9rem;
		border-radius: 9px;
		border: 1px solid transparent;
		font-weight: 600;
		font-size: var(--text-sm, 0.85rem);
		cursor: pointer;
	}
	.btn-approve {
		background: var(--success, #10b981);
		color: #fff;
	}
	.btn-reject {
		background: transparent;
		border-color: var(--danger, #f66);
		color: var(--danger, #f66);
	}
	.btn-ghost {
		background: transparent;
		border-color: var(--border, rgba(255, 255, 255, 0.15));
		color: var(--text-dim, #99a);
	}
	.btn-approve.sm,
	.btn-reject.sm {
		flex: 1;
		padding: 0.4rem 0.5rem;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
