<script lang="ts">
	import { onMount } from 'svelte';

	// ── Guide catalog ────────────────────────────────────────────────────────
	// Static, code-defined how-tos. Every step names the REAL buttons and tabs
	// as they appear in the app — if the UI vocabulary changes, change it here
	// too (this page is user documentation, not marketing).
	interface Guide {
		id: string;
		category: string;
		title: string;
		when: string; // "you need this when…" — symptom-first, in the user's words
		steps: string[];
		tip?: string;
	}

	const CATEGORIES = [
		'Getting started',
		'Keys & credits',
		'Creating content',
		'Publishing',
		'Fixing problems'
	] as const;

	const GUIDES: Guide[] = [
		// ── Getting started ──────────────────────────────────────────────────
		{
			id: 'daily-routine',
			category: 'Getting started',
			title: 'The 5-minute daily routine',
			when: 'Every day. This is the whole job once your creators are set up.',
			steps: [
				'Open Review Queue in the left sidebar — your creators’ new drafts are waiting there.',
				'For each draft: read the caption, look at the image or play the video.',
				'Approve the good ones. Click the ✎ pencil to reword a caption first if you want — what you write is exactly what gets published.',
				'Reject the misses and pick a reason ("Bad caption", "Wrong tone"…). Rejecting is free — the creator makes a replacement, and your reasons teach it your taste.',
				'Glance at Calendar to see when approved posts go out. Done.'
			],
			tip: 'Nothing ever posts without your approval while a creator is in Semi-Autonomous mode (the default).'
		},
		{
			id: 'brand-brief',
			category: 'Getting started',
			title: 'Fix your brand voice in one place',
			when: 'Captions feel off-brand, or a product is missing / has no photo.',
			steps: [
				'Open Brand Brief (sidebar → Setup).',
				'Read what’s written — this is what your creators believe about your brand: voice, audience, pain points, products.',
				'Edit anything that’s off, directly in the fields. One fix here changes every future post from every creator.',
				'Check the Products section: every product needs a photo — that’s what creators hold and show on camera.',
				'Save. New drafts use the corrected version immediately.'
			]
		},
		{
			id: 'meet-creators',
			category: 'Getting started',
			title: 'Tour a creator’s page',
			when: 'You want to understand what a persona is and what each tab does.',
			steps: [
				'Pick a creator under Personas in the sidebar.',
				'Profile tab — who they are: personality text, posting schedule, autonomy, and (via the Connections view) their linked social accounts.',
				'Content tab — everything they’ve made: drafts, scheduled posts, published posts, plus the composer to make something new.',
				'Studio tab — ready-made post templates that pre-fill the composer. Studio output always lands as a draft for your review.'
			]
		},

		// ── Keys & credits ───────────────────────────────────────────────────
		{
			id: 'openrouter-key',
			category: 'Keys & credits',
			title: 'Get an OpenRouter key (fixes "out of credits")',
			when: 'Content generation fails with a message like "Generation failed via openrouter", "402", or "insufficient credits". OpenRouter is the service that writes captions and scripts — when its credits run out, generation stops until you top up or connect your own key.',
			steps: [
				'Go to openrouter.ai and sign in (Google sign-in works, no card needed yet).',
				'Open openrouter.ai/settings/keys and click Create Key. Give it any name (e.g. "PersonaGen").',
				'Copy the key — it starts with sk-or-v1-… and is shown only once. Keep the tab open until you’ve pasted it.',
				'Add credits at openrouter.ai/settings/credits → Add Credits. $10–20 covers a lot of caption writing.',
				'Back in PersonaGen: open Settings (sidebar → Setup) and scroll to the API Keys section.',
				'Find the OpenRouter row, paste your key, and click Save. The app tests the key immediately and marks it Valid.',
				'Retry whatever failed — generate a post or approve a draft. It will use your key from now on.'
			],
			tip: 'Your key is stored encrypted and never shown again after saving. You can watch your usage anytime at openrouter.ai/activity.'
		},
		{
			id: 'all-keys',
			category: 'Keys & credits',
			title: 'What each API key powers',
			when: 'You’re looking at the API Keys section in Settings and wondering what’s what.',
			steps: [
				'Zernio — publishing. Connects your social accounts and sends approved posts to them. Without it, nothing publishes.',
				'Fal AI — pictures, video, and voice. Generates the images, videos, and spoken audio in your posts.',
				'OpenRouter — writing. Captions, scripts, and ideas (also a backup route for media). See the OpenRouter guide if it runs out of credits.',
				'Gemini — alternative writing engine; either OpenRouter or Gemini is enough.',
				'Firecrawl — brand reading. Powers "paste your website URL" in the Brand Brief.',
				'Each row in Settings → API Keys has paste → Save; the app tests the key on save and shows Valid or the exact problem.'
			],
			tip: 'A key with a red status shows the reason right on the row — fix it there rather than guessing.'
		},
		{
			id: 'zernio-billing',
			category: 'Keys & credits',
			title: 'Understand publishing billing (per connected account)',
			when: 'You’re deciding how many social accounts to connect.',
			steps: [
				'Publishing is billed per connected social account, metered daily — not per post.',
				'Your first 2 connected accounts are free; beyond that it’s about $6/account/month (and cheaper at volume).',
				'The Connections view (creator’s Profile tab → Connections) shows a live meter of what your connected accounts cost.',
				'Disconnecting an account stops its charge immediately — and its posting.'
			]
		},

		// ── Creating content ─────────────────────────────────────────────────
		{
			id: 'generate-post',
			category: 'Creating content',
			title: 'Generate a post right now',
			when: 'You don’t want to wait for the schedule — you want a post on demand.',
			steps: [
				'Open the creator’s page → Content tab → composer.',
				'Type a topic, or leave it blank and let the creator choose one that fits your brand.',
				'Pick the format: Image, Video, or Cinematic (multi-shot video).',
				'Hit generate. It runs in the background with progress shown — a minute or two for images, a few minutes for video.',
				'The finished post appears as a Draft. Edit the caption if you like, then approve it like any other draft.'
			],
			tip: 'Video posts come with the creator’s own voice and sound. Cinematic is the premium multi-scene format — best for hero content.'
		},
		{
			id: 'studio-templates',
			category: 'Creating content',
			title: 'Use Studio templates',
			when: 'You want proven post formats without writing a prompt.',
			steps: [
				'Open the creator’s page → Studio tab.',
				'Browse the template gallery — each one is a ready-made post archetype.',
				'Click one: it pre-fills the composer with the template’s structure.',
				'Adjust anything you want, then generate.',
				'The result lands as a Draft in your Review Queue — Studio never publishes on its own.'
			]
		},
		{
			id: 'reference-kit',
			category: 'Creating content',
			title: 'Keep a creator’s face consistent (reference kit)',
			when: 'A creator’s kit tiles are empty, or their look varies between posts.',
			steps: [
				'Open the creator’s page → Profile tab → scroll to Reference Kit.',
				'Click ⚡ Generate all remaining. The kit builds in order — full body, side profiles, close-up, feature grid.',
				'Each tile takes a minute or two and runs in the background; a ✓ appears as each completes.',
				'That’s it — every future image and video uses these to keep the same face.'
			],
			tip: 'You can also upload a real reference photo (Upload Reference Photo) to base the creator’s look on it.'
		},
		{
			id: 'voice',
			category: 'Creating content',
			title: 'Choose a creator’s voice',
			when: 'You want to hear or change how a creator sounds in videos.',
			steps: [
				'Open the creator’s page → Profile tab → Voice.',
				'Press play to preview the current voice.',
				'Pick a different one from the list if it doesn’t fit — voices are matched to the creator, and no two creators sound alike.',
				'Save the profile. New videos use the new voice.'
			]
		},

		// ── Publishing ───────────────────────────────────────────────────────
		{
			id: 'connect-account',
			category: 'Publishing',
			title: 'Connect a social account',
			when: 'A creator’s approved posts should start going to a real account.',
			steps: [
				'Open the creator’s page → Profile tab → switch the view from Overview to Connections.',
				'Click + Connect on the platform (Instagram, TikTok, YouTube… 15 supported).',
				'Log in to the account in the window that opens — a normal social-media login, nothing technical.',
				'A green badge appears. From now on, this creator’s approved posts publish there automatically.'
			],
			tip: 'You can approve drafts before connecting — they simply wait, and publish once an account exists.'
		},
		{
			id: 'schedule-autonomy',
			category: 'Publishing',
			title: 'Set the posting schedule & autonomy',
			when: 'You want to control how often and when a creator posts.',
			steps: [
				'Open the creator’s page → Profile tab.',
				'Set Posts per day and the posting window (e.g. 8am–8pm) — posts spread across the window automatically.',
				'Set the Timezone: posts go out on the creator’s local clock, so match it to the audience.',
				'Autonomy: Semi-Autonomous (recommended) = drafts wait for your approval. Fully Autonomous = posts publish without review — the app asks you to confirm before switching.',
				'Save. The schedule starts filling from the next cycle.'
			]
		},
		{
			id: 'confirm-live',
			category: 'Publishing',
			title: 'Confirm a post is really live',
			when: 'A post’s time has passed and you want proof it published.',
			steps: [
				'Open the post (Calendar or the creator’s Content tab).',
				'For a minute or two it reads Publishing… — sent, waiting for the platform to confirm.',
				'When the platform confirms, it flips to Published with a View live post ↗ link.',
				'Click the link — it opens the actual post on the actual account. PersonaGen never says Published until the platform itself confirms.'
			]
		},
		{
			id: 'reschedule',
			category: 'Publishing',
			title: 'Move or edit a scheduled post',
			when: 'A post is queued for the wrong day or needs a caption change.',
			steps: [
				'Open Calendar and click the post.',
				'Change the date/time in the panel and hit Reschedule — or click the ✎ to edit the caption (works right up to publish time).',
				'Close the panel. The calendar updates immediately.'
			]
		},
		{
			id: 'delete-live',
			category: 'Publishing',
			title: 'Take down a published post',
			when: 'Something went out that you want removed.',
			steps: [
				'Open the post and click Delete.',
				'Platforms that allow removal by software are taken down automatically.',
				'Instagram doesn’t allow apps to delete posts — for those the panel shows the direct link: open the post on Instagram → ⋯ → Delete. Ten seconds.'
			]
		},

		// ── Fixing problems ──────────────────────────────────────────────────
		{
			id: 'generation-failing',
			category: 'Fixing problems',
			title: 'Content generation keeps failing',
			when: 'Drafts error out, or the composer shows a failure message.',
			steps: [
				'Read the message — it names the real cause (the app never hides errors).',
				'Mentions "openrouter", "402", or "credits" → your writing credits ran out. Follow the OpenRouter key guide in Keys & credits.',
				'Mentions "fal" or images/video failing → check the Fal AI key in Settings → API Keys (status should read Valid) and your fal.ai balance.',
				'Says "No AI provider configured" → add an OpenRouter or Gemini key in Settings.',
				'Fixed the cause? Just generate again — nothing is lost.'
			]
		},
		{
			id: 'publish-failing',
			category: 'Fixing problems',
			title: 'A post shows Failed instead of Published',
			when: 'A scheduled post didn’t go out.',
			steps: [
				'Open the post — the exact reason is written on it, per platform.',
				'Most common: the account needs re-linking. Go to the creator’s Profile → Connections — a Reconnect badge marks the broken account; one click and a login fixes it.',
				'Then approve/retry the post. Posts that failed for a temporary reason (network hiccup) retry themselves automatically.'
			],
			tip: 'A Partial label on a multi-platform post means some platforms succeeded — only the listed ones failed.'
		},
		{
			id: 'status-glossary',
			category: 'Fixing problems',
			title: 'What every label means',
			when: 'You see a label on a post and want to know if action is needed.',
			steps: [
				'Generating — being created right now. Do nothing; it appears when ready.',
				'Draft — waiting for you in the Review Queue. Approve, edit, or reject.',
				'Scheduled — approved; goes out at its time slot. Nothing to do, or reschedule it.',
				'Publishing… — sent; waiting for the platform to confirm. Flips within minutes.',
				'Published — confirmed live; View live post opens the real thing.',
				'Partial — landed on some platforms, not others; open it to see each reason.',
				'Failed — didn’t go out; the post shows exactly why. Fix that, then retry.',
				'Rejected — you said no in review; a new draft replaces it.'
			],
			tip: 'One promise throughout: no label ever claims more than the platform has confirmed, and nothing fails silently.'
		}
	];

	// ── Selection + search ───────────────────────────────────────────────────
	let selectedId = $state(GUIDES[0].id);
	let query = $state('');

	let filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return GUIDES;
		return GUIDES.filter(
			(g) =>
				g.title.toLowerCase().includes(q) ||
				g.when.toLowerCase().includes(q) ||
				g.steps.some((s) => s.toLowerCase().includes(q))
		);
	});
	let selected = $derived(GUIDES.find((g) => g.id === selectedId) ?? GUIDES[0]);

	function pick(id: string) {
		selectedId = id;
		// Deep-linkable: support /guides#openrouter-key style links for support.
		history.replaceState(null, '', `#${id}`);
		document.getElementById('guide-article')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	onMount(() => {
		const hash = location.hash.replace('#', '');
		if (hash && GUIDES.some((g) => g.id === hash)) selectedId = hash;
	});
</script>

<svelte:head>
	<title>Guides — PersonaGen</title>
</svelte:head>

<div class="guides-page">
	<header class="guides-header">
		<h1>Guides</h1>
		<p>
			How to do everything in PersonaGen — step by step, in plain language. Pick a guide, follow the
			numbers.
		</p>
		<input
			type="search"
			placeholder="Search guides… (try: credits, connect, voice)"
			bind:value={query}
			aria-label="Search guides"
		/>
	</header>

	<div class="guides-body">
		<nav class="guides-index" aria-label="Guide list">
			{#each CATEGORIES as cat}
				{@const inCat = filtered.filter((g) => g.category === cat)}
				{#if inCat.length > 0}
					<div class="index-group">
						<span class="index-cat">{cat}</span>
						{#each inCat as g (g.id)}
							<button
								type="button"
								class="index-item"
								class:active={g.id === selectedId}
								onclick={() => pick(g.id)}
							>
								{g.title}
							</button>
						{/each}
					</div>
				{/if}
			{/each}
			{#if filtered.length === 0}
				<p class="index-empty">No guides match “{query}”.</p>
			{/if}
		</nav>

		<article class="guide-article" id="guide-article" aria-live="polite">
			<span class="article-cat">{selected.category}</span>
			<h2>{selected.title}</h2>
			<p class="article-when"><b>You need this when:</b> {selected.when}</p>
			<ol class="article-steps">
				{#each selected.steps as step}
					<li>{step}</li>
				{/each}
			</ol>
			{#if selected.tip}
				<p class="article-tip">💡 {selected.tip}</p>
			{/if}
		</article>
	</div>
</div>

<style>
	.guides-page {
		max-width: 1060px;
		margin: 0 auto;
		padding: 1.5rem 1.25rem 4rem;
	}
	.guides-header h1 {
		font-size: 1.6rem;
		font-weight: 700;
		color: var(--text);
		margin: 0 0 0.25rem;
	}
	.guides-header p {
		color: var(--text-muted);
		margin: 0 0 1rem;
		max-width: 60ch;
	}
	.guides-header input {
		width: 100%;
		max-width: 420px;
		padding: 0.55rem 0.9rem;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.92rem;
	}
	.guides-header input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	.guides-body {
		display: grid;
		grid-template-columns: 280px 1fr;
		gap: 1.5rem;
		margin-top: 1.5rem;
		align-items: start;
	}
	@media (max-width: 800px) {
		.guides-body {
			grid-template-columns: 1fr;
		}
	}

	.guides-index {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		position: sticky;
		top: 1rem;
	}
	@media (max-width: 800px) {
		.guides-index {
			position: static;
		}
	}
	.index-group {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.index-cat {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-dim);
		padding: 0 0.6rem 0.3rem;
	}
	.index-item {
		text-align: left;
		border: none;
		background: none;
		color: var(--text-muted);
		font-size: 0.9rem;
		padding: 0.42rem 0.6rem;
		border-radius: 7px;
		cursor: pointer;
		line-height: 1.35;
	}
	.index-item:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.index-item.active {
		background: var(--accent-soft);
		color: var(--text);
		font-weight: 600;
	}
	.index-item:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.index-empty {
		color: var(--text-dim);
		font-size: 0.9rem;
		padding: 0 0.6rem;
	}

	.guide-article {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1.5rem 1.75rem 1.75rem;
	}
	.article-cat {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.guide-article h2 {
		font-size: 1.3rem;
		font-weight: 700;
		color: var(--text);
		margin: 0.3rem 0 0.6rem;
	}
	.article-when {
		color: var(--text-muted);
		font-size: 0.95rem;
		margin: 0 0 1.1rem;
		padding: 0.6rem 0.9rem;
		background: var(--surface-2);
		border-radius: 8px;
	}
	.article-when b {
		color: var(--text);
	}

	.article-steps {
		margin: 0;
		padding: 0;
		list-style: none;
		counter-reset: gstep;
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}
	.article-steps li {
		counter-increment: gstep;
		position: relative;
		padding-left: 2.4rem;
		color: var(--text);
		font-size: 0.96rem;
		line-height: 1.55;
	}
	.article-steps li::before {
		content: counter(gstep);
		position: absolute;
		left: 0;
		top: 0.05rem;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 0.82rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.article-tip {
		margin: 1.2rem 0 0;
		padding: 0.7rem 1rem;
		background: var(--surface-2);
		border-left: 3px solid var(--accent);
		border-radius: 0 8px 8px 0;
		color: var(--text-muted);
		font-size: 0.92rem;
	}
</style>
