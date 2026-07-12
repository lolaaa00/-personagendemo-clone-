<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { getPostDisplay, truncateError } from './postDisplay';
	import { platformColor } from '$lib/platforms';
	import { OPERATION_LABELS } from '$lib/pricing';

	let {
		post,
		onClose,
		onDelete,
		onApprove,
		onSaveText = undefined,
		onReschedule = undefined,
		onPublishFallback = undefined,
		approving = false,
		deleting = false
	}: {
		post: any | null;
		onClose: () => void;
		onDelete: (post: any) => void;
		onApprove: (post: any) => void;
		/** When provided, the caption becomes editable (returns false to keep editing open). */
		onSaveText?: (post: any, newText: string) => Promise<boolean> | boolean;
		/** When provided, draft/scheduled posts get a date/time edit control (returns false to keep the values dirty). */
		onReschedule?: (post: any, date: string, time: string) => Promise<boolean> | boolean;
		/** When provided, a failed/unpublished post can be (re)published to a connected platform. */
		onPublishFallback?: ((post: any) => void) | null;
		approving?: boolean;
		deleting?: boolean;
	} = $props();

	// ── Caption editing (available at any status — drafts through published) ──
	let editingText = $state(false);
	let draftText = $state('');
	let savingText = $state(false);
	$effect(() => {
		// Reset edit mode whenever a different post opens.
		void post?.id;
		editingText = false;
		savingText = false;
		schedDate = post?.scheduled_date ?? '';
		schedTime = (post?.scheduled_time ?? '10:00:00').slice(0, 5);
		savingSchedule = false;
	});
	function startTextEdit() {
		draftText = display?.text ?? '';
		editingText = true;
	}
	async function saveTextEdit() {
		if (!onSaveText || !post || savingText) return;
		savingText = true;
		try {
			const ok = await onSaveText(post, draftText);
			if (ok !== false) editingText = false;
		} finally {
			savingText = false;
		}
	}

	// ── Reschedule (draft/scheduled only, when the host page wires it) ──
	let schedDate = $state('');
	let schedTime = $state('');
	let savingSchedule = $state(false);
	let canReschedule = $derived(
		Boolean(onReschedule && post && (post.status === 'draft' || post.status === 'scheduled'))
	);
	async function saveReschedule() {
		if (!onReschedule || !post || savingSchedule || !schedDate || !schedTime) return;
		savingSchedule = true;
		try {
			await onReschedule(post, schedDate, `${schedTime}:00`);
		} finally {
			savingSchedule = false;
		}
	}

	let display = $derived(post ? getPostDisplay(post) : null);

	// ── Observability: the generation provenance captured at generation time ──
	let gen = $derived(display?.generation ?? null);
	// Per-aspect model + cost rows (image / video / tts / llm …).
	let genAspects = $derived.by(() => {
		const a = gen?.aspects;
		if (!a || typeof a !== 'object') return [] as { op: string; models: string[]; usd: number }[];
		return Object.entries(a).map(([op, v]: [string, any]) => ({
			op,
			models: Array.isArray(v?.models) ? v.models : [],
			usd: Number(v?.usd ?? 0)
		}));
	});
	// The input images actually SENT to the models, as labelled thumbnails.
	let genImages = $derived.by(() => {
		const im = gen?.images ?? {};
		const list: { label: string; url: string }[] = [];
		if (im.character_ref) list.push({ label: 'Character', url: im.character_ref });
		if (im.product_photo) list.push({ label: 'Product', url: im.product_photo });
		for (const u of im.reference_kit ?? []) if (u) list.push({ label: 'Reference', url: u });
		return list;
	});
	let genSelections = $derived(gen?.selections ?? null);
	// A failed post that still has media only failed to PUBLISH — it can be re-sent.
	let canRepublish = $derived(
		Boolean(onPublishFallback && post && post.status === 'failed' && display?.mediaUrl)
	);

	let analytics = $derived(post?.analytics ?? null);
	let hasRealStats = $derived(
		Boolean(analytics && (analytics.views || analytics.likes || analytics.comments || analytics.shares))
	);

	let platformResults = $derived.by(() => {
		if (!post?.publication_results) return [];
		return Object.entries(post.publication_results).filter(([key]) => key !== '_post');
	});

	// Post-level failure reason: terminal error first, else the last retry error.
	let postLevelError = $derived.by(() => {
		const meta = post?.publication_results?._post;
		const msg = meta?.error ?? meta?.last_error ?? null;
		return typeof msg === 'string' && msg ? truncateError(msg) : null;
	});

	function statusColor(status: string): string {
		if (status === 'published') return 'var(--success)';
		if (status === 'failed') return 'var(--error)';
		if (status === 'publishing') return 'var(--cyan)';
		if (status === 'partial') return 'var(--warning)';
		if (status === 'rejected') return 'var(--rose)';
		if (status === 'scheduled') return 'var(--accent)';
		return 'var(--text-dim)';
	}

	function formatPostDate(p: any): string {
		const d =
			p.published_at ||
			(p.scheduled_date ? `${p.scheduled_date}T${p.scheduled_time || '10:00:00'}` : null);
		if (!d) return 'Recently';
		return new Date(d).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// ── Delete two-click confirm ──────────────────────────────────────
	let confirmingDelete = $state(false);
	let confirmTimeout: ReturnType<typeof setTimeout> | undefined;

	function handleDeleteClick() {
		if (!post || deleting) return;
		if (confirmingDelete) {
			clearTimeout(confirmTimeout);
			confirmingDelete = false;
			onDelete(post);
		} else {
			confirmingDelete = true;
			confirmTimeout = setTimeout(() => {
				confirmingDelete = false;
			}, 3000);
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={post ? onKeydown : undefined} />

{#if post && display}
	<div class="drawer-backdrop" transition:fade={{ duration: 150 }} onclick={onClose} role="presentation"></div>
	<aside class="post-drawer" transition:fly={{ x: 440, duration: 260, opacity: 1 }} role="dialog" aria-label="Post details" tabindex="-1">
		<div class="drawer-header">
			<div class="drawer-header-meta">
				<span class="drawer-date">{formatPostDate(post)}</span>
				<span class="drawer-status-badge" style="color: {statusColor(post.status)}; border-color: {statusColor(post.status)}">{post.status}</span>
				{#each post.platforms ?? [] as p (p)}
					<span class="drawer-platform-pill" style="background: {platformColor(p)}">{p}</span>
				{/each}
			</div>
			<button class="drawer-close" onclick={onClose} aria-label="Close details">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
			</button>
		</div>

		<div class="drawer-body">
			{#if display.mediaUrl}
				<div class="drawer-media">
					{#if display.mediaType === 'video'}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video src={display.mediaUrl} poster={display.posterUrl || undefined} controls playsinline preload="metadata"></video>
					{:else}
						<img src={display.mediaUrl} alt="Post media" />
					{/if}
				</div>
			{/if}

			{#if hasRealStats}
				<div class="drawer-stats">
					{#if analytics.views}<span class="stat"><strong>{analytics.views >= 1000 ? (analytics.views / 1000).toFixed(1) + 'K' : analytics.views}</strong> views</span>{/if}
					{#if analytics.likes}<span class="stat"><strong>{analytics.likes}</strong> likes</span>{/if}
					{#if analytics.comments}<span class="stat"><strong>{analytics.comments}</strong> comments</span>{/if}
					{#if analytics.shares}<span class="stat"><strong>{analytics.shares}</strong> shares</span>{/if}
				</div>
			{:else if post.status === 'published'}
				<p class="drawer-stats-pending">Stats pending first sync from the platform.</p>
			{/if}

			{#if editingText}
				<div class="drawer-text-edit">
					<textarea rows="6" bind:value={draftText}></textarea>
					<div class="drawer-text-edit-actions">
						<button type="button" class="dt-btn" onclick={() => (editingText = false)} disabled={savingText}>Cancel</button>
						<button type="button" class="dt-btn dt-save" onclick={saveTextEdit} disabled={savingText}>
							{savingText ? 'Saving…' : 'Save caption'}
						</button>
					</div>
				</div>
			{:else}
				<div class="drawer-text-row">
					<p class="drawer-text">{display.text}</p>
					{#if onSaveText}
						<button type="button" class="dt-edit" onclick={startTextEdit} title="Edit caption" aria-label="Edit caption">✎</button>
					{/if}
				</div>
			{/if}

			{#if canReschedule}
				<div class="drawer-reschedule">
					<span class="drawer-block-label">Scheduled for</span>
					<div class="reschedule-row">
						<input type="date" bind:value={schedDate} disabled={savingSchedule} aria-label="Scheduled date" />
						<input type="time" bind:value={schedTime} disabled={savingSchedule} aria-label="Scheduled time" />
						<button
							type="button"
							class="dt-btn dt-save"
							onclick={saveReschedule}
							disabled={savingSchedule || !schedDate || !schedTime}
						>
							{savingSchedule ? 'Saving…' : 'Reschedule'}
						</button>
					</div>
				</div>
			{/if}

			{#if display.product?.name}
				<div class="drawer-product">
					<span class="drawer-block-label">Product</span>
					<span>{display.product.name}{display.product.price ? ` — ${display.product.price}` : ''}</span>
				</div>
			{/if}

			{#if gen || display.ugcPrompt || display.script}
				<details class="drawer-details-block" open={Boolean(gen)}>
					<summary>Generation details</summary>

					{#if genImages.length}
						<div>
							<span class="drawer-block-label">🖼 Images sent to the model</span>
							<div class="gen-imgs">
								{#each genImages as img (img.url)}
									<figure class="gen-img">
										<img src={img.url} alt={img.label} loading="lazy" />
										<figcaption>{img.label}</figcaption>
									</figure>
								{/each}
							</div>
						</div>
					{/if}

					{#if display.ugcPrompt}
						<div>
							<span class="drawer-block-label">🎥 UGC prompt sent</span>
							<p class="gen-prompt">{display.ugcPrompt}</p>
						</div>
					{/if}
					{#if display.script}
						<div>
							<span class="drawer-block-label">🎬 Script</span>
							<p class="gen-prompt">{display.script}</p>
						</div>
					{/if}

					{#if genAspects.length}
						<div>
							<span class="drawer-block-label">⚙ Models &amp; cost by aspect</span>
							<table class="gen-cost">
								<tbody>
									{#each genAspects as a (a.op)}
										<tr>
											<td class="gen-op">{OPERATION_LABELS[a.op] ?? a.op}</td>
											<td class="gen-model">{a.models.join(', ') || '—'}</td>
											<td class="gen-usd">${a.usd.toFixed(3)}</td>
										</tr>
									{/each}
									<tr class="gen-total">
										<td>Total</td>
										<td></td>
										<td class="gen-usd">${Number(gen?.total ?? 0).toFixed(3)}</td>
									</tr>
								</tbody>
							</table>
						</div>
					{/if}

					{#if genSelections}
						<div>
							<span class="drawer-block-label">🎯 Selections at generation</span>
							<ul class="gen-sel">
								{#if genSelections.platforms?.length}
									<li><span>Platforms</span>{genSelections.platforms.join(', ')}</li>
								{/if}
								{#if genSelections.brand}<li><span>Brand</span>{genSelections.brand}</li>{/if}
								{#if genSelections.videoModel}
									<li><span>Video model</span>{genSelections.videoModel}</li>
								{/if}
								{#if genSelections.provider}<li><span>Provider</span>{genSelections.provider}</li>{/if}
								{#if genSelections.mediaType}<li><span>Media</span>{genSelections.mediaType}</li>{/if}
							</ul>
						</div>
					{/if}
				</details>
			{/if}

			{#if postLevelError}
				<div class="drawer-error">
					<strong>⚠ Post-level error</strong>
					<p>{postLevelError}</p>
				</div>
			{/if}

			{#if platformResults.length > 0}
				<div class="drawer-breakdown">
					<span class="drawer-block-label">Platform breakdown</span>
					{#each platformResults as [platform, result] (platform)}
						{@const r = result as any}
						<div class="breakdown-item">
							<div class="breakdown-head">
								<span style="color: {platformColor(platform)}; font-weight: 700; text-transform: capitalize;">{platform}</span>
								<span class="breakdown-pill" style="color: {statusColor(r.status)}; border-color: {statusColor(r.status)};">{r.status}</span>
							</div>
							{#if r.error && r.status !== 'published'}
								<p class="breakdown-error">{truncateError(r.error)}</p>
							{/if}
							{#if r.permalink}
								<a href={r.permalink} target="_blank" rel="noopener noreferrer" class="breakdown-link">View live post ↗</a>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="drawer-footer">
			<button type="button" class="btn-drawer-delete" class:confirming={confirmingDelete} disabled={deleting} onclick={handleDeleteClick}>
				{#if deleting}Deleting…{:else if confirmingDelete}Confirm delete?{:else}Delete{/if}
			</button>
			{#if post.status === 'draft'}
				<button type="button" class="btn-drawer-approve" disabled={approving} onclick={() => onApprove(post)}>
					{approving ? 'Approving…' : '✓ Approve & Schedule'}
				</button>
			{:else if canRepublish}
				<!-- Media generated fine; only publishing failed. Re-send to a platform
				     that IS connected — the user picks which. No auto-retry. -->
				<button type="button" class="btn-drawer-approve" onclick={() => onPublishFallback?.(post)}>
					📤 Publish to a connected platform
				</button>
			{/if}
			<button type="button" class="btn-drawer-close" onclick={onClose}>Close</button>
		</div>
	</aside>
{/if}

<style>
	.drawer-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.55);
		backdrop-filter: blur(4px);
		z-index: 1000;
	}

	.drawer-text-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}
	.dt-edit {
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-dim);
		cursor: pointer;
	}
	.dt-edit:hover { border-color: var(--accent-mid); color: var(--text); }
	.drawer-text-edit textarea {
		width: 100%;
		background: var(--surface-2, rgba(255, 255, 255, 0.03));
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text);
		padding: 0.6rem;
		font: inherit;
		font-size: 0.85rem;
	}
	.drawer-text-edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.dt-btn {
		padding: 0.4rem 0.85rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-dim);
		font-size: 0.8rem;
		cursor: pointer;
	}
	.dt-save {
		background: var(--accent, #d4a017);
		border-color: transparent;
		color: #fff;
	}

	.drawer-reschedule {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.reschedule-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.reschedule-row input {
		background: var(--surface-2, rgba(255, 255, 255, 0.03));
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text);
		padding: 0.4rem 0.6rem;
		font: inherit;
		font-size: 0.8rem;
	}

	.post-drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(580px, 100vw);
		background: var(--surface);
		border-left: 1px solid var(--border-strong);
		z-index: 1001;
		display: flex;
		flex-direction: column;
		box-shadow: -18px 0 50px rgba(0, 0, 0, 0.35);
	}

	.drawer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid var(--border);
		background: var(--surface-2);
	}

	.drawer-header-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		min-width: 0;
	}

	.drawer-date {
		font-size: 0.78rem;
		color: var(--text-dim);
	}

	.drawer-status-badge {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		padding: 2px 8px;
		border-radius: 4px;
		border: 1px solid;
	}

	.drawer-platform-pill {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		color: #fff;
		padding: 2px 8px;
		border-radius: 999px;
	}

	.drawer-close {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		border-radius: 999px;
		border: none;
		background: var(--surface);
		color: var(--text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background 0.2s, color 0.2s, transform 0.2s;
	}

	.drawer-close:hover {
		color: var(--text);
		background: var(--border-strong);
		transform: rotate(90deg);
	}

	.drawer-body {
		flex: 1;
		overflow-y: auto;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.drawer-media {
		border-radius: var(--radius-sm);
		overflow: hidden;
		border: 1px solid var(--border);
		background: #000;
	}

	.drawer-media img,
	.drawer-media video {
		width: 100%;
		max-height: 55vh;
		object-fit: contain;
		display: block;
	}

	.drawer-stats {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 0.6rem 0.9rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.stat {
		font-size: 0.78rem;
		color: var(--text-muted);
	}

	.stat strong {
		color: var(--text);
	}

	.drawer-stats-pending {
		font-size: 0.75rem;
		color: var(--text-dim);
		font-style: italic;
		margin: 0;
	}

	.drawer-text {
		font-size: 0.85rem;
		color: var(--text);
		line-height: 1.6;
		white-space: pre-wrap;
		margin: 0;
	}

	.drawer-product {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.drawer-block-label {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
		font-weight: 700;
		display: block;
	}

	.drawer-details-block {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.75rem 0.9rem;
		font-size: 0.75rem;
		color: var(--text-dim);
	}

	.drawer-details-block summary {
		cursor: pointer;
		font-weight: 600;
		color: var(--text-muted);
		font-size: 0.78rem;
	}

	.drawer-details-block div {
		margin-top: 0.6rem;
	}

	.drawer-details-block p {
		margin: 0.25rem 0 0;
		white-space: pre-wrap;
	}

	/* ── Observability panel ── */
	.drawer-details-block .gen-imgs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.4rem;
	}
	.gen-img {
		margin: 0;
		width: 72px;
	}
	.gen-img img {
		width: 72px;
		height: 72px;
		object-fit: cover;
		border-radius: 8px;
		border: 1px solid var(--border);
		display: block;
	}
	.gen-img figcaption {
		font-size: 0.62rem;
		text-align: center;
		color: var(--text-dim);
		margin-top: 2px;
	}
	.gen-prompt {
		font-size: 0.72rem;
		line-height: 1.45;
	}
	.gen-cost {
		width: 100%;
		border-collapse: collapse;
		margin-top: 0.4rem;
		font-size: 0.72rem;
	}
	.gen-cost td {
		padding: 0.3rem 0.3rem;
		border-top: 1px solid var(--border);
		vertical-align: top;
	}
	.gen-op {
		color: var(--text-muted);
	}
	.gen-model {
		color: var(--text-dim);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.66rem;
		word-break: break-word;
	}
	.gen-usd {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		color: var(--text);
	}
	.gen-total td {
		border-top: 1px solid var(--border-strong);
		font-weight: 700;
		color: var(--text);
	}
	.gen-sel {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.72rem;
	}
	.gen-sel li {
		display: flex;
		gap: 0.5rem;
	}
	.gen-sel li span {
		color: var(--text-muted);
		min-width: 92px;
		font-weight: 600;
		text-transform: capitalize;
	}

	.drawer-error {
		background: var(--error-soft);
		border-left: 3px solid var(--error);
		border-radius: 6px;
		padding: 0.6rem 0.85rem;
		color: var(--error);
	}

	.drawer-error strong {
		font-size: 0.78rem;
		display: block;
	}

	.drawer-error p {
		margin: 0.3rem 0 0;
		font-size: 0.78rem;
	}

	.drawer-breakdown {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.breakdown-item {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.7rem 0.85rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.breakdown-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.8rem;
	}

	.breakdown-pill {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		padding: 2px 7px;
		border-radius: 999px;
		border: 1px solid;
	}

	.breakdown-error {
		font-size: 0.75rem;
		color: var(--error);
		margin: 0;
		line-height: 1.5;
	}

	.breakdown-link {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--accent);
		text-decoration: none;
		align-self: flex-start;
	}

	.breakdown-link:hover {
		text-decoration: underline;
	}

	.drawer-footer {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.9rem 1.25rem;
		border-top: 1px solid var(--border);
		background: var(--surface-2);
	}

	.btn-drawer-delete {
		background: var(--error-soft);
		color: var(--error);
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 0.5rem 1rem;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-drawer-delete:hover:not(:disabled),
	.btn-drawer-delete.confirming {
		background: var(--error);
		color: #fff;
	}

	.btn-drawer-approve {
		background: var(--success-soft);
		color: var(--success);
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 0.5rem 1rem;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-drawer-approve:hover:not(:disabled) {
		background: var(--success);
		color: #fff;
	}

	.btn-drawer-approve:disabled,
	.btn-drawer-delete:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-drawer-close {
		margin-left: auto;
		background: var(--surface);
		color: var(--text-muted);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.5rem 1rem;
		font-size: 0.78rem;
		font-weight: 500;
		cursor: pointer;
	}

	.btn-drawer-close:hover {
		border-color: var(--accent-mid);
		color: var(--text);
	}

	@media (max-width: 520px) {
		.post-drawer {
			width: 100vw;
			border-left: none;
		}
	}
</style>
