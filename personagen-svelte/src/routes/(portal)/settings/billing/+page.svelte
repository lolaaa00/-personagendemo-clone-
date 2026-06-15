<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';

	let { data } = $props();

	const plans = [
		{
			key: 'starter',
			name: 'Starter',
			price: 49,
			agents: '2',
			posts: '100',
			accent: 'var(--accent)',
			features: [
				'2 AI Agents',
				'100 posts/month',
				'Content Calendar',
				'Basic Analytics',
				'Email Support'
			]
		},
		{
			key: 'pro',
			name: 'Pro',
			price: 149,
			agents: '5',
			posts: '500',
			accent: 'var(--cyan)',
			popular: true,
			features: [
				'5 AI Agents',
				'500 posts/month',
				'Content Forge',
				'Channel Decoder',
				'Trend Intelligence',
				'Priority Support'
			]
		},
		{
			key: 'enterprise',
			name: 'Enterprise',
			price: 399,
			agents: '∞',
			posts: '∞',
			accent: 'var(--gold)',
			features: [
				'Unlimited AI Agents',
				'Unlimited posts',
				'All Intelligence Tools',
				'White-label Portal',
				'Dedicated Account Manager',
				'Custom Integrations'
			]
		}
	];

	let loading = $state('');
	let toastMessage = $state('');
	let toastType = $state<'success' | 'error' | 'info'>('success');
	let toastVisible = $state(false);

	const currentPlan = $derived(data.subscription?.plan ?? 'free');
	const subscriptionStatus = $derived(data.subscription?.status ?? 'inactive');
	const periodEnd = $derived(data.subscription?.current_period_end);

	function showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
		toastMessage = message;
		toastType = type;
		toastVisible = true;
		setTimeout(() => {
			toastVisible = false;
		}, 5000);
	}

	onMount(() => {
		const params = $page.url.searchParams;
		if (params.get('success') === 'true') {
			showToast('Subscription activated successfully!', 'success');
			// Clean URL
			const cleanUrl = new URL($page.url);
			cleanUrl.searchParams.delete('success');
			history.replaceState({}, '', cleanUrl.toString());
		} else if (params.get('canceled') === 'true') {
			showToast('Checkout was canceled. No changes were made.', 'info');
			const cleanUrl = new URL($page.url);
			cleanUrl.searchParams.delete('canceled');
			history.replaceState({}, '', cleanUrl.toString());
		}
	});

	async function handleCheckout(plan: string) {
		if (loading) return;
		loading = plan;

		try {
			const res = await fetch('/api/stripe/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ plan })
			});

			const result = (await res.json()) as { url?: string; message?: string };

			if (!res.ok) {
				throw new Error(result.message || 'Failed to start checkout');
			}

			if (result.url) {
				window.location.href = result.url;
			}
		} catch (err) {
			showToast(err instanceof Error ? err.message : 'Something went wrong', 'error');
		} finally {
			loading = '';
		}
	}

	async function handleManageBilling() {
		if (loading) return;
		loading = 'portal';

		try {
			const res = await fetch('/api/stripe/portal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' }
			});

			const result = (await res.json()) as { url?: string; message?: string };

			if (!res.ok) {
				throw new Error(result.message || 'Failed to open billing portal');
			}

			if (result.url) {
				window.location.href = result.url;
			}
		} catch (err) {
			showToast(err instanceof Error ? err.message : 'Something went wrong', 'error');
		} finally {
			loading = '';
		}
	}

	function getStatusBadge(status: string) {
		const map: Record<string, { label: string; cssClass: string }> = {
			active: { label: 'Active', cssClass: 'badge-active' },
			trialing: { label: 'Trial', cssClass: 'badge-trial' },
			past_due: { label: 'Past Due', cssClass: 'badge-past-due' },
			canceled: { label: 'Canceled', cssClass: 'badge-canceled' },
			inactive: { label: 'No Plan', cssClass: 'badge-inactive' },
			incomplete: { label: 'Incomplete', cssClass: 'badge-past-due' },
			paused: { label: 'Paused', cssClass: 'badge-inactive' }
		};
		return map[status] ?? { label: status, cssClass: 'badge-inactive' };
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function getPlanLabel(plan: string): string {
		const labels: Record<string, string> = {
			free: 'Free',
			starter: 'Starter',
			pro: 'Pro',
			enterprise: 'Enterprise'
		};
		return labels[plan] ?? plan;
	}

	function getButtonLabel(planKey: string): string {
		if (currentPlan === planKey) return 'Current Plan';
		if (currentPlan === 'free' || currentPlan === 'inactive') return 'Get Started';
		const tierOrder = ['free', 'starter', 'pro', 'enterprise'];
		const currentIdx = tierOrder.indexOf(currentPlan);
		const targetIdx = tierOrder.indexOf(planKey);
		return targetIdx > currentIdx ? 'Upgrade' : 'Downgrade';
	}
</script>

<svelte:head>
	<title>Billing — PersonaGen</title>
</svelte:head>

<!-- Toast -->
{#if toastVisible}
	<div class="toast-container">
		<div class="toast-item toast-{toastType}">
			<span class="toast-icon">
				{#if toastType === 'success'}✓
				{:else if toastType === 'error'}✕
				{:else}ℹ{/if}
			</span>
			<span>{toastMessage}</span>
		</div>
	</div>
{/if}

<div class="billing-page">
	<!-- Header -->
	<div class="billing-header">
		<div class="billing-header-text">
			<h1>Billing</h1>
			<p class="billing-subtitle">Manage your subscription and payment details</p>
		</div>
		{#if data.subscription?.stripe_customer_id}
			<button
				class="btn-ghost manage-btn"
				onclick={handleManageBilling}
				disabled={loading === 'portal'}
			>
				{#if loading === 'portal'}
					<span class="spinner"></span>
				{:else}
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
						<line x1="1" y1="10" x2="23" y2="10" />
					</svg>
				{/if}
				Manage Billing
			</button>
		{/if}
	</div>

	<!-- Current Plan Card -->
	<div class="current-plan-card glass-card">
		<div class="current-plan-info">
			<div class="current-plan-row">
				<span class="current-plan-label">Current Plan</span>
				<span class="current-plan-name grad-text">{getPlanLabel(currentPlan)}</span>
			</div>
			<div class="current-plan-meta">
				<span class="status-badge {getStatusBadge(subscriptionStatus).cssClass}">
					{getStatusBadge(subscriptionStatus).label}
				</span>
				{#if periodEnd && subscriptionStatus === 'active'}
					<span class="period-text">Renews {formatDate(periodEnd)}</span>
				{/if}
				{#if subscriptionStatus === 'past_due'}
					<span class="period-text warning-text">Payment required to continue service</span>
				{/if}
			</div>
		</div>
		{#if subscriptionStatus === 'active' || subscriptionStatus === 'trialing'}
			<div class="current-plan-usage">
				<div class="usage-stat">
					<span class="usage-value">{plans.find((p) => p.key === currentPlan)?.agents ?? '0'}</span>
					<span class="usage-label">Agents</span>
				</div>
				<div class="usage-divider"></div>
				<div class="usage-stat">
					<span class="usage-value">{plans.find((p) => p.key === currentPlan)?.posts ?? '0'}</span>
					<span class="usage-label">Posts/mo</span>
				</div>
			</div>
		{/if}
	</div>

	<!-- Plan Cards -->
	<div class="plans-grid">
		{#each plans as plan}
			{@const isCurrent = currentPlan === plan.key}
			{@const buttonLabel = getButtonLabel(plan.key)}
			<div
				class="plan-card"
				class:plan-current={isCurrent}
				class:plan-popular={plan.popular}
				style="--plan-accent: {plan.accent}"
			>
				{#if plan.popular}
					<div class="popular-badge">Most Popular</div>
				{/if}
				{#if isCurrent}
					<div class="current-badge">Current Plan</div>
				{/if}

				<div class="plan-header">
					<h3 class="plan-name">{plan.name}</h3>
					<div class="plan-price">
						<span class="plan-currency">$</span>
						<span class="plan-amount">{plan.price}</span>
						<span class="plan-interval">/mo</span>
					</div>
				</div>

				<ul class="plan-features">
					{#each plan.features as feature}
						<li>
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="var(--plan-accent)"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<polyline points="20 6 9 17 4 12" />
							</svg>
							<span>{feature}</span>
						</li>
					{/each}
				</ul>

				<button
					class="plan-btn"
					class:plan-btn-current={isCurrent}
					disabled={isCurrent || !!loading}
					onclick={() => handleCheckout(plan.key)}
				>
					{#if loading === plan.key}
						<span class="spinner"></span>
					{/if}
					{buttonLabel}
				</button>
			</div>
		{/each}
	</div>

	<!-- FAQ Section -->
	<div class="billing-faq glass-card">
		<h3>Frequently Asked Questions</h3>
		<div class="faq-grid">
			<div class="faq-item">
				<h4>Can I change plans anytime?</h4>
				<p>
					Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately,
					and billing is prorated.
				</p>
			</div>
			<div class="faq-item">
				<h4>What happens when I cancel?</h4>
				<p>
					Your plan remains active until the end of the current billing period. You won't be charged
					again after cancellation.
				</p>
			</div>
			<div class="faq-item">
				<h4>Do you offer refunds?</h4>
				<p>
					We offer a full refund within the first 14 days. After that, you can cancel anytime and
					use the service until the end of your billing cycle.
				</p>
			</div>
			<div class="faq-item">
				<h4>Need a custom plan?</h4>
				<p>
					For teams with specific requirements, contact us at <a href="mailto:support@personagen.ai"
						>support@personagen.ai</a
					> for a tailored solution.
				</p>
			</div>
		</div>
	</div>
</div>

<style>
	/* ═══════════════════════════════════════
     BILLING PAGE LAYOUT
     ═══════════════════════════════════════ */

	.billing-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 var(--space-4);
	}

	.billing-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: var(--space-8);
		gap: var(--space-4);
	}

	.billing-header h1 {
		font-family: var(--font-display);
		font-size: 1.75rem;
		color: var(--text);
		margin: 0 0 var(--space-2);
	}

	.billing-subtitle {
		color: var(--text-muted);
		font-size: 0.9rem;
		margin: 0;
	}

	.manage-btn {
		flex-shrink: 0;
		padding: 10px 20px;
		font-size: 0.85rem;
	}

	/* ═══════════════════════════════════════
     CURRENT PLAN CARD
     ═══════════════════════════════════════ */

	.current-plan-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-8);
		padding: var(--space-6);
	}

	.current-plan-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-2);
	}

	.current-plan-label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		color: var(--text-dim);
		font-weight: 700;
	}

	.current-plan-name {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		font-weight: 700;
	}

	.current-plan-meta {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		padding: 3px 10px;
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
	}

	.badge-active {
		background: var(--success-soft);
		color: var(--success);
		border: 1px solid rgba(52, 211, 153, 0.2);
	}

	.badge-trial {
		background: var(--info-soft);
		color: var(--info);
		border: 1px solid rgba(59, 130, 246, 0.2);
	}

	.badge-past-due {
		background: var(--warning-soft);
		color: var(--warning);
		border: 1px solid rgba(245, 158, 11, 0.2);
	}

	.badge-canceled {
		background: var(--error-soft);
		color: var(--error);
		border: 1px solid rgba(239, 68, 68, 0.2);
	}

	.badge-inactive {
		background: rgba(255, 255, 255, 0.04);
		color: var(--text-dim);
		border: 1px solid var(--border);
	}

	.period-text {
		font-size: var(--text-sm);
		color: var(--text-dim);
	}

	.warning-text {
		color: var(--warning);
	}

	.current-plan-usage {
		display: flex;
		align-items: center;
		gap: var(--space-6);
	}

	.usage-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.usage-value {
		font-family: var(--font-display);
		font-size: var(--text-xl);
		font-weight: 700;
		color: var(--text);
	}

	.usage-label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		color: var(--text-dim);
		font-weight: 600;
	}

	.usage-divider {
		width: 1px;
		height: 40px;
		background: var(--border);
	}

	/* ═══════════════════════════════════════
     PLAN CARDS GRID
     ═══════════════════════════════════════ */

	.plans-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-6);
		margin-bottom: var(--space-8);
	}

	.plan-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: var(--space-6);
		display: flex;
		flex-direction: column;
		position: relative;
		transition:
			border-color 0.3s ease,
			transform 0.3s ease,
			box-shadow 0.3s ease;
	}

	.plan-card:hover {
		border-color: var(--plan-accent, var(--accent-mid));
		transform: translateY(-4px);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
	}

	.plan-current {
		border-color: var(--plan-accent, var(--accent-mid));
		box-shadow: 0 0 30px rgba(124, 106, 237, 0.08);
	}

	.plan-popular {
		border-color: var(--cyan-mid);
	}

	.popular-badge {
		position: absolute;
		top: -12px;
		left: 50%;
		transform: translateX(-50%);
		padding: 4px 16px;
		border-radius: var(--radius-full);
		background: linear-gradient(135deg, var(--cyan), var(--accent));
		color: #fff;
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		white-space: nowrap;
	}

	.current-badge {
		position: absolute;
		top: -12px;
		right: var(--space-4);
		padding: 4px 14px;
		border-radius: var(--radius-full);
		background: var(--accent-soft);
		border: 1px solid var(--accent-mid);
		color: var(--accent);
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		white-space: nowrap;
	}

	.plan-header {
		margin-bottom: var(--space-6);
		padding-top: var(--space-2);
	}

	.plan-name {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		color: var(--text);
		margin: 0 0 var(--space-3);
	}

	.plan-price {
		display: flex;
		align-items: baseline;
		gap: 2px;
	}

	.plan-currency {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--text-muted);
	}

	.plan-amount {
		font-family: var(--font-display);
		font-size: 2.5rem;
		font-weight: 700;
		color: var(--text);
		line-height: 1;
	}

	.plan-interval {
		font-size: var(--text-sm);
		color: var(--text-dim);
		margin-left: 4px;
	}

	/* ═══════════════════════════════════════
     FEATURE LIST
     ═══════════════════════════════════════ */

	.plan-features {
		list-style: none;
		padding: 0;
		margin: 0 0 var(--space-6);
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.plan-features li {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: 0.88rem;
		color: var(--text-muted);
	}

	.plan-features li svg {
		flex-shrink: 0;
	}

	/* ═══════════════════════════════════════
     PLAN BUTTON
     ═══════════════════════════════════════ */

	.plan-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		padding: 14px 24px;
		border-radius: 12px;
		background: var(--plan-accent, var(--accent));
		color: #fff;
		font-weight: 600;
		font-size: 0.9rem;
		border: none;
		cursor: pointer;
		transition:
			transform 0.2s ease,
			box-shadow 0.3s ease,
			opacity 0.2s ease;
		font-family: var(--font-body);
		white-space: nowrap;
	}

	.plan-btn:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
	}

	.plan-btn:active:not(:disabled) {
		transform: translateY(0);
	}

	.plan-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.plan-btn-current {
		background: var(--surface-3);
		color: var(--text-dim);
		border: 1px solid var(--border);
	}

	/* ═══════════════════════════════════════
     FAQ SECTION
     ═══════════════════════════════════════ */

	.billing-faq {
		margin-bottom: var(--space-8);
	}

	.billing-faq h3 {
		font-family: var(--font-display);
		font-size: var(--text-lg);
		color: var(--text);
		margin: 0 0 var(--space-6);
	}

	.faq-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-6);
	}

	.faq-item h4 {
		font-family: var(--font-body);
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--text);
		margin: 0 0 var(--space-2);
	}

	.faq-item p {
		font-size: 0.85rem;
		color: var(--text-muted);
		line-height: var(--leading-relaxed);
		margin: 0;
	}

	.faq-item a {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.faq-item a:hover {
		color: var(--cyan);
	}

	/* ═══════════════════════════════════════
     SPINNER
     ═══════════════════════════════════════ */

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	/* ═══════════════════════════════════════
     RESPONSIVE
     ═══════════════════════════════════════ */

	@media (max-width: 1024px) {
		.plans-grid {
			grid-template-columns: 1fr;
			max-width: 440px;
			margin-left: auto;
			margin-right: auto;
		}
	}

	@media (max-width: 768px) {
		.billing-header {
			flex-direction: column;
			gap: var(--space-3);
		}

		.manage-btn {
			width: 100%;
		}

		.current-plan-card {
			flex-direction: column;
			gap: var(--space-4);
			align-items: flex-start;
		}

		.current-plan-usage {
			width: 100%;
			justify-content: center;
			padding-top: var(--space-4);
			border-top: 1px solid var(--border);
		}

		.plans-grid {
			grid-template-columns: 1fr;
		}

		.faq-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
