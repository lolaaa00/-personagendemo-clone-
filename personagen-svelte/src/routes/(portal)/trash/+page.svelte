<script lang="ts">
	/**
	 * Trash — where deleted posts wait before they're really gone.
	 *
	 * Deleting used to be a hard DELETE with no confirmation and no recovery.
	 * Posts now carry `deleted_at`, so a delete is reversible for 30 days and
	 * this page is where you reverse it.
	 */
	import { invalidateAll } from '$app/navigation';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import SelectionToolbar from '$lib/components/ui/SelectionToolbar.svelte';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import { Posts } from '$lib/services/api';
	import { showToast } from '$lib/stores/ui.svelte';
	import { confirmRestorePosts, confirmPurgePosts } from '$lib/confirm-preview';
	import { getPostDisplay } from '$lib/components/feed/postDisplay';
	import PageShell from '$lib/components/ui/PageShell.svelte';

	let { data } = $props();

	let posts = $state<any[]>([...data.trashed]);
	$effect(() => {
		posts = [...data.trashed];
	});

	let selectedIds = $state<string[]>([]);
	let busy = $state(false);
	let lightbox = $state<{ url: string; label: string; poster: string | null } | null>(null);

	const retention = $derived(data.retentionDays ?? 30);

	// Persona filter — the Trash gets mixed across personas fast.
	let personaFilter = $state('all');
	const personas = $derived.by(() => {
		const seen = new Map<string, string>();
		for (const p of posts) {
			if (p.agent_id && !seen.has(p.agent_id)) seen.set(p.agent_id, p.agents?.name ?? 'Persona');
		}
		return [...seen].map(([id, name]) => ({ id, name }));
	});

	const visible = $derived(
		personaFilter === 'all' ? posts : posts.filter((p) => p.agent_id === personaFilter)
	);

	const selected = $derived(posts.filter((p) => selectedIds.includes(p.id)));

	/**
	 * Days left before the retention sweep purges this post. Clamped at 0 — a row
	 * can sit a few minutes past its deadline between hourly sweeps, and showing
	 * "-1 days left" would read like a bug.
	 */
	function daysLeft(post: any): number {
		const deleted = Date.parse(post?.deleted_at ?? '');
		if (!Number.isFinite(deleted)) return retention;
		const elapsed = (Date.now() - deleted) / 86_400_000;
		return Math.max(0, Math.ceil(retention - elapsed));
	}

	function expiryLabel(post: any): string {
		const d = daysLeft(post);
		if (d === 0) return 'Purges within the hour';
		return `${d} day${d === 1 ? '' : 's'} left`;
	}

	function toggleSelected(post: any) {
		selectedIds = selectedIds.includes(post.id)
			? selectedIds.filter((id) => id !== post.id)
			: [...selectedIds, post.id];
	}

	function selectAll() {
		selectedIds = visible.map((p) => p.id);
	}
	function clearSelection() {
		selectedIds = [];
	}

	function openMedia(post: any) {
		const display = getPostDisplay(post);
		if (!display.mediaUrl) {
			showToast('This post has no media', 'info');
			return;
		}
		lightbox = {
			url: display.mediaUrl,
			label: display.text?.slice(0, 80) || 'Post media',
			poster: display.posterUrl
		};
	}

	async function restore(targets: any[]) {
		if (targets.length === 0 || busy) return;
		if (!(await confirmRestorePosts(targets))) return;

		busy = true;
		try {
			const ids = targets.map((p) => p.id);
			const res = await Posts.restore(ids);
			if (!res.success) {
				showToast(res.error || 'Restore failed', 'error');
				return;
			}
			const restored = res.restored ?? ids.length;
			const demoted = res.demoted ?? 0;

			posts = posts.filter((p) => !ids.includes(p.id));
			selectedIds = selectedIds.filter((id) => !ids.includes(id));

			showToast(
				demoted > 0
					? `Restored ${restored} — ${demoted} came back as draft${demoted === 1 ? '' : 's'} because ${demoted === 1 ? 'its slot had' : 'their slots had'} already passed`
					: `Restored ${restored} post${restored === 1 ? '' : 's'}`,
				'success'
			);
			// Every other view filters trashed rows out, so they need re-fetching
			// before the restored posts reappear there.
			await invalidateAll();
		} catch (err) {
			showToast((err as Error).message || 'Restore failed', 'error');
		} finally {
			busy = false;
		}
	}

	async function purge(targets: any[]) {
		if (targets.length === 0 || busy) return;
		if (!(await confirmPurgePosts(targets))) return;

		busy = true;
		try {
			const ids = targets.map((p) => p.id);
			const res = await Posts.purge(ids);
			if (!res.success) {
				showToast(res.error || 'Delete failed', 'error');
				return;
			}
			const purged = res.purged ?? ids.length;
			posts = posts.filter((p) => !ids.includes(p.id));
			selectedIds = selectedIds.filter((id) => !ids.includes(id));
			showToast(`Permanently deleted ${purged} post${purged === 1 ? '' : 's'}`, 'success');
		} catch (err) {
			showToast((err as Error).message || 'Delete failed', 'error');
		} finally {
			busy = false;
		}
	}

	async function emptyTrash() {
		if (posts.length === 0 || busy) return;
		if (!(await confirmPurgePosts(posts, true))) return;

		busy = true;
		try {
			const res = await Posts.purgeAll();
			if (!res.success) {
				showToast(res.error || 'Could not empty the Trash', 'error');
				return;
			}
			const purged = res.purged ?? posts.length;
			posts = [];
			selectedIds = [];
			showToast(`Trash emptied — ${purged} post${purged === 1 ? '' : 's'} gone`, 'success');
		} catch (err) {
			showToast((err as Error).message || 'Could not empty the Trash', 'error');
		} finally {
			busy = false;
		}
	}
</script>

<PageShell
	title="Trash"
	description="Deleted posts wait here for {retention} days, then they're removed for good. Restoring one puts it back in your feed and calendar exactly where it was."
>
	{#snippet actions()}
		{#if posts.length > 0}
			<button class="btn-empty" onclick={emptyTrash} disabled={busy}>Empty Trash</button>
		{/if}
	{/snippet}
	<div class="trash-page">

	{#if data.loadError}
		<p class="trash-error">
			Couldn't load the Trash: {data.loadError}
		</p>
	{/if}

	{#if posts.length === 0}
		<div class="trash-empty">
			<span class="empty-icon" aria-hidden="true">
				<svg
					width="40"
					height="40"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M3 6h18" />
					<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
					<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
				</svg>
			</span>
			<h2>Nothing in the Trash</h2>
			<p>
				Posts you delete land here first. Nothing is removed permanently until you empty the Trash
				or {retention} days pass.
			</p>
		</div>
	{:else}
		{#if personas.length > 1}
			<div class="trash-filters">
				<button class:active={personaFilter === 'all'} onclick={() => (personaFilter = 'all')}>
					All personas
				</button>
				{#each personas as persona (persona.id)}
					<button
						class:active={personaFilter === persona.id}
						onclick={() => (personaFilter = persona.id)}
					>
						{persona.name}
					</button>
				{/each}
			</div>
		{/if}

		<SelectionToolbar
			total={visible.length}
			selectedCount={selectedIds.length}
			noun="post"
			deleteLabel="Delete forever"
			{busy}
			onSelectAll={selectAll}
			onClear={clearSelection}
			onDelete={() => purge(selected)}
		>
			{#snippet actions()}
				<button
					type="button"
					class="btn-restore-bulk"
					disabled={busy || selectedIds.length === 0}
					onclick={() => restore(selected)}
				>
					Restore{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
				</button>
			{/snippet}
		</SelectionToolbar>

		<div class="trash-grid">
			{#each visible as post (post.id)}
				<div class="trash-cell" class:expiring={daysLeft(post) <= 3}>
					<PostCard
						{post}
						onOpen={openMedia}
						onEnlarge={openMedia}
						selectable
						selected={selectedIds.includes(post.id)}
						onToggleSelect={toggleSelected}
					/>
					<div class="trash-cell-ident">
						{#if post.agents?.name}
							<span class="trash-who">{post.agents.name}</span>
						{/if}
						<p class="trash-caption" title={getPostDisplay(post).text}>
							{getPostDisplay(post).text || 'No caption'}
						</p>
					</div>
					<div class="trash-cell-foot">
						<span class="trash-expiry" class:urgent={daysLeft(post) <= 3}>
							{expiryLabel(post)}
						</span>
						<div class="trash-cell-actions">
							<button class="btn-restore" disabled={busy} onclick={() => restore([post])}>
								Restore
							</button>
							<button class="btn-purge" disabled={busy} onclick={() => purge([post])}>
								Delete forever
							</button>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
	</div>
</PageShell>

{#if lightbox}
	<ImageLightbox
		url={lightbox.url}
		label={lightbox.label}
		poster={lightbox.poster}
		onClose={() => (lightbox = null)}
	/>
{/if}

<style>
	.trash-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}




	.btn-empty {
		flex-shrink: 0;
		min-height: 38px;
		padding: 0 1rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--error);
		background: transparent;
		color: var(--error);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.btn-empty:hover:not(:disabled) {
		background: var(--error);
		color: #fff;
	}

	.btn-empty:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.trash-error {
		margin: 0;
		font-size: 0.78rem;
		color: var(--error-text);
		background: var(--error-soft);
		border: 1px solid var(--error);
		border-radius: var(--radius-sm);
		padding: 0.7rem 0.9rem;
	}

	.trash-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.trash-filters button {
		padding: 0.35rem 0.8rem;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-dim);
		font-size: 0.74rem;
		font-weight: 600;
		cursor: pointer;
	}

	.trash-filters button.active {
		border-color: var(--accent);
		color: var(--accent-text);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.trash-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		gap: var(--space-4);
	}

	.trash-cell {
		display: flex;
		flex-direction: column;
		min-width: 0;
		/* Trashed content reads as inactive until you hover or select it. */
		opacity: 0.72;
		transition: opacity 0.15s;
	}

	.trash-cell:hover,
	.trash-cell:focus-within {
		opacity: 1;
	}

	.trash-cell-ident {
		padding: var(--space-2) var(--space-1) 0;
	}
	.trash-who {
		display: block;
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--text-dim);
	}
	.trash-caption {
		margin: 2px 0 0;
		font-size: var(--text-base);
		line-height: var(--leading-snug);
		color: var(--text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.trash-cell-foot {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.5rem 0.15rem 0;
	}

	.trash-expiry {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--text-muted);
	}

	.trash-expiry.urgent {
		color: var(--warning);
	}

	.trash-cell-actions {
		display: flex;
		gap: 0.4rem;
	}

	.trash-cell-actions button {
		flex: 1;
		min-height: 32px;
		border-radius: var(--radius-sm);
		font-size: 0.7rem;
		font-weight: 600;
		cursor: pointer;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-dim);
		transition:
			background 0.15s,
			color 0.15s,
			border-color 0.15s;
	}

	.btn-restore:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent-text);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.btn-purge:hover:not(:disabled) {
		border-color: var(--error);
		color: var(--error);
		background: var(--error-soft);
	}

	.trash-cell-actions button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-restore-bulk {
		min-height: 34px;
		padding: 0 0.9rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--accent);
		background: transparent;
		color: var(--accent-text);
		font-size: 0.76rem;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-restore-bulk:hover:not(:disabled) {
		background: var(--accent-dark);
		color: #fff;
	}

	.trash-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding: 4rem 2rem;
		text-align: center;
		background: var(--surface);
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius);
	}

	.trash-empty .empty-icon {
		color: var(--text-muted);
	}

	.trash-empty h2 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--text);
	}

	.trash-empty p {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.6;
		color: var(--text-dim);
		max-width: 46ch;
	}

	@media (max-width: 768px) {
		.trash-grid {
			grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
			gap: var(--space-3);
		}
	}
</style>
