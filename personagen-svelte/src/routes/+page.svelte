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
	 * Signed-in visitors never see this — they are sent straight to the dashboard.
	 */
	import { goto } from '$app/navigation';

	let { data } = $props();

	// Authenticated users get the app, not the pitch. `replaceState` keeps the
	// landing page out of their history so Back doesn't bounce them through it.
	$effect(() => {
		if (data?.session) goto('/dashboard', { replaceState: true });
	});


	const PLATFORMS = [
		'Instagram',
		'TikTok',
		'YouTube',
		'Facebook',
		'X',
		'Threads',
		'LinkedIn',
		'Bluesky',
		'Pinterest',
		'Reddit',
		'Google Business',
		'Telegram',
		'Snapchat'
	];

	const STEPS = [
		{
			n: '01',
			title: 'Pick the traits',
			time: '~30 sec',
			body: 'Guided fields with real options. Set the ones that matter, leave the rest on Best Fit. No prompt writing required.'
		},
		{
			n: '02',
			title: 'See the preview',
			time: '8–30 sec',
			body: 'A photoreal render of your persona, lit cleanly and on brief. Regenerate as many times as you like before you commit.'
		},
		{
			n: '03',
			title: 'Lock the identity',
			time: 'Yours forever',
			body: 'A five-stage reference set locks the face. The same person in every photo, video and clip you ship.'
		},
		{
			n: '04',
			title: 'Ground it in your brand',
			time: '~60 sec',
			body: 'Point it at your store. It reads your products, prices and photos, and builds the persona’s angle around what you actually sell.'
		},
		{
			n: '05',
			title: 'Connect and set autonomy',
			time: '~90 sec',
			body: 'Link the accounts, choose Advisor, Semi-autonomous or Fully autonomous, set the cadence. Then it runs.'
		}
	];

	const FEATURES = [
		{
			title: 'One face. Ten thousand posts.',
			body: 'A five-stage reference set — character sheet, full body, side profiles, close-up, feature grid — locks the identity. Not a prompt that hopes. An identity that holds.'
		},
		{
			title: 'Publishes to 13 platforms. Proves it landed.',
			body: 'We never mark a post published until the platform confirms it. And where a platform makes deletion impossible, we say so plainly instead of pretending.'
		},
		{
			title: 'It knows your actual business.',
			body: 'Point it at your store. It reads your products, prices and photos, so every persona’s content is built around what you actually sell.'
		},
		{
			title: 'Three levels of autonomy. Your call.',
			body: 'Advisor suggests. Semi-autonomous drafts and waits for you. Fully autonomous runs inside your guardrails. Per persona, changeable any time.'
		},
		{
			title: 'No two personas look or sound alike.',
			body: 'Run ten and they will not converge. Every new persona is checked against your whole roster — look, angle, audience, voice — and forced to be different.'
		},
		{
			title: 'Every cent, on the record.',
			body: 'Per-persona, per-post spend, shown in your currency before you confirm. Text posts are free. Your balance never expires. No guessing.'
		}
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

	const PLANS = [
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
			cta: 'Start free',
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
			cta: 'Start free',
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

	const FAQS = [
		{
			q: 'How does the media wallet work?',
			a: 'Every plan includes a monthly wallet for AI images, video and voice, shown as money in your currency. Text posts cost nothing, so a persona can post six times a day without touching it. Every generation shows its price before you confirm. Run low and you top up at par: $25 buys $25.00 of generation, and it never expires.'
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
			a: 'Rules differ by platform and are tightening. Our position is that disclosure is the durable strategy, not stealth: generated video carries an AI-generated marker, and we would rather you pass a review than win a week.'
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
</svelte:head>

<div class="lp">
	<header class="lp-nav">
		<a class="lp-brand" href="/">
			<span class="lp-brand-mark" aria-hidden="true"></span>
			PersonaGen
		</a>
		<nav class="lp-nav-links" aria-label="Main">
			<a href="#how">How it works</a>
			<a href="#compare">Compare</a>
			<a href="#pricing">Pricing</a>
		</nav>
		<div class="lp-nav-cta">
			<a class="lp-link" href="/login">Log in</a>
			<a class="lp-btn lp-btn-sm" href="/signup">Start free</a>
		</div>
	</header>

	<section class="lp-hero">
		<p class="lp-eyebrow">The AI persona platform that runs the account</p>
		<h1>
			Your AI personas.<br />
			<span class="lp-grad">Posting on 13 platforms.</span><br />
			While you sleep.
		</h1>
		<p class="lp-sub">
			Build photoreal personas with a locked face and voice, ground them in your real brand and
			products, and let them generate, schedule and publish — with you approving every post, and
			every dollar accounted for.
		</p>
		<div class="lp-hero-cta">
			<a class="lp-btn" href="/signup">Create your first persona — free</a>
			<a class="lp-link-arrow" href="#how">See how it works →</a>
		</div>
		<p class="lp-fineprint">No credit card. Your first persona live in about four minutes.</p>
	</section>

	<section class="lp-strip" aria-label="Supported platforms">
		<p class="lp-strip-label">Publishes and verifies on</p>
		<ul class="lp-strip-list">
			{#each PLATFORMS as p}
				<li>{p}</li>
			{/each}
		</ul>
	</section>

	<section class="lp-section" id="how">
		<h2>From nothing to a running account in five steps.</h2>
		<p class="lp-section-sub">
			Most tools stop after step three. Steps four and five are the reason the account actually
			grows.
		</p>
		<ol class="lp-steps">
			{#each STEPS as s, i}
				<li class="lp-step" class:lp-step-ours={i >= 3}>
					<div class="lp-step-head">
						<span class="lp-step-n">{s.n}</span>
						<span class="lp-step-time">{s.time}</span>
					</div>
					<h3>{s.title}</h3>
					<p>{s.body}</p>
					{#if i >= 3}<span class="lp-only">Only here</span>{/if}
				</li>
			{/each}
		</ol>
	</section>

	<section class="lp-section lp-section-alt" id="compare">
		<h2>Everyone else sells you a face.</h2>
		<p class="lp-section-sub">
			Generation studios end at a download button. Schedulers post to one platform. Here is the
			whole picture, plainly.
		</p>
		<div class="lp-table-wrap">
			<table class="lp-table">
				<thead>
					<tr>
						<th scope="col"><span class="sr-only">Capability</span></th>
						<th scope="col">Generation studios</th>
						<th scope="col">Schedulers</th>
						<th scope="col" class="lp-th-ours">PersonaGen</th>
					</tr>
				</thead>
				<tbody>
					{#each COMPARISON as row}
						<tr>
							<th scope="row">{row.label}</th>
							{#each [['Generation studios', row.studio], ['Schedulers', row.scheduler]] as [col, cell]}
								<td data-col={col}>
									{#if cell === true}
										<span class="lp-yes">
											<svg viewBox="0 0 24 24" aria-hidden="true"
												><path
													d="M20 6L9 17l-5-5"
													fill="none"
													stroke="currentColor"
													stroke-width="2.5"
													stroke-linecap="round"
													stroke-linejoin="round"
												/></svg
											><span class="sr-only">Yes</span>
										</span>
									{:else if cell === false}
										<span class="lp-no" aria-hidden="true">—</span><span class="sr-only">No</span>
									{:else}
										<span class="lp-partial">{cell}</span>
									{/if}
								</td>
							{/each}
							<td class="lp-td-ours" data-col="PersonaGen">
								{#if row.us === true}
									<span class="lp-yes lp-yes-strong">
										<svg viewBox="0 0 24 24" aria-hidden="true"
											><path
												d="M20 6L9 17l-5-5"
												fill="none"
												stroke="currentColor"
												stroke-width="2.5"
												stroke-linecap="round"
												stroke-linejoin="round"
											/></svg
										><span class="sr-only">Yes</span>
									</span>
								{:else}
									<strong>{row.us}</strong>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="lp-mid-cta">
			<a class="lp-btn" href="/signup">Start free</a>
		</div>
	</section>

	<section class="lp-section" id="features">
		<h2>What you actually get.</h2>
		<div class="lp-features">
			{#each FEATURES as f}
				<article class="lp-feature">
					<h3>{f.title}</h3>
					<p>{f.body}</p>
				</article>
			{/each}
		</div>
	</section>

	<section class="lp-section lp-trust">
		<h2>Built for brands that answer for what they post.</h2>
		<p>
			Every generated video carries an AI-generated marker. Every post is approved before it goes
			out unless you say otherwise. Every publish is verified against the platform — and where a
			platform makes deletion impossible, we tell you plainly instead of pretending. Disclosure
			rules for synthetic content are arriving. We built for them first.
		</p>
	</section>

	<section class="lp-section lp-section-alt" id="pricing">
		<h2>Priced per brand. Not per seat.</h2>
		<p class="lp-section-sub">
			Every plan includes a monthly media wallet and unlimited text posts. Need more video this
			month? Top up at par, in your currency, and it never expires.
		</p>
		<div class="lp-plans">
			{#each PLANS as p}
				<article class="lp-plan" class:featured={p.featured}>
					{#if p.featured}<span class="lp-plan-badge">Most popular</span>{/if}
					<h3>{p.name}</h3>
					<p class="lp-plan-blurb">{p.blurb}</p>
					<p class="lp-plan-price">
						<span class="lp-cur">$</span>{p.price}<span class="lp-per">/mo</span>
					</p>
					<ul class="lp-plan-features">
						{#each p.features as f}
							<li>
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
								{f}
							</li>
						{/each}
					</ul>
					<a class="lp-btn lp-btn-block" class:lp-btn-ghost={!p.featured} href={p.href ?? '/signup'}>{p.cta}</a>
				</article>
			{/each}
		</div>
		<p class="lp-fineprint lp-center">
			Every plan includes verified publishing, the approval queue and the spend ledger. Cancel any
			time.
		</p>
	</section>

	<section class="lp-section" id="faq">
		<h2>Straight answers.</h2>
		<div class="lp-faqs">
			{#each FAQS as f}
				<details class="lp-faq">
					<summary>{f.q}</summary>
					<p>{f.a}</p>
				</details>
			{/each}
		</div>
	</section>

	<section class="lp-final">
		<h2>Everyone else sells you a face.<br /><span class="lp-grad">We run the account.</span></h2>
		<a class="lp-btn lp-btn-lg" href="/signup">Create your first persona — free</a>
		<p class="lp-fineprint">No credit card. Free generation credit to start. Cancel any time.</p>
	</section>

	<footer class="lp-footer">
		<span>© {year} PersonaGen</span>
		<nav aria-label="Footer">
			<a href="#how">How it works</a>
			<a href="#pricing">Pricing</a>
			<a href="/login">Log in</a>
		</nav>
	</footer>
</div>

<style>
	.lp {
		background: var(--bg);
		color: var(--text);
		font-family: var(--font-body);
		/* `clip`, not `hidden`: `hidden` makes this a scroll container, which both
		   breaks the sticky nav's containing block and still let the 640px
		   comparison table leak ~210px of document-level horizontal scroll at
		   375px. `clip` contains the overflow without creating a scroll port. */
		overflow-x: clip;
	}

	.lp h1,
	.lp h2 {
		font-family: var(--font-display);
		letter-spacing: -0.02em;
		line-height: 1.1;
	}

	.lp-nav {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		padding: 1.1rem clamp(1rem, 5vw, 4rem);
		position: sticky;
		top: 0;
		z-index: 20;
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--border);
	}
	.lp-brand {
		display: flex;
		align-items: center;
		min-height: 44px;
		gap: 0.5rem;
		font-weight: 700;
		font-size: 1.05rem;
		color: var(--text);
		text-decoration: none;
	}
	.lp-brand-mark {
		width: 22px;
		height: 22px;
		border-radius: 7px;
		background: var(--gradient);
	}
	.lp-nav-links {
		display: flex;
		gap: 1.4rem;
		margin-left: auto;
	}
	/* 44px min touch target — these are text links, but they are primary
	   navigation on a phone and were measuring 24–29px tall. */
	.lp-nav-links a,
	.lp-link {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: var(--text-muted);
		text-decoration: none;
		font-size: 0.9rem;
		transition: color 0.15s ease;
	}
	.lp-nav-links a:hover,
	.lp-link:hover {
		color: var(--accent-text);
	}
	.lp-nav-cta {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.lp-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
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
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease;
	}
	.lp-btn:hover {
		transform: translateY(-1px);
		box-shadow: 0 8px 24px color-mix(in srgb, var(--accent) 32%, transparent);
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
		padding: 0.55rem 1.1rem;
		font-size: 0.875rem;
	}
	.lp-btn-lg {
		padding: 1rem 2.2rem;
		font-size: 1.05rem;
	}
	.lp-btn-block {
		width: 100%;
		margin-top: auto;
	}
	.lp-btn-ghost {
		background: transparent;
		color: var(--accent-text);
		border: 1px solid var(--border-strong);
	}
	.lp-btn-ghost:hover {
		border-color: var(--accent);
		box-shadow: none;
	}
	.lp-link-arrow {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: var(--accent-text);
		text-decoration: none;
		font-weight: 500;
		font-size: 0.95rem;
	}

	.lp-hero {
		text-align: center;
		padding: clamp(3.5rem, 9vw, 7rem) clamp(1rem, 5vw, 4rem) clamp(2.5rem, 5vw, 4rem);
		max-width: 60rem;
		margin: 0 auto;
	}
	.lp-eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.14em;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--accent-text);
		margin: 0 0 1.2rem;
	}
	.lp-hero h1 {
		font-size: clamp(2.2rem, 6.5vw, 4.1rem);
		margin: 0 0 1.3rem;
	}
	.lp-grad {
		background: var(--gradient);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	.lp-sub {
		font-size: clamp(1rem, 2vw, 1.14rem);
		line-height: 1.65;
		color: var(--text-muted);
		max-width: 44rem;
		margin: 0 auto 2rem;
	}
	.lp-hero-cta {
		display: flex;
		flex-wrap: wrap;
		gap: 1.2rem;
		align-items: center;
		justify-content: center;
	}
	.lp-fineprint {
		font-size: 0.82rem;
		color: var(--text-dim);
		margin-top: 1.1rem;
	}
	.lp-center {
		text-align: center;
	}

	.lp-strip {
		border-block: 1px solid var(--border);
		padding: 1.6rem clamp(1rem, 5vw, 4rem);
		text-align: center;
		background: var(--surface);
	}
	.lp-strip-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--text-dim);
		margin: 0 0 0.9rem;
	}
	.lp-strip-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.4rem;
		justify-content: center;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.lp-strip-list li {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-muted);
	}

	.lp-section {
		padding: clamp(3rem, 7vw, 5.5rem) clamp(1rem, 5vw, 4rem);
		max-width: 72rem;
		margin: 0 auto;
	}
	.lp-section-alt {
		background: var(--surface);
		max-width: none;
		border-block: 1px solid var(--border);
	}
	.lp-section-alt > * {
		max-width: 72rem;
		margin-inline: auto;
	}
	.lp-section h2 {
		font-size: clamp(1.6rem, 3.6vw, 2.5rem);
		margin: 0 0 0.75rem;
		text-align: center;
	}
	.lp-section-sub {
		text-align: center;
		color: var(--text-muted);
		max-width: 42rem;
		margin: 0 auto 2.8rem;
		line-height: 1.6;
	}

	/* 190px, not 230px: the section's content box is ~1024px, so a 230px minimum
	   fits only four across and orphans step 5 on its own row — which reads as a
	   broken layout rather than a five-step sequence. */
	.lp-steps {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		gap: 1rem;
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.lp-step {
		position: relative;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 1.4rem;
	}
	.lp-step-ours {
		border-color: color-mix(in srgb, var(--accent) 40%, transparent);
		background: var(--accent-soft);
	}
	.lp-step-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 0.7rem;
	}
	.lp-step-n {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--accent-text);
	}
	.lp-step-time {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
	}
	.lp-step h3 {
		font-size: 1.05rem;
		margin: 0 0 0.45rem;
	}
	.lp-step p {
		font-size: 0.88rem;
		line-height: 1.6;
		color: var(--text-muted);
		margin: 0;
	}
	.lp-only {
		display: inline-block;
		margin-top: 0.8rem;
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent-text);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		border-radius: 999px;
		padding: 0.15rem 0.55rem;
	}

	/* `clip` rather than `auto`+ancestor-hidden: the 640px table is a wider-than-
	   viewport descendant, and with `overflow-x: auto` alone the documentElement
	   still gained ~210px of horizontal scroll on a 375px screen even though the
	   wrapper itself was scrolling correctly. `contain: inline-size` stops the
	   intrinsic width propagating up. Verified at 375px: window.scrollX stays 0. */
	.lp-table-wrap {
		overflow-x: auto;
		max-width: 100%;
		contain: inline-size;
	}
	.lp-table {
		width: 100%;
		border-collapse: collapse;
		min-width: 640px;
	}
	.lp-table th,
	.lp-table td {
		padding: 0.85rem 1rem;
		text-align: center;
		border-bottom: 1px solid var(--border);
		font-size: 0.9rem;
	}
	.lp-table thead th {
		font-size: 0.76rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
		font-weight: 600;
	}
	.lp-table tbody th {
		text-align: left;
		font-weight: 500;
		color: var(--text);
	}
	.lp-th-ours {
		color: var(--accent-text);
		background: var(--accent-soft);
		border-radius: 12px 12px 0 0;
	}
	.lp-td-ours {
		background: var(--accent-soft);
		font-weight: 600;
	}
	.lp-yes {
		display: inline-flex;
		color: var(--success-text);
	}
	.lp-yes svg {
		width: 18px;
		height: 18px;
	}
	.lp-yes-strong {
		color: var(--accent-text);
	}
	.lp-no {
		color: var(--text-dim);
	}
	.lp-partial {
		font-size: 0.82rem;
		color: var(--text-dim);
	}
	.lp-mid-cta {
		text-align: center;
		margin-top: 2.2rem;
	}

	.lp-features {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1rem;
	}
	.lp-feature {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 1.5rem;
	}
	.lp-feature h3 {
		font-size: 1.08rem;
		margin: 0 0 0.55rem;
	}
	.lp-feature p {
		font-size: 0.9rem;
		line-height: 1.65;
		color: var(--text-muted);
		margin: 0;
	}

	.lp-trust {
		max-width: 46rem;
		text-align: center;
	}
	.lp-trust p {
		color: var(--text-muted);
		line-height: 1.75;
		font-size: 1rem;
	}

	.lp-plans {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
		gap: 1.1rem;
		align-items: stretch;
	}
	.lp-plan {
		display: flex;
		flex-direction: column;
		position: relative;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 18px;
		padding: 1.8rem 1.5rem;
	}
	.lp-plan.featured {
		border: 2px solid var(--accent);
		box-shadow: 0 12px 40px color-mix(in srgb, var(--accent) 16%, transparent);
	}
	.lp-plan-badge {
		position: absolute;
		top: -0.7rem;
		left: 50%;
		transform: translateX(-50%);
		background: var(--gradient-cta);
		color: #fff;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 0.28rem 0.8rem;
		border-radius: 999px;
		white-space: nowrap;
	}
	.lp-plan h3 {
		font-size: 1.15rem;
		margin: 0 0 0.3rem;
	}
	.lp-plan-blurb {
		font-size: 0.85rem;
		color: var(--text-dim);
		margin: 0 0 1.1rem;
	}
	.lp-plan-price {
		font-family: var(--font-display);
		font-size: 2.6rem;
		font-weight: 700;
		margin: 0 0 1.3rem;
		line-height: 1;
	}
	.lp-cur {
		font-size: 1.3rem;
		vertical-align: super;
		margin-right: 0.1rem;
	}
	.lp-per {
		font-family: var(--font-body);
		font-size: 0.9rem;
		font-weight: 400;
		color: var(--text-dim);
	}
	.lp-plan-features {
		list-style: none;
		padding: 0;
		margin: 0 0 1.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.lp-plan-features li {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--text-muted);
		line-height: 1.45;
	}
	.lp-plan-features svg {
		width: 15px;
		height: 15px;
		flex-shrink: 0;
		margin-top: 0.18rem;
		color: var(--accent-text);
	}

	.lp-faqs {
		max-width: 44rem;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.lp-faq {
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		padding: 0 1.2rem;
	}
	.lp-faq summary {
		cursor: pointer;
		padding: 1rem 0;
		font-weight: 600;
		font-size: 0.95rem;
		list-style: none;
	}
	.lp-faq summary::-webkit-details-marker {
		display: none;
	}
	.lp-faq summary::after {
		content: '+';
		float: right;
		color: var(--accent-text);
		font-weight: 400;
		font-size: 1.2rem;
		line-height: 1;
	}
	.lp-faq[open] summary::after {
		content: '−';
	}
	.lp-faq p {
		margin: 0 0 1.1rem;
		font-size: 0.9rem;
		line-height: 1.7;
		color: var(--text-muted);
	}

	.lp-final {
		text-align: center;
		padding: clamp(3.5rem, 8vw, 6rem) clamp(1rem, 5vw, 4rem);
		border-top: 1px solid var(--border);
	}
	.lp-final h2 {
		font-family: var(--font-display);
		font-size: clamp(1.8rem, 4.5vw, 3rem);
		margin: 0 0 1.8rem;
		line-height: 1.15;
	}

	.lp-footer {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		padding: 1.6rem clamp(1rem, 5vw, 4rem);
		border-top: 1px solid var(--border);
		font-size: 0.85rem;
		color: var(--text-dim);
	}
	.lp-footer nav {
		display: flex;
		gap: 1.3rem;
	}
	.lp-footer a {
		color: var(--text-dim);
		text-decoration: none;
	}
	.lp-footer a:hover {
		color: var(--accent-text);
	}

	@media (max-width: 720px) {
		.lp-nav-links {
			display: none;
		}
		.lp-nav-cta {
			margin-left: auto;
		}
	}

	/* The comparison table is the page's argument, so it must survive a phone.
	   Rather than forcing a 640px sideways scroll (which also leaked into
	   document-level panning), the grid collapses: each row becomes a small card
	   with its three verdicts inline. Nothing is hidden — the competitor columns
	   stay, they just stack. */
	@media (max-width: 660px) {
		.lp-table {
			min-width: 0;
		}
		.lp-table thead {
			display: none;
		}
		.lp-table,
		.lp-table tbody,
		.lp-table tr,
		.lp-table th,
		.lp-table td {
			display: block;
			width: 100%;
		}
		.lp-table tr {
			border: 1px solid var(--border);
			border-radius: 12px;
			margin-bottom: 0.6rem;
			padding: 0.7rem 0.9rem;
			background: var(--bg);
		}
		.lp-table tbody th {
			border: none;
			padding: 0 0 0.5rem;
			font-weight: 600;
			font-size: 0.9rem;
		}
		.lp-table td {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 1rem;
			border: none;
			padding: 0.28rem 0;
			text-align: right;
			font-size: 0.82rem;
		}
		/* Row labels only exist on mobile, where the header row is gone. */
		.lp-table td::before {
			content: attr(data-col);
			color: var(--text-dim);
			font-size: 0.74rem;
			text-align: left;
		}
		.lp-td-ours {
			border-radius: 8px;
			margin-top: 0.3rem;
			padding: 0.4rem 0.5rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lp-btn,
		.lp-nav-links a,
		.lp-link {
			transition: none;
		}
		.lp-btn:hover {
			transform: none;
		}
	}
</style>
