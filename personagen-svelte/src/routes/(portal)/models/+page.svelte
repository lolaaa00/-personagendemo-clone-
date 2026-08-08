<script lang="ts">
	import { showToast } from '$lib/stores/ui.svelte';
	import { parseJsonResponse } from '$lib/services/api';
	import { readParam, syncParam } from '$lib/url-state';

	let { data } = $props();

	let rows = $state<any[]>([...data.rows]);
	$effect(() => {
		rows = [...data.rows];
	});

	// ── Tabs (kind) + sort, both deep-linkable ───────────────────────────────
	type Kind = 'image_t2i' | 'image_edit' | 'video_i2v' | 'tts';
	const KIND_TABS: Array<{ id: Kind; label: string }> = [
		{ id: 'image_t2i', label: 'Image' },
		{ id: 'image_edit', label: 'Image Edit' },
		{ id: 'video_i2v', label: 'Video' },
		{ id: 'tts', label: 'Voice' }
	];
	let kind = $state<Kind>(
		readParam('kind', ['image_t2i', 'image_edit', 'video_i2v', 'tts'] as const, 'video_i2v')
	);
	$effect(() => syncParam('kind', kind, 'video_i2v'));

	type Sort = 'newest' | 'price' | 'quality' | 'value';
	let sort = $state<Sort>(
		readParam('sort', ['newest', 'price', 'quality', 'value'] as const, 'newest')
	);
	$effect(() => syncParam('sort', sort, 'newest'));

	// ── Derived views ────────────────────────────────────────────────────────
	function valueScore(r: any): number | null {
		if (r.quality == null || r.price_usd == null || r.price_usd <= 0) return null;
		return r.quality / r.price_usd;
	}

	function sortRows(list: any[]): any[] {
		const s = [...list];
		if (sort === 'newest')
			s.sort((a, b) => (b.released_at ?? '').localeCompare(a.released_at ?? ''));
		else if (sort === 'price')
			s.sort((a, b) => (a.price_usd ?? Infinity) - (b.price_usd ?? Infinity));
		else if (sort === 'quality') s.sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0));
		else s.sort((a, b) => (valueScore(b) ?? 0) - (valueScore(a) ?? 0));
		return s;
	}

	let wired = $derived(sortRows(rows.filter((r: any) => r.kind === kind && r.wired)));
	let discovered = $derived(
		[...rows.filter((r: any) => r.kind === kind && !r.wired)].sort((a, b) =>
			(b.released_at ?? '').localeCompare(a.released_at ?? '')
		)
	);
	let maxValue = $derived(Math.max(...wired.map((r: any) => valueScore(r) ?? 0), 0));
	let bestValueId = $derived.by(() => {
		let best: any = null;
		for (const r of wired) {
			if (r.status !== 'active') continue;
			const v = valueScore(r);
			if (v != null && (best == null || v > valueScore(best)!)) best = r;
		}
		return best?.id ?? null;
	});
	let lastSync = $derived.by(() => {
		const dates = rows
			.map((r: any) => r.discovered_at)
			.filter(Boolean)
			.sort();
		return dates.length ? dates[dates.length - 1].slice(0, 10) : null;
	});
	let kindCount = $derived((k: Kind) => rows.filter((r: any) => r.kind === k).length);

	// ── Age pill ─────────────────────────────────────────────────────────────
	// Returns the age as a real duration ALWAYS. It used to return the string
	// 'NEW'/'RECENT' *instead of* a duration for anything under 120 days, which is
	// why freshly discovered models showed a NEW chip but no age — the one place
	// you most want to know how old something is. Freshness is now a separate
	// qualifier so a row can read "3w · NEW".
	function ageOf(
		released: string | null
	): { label: string; cls: string; fresh: string | null; days: number } | null {
		if (!released) return null;
		const days = Math.max(0, Math.floor((Date.now() - new Date(released).getTime()) / 86_400_000));
		const label =
			days < 7
				? `${days}d`
				: days < 60
					? `${Math.round(days / 7)}w`
					: days < 365
						? `${Math.round(days / 30)}mo`
						: `${(days / 365).toFixed(1)}y`;
		const cls =
			days <= 45 ? 'age-new' : days <= 120 ? 'age-recent' : days <= 365 ? 'age-aging' : 'age-old';
		const fresh = days <= 45 ? 'NEW' : days <= 120 ? 'RECENT' : null;
		return { label, cls, fresh, days };
	}

	// Price/latency/quality are reference values, not form fields — they render as
	// text and only become inputs for the one row you explicitly put in edit mode.
	let editingRowId = $state<string | null>(null);

	// ── API plumbing ─────────────────────────────────────────────────────────
	async function call(payload: Record<string, unknown>): Promise<any> {
		const res = await fetch('/api/models', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const d = await parseJsonResponse<any>(res);
		if (!res.ok || !d.success) throw new Error(d.error || 'Server error');
		return d;
	}

	function replaceRow(updated: any) {
		rows = rows.map((r: any) => (r.id === updated.id ? updated : r));
	}

	let syncing = $state(false);
	async function runSync() {
		if (syncing) return;
		syncing = true;
		try {
			const d = await call({ action: 'sync' });
			rows = d.data;
			const s = d.sync;
			showToast(
				`Catalog synced — ${s.discovered} new model${s.discovered !== 1 ? 's' : ''} discovered, ${s.refreshed} refreshed${s.deprecatedFlagged ? `, ${s.deprecatedFlagged} newly deprecated` : ''}`,
				'success'
			);
		} catch (err) {
			showToast('Sync failed: ' + (err as Error).message, 'error');
		} finally {
			syncing = false;
		}
	}

	let savingId = $state<string | null>(null);
	async function saveField(row: any, patch: Record<string, unknown>) {
		savingId = row.id;
		try {
			const d = await call({ action: 'update', model_id: row.model_id, patch });
			replaceRow(d.data);
		} catch (err) {
			showToast((err as Error).message, 'error');
			rows = [...rows]; // rerender resets the input to the stored value
		} finally {
			savingId = null;
		}
	}

	async function toggleEnabled(row: any) {
		await saveField(row, { status: row.status === 'active' ? 'disabled' : 'active' });
	}

	async function makeDefault(row: any) {
		savingId = row.id;
		try {
			await call({ action: 'set_default', model_id: row.model_id, kind: row.kind });
			rows = rows.map((r: any) =>
				r.kind === row.kind ? { ...r, is_default: r.id === row.id } : r
			);
			showToast(
				`${row.label} is now the default ${KIND_TABS.find((t) => t.id === row.kind)?.label.toLowerCase()} model`,
				'success'
			);
		} catch (err) {
			showToast((err as Error).message, 'error');
		} finally {
			savingId = null;
		}
	}

	let probingId = $state<string | null>(null);
	async function probe(row: any) {
		probingId = row.id;
		try {
			const d = await call({ action: 'probe', model_id: row.model_id });
			replaceRow(d.data);
			showToast(
				d.probe.ok
					? 'Schema is compatible — auto-wiring can adopt this model'
					: 'Unusual request shape — quarantined for review',
				d.probe.ok ? 'success' : 'warning'
			);
		} catch (err) {
			showToast('Probe failed: ' + (err as Error).message, 'error');
		} finally {
			probingId = null;
		}
	}

	function numInput(e: Event): number {
		return Number((e.currentTarget as HTMLInputElement).value);
	}
</script>

<svelte:head>
	<title>Model Manager · PersonaGen</title>
</svelte:head>

<div class="mm-page">
	<header class="mm-header">
		<div>
			<h1>Model Manager</h1>
			<p class="mm-sub">
				The generation models your personas run on — how recent, what they cost, how they score.
				Enabled models appear in the composer; the starred one is the default.
			</p>
		</div>
		<div class="mm-header-actions">
			{#if lastSync}<span class="mm-sync-note">Catalog checked {lastSync}</span>{/if}
			<button type="button" class="mm-sync-btn" onclick={runSync} disabled={syncing}>
				{#if syncing}
					<span class="spin" aria-hidden="true"></span> Checking fal catalog…
				{:else}
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 3v5h5" /></svg
					>
					Check for new models
				{/if}
			</button>
		</div>
	</header>

	{#if data.loadError}
		<div class="mm-error">{data.loadError}</div>
	{/if}

	<div class="mm-toolbar">
		<div class="mm-tabs" role="tablist" aria-label="Model type">
			{#each KIND_TABS as tab (tab.id)}
				<button
					type="button"
					role="tab"
					class="mm-tab"
					class:active={kind === tab.id}
					aria-selected={kind === tab.id}
					onclick={() => (kind = tab.id)}
				>
					{tab.label}
					<span class="mm-tab-count">{kindCount(tab.id)}</span>
				</button>
			{/each}
		</div>
		<label class="mm-sort">
			<span>Sort</span>
			<select bind:value={sort} aria-label="Sort models">
				<option value="newest">Newest first</option>
				<option value="price">Cheapest first</option>
				<option value="quality">Highest quality</option>
				<option value="value">Best value (quality ÷ price)</option>
			</select>
		</label>
	</div>

	<!-- ── Active roster: wired models ─────────────────────────────────────── -->
	<h2 class="mm-section-title">Your roster</h2>
	<p class="mm-section-sub">
		Wired models with a tested adapter. Edit price, latency, and quality scores inline — the value
		ranking updates as you type. Prices flow into composer estimates.
	</p>
	<div class="mm-tablewrap">
		<table class="mm-table">
			<thead>
				<tr>
					<th>Model</th>
					<th>Released</th>
					<th>Price / call</th>
					<th>Latency</th>
					<th>Quality</th>
					<th>Value</th>
					<th><span class="sr-only">Edit values</span></th>
					<th>Default</th>
					<th>Enabled</th>
				</tr>
			</thead>
			<tbody>
				{#each wired as row (row.id)}
					{@const age = ageOf(row.released_at)}
					{@const value = valueScore(row)}
					<tr class:row-disabled={row.status === 'disabled'} class:row-saving={savingId === row.id}>
						<td class="mm-model-cell">
							<span class="mm-model-name">
								{row.label}
								{#if row.deprecated}<span class="pill pill-dep">DEPRECATED</span>{/if}
								{#if row.tier}<span class="pill pill-tier" data-tier={row.tier}>{row.tier}</span
									>{/if}
							</span>
							<span class="mm-model-id">{row.model_id}</span>
							{#if row.lab}<span class="mm-model-lab">{row.lab}</span>{/if}
						</td>
						<td class="mm-date-cell">
							{#if row.released_at}
								<span class="mm-date">{row.released_at}</span>
								{#if age}<span class="pill age {age.cls}">{age.label}</span>{/if}
								{#if age?.fresh}<span class="pill age {age.cls}">{age.fresh}</span>{/if}
							{:else}
								<span class="mm-dim">—</span>
							{/if}
						</td>
						<td>
							{#if editingRowId === row.id}
								<span class="mm-price-edit">
									$<input
										type="number"
										class="mm-input mm-input-price"
										min="0"
										step="0.001"
										value={row.price_usd ?? ''}
										aria-label="Price per call for {row.label} in USD"
										onchange={(e) => saveField(row, { price_usd: numInput(e) })}
									/>
								</span>
							{:else}
								<span class="mm-readonly"
									>{row.price_usd != null ? `$${row.price_usd}` : '—'}</span
								>
							{/if}
							{#if row.price_source === 'manual'}<span class="mm-dim mm-src">edited</span
								>{:else if row.price_source === 'parsed'}<span class="mm-dim mm-src">from fal</span
								>{/if}
						</td>
						<td>
							{#if editingRowId === row.id}
								<span class="mm-latency-edit">
									~<input
										type="number"
										class="mm-input mm-input-lat"
										min="0"
										step="1"
										value={row.latency_s ?? ''}
										aria-label="Typical latency for {row.label} in seconds"
										onchange={(e) => saveField(row, { latency_s: numInput(e) })}
									/>s
								</span>
							{:else}
								<span class="mm-readonly">{row.latency_s != null ? `~${row.latency_s}s` : '—'}</span>
							{/if}
						</td>
						<td>
							{#if editingRowId === row.id}
								<select
									class="mm-input mm-input-q"
									value={row.quality ?? ''}
									aria-label="Quality score for {row.label}"
									onchange={(e) =>
										saveField(row, { quality: Number((e.currentTarget as HTMLSelectElement).value) })}
								>
									<option value="" disabled>—</option>
									{#each [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as q}
										<option value={q}>{q}</option>
									{/each}
								</select>
								<span class="mm-dim">/10</span>
							{:else}
								<span class="mm-readonly">{row.quality ?? '—'}</span>
								<span class="mm-dim">/10</span>
							{/if}
						</td>
						<td class="mm-value-cell">
							{#if value != null}
								<div class="mm-value-bar" title={`${value.toFixed(0)} quality points per $`}>
									<div
										class="mm-value-fill"
										style="width: {maxValue ? Math.max(6, (value / maxValue) * 100) : 0}%"
									></div>
								</div>
								{#if row.id === bestValueId}<span class="pill pill-best">BEST VALUE</span>{/if}
							{:else}
								<span class="mm-dim" title="Needs both a quality score and a price">—</span>
							{/if}
						</td>
						<td>
							<button
								type="button"
								class="mm-edit-btn"
								class:editing={editingRowId === row.id}
								title={editingRowId === row.id
									? 'Done editing'
									: 'Edit price, latency and quality'}
								aria-label={editingRowId === row.id
									? `Done editing ${row.label}`
									: `Edit values for ${row.label}`}
								aria-pressed={editingRowId === row.id}
								onclick={() => (editingRowId = editingRowId === row.id ? null : row.id)}
							>
								{#if editingRowId === row.id}
									<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
								{:else}
									<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
								{/if}
							</button>
						</td>
						<td>
							<button
								type="button"
								class="mm-star"
								class:starred={row.is_default}
								title={row.is_default ? 'Current default' : 'Make default'}
								aria-label={row.is_default
									? `${row.label} is the default`
									: `Make ${row.label} the default`}
								aria-pressed={row.is_default}
								disabled={row.is_default || row.status !== 'active' || savingId === row.id}
								onclick={() => makeDefault(row)}
							>
								<svg
									width="16"
									height="16"
									viewBox="0 0 24 24"
									fill={row.is_default ? 'currentColor' : 'none'}
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
									><polygon
										points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
									/></svg
								>
							</button>
						</td>
						<td>
							<button
								type="button"
								class="mm-switch"
								class:on={row.status === 'active'}
								role="switch"
								aria-checked={row.status === 'active'}
								aria-label="Enable {row.label}"
								disabled={savingId === row.id}
								onclick={() => toggleEnabled(row)}
							>
								<span class="mm-switch-knob"></span>
							</button>
						</td>
					</tr>
				{/each}
				{#if wired.length === 0}
					<tr><td colspan="8" class="mm-empty-row">No wired models for this type yet.</td></tr>
				{/if}
			</tbody>
		</table>
	</div>

	<!-- ── Discovered: staged models from the fal catalog ──────────────────── -->
	<h2 class="mm-section-title">Discovered on fal</h2>
	<p class="mm-section-sub">
		Newest releases in this category, synced from the live catalog. Staged: they're visible with
		dates and pricing so you can track what's out there — probe a model's request schema to see
		whether auto-wiring can adopt it. Adoption ships in the next phase.
	</p>
	{#if discovered.length === 0}
		<div class="mm-discover-empty">
			Nothing synced yet for this category — hit <b>Check for new models</b> above to pull the latest
			fal catalog.
		</div>
	{:else}
		<div class="mm-discover-list">
			{#each discovered as row (row.id)}
				{@const age = ageOf(row.released_at)}
				<div class="mm-discover-row" class:quarantined={row.status === 'quarantined'}>
					<div class="mm-discover-main">
						<span class="mm-model-name">
							{row.label}
							{#if age}<span class="pill age {age.cls}">{age.label}</span>{/if}
							{#if age?.fresh}<span class="pill age {age.cls}">{age.fresh}</span>{/if}
							{#if row.deprecated}<span class="pill pill-dep">DEPRECATED</span>{/if}
							{#if row.status === 'quarantined'}<span class="pill pill-quar">NEEDS REVIEW</span
								>{/if}
							{#if row.probe?.ok}<span class="pill pill-ok">SCHEMA OK</span>{/if}
						</span>
						<span class="mm-model-id"
							>{row.model_id}{#if row.lab}&ensp;·&ensp;{row.lab}{/if}{#if row.released_at}&ensp;·&ensp;{row.released_at}{/if}</span
						>
						{#if row.note}<span class="mm-discover-desc">{row.note}</span>{/if}
						{#if row.probe && !row.probe.ok && row.probe.unknownRequired?.length}
							<span class="mm-discover-why"
								>Requires fields the pipeline doesn't produce: {row.probe.unknownRequired.join(
									', '
								)}</span
							>
						{/if}
					</div>
					<div class="mm-discover-side">
						<span class="mm-discover-price">
							{#if row.price_usd != null}
								<b>${row.price_usd}</b>
								<span class="mm-dim">est / call</span>
							{:else}
								<span class="pill pill-quar">NO PRICE DATA</span>
							{/if}
						</span>
						<button
							type="button"
							class="mm-probe-btn"
							disabled={probingId === row.id}
							onclick={() => probe(row)}
						>
							{#if probingId === row.id}
								<span class="spin" aria-hidden="true"></span> Probing…
							{:else if row.probe}
								Re-probe schema
							{:else}
								Probe schema
							{/if}
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.mm-page {
		max-width: 1280px;
		margin: 0 auto;
	}

	.mm-header {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-5);
	}

	.mm-header h1 {
		font-family: var(--font-display);
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0 0 0.25rem;
	}

	.mm-sub {
		color: var(--text-muted);
		font-size: 0.85rem;
		margin: 0;
		max-width: 60ch;
	}

	.mm-header-actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.mm-sync-note {
		font-size: 0.74rem;
		color: var(--text-dim);
		white-space: nowrap;
	}

	.mm-sync-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 9px 16px;
		min-height: 44px;
		border-radius: 10px;
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		background: var(--accent-soft);
		color: var(--accent);
		font-family: inherit;
		font-size: 0.84rem;
		font-weight: 700;
		cursor: pointer;
		transition: background 0.15s ease;
		white-space: nowrap;
	}

	.mm-sync-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
	}

	.mm-sync-btn:disabled {
		opacity: 0.7;
		cursor: default;
	}

	.spin {
		width: 13px;
		height: 13px;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		display: inline-block;
		animation: mm-spin 0.8s linear infinite;
	}

	@keyframes mm-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.mm-error {
		padding: 12px 16px;
		border-radius: 10px;
		background: var(--error-soft);
		color: var(--error-text, var(--error));
		font-size: 0.85rem;
		margin-bottom: var(--space-4);
	}

	/* ── Toolbar ── */
	.mm-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-5);
	}

	.mm-tabs {
		display: inline-flex;
		gap: 4px;
		padding: 4px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
	}

	.mm-tab {
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
		font-size: 0.84rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.mm-tab:hover {
		color: var(--text);
	}

	.mm-tab.active {
		background: var(--accent-soft);
		color: var(--accent);
	}

	.mm-tab-count {
		font-size: 0.66rem;
		font-weight: 700;
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}

	.mm-sort {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 0.74rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
	}

	.mm-sort select {
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

	/* ── Section headers ── */
	.mm-section-title {
		font-size: 1.02rem;
		font-weight: 700;
		margin: 0 0 4px;
	}

	.mm-section-sub {
		color: var(--text-muted);
		font-size: 0.8rem;
		margin: 0 0 var(--space-3);
		max-width: 72ch;
	}

	/* ── Roster table ── */
	.mm-tablewrap {
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
		margin-bottom: var(--space-7);
	}

	.mm-table {
		border-collapse: collapse;
		width: 100%;
		min-width: 900px;
		font-size: 0.83rem;
	}

	.mm-table th {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
		font-weight: 700;
		text-align: left;
		padding: 12px 14px 8px;
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}

	.mm-table td {
		padding: 12px 14px;
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
	}

	.mm-table tr:last-child td {
		border-bottom: none;
	}

	.row-disabled td {
		opacity: 0.55;
	}
	.row-disabled td:last-child {
		opacity: 1;
	}
	.row-saving td {
		opacity: 0.7;
	}

	.mm-model-cell {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 220px;
	}

	.mm-model-name {
		font-weight: 700;
		color: var(--text);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.mm-model-id {
		font-family: var(--font-mono, monospace);
		font-size: 0.7rem;
		color: var(--text-dim);
		word-break: break-all;
	}

	.mm-model-lab {
		font-size: 0.72rem;
		color: var(--text-muted);
	}

	.mm-date-cell {
		white-space: nowrap;
	}

	.mm-date {
		font-variant-numeric: tabular-nums;
		font-size: 0.78rem;
		color: var(--text-muted);
		margin-right: 6px;
	}

	.mm-dim {
		color: var(--text-dim);
		font-size: 0.72rem;
	}
	.mm-src {
		display: block;
		margin-top: 2px;
	}

	/* pills */
	.pill {
		display: inline-block;
		font-size: 0.6rem;
		font-weight: 800;
		letter-spacing: 0.05em;
		border-radius: 999px;
		padding: 1px 7px;
		white-space: nowrap;
		vertical-align: middle;
	}

	/* Reference values render as text; only the row you put in edit mode shows inputs. */
	.mm-readonly {
		font-variant-numeric: tabular-nums;
		color: var(--text);
		font-weight: 600;
	}

	.mm-edit-btn {
		width: 30px;
		height: 30px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-dim);
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
	}

	.mm-edit-btn:hover {
		background: var(--surface-2);
		color: var(--text);
		border-color: var(--border-hover);
	}

	.mm-edit-btn.editing {
		background: var(--accent-soft);
		border-color: var(--accent-mid);
		color: var(--accent);
	}

	.mm-edit-btn:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.pill.age.age-new {
		background: color-mix(in srgb, var(--success) 15%, transparent);
		color: var(--success);
	}
	.pill.age.age-recent {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.pill.age.age-aging {
		background: var(--surface-2);
		color: var(--text-muted);
		border: 1px solid var(--border);
	}
	.pill.age.age-old {
		background: var(--surface-2);
		color: var(--text-dim);
		border: 1px solid var(--border);
	}
	.pill-dep {
		background: color-mix(in srgb, var(--error) 14%, transparent);
		color: var(--error);
	}
	.pill-quar {
		background: color-mix(in srgb, var(--warning) 16%, transparent);
		color: var(--warning);
	}
	.pill-ok {
		background: color-mix(in srgb, var(--success) 15%, transparent);
		color: var(--success);
	}
	.pill-best {
		background: color-mix(in srgb, var(--success) 15%, transparent);
		color: var(--success);
		margin-top: 4px;
		display: inline-block;
	}
	.pill-tier {
		background: var(--surface-2);
		color: var(--text-muted);
		border: 1px solid var(--border);
		text-transform: uppercase;
	}
	.pill-tier[data-tier='premium'] {
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
	}

	/* inline edits */
	.mm-input {
		border: 1px solid var(--border);
		border-radius: 7px;
		background: var(--surface-2);
		color: var(--text);
		font-family: inherit;
		font-size: 0.82rem;
		padding: 6px 8px;
		min-height: 36px;
	}

	.mm-input:focus {
		outline: none;
		border-color: var(--accent-mid);
		background: var(--surface);
	}

	.mm-input-price {
		width: 76px;
		font-variant-numeric: tabular-nums;
	}
	.mm-input-lat {
		width: 62px;
		font-variant-numeric: tabular-nums;
	}
	.mm-input-q {
		width: 58px;
	}

	.mm-price-edit,
	.mm-latency-edit {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	/* value bar */
	.mm-value-cell {
		min-width: 110px;
	}

	.mm-value-bar {
		width: 96px;
		height: 7px;
		border-radius: 999px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		overflow: hidden;
	}

	.mm-value-fill {
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--accent), var(--success));
	}

	/* default star */
	.mm-star {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-dim);
		cursor: pointer;
		transition:
			color 0.15s ease,
			border-color 0.15s ease;
	}

	.mm-star::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		min-width: 44px;
		min-height: 44px;
	}

	.mm-star:hover:not(:disabled) {
		color: var(--warning);
		border-color: color-mix(in srgb, var(--warning) 45%, transparent);
	}

	.mm-star.starred {
		color: var(--warning);
		border-color: color-mix(in srgb, var(--warning) 50%, transparent);
		background: color-mix(in srgb, var(--warning) 10%, transparent);
	}

	.mm-star:disabled:not(.starred) {
		opacity: 0.4;
		cursor: default;
	}
	.mm-star.starred:disabled {
		cursor: default;
	}

	/* enabled switch */
	.mm-switch {
		position: relative;
		width: 40px;
		height: 22px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		cursor: pointer;
		padding: 0;
		transition:
			background 0.15s ease,
			border-color 0.15s ease;
	}

	.mm-switch::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		min-width: 44px;
		min-height: 44px;
	}

	.mm-switch-knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--text-dim);
		transition:
			transform 0.15s ease,
			background 0.15s ease;
	}

	.mm-switch.on {
		background: color-mix(in srgb, var(--success) 25%, transparent);
		border-color: color-mix(in srgb, var(--success) 50%, transparent);
	}

	.mm-switch.on .mm-switch-knob {
		transform: translateX(18px);
		background: var(--success);
	}

	.mm-switch:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.mm-empty-row {
		text-align: center;
		color: var(--text-dim);
		padding: var(--space-6) !important;
	}

	/* ── Discovered list ── */
	.mm-discover-empty {
		padding: var(--space-6);
		border: 1px dashed var(--border);
		border-radius: var(--radius-md);
		color: var(--text-muted);
		font-size: 0.85rem;
		text-align: center;
	}

	.mm-discover-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.mm-discover-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 16px;
		padding: 12px 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--surface);
	}

	.mm-discover-row.quarantined {
		border-color: color-mix(in srgb, var(--warning) 35%, transparent);
	}

	.mm-discover-main {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		flex: 1 1 380px;
	}

	.mm-discover-desc {
		font-size: 0.76rem;
		color: var(--text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.mm-discover-why {
		font-size: 0.74rem;
		color: var(--warning);
	}

	.mm-discover-side {
		display: flex;
		align-items: center;
		gap: 14px;
		flex-shrink: 0;
	}

	.mm-discover-price {
		font-size: 0.84rem;
		color: var(--text);
		display: inline-flex;
		align-items: baseline;
		gap: 5px;
		font-variant-numeric: tabular-nums;
	}

	.mm-probe-btn {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 8px 14px;
		min-height: 44px;
		border-radius: 9px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-muted);
		font-family: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition:
			color 0.15s ease,
			border-color 0.15s ease;
	}

	.mm-probe-btn:hover:not(:disabled) {
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 40%, transparent);
	}

	.mm-probe-btn:disabled {
		opacity: 0.7;
		cursor: default;
	}

	@media (max-width: 768px) {
		.mm-toolbar {
			flex-direction: column;
			align-items: stretch;
		}
		.mm-tabs {
			flex-wrap: wrap;
		}
	}
</style>
