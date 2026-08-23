<script lang="ts">
	import { thumbUrl, restoreOriginal } from '$lib/image-url';
	import { fly, fade } from 'svelte/transition';
	import { getPostDisplay, truncateError, summarizeGenError } from './postDisplay';
	import { platformColor } from '$lib/platforms';
	import { OPERATION_LABELS, priceOf } from '$lib/pricing';
	import { resolveModel } from '$lib/models';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import { dialog } from '$lib/actions/dialog';

	/** Full-screen zoom of the post image (video already has native fullscreen). */
	let zoomOpen = $state(false);

	let {
		post,
		onClose,
		onDelete = undefined,
		onApprove,
		onSaveText = undefined,
		onReschedule = undefined,
		onPublishFallback = undefined,
		onPostNow = undefined,
		onReject = undefined,
		onRefined = undefined,
		characterRef = null,
		approving = false,
		deleting = false,
		posting = false
	}: {
		post: any | null;
		onClose: () => void;
		/** When provided, the footer gets a Delete button (permanent removal + live teardown). */
		onDelete?: (post: any) => void;
		onApprove: (post: any) => void;
		/** Review-queue flow: reject a draft / unschedule a scheduled post (with a
		 *  reason, logged to post_reviews). Shown instead of Delete in review contexts. */
		onReject?: ((post: any) => void) | null;
		/** The persona's current pinned face — shown as the character reference when
		 *  a post predates full provenance capture. */
		characterRef?: string | null;
		/** When provided, the caption becomes editable (returns false to keep editing open). */
		onSaveText?: (post: any, newText: string) => Promise<boolean> | boolean;
		/** When provided, draft/scheduled posts get a date/time edit control (returns false to keep the values dirty). */
		onReschedule?: (post: any, date: string, time: string) => Promise<boolean> | boolean;
		/** When provided, a failed/unpublished post can be (re)published to a connected platform. */
		onPublishFallback?: ((post: any) => void) | null;
		/** When provided, a draft/scheduled post gets a "Post Now" button that publishes
		 *  immediately, overriding the schedule. */
		onPostNow?: ((post: any) => void) | null;
		/** Called with the fresh post row after a successful in-drawer refine
		 *  (media regenerated from an edited prompt) so the host can refresh its list. */
		onRefined?: ((post: any) => void) | null;
		approving?: boolean;
		deleting?: boolean;
		posting?: boolean;
	} = $props();

	// ── Caption editing (available at any status — drafts through published) ──
	let editingText = $state(false);
	let draftText = $state('');
	let savingText = $state(false);
	// Generation details start collapsed so the media stays in view; the user
	// expands them on demand. Reset per post (the drawer DOM persists across posts).
	let genDetailsOpen = $state(false);
	// Set when the <video> fires `error` (codec/content-type/network) so the drawer
	// shows a tap-through fallback instead of a silent black box.
	let videoError = $state(false);
	let bodyEl = $state<HTMLDivElement | null>(null);
	$effect(() => {
		// Reset edit mode whenever a different post opens.
		void post?.id;
		editingText = false;
		savingText = false;
		schedDate = post?.scheduled_date ?? '';
		schedTime = (post?.scheduled_time ?? '10:00:00').slice(0, 5);
		savingSchedule = false;
		confirmingDelete = false;
		confirmingPostNow = false;
		genDetailsOpen = false;
		videoError = false;
		livePost = null;
		refineOpen = false;
		refineError = null;
		refining = false;
		confirmingRefine = false;
		bodyEl?.scrollTo({ top: 0 });
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

	// After an in-drawer refine the fresh row lives here — the `post` prop stays
	// whatever the host passed, so the drawer overlays its own newer copy.
	let livePost = $state<any | null>(null);
	let activePost = $derived(livePost ?? post);
	let display = $derived(activePost ? getPostDisplay(activePost) : null);

	// ── Refine: edit the visual prompt / spoken line, regenerate ONLY the media ──
	// The caption, schedule, pinned face, product reference and voice are kept;
	// the server re-rolls still + video from the edited prompt. Paid — so the
	// regenerate button two-click confirms with the estimated spend.
	let refineOpen = $state(false);
	let refineScene = $state('');
	let refineDialogue = $state('');
	let refining = $state(false);
	let refineError = $state<string | null>(null);
	let confirmingRefine = $state(false);
	let refineConfirmTimeout: ReturnType<typeof setTimeout> | undefined;
	// Cinematic posts are multi-shot reference videos — the single-shot refine
	// pipeline would silently downgrade them, so the server rejects them and the
	// button is not offered (regenerate those from the composer instead). Read
	// from the shared classifier so every surface answers this identically.
	let isCinematic = $derived(display?.cinematic === true);
	let canRefine = $derived(
		Boolean(
			activePost?.agent_id &&
				(activePost.status === 'draft' || activePost.status === 'scheduled') &&
				display?.mediaGenerated &&
				display?.mediaUrl &&
				!isCinematic
		)
	);
	// A refine that failed server-side restores the original media and records
	// why in content.refine_error — surface it even after a reload.
	let storedRefineError = $derived.by(() => {
		try {
			const err = JSON.parse(activePost?.content ?? '')?.refine_error;
			return typeof err === 'string' && err ? truncateError(err) : null;
		} catch {
			return null;
		}
	});
	// Estimated cost of the re-roll — mirrors the refine pipeline EXACTLY: the
	// server re-rolls b-roll with resolveModel(selections.videoModel), so the
	// number the user consents to must be that model's tier (Wan $0.10 → Veo
	// $1.50), never a hardcoded Standard rate that can be 3x off.
	let refineEstimate = $derived.by(() => {
		if (!display) return 0;
		const img = priceOf('fal', 'image', 'nano');
		if (display.mediaType !== 'video') return img;
		if (display.format === 'broll') {
			const clip = resolveModel('video_i2v', display.generation?.selections?.videoModel);
			return img + clip.usd;
		}
		return img + priceOf('fal', 'tts') + priceOf('fal', 'talking_head');
	});

	function openRefine() {
		refineScene = display?.ugcPrompt ?? display?.generation?.prompts?.scene ?? '';
		refineDialogue = display?.script ?? '';
		refineError = null;
		refineOpen = true;
	}

	function handleRefineClick() {
		if (refining || !refineScene.trim()) return;
		if (confirmingRefine) {
			clearTimeout(refineConfirmTimeout);
			confirmingRefine = false;
			void startRefine();
		} else {
			confirmingRefine = true;
			refineConfirmTimeout = setTimeout(() => {
				confirmingRefine = false;
			}, 4000);
		}
	}

	async function startRefine() {
		const target = activePost;
		if (!target?.id || !target.agent_id || refining) return;
		const targetId = target.id;
		refining = true;
		refineError = null;
		try {
			const res = await fetch(`/api/agent/${target.agent_id}/refine-post`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					post_id: targetId,
					scene: refineScene.trim(),
					dialogue: refineDialogue.trim()
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok || !data.success) {
				throw new Error(data.error || `Refine failed (${res.status})`);
			}

			let updated: any = data.post ?? null;
			if (!updated) {
				// 202 — detached job. Poll the row until it leaves 'generating'.
				const deadline = Date.now() + 10 * 60 * 1000;
				while (Date.now() < deadline) {
					await new Promise((r) => setTimeout(r, 5000));
					// Drawer moved to another post (or closed) — the job finishes
					// server-side either way; just stop watching it here.
					if (post?.id !== targetId && post !== null) return;
					const poll = await fetch('/api/posts', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ action: 'get', id: targetId })
					}).catch(() => null);
					const pd = poll ? await poll.json().catch(() => null) : null;
					const row = pd?.success ? pd.data : null;
					if (row && row.status !== 'generating') {
						updated = row;
						break;
					}
				}
				if (!updated) {
					throw new Error('Still regenerating after 10 minutes — it may finish in the background; check the feed shortly.');
				}
			}

			let failMsg: string | null = null;
			try {
				failMsg = JSON.parse(updated.content)?.refine_error ?? null;
			} catch {
				/* non-JSON content — treat as success */
			}
			if (post?.id === targetId || post === null) {
				livePost = updated;
				if (failMsg) {
					refineError = failMsg;
				} else {
					refineOpen = false;
				}
			}
			if (!failMsg) onRefined?.(updated);
		} catch (e) {
			if (post?.id === targetId) refineError = (e as Error).message;
		} finally {
			if (post?.id === targetId) refining = false;
		}
	}

	// ── Observability ──────────────────────────────────────────────────────
	// New posts carry a full `content.generation` record. Older posts predate it,
	// so we ALSO fetch the ACTUAL models/costs from the generation ledger and the
	// real product reference from the brief — factual values, never guessed. The
	// current pinned face is deliberately NOT shown as a "reference used" because
	// it may not be what actually ran.
	let gen = $derived(display?.generation ?? null);
	let obs = $state<{
		aspects: Record<string, { models: string[]; usd: number }>;
		total: number;
		productPhoto: string | null;
		matchMode: string;
	} | null>(null);
	$effect(() => {
		const id = post?.id;
		const agentId = post?.agent_id;
		obs = null;
		// New posts already have the full record; only fetch for the rest.
		if (!id || !agentId || display?.generation) return;
		fetch(`/api/agent/${agentId}/post-observability?postId=${encodeURIComponent(id)}`)
			.then((r) => r.json())
			.then((d) => {
				if (d?.success)
					obs = {
						aspects: d.aspects ?? {},
						total: Number(d.total ?? 0),
						productPhoto: d.productPhoto ?? null,
						matchMode: d.matchMode ?? 'none'
					};
			})
			.catch(() => {});
	});

	// Per-aspect model + cost — from the stored record (new) or the ledger (older).
	let genAspects = $derived.by(() => {
		const a = gen?.aspects ?? obs?.aspects;
		if (!a || typeof a !== 'object') return [] as { op: string; models: string[]; usd: number }[];
		return Object.entries(a).map(([op, v]: [string, any]) => ({
			op,
			models: Array.isArray(v?.models) ? v.models : [],
			usd: Number(v?.usd ?? 0)
		}));
	});
	// Total for the aspect table: the recorded total, else the sum of the rows
	// actually shown — never $0.000 under visibly non-zero rows.
	let aspectsTotal = $derived.by(() => {
		const recorded = Number(gen?.total ?? obs?.total ?? 0);
		if (recorded > 0) return recorded;
		return genAspects.reduce((s, a) => s + a.usd, 0);
	});
	// Input images: the recorded ones (new posts) or the real product reference
	// from the brief (older posts). No hallucinated character pin.
	let genImages = $derived.by(() => {
		const im = gen?.images ?? {};
		const list: { label: string; url: string }[] = [];
		if (im.character_ref) list.push({ label: 'Character', url: im.character_ref });
		if (im.product_photo) list.push({ label: 'Product', url: im.product_photo });
		for (const u of im.reference_kit ?? []) if (u) list.push({ label: 'Reference', url: u });
		if (!list.length && obs?.productPhoto)
			list.push({ label: 'Product reference', url: obs.productPhoto });
		return list;
	});
	let genSelections = $derived(gen?.selections ?? null);
	// Cost by provider — the stored breakdown, shown only when no per-aspect data.
	let costByProvider = $derived.by(() => {
		const bp = display?.costBreakdown?.byProvider;
		if (!bp || typeof bp !== 'object') return [] as { provider: string; usd: number }[];
		return Object.entries(bp).map(([provider, usd]: [string, any]) => ({
			provider,
			usd: Number(usd ?? 0)
		}));
	});
	let costTotal = $derived(
		Number(gen?.total ?? obs?.total ?? display?.costBreakdown?.total ?? 0)
	);
	// Human statement of WHAT this output is — derived from outcome truth
	// (media_type / cinematic / surface), never from the raw request field:
	// content.format says 'broll' on typographic cards and cinematic packs,
	// where no b-roll pipeline was involved at all.
	let formatLine = $derived.by(() => {
		if (!display) return '';
		const parts: string[] = [];
		if (display.cinematic) parts.push('cinematic (multi-shot)', 'video');
		else if (display.mediaType === 'video')
			parts.push(
				display.format === 'spokesperson' ? 'spokesperson (talking head)' : 'b-roll clip',
				'video'
			);
		else parts.push(display.surface === 'typographic' ? 'typographic card' : 'photo still', 'image');
		if (display.mediaGenerated) parts.push('generated');
		return parts.join(' · ');
	});
	// The composition contract the run obeyed — why a reference is (or isn't) there.
	let compositionLine = $derived.by(() => {
		const g = gen;
		if (!g || (!g.refs_policy && !g.still_style)) return null;
		if (g.still_style === 'graphic')
			return `Typographic card — the text is the artwork; no reference images were sent.${g.card_text ? ` Card line: “${g.card_text}”` : ''}`;
		const rp = g.refs_policy;
		if (rp && !rp.character && !rp.product)
			return 'No reference images by design — the scene was generated purely from the prompt.';
		if (rp && !rp.character)
			return 'Product reference only — the persona does not appear in this composition.';
		if (rp && !rp.product)
			return 'Face reference only — no product photo attached (product-free channel content).';
		return null;
	});
	// A failed post that still has media only failed to PUBLISH — it can be re-sent.
	let canRepublish = $derived(
		Boolean(onPublishFallback && post && post.status === 'failed' && display?.mediaUrl)
	);
	// Draft/scheduled posts can be published immediately, overriding the schedule.
	let canPostNow = $derived(
		Boolean(onPostNow && post && (post.status === 'draft' || post.status === 'scheduled'))
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

	// Both call sites use this as a `color:` on small badge/pill text, so it must return
	// the AA `-text` variants — the raw brand hues measure 2.77-4.08:1 on a light
	// surface. The tokens fall back to the vivid hues in dark mode, where those pass.
	function statusColor(status: string): string {
		if (status === 'published') return 'var(--success-text)';
		if (status === 'failed') return 'var(--error-text)';
		if (status === 'publishing') return 'var(--cyan-text)';
		if (status === 'partial') return 'var(--warning-text)';
		if (status === 'rejected') return 'var(--rose-text)';
		if (status === 'scheduled') return 'var(--accent-text)';
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
			onDelete?.(post);
		} else {
			confirmingDelete = true;
			confirmTimeout = setTimeout(() => {
				confirmingDelete = false;
			}, 3000);
		}
	}

	// ── Post-Now two-click confirm (publishing live is irreversible) ──────
	let confirmingPostNow = $state(false);
	let postNowTimeout: ReturnType<typeof setTimeout> | undefined;
	function handlePostNowClick() {
		if (!post || posting) return;
		if (confirmingPostNow) {
			clearTimeout(postNowTimeout);
			confirmingPostNow = false;
			onPostNow?.(post);
		} else {
			confirmingPostNow = true;
			postNowTimeout = setTimeout(() => {
				confirmingPostNow = false;
			}, 3000);
		}
	}

	// Escape, the focus trap and the background scroll lock all come from
	// `use:dialog` — this drawer declares aria-modal, so it must honour it.
</script>

{#if post && display}
	<div class="drawer-backdrop" transition:fade={{ duration: 150 }} onclick={onClose} role="presentation"></div>
	<aside
		class="post-drawer"
		transition:fly={{ x: 440, duration: 260, opacity: 1 }}
		role="dialog"
		aria-modal="true"
		aria-label="Post details"
		tabindex="-1"
		use:dialog={{ onClose }}
	>
		<div class="drawer-header">
			<div class="drawer-header-meta">
				<span class="drawer-date">{formatPostDate(post)}</span>
				<span class="drawer-status-badge" style="color: {statusColor(post.status)}; border-color: {statusColor(post.status)}">{post.status}</span>
				{#each post.platforms ?? [] as p (p)}
					<span class="drawer-platform-pill" style="background: {platformColor(p)}">{p}</span>
				{/each}
			</div>
			<button type="button" class="drawer-close" onclick={onClose} aria-label="Close details">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18" /><path d="M6 6l12 12" /></svg>
			</button>
		</div>

		<div class="drawer-body" bind:this={bodyEl}>
			{#if display.mediaUrl}
				<div class="drawer-media">
					<!-- A blurred, scaled copy of the media fills the frame behind it, so a
					     portrait clip in a wider panel reads as full-bleed instead of sitting
					     in dead black bars. Poster for video (cheap), the image itself otherwise. -->
					<div
						class="media-blur"
						style="background-image: url('{(display.mediaType === 'video'
							? display.posterUrl || display.mediaUrl
							: display.mediaUrl)?.replace(/'/g, '%27')}')"
					></div>
					{#if display.mediaType === 'video'}
						<!-- svelte-ignore a11y_media_has_caption -->
						{#key display.mediaUrl}
							<video
								class="media-el"
								src={display.mediaUrl}
								poster={display.posterUrl || undefined}
								controls
								playsinline
								preload="metadata"
								onerror={() => (videoError = true)}
							></video>
						{/key}
						{#if videoError}
							<!-- Playback failed (common on mobile for older non-faststart clips, or a
							     bad content-type). Don't leave a dead black box — say so and give a
							     direct route to the file, which always opens in the OS player. -->
							<div class="video-fallback" role="status">
								<p>This clip wouldn't play inline.</p>
								<a href={display.mediaUrl} target="_blank" rel="noopener noreferrer">Open video ↗</a>
							</div>
						{/if}
					{:else}
						<!-- Click to enlarge, matching every other image in the app. -->
						<button
							type="button"
							class="media-zoom"
							title="Click to enlarge"
							aria-label="Enlarge post media"
							onclick={() => (zoomOpen = true)}
						>
							<img class="media-el" src={thumbUrl(display.mediaUrl, 1080)} onerror={(e) => restoreOriginal(e, display.mediaUrl)} alt="Post media" width="1080" height="1350" fetchpriority="high" decoding="async" />
						</button>
					{/if}
					{#if refining}
						<div class="refine-overlay" role="status" aria-live="polite">
							<span class="refine-spinner"></span>
							Regenerating media — usually 1–3 minutes, up to 10 for premium video models. Keep
							this open or check the feed later.
						</div>
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
					<label class="sr-only" for="drawer-caption-edit">Post caption</label>
					<textarea id="drawer-caption-edit" rows="6" bind:value={draftText}></textarea>
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
						<button type="button" class="dt-edit" onclick={startTextEdit} title="Edit caption" aria-label="Edit caption">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
						</button>
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

			{#if post.status === 'failed' && !display.mediaUrl}
				<!-- A failed generation has no media and no caption. Say WHY, in one
				     safe sentence — never the raw provider payload (which leaks key ids
				     and used to render as JSON noise right here). -->
				<div class="drawer-error" role="alert">
					<strong
						><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg
						> Generation failed — nothing was produced</strong
					>
					<p>{summarizeGenError(post)}</p>
				</div>
			{/if}

			{#if storedRefineError && !refineOpen}
				<div class="drawer-error" role="alert">
					<strong
						><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg
						> Last refine failed — original media kept</strong
					>
					<p>{storedRefineError}</p>
				</div>
			{/if}

			{#if refineOpen && canRefine}
				<div class="drawer-refine">
					<span class="drawer-block-label"
						><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></svg
						> Refine &amp; regenerate</span
					>
					<p class="refine-hint">
						Edit the visual prompt to fix what the model got wrong (e.g. add "she holds the
						sealed pouch — never opens, squeezes or pours it"), then regenerate. The caption,
						schedule, face, product reference and voice all stay the same.
					</p>
					<label class="refine-field">
						<span class="drawer-block-label">Visual prompt</span>
						<textarea
							rows="5"
							bind:value={refineScene}
							disabled={refining}
							aria-invalid={Boolean(refineError)}
							aria-describedby={refineError ? 'refine-error-msg' : undefined}
						></textarea>
					</label>
					{#if display.format === 'spokesperson' && display.mediaType === 'video'}
						<label class="refine-field">
							<span class="drawer-block-label">Spoken line</span>
							<textarea rows="2" bind:value={refineDialogue} disabled={refining}></textarea>
						</label>
					{/if}
					{#if refineError}
						<p class="refine-error" id="refine-error-msg" role="alert">
							<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg
							>
							{truncateError(refineError)}
						</p>
					{/if}
					<div class="drawer-text-edit-actions">
						<button type="button" class="dt-btn" onclick={() => (refineOpen = false)} disabled={refining}>
							Cancel
						</button>
						<!-- Two-click confirm: a refine re-bills the media pipeline, and drafts
						     follow the confirm-before-spend rule everywhere in this app. -->
						<button
							type="button"
							class="dt-btn dt-save"
							class:confirming={confirmingRefine}
							onclick={handleRefineClick}
							disabled={refining || !refineScene.trim()}
						>
							{#if refining}Regenerating…{:else if confirmingRefine}Spend ~${refineEstimate.toFixed(2)}?{:else}<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v5h-5" /></svg
								> Regenerate (~${refineEstimate.toFixed(2)}){/if}
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

			{#if gen || display.ugcPrompt || display.script || costByProvider.length || genImages.length}
				<details class="drawer-details-block" bind:open={genDetailsOpen}>
					<summary>Generation details</summary>

					{#if genImages.length}
						<div>
							<span class="drawer-block-label"
								><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg
								> {gen?.images ? 'Images sent to the model' : 'Reference image'}</span
							>
							<div class="gen-imgs">
								{#each genImages as img (img.url)}
									<figure class="gen-img">
										<img src={thumbUrl(img.url, 160)} onerror={(e) => restoreOriginal(e, img.url)} alt={img.label} width="72" height="72" loading="lazy" decoding="async" />
										<figcaption>{img.label}</figcaption>
									</figure>
								{/each}
							</div>
						</div>
					{/if}

					{#if display.ugcPrompt}
						<div>
							<span class="drawer-block-label"
								><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 8-6 4 6 4V8z" /><rect x="2" y="6" width="14" height="12" rx="2" /></svg
								> UGC prompt sent</span
							>
							<p class="gen-prompt">{display.ugcPrompt}</p>
						</div>
					{/if}
					{#if display.script}
						<div>
							<span class="drawer-block-label"
								><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2" /><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" /></svg
								> Script</span
							>
							<p class="gen-prompt">{display.script}</p>
						</div>
					{/if}

					{#if genAspects.length}
						<div>
							<span class="drawer-block-label"
								><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg
								> Models &amp; estimated cost by aspect</span
							>
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
										<td class="gen-usd">${aspectsTotal.toFixed(3)}</td>
									</tr>
								</tbody>
							</table>
						</div>
					{:else if costByProvider.length}
						<!-- Fallback for posts without the full per-aspect record: the stored
						     cost-by-provider breakdown (still real estimated spend). -->
						<div>
							<span class="drawer-block-label"
								><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg
								> Estimated cost by provider</span
							>
							<table class="gen-cost">
								<tbody>
									{#each costByProvider as c (c.provider)}
										<tr>
											<td class="gen-op" style="text-transform: capitalize;">{c.provider}</td>
											<td class="gen-model"></td>
											<td class="gen-usd">${c.usd.toFixed(3)}</td>
										</tr>
									{/each}
									<tr class="gen-total">
										<td>Total</td>
										<td></td>
										<td class="gen-usd">${costTotal.toFixed(3)}</td>
									</tr>
								</tbody>
							</table>
						</div>
					{/if}

					{#if formatLine}
						<div>
							<span class="drawer-block-label"
								><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2" /><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" /></svg
								> Format</span
							>
							<p class="gen-prompt">
								{formatLine}{display.templateTitle ? ` · “${display.templateTitle}” template` : ''}
							</p>
						</div>
					{/if}

					{#if compositionLine}
						<div>
							<span class="drawer-block-label"
								><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg
								> Composition</span
							>
							<p class="gen-prompt">{compositionLine}</p>
						</div>
					{/if}

					{#if display.voice && display.mediaType === 'video' && display.format === 'spokesperson'}
						<div>
							<span class="drawer-block-label"
								><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg
								> Voice</span
							>
							<p class="gen-prompt">
								{display.voice}{gen?.voice_fallback
									? ` — “${gen.voice_fallback.requested}” wasn’t accepted by the TTS endpoint, so ${gen.voice_fallback.used} spoke this clip`
									: ''}
							</p>
						</div>
					{/if}

					{#if display.mediaType === 'video' && display.captionsKnown}
						<!-- Only assert burn state when it was actually RECORDED — legacy clips
						     predate the field, and claiming "off" for a video with visible
						     burned captions would be a false statement about the media. -->
						<div>
							<span class="drawer-block-label"
								><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg
								> Captions &amp; badge</span
							>
							<p class="gen-prompt">
								Captions: {display.captionsBurned
									? `burned${display.onScreenText ? ` — “${display.onScreenText}”` : ''}`
									: 'off'} · AI badge: {display.aiBadgeBurned ? 'burned' : 'off'}
							</p>
						</div>
					{/if}

					{#if !gen && genAspects.length}
						<p class="gen-note">
							Models &amp; cost recovered from the generation ledger. The exact input images sent
							weren't recorded for this older post — the product reference is shown from the brief.
							New generations capture every input image directly.
						</p>
					{:else if !gen}
						<p class="gen-note">
							No per-model record was found in the ledger for this post — showing its stored prompt
							and cost. New generations capture the full model + reference-image record.
						</p>
					{/if}

					{#if genSelections}
						<div>
							<span class="drawer-block-label"
								><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg
								> Selections at generation</span
							>
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
				<div class="drawer-error" role="alert">
					<strong
						><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg
						> Post-level error</strong
					>
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
			{#if onDelete}
				<button type="button" class="btn-drawer-delete" class:confirming={confirmingDelete} disabled={deleting} onclick={handleDeleteClick}>
					{#if deleting}Deleting…{:else if confirmingDelete}Confirm delete?{:else}Delete{/if}
				</button>
			{/if}
			{#if onReject && (post.status === 'draft' || post.status === 'scheduled')}
				<button type="button" class="btn-drawer-delete" onclick={() => onReject?.(post)}>
					{post.status === 'scheduled' ? 'Unschedule' : 'Reject'}
				</button>
			{/if}
			{#if canRefine}
				<!-- The media re-roll loop: edit the prompt that produced this video and
				     regenerate it in place. Disabled while a refine is already running. -->
				<button
					type="button"
					class="btn-drawer-refine"
					disabled={refining}
					onclick={() => (refineOpen ? (refineOpen = false) : openRefine())}
					title="Edit the visual prompt and regenerate the media"
				>
					{refining ? 'Refining…' : 'Refine'}
				</button>
			{/if}
			{#if post.status === 'draft' && display.standalone}
				<!-- Studio "Asset only" output is deliberately excluded from the review
				     queue — offering Approve & Schedule here would defeat that promise
				     one click later. -->
				<span
					class="drawer-asset-note"
					title="Saved as a standalone asset — it stays out of the review queue and does not publish. Generate a post version from Studio to publish this concept."
					>Standalone asset — not queued for publishing</span
				>
			{:else if post.status === 'draft'}
				<button type="button" class="btn-drawer-approve" disabled={approving || refining} onclick={() => onApprove(post)}>
					{approving ? 'Approving…' : 'Approve & Schedule'}
				</button>
			{:else if canRepublish}
				<!-- Media generated fine; only publishing failed. Re-send to a platform
				     that IS connected — the user picks which. No auto-retry. -->
				<button type="button" class="btn-drawer-approve" onclick={() => onPublishFallback?.(post)}>
					Publish to a connected platform
				</button>
			{/if}
			{#if canPostNow}
				<!-- Publish immediately to the post's connected platforms, overriding any
				     schedule. Two-click confirm because posting live is irreversible. -->
				<button
					type="button"
					class="btn-drawer-postnow"
					class:confirming={confirmingPostNow}
					disabled={posting || refining}
					onclick={handlePostNowClick}
					title="Publish immediately, overriding the schedule"
				>
					{#if posting}Posting…{:else if confirmingPostNow}Post live now?{:else}Post Now{/if}
				</button>
			{/if}
			<button type="button" class="btn-drawer-close" onclick={onClose}>Close</button>
		</div>
	</aside>

	<ImageLightbox
		url={zoomOpen ? display.mediaUrl : null}
		label={display.text ? String(display.text).slice(0, 80) : 'Post media'}
		type="image"
		onClose={() => (zoomOpen = false)}
	/>
{/if}

<style>
	.drawer-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.55);
		backdrop-filter: blur(4px);
		z-index: var(--z-drawer);
	}

	.drawer-text-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}
	.dt-edit {
		position: relative;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-dim);
		cursor: pointer;
	}
	/* Keep the small visual buttons, expand the tap area to 44x44. */
	.dt-edit::after,
	.drawer-close::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		min-width: 44px;
		min-height: 44px;
		width: 100%;
		height: 100%;
	}
	.dt-edit:hover { border-color: var(--accent-mid); color: var(--text); }
	.drawer-text-edit textarea {
		width: 100%;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text);
		padding: 0.6rem;
		font: inherit;
		/* 16px minimum — anything smaller makes iOS Safari zoom on focus. */
		font-size: 1rem;
		line-height: 1.5;
	}
	.drawer-text-edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.dt-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		min-height: 44px;
		min-width: 44px;
		padding: 0.4rem 0.85rem;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-dim);
		font-size: 0.8rem;
		cursor: pointer;
	}
	.dt-save {
		background: var(--accent);
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
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text);
		padding: 0.4rem 0.6rem;
		font: inherit;
		/* 16px minimum — anything smaller makes iOS Safari zoom on focus. */
		font-size: 1rem;
		min-height: 44px;
	}

	.post-drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(580px, 100vw);
		background: var(--surface);
		border-left: 1px solid var(--border-strong);
		z-index: var(--z-modal);
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
		position: relative;
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
		position: relative;
		border-radius: var(--radius-sm);
		overflow: hidden;
		border: 1px solid var(--border);
		background: #000;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* Blurred fill behind the media so portrait clips never sit in flat black bars. */
	.media-blur {
		position: absolute;
		inset: 0;
		background-size: cover;
		background-position: center;
		filter: blur(34px) brightness(0.55) saturate(1.1);
		transform: scale(1.2);
		z-index: 0;
	}

	/* Shown over the poster when inline playback fails — offers the raw file, which
	   always opens in the device's native player. */
	.video-fallback {
		position: absolute;
		inset: 0;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		padding: 1rem;
		text-align: center;
		background: rgba(10, 14, 24, 0.72);
		backdrop-filter: blur(2px);
		color: #fff;
		font-size: 0.8rem;
	}
	.video-fallback p {
		margin: 0;
	}
	.video-fallback a {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		font-weight: 700;
		color: #fff;
		text-decoration: underline;
		padding: 0.4rem 0.9rem;
		border: 1px solid rgba(255, 255, 255, 0.5);
		border-radius: 8px;
	}

	/* ── Refine (regenerate media in place) ── */
	.refine-overlay {
		position: absolute;
		inset: 0;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		padding: 1rem;
		text-align: center;
		background: rgba(10, 14, 24, 0.78);
		backdrop-filter: blur(3px);
		color: #fff;
		font-size: 0.8rem;
		line-height: 1.5;
	}
	.refine-spinner {
		width: 22px;
		height: 22px;
		border-radius: 999px;
		border: 2px solid rgba(255, 255, 255, 0.25);
		border-top-color: #fff;
		animation: refine-spin 0.9s linear infinite;
	}
	@keyframes refine-spin {
		to { transform: rotate(360deg); }
	}
	.drawer-refine {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		background: var(--surface-2);
		border: 1px solid var(--accent-mid, var(--border-strong));
		border-radius: var(--radius-sm);
		padding: 0.75rem 0.9rem;
	}
	.refine-hint {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: var(--text-muted);
	}
	.refine-field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.refine-field textarea {
		width: 100%;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text);
		padding: 0.6rem;
		font: inherit;
		/* 16px minimum — anything smaller makes iOS Safari zoom on focus. */
		font-size: 1rem;
		line-height: 1.5;
		resize: vertical;
	}
	.refine-error {
		margin: 0;
		font-size: 0.75rem;
		color: var(--error-text);
		line-height: 1.5;
	}
	/* Second click state — amber to signal this spends real money right now. */
	.dt-save.confirming {
		background: var(--warning);
	}

	.drawer-media .media-el {
		position: relative;
		z-index: 1;
		width: 100%;
		/* `height: auto` keeps the intrinsic ratio in charge — without it the img's
		   width/height attributes would apply as a presentational height hint. */
		height: auto;
		max-height: 78dvh;
		object-fit: contain;
		display: block;
	}

	/* Before metadata loads a <video> has no intrinsic size and collapses to a
	   sliver; reserve a 9:16 box (our UGC clips) until the real ratio takes over. */
	.drawer-media video.media-el {
		aspect-ratio: auto 9 / 16;
	}

	/* Zoom affordance wrapper — must not alter the media's own layout. */
	.media-zoom {
		position: relative;
		z-index: 1;
		display: block;
		width: 100%;
		padding: 0;
		border: none;
		background: none;
		cursor: zoom-in;
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
		font-variant-numeric: tabular-nums;
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

	/* Inline SVG icons replacing the old emoji — sit on the text baseline. */
	.drawer-block-label svg,
	.drawer-error strong svg,
	.refine-error svg,
	.dt-btn svg {
		vertical-align: -0.15em;
		flex-shrink: 0;
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
		/* 44px tap target without switching off the disclosure marker. */
		min-height: 44px;
		padding: 0.85rem 0;
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
	.gen-note {
		font-size: 0.68rem;
		line-height: 1.4;
		color: var(--text-dim);
		font-style: italic;
		margin-top: 0.6rem;
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
		color: var(--error-text);
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
		color: var(--error-text);
		margin: 0;
		line-height: 1.5;
	}

	.breakdown-link {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--accent-text);
		text-decoration: none;
		align-self: flex-start;
	}

	.breakdown-link:hover {
		text-decoration: underline;
	}

	.drawer-footer {
		display: flex;
		align-items: center;
		/* Wrap so the 4–5 action buttons a draft/review post can show (Reject ·
		   Refine · Approve & Schedule · Post Now · Close, or the long "Publish to a
		   connected platform") never overflow a ~390px phone — they flow onto a
		   second row instead of scrolling sideways. */
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0.9rem 1.25rem;
		border-top: 1px solid var(--border);
		background: var(--surface-2);
	}

	/* One congruent footer button. Every action shares the same geometry and
	   weight; only the semantic tint differs (soft fill + colored label at rest,
	   solid fill on hover) so the row reads as a single, restrained set — matching
	   the Delete/Close pair, with no per-button icons. */
	.btn-drawer-delete,
	.btn-drawer-refine,
	.btn-drawer-approve,
	.btn-drawer-postnow,
	.btn-drawer-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		min-width: 44px;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 0.5rem 1rem;
		font-size: 0.78rem;
		font-weight: 600;
		line-height: 1.2;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-drawer-delete {
		background: var(--error-soft);
		color: var(--error-text);
	}
	.btn-drawer-delete:hover:not(:disabled),
	.btn-drawer-delete.confirming {
		background: var(--error);
		color: #fff;
	}

	.btn-drawer-refine {
		background: var(--accent-soft);
		color: var(--accent-text);
	}
	.btn-drawer-refine:hover:not(:disabled) {
		background: var(--accent);
		color: #fff;
	}

	.drawer-asset-note {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0.5rem 0.8rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--muted);
		border: 1px dashed var(--border);
		border-radius: 10px;
	}
	.btn-drawer-approve {
		background: var(--success-soft);
		color: var(--success-text);
	}
	.btn-drawer-approve:hover:not(:disabled) {
		background: var(--success);
		color: #fff;
	}

	.btn-drawer-postnow {
		background: var(--cyan-soft);
		color: var(--cyan-text);
	}
	.btn-drawer-postnow:hover:not(:disabled) {
		background: var(--cyan);
		color: #fff;
	}
	/* Second click state — amber to signal this publishes live, right now. */
	.btn-drawer-postnow.confirming {
		background: var(--warning);
		color: #fff;
	}

	.btn-drawer-close {
		margin-left: auto;
		background: var(--surface);
		color: var(--text-muted);
		border-color: var(--border);
	}
	.btn-drawer-close:hover {
		border-color: var(--accent-mid);
		color: var(--text);
	}

	.btn-drawer-delete:disabled,
	.btn-drawer-refine:disabled,
	.btn-drawer-approve:disabled,
	.btn-drawer-postnow:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	@media (max-width: 520px) {
		.post-drawer {
			width: 100vw;
			border-left: none;
		}
	}
</style>
