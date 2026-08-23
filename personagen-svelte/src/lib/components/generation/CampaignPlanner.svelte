<script lang="ts">
	/**
	 * Campaign Planner — fill the calendar with a MIX of content in one pass.
	 *
	 * The user picks a persona, a horizon, a posting cadence, and the RATIO of
	 * content formats (same Text / Photo / Video / Cinematic vocabulary as the
	 * Studio shelves). The planner allocates real Studio templates to real
	 * schedule slots, shows the exact count + estimated spend BEFORE anything
	 * runs, and on launch queues each slot through the same
	 * /generate-post endpoint a single Studio generation uses — so every post
	 * obeys its template's composition contract, lands as a DRAFT in the review
	 * queue (deliver: 'review'), and keeps its calendar slot. Nothing publishes
	 * until the user approves it; the spend that happens now is generation only.
	 */
	import Modal from '$lib/components/ui/Modal.svelte';
	import { STUDIO_TEMPLATES, PIPELINE_USD, type StudioTemplate } from '$lib/studio-templates';

	let {
		open,
		onClose,
		agents,
		initialAgentId = '',
		onLaunched
	}: {
		open: boolean;
		onClose: () => void;
		agents: Array<{ id: string; name: string }>;
		initialAgentId?: string;
		/** Called after a launch finishes with how many posts were queued. */
		onLaunched: (queued: number) => void;
	} = $props();

	// ── Format classes (Studio-shelf vocabulary) ─────────────────────────────
	type FormatClass = 'typographic' | 'photo' | 'video' | 'cinematic';
	const CLASSES: Array<{ id: FormatClass; label: string; hint: string }> = [
		{
			id: 'typographic',
			label: 'Text & Type',
			hint: 'Quote cards, takes, lists — free, rendered without an image model'
		},
		{ id: 'photo', label: 'Photo', hint: 'Lifestyle stills, flat-lays, POV frames' },
		{ id: 'video', label: 'Video', hint: 'Talking heads and product motion' },
		{ id: 'cinematic', label: 'Cinematic', hint: 'Multi-shot, ad-grade — the expensive one' }
	];

	// Template pools per class, drawn from the real catalog so a new template is
	// automatically campaign-eligible.
	const POOLS: Record<FormatClass, StudioTemplate[]> = {
		typographic: STUDIO_TEMPLATES.filter((t) => t.surface === 'typographic'),
		photo: STUDIO_TEMPLATES.filter((t) => t.pipeline === 'Still image' && t.surface === 'photo'),
		video: STUDIO_TEMPLATES.filter(
			(t) => t.pipeline === 'Talking head' || t.pipeline === 'Product motion'
		),
		cinematic: STUDIO_TEMPLATES.filter((t) => t.pipeline === 'Cinematic')
	};
	// Price with the SAME 4:1 channel:brand rotation buildPlan runs — a flat pool
	// average priced a distribution the planner doesn't produce (e.g. every
	// channel video template is a Talking head; all Product motion is brand).
	const poolAvgUsd = (c: FormatClass) => {
		const pool = POOLS[c];
		if (!pool.length) return 0;
		const avg = (l: StudioTemplate[]) =>
			l.reduce((s, t) => s + PIPELINE_USD[t.pipeline], 0) / Math.max(1, l.length);
		const ch = pool.filter((t) => t.intent === 'channel');
		const br = pool.filter((t) => t.intent === 'brand');
		if (!ch.length || !br.length) return avg(pool);
		return 0.8 * avg(ch) + 0.2 * avg(br);
	};

	// ── Plan inputs ──────────────────────────────────────────────────────────
	let agentId = $state('');
	$effect(() => {
		if (open) agentId = initialAgentId || agents[0]?.id || '';
	});

	let days = $state<7 | 14 | 30>(7);
	let perDay = $state<1 | 2 | 3>(1);

	// Ratio weights (0–100 each, normalized — they don't need to sum to 100).
	// Default follows the healthy-account shape: channel-heavy, text-forward,
	// cinematic as seasoning.
	let weights = $state<Record<FormatClass, number>>({
		typographic: 40,
		photo: 25,
		video: 30,
		cinematic: 5
	});
	let weightSum = $derived(CLASSES.reduce((s, c) => s + (weights[c.id] || 0), 0));

	// One launch is capped — a month at 3/day is 90 generations, which is a
	// bill and a rate-limit risk nobody should trip by accident.
	const MAX_POSTS = 60;
	let requested = $derived(days * perDay);
	let totalPosts = $derived(Math.min(requested, MAX_POSTS));
	let capped = $derived(requested > MAX_POSTS);
	// Slots are laid down date-first, so a capped plan covers only the FIRST
	// ceil(total/perDay) days — the summary must claim those days, not the horizon
	// the user picked ("60 posts over 30 days" was really 20 covered days).
	let coveredDays = $derived(Math.min(days, Math.ceil(totalPosts / Math.max(1, perDay))));

	// Largest-remainder allocation: counts per class sum EXACTLY to totalPosts.
	let allocation = $derived.by<Record<FormatClass, number>>(() => {
		const out: Record<FormatClass, number> = { typographic: 0, photo: 0, video: 0, cinematic: 0 };
		if (weightSum <= 0 || totalPosts <= 0) return out;
		const exact = CLASSES.map((c) => ({
			id: c.id,
			raw: (totalPosts * (weights[c.id] || 0)) / weightSum
		}));
		let used = 0;
		for (const e of exact) {
			out[e.id] = Math.floor(e.raw);
			used += out[e.id];
		}
		const byRemainder = [...exact].sort((a, b) => (b.raw % 1) - (a.raw % 1));
		for (let i = 0; used < totalPosts && i < byRemainder.length * 2; i++) {
			out[byRemainder[i % byRemainder.length].id]++;
			used++;
		}
		return out;
	});

	let estimatedUsd = $derived(CLASSES.reduce((s, c) => s + allocation[c.id] * poolAvgUsd(c.id), 0));

	// ── Slot + assignment plan ───────────────────────────────────────────────
	// Posting window 8:00–20:00; anchors per cadence, jittered so a month of
	// posts doesn't fire at identical minutes.
	const TIME_ANCHORS: Record<number, string[]> = {
		1: ['11:00'],
		2: ['10:00', '16:30'],
		3: ['09:30', '13:00', '17:30']
	};
	const pad = (n: number) => String(n).padStart(2, '0');
	const jitter = (hhmm: string) => {
		const [h, m] = hhmm.split(':').map(Number);
		const t = h * 60 + m + Math.round((Math.random() - 0.5) * 50);
		const clamped = Math.max(8 * 60, Math.min(20 * 60 - 1, t));
		return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}:00`;
	};
	/**
	 * ~80/20 channel:brand rotation. A uniform shuffle over the pool made a bulk
	 * campaign roughly half promo (the video pool is ~9 brand / 9 channel), which
	 * is the exact account-killing ratio the Studio's intent split exists to
	 * prevent. The cycle is patterned 4 channel : 1 brand — shuffled within each
	 * intent so runs still vary — and degrades to a plain shuffle when a pool has
	 * only one intent.
	 */
	const channelWeightedCycle = (pool: StudioTemplate[]): StudioTemplate[] => {
		const ch = shuffle(pool.filter((t) => t.intent === 'channel'));
		const br = shuffle(pool.filter((t) => t.intent === 'brand'));
		if (!ch.length || !br.length) return shuffle(pool);
		const out: StudioTemplate[] = [];
		let bi = 0;
		const rounds = Math.max(ch.length, br.length * 4);
		for (let i = 0; i < rounds; i++) {
			out.push(ch[i % ch.length]);
			if ((i + 1) % 4 === 0) out.push(br[bi++ % br.length]);
		}
		return out;
	};

	const shuffle = <T,>(arr: T[]): T[] => {
		const a = [...arr];
		for (let i = a.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[a[i], a[j]] = [a[j], a[i]];
		}
		return a;
	};

	interface PlannedSlot {
		date: string;
		time: string;
		template: StudioTemplate;
	}

	function buildPlan(): PlannedSlot[] {
		// The class sequence: one entry per post, shuffled so formats interleave
		// across days instead of clustering.
		const sequence: FormatClass[] = shuffle(
			CLASSES.flatMap((c) => Array<FormatClass>(allocation[c.id]).fill(c.id))
		);
		// Per-class template rotation (shuffled cycle) so a campaign uses the
		// breadth of the catalog instead of hammering one archetype.
		const cycles: Record<FormatClass, StudioTemplate[]> = {
			typographic: channelWeightedCycle(POOLS.typographic),
			photo: channelWeightedCycle(POOLS.photo),
			video: channelWeightedCycle(POOLS.video),
			cinematic: channelWeightedCycle(POOLS.cinematic)
		};
		const cursor: Record<FormatClass, number> = {
			typographic: 0,
			photo: 0,
			video: 0,
			cinematic: 0
		};

		const slots: PlannedSlot[] = [];
		const start = new Date();
		start.setDate(start.getDate() + 1); // campaigns start tomorrow
		let s = 0;
		outer: for (let d = 0; d < days; d++) {
			const date = new Date(start);
			date.setDate(start.getDate() + d);
			const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
			for (const anchor of TIME_ANCHORS[perDay]) {
				if (s >= sequence.length) break outer;
				const cls = sequence[s++];
				const pool = cycles[cls];
				if (!pool.length) continue;
				const template = pool[cursor[cls]++ % pool.length];
				slots.push({ date: dateStr, time: jitter(anchor), template });
			}
		}
		return slots;
	}

	// ── Launch ───────────────────────────────────────────────────────────────
	let launching = $state(false);
	let cancelled = $state(false);
	let done = $state(false);
	let progress = $state(0);
	let okCount = $state(0);
	let failCount = $state(0);
	let planSize = $state(0);

	$effect(() => {
		if (open) {
			// A reopened planner is a fresh plan, not a stale summary.
			done = false;
			launching = false;
			cancelled = false;
			progress = 0;
			okCount = 0;
			failCount = 0;
		}
	});

	async function launch() {
		if (!agentId || launching || totalPosts <= 0 || weightSum <= 0) return;
		const plan = buildPlan();
		planSize = plan.length;
		launching = true;
		cancelled = false;
		okCount = 0;
		failCount = 0;
		for (let i = 0; i < plan.length; i++) {
			if (cancelled) break;
			progress = i + 1;
			const t = plan[i].template;
			try {
				const res = await fetch(`/api/agent/${agentId}/generate-post`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						...t.baseBody,
						// Per-slot variance seed. The Director is stateless, so ten slots
						// from one franchise template would otherwise get the IDENTICAL
						// prompt — and "never reuse a previous payload" is unenforceable
						// without knowing which slot this is. Slot index + date give each
						// run a distinct identity to diverge from.
						topic: `${t.baseBody.topic} (Campaign context: this is slot ${i + 1} of ${plan.length}, scheduled ${plan[i].date}. Other slots in this campaign may use this same archetype — choose an angle, payload and specifics DISTINCT from what any other slot would most obviously pick.)`,
						studio_template: t.id,
						deliver: 'review',
						scheduled_date: plan[i].date,
						scheduled_time: plan[i].time
					})
				});
				const j = await res.json().catch(() => ({}));
				if (res.status === 202 || (res.ok && j?.success)) okCount++;
				else failCount++;
			} catch {
				failCount++;
			}
			// Small spacing so a 60-slot launch doesn't burst the API.
			await new Promise((r) => setTimeout(r, 250));
		}
		launching = false;
		done = true;
		onLaunched(okCount);
	}

	const usd = (n: number) => `$${n.toFixed(2)}`;
	let agentName = $derived(agents.find((a) => a.id === agentId)?.name ?? 'this persona');
</script>

<Modal
	{open}
	size="lg"
	title="Plan a campaign"
	subtitle="Fill the calendar with a mix of content. Everything generates as drafts for your review — nothing publishes until you approve it."
	onClose={() => {
		if (launching) cancelled = true;
		onClose();
	}}
>
	{#if done}
		<div class="cp-done" role="status">
			<strong>{okCount} post{okCount === 1 ? '' : 's'} queued for {agentName}.</strong>
			<p>
				Each one is generating now and lands in the <strong>Review Queue</strong> as a draft on its
				calendar slot. Approve what you like — approved posts publish at their scheduled time.
				{#if failCount > 0}<span class="cp-fail"
						>{failCount} failed to queue — the calendar shows exactly which slots are missing.</span
					>{/if}
			</p>
		</div>
	{:else}
		<div class="cp-grid">
			<label class="cp-field">
				<span class="cp-label">Persona</span>
				<select bind:value={agentId} disabled={launching} aria-label="Campaign persona">
					{#each agents as a (a.id)}
						<option value={a.id}>{a.name}</option>
					{/each}
				</select>
				<span class="cp-hint"
					>The whole campaign belongs to this persona — voice, face, brand kit.</span
				>
			</label>

			<div class="cp-field">
				<span class="cp-label" id="cp-horizon">Horizon</span>
				<div class="cp-chips" role="group" aria-labelledby="cp-horizon">
					{#each [[7, 'Next week'], [14, 'Two weeks'], [30, 'A month']] as [d, label] (d)}
						<button
							type="button"
							class="cp-chip"
							class:on={days === d}
							aria-pressed={days === d}
							disabled={launching}
							onclick={() => (days = d as typeof days)}>{label}</button
						>
					{/each}
				</div>
			</div>

			<div class="cp-field">
				<span class="cp-label" id="cp-cadence">Posts per day</span>
				<div class="cp-chips" role="group" aria-labelledby="cp-cadence">
					{#each [1, 2, 3] as n (n)}
						<button
							type="button"
							class="cp-chip"
							class:on={perDay === n}
							aria-pressed={perDay === n}
							disabled={launching}
							onclick={() => (perDay = n as typeof perDay)}>{n}×</button
						>
					{/each}
				</div>
			</div>
		</div>

		<div class="cp-field">
			<span class="cp-label">Content mix</span>
			<span class="cp-hint">
				Set the ratio with the sliders — they're weights, so they don't need to add up to 100.
			</span>
			{#each CLASSES as c (c.id)}
				<div class="cp-mix-row">
					<span class="cp-mix-name" title={c.hint}>{c.label}</span>
					<input
						type="range"
						min="0"
						max="100"
						step="5"
						bind:value={weights[c.id]}
						disabled={launching}
						aria-label={`${c.label} share`}
					/>
					<input
						class="cp-mix-num"
						type="number"
						min="0"
						max="100"
						bind:value={weights[c.id]}
						disabled={launching}
						aria-label={`${c.label} weight`}
					/>
					<span class="cp-mix-count" aria-live="polite">
						{allocation[c.id]} post{allocation[c.id] === 1 ? '' : 's'}
					</span>
				</div>
			{/each}
			{#if weightSum <= 0}
				<p class="cp-warn" role="alert">Every format is at zero — give at least one a weight.</p>
			{/if}
		</div>

		<div class="cp-summary" aria-live="polite">
			<div class="cp-summary-main">
				<strong>{totalPosts} posts</strong> over {coveredDays} day{coveredDays === 1 ? '' : 's'} · est.
				<strong>{usd(estimatedUsd)}</strong>
			</div>
			<p class="cp-summary-note">
				Generation spend happens at launch; publishing waits for your approval in the Review Queue.
				Estimated at the default model prices — each slot's exact pipeline and cost follow your
				Model Manager settings.
				{#if capped}<span class="cp-warn-inline"
						>Capped at {MAX_POSTS} per launch, so only the first {coveredDays} of {days} days get slots
						— run another campaign for the rest.</span
					>{/if}
			</p>
		</div>

		{#if launching}
			<div class="cp-progress" role="status">
				<span class="cp-spinner" aria-hidden="true"></span>
				Queueing {progress}/{planSize}… drafts appear on the calendar as they finish.
			</div>
		{/if}
	{/if}

	{#snippet footer()}
		{#if done}
			<button class="btn-primary" onclick={onClose}>Done</button>
		{:else if launching}
			<button class="btn-ghost" onclick={() => (cancelled = true)}>Stop after this one</button>
		{:else}
			<button class="btn-ghost" onclick={onClose}>Cancel</button>
			<button
				class="btn-primary"
				disabled={!agentId || totalPosts <= 0 || weightSum <= 0}
				onclick={launch}
			>
				Generate {totalPosts} drafts · est. {usd(estimatedUsd)}
			</button>
		{/if}
	{/snippet}
</Modal>

<style>
	.cp-grid {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 0.9rem;
		margin-bottom: 1rem;
	}
	@media (max-width: 640px) {
		.cp-grid {
			grid-template-columns: 1fr;
		}
	}
	.cp-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 0.9rem;
	}
	.cp-label {
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.cp-hint {
		font-size: 0.78rem;
		color: var(--muted);
	}
	.cp-field select {
		min-height: 44px;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.9rem;
	}
	.cp-chips {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.cp-chip {
		min-height: 44px;
		padding: 0.4rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.cp-chip.on {
		border-color: var(--accent);
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}
	.cp-chip:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.cp-mix-row {
		display: grid;
		grid-template-columns: 110px 1fr 74px 84px;
		align-items: center;
		gap: 0.7rem;
		padding: 0.3rem 0;
	}
	@media (max-width: 640px) {
		.cp-mix-row {
			grid-template-columns: 90px 1fr 64px 70px;
			gap: 0.4rem;
		}
	}
	.cp-mix-name {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text);
	}
	.cp-mix-row input[type='range'] {
		width: 100%;
		accent-color: var(--accent);
		min-height: 44px;
	}
	.cp-mix-num {
		min-height: 44px;
		padding: 0.3rem 0.45rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}
	.cp-mix-count {
		font-size: 0.8rem;
		color: var(--muted);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.cp-warn {
		margin: 0.3rem 0 0;
		font-size: 0.8rem;
		color: var(--error-text, var(--error));
	}
	.cp-warn-inline {
		color: var(--warning, #b45a0a);
		font-weight: 600;
	}
	.cp-summary {
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
		padding: 0.75rem 0.9rem;
	}
	.cp-summary-main {
		font-size: 1rem;
		color: var(--text);
	}
	.cp-summary-note {
		margin: 0.25rem 0 0;
		font-size: 0.78rem;
		color: var(--muted);
	}
	.cp-progress {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-top: 0.9rem;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.cp-spinner {
		width: 15px;
		height: 15px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: cp-spin 0.8s linear infinite;
	}
	@keyframes cp-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.cp-done strong {
		color: var(--text);
	}
	.cp-done p {
		margin: 0.4rem 0 0;
		font-size: 0.88rem;
		color: var(--muted);
		line-height: 1.5;
	}
	.cp-fail {
		display: block;
		margin-top: 0.35rem;
		color: var(--error-text, var(--error));
	}
</style>
