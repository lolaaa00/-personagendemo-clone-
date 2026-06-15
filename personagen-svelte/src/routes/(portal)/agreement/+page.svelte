<script lang="ts">
	import { showToast } from '$lib/stores/ui.svelte';

	interface Section {
		id: string;
		title: string;
		content: string;
	}

	const sections: Section[] = [
		{
			id: 'overview',
			title: '1. Agreement Overview',
			content: `This Master Service Agreement ("Agreement") is entered into between PersonaGen Pty Ltd (ABN 12 345 678 901), hereafter referred to as "Provider," and the Client identified in the account registration, hereafter referred to as "Client." This Agreement governs the provision of AI-powered social media persona management services, including but not limited to content generation, social account management, analytics, and automation services (collectively, the "Services"). By accessing or using the PersonaGen platform, Client acknowledges and agrees to be bound by the terms set forth herein. This Agreement supersedes all prior negotiations, representations, or agreements relating to this subject matter.`
		},
		{
			id: 'scope',
			title: '2. Service Scope',
			content: `Provider shall deliver the following Services to Client:\n\n• AI Persona Creation & Management: Design, deployment, and ongoing management of AI-driven social media personas ("Agents") across supported platforms including TikTok, Instagram, YouTube, Twitter/X, LinkedIn, and Threads.\n\n• Content Generation: Automated and AI-assisted content creation including posts, captions, threads, scripts, and multimedia briefs tailored to each Agent's defined persona ("Soul").\n\n• Social Account Automation: Scheduled posting, engagement monitoring, comment management, and cross-platform content distribution.\n\n• Analytics & Reporting: Real-time and historical analytics on engagement, follower growth, content performance, and platform-specific metrics.\n\n• Blueprint & Strategy Services: Channel decoding, competitive analysis, content strategy blueprints, and trend intelligence.\n\nProvider reserves the right to modify, enhance, or deprecate specific features with 30 days' written notice to Client.`
		},
		{
			id: 'pricing',
			title: '3. Pricing & Payment',
			content: `All fees are quoted in Australian Dollars (AUD) and are exclusive of GST unless otherwise stated.\n\n• Subscription Plans: Client selects a plan (Starter, Professional, or Enterprise) at the published rate. Billing is monthly or annually as chosen at signup.\n\n• Payment Terms: All invoices are due within 7 days of issue. Payment is processed via Stripe. Late payments incur a 2% monthly interest charge.\n\n• Usage-Based Charges: Any API calls, AI generation credits, or platform connections exceeding the plan's included allowances are billed at the published overage rates.\n\n• Refund Policy: Subscription fees are non-refundable except where required by Australian Consumer Law. Unused credits do not carry over between billing periods.\n\n• Price Adjustments: Provider may adjust pricing with 60 days' advance written notice. Client may cancel before new pricing takes effect.`
		},
		{
			id: 'ownership',
			title: '4. Content Ownership',
			content: `• Client Content: All content inputs, brand guidelines, strategic directions, and original materials provided by Client remain the exclusive property of Client.\n\n• Generated Content: All AI-generated content (posts, captions, scripts, images, and derivatives) created using the Services are owned by Client upon full payment of applicable fees.\n\n• Platform Data: Data retrieved from social media platforms is subject to each platform's respective Terms of Service and data usage policies.\n\n• Provider IP: The underlying AI models, algorithms, training data, persona frameworks, automation workflows, and platform infrastructure remain the exclusive intellectual property of Provider.\n\n• License Grant: Client grants Provider a limited, non-exclusive license to use Client Content solely for the purpose of delivering the Services during the term of this Agreement.`
		},
		{
			id: 'confidentiality',
			title: '5. Confidentiality',
			content: `Both parties agree to maintain the confidentiality of all non-public information disclosed during the course of this Agreement ("Confidential Information").\n\n• Definition: Confidential Information includes but is not limited to: business strategies, persona configurations (soul.md, skills.md, heartbeat.md), API credentials, analytics data, pricing terms, and proprietary methodologies.\n\n• Obligations: The receiving party shall: (a) use Confidential Information solely for purposes of this Agreement; (b) protect it with at least the same degree of care used for its own confidential information; (c) limit access to personnel with a need to know.\n\n• Exclusions: Obligations do not apply to information that: (a) is or becomes publicly available; (b) was known prior to disclosure; (c) is independently developed; (d) is required to be disclosed by law.\n\n• Duration: Confidentiality obligations survive termination of this Agreement for a period of three (3) years.`
		},
		{
			id: 'termination',
			title: '6. Term & Termination',
			content: `• Initial Term: This Agreement commences on the Effective Date and continues for the initial subscription period selected by Client.\n\n• Renewal: Subscriptions automatically renew for successive periods of equal length unless either party provides written notice of non-renewal at least 30 days prior to the renewal date.\n\n• Termination for Cause: Either party may terminate immediately upon written notice if the other party: (a) materially breaches and fails to cure within 14 days of notice; (b) becomes insolvent or enters bankruptcy proceedings.\n\n• Termination for Convenience: Client may terminate at any time with 30 days' written notice. Provider may terminate with 60 days' written notice.\n\n• Effect of Termination: Upon termination: (a) Client access to the platform ceases; (b) Provider will export Client data within 30 days upon request; (c) all outstanding fees become immediately due; (d) Sections 4, 5, and 7 survive termination.`
		},
		{
			id: 'liability',
			title: '7. Limitation of Liability',
			content: `• Cap: Provider's total aggregate liability under this Agreement shall not exceed the fees paid by Client in the twelve (12) months preceding the claim.\n\n• Exclusions: In no event shall Provider be liable for: (a) indirect, incidental, special, consequential, or punitive damages; (b) loss of profits, revenue, data, or business opportunity; (c) actions taken by social media platforms including account suspension, content removal, or policy changes; (d) third-party service outages or API changes.\n\n• Force Majeure: Neither party shall be liable for delays or failures caused by events beyond reasonable control, including natural disasters, government actions, pandemics, or infrastructure failures.\n\n• Indemnification: Client agrees to indemnify Provider against any claims arising from Client Content that infringes third-party rights or violates applicable laws.\n\n• Governing Law: This Agreement is governed by the laws of New South Wales, Australia. Disputes shall be resolved through binding arbitration in Sydney, NSW.`
		}
	];

	let openSections = $state<Set<string>>(new Set(['overview']));

	function toggleSection(id: string) {
		const next = new Set(openSections);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		openSections = next;
	}

	function expandAll() {
		openSections = new Set(sections.map((s) => s.id));
	}

	function collapseAll() {
		openSections = new Set();
	}

	function downloadPdf() {
		showToast('PDF download started', 'success');
	}

	function printDoc() {
		if (typeof window !== 'undefined') window.print();
	}
</script>

<svelte:head>
	<title>Agreement — PersonaGen</title>
</svelte:head>

<section class="page">
	<header class="page-header">
		<h1>Master Service Agreement</h1>
		<p class="subtitle">Terms governing the PersonaGen platform and services.</p>
	</header>

	<!-- Agreement Meta -->
	<div class="agreement-meta">
		<div class="meta-row">
			<div class="meta-item">
				<span class="meta-label">Agreement ID</span>
				<span class="meta-value mono">MSA-2026-0001</span>
			</div>
			<div class="meta-item">
				<span class="meta-label">Effective Date</span>
				<span class="meta-value">1 June 2026</span>
			</div>
			<div class="meta-item">
				<span class="meta-label">Parties</span>
				<span class="meta-value">PersonaGen Pty Ltd ↔ Client</span>
			</div>
			<div class="meta-item">
				<span class="meta-label">Status</span>
				<span class="status-badge">
					<span class="status-dot"></span>
					Active
				</span>
			</div>
		</div>
	</div>

	<!-- Actions -->
	<div class="actions-bar">
		<div class="action-group">
			<button class="action-btn" onclick={expandAll}>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					><polyline points="7 13 12 18 17 13" /><polyline points="7 6 12 11 17 6" /></svg
				>
				Expand All
			</button>
			<button class="action-btn" onclick={collapseAll}>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					><polyline points="17 11 12 6 7 11" /><polyline points="17 18 12 13 7 18" /></svg
				>
				Collapse All
			</button>
		</div>
		<div class="action-group">
			<button class="action-btn" onclick={printDoc}>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					><polyline points="6 9 6 2 18 2 18 9" /><path
						d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"
					/><rect x="6" y="14" width="12" height="8" /></svg
				>
				Print
			</button>
			<button class="action-btn primary" onclick={downloadPdf}>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline
						points="7 10 12 15 17 10"
					/><line x1="12" y1="15" x2="12" y2="3" /></svg
				>
				Download PDF
			</button>
		</div>
	</div>

	<!-- Sections (Accordion) -->
	<div class="sections">
		{#each sections as section (section.id)}
			<div class="section-block" class:open={openSections.has(section.id)}>
				<button class="section-header" onclick={() => toggleSection(section.id)}>
					<h3>{section.title}</h3>
					<svg
						class="chevron"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"><polyline points="6 9 12 15 18 9" /></svg
					>
				</button>
				{#if openSections.has(section.id)}
					<div class="section-body">
						<div class="section-content">{section.content}</div>
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Signature Block -->
	<div class="signature-block">
		<div class="sig-header">
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="var(--accent)"
				stroke-width="2"
				stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg
			>
			<h3>Digital Signature</h3>
		</div>

		<div class="sig-grid">
			<div class="sig-party">
				<span class="sig-label">Provider</span>
				<div class="sig-line">
					<span class="sig-name">PersonaGen Pty Ltd</span>
					<span class="sig-role">Authorized Representative</span>
				</div>
				<span class="sig-date">Signed: 1 June 2026</span>
				<span class="sig-verified">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--success)"
						stroke-width="2.5"
						stroke-linecap="round"
						><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline
							points="22 4 12 14.01 9 11.01"
						/></svg
					>
					Verified
				</span>
			</div>
			<div class="sig-party">
				<span class="sig-label">Client</span>
				<div class="sig-line">
					<span class="sig-name">Client Account Holder</span>
					<span class="sig-role">Authorized Signatory</span>
				</div>
				<span class="sig-date">Signed: 1 June 2026</span>
				<span class="sig-verified">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--success)"
						stroke-width="2.5"
						stroke-linecap="round"
						><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline
							points="22 4 12 14.01 9 11.01"
						/></svg
					>
					Verified
				</span>
			</div>
		</div>
	</div>
</section>

<style>
	.page {
		padding: 2rem;
		max-width: 880px;
		margin: 0 auto;
	}

	.page-header {
		margin-bottom: 1.5rem;
		text-align: center;
	}
	.page-header h1 {
		font-family: var(--font-display);
		font-size: var(--text-3xl);
		background: var(--gradient);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}
	.subtitle {
		color: var(--text-muted);
		font-size: var(--text-base);
		margin-top: 0.25rem;
	}

	/* Meta */
	.agreement-meta {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.5rem;
		margin-bottom: 1rem;
	}
	.meta-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
	}
	.meta-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.meta-label {
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
	}
	.meta-value {
		font-size: 0.88rem;
		color: var(--text);
	}
	.meta-value.mono {
		font-family: var(--font-mono);
		color: var(--accent);
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.82rem;
		color: var(--success);
		font-weight: 600;
	}
	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--success);
		animation: ambientPulse 2s ease infinite;
	}

	/* Actions */
	.actions-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.action-group {
		display: flex;
		gap: 0.5rem;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 14px;
		border-radius: var(--radius-xs);
		border: 1px solid var(--border-strong);
		background: transparent;
		color: var(--text-muted);
		font-size: 0.78rem;
		cursor: pointer;
		font-family: var(--font-body);
		font-weight: 600;
		transition:
			border-color 0.2s,
			color 0.2s,
			background 0.2s;
	}
	.action-btn:hover {
		border-color: var(--accent-mid);
		color: var(--text);
	}
	.action-btn.primary {
		background: var(--gradient-subtle);
		border-color: transparent;
		color: #fff;
	}
	.action-btn.primary:hover {
		box-shadow: var(--shadow-accent);
		transform: translateY(-1px);
	}

	/* Accordion */
	.sections {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.section-block {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		transition: border-color 0.2s;
	}
	.section-block:hover {
		border-color: var(--border-hover);
	}
	.section-block.open {
		border-color: var(--accent-mid);
	}

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 1.1rem 1.25rem;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text);
		text-align: left;
	}
	.section-header h3 {
		font-family: var(--font-display);
		font-size: var(--text-md);
		font-weight: 600;
	}

	.chevron {
		transition: transform 0.25s ease;
		color: var(--text-dim);
		flex-shrink: 0;
	}
	.section-block.open .chevron {
		transform: rotate(180deg);
		color: var(--accent);
	}

	.section-body {
		padding: 0 1.25rem 1.25rem;
		animation: fadeDown 0.2s var(--ease-out);
	}
	.section-content {
		font-size: 0.85rem;
		color: var(--text-muted);
		line-height: 1.75;
		white-space: pre-wrap;
		border-top: 1px solid var(--border);
		padding-top: 1rem;
	}

	/* Signature */
	.signature-block {
		margin-top: 2rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.5rem;
	}
	.sig-header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 1.25rem;
	}
	.sig-header h3 {
		font-size: var(--text-lg);
		font-family: var(--font-display);
	}

	.sig-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 2rem;
	}

	.sig-party {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.sig-label {
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
	}

	.sig-line {
		padding: 0.75rem 0;
		border-bottom: 2px solid var(--accent-mid);
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.sig-name {
		font-family: var(--font-display);
		font-size: 1.1rem;
		font-style: italic;
		color: var(--text);
	}
	.sig-role {
		font-size: var(--text-xs);
		color: var(--text-dim);
	}
	.sig-date {
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-family: var(--font-mono);
	}
	.sig-verified {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--success);
		font-weight: 600;
	}

	/* Print */
	@media print {
		.page {
			padding: 0;
			max-width: 100%;
		}
		.actions-bar {
			display: none;
		}
		.section-block {
			break-inside: avoid;
			border: none;
		}
		.section-body {
			display: block !important;
		}
		.chevron {
			display: none;
		}
	}

	@media (max-width: 640px) {
		.page {
			padding: 1rem;
		}
		.meta-row {
			grid-template-columns: 1fr 1fr;
		}
		.sig-grid {
			grid-template-columns: 1fr;
		}
		.actions-bar {
			flex-direction: column;
			align-items: stretch;
		}
		.action-group {
			justify-content: stretch;
		}
		.action-btn {
			flex: 1;
			justify-content: center;
		}
	}
</style>
