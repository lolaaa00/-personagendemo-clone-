<script lang="ts">
	import { getPostDisplay } from '$lib/components/feed/postDisplay';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import PostDrawer from '$lib/components/feed/PostDrawer.svelte';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import { Posts } from '$lib/services/api';
	import { showToast } from '$lib/stores/ui.svelte';
	import { readParam, syncParam } from '$lib/url-state';

	let { data } = $props();

	// Server data is the source of truth; local copy exists so hearts and
	// approvals update in place without a full reload.
	let posts = $state<any[]>([...data.posts]);
	$effect(() => {
		posts = [...data.posts];
	});

	let personas = $derived(data.personas ?? []);
	let kits = $derived(data.kits ?? []);

	// ── View state (all deep-linkable) ───────────────────────────────────────
	type Lens = 'content' | 'profile';
	let lens = $state<Lens>(readParam('lens', ['content', 'profile'] as const, 'content'));
	$effect(() => syncParam('lens', lens, 'content'));

	// Format filter speaks the Studio-shelf vocabulary (Text / Photo / Video /
	// Cinematic) so the library slices exactly the way content is made. The old
	// image/video split couldn't tell a quote card from a lifestyle photo.
	let formatFilter = $state<'all' | 'typographic' | 'photo' | 'video' | 'cinematic'>(
		readParam('format', ['all', 'typographic', 'photo', 'video', 'cinematic'] as const, 'all')
	);
	$effect(() => syncParam('format', formatFilter, 'all'));

	let favOnly = $state(readParam('fav', ['1', '0'] as const, '0') === '1');
	$effect(() => syncParam('fav', favOnly ? '1' : '0', '0'));

	// Shareability is the platform's north-star metric — surface a shares-first
	// ordering right where the whole library is browsed.
	let orderBy = $state<'newest' | 'shared'>(
		readParam('order', ['newest', 'shared'] as const, 'newest')
	);
	$effect(() => syncParam('order', orderBy, 'newest'));

	// Persona filter holds dynamic ids, so it can't go through readParam's allowlist.
	let personaFilter = $state(
		typeof window !== 'undefined'
			? (new URL(window.location.href).searchParams.get('persona') ?? 'all')
			: 'all'
	);
	$effect(() => syncParam('persona', personaFilter, 'all'));

	// ── Content lens: actual generation outputs (posts) ──────────────────────
	let contentPosts = $derived.by(() => {
		const filtered = posts.filter((p: any) => {
			// In-flight / failed rows are shown (same rule as the persona feed) so a
			// generation kicked off elsewhere is visible here immediately.
			const inFlight = p.status === 'generating' || p.status === 'failed';
			const display = getPostDisplay(p);
			if (!inFlight && !display.mediaUrl) return false;
			if (personaFilter !== 'all' && p.agent_id !== personaFilter) return false;
			// Surface-only check: in-flight/failed rows carry their template's surface
			// (provenance survives failure), so a failed Quote Card slot is FINDABLE
			// under Text — requiring media here made failed slots vanish from every
			// format view exactly when someone is hunting for what's missing.
			if (formatFilter !== 'all' && display.surface !== formatFilter) return false;
			if (favOnly && !p.is_favorite) return false;
			return true;
		});
		if (orderBy === 'shared') {
			// Most-shared first; ties (and never-published drafts, shares 0) keep
			// the server's newest-first order beneath the winners.
			return [...filtered].sort(
				(a: any, b: any) => (b.analytics?.shares ?? 0) - (a.analytics?.shares ?? 0)
			);
		}
		return filtered;
	});

	// ── Profile lens: persona-building assets (avatar + identity kit) ────────
	const KIT_LABELS: Record<string, string> = {
		full_body: 'Full body',
		side_profiles: 'Side-profile composite',
		face_closeup: 'Facial close-up',
		feature_grid: 'Feature grid'
	};

	interface ProfileAsset {
		url: string;
		label: string;
	}
	interface ProfileSection {
		persona: any;
		assets: ProfileAsset[];
	}

	let profileSections = $derived.by<ProfileSection[]>(() => {
		const sections: ProfileSection[] = [];
		for (const persona of personas) {
			if (personaFilter !== 'all' && persona.id !== personaFilter) continue;
			const kit = kits.find((k: any) => k.agent_id === persona.id);
			const assets: ProfileAsset[] = [];
			const seen = new Set<string>();
			const add = (url: unknown, label: string) => {
				if (typeof url !== 'string' || !/^https?:\/\//.test(url) || seen.has(url)) return;
				seen.add(url);
				assets.push({ url, label });
			};
			add(kit?.ugc_character_ref, 'Profile picture');
			for (const [k, v] of Object.entries(kit?.ugc_reference_kit ?? {})) {
				// The kit doubles as an async-job board — skip its bookkeeping keys.
				if (
					k === 'rev' ||
					k.endsWith('_status') ||
					k.endsWith('_history') ||
					k.endsWith('_started_at')
				)
					continue;
				add(v, KIT_LABELS[k] ?? k.replace(/_/g, ' '));
			}
			if (assets.length > 0) sections.push({ persona, assets });
		}
		return sections;
	});

	let profileAssetCount = $derived(profileSections.reduce((n, s) => n + s.assets.length, 0));

	// ── Favorite toggle (optimistic, reverts on failure) ─────────────────────
	async function toggleFavorite(post: any) {
		const next = !post.is_favorite;
		posts = posts.map((p: any) => (p.id === post.id ? { ...p, is_favorite: next } : p));
		if (modalPost?.id === post.id) modalPost = { ...modalPost, is_favorite: next };
		const res = await Posts.favorite(post.id, next);
		if (!res.success) {
			posts = posts.map((p: any) => (p.id === post.id ? { ...p, is_favorite: !next } : p));
			if (modalPost?.id === post.id) modalPost = { ...modalPost, is_favorite: !next };
			showToast(res.error || 'Could not update favorite', 'error');
		}
	}

	// ── Drawer + approve (same behavior as the persona feed) ─────────────────
	let modalPost = $state<any | null>(null);
	let approving = $state(false);

	let modalCharacterRef = $derived.by(() => {
		if (!modalPost) return null;
		const kit = kits.find((k: any) => k.agent_id === modalPost.agent_id);
		return kit?.ugc_character_ref ?? null;
	});

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

	function personaName(id: string): string {
		return personas.find((p: any) => p.id === id)?.name ?? 'persona';
	}
</script>

<svelte:head>
	<title>All Generations · PersonaGen</title>
</svelte:head>

<div class="gen-page">
	<header class="gen-header">
		<div>
			<h1>All Generations</h1>
			<p class="gen-sub">
				Every output your personas have created — content on one side, the assets that build each
				persona's identity on the other.
			</p>
		</div>
	</header>

	<!-- Lens: the load-bearing distinction. Content outputs get published;
	     profile assets only shape the persona. -->
	<div class="gen-lens" role="tablist" aria-label="Generation type">
		<button
			type="button"
			role="tab"
			class="lens-btn"
			class:active={lens === 'content'}
			aria-selected={lens === 'content'}
			onclick={() => (lens = 'content')}
		>
			<svg
				width="15"
				height="15"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path
					d="M21 15l-5-5L5 21"
				/></svg
			>
			Content outputs
			<span class="lens-count">{contentPosts.length}</span>
		</button>
		<button
			type="button"
			role="tab"
			class="lens-btn"
			class:active={lens === 'profile'}
			aria-selected={lens === 'profile'}
			onclick={() => (lens = 'profile')}
		>
			<svg
				width="15"
				height="15"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg
			>
			Profile assets
			<span class="lens-count">{profileAssetCount}</span>
		</button>
	</div>

	<div class="gen-toolbar">
		<label class="toolbar-field">
			<span class="toolbar-label">Persona</span>
			<select bind:value={personaFilter} class="toolbar-select" aria-label="Filter by persona">
				<option value="all">All personas</option>
				{#each personas as persona (persona.id)}
					<option value={persona.id}>{persona.name}</option>
				{/each}
			</select>
		</label>

		{#if lens === 'content'}
			<div class="toolbar-seg" role="group" aria-label="Format">
				{#each [['all', 'All'], ['typographic', 'Text'], ['photo', 'Photo'], ['video', 'Video'], ['cinematic', 'Cinematic']] as [value, label] (value)}
					<button
						type="button"
						class="seg-btn"
						class:active={formatFilter === value}
						aria-pressed={formatFilter === value}
						onclick={() => (formatFilter = value as typeof formatFilter)}
					>
						{label}
					</button>
				{/each}
			</div>

			<button
				type="button"
				class="toolbar-fav"
				class:active={favOnly}
				aria-pressed={favOnly}
				onclick={() => (favOnly = !favOnly)}
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill={favOnly ? 'currentColor' : 'none'}
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><path
						d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
					/></svg
				>
				Favorites only
			</button>

			<div class="toolbar-seg" role="group" aria-label="Order">
				<button
					type="button"
					class="seg-btn"
					class:active={orderBy === 'newest'}
					aria-pressed={orderBy === 'newest'}
					onclick={() => (orderBy = 'newest')}
				>
					Newest
				</button>
				<button
					type="button"
					class="seg-btn"
					class:active={orderBy === 'shared'}
					aria-pressed={orderBy === 'shared'}
					title="Shareability is the metric that matters — most-forwarded posts first"
					onclick={() => (orderBy = 'shared')}
				>
					<svg
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
						><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle
							cx="18"
							cy="19"
							r="3"
						/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line
							x1="15.41"
							y1="6.51"
							x2="8.59"
							y2="10.49"
						/></svg
					>
					Most shared
				</button>
			</div>
		{/if}
	</div>

	{#if lens === 'content'}
		{#if contentPosts.length === 0}
			<div class="gen-empty">
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
						><rect x="3" y="3" width="18" height="18" rx="2" /><circle
							cx="8.5"
							cy="8.5"
							r="1.5"
						/><path d="M21 15l-5-5L5 21" /></svg
					>
				</span>
				<h2>No generations here yet</h2>
				<p>
					{#if favOnly}
						Nothing hearted matches these filters — tap the heart on any tile to collect it.
					{:else if personaFilter !== 'all' || formatFilter !== 'all'}
						No generated content matches these filters.
					{:else}
						Content generated by any persona collects here. Open a persona and hit Generate to
						create the first post.
					{/if}
				</p>
			</div>
		{:else}
			<div class="gen-grid">
				{#each contentPosts as post (post.id)}
					<div class="gen-cell">
						<PostCard
							{post}
							onOpen={(p) => (modalPost = p)}
							onEnlarge={openPostMedia}
							onToggleFavorite={toggleFavorite}
						/>
						<a
							class="gen-cell-persona"
							href="/personas/{post.agent_id}"
							title="Open {post.agents?.name ?? personaName(post.agent_id)}"
						>
							<span
								class="cell-avatar"
								style={`background: ${post.agents?.gradient ?? 'var(--gradient)'}`}
								>{post.agents?.initial ?? '?'}</span
							>
							<span class="cell-name">{post.agents?.name ?? personaName(post.agent_id)}</span>
						</a>
					</div>
				{/each}
			</div>
		{/if}
	{:else if profileSections.length === 0}
		<div class="gen-empty">
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
			<h2>No profile assets yet</h2>
			<p>
				Profile pictures and identity-kit references generated for each persona collect here,
				separate from published content. Open a persona's Profile tab to generate them.
			</p>
		</div>
	{:else}
		{#each profileSections as section (section.persona.id)}
			<section class="profile-section">
				<a class="profile-section-head" href="/personas/{section.persona.id}">
					<span
						class="cell-avatar lg"
						style={`background: ${section.persona.gradient ?? 'var(--gradient)'}`}
						>{section.persona.initial ?? section.persona.name?.[0] ?? '?'}</span
					>
					<span class="profile-section-name">{section.persona.name}</span>
					<span class="profile-section-handle">{section.persona.handle}</span>
					<span class="profile-section-count"
						>{section.assets.length} asset{section.assets.length !== 1 ? 's' : ''}</span
					>
				</a>
				<div class="profile-grid">
					{#each section.assets as asset (asset.url)}
						<button
							type="button"
							class="profile-tile"
							onclick={() =>
								(lightbox = {
									url: asset.url,
									label: `${section.persona.name} — ${asset.label}`,
									type: 'image',
									poster: null
								})}
							aria-label="View {asset.label} for {section.persona.name}"
						>
							<img src={asset.url} loading="lazy" width="400" height="400" alt="" />
							<span class="profile-tile-label">{asset.label}</span>
						</button>
					{/each}
				</div>
			</section>
		{/each}
	{/if}
</div>

{#if modalPost}
	<PostDrawer
		post={modalPost}
		characterRef={modalCharacterRef}
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
	.gen-page {
		max-width: 1280px;
		margin: 0 auto;
	}

	.gen-header h1 {
		font-family: var(--font-display);
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0 0 0.25rem;
	}

	.gen-sub {
		color: var(--text-muted);
		font-size: 0.85rem;
		margin: 0 0 var(--space-5);
		max-width: 60ch;
	}

	/* ── Lens tabs ── */
	.gen-lens {
		display: inline-flex;
		gap: 4px;
		padding: 4px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		margin-bottom: var(--space-4);
	}

	.lens-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		min-height: 44px;
		border: none;
		border-radius: 9px;
		background: transparent;
		color: var(--text-muted);
		font-family: inherit;
		font-size: 0.83rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.lens-btn:hover {
		color: var(--text);
		background: color-mix(in srgb, var(--text) 5%, transparent);
	}

	.lens-btn.active {
		background: var(--accent-soft);
		color: var(--accent);
	}

	.lens-count {
		font-size: 0.68rem;
		font-weight: 700;
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}

	.lens-btn.active .lens-count {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
		border-color: color-mix(in srgb, var(--accent) 30%, transparent);
		color: var(--accent);
	}

	/* ── Toolbar ── */
	.gen-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-5);
	}

	.toolbar-field {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.toolbar-label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}

	.toolbar-select {
		padding: 8px 10px;
		min-height: 44px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font-family: inherit;
		font-size: 0.83rem;
		cursor: pointer;
	}

	.toolbar-select:focus-visible {
		outline: none;
		border-color: var(--accent-mid);
	}

	.toolbar-seg {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 9px;
		overflow: hidden;
		background: var(--surface);
	}

	.seg-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 8px 12px;
		min-height: 44px;
		border: none;
		background: transparent;
		color: var(--text-muted);
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.seg-btn + .seg-btn {
		border-left: 1px solid var(--border);
	}

	.seg-btn:hover {
		color: var(--text);
	}

	.seg-btn.active {
		background: var(--accent-soft);
		color: var(--accent);
	}

	.toolbar-fav {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		min-height: 44px;
		border-radius: 9px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text-muted);
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			color 0.15s ease,
			border-color 0.15s ease;
	}

	.toolbar-fav:hover {
		color: var(--text);
		border-color: var(--border-hover);
	}

	.toolbar-fav.active {
		color: var(--rose, #e84393);
		border-color: color-mix(in srgb, var(--rose, #e84393) 45%, transparent);
		background: color-mix(in srgb, var(--rose, #e84393) 8%, transparent);
	}

	/* ── Content grid ── */
	.gen-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		gap: var(--space-4);
	}

	.gen-cell {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	/* PostCard carries margin-bottom for masonry contexts — collapse it here. */
	.gen-cell :global(.post-tile) {
		margin-bottom: 0.45rem;
	}

	.gen-cell-persona {
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

	.gen-cell-persona:hover {
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

	.cell-avatar.lg {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		font-size: 0.68rem;
	}

	.cell-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ── Profile lens ── */
	.profile-section {
		margin-bottom: var(--space-6);
	}

	.profile-section-head {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		padding: 4px 8px 4px 4px;
		margin-bottom: var(--space-3);
		border-radius: 9px;
		text-decoration: none;
		color: var(--text);
	}

	.profile-section-head:hover {
		background: color-mix(in srgb, var(--text) 5%, transparent);
	}

	.profile-section-name {
		font-weight: 700;
		font-size: 0.95rem;
	}

	.profile-section-handle {
		color: var(--text-dim);
		font-size: 0.78rem;
	}

	.profile-section-count {
		font-size: 0.68rem;
		font-weight: 700;
		padding: 1px 8px;
		border-radius: 999px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-dim);
	}

	.profile-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: var(--space-3);
	}

	.profile-tile {
		position: relative;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--surface);
		cursor: zoom-in;
		transition:
			border-color 0.15s ease,
			transform 0.15s ease;
	}

	.profile-tile:hover {
		border-color: var(--accent-mid);
		transform: translateY(-2px);
	}

	.profile-tile:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--accent-mid);
	}

	.profile-tile img {
		width: 100%;
		height: auto;
		aspect-ratio: 1 / 1;
		object-fit: cover;
		display: block;
	}

	.profile-tile-label {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		padding: 1.1rem 0.5rem 0.4rem;
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.72));
		color: #fff;
		font-size: 0.68rem;
		font-weight: 600;
		text-align: left;
		pointer-events: none;
	}

	/* ── Empty state ── */
	.gen-empty {
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

	.gen-empty .empty-icon {
		color: var(--text-dim);
		opacity: 0.7;
	}

	.gen-empty h2 {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text);
		margin: 0;
	}

	.gen-empty p {
		font-size: 0.83rem;
		margin: 0;
		max-width: 46ch;
	}

	@media (max-width: 768px) {
		.gen-grid {
			grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
			gap: var(--space-3);
		}

		.profile-grid {
			grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		}
	}
</style>
