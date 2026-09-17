<script lang="ts">
	/**
	 * Marketing landing page — the product's front door.
	 *
	 * Structure follows the "Comparison Table Focus" landing pattern, and the
	 * comparison matrix sits high rather than at the bottom. The wedge in this
	 * category is not "we generate a face" (three funded competitors do that too)
	 * but "we run the account afterwards", and that only lands as a side-by-side.
	 *
	 * Deliberately built on the app's own design tokens rather than a separate
	 * marketing palette, so the page a visitor sees and the product they sign into
	 * are visibly the same object.
	 *
	 * Proof on this page is PRODUCT proof — real generated personas, the approval
	 * queue, the verified-publish receipt, the quoted price — never invented
	 * testimonials or customer logos. Every money and product claim here is
	 * bound to the code by money-claims.spec.ts and product-claims.spec.ts, and
	 * every price shown is the one economics.spec.ts proves.
	 *
	 * Signed-in visitors never see this — they are sent straight to the dashboard.
	 */
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let { data } = $props();

	// Authenticated users get the app, not the pitch. `replaceState` keeps the
	// landing page out of their history so Back doesn't bounce them through it.
	$effect(() => {
		if (data?.session) goto('/dashboard', { replaceState: true });
	});

	/**
	 * Scroll-reveal: SSR renders everything visible; the action only ever ADDS
	 * a `data-reveal` marker after hydration, so a no-JS visitor (or a crawler)
	 * never sees a blank section. Reduced-motion users get no transform at all.
	 */
	function reveal(node: HTMLElement, delay = 0) {
		if (typeof IntersectionObserver === 'undefined') return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		node.dataset.reveal = '';
		node.style.setProperty('--reveal-delay', `${delay}ms`);
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) {
						node.classList.add('is-in');
						io.disconnect();
					}
				}
			},
			{ rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
		);
		io.observe(node);
		return { destroy: () => io.disconnect() };
	}

	let scrolled = $state(false);
	let menuOpen = $state(false);
	// Phones fold each plan's feature list behind a summary; SSR renders it open.
	let compactPlans = $state(false);
	onMount(() => {
		const onScroll = () => (scrolled = window.scrollY > 8);
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		const mq = window.matchMedia('(max-width: 720px)');
		const onMq = () => (compactPlans = mq.matches);
		onMq();
		mq.addEventListener('change', onMq);
		return () => {
			window.removeEventListener('scroll', onScroll);
			mq.removeEventListener('change', onMq);
		};
	});
	// The open menu locks the page behind its scrim, like a sheet.
	$effect(() => {
		if (typeof document === 'undefined') return;
		document.body.style.overflow = menuOpen ? 'hidden' : '';
		return () => {
			document.body.style.overflow = '';
		};
	});

	const NAV = [
		{ href: '#how', label: 'How it works' },
		{ href: '#compare', label: 'Compare' },
		{ href: '#pricing', label: 'Pricing' },
		{ href: '#faq', label: 'FAQ' }
	];

	const PLATFORMS: Array<{ name: string; hue: string }> = [
		{ name: 'Instagram', hue: '#e1306c' },
		{ name: 'TikTok', hue: '#69c9d0' },
		{ name: 'YouTube', hue: '#ff0000' },
		{ name: 'Facebook', hue: '#1877f2' },
		{ name: 'X', hue: '#71767b' },
		{ name: 'Threads', hue: '#8a8a8a' },
		{ name: 'LinkedIn', hue: '#0a66c2' },
		{ name: 'Bluesky', hue: '#1185fe' },
		{ name: 'Pinterest', hue: '#e60023' },
		{ name: 'Reddit', hue: '#ff4500' },
		{ name: 'Google Business', hue: '#4285f4' },
		{ name: 'Telegram', hue: '#26a5e4' },
		{ name: 'Snapchat', hue: '#e6c800' }
	];

	const PROOF = [
		{ value: '13', label: 'platforms — every publish verified by the platform', short: 'platforms, every publish verified' },
		{ value: '5', label: 'reference stages lock one face for good', short: 'stages lock one face' },
		{ value: '$0.32', label: 'for an image post, quoted before you confirm', short: 'an image post, quoted upfront' },
		{ value: '3', label: 'autonomy levels, from manual to unattended', short: 'autonomy levels' }
	];

	const STEPS = [
		{
			n: '01',
			title: 'Pick the traits',
			time: '~30 sec',
			body: 'Guided fields with real options. Set the ones that matter and leave the rest on Best Fit — no prompt writing.'
		},
		{
			n: '02',
			title: 'Generate the look',
			time: '30 sec – 2 min',
			// The portrait is a detached job that chains several model calls — the
			// endpoint's own estimate is "30s–minutes" (generate-avatar/+server.ts).
			// An 8-second claim here was quoting a number nothing measured.
			body: 'A photoreal render built from the traits you set rather than a prompt you wrote. Regenerate it until the face is right.'
		},
		{
			n: '03',
			title: 'Lock the identity',
			time: 'Yours forever',
			body: 'A five-stage reference set locks the face, so it is the same person in every photo, video and clip you ship.'
		},
		{
			n: '04',
			title: 'Ground it in your brand',
			time: '~60 sec',
			body: 'Point it at your store. It reads your products, prices and photos, and writes around them.'
		},
		{
			n: '05',
			title: 'Connect and set autonomy',
			time: '~90 sec',
			body: 'Link the accounts and pick a level per persona. Advisor stays manual; the rest run to your cadence.'
		}
	];

	const SHEET = [
		{ label: 'Wide', pos: '50% 12%', zoom: 1.15 },
		{ label: 'Product hold', pos: '50% 62%', zoom: 1 },
		{ label: 'Three-quarter', pos: '26% 20%', zoom: 1.8 },
		{ label: 'Close-up', pos: '55% 20%', zoom: 2.4 },
		{ label: 'Detail grid', pos: '55% 20%', zoom: 2.4, grid: true }
	];

	const COMPARISON = [
		{ label: 'Consistent face across every post', studio: true, scheduler: 'partial', us: true },
		{ label: 'Video with lip-sync', studio: true, scheduler: true, us: true },
		{ label: 'Knows your products', studio: false, scheduler: false, us: true },
		{ label: 'Publishes for you', studio: false, scheduler: '1 platform', us: '13 platforms' },
		{ label: 'Confirms it actually published', studio: false, scheduler: false, us: true },
		{ label: 'You approve before it posts', studio: false, scheduler: false, us: true },
		{ label: 'Runs on a schedule, unattended', studio: false, scheduler: false, us: true },
		{ label: 'Shows you the real cost', studio: false, scheduler: 'points', us: 'money, in your currency' },
		{ label: 'Ends at', studio: 'a download', scheduler: 'Instagram', us: 'your analytics' }
	];

	const CAST = [
		{ n: 1, name: 'Ana', platform: 'LinkedIn' },
		{ n: 5, name: 'Mara', platform: 'Instagram' },
		{ n: 9, name: 'Jonah', platform: 'TikTok' },
		{ n: 3, name: 'Lena', platform: 'Pinterest' },
		{ n: 7, name: 'Theo', platform: 'YouTube' },
		{ n: 4, name: 'Nico', platform: 'Threads' }
	].map((c) => ({ ...c, src: `/assets/personas/persona-${c.n}-720.webp` }));

	const QUEUE = [
		{ src: CAST[1].src, name: 'Mara', platform: 'Instagram', format: 'Reel · 12s', price: '$1.58', state: 'waiting' },
		{ src: CAST[2].src, name: 'Jonah', platform: 'TikTok', format: 'Talking head · 15s', price: '$2.51', state: 'waiting' },
		{ src: CAST[0].src, name: 'Ana', platform: 'LinkedIn', format: 'Image post', price: '$0.32', state: 'published' }
	];

	const PRODUCTS = [
		{ src: CAST[1].src, pos: '22% 62%', name: 'Manly Plus · 450g', meta: 'price, 6 photos, label copy' },
		{ src: CAST[0].src, pos: '28% 60%', name: 'Manly Plus · 200g', meta: 'price, 4 photos, label copy' },
		{ src: CAST[2].src, pos: '30% 55%', name: 'Men’s honey range', meta: 'category page, 3 products' }
	];

	const PLANS = [
		{
			name: 'Free',
			price: '0',
			blurb: 'Try it with no card.',
			features: [
				'One free generation credit per person to start',
				'Unlimited text posts',
				'All 13 platforms',
				'Approval queue + verified publishing',
				'Every price quoted before you confirm',
				'Pay only for what you generate, at par'
			],
			cta: 'Start free',
			href: '/signup',
			featured: false
		},
		{
			name: 'Studio',
			price: '79',
			blurb: 'For one brand finding its footing.',
			features: [
				'3 personas',
				'$40 / month of media generation included',
				'Unlimited text posts',
				'All 13 platforms',
				'1 brand brief',
				'Advisor + Semi-autonomous',
				'Standard video + lip-sync'
			],
			cta: 'Choose Studio',
			href: '/billing?plan=studio',
			featured: false
		},
		{
			name: 'Brand',
			price: '299',
			blurb: 'The account actually runs itself.',
			features: [
				'10 personas',
				'$180 / month of media generation included',
				'Unlimited text posts',
				'All 13 platforms',
				'3 brand briefs',
				'All three autonomy levels',
				'Cinematic multi-shot + talking head',
				'Spend ledger + verified publishing',
				'Approval queue'
			],
			cta: 'Choose Brand',
			href: '/billing?plan=brand',
			featured: true
		},
		{
			name: 'Agency',
			price: '899',
			blurb: 'Many brands, one console.',
			features: [
				'Unlimited personas',
				'$600 / month of media generation included',
				'Unlimited text posts',
				'All 13 platforms',
				'Unlimited brand briefs',
				'Priority generation queue',
				'Teams + shared workspaces',
				'Bring your own keys — generation at no charge',
				'API access + dedicated manager'
			],
			cta: 'Talk to us',
			href: '/billing?plan=agency',
			featured: false
		}
	];

	const RECEIPT = [
		{ item: 'Text post', note: 'two LLM passes, no image charge', price: '≈ $0.08' },
		{ item: 'Image post', note: 'one photoreal still', price: '$0.32' },
		{ item: 'Video post', note: 'short clip with lip-sync', price: '$1.58' },
		{ item: 'Talking head', note: 'scripted, voiced, lip-synced', price: '$2.51' }
	];

	const FAQS = [
		{
			q: 'How does the media wallet work?',
			a: 'Every plan includes a monthly wallet for AI images, video and voice, shown as money in your currency. A text post only pays for the writing — about eight cents — so a persona posting six times a day spends around fifty cents, against roughly $2.40 for a video post. Every generation shows its price before you confirm. Run low and you top up at par: $25 buys $25.00 of generation, and it never expires.'
		},
		{
			q: 'How does the identity actually stay consistent?',
			a: 'When you lock a persona we generate a five-stage reference set — a character sheet, full body, side profiles, a facial close-up and a feature grid. Every later image is conditioned on that set rather than on a prompt describing the face.'
		},
		{
			q: 'Which platforms are live today?',
			a: 'All thirteen listed above are connected and publishing. Instagram, TikTok and Snapchat do not permit deletion through any API — we say so in the app and hand you the permalink rather than pretending the post is gone.'
		},
		{
			q: 'Are AI personas allowed on these platforms?',
			a: 'Rules differ by platform and are tightening. Our position is that disclosure is the durable strategy, not stealth. Every generation offers a one-tap “AI GENERATED” badge burned into the video — off by default, yours to set per post, and never switched on for you by an unattended autopilot run. Turn it on where a platform expects it: we would rather you pass a review than win a week.'
		},
		{
			q: 'Do I own what it makes?',
			a: 'Yes. Full commercial rights to everything generated under your account.'
		},
		{
			q: 'What happens if a generation fails?',
			a: 'The slot retries a bounded number of times, then stops with a visible reason instead of retrying forever and billing you for it. Your other personas keep running.'
		}
	];

	const year = new Date().getFullYear();
</script>

<svelte:head>
	<title>PersonaGen — AI Personas That Run Your Accounts</title>
	<meta
		name="description"
		content="Create AI personas with a locked face and voice, ground them in your real products, and let them publish to 13 platforms on their own — with you approving every post."
	/>
	<link rel="preload" as="image" href="/assets/personas/persona-5-720.webp" fetchpriority="high" />
</svelte:head>

{#snippet check()}
	<svg viewBox="0 0 24 24" aria-hidden="true"
		><path
			d="M20 6L9 17l-5-5"
			fill="none"
			stroke="currentColor"
			stroke-width="2.5"
			stroke-linecap="round"
			stroke-linejoin="round"
		/></svg
	>
{/snippet}

{#snippet bolt()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" aria-hidden="true"
		><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg
	>
{/snippet}

{#snippet icon(name: string)}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="1.8"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		{#if name === 'shield'}
			<path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" />
		{:else if name === 'inbox'}
			<path d="M4 4h16v16H4z" /><path d="M4 14h4l2 3h4l2-3h4" />
		{:else if name === 'switch'}
			<rect x="3" y="7" width="18" height="10" rx="5" /><circle cx="15" cy="12" r="3" />
		{:else if name === 'menu'}
			<path d="M4 7h16M4 12h16M4 17h16" />
		{:else if name === 'close'}
			<path d="M6 6l12 12M18 6L6 18" />
		{/if}
	</svg>
{/snippet}

<div class="lp">
	<header class="lp-nav" class:is-scrolled={scrolled || menuOpen}>
		<a class="lp-brand" href="/">
			<span class="lp-brand-mark" aria-hidden="true">{@render bolt()}</span>
			PersonaGen
		</a>
		<nav class="lp-nav-links" class:is-open={menuOpen} aria-label="Main" id="lp-menu">
			{#each NAV as n (n.href)}
				<a href={n.href} onclick={() => (menuOpen = false)}>{n.label}</a>
			{/each}
			<a class="lp-nav-links-login" href="/login">Log in</a>
		</nav>
		<div class="lp-nav-cta">
			<a class="lp-link" href="/login">Log in</a>
			<a class="lp-btn lp-btn-sm" href="/signup">Start free</a>
			<button
				type="button"
				class="lp-menu-btn"
				aria-expanded={menuOpen}
				aria-controls="lp-menu"
				aria-label={menuOpen ? 'Close menu' : 'Open menu'}
				onclick={() => (menuOpen = !menuOpen)}
			>
				{@render icon(menuOpen ? 'close' : 'menu')}
			</button>
		</div>
	</header>
	{#if menuOpen}
		<button type="button" class="lp-scrim" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>
	{/if}

	<section class="lp-hero">
		<div class="lp-hero-bg" aria-hidden="true">
			<span class="lp-orb lp-orb-a"></span>
			<span class="lp-orb lp-orb-b"></span>
		</div>
		<div class="lp-hero-inner">
			<div class="lp-hero-top">
				<p class="lp-eyebrow">
					<span class="lp-eyebrow-dot" aria-hidden="true"></span>
					<span class="lp-eyebrow-long">The AI persona platform that runs the account</span>
					<span class="lp-eyebrow-short">Runs the account, not just the face</span>
				</p>
				<h1>
					Your AI personas.<br />
					<span class="lp-grad">Posting on 13 platforms.</span><br />
					While you sleep.
				</h1>
				<p class="lp-sub">
					Photoreal personas with a locked face, grounded in your real products. They generate,
					schedule and publish. You approve every post and see every dollar.
				</p>
				<div class="lp-hero-cta">
					<a class="lp-btn lp-btn-lg" href="/signup">
						Create your first persona<span class="lp-btn-tail"> — free</span>
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><path
								d="M5 12h14M13 6l6 6-6 6"
								fill="none"
								stroke="currentColor"
								stroke-width="2.2"
								stroke-linecap="round"
								stroke-linejoin="round"
							/></svg
						>
					</a>
					<a class="lp-link-arrow" href="#how">See how it works</a>
				</div>
			</div>

			<div class="lp-stage" aria-label="A persona, its approval card and its verified publish">
				<figure class="lp-card lp-card-main">
					<img
						src="/assets/personas/persona-5-720.webp"
						width="720"
						height="720"
						alt="A generated persona holding a jar of the brand’s honey in a park — the same face every post"
						fetchpriority="high"
						decoding="async"
					/>
					<figcaption class="lp-card-tag">
						<span class="lp-tag-dot" aria-hidden="true"></span>
						<span class="lp-tag-long">Locked identity</span><span class="lp-tag-short">Locked</span>
					</figcaption>
				</figure>
				<figure class="lp-card lp-card-left">
					<img
						src="/assets/personas/persona-1-720.webp"
						width="720"
						height="720"
						alt="A second persona from the same brand, photographed outdoors"
						loading="lazy"
						decoding="async"
					/>
				</figure>
				<figure class="lp-card lp-card-right">
					<img
						src="/assets/personas/persona-9-720.webp"
						width="720"
						height="720"
						alt="A third persona in a gym, holding the product"
						loading="lazy"
						decoding="async"
					/>
				</figure>

				<div class="lp-chip lp-chip-verified">
					<span class="lp-chip-icon lp-chip-icon-ok">{@render check()}</span>
					<span class="lp-chip-body">
						<strong>Published · Instagram</strong>
						<span>Verified by the platform · 09:41</span>
					</span>
				</div>

				<div class="lp-chip lp-chip-approve">
					<span class="lp-chip-body">
						<strong>Awaiting your approval</strong>
						<span>Reel · 12s · quoted <span class="lp-num">$1.58</span></span>
					</span>
					<span class="lp-chip-actions" aria-hidden="true">
						<span class="lp-chip-btn lp-chip-btn-primary">Approve</span>
						<span class="lp-chip-btn">Edit</span>
					</span>
				</div>

				<div class="lp-chip lp-chip-price">
					<span class="lp-chip-price-num lp-num">$0.32</span>
					<span class="lp-chip-body">
						<strong>Image post</strong>
						<span>Shown before you confirm</span>
					</span>
				</div>
			</div>

			<ul class="lp-ticks" aria-label="What starting costs you">
				<li>{@render check()}No credit card</li>
				<li>{@render check()}First persona live in about four minutes</li>
				<li>{@render check()}Cancel any time</li>
			</ul>
		</div>
	</section>

	<section class="lp-strip" aria-label="Supported platforms">
		<div class="lp-strip-inner">
			<p class="lp-strip-label">Publishes and verifies on</p>
			<ul class="lp-strip-list">
				{#each PLATFORMS as p (p.name)}
					<li><span class="lp-strip-dot" style="--hue: {p.hue}" aria-hidden="true"></span>{p.name}</li>
				{/each}
			</ul>
		</div>
	</section>

	<section class="lp-proof" aria-label="Product facts">
		<dl class="lp-proof-grid">
			{#each PROOF as p, i (p.label)}
				<div class="lp-proof-item" use:reveal={i * 60}>
					<dt class="lp-num">{p.value}</dt>
					<dd><span class="lp-proof-long">{p.label}</span><span class="lp-proof-short">{p.short}</span></dd>
				</div>
			{/each}
		</dl>
	</section>

	<section class="lp-section" id="how">
		<div class="lp-section-head" use:reveal>
			<p class="lp-kicker">How it works</p>
			<h2>From nothing to a running account in five steps.</h2>
			<p class="lp-section-sub">
				Most tools stop after step three. Steps four and five are the reason the account actually
				grows.
			</p>
		</div>
		<ol class="lp-steps">
			{#each STEPS as s, i (s.n)}
				<li class="lp-step" class:lp-step-ours={i >= 3} use:reveal={i * 70}>
					{#if i >= 3}<span class="lp-only">Only here</span>{/if}
					<span class="lp-step-n">{s.n}</span>
					<div class="lp-step-body">
						<span class="lp-step-time">{s.time}</span>
						<h3>{s.title}</h3>
						<p>{s.body}</p>
					</div>
				</li>
			{/each}
		</ol>
	</section>

	<section class="lp-section lp-section-alt" id="compare">
		<div class="lp-section-head" use:reveal>
			<p class="lp-kicker">The whole picture</p>
			<h2>Everyone else sells you a face.</h2>
			<p class="lp-section-sub">
				Generation studios end at a download button. Schedulers post to one platform. Here is the
				whole picture, plainly.
			</p>
		</div>
		<div class="lp-table-wrap" use:reveal>
			<table class="lp-table">
				<thead>
					<tr>
						<th scope="col"><span class="sr-only">Capability</span></th>
						<th scope="col">Generation studios</th>
						<th scope="col">Schedulers</th>
						<th scope="col" class="lp-th-ours">
							<span class="lp-th-ours-mark" aria-hidden="true">{@render bolt()}</span>
							PersonaGen
						</th>
					</tr>
				</thead>
				<tbody>
					{#each COMPARISON as row (row.label)}
						<tr>
							<th scope="row">{row.label}</th>
							{#each [['Generation studios', 'Studios', row.studio], ['Schedulers', 'Schedulers', row.scheduler]] as [col, short, cell] (col)}
								<td data-col={short}>
									{#if cell === true}
										<span class="lp-yes">{@render check()}<span class="sr-only">Yes</span></span>
									{:else if cell === false}
										<span class="lp-no" aria-hidden="true">—</span><span class="sr-only">No</span>
									{:else}
										<span class="lp-partial">{cell}</span>
									{/if}
								</td>
							{/each}
							<td class="lp-td-ours" data-col="PersonaGen">
								{#if row.us === true}
									<span class="lp-yes lp-yes-strong">{@render check()}<span class="sr-only">Yes</span></span>
								{:else}
									<strong>{row.us}</strong>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="lp-mid-cta" use:reveal>
			<a class="lp-btn" href="/signup">Start free</a>
			<span class="lp-mid-cta-note">No credit card. Your first persona in about four minutes.</span>
		</div>
	</section>

	<section class="lp-section" id="features">
		<div class="lp-section-head lp-section-head-split" use:reveal>
			<div>
				<p class="lp-kicker">What you actually get</p>
				<h2>Built to run the account, not just draw the face.</h2>
			</div>
			<p class="lp-section-sub">
				A locked identity, a roster that stays distinct, and a persona that has read your catalogue
				before it writes a word.
			</p>
		</div>
		<div class="lp-features">
			<figure class="lp-feature lp-feature-sheet" use:reveal>
				<div class="lp-sheet" aria-hidden="true">
					{#each SHEET as t, i (t.label)}
						<div class="lp-sheet-tile" class:lp-sheet-grid={t.grid}>
							{#if t.grid}
								{#each ['52% 14%', '62% 20%', '48% 26%', '56% 32%'] as pos (pos)}
									<img
										src="/assets/personas/persona-5-720.webp"
										width="720"
										height="720"
										alt=""
										loading="lazy"
										decoding="async"
										style="object-position: {pos}; transform: scale(3.4);"
									/>
								{/each}
							{:else}
								<img
									src="/assets/personas/persona-5-720.webp"
									width="720"
									height="720"
									alt=""
									loading="lazy"
									decoding="async"
									style="object-position: {t.pos}; transform: scale({t.zoom}); transform-origin: {t.pos};"
								/>
							{/if}
							<span class="lp-sheet-label" title={t.label}>0{i + 1}</span>
						</div>
					{/each}
					<span class="lp-sheet-lock">
						<span class="lp-tag-dot"></span>
						Locked
					</span>
				</div>
				<figcaption>
					<h3>One face. Ten thousand posts.</h3>
					<p>
						A five-stage reference set — character sheet, full body, side profiles, close-up,
						feature grid — locks the identity. Not a prompt that hopes. An identity that holds.
					</p>
					<p class="lp-sheet-note">One locked persona, five crops:</p>
					<ol class="lp-sheet-legend">
						{#each SHEET as t, i (t.label)}<li><b>0{i + 1}</b>{t.label}</li>{/each}
					</ol>
				</figcaption>
			</figure>

			<article class="lp-feature" use:reveal={80}>
				<div class="lp-seg" aria-hidden="true">
					<span>Advisor</span>
					<span class="is-on">Semi-autonomous</span>
					<span>Fully autonomous</span>
				</div>
				<h3>Three levels of autonomy. Your call.</h3>
				<p>
					Advisor is manual — nothing runs unattended; you generate on demand. Semi-autonomous
					drafts and waits for you. Fully autonomous runs inside your guardrails. Per persona,
					changeable any time.
				</p>
			</article>

			<figure class="lp-feature lp-feature-cast" use:reveal>
				<ul class="lp-cast" aria-hidden="true">
					{#each CAST as c, i (c.src)}
						<li style="--i: {i}">
							<img src={c.src} width="720" height="720" alt="" loading="lazy" decoding="async" />
							<span class="lp-cast-name">{c.name}</span>
							<span class="lp-cast-platform">{c.platform}</span>
						</li>
					{/each}
				</ul>
				<figcaption>
					<h3>No two personas look alike.</h3>
					<p>
						Every new persona is generated with your whole roster in view — look, angle, audience
						— so it lands somewhere different. You build a cast, not ten variations of one face.
					</p>
				</figcaption>
			</figure>

			<article class="lp-feature" use:reveal={80}>
				<ul class="lp-products" aria-hidden="true">
					{#each PRODUCTS as p (p.name)}
						<li>
							<span class="lp-products-thumb"><img src={p.src} width="720" height="720" alt="" loading="lazy" decoding="async" style="object-position: {p.pos}" /></span>
							<span><strong>{p.name}</strong><span>{p.meta}</span></span>
							<span class="lp-products-ok">{@render check()}</span>
						</li>
					{/each}
				</ul>
				<h3>It knows your actual business.</h3>
				<p>
					Point it at your store. It reads your products, prices and photos, so every persona’s
					content is built around what you actually sell.
				</p>
			</article>
		</div>
	</section>

	<section class="lp-section lp-section-alt lp-trust">
		<div class="lp-section-head" use:reveal>
			<p class="lp-kicker">Accountability</p>
			<h2>Built for brands that answer for what they post.</h2>
		</div>
		<div class="lp-trust-layout">
			<div class="lp-frame" use:reveal aria-label="The approval queue, as it looks in the app">
				<div class="lp-frame-bar">
					<span class="lp-frame-dots" aria-hidden="true"><i></i><i></i><i></i></span>
					<span class="lp-frame-title">Approval queue</span>
					<span class="lp-frame-count">2 waiting</span>
				</div>
				<ul class="lp-queue">
					{#each QUEUE as q (q.name)}
						<li class="lp-queue-row" class:is-done={q.state === 'published'}>
							<img src={q.src} width="720" height="720" alt="" loading="lazy" decoding="async" />
							<span class="lp-queue-who">
								<strong>{q.name} · {q.platform}</strong>
								<span>{q.format} · <span class="lp-num">{q.price}</span> quoted</span>
							</span>
							{#if q.state === 'waiting'}
								<span class="lp-chip-actions" aria-hidden="true">
									<span class="lp-chip-btn lp-chip-btn-primary">Approve</span>
									<span class="lp-chip-btn">Edit</span>
								</span>
							{:else}
								<span class="lp-queue-done">
									<span class="lp-chip-icon lp-chip-icon-ok">{@render check()}</span>
									Published · verified 09:41
								</span>
							{/if}
						</li>
					{/each}
				</ul>
				<div class="lp-frame-foot">
					<span class="lp-frame-toggle" aria-hidden="true"><i></i></span>
					<span>“AI GENERATED” badge: off. One tap to burn in.</span>
				</div>
			</div>

			<ul class="lp-trust-list">
				<li use:reveal={60}>
					<span class="lp-feature-icon">{@render icon('inbox')}</span>
					<div>
						<h3>Approved before it goes out.</h3>
						<p>
							Every post waits in your queue for a yes unless you say otherwise. Any persona can be
							pulled back to manual in one click.
						</p>
					</div>
				</li>
				<li use:reveal={120}>
					<span class="lp-feature-icon">{@render icon('shield')}</span>
					<div>
						<h3>Verified against the platform.</h3>
						<p>
							A post is only marked published when the platform confirms it. If a platform cannot
							delete by API, we say so and hand you the permalink.
						</p>
					</div>
				</li>
				<li use:reveal={180}>
					<span class="lp-feature-icon">{@render icon('switch')}</span>
					<div>
						<h3>Disclosure is a switch you hold.</h3>
						<p>
							One tap on any generation burns an “AI GENERATED” badge into the video. It is off
							until you turn it on, and an unattended autopilot run will not turn it on for you.
							Disclosure rules are arriving. We shipped the switch before they did.
						</p>
					</div>
				</li>
			</ul>
		</div>
	</section>

	<section class="lp-section" id="pricing">
		<div class="lp-section-head lp-section-head-split" use:reveal>
			<div>
				<p class="lp-kicker">Pricing</p>
				<h2>Priced per brand. Not per seat.</h2>
			</div>
			<p class="lp-section-sub">
				Every account starts free. Paid plans add a monthly media wallet and unlimited text posts.
			</p>
		</div>
		<div class="lp-plans">
			{#each PLANS as p, i (p.name)}
				<article class="lp-plan" class:featured={p.featured} use:reveal={i * 70}>
					{#if p.featured}<span class="lp-plan-badge">Most popular</span>{/if}
					<h3>{p.name}</h3>
					<p class="lp-plan-blurb">{p.blurb}</p>
					<p class="lp-plan-price">
						<span class="lp-cur">$</span>{p.price}<span class="lp-per">/mo</span>
					</p>
					<a class="lp-btn lp-btn-block" class:lp-btn-ghost={!p.featured} href={p.href}>{p.cta}</a>
					<details class="lp-plan-details" open={!compactPlans}>
						<summary>What’s included</summary>
						<ul class="lp-plan-features">
							{#each p.features as f (f)}
								<li>{@render check()}{f}</li>
							{/each}
						</ul>
					</details>
				</article>
			{/each}
		</div>

		<div class="lp-receipt-row" use:reveal>
			<div class="lp-receipt" aria-label="What a post costs">
				<p class="lp-receipt-title">What a post costs</p>
				<ul>
					{#each RECEIPT as r (r.item)}
						<li>
							<span class="lp-receipt-item"><strong>{r.item}</strong><span>{r.note}</span></span>
							<span class="lp-receipt-price lp-num">{r.price}</span>
						</li>
					{/each}
				</ul>
			</div>
			<div class="lp-receipt-copy">
				<h3>Money, not points.</h3>
				<p>
					Rival wallets show a score and make you do the arithmetic. Yours shows dollars, quoted
					before every generation. Top up at par — $25 buys $25.00 — and it never expires. Cancel
					any time.
				</p>
			</div>
		</div>
	</section>

	<section class="lp-section lp-section-alt" id="faq">
		<div class="lp-faq-layout">
			<div class="lp-section-head lp-section-head-left" use:reveal>
				<p class="lp-kicker">FAQ</p>
				<h2>Straight answers.</h2>
				<p class="lp-section-sub">
					The questions people ask before they trust a persona with their brand.
				</p>
			</div>
			<div class="lp-faqs" use:reveal={80}>
				{#each FAQS as f (f.q)}
					<details class="lp-faq">
						<summary>{f.q}</summary>
						<p>{f.a}</p>
					</details>
				{/each}
			</div>
		</div>
	</section>

	<section class="lp-final">
		<div class="lp-final-inner" use:reveal>
			<div class="lp-final-cast" aria-hidden="true">
				{#each CAST.slice(0, 5) as c, i (c.src)}
					<img src={c.src} width="720" height="720" alt="" loading="lazy" decoding="async" style="--i: {i}" />
				{/each}
			</div>
			<h2>Everyone else sells you a face.<br /><span class="lp-final-grad">We run the account.</span></h2>
			<a class="lp-btn lp-btn-lg lp-btn-invert" href="/signup">
				Create your first persona<span class="lp-btn-tail"> — free</span>
			</a>
			<p class="lp-fineprint lp-final-fineprint">
				No credit card. One free generation credit per person to start. Cancel any time.
			</p>
		</div>
	</section>

	<footer class="lp-footer">
		<div class="lp-footer-grid">
			<div class="lp-footer-brand">
				<span class="lp-brand-mark lp-brand-mark-sm" aria-hidden="true">{@render bolt()}</span>
				<div>
					<strong>PersonaGen</strong>
					<p>AI personas with a locked face that publish to 13 platforms, every post approved by you and every publish verified.</p>
				</div>
			</div>
			<nav aria-label="Product">
				<p class="lp-footer-head">Product</p>
				{#each NAV as n (n.href)}<a href={n.href}>{n.label}</a>{/each}
			</nav>
			<nav aria-label="Account">
				<p class="lp-footer-head">Account</p>
				<a href="/signup">Start free</a>
				<a href="/login">Log in</a>
				<a href="/billing">Billing</a>
			</nav>
		</div>
		<div class="lp-footer-bottom">
			<span>© {year} PersonaGen</span>
			<span class="lp-footer-status">13 platforms · every publish verified · money, not points</span>
		</div>
	</footer>
</div>

<style>
	.lp {
		--lp-max: 74rem;
		--lp-pad: clamp(1rem, 5vw, 4rem);
		background: var(--bg);
		color: var(--text);
		font-family: var(--font-body);
		/* `clip`, not `hidden`: `hidden` makes this a scroll container, which both
		   breaks the sticky nav's containing block and still let the 640px
		   comparison table leak ~210px of document-level horizontal scroll at
		   375px. `clip` contains the overflow without creating a scroll port. */
		overflow-x: clip;
		-webkit-font-smoothing: antialiased;
	}
	/* Dark-theme card edges: the app's 5% border is tuned for a dense portal;
	   on a marketing page a card with no visible edge reads as loose text. */
	:global([data-theme='dark']) .lp {
		--border: rgba(255, 255, 255, 0.1);
		--border-strong: rgba(255, 255, 255, 0.17);
	}

	.lp h1,
	.lp h2 {
		font-family: var(--font-display);
		letter-spacing: -0.02em;
		line-height: 1.08;
		text-wrap: balance;
		font-variant-numeric: lining-nums;
	}
	.lp h3 {
		font-family: var(--font-display);
		letter-spacing: -0.01em;
		line-height: 1.25;
		font-weight: 600;
		font-variant-numeric: lining-nums;
	}
	/* Playfair's currency glyph is a hairline; money is set in the body face. */
	.lp-num,
	.lp-cur {
		font-family: var(--font-body);
		font-variant-numeric: tabular-nums;
	}

	/* ── Scroll reveal ── */
	[data-reveal] {
		opacity: 0;
		transform: translateY(14px);
		transition:
			opacity 0.55s var(--ease-out) var(--reveal-delay, 0ms),
			transform 0.55s var(--ease-out) var(--reveal-delay, 0ms);
	}
	[data-reveal].is-in {
		opacity: 1;
		transform: none;
	}

	/* ── Nav ── */
	.lp-nav {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		padding: 0.8rem var(--lp-pad);
		position: sticky;
		top: 0;
		z-index: 30;
		background: color-mix(in srgb, var(--bg) 78%, transparent);
		backdrop-filter: blur(14px) saturate(140%);
		-webkit-backdrop-filter: blur(14px) saturate(140%);
		border-bottom: 1px solid transparent;
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease;
	}
	.lp-nav.is-scrolled {
		border-bottom-color: var(--border-strong);
		background: color-mix(in srgb, var(--bg) 90%, transparent);
		box-shadow: 0 6px 24px -12px rgba(15, 23, 42, 0.18);
	}
	.lp-scrim {
		position: fixed;
		inset: 0;
		z-index: 25;
		border: 0;
		padding: 0;
		background: rgba(8, 6, 18, 0.45);
		backdrop-filter: blur(2px);
		-webkit-backdrop-filter: blur(2px);
		cursor: pointer;
	}
	.lp-brand {
		display: flex;
		align-items: center;
		min-height: 44px;
		gap: 0.6rem;
		font-weight: 700;
		font-size: 1.05rem;
		letter-spacing: -0.01em;
		color: var(--text);
		text-decoration: none;
	}
	.lp-brand-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 9px;
		background: var(--gradient);
		color: #fff;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.35),
			0 4px 12px color-mix(in srgb, var(--accent) 35%, transparent);
	}
	.lp-brand-mark svg {
		width: 16px;
		height: 16px;
	}
	.lp-brand-mark-sm {
		width: 26px;
		height: 26px;
		border-radius: 8px;
		box-shadow: none;
	}
	.lp-brand-mark-sm svg {
		width: 14px;
		height: 14px;
	}
	.lp-nav-links {
		display: flex;
		gap: 0.25rem;
		margin-left: auto;
	}
	/* 44px min touch target — these are text links, but they are primary
	   navigation on a phone and were measuring 24–29px tall. */
	.lp-nav-links a,
	.lp-link {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 0.7rem;
		border-radius: 999px;
		color: var(--text-muted);
		text-decoration: none;
		font-size: 0.9rem;
		font-weight: 500;
		transition:
			color 0.15s ease,
			background-color 0.15s ease;
	}
	.lp-nav-links a:hover,
	.lp-link:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	.lp-nav-links-login {
		display: none !important;
	}
	.lp-nav-cta {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.lp-menu-btn {
		display: none;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: 12px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
	}
	.lp-menu-btn svg {
		width: 20px;
		height: 20px;
	}
	.lp-menu-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	/* ── Buttons ── */
	.lp-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.55rem;
		background: var(--gradient-cta);
		color: #fff;
		border: none;
		border-radius: 999px;
		padding: 0.85rem 1.6rem;
		font-size: 0.95rem;
		font-weight: 600;
		font-family: inherit;
		text-decoration: none;
		cursor: pointer;
		min-height: 44px;
		white-space: nowrap;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.18),
			0 1px 2px rgba(15, 23, 42, 0.2),
			0 8px 20px -8px color-mix(in srgb, var(--accent) 60%, transparent);
		transition:
			transform 0.16s var(--ease-out),
			box-shadow 0.16s var(--ease-out),
			filter 0.16s ease;
	}
	.lp-btn svg {
		width: 18px;
		height: 18px;
		transition: transform 0.16s var(--ease-out);
	}
	.lp-btn:hover {
		transform: translateY(-2px);
		filter: brightness(1.14) saturate(1.08);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.22),
			0 3px 6px rgba(15, 23, 42, 0.18),
			0 18px 34px -12px color-mix(in srgb, var(--accent) 75%, transparent);
	}
	.lp-btn:hover svg {
		transform: translateX(3px);
	}
	.lp-btn:active {
		transform: translateY(0);
		filter: brightness(0.98);
	}
	.lp-btn:focus-visible,
	.lp-link:focus-visible,
	.lp-nav-links a:focus-visible,
	.lp-link-arrow:focus-visible,
	.lp-faq summary:focus-visible,
	.lp-footer a:focus-visible,
	.lp-brand:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}
	.lp-btn-sm {
		padding: 0.55rem 1.15rem;
		font-size: 0.875rem;
	}
	.lp-btn-lg {
		padding: 1rem 1.9rem;
		font-size: 1.02rem;
	}
	.lp-btn-block {
		width: 100%;
	}
	.lp-btn-ghost {
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border-strong);
		box-shadow: none;
	}
	.lp-btn-ghost:hover {
		border-color: var(--accent);
		color: var(--accent-text);
		filter: none;
		box-shadow: 0 8px 20px -10px color-mix(in srgb, var(--accent) 45%, transparent);
	}
	.lp-btn-invert {
		background: #fff;
		color: #1a1240;
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.25),
			0 16px 36px -14px rgba(0, 0, 0, 0.55);
	}
	.lp-btn-invert:hover {
		filter: none;
		background: #fff;
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.25),
			0 22px 44px -14px rgba(0, 0, 0, 0.6);
	}
	.lp-link-arrow {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 44px;
		padding: 0 0.4rem;
		color: var(--accent-text);
		text-decoration: none;
		font-weight: 600;
		font-size: 0.95rem;
	}
	.lp-link-arrow::after {
		content: '→';
		transition: transform 0.18s var(--ease-out);
	}
	.lp-link-arrow:hover::after {
		transform: translateX(3px);
	}

	/* ── Hero ── */
	.lp-hero {
		position: relative;
		padding: clamp(2.5rem, 6vw, 5rem) var(--lp-pad) clamp(2.5rem, 5vw, 4.5rem);
		isolation: isolate;
	}
	.lp-hero-bg {
		position: absolute;
		inset: 0;
		z-index: -1;
		overflow: hidden;
		pointer-events: none;
		background-image: radial-gradient(
			color-mix(in srgb, var(--text) 7%, transparent) 1px,
			transparent 1px
		);
		background-size: 28px 28px;
		mask-image: radial-gradient(ellipse 85% 62% at 50% 30%, #000 20%, transparent 72%);
		-webkit-mask-image: radial-gradient(ellipse 85% 62% at 50% 30%, #000 20%, transparent 72%);
	}
	.lp-orb {
		position: absolute;
		border-radius: 50%;
		filter: blur(90px);
		opacity: 0.32;
	}
	.lp-orb-a {
		width: 560px;
		height: 560px;
		background: var(--accent);
		top: -18%;
		right: -6%;
	}
	.lp-orb-b {
		width: 420px;
		height: 420px;
		background: var(--cyan);
		bottom: -25%;
		left: -8%;
		opacity: 0.2;
	}
	.lp-hero-inner {
		max-width: var(--lp-max);
		margin: 0 auto;
		display: grid;
		grid-template-columns: minmax(0, 1.18fr) minmax(0, 0.82fr);
		grid-template-areas:
			'top stage'
			'ticks stage';
		column-gap: clamp(2rem, 4vw, 3.5rem);
		align-items: center;
	}
	.lp-hero-top {
		grid-area: top;
		align-self: end;
		max-width: 42rem;
	}
	.lp-stage {
		grid-area: stage;
	}
	.lp-ticks {
		grid-area: ticks;
		align-self: start;
	}
	.lp-eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--accent-text);
		background: var(--accent-soft);
		border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
		border-radius: 999px;
		padding: 0.4rem 0.85rem 0.4rem 0.6rem;
		margin: 0 0 1.4rem;
		white-space: nowrap;
	}
	.lp-eyebrow-short {
		display: none;
	}
	.lp-eyebrow-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--gradient);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
	}
	.lp-hero h1 {
		font-size: clamp(2.4rem, 4.4vw, 3.55rem);
		font-weight: 700;
		margin: 0 0 1.3rem;
	}
	.lp-grad {
		background: var(--gradient);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	.lp-sub {
		font-size: clamp(1.02rem, 1.6vw, 1.15rem);
		line-height: 1.6;
		color: var(--text-muted);
		max-width: 32rem;
		margin: 0 0 1.8rem;
		text-wrap: pretty;
	}
	.lp-hero-cta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.9rem 1.2rem;
		align-items: center;
	}
	.lp-ticks {
		list-style: none;
		margin: 1.4rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.4rem;
		font-size: 0.85rem;
		color: var(--text-dim);
	}
	.lp-ticks li {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.lp-ticks svg {
		width: 15px;
		height: 15px;
		color: var(--success-text);
	}

	/* The stage: three persona cards + three live UI chips. Sizes are in
	   container-relative units so the composition holds from 320px to 1440px. */
	.lp-stage {
		position: relative;
		aspect-ratio: 1 / 0.92;
		max-width: 560px;
		width: 100%;
		margin-inline: auto;
		container-type: inline-size;
	}
	.lp-card {
		position: absolute;
		margin: 0;
		border-radius: 22px;
		overflow: hidden;
		background: var(--surface);
		box-shadow:
			0 1px 2px rgba(15, 23, 42, 0.08),
			0 24px 48px -16px rgba(15, 23, 42, 0.35);
		outline: 1px solid rgba(255, 255, 255, 0.35);
		outline-offset: -1px;
	}
	.lp-card img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.lp-card-main {
		left: 17%;
		top: 4%;
		width: 62%;
		height: 84%;
		z-index: 3;
	}
	.lp-card-main img {
		object-position: 55% 20%;
	}
	.lp-card-left {
		left: 0;
		top: 18%;
		width: 34%;
		height: 50%;
		z-index: 2;
		transform: rotate(-6deg);
		opacity: 0.95;
	}
	.lp-card-left img {
		object-position: 50% 15%;
	}
	.lp-card-right {
		right: 0;
		top: 26%;
		width: 34%;
		height: 50%;
		z-index: 2;
		transform: rotate(6deg);
		opacity: 0.95;
	}
	.lp-card-right img {
		object-position: 50% 10%;
	}
	.lp-card-tag {
		position: absolute;
		left: 4%;
		top: 4%;
		z-index: 5;
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		background: rgba(10, 8, 20, 0.62);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		color: #fff;
		font-size: clamp(0.66rem, 2.4cqi, 0.78rem);
		font-weight: 600;
		letter-spacing: 0.01em;
		padding: 0.42rem 0.75rem 0.42rem 0.6rem;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.18);
		white-space: nowrap;
	}
	.lp-tag-short {
		display: none;
	}
	.lp-tag-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--success);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 30%, transparent);
	}
	.lp-chip {
		position: absolute;
		z-index: 4;
		display: flex;
		align-items: center;
		gap: 0.65rem;
		background: color-mix(in srgb, var(--surface) 92%, transparent);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid var(--border);
		border-radius: 14px;
		padding: 0.6rem 0.8rem;
		box-shadow:
			0 1px 2px rgba(15, 23, 42, 0.06),
			0 14px 30px -12px rgba(15, 23, 42, 0.3);
		font-size: clamp(0.7rem, 2.5cqi, 0.8rem);
		line-height: 1.25;
	}
	.lp-chip-body {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		white-space: nowrap;
	}
	.lp-chip-body strong {
		color: var(--text);
		font-weight: 600;
	}
	.lp-chip-body > span {
		color: var(--text-dim);
		font-size: 0.92em;
	}
	.lp-chip-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2em;
		height: 2em;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.lp-chip-icon svg {
		width: 1.15em;
		height: 1.15em;
	}
	.lp-chip-icon-ok {
		background: var(--success-soft);
		color: var(--success-text);
	}
	.lp-chip-verified {
		top: 0;
		right: 0;
		animation: lp-float 7s ease-in-out infinite;
	}
	.lp-chip-approve {
		bottom: 2%;
		left: 0;
		animation: lp-float 8s ease-in-out infinite reverse;
	}
	.lp-chip-price {
		right: 0;
		bottom: 22%;
		animation: lp-float 9s ease-in-out infinite;
		animation-delay: -3s;
	}
	.lp-chip-price-num {
		font-weight: 700;
		font-size: 1.45em;
		letter-spacing: -0.02em;
		color: var(--accent-text);
	}
	.lp-chip-actions {
		display: inline-flex;
		gap: 0.35rem;
		margin-left: 0.2rem;
		flex-shrink: 0;
	}
	.lp-chip-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.35em 0.75em;
		border-radius: 999px;
		font-weight: 600;
		font-size: 0.92em;
		border: 1px solid var(--border-strong);
		color: var(--text-muted);
		background: var(--surface);
		white-space: nowrap;
	}
	.lp-chip-btn-primary {
		background: var(--gradient-cta);
		color: #fff;
		border-color: transparent;
	}
	@keyframes lp-float {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-6px);
		}
	}

	/* ── Platform strip ── */
	.lp-strip {
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}
	.lp-strip-inner {
		max-width: var(--lp-max);
		margin: 0 auto;
		padding: 1.5rem var(--lp-pad) 1.6rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.9rem;
	}
	.lp-strip-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-weight: 700;
		color: var(--text-dim);
		margin: 0;
	}
	.lp-strip-list {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.45rem 0.5rem;
		list-style: none;
		margin: 0;
		padding: 0;
		max-width: min(100%, 44rem);
	}
	.lp-strip-list li {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.32rem 0.75rem 0.32rem 0.55rem;
		white-space: nowrap;
	}
	.lp-strip-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--hue);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--hue) 22%, transparent);
	}

	/* ── Proof bar ── */
	.lp-proof {
		max-width: var(--lp-max);
		margin: 0 auto;
		padding: clamp(2rem, 4vw, 3rem) var(--lp-pad) 0;
	}
	.lp-proof-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
		margin: 0;
	}
	.lp-proof-item {
		border-left: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
		padding: 0.2rem 0 0.2rem 1rem;
	}
	.lp-proof-item dt {
		font-size: clamp(1.9rem, 3vw, 2.5rem);
		font-weight: 700;
		letter-spacing: -0.03em;
		line-height: 1.1;
		color: var(--text);
	}
	.lp-proof-item dd {
		margin: 0.3rem 0 0;
		font-size: 0.85rem;
		color: var(--text-dim);
		line-height: 1.4;
		text-wrap: pretty;
	}
	.lp-proof-short {
		display: none;
	}

	/* ── Sections ── */
	.lp-section {
		padding: clamp(3.5rem, 7vw, 6rem) var(--lp-pad);
		max-width: var(--lp-max);
		margin: 0 auto;
	}
	.lp-section-alt {
		background: var(--surface);
		max-width: none;
		border-block: 1px solid var(--border);
	}
	.lp-section-alt > * {
		max-width: var(--lp-max);
		margin-inline: auto;
	}
	.lp-section-head {
		text-align: center;
		max-width: 46rem;
		margin: 0 auto clamp(2.2rem, 4vw, 3.2rem);
	}
	.lp-section-head-left {
		text-align: left;
		margin-inline: 0;
	}
	/* The split head is the page's beat change: kicker + headline left, the
	   supporting line right, on a shared baseline. */
	.lp-section-head-split {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
		gap: 1rem 3rem;
		align-items: end;
		text-align: left;
		max-width: none;
	}
	.lp-section-head-split h2 {
		margin-bottom: 0;
	}
	.lp-section-head-split .lp-section-sub {
		max-width: 30rem;
		justify-self: end;
		padding-bottom: 0.35rem;
	}
	.lp-kicker {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent-text);
		margin: 0 0 0.8rem;
	}
	.lp-section h2 {
		font-size: clamp(1.75rem, 3.6vw, 2.6rem);
		font-weight: 700;
		margin: 0 0 0.85rem;
	}
	.lp-section-sub {
		color: var(--text-muted);
		font-size: 1.02rem;
		line-height: 1.65;
		margin: 0;
		text-wrap: pretty;
	}

	/* ── Steps ── */
	.lp-steps {
		position: relative;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 1rem;
		list-style: none;
		padding: 0;
		margin: 0;
		align-items: stretch;
	}
	/* The connector runs behind the number discs. */
	.lp-steps::before {
		content: '';
		position: absolute;
		left: 3rem;
		right: 3rem;
		top: calc(1.4rem + 17px);
		height: 2px;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--accent) 25%, transparent),
			color-mix(in srgb, var(--accent) 55%, transparent)
		);
		pointer-events: none;
	}
	.lp-step {
		position: relative;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 18px;
		padding: 1.4rem 1.3rem 1.5rem;
		box-shadow: var(--shadow-md);
		transition:
			transform 0.2s var(--ease-out),
			box-shadow 0.2s var(--ease-out);
	}
	.lp-step:hover {
		transform: translateY(-3px);
		box-shadow: var(--shadow-lg);
	}
	.lp-step-ours {
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
		/* Opaque base under the tint, or the connector line shows through the card. */
		background:
			linear-gradient(180deg, var(--accent-soft), transparent 70%),
			var(--surface);
	}
	.lp-step-n {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--accent-text);
		background: var(--surface);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		margin-bottom: 1rem;
	}
	.lp-step-ours .lp-step-n {
		background: var(--gradient-cta);
		color: #fff;
		border-color: transparent;
	}
	.lp-step-time {
		display: block;
		font-size: 0.66rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
		margin-bottom: 0.35rem;
	}
	.lp-step h3 {
		font-size: 1.08rem;
		margin: 0 0 0.5rem;
	}
	.lp-step p {
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--text-muted);
		margin: 0;
	}
	.lp-only {
		position: absolute;
		top: -0.65rem;
		right: 1rem;
		font-size: 0.62rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #fff;
		background: var(--gradient-cta);
		border-radius: 999px;
		padding: 0.22rem 0.6rem;
		box-shadow: 0 6px 14px -6px color-mix(in srgb, var(--accent) 70%, transparent);
	}

	/* ── Comparison ── */
	/* `clip` rather than `auto`+ancestor-hidden: the 640px table is a wider-than-
	   viewport descendant, and with `overflow-x: auto` alone the documentElement
	   still gained ~210px of horizontal scroll on a 375px screen even though the
	   wrapper itself was scrolling correctly. `contain: inline-size` stops the
	   intrinsic width propagating up. Verified at 375px: window.scrollX stays 0. */
	.lp-table-wrap {
		overflow-x: auto;
		max-width: 100%;
		contain: inline-size;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 20px;
		box-shadow: var(--shadow-md);
		padding: 0.4rem 1.2rem 0.6rem;
	}
	.lp-table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		min-width: 640px;
	}
	.lp-table th,
	.lp-table td {
		padding: 0.95rem 1rem;
		text-align: center;
		border-bottom: 1px solid var(--border);
		font-size: 0.92rem;
	}
	.lp-table tbody tr:last-child th,
	.lp-table tbody tr:last-child td {
		border-bottom: none;
	}
	.lp-table thead th {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--text-dim);
		font-weight: 700;
		padding-top: 1.2rem;
	}
	.lp-table tbody th {
		text-align: left;
		font-weight: 500;
		color: var(--text);
	}
	.lp-th-ours {
		color: var(--accent-text);
		background: var(--accent-soft);
		border-radius: 14px 14px 0 0;
	}
	.lp-th-ours-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 6px;
		background: var(--gradient);
		color: #fff;
		vertical-align: middle;
		margin-right: 0.35rem;
	}
	.lp-th-ours-mark svg {
		width: 11px;
		height: 11px;
	}
	.lp-td-ours {
		background: var(--accent-soft);
		font-weight: 600;
		color: var(--text);
		border-bottom-color: color-mix(in srgb, var(--accent) 14%, transparent);
	}
	.lp-table tbody tr:last-child .lp-td-ours {
		border-radius: 0 0 14px 14px;
	}
	/* Competitor ticks are deliberately muted: the column that wins should be
	   the only one that reads as "passing" at a glance. */
	.lp-yes {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: var(--surface-2);
		color: var(--text-dim);
	}
	.lp-yes svg {
		width: 15px;
		height: 15px;
	}
	.lp-yes-strong {
		background: var(--gradient-cta);
		color: #fff;
	}
	.lp-no {
		color: var(--text-dim);
		opacity: 0.6;
	}
	.lp-partial {
		font-size: 0.86rem;
		color: var(--text-dim);
	}
	.lp-mid-cta {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.7rem;
		margin-top: 2.4rem;
	}
	.lp-mid-cta-note {
		font-size: 0.82rem;
		color: var(--text-dim);
	}

	/* ── Features (bento) ── */
	.lp-features {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 1rem;
	}
	.lp-feature {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 20px;
		padding: 1.6rem;
		margin: 0;
		box-shadow: var(--shadow-sm);
		transition:
			transform 0.2s var(--ease-out),
			box-shadow 0.2s var(--ease-out),
			border-color 0.2s ease;
	}
	.lp-feature:hover {
		transform: translateY(-3px);
		box-shadow: var(--shadow-lg);
		border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
	}
	.lp-feature-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 42px;
		height: 42px;
		border-radius: 12px;
		background: var(--accent-soft);
		color: var(--accent-text);
		margin-bottom: 1.1rem;
		flex-shrink: 0;
	}
	.lp-feature-icon svg {
		width: 21px;
		height: 21px;
	}
	.lp-feature h3 {
		font-size: 1.12rem;
		margin: 0 0 0.55rem;
	}
	.lp-feature p {
		font-size: 0.9rem;
		line-height: 1.65;
		color: var(--text-muted);
		margin: 0;
	}
	.lp-feature-sheet {
		grid-column: span 2;
		display: grid;
		grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
		gap: 1.6rem;
		align-items: center;
		background: linear-gradient(135deg, var(--accent-soft), var(--surface) 60%);
	}
	.lp-sheet {
		position: relative;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.45rem;
		padding: 0.55rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		box-shadow: var(--shadow-md);
	}
	.lp-sheet-tile {
		position: relative;
		aspect-ratio: 3 / 4;
		border-radius: 8px;
		overflow: hidden;
		background: var(--surface-2);
	}
	.lp-sheet-tile img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.lp-sheet-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
		gap: 2px;
		background: var(--surface);
	}
	.lp-sheet-grid img {
		transform-origin: center;
	}
	.lp-sheet-label {
		position: absolute;
		left: 0.3rem;
		bottom: 0.3rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.5rem;
		height: 1.15rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: rgba(10, 8, 20, 0.7);
		backdrop-filter: blur(4px);
		color: #fff;
		font-family: var(--font-mono);
		font-size: 0.58rem;
		font-weight: 600;
		letter-spacing: 0.04em;
	}
	.lp-sheet-note {
		margin: 0.9rem 0 0.3rem;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-dim);
	}
	.lp-sheet-legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.9rem;
		font-size: 0.78rem;
		color: var(--text-dim);
	}
	.lp-sheet-legend b {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--accent-text);
		margin-right: 0.35em;
	}
	.lp-sheet-lock {
		position: absolute;
		top: -0.6rem;
		right: 0.8rem;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: rgba(10, 8, 20, 0.85);
		color: #fff;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 0.3rem 0.6rem 0.3rem 0.5rem;
		border-radius: 999px;
	}
	.lp-feature-sheet figcaption h3 {
		font-size: 1.3rem;
	}
	/* Autonomy: a three-segment control, middle segment on. */
	.lp-seg {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 3px;
		padding: 3px;
		margin-bottom: 1.2rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 12px;
		pointer-events: none;
	}
	.lp-seg span {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 34px;
		padding: 0 0.35rem;
		border-radius: 9px;
		font-size: 0.68rem;
		font-weight: 600;
		text-align: center;
		line-height: 1.15;
		color: var(--text-dim);
	}
	.lp-seg .is-on {
		background: var(--gradient-cta);
		color: #fff;
		box-shadow: 0 4px 12px -4px color-mix(in srgb, var(--accent) 70%, transparent);
	}
	/* Brand grounding: the products it found, as small rows. */
	.lp-products {
		list-style: none;
		margin: 0 0 1.2rem;
		padding: 0.35rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 12px;
	}
	.lp-products li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.6rem;
		padding: 0.4rem 0.5rem;
		background: var(--surface);
		border-radius: 8px;
		font-size: 0.74rem;
	}
	.lp-products-thumb {
		display: block;
		width: 30px;
		height: 30px;
		border-radius: 7px;
		overflow: hidden;
		flex-shrink: 0;
	}
	.lp-products-thumb img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transform: scale(1.7);
		transform-origin: center;
	}
	.lp-products li > span:nth-of-type(2) {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.lp-products strong {
		font-weight: 600;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lp-products li > span:nth-of-type(2) > span {
		color: var(--text-dim);
		font-size: 0.68rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lp-products-ok {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--success-soft);
		color: var(--success-text);
	}
	.lp-products-ok svg {
		width: 11px;
		height: 11px;
	}
	.lp-feature-cast {
		grid-column: span 2;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.2rem;
		align-content: center;
	}
	.lp-cast {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 0.6rem;
	}
	.lp-cast li {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		text-align: center;
		min-width: 0;
	}
	.lp-cast img {
		width: 100%;
		max-width: 96px;
		aspect-ratio: 1;
		height: auto;
		border-radius: 50%;
		object-fit: cover;
		object-position: 50% 12%;
		border: 3px solid var(--surface);
		box-shadow: 0 8px 20px -8px rgba(15, 23, 42, 0.45);
		margin-bottom: 0.4rem;
	}
	.lp-cast-name {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text);
	}
	.lp-cast-platform {
		font-size: 0.7rem;
		color: var(--text-dim);
	}
	.lp-feature-cast figcaption {
		max-width: 40rem;
	}
	.lp-feature-cast figcaption h3 {
		font-size: 1.3rem;
	}

	/* ── Trust: the approval queue frame + three commitments ── */
	.lp-trust-layout {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
		gap: clamp(1.5rem, 4vw, 3.5rem);
		align-items: center;
	}
	.lp-frame {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 18px;
		box-shadow:
			0 1px 2px rgba(15, 23, 42, 0.06),
			0 30px 60px -24px rgba(15, 23, 42, 0.35);
		overflow: hidden;
	}
	.lp-frame-bar {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
		font-size: 0.82rem;
	}
	.lp-frame-dots {
		display: inline-flex;
		gap: 5px;
	}
	.lp-frame-dots i {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--border-strong);
	}
	.lp-frame-title {
		font-weight: 600;
		color: var(--text);
	}
	.lp-frame-count {
		margin-left: auto;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent-text);
		background: var(--accent-soft);
		border-radius: 999px;
		padding: 0.25rem 0.6rem;
	}
	.lp-queue {
		list-style: none;
		margin: 0;
		padding: 0.4rem;
	}
	.lp-queue-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.85rem;
		padding: 0.7rem 0.7rem;
		border-radius: 12px;
		font-size: 0.85rem;
	}
	.lp-queue-row + .lp-queue-row {
		border-top: 1px solid var(--border);
		border-radius: 0;
	}
	.lp-queue-row img {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		object-fit: cover;
		object-position: 50% 12%;
	}
	.lp-queue-who {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}
	.lp-queue-who strong {
		font-weight: 600;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lp-queue-who > span {
		color: var(--text-dim);
		font-size: 0.8rem;
		line-height: 1.35;
	}
	.lp-queue-row.is-done {
		opacity: 0.8;
	}
	.lp-queue-done {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--success-text);
		white-space: nowrap;
	}
	.lp-frame-foot {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.7rem 1.1rem;
		border-top: 1px solid var(--border);
		background: var(--surface);
		font-size: 0.78rem;
		color: var(--text-dim);
		text-wrap: balance;
	}
	.lp-frame-toggle {
		display: inline-flex;
		align-items: center;
		width: 30px;
		height: 18px;
		border-radius: 999px;
		background: var(--surface-3);
		border: 1px solid var(--border-strong);
		padding: 2px;
		flex-shrink: 0;
	}
	.lp-frame-toggle i {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--surface);
		box-shadow: 0 1px 2px rgba(15, 23, 42, 0.3);
	}
	.lp-trust-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1.4rem;
	}
	.lp-trust-list li {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
	}
	.lp-trust-list .lp-feature-icon {
		margin: 0;
	}
	.lp-trust-list h3 {
		font-size: 1.1rem;
		margin: 0.35rem 0 0.4rem;
	}
	.lp-trust-list p {
		color: var(--text-muted);
		line-height: 1.65;
		font-size: 0.9rem;
		margin: 0;
	}

	/* ── Pricing ── */
	.lp-plans {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 1rem;
		align-items: stretch;
	}
	.lp-plan {
		display: flex;
		flex-direction: column;
		position: relative;
		background: var(--surface);
		border: 2px solid var(--border);
		border-radius: 22px;
		padding: 1.8rem 1.4rem;
		box-shadow: var(--shadow-sm);
	}
	/* Same 2px border on every card so the featured one's gradient border does
	   not shift its interior off the shared baseline. */
	.lp-plan.featured {
		background:
			linear-gradient(var(--surface), var(--surface)) padding-box,
			var(--gradient) border-box;
		border-color: transparent;
		box-shadow:
			0 24px 56px -20px color-mix(in srgb, var(--accent) 45%, transparent),
			var(--shadow-md);
	}
	.lp-plan-badge {
		position: absolute;
		top: -0.8rem;
		left: 50%;
		transform: translateX(-50%);
		background: var(--gradient-cta);
		color: #fff;
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 0.32rem 0.85rem;
		border-radius: 999px;
		white-space: nowrap;
		box-shadow: 0 6px 16px -6px color-mix(in srgb, var(--accent) 70%, transparent);
	}
	.lp-plan h3 {
		font-size: 1.2rem;
		margin: 0 0 0.3rem;
	}
	.lp-plan-blurb {
		font-size: 0.85rem;
		line-height: 1.4;
		color: var(--text-dim);
		margin: 0 0 1.2rem;
		min-height: 2.8em;
	}
	.lp-plan-price {
		font-family: var(--font-display);
		font-variant-numeric: lining-nums;
		font-size: 2.6rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		margin: 0 0 1.3rem;
		line-height: 1;
	}
	.lp-cur {
		font-size: 1.2rem;
		font-weight: 600;
		vertical-align: super;
		margin-right: 0.1rem;
		color: var(--text-dim);
	}
	.lp-per {
		font-family: var(--font-body);
		font-size: 0.9rem;
		font-weight: 400;
		letter-spacing: 0;
		color: var(--text-dim);
	}
	.lp-plan-details {
		margin-top: 1.3rem;
		border-top: 1px solid var(--border);
	}
	.lp-plan-details summary {
		display: none;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		cursor: pointer;
		list-style: none;
		min-height: 44px;
		padding-top: 0.6rem;
		font-size: 0.86rem;
		font-weight: 600;
		color: var(--accent-text);
	}
	.lp-plan-details summary::-webkit-details-marker {
		display: none;
	}
	.lp-plan-details summary::after {
		content: '+';
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--accent-soft);
		font-size: 1rem;
		line-height: 1;
	}
	.lp-plan-details[open] summary::after {
		content: '−';
	}
	.lp-plan-features {
		list-style: none;
		padding: 1.3rem 0 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.lp-plan-features li {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		font-size: 0.86rem;
		color: var(--text-muted);
		line-height: 1.45;
	}
	.lp-plan-features svg {
		width: 15px;
		height: 15px;
		flex-shrink: 0;
		margin-top: 0.2rem;
		color: var(--accent-text);
	}
	.lp-receipt-row {
		display: grid;
		grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
		gap: clamp(1.5rem, 4vw, 3rem);
		align-items: center;
		margin-top: 2.5rem;
		padding: 1.6rem;
		border: 1px solid var(--border);
		border-radius: 22px;
		background: linear-gradient(135deg, var(--accent-soft), var(--surface) 55%);
	}
	.lp-receipt {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 1.1rem 1.2rem;
		box-shadow: var(--shadow-md);
	}
	.lp-receipt-title {
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-dim);
		margin: 0 0 0.6rem;
	}
	.lp-receipt ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.lp-receipt li {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
		padding: 0.55rem 0;
		border-top: 1px dashed var(--border-strong);
		font-size: 0.88rem;
	}
	.lp-receipt-item {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.lp-receipt-item strong {
		font-weight: 600;
		color: var(--text);
	}
	.lp-receipt-item span {
		font-size: 0.78rem;
		color: var(--text-dim);
	}
	.lp-receipt-price {
		font-weight: 700;
		color: var(--text);
	}
	.lp-receipt-copy h3 {
		font-size: 1.35rem;
		margin: 0 0 0.6rem;
	}
	.lp-receipt-copy p {
		color: var(--text-muted);
		line-height: 1.7;
		font-size: 0.95rem;
		margin: 0;
	}
	.lp-fineprint {
		font-size: 0.82rem;
		color: var(--text-dim);
		margin-top: 1.1rem;
		line-height: 1.5;
	}

	/* ── FAQ ── */
	.lp-faq-layout {
		display: grid;
		grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.4fr);
		gap: clamp(1.5rem, 5vw, 4rem);
		align-items: start;
	}
	.lp-faq-layout .lp-section-head {
		position: sticky;
		top: 5.5rem;
	}
	.lp-faqs {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.lp-faq {
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--bg);
		padding: 0 1.25rem;
		transition: border-color 0.15s ease;
	}
	.lp-faq[open] {
		border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
	}
	.lp-faq summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		cursor: pointer;
		padding: 1.05rem 0;
		font-weight: 600;
		font-size: 0.98rem;
		list-style: none;
	}
	.lp-faq summary::-webkit-details-marker {
		display: none;
	}
	.lp-faq summary::after {
		content: '+';
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: var(--accent-soft);
		color: var(--accent-text);
		font-weight: 500;
		font-size: 1.1rem;
		line-height: 1;
	}
	.lp-faq[open] summary::after {
		content: '−';
	}
	.lp-faq p {
		margin: 0 0 1.2rem;
		font-size: 0.92rem;
		line-height: 1.7;
		color: var(--text-muted);
		max-width: 60ch;
	}

	/* ── Final CTA ── */
	.lp-final {
		padding: clamp(1rem, 4vw, 3rem) var(--lp-pad) clamp(3rem, 6vw, 5rem);
	}
	.lp-final-inner {
		position: relative;
		max-width: var(--lp-max);
		margin: 0 auto;
		text-align: center;
		padding: clamp(3rem, 7vw, 5.5rem) var(--lp-pad);
		border-radius: 28px;
		color: #fff;
		background:
			radial-gradient(ellipse 60% 80% at 80% 0%, color-mix(in srgb, var(--cyan) 45%, transparent), transparent 60%),
			radial-gradient(ellipse 50% 70% at 10% 100%, color-mix(in srgb, var(--rose) 35%, transparent), transparent 60%),
			linear-gradient(135deg, color-mix(in srgb, var(--accent) 70%, #0b0713), #0b0713 80%);
		overflow: hidden;
		isolation: isolate;
		box-shadow: 0 30px 80px -30px color-mix(in srgb, var(--accent) 60%, transparent);
	}
	.lp-final-inner::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background-image: radial-gradient(rgba(255, 255, 255, 0.14) 1px, transparent 1px);
		background-size: 24px 24px;
		mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, #000, transparent 80%);
		-webkit-mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, #000, transparent 80%);
	}
	.lp-final-cast {
		display: flex;
		justify-content: center;
		padding-left: 10px;
		margin-bottom: 1.6rem;
	}
	.lp-final-cast img {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		object-fit: cover;
		object-position: 50% 12%;
		margin-left: -10px;
		border: 1.5px solid rgba(255, 255, 255, 0.85);
		box-shadow: 0 8px 20px -6px rgba(0, 0, 0, 0.5);
		position: relative;
		z-index: calc(5 - var(--i));
	}
	.lp-final h2 {
		font-family: var(--font-display);
		font-size: clamp(1.9rem, 4.5vw, 3.1rem);
		margin: 0 0 1.8rem;
		line-height: 1.12;
		color: #fff;
	}
	.lp-final-grad {
		background: linear-gradient(90deg, #fff, color-mix(in srgb, var(--cyan) 70%, #fff));
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	.lp-final-fineprint {
		color: rgba(255, 255, 255, 0.8);
		font-size: 0.88rem;
		margin-top: 1.3rem;
	}

	/* ── Footer ── */
	.lp-footer {
		max-width: var(--lp-max);
		margin: 0 auto;
		padding: 1rem var(--lp-pad) 2rem;
		font-size: 0.85rem;
		color: var(--text-dim);
	}
	.lp-footer-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.55fr) minmax(0, 0.55fr);
		gap: 2rem 3rem;
		padding-bottom: 1.6rem;
		border-bottom: 1px solid var(--border);
	}
	.lp-footer-brand {
		display: flex;
		align-items: flex-start;
		gap: 0.7rem;
		max-width: 28rem;
	}
	.lp-footer-brand strong {
		display: block;
		color: var(--text);
		font-weight: 700;
		margin-bottom: 0.3rem;
	}
	.lp-footer-brand p {
		margin: 0;
		line-height: 1.55;
		font-size: 0.82rem;
	}
	.lp-footer nav {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.lp-footer-head {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text);
		margin: 0 0 0.5rem;
	}
	.lp-footer a {
		display: inline-flex;
		align-items: center;
		min-height: 32px;
		color: var(--text-dim);
		text-decoration: none;
		transition: color 0.15s ease;
	}
	.lp-footer a:hover {
		color: var(--accent-text);
	}
	.lp-footer-bottom {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.5rem 1.5rem;
		padding-top: 1.2rem;
		font-size: 0.78rem;
	}
	.lp-footer-status {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* ── Responsive ── */
	@media (max-width: 1100px) {
		/* Tablet: a vertical timeline — the number rail on the left, no orphan slot. */
		.lp-steps {
			grid-template-columns: 1fr;
			max-width: 44rem;
			margin-inline: auto;
			padding-left: 3.4rem;
			gap: 0.9rem;
		}
		.lp-steps::before {
			left: 1rem;
			right: auto;
			top: 1.2rem;
			bottom: 1.2rem;
			width: 2px;
			height: auto;
			background: linear-gradient(
				180deg,
				color-mix(in srgb, var(--accent) 25%, transparent),
				color-mix(in srgb, var(--accent) 55%, transparent)
			);
		}
		.lp-step {
			padding: 1.2rem 1.3rem;
		}
		.lp-step-n {
			position: absolute;
			left: calc(-2.4rem - 17px);
			top: 1.2rem;
			margin: 0;
		}
		.lp-features {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.lp-feature-sheet,
		.lp-feature-cast {
			grid-column: 1 / -1;
		}
		.lp-feature-sheet {
			order: 1;
		}
		.lp-feature-cast {
			order: 2;
		}
		.lp-features > article {
			order: 3;
		}
		.lp-plans {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 960px) {
		.lp-hero-inner {
			grid-template-columns: 1fr;
			grid-template-areas:
				'top'
				'stage'
				'ticks';
			row-gap: 1.6rem;
			text-align: center;
		}
		.lp-hero-top {
			max-width: 40rem;
			margin-inline: auto;
		}
		.lp-sub {
			margin-inline: auto;
		}
		.lp-hero-cta,
		.lp-ticks {
			justify-content: center;
		}
		.lp-ticks {
			margin-top: 0;
		}
		.lp-stage {
			max-width: 440px;
		}
		.lp-section-head-split {
			grid-template-columns: 1fr;
			text-align: center;
			max-width: 46rem;
		}
		.lp-section-head-split .lp-section-sub {
			justify-self: center;
			padding-bottom: 0;
		}
		.lp-feature-sheet,
		.lp-feature-cast {
			grid-template-columns: 1fr;
			gap: 1.2rem;
		}
		.lp-trust-layout {
			grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
			gap: 1.5rem;
		}
		.lp-receipt-row,
		.lp-faq-layout {
			grid-template-columns: 1fr;
		}
		.lp-faq-layout .lp-section-head {
			position: static;
			text-align: center;
			margin-inline: auto;
		}
		.lp-proof-grid {
			grid-template-columns: repeat(2, 1fr);
		}
		.lp-footer-grid {
			grid-template-columns: 1fr 1fr;
		}
		.lp-footer-brand {
			grid-column: 1 / -1;
		}
	}

	@media (max-width: 720px) {
		.lp-nav {
			gap: 0.75rem;
		}
		.lp-nav-links {
			display: none;
		}
		.lp-nav-links.is-open {
			display: flex;
			flex-direction: column;
			position: absolute;
			left: 0;
			right: 0;
			top: 100%;
			padding: 0.5rem var(--lp-pad) 1rem;
			background: var(--bg);
			border-bottom: 1px solid var(--border);
			box-shadow: 0 20px 40px -20px rgba(15, 23, 42, 0.3);
		}
		.lp-nav-links.is-open a {
			min-height: 48px;
			font-size: 1rem;
			border-radius: 12px;
		}
		.lp-nav-links.is-open .lp-nav-links-login {
			display: inline-flex !important;
			border-top: 1px solid var(--border);
			border-radius: 0;
			margin-top: 0.3rem;
			padding-top: 0.3rem;
		}
		.lp-nav-cta {
			margin-left: auto;
		}
		.lp-nav-cta .lp-link {
			display: none;
		}
		.lp-menu-btn {
			display: inline-flex;
		}
		.lp-features,
		.lp-plans {
			grid-template-columns: 1fr;
		}
		.lp-feature-sheet,
		.lp-feature-cast {
			grid-column: auto;
		}
		.lp-cast {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.lp-hero-cta .lp-btn {
			width: 100%;
		}
		.lp-hero {
			padding-top: 1.6rem;
		}
		.lp-hero-inner {
			row-gap: 1.2rem;
		}
		.lp-stage {
			aspect-ratio: 1 / 0.95;
			max-width: 340px;
		}
		.lp-eyebrow-long {
			display: none;
		}
		.lp-eyebrow-short {
			display: inline;
		}
		.lp-eyebrow {
			margin-bottom: 0.9rem;
		}
		.lp-hero h1 {
			font-size: clamp(2.1rem, 9.5vw, 2.6rem);
			margin-bottom: 0.9rem;
		}
		.lp-sub {
			font-size: 1rem;
			margin-bottom: 1.2rem;
		}
		.lp-btn-tail {
			display: none;
		}
		/* Platform strip: one scrolling row with faded edges instead of five ragged rows. */
		.lp-strip-inner {
			align-items: stretch;
		}
		.lp-strip-label {
			text-align: center;
		}
		.lp-strip-list {
			flex-wrap: nowrap;
			justify-content: flex-start;
			overflow-x: auto;
			scrollbar-width: none;
			padding: 0.2rem 1.5rem;
			margin-inline: calc(-1 * var(--lp-pad));
			mask-image: linear-gradient(90deg, transparent, #000 1.5rem, #000 calc(100% - 1.5rem), transparent);
			-webkit-mask-image: linear-gradient(90deg, transparent, #000 1.5rem, #000 calc(100% - 1.5rem), transparent);
		}
		.lp-strip-list::-webkit-scrollbar {
			display: none;
		}
		.lp-receipt-row {
			padding: 1rem;
		}
		.lp-trust-layout {
			grid-template-columns: 1fr;
		}
		.lp-footer-grid {
			grid-template-columns: 1fr 1fr;
		}
		/* Phones: the popular plan first, feature lists folded behind a summary
		   so price + CTA stay in view. */
		.lp-plan.featured {
			order: -1;
		}
		.lp-plan-details summary {
			display: flex;
		}
	}

	@media (max-width: 480px) {
		.lp-proof-grid {
			grid-template-columns: 1fr 1fr;
			gap: 1rem 0.6rem;
		}
		.lp-proof-item dt {
			font-size: 1.5rem;
		}
		.lp-proof-long {
			display: none;
		}
		.lp-proof-short {
			display: inline;
		}
		/* Two chips, not three, and nothing under 11px: the approval story is
		   told full-size in the queue frame further down. */
		.lp-chip-approve {
			display: none;
		}
		.lp-chip {
			font-size: 0.72rem;
		}
		.lp-tag-long {
			display: none;
		}
		.lp-tag-short {
			display: inline;
		}
		.lp-card-tag {
			font-size: 0.68rem;
			top: auto;
			bottom: 5%;
		}
		.lp-chip-verified {
			top: -3%;
		}
		.lp-chip-price {
			bottom: 0;
		}
		.lp-queue-row {
			grid-template-columns: auto minmax(0, 1fr);
		}
		.lp-queue-row .lp-chip-actions,
		.lp-queue-done {
			grid-column: 2;
		}
		.lp-footer-grid {
			grid-template-columns: 1fr;
		}
	}

	/* The comparison table is the page's argument, so it must survive a phone.
	   Each row becomes a compact card: the capability on top, then the three
	   verdicts side by side under tiny column labels. Nothing is hidden. */
	@media (max-width: 768px) {
		.lp-table-wrap {
			background: transparent;
			border: none;
			box-shadow: none;
			padding: 0;
		}
		.lp-table {
			min-width: 0;
			display: block;
		}
		.lp-table thead {
			display: none;
		}
		.lp-table tbody {
			display: block;
		}
		.lp-table tr {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 0.4rem;
			border: 1px solid var(--border);
			border-radius: 14px;
			margin-bottom: 0.6rem;
			padding: 0.8rem 0.8rem 0.7rem;
			background: var(--bg);
			box-shadow: var(--shadow-sm);
		}
		.lp-table tbody th {
			grid-column: 1 / -1;
			display: block;
			border: none;
			padding: 0 0 0.5rem;
			font-weight: 600;
			font-size: 0.92rem;
		}
		.lp-table td {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: flex-start;
			gap: 0.35rem;
			border: 1px solid var(--border);
			border-radius: 10px;
			padding: 0.45rem 0.3rem 0.5rem;
			text-align: center;
			font-size: 0.74rem;
			line-height: 1.25;
			min-height: 4.4rem;
		}
		/* Column labels only exist on mobile, where the header row is gone. */
		.lp-table td::before {
			content: attr(data-col);
			color: var(--text-dim);
			font-size: 0.6rem;
			font-weight: 700;
			letter-spacing: 0.06em;
			text-transform: uppercase;
		}
		.lp-td-ours,
		.lp-table tbody tr:last-child .lp-td-ours {
			border-radius: 10px;
			border-color: color-mix(in srgb, var(--accent) 30%, transparent);
		}
		.lp-td-ours::before {
			color: var(--accent-text);
		}
		.lp-partial {
			font-size: 0.72rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lp-btn,
		.lp-nav-links a,
		.lp-link,
		.lp-step,
		.lp-feature,
		.lp-btn svg,
		.lp-link-arrow::after {
			transition: none;
		}
		.lp-btn:hover,
		.lp-step:hover,
		.lp-feature:hover {
			transform: none;
		}
		.lp-chip {
			animation: none;
		}
	}
</style>
