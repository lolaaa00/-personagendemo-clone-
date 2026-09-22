<script lang="ts">
	import { getPostDisplay } from '$lib/components/feed/postDisplay';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import PostDrawer from '$lib/components/feed/PostDrawer.svelte';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import { Posts, parseJsonResponse } from '$lib/services/api';
	import { showToast } from '$lib/stores/ui.svelte';
	import { readParam, syncParam } from '$lib/url-state';
	import PageShell from '$lib/components/ui/PageShell.svelte';

	let { data } = $props();

	// Local copies so un-hearting removes an item in place without a reload.
	let posts = $state<any[]>([...data.favoritePosts]);
	let personas = $state<any[]>([...data.favoritePersonas]);
	$effect(() => {
		posts = [...data.favoritePosts];
		personas = [...data.favoritePersonas];
	});

	let groups = $derived(data.groups ?? []);
	let configs = $derived(data.configs ?? []);

	type Tab = 'posts' | 'personas';
	let tab = $state<Tab>(readParam('tab', ['posts', 'personas'] as const, 'posts'));
	$effect(() => syncParam('tab', tab, 'posts'));

	function groupName(groupId: string | null): string | null {
		if (!groupId) return null;
		return groups.find((g: any) => g.id === groupId)?.name ?? null;
	}

	function characterRefFor(agentId: string): string | null {
		return configs.find((c: any) => c.agent_id === agentId)?.ugc_character_ref ?? null;
	}

	// ── Un-heart a post: remove from this list (it IS the favorites list) ────
	async function unfavoritePost(post: any) {
		const prev = posts;
		posts = posts.filter((p: any) => p.id !== post.id);
		if (modalPost?.id === post.id) modalPost = null;
		const res = await Posts.favorite(post.id, false);
		if (!res.success) {
			posts = prev;
			showToast(res.error || 'Could not update favorite', 'error');
		}
	}

	// ── Un-heart a persona ───────────────────────────────────────────────────
	let togglingPersonaId = $state<string | null>(null);
	async function unfavoritePersona(persona: any) {
		if (togglingPersonaId) return;
		togglingPersonaId = persona.id;
		const prev = personas;
		personas = personas.filter((p: any) => p.id !== persona.id);
		try {
			const res = await fetch(`/api/agent/${persona.id}/favorite`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: false })
			});
			const d = await parseJsonResponse<any>(res);
			if (!res.ok || !d.success) throw new Error(d.error || 'Server error');
		} catch (err) {
			personas = prev;
			showToast('Could not update favorite: ' + (err as Error).message, 'error');
		} finally {
			togglingPersonaId = null;
		}
	}

	// ── Drawer + approve (same behavior as the persona feed) ─────────────────
	let modalPost = $state<any | null>(null);
	let approving = $state(false);

	async function handleApprove(post: any) {
		if (!post?.id) return;
		approving = true;
		try {
			const res = await Posts.update(post.id, { status: 'scheduled' });
			if (res.success) {
				posts = posts.map((p: any) => (p.id === post.id ? { ...p, status: 'scheduled' } : p));
				if (modalPost?.id === post.id) modalPost = { ...modalPost, status: 'scheduled' };
				showToast('Approved — will auto-publish at its scheduled time', 'success');
			} else {
				showToast(res.error || 'Failed to approve', 'error');
			}
		} catch (err) {
			showToast('Error approving post: ' + (err as Error).message, 'error');
		} finally {
			approving = false;
		}
	}

	// ── Lightbox ─────────────────────────────────────────────────────────────
	let lightbox = $state<{
		url: string;
		label: string;
		type: 'image' | 'video';
		poster: string | null;
	} | null>(null);

	function openPostMedia(post: any) {
		const display = getPostDisplay(post);
		if (!display.mediaUrl) return;
		lightbox = {
			url: display.mediaUrl,
			label: 'Post media',
			type: display.mediaType === 'video' ? 'video' : 'image',
			poster: display.posterUrl
		};
	}
</script>

<PageShell
	title="My Favorites"
	width="wide"
	description="Everything you've hearted — best posts and go-to personas, one tap away."
>

	<div class="fav-tabs" role="tablist" aria-label="Favorite type">
		<button
			type="button"
			role="tab"
			class="fav-tab"
			class:active={tab === 'posts'}
			aria-selected={tab === 'posts'}
			onclick={() => (tab = 'posts')}
		>
			Posts
			<span class="fav-count">{posts.length}</span>
		</button>
		<button
			type="button"
			role="tab"
			class="fav-tab"
			class:active={tab === 'personas'}
			aria-selected={tab === 'personas'}
			onclick={() => (tab = 'personas')}
		>
			Personas
			<span class="fav-count">{personas.length}</span>
		</button>
	</div>

	{#if tab === 'posts'}
		{#if posts.length === 0}
			<div class="fav-empty">
				<span class="empty-icon">
					<svg
						width="40"
						height="40"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
						><path
							d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
						/></svg
					>
				</span>
				<h2>No favorite posts yet</h2>
				<p>
					Tap the heart on any post — in a persona's feed or All Generations — and it lands here.
				</p>
				<a class="fav-empty-cta" href="/generations">Browse All Generations</a>
			</div>
		{:else}
			<div class="fav-grid">
				{#each posts as post (post.id)}
					<div class="fav-cell">
						<PostCard
							{post}
							onOpen={(p) => (modalPost = p)}
							onEnlarge={openPostMedia}
							onToggleFavorite={unfavoritePost}
						/>
						<a
							class="fav-cell-persona"
							href="/personas/{post.agent_id}"
							title="Open {post.agents?.name ?? 'persona'}"
						>
							<span
								class="cell-avatar"
								style={`background: ${post.agents?.gradient ?? 'var(--gradient)'}`}
								>{post.agents?.initial ?? '?'}</span
							>
							<span class="cell-name">{post.agents?.name ?? 'Persona'}</span>
						</a>
					</div>
				{/each}
			</div>
		{/if}
	{:else if personas.length === 0}
		<div class="fav-empty">
			<span class="empty-icon">
				<svg
					width="40"
					height="40"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle
						cx="12"
						cy="7"
						r="4"
					/></svg
				>
			</span>
			<h2>No favorite personas yet</h2>
			<p>Open a persona and tap the heart next to its name to pin it here.</p>
		</div>
	{:else}
		<div class="persona-grid">
			{#each personas as persona (persona.id)}
				<div class="persona-card">
					<a class="persona-card-link" href="/personas/{persona.id}">
						<span
							class="persona-avatar"
							style={characterRefFor(persona.id)
								? ''
								: `background: ${persona.gradient ?? 'var(--gradient)'}`}
						>
							{#if characterRefFor(persona.id)}
								<img
									src={characterRefFor(persona.id)}
									alt=""
									width="56"
									height="56"
									loading="lazy"
								/>
							{:else}
								{persona.initial ?? (persona.name?.[0] ?? '?').toUpperCase()}
							{/if}
						</span>
						<span class="persona-card-body">
							<span class="persona-card-name">
								{persona.name}
								<span
									class="persona-status-dot"
									class:status-active={persona.status === 'active'}
									class:status-paused={persona.status === 'paused'}
								></span>
								{#if persona.status === 'active' || persona.status === 'paused'}
									<span class="sr-only">({persona.status})</span>
								{/if}
							</span>
							<span class="persona-card-handle">{persona.handle}</span>
							<span class="persona-card-meta">
								{persona.niche}
								{#if groupName(persona.group_id)}
									<span class="persona-group-chip">
										<svg
											width="10"
											height="10"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
											aria-hidden="true"
											><path
												d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
											/></svg
										>
										{groupName(persona.group_id)}
									</span>
								{/if}
							</span>
						</span>
					</a>
					<button
						type="button"
						class="persona-unfav"
						title="Remove from favorites"
						aria-label="Remove {persona.name} from favorites"
						disabled={togglingPersonaId === persona.id}
						onclick={() => unfavoritePersona(persona)}
					>
						<svg
							width="15"
							height="15"
							viewBox="0 0 24 24"
							fill="currentColor"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><path
								d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
							/></svg
						>
					</button>
				</div>
			{/each}
		</div>
	{/if}
</PageShell>

{#if modalPost}
	<PostDrawer
		post={modalPost}
		characterRef={characterRefFor(modalPost.agent_id)}
		onClose={() => (modalPost = null)}
		onApprove={handleApprove}
		{approving}
	/>
{/if}

{#if lightbox}
	<ImageLightbox
		url={lightbox.url}
		label={lightbox.label}
		type={lightbox.type}
		poster={lightbox.poster}
		onClose={() => (lightbox = null)}
	/>
{/if}

<style>



	/* ── Tabs ── */
	.fav-tabs {
		display: inline-flex;
		gap: 4px;
		padding: 4px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		margin-bottom: var(--space-5);
	}

	.fav-tab {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 16px;
		min-height: 44px;
		border: none;
		border-radius: 9px;
		background: transparent;
		color: var(--text-muted);
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.fav-tab:hover {
		color: var(--text);
		background: color-mix(in srgb, var(--text) 5%, transparent);
	}

	.fav-tab.active {
		background: var(--accent-soft);
		color: var(--accent-text);
	}

	.fav-count {
		font-size: 0.68rem;
		font-weight: 700;
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}

	.fav-tab.active .fav-count {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		border-color: color-mix(in srgb, var(--accent) 30%, transparent);
		color: var(--accent-text);
	}

	/* ── Posts grid ── */
	.fav-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		gap: var(--space-4);
	}

	.fav-cell {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.fav-cell :global(.post-tile) {
		margin-bottom: 0.45rem;
	}

	.fav-cell-persona {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		min-height: 32px;
		padding: 2px 4px;
		border-radius: 7px;
		color: var(--text-muted);
		font-size: 0.76rem;
		font-weight: 600;
		text-decoration: none;
		max-width: 100%;
	}

	.fav-cell-persona:hover {
		color: var(--text);
		background: color-mix(in srgb, var(--text) 5%, transparent);
	}

	.cell-avatar {
		width: 20px;
		height: 20px;
		border-radius: 6px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.58rem;
		font-weight: 800;
		color: #fff;
		flex-shrink: 0;
	}

	.cell-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ── Personas grid ── */
	.persona-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-4);
	}

	.persona-card {
		position: relative;
		display: flex;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		transition:
			border-color 0.15s ease,
			transform 0.15s ease,
			box-shadow 0.15s ease;
	}

	.persona-card:hover {
		border-color: var(--accent-mid);
		transform: translateY(-2px);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
	}

	.persona-card-link {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: var(--space-4);
		/* keep the unfavorite heart clear of the text */
		padding-right: 52px;
		text-decoration: none;
		color: inherit;
		min-width: 0;
	}

	.persona-avatar {
		width: 56px;
		height: 56px;
		border-radius: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.1rem;
		font-weight: 800;
		color: #fff;
		flex-shrink: 0;
		overflow: hidden;
	}

	.persona-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.persona-card-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.persona-card-name {
		font-weight: 700;
		font-size: 0.95rem;
		color: var(--text);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.persona-status-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--text-dim);
		flex-shrink: 0;
	}

	.persona-status-dot.status-active {
		background: var(--success);
		box-shadow: 0 0 4px color-mix(in srgb, var(--success) 60%, transparent);
	}

	.persona-status-dot.status-paused {
		background: var(--warning);
	}

	.persona-card-handle {
		font-size: 0.76rem;
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.persona-card-meta {
		font-size: 0.74rem;
		color: var(--text-muted);
		display: inline-flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.persona-group-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.66rem;
		font-weight: 700;
		padding: 1px 8px;
		border-radius: 999px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-dim);
	}

	.persona-unfav {
		position: absolute;
		top: 10px;
		right: 10px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--rose, #e84393);
		cursor: pointer;
		transition:
			transform 0.15s ease,
			border-color 0.15s ease;
	}

	/* 44px tap area without growing the 32px chip. */
	.persona-unfav::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		min-width: 44px;
		min-height: 44px;
	}

	.persona-unfav:hover {
		transform: scale(1.08);
		border-color: color-mix(in srgb, var(--rose, #e84393) 50%, transparent);
	}

	.persona-unfav:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* ── Empty states ── */
	.fav-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.5rem;
		padding: var(--space-8) var(--space-4);
		border: 1px dashed var(--border);
		border-radius: var(--radius-md);
		color: var(--text-muted);
	}

	.fav-empty .empty-icon {
		color: var(--text-dim);
		opacity: 0.7;
	}

	.fav-empty h2 {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text);
		margin: 0;
	}

	.fav-empty p {
		font-size: 0.83rem;
		margin: 0;
		max-width: 46ch;
	}

	.fav-empty-cta {
		margin-top: 0.5rem;
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 8px 18px;
		border-radius: 9px;
		background: var(--accent-soft);
		color: var(--accent-text);
		font-size: 0.83rem;
		font-weight: 700;
		text-decoration: none;
		transition: background 0.15s ease;
	}

	.fav-empty-cta:hover {
		background: color-mix(in srgb, var(--accent) 20%, transparent);
	}

	@media (max-width: 768px) {
		.fav-grid {
			grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
			gap: var(--space-3);
		}

		.persona-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
