<script lang="ts">
	import { confirmAction } from '$lib/stores/confirm.svelte';
	import { onMount, tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import PageShell from '$lib/components/ui/PageShell.svelte';
	import { plural } from '$lib/plural';
	import { instantShort } from '$lib/datetime';

	let { data } = $props();

	let buying = $state<string | null>(null);
	let error = $state<string | null>(null);
	let banner = $state<string | null>(
		data.status === 'success'
			? 'Payment received. Your balance updates within a few seconds.'
			: data.status === 'subscribed'
				? 'Subscription active. Your included media credit lands within a few seconds.'
				: data.status === 'cancel'
					? 'Checkout cancelled. Nothing was charged.'
					: null
	);
	let subscribing = $state<string | null>(null);

	let cancelling = $state(false);

	async function setCancellation(resume: boolean) {
		error = null;
		if (
			!resume &&
			!(await confirmAction({
				title: 'Cancel your plan?',
				body: 'You keep it until the end of the period you have paid for, and the credit already in your wallet stays yours.',
				tone: 'caution',
				confirmLabel: 'Cancel plan',
				cancelLabel: 'Keep my plan'
			}))
		)
			return;
		cancelling = true;
		try {
			const res = await fetch('/api/billing/cancel', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ resume })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
			banner = body.message;
			await invalidateAll();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			cancelling = false;
		}
	}

	async function subscribe(plan: string) {
		error = null;
		subscribing = plan;
		try {
			const res = await fetch('/api/billing/subscribe', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ plan })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok || !body.url) throw new Error(body.error || `HTTP ${res.status}`);
			window.location.href = body.url;
		} catch (e) {
			error = (e as Error).message;
			subscribing = null;
		}
	}

	// After a successful checkout the webhook lands a beat later than the
	// redirect; poll the page data briefly so the new balance appears without
	// a manual refresh.
	onMount(() => {
		if (data.status !== 'success' && data.status !== 'subscribed') return;
		let n = 0;
		const t = setInterval(async () => {
			n++;
			await invalidateAll();
			if (n >= 6) clearInterval(t);
		}, 2000);
		return () => clearInterval(t);
	});

	async function buy(packId: string) {
		error = null;
		buying = packId;
		try {
			const res = await fetch('/api/billing/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ packId })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok || !body.url) throw new Error(body.error || `HTTP ${res.status}`);
			window.location.href = body.url;
		} catch (e) {
			error = (e as Error).message;
			buying = null;
		}
	}

	let requesting = $state<string | null>(null);
	let requestedPack = $state<string | null>(null);
	async function requestTopup(packId: string) {
		error = null;
		requesting = packId;
		try {
			const res = await fetch('/api/billing/request-topup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ packId })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
			requestedPack = packId;
			await invalidateAll();
			// The list re-renders; put focus back on the button that was pressed
			// rather than letting it fall to <main> (round-4 re-audit).
			await tick();
			document.querySelector<HTMLElement>(`[data-pack="${packId}"]`)?.focus();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			requesting = null;
		}
	}

	// In the viewer's locale AND zone on the server too (see instantShort).
	const when = (iso: string) => instantShort(iso);

	const kindLabel: Record<string, string> = {
		grant: 'Credit added',
		purchase: 'Purchase',
		debit: 'Generation',
		refund: 'Refund',
		adjustment: 'Adjustment',
		set: 'Balance set'
	};

	const low = $derived(data.billingMode !== 'unmetered' && data.balance < 300);
	const empty = $derived(data.billingMode !== 'unmetered' && data.balance <= 0);
</script>

<PageShell title="Billing" description="What you have, what it buys, and what each generation costs.">
	<div class="billing">
	{#if banner}
		<div class="banner" class:ok={data.status === 'success'} role="status">
			{banner}
			<button class="banner-x" onclick={() => (banner = null)} aria-label="Dismiss">×</button>
		</div>
	{/if}

	<section class="hero">
		<div class="hero-main">
			<!-- The balance is a number this page reports, not the page's name —
			     the h1 used to BE the currency amount, which is why the page named
			     itself nowhere on screen. PageShell owns the name now. -->
			<p class="eyebrow">Your balance</p>
			{#if data.billingMode === 'unmetered'}
				<p class="amount">∞</p>
				<p class="sub">Complimentary account. Generations are not charged.</p>
			{:else}
				<p class="amount" class:low class:empty>{data.balanceFormatted}</p>
				<p class="sub">
					{#if data.currency !== 'USD'}Shown in {data.currency} · exactly {data.balanceUsd} ·{/if}
					{#if empty}
						Your wallet is empty. Nothing more can be generated — even a text post pays for its writing — so top up to continue.
					{:else}
						≈ <strong>{data.buys.imagePosts}</strong> {plural(data.buys.imagePosts, 'image post')}, or
						<strong>{data.buys.videoPosts}</strong> {plural(data.buys.videoPosts, 'video post')}, or
						<strong>{data.buys.talkingHeads}</strong> {plural(data.buys.talkingHeads, 'talking-head clip')}. A text
						post costs only its writing — about {data.textPostPrice}.
					{/if}
				</p>
			{/if}
			{#if data.workspaces.length > 0}
				<!-- The sidebar pill shows the wallet that PAYS, which for a member is
				     the workspace owner's. Without this line the two numbers differ on
				     screen with nothing connecting them. -->
				<p class="sub hero-elsewhere">
					This is your personal wallet. Personas in
					{#each data.workspaces as w, i (w.id)}{i > 0 ? ', ' : ''}<strong>{w.name}</strong>{/each}
					bill the owner instead —
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a fragment
					     on this same page, not a route: resolve() would be wrong here. -->
					<a href="#workspace-wallets">see those balances</a>.
				</p>
			{/if}
		</div>
		<ul class="promises">
			<li><strong>Never expires.</strong> Credit sits in your wallet until you use it.</li>
			<li><strong>Price before you spend.</strong> Every generation shows its cost first.</li>
			<li><strong>Only what actually ran.</strong> If a generation dies partway, you pay for the images it had already made and nothing for the rest.</li>
		</ul>
	</section>

	{#if data.plans.enabled && data.billingMode !== 'unmetered'}
		<section class="plans">
			<div class="packs-head">
				<h2>Plans</h2>
				<p class="muted">
					Priced per brand, not per seat. Every plan includes a monthly media wallet that resets at renewal; credit
					you buy on top never expires.
					{#if data.plans.current}
						<span class="soon">
							You are on the {data.plans.current.plan} plan{data.plans.current.periodEnd
								? data.plans.current.cancelAtPeriodEnd
									? ` · ends ${new Date(data.plans.current.periodEnd).toLocaleDateString()}`
									: ` · renews ${new Date(data.plans.current.periodEnd).toLocaleDateString()}`
								: ''}.
						</span>
					{/if}
				</p>
				{#if data.plans.current?.cancellable}
					<div class="plan-actions">
						{#if data.plans.current.cancelAtPeriodEnd}
							<button class="buy ghost" disabled={cancelling} onclick={() => setCancellation(true)}>
								{cancelling ? 'Working…' : 'Keep my plan'}
							</button>
						{:else}
							<button class="buy ghost" disabled={cancelling} onclick={() => setCancellation(false)}>
								{cancelling ? 'Working…' : 'Cancel plan'}
							</button>
						{/if}
					</div>
				{/if}
			</div>
			<div class="pack-grid">
				{#each data.plans.catalog as p (p.plan)}
					<article class="pack" class:featured={p.plan === 'brand' || p.plan === data.wantedPlan}>
						{#if p.plan === 'brand'}<span class="badge">Most popular</span>{/if}
						<h3>{p.name}</h3>
						<p class="price">{p.usd}<span class="local"> / month{#if p.local} ≈ {p.local}{/if}</span></p>
						<p class="worth"><strong>{p.included}</strong> of media generation every month</p>
						<ul class="plan-features">
							{#each p.features.slice(0, 5) as f (f)}<li>{f}</li>{/each}
						</ul>
						<button class="buy" class:ghost={p.plan !== 'brand'} disabled={subscribing !== null || data.plans.current?.plan === p.plan} onclick={() => subscribe(p.plan)}>
							{data.plans.current?.plan === p.plan ? 'Current plan' : subscribing === p.plan ? 'Opening checkout…' : `Choose ${p.name}`}
						</button>
					</article>
				{/each}
			</div>
			<p class="fineprint">Monthly, cancel any time. Included credit resets each renewal; purchased credit is never touched.</p>
		</section>
	{/if}

	{#if data.billingMode !== 'unmetered'}
		<section class="packs">
			<div class="packs-head">
				<h2>Top up</h2>
				<p class="muted">
					Charged in USD at par — a dollar buys a dollar of generation — and the bigger packs add bonus
					credit on top.
					{#if !data.paymentsOpen}<span class="soon"
							>Card payments are not switched on yet. Pick a pack and we'll load it into your wallet by
							hand — the request comes straight to us, privately, with the amount on it.</span
						>{/if}
					{#if data.workspaces.length > 0}
						<!-- A seat was invited to top up a wallet the same page says does not pay
						     for their work. Say which work this wallet funds. -->
						<span class="soon"
							>This tops up <strong>your personal wallet</strong>, used only for personas of your own.
							Personas in {#each data.workspaces as w, i (w.id)}{i > 0 ? ', ' : ''}<strong
									>{w.name}</strong
								>{/each} are funded by the workspace owner.</span
						>
					{/if}
				</p>
				{#if data.topupLoaded?.length}
					<ul class="topup-pending topup-loaded" aria-label="Your recent top-up requests">
						{#each data.topupLoaded as r (r.id)}
							<li>
								<strong>{r.title.replace(/^Top-up request · /, '')}</strong>
								{#if r.loaded}
									<!-- Asserted from the ledger grant, never from the ticket. -->
									— {r.amount} loaded {when(r.updated_at)};
									it is in the balance above.
								{:else}
									— closed {when(r.updated_at)} without loading credit. If you still need it, ask again below.
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
				{#if data.topupRequests?.length}
					<ul class="topup-pending" aria-label="Your open top-up requests">
						{#each data.topupRequests as r (r.id)}
							<li>
								<strong>{r.title.replace(/^Top-up request · /, '')}</strong> requested {when(r.created_at)}
								— we'll load it and it will appear in your balance.
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<div class="pack-grid">
				{#each data.packs as p (p.id)}
					<article class="pack" class:featured={p.featured}>
						{#if p.featured}<span class="badge">Most popular</span>{/if}
						<h3>{p.label}</h3>
						<p class="price">{p.usd}{#if p.local}<span class="local"> ≈ {p.local}</span>{/if}</p>
						<p class="worth">
							<strong>{p.worth}</strong> of generation
							{#if p.bonus > 0}<span class="bonus">+{Math.round((p.bonus / (p.credits - p.bonus)) * 100)}% bonus</span>{/if}
						</p>
						<p class="buys">
							≈ {p.buys.imagePosts} {plural(p.buys.imagePosts, 'image post')} · {p.buys.videoPosts}
							{plural(p.buys.videoPosts, 'video post')}
						</p>
						{#if !data.paymentsOpen}
							<!-- The disabled tier carries the way forward itself. It used to say
							     only "Coming soon", with the manual route explained in a
							     paragraph above that a user scanning the cards never reads. -->
							<button
								class="buy ghost"
								disabled={requesting !== null}
								aria-describedby="topup-note"
								data-pack={p.id}
								onclick={() => requestTopup(p.id)}
							>
								{requesting === p.id
									? 'Sending…'
									: requestedPack === p.id
										? 'Requested ✓'
										: `Ask us to load ${p.usd}`}
							</button>
						{:else}
						<button class="buy" class:ghost={!p.featured} disabled={buying !== null} onclick={() => buy(p.id)}>
							{buying === p.id ? 'Opening checkout…' : `Buy ${p.usd}`}
						</button>
						{/if}
					</article>
				{/each}
			</div>
			{#if data.paymentsOpen}
				<p class="fineprint">Secure checkout by Stripe. Prices in USD; your bank converts at its rate. Receipts by email.</p>
			{:else}
				<p class="fineprint" id="topup-note">
					A request is private to your account. Nothing is charged to a card; the credit appears in
					your balance once we load it.
				</p>
			{/if}
		</section>
	{/if}

	{#if data.workspaces.length > 0}
		<section class="workspaces" id="workspace-wallets">
			<h2>Workspace wallets you draw on</h2>
			<p class="muted">
				Personas that belong to a workspace are billed to that workspace's owner, not to you. These are the
				balances your generations there will use.
			</p>
			<div class="ws-grid">
				{#each data.workspaces as w (w.id)}
					<article class="ws" class:ws-low={w.billingMode !== 'unmetered' && w.balance < 300}>
						<p class="ws-name">{w.name}</p>
						<p class="ws-balance">{w.formatted}</p>
						<p class="ws-meta">your seat: {w.role} · topped up by the owner</p>
					</article>
				{/each}
			</div>
		</section>
	{/if}

	<section class="ledger">
		<h2>Recent activity</h2>
		{#if data.ledger.length === 0}
			<!-- A workspace member can have generated hundreds of times and have an
			     empty ledger here: the charges land on the owner's, which this page
			     deliberately never exposes. "Nothing yet" would be a plain untruth. -->
			{#if data.workspaces.length > 0}
				<p class="muted">
					Nothing on your personal wallet. Work on a workspace persona is charged to that
					workspace's owner, and their ledger is theirs to see — ask them for a breakdown.
				</p>
			{:else}
				<p class="muted">Nothing yet. Your first generation will show here with what it cost.</p>
			{/if}
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr><th>When</th><th>What</th><th class="num">Amount</th><th class="num">Balance</th></tr>
					</thead>
					<tbody>
						{#each data.ledger as r (r.seq)}
							<tr>
								<td class="muted">{when(r.created_at)}</td>
								<td>
									<span class="kind kind-{r.kind}">{kindLabel[r.kind] ?? r.kind}</span>
									{#if r.note}<span class="note">{r.note}</span>{/if}
								</td>
								<td class="num" class:neg={r.delta < 0} class:pos={r.delta > 0}>{r.delta < 0 ? '−' : r.delta > 0 ? '+' : ''}{r.deltaFormatted}</td>
								<td class="num muted">{r.after}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="faq">
		<h2>How it works</h2>
		<dl>
			<dt>What costs money?</dt>
			<dd>AI images, video, voice and talking-head clips, plus the writing behind every post — a text post is just the writing, about {data.textPostPrice}. Scheduling, publishing and analytics are free on every account.</dd>
			<dt>Why is the balance in {data.currency}?</dt>
			<dd>We show your wallet in the currency of where you are. Change it any time in Settings. Charges are made in USD.</dd>
			<dt>Can I bring my own provider keys?</dt>
			<dd>Not for generation. Every image, video, voice clip and written word runs on our provider accounts and bills this wallet, so one quoted rate covers the whole run. The one key you bring is Zernio, which connects your own social accounts for publishing — it never changes what a generation costs.</dd>
			<dt>Whose wallet is charged?</dt>
			<dd>The persona&rsquo;s. A persona that belongs to a workspace bills that workspace&rsquo;s owner; a persona of your own bills you. The balance in the sidebar is the one that will actually be charged, and it names the workspace when it is not yours.</dd>
			<dt>Do credits expire?</dt>
			<dd>No. Purchased and welcome credit stays until you use it.</dd>
		</dl>
	</section>
	</div>
</PageShell>

<style>
	.billing {
		display: grid;
		/* minmax(0, 1fr), not the implicit `auto` track. An auto track grows to
		   its widest child's min-content width — here the 679px `nowrap` activity
		   table — so on a phone the whole column overflowed and 338px of balance
		   copy and top-up cards were clipped (WCAG 1.4.10). Capped, the track fits
		   the viewport and the table scrolls inside its own .table-wrap. */
		grid-template-columns: minmax(0, 1fr);
		gap: 2rem;
	}
	.billing > * {
		min-width: 0;
	}
	.banner {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border-radius: 10px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text);
	}
	.banner.ok {
		border-color: color-mix(in srgb, var(--success-text) 40%, transparent);
		background: color-mix(in srgb, var(--success-text) 8%, var(--surface));
	}
	.banner-x {
		margin-left: auto;
		background: none;
		border: 0;
		font-size: 1.1rem;
		cursor: pointer;
		color: var(--text-dim);
	}
	.hero {
		display: grid;
		grid-template-columns: 1.4fr 1fr;
		gap: 2rem;
		padding: 2rem;
		border-radius: 16px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.eyebrow {
		margin: 0 0 0.25rem;
		font-size: 0.78rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-dim);
	}
	.page-name {
		margin: 0 0 var(--space-2);
		font-family: var(--font-display);
		font-size: var(--text-xl);
		font-weight: 700;
		letter-spacing: var(--tracking-tight);
		color: var(--text);
	}

	.amount {
		margin: 0;
		font-size: clamp(2.4rem, 6vw, 3.6rem);
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--success-text);
		font-variant-numeric: tabular-nums;
	}
	.amount.low {
		color: var(--warning-text);
	}
	.amount.empty {
		color: var(--error-text);
	}
	.sub {
		margin: 0.5rem 0 0;
		color: var(--text-muted);
		line-height: 1.5;
	}
	.promises {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.6rem;
		align-content: center;
		color: var(--text-muted);
		font-size: 0.92rem;
	}
	.promises strong {
		color: var(--text);
	}
	h2 {
		margin: 0 0 0.25rem;
		font-size: 1.15rem;
	}
	.muted {
		color: var(--text-dim);
	}
	.soon {
		display: block;
		margin-top: 0.25rem;
		color: var(--warning-text);
		font-weight: 500;
	}
	.error {
		color: var(--error-text);
	}
	.pack-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 1rem;
		margin-top: 1rem;
	}
	.pack {
		position: relative;
		display: grid;
		gap: 0.35rem;
		padding: 1.25rem;
		border-radius: 14px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.pack.featured {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.badge {
		position: absolute;
		top: -0.65rem;
		left: 1rem;
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		background: var(--accent-dark);
		color: #fff;
		font-size: 0.7rem;
		font-weight: 600;
	}
	.pack h3 {
		margin: 0;
		font-size: 0.95rem;
		color: var(--text-dim);
		font-weight: 600;
	}
	.price {
		margin: 0;
		font-size: 1.7rem;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.local {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--text-dim);
	}
	.worth {
		margin: 0;
		color: var(--text-muted);
	}
	.bonus {
		margin-left: 0.4rem;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--success-text) 12%, transparent);
		color: var(--success-text);
		font-size: 0.72rem;
		font-weight: 600;
	}
	.buys {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-dim);
	}
	.buy {
		margin-top: 0.5rem;
		padding: 0.6rem 0.9rem;
		border-radius: 10px;
		border: 1px solid var(--accent-dark);
		background: var(--accent-dark);
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}
	.plan-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.35rem;
	}
	.buy.ghost {
		background: transparent;
		color: var(--accent-text);
	}
	.buy:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.fineprint {
		margin: 0.75rem 0 0;
		font-size: 0.78rem;
		color: var(--text-dim);
	}
	.table-wrap {
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	th,
	td {
		padding: 0.6rem 0.9rem;
		text-align: left;
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}
	th {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}
	tr:last-child td {
		border-bottom: 0;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.neg {
		color: var(--text);
	}
	.pos {
		color: var(--success-text);
	}
	.kind {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--surface-2);
		font-size: 0.75rem;
		margin-right: 0.5rem;
	}
	.kind-purchase,
	.kind-grant {
		background: color-mix(in srgb, var(--success-text) 12%, transparent);
		color: var(--success-text);
	}
	.note {
		color: var(--text-dim);
		font-size: 0.82rem;
	}
	.plan-features {
		margin: 0.25rem 0 0;
		padding-left: 1.1rem;
		font-size: 0.82rem;
		color: var(--text-muted);
		display: grid;
		gap: 0.15rem;
	}
	.ws-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.75rem;
		margin-top: 0.75rem;
	}
	.ws {
		padding: 0.9rem 1rem;
		border-radius: 12px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.ws-name {
		margin: 0;
		font-weight: 600;
	}
	.ws-balance {
		margin: 0.2rem 0 0;
		font-size: 1.3rem;
		font-weight: 700;
		color: var(--success-text);
		font-variant-numeric: tabular-nums;
	}
	.ws-low .ws-balance {
		color: var(--warning-text);
	}
	.ws-meta {
		margin: 0.2rem 0 0;
		font-size: 0.78rem;
		color: var(--text-dim);
	}
	.faq dl {
		display: grid;
		gap: 0.9rem;
		margin: 0.5rem 0 0;
	}
	.faq dt {
		font-weight: 600;
	}
	.faq dd {
		margin: 0.15rem 0 0;
		color: var(--text-muted);
		line-height: 1.5;
	}
	@media (max-width: 720px) {
		.hero {
			grid-template-columns: 1fr;
			padding: 1.25rem;
		}
	}
	.topup-pending {
		margin: var(--space-3) 0 0;
		padding: var(--space-3) var(--space-4);
		list-style: none;
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		font-size: var(--text-base);
	}
	.topup-pending li + li {
		margin-top: var(--space-2);
	}
</style>
