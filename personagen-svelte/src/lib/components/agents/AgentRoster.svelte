<script lang="ts">
	import StatusBadge from './StatusBadge.svelte';
	import SelectionToolbar from '$lib/components/ui/SelectionToolbar.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { showToast } from '$lib/stores/ui.svelte';
	import { confirmAction } from '$lib/stores/confirm.svelte';
	import { quote } from '$lib/stores/pricing.svelte';
	import { plural, countLabel } from '$lib/plural';
	// Using any[] because agents data comes from raw JSON with camelCase fields
	import { seatBlockedReason, type SeatCapabilities } from '$lib/seat';
	interface Props {
		agents: any[];
		/** The viewer's seat. Absent = full access (the never-brick default). */
		seat?: SeatCapabilities;
	}

	let { agents, seat }: Props = $props();

	/**
	 * The Active switch's state as the user last set it, until the server's data
	 * catches up.
	 *
	 * `agents` is plain load data, not a $state proxy, so the old
	 * `agent.active = !agent.active` mutated an object nothing was watching: the
	 * POST succeeded, the toast said "Status updated to active", and the switch,
	 * the badge, the sidebar dot and the KPI all went on showing the OLD state
	 * until a reload. A client re-audit caught it — the natural reaction, a
	 * second press, then paused the persona again.
	 *
	 * So: an override the UI reads immediately, then invalidateAll() so every
	 * surface (badge, sidebar, KPI) reconciles to what the server now holds, and
	 * the override is dropped once that data arrives.
	 */
	let activeOverride = $state<Record<string, boolean>>({});
	let togglingIds = $state<Record<string, boolean>>({});
	const isActive = (agent: any): boolean => activeOverride[agent.id] ?? !!agent.active;
	const shownStatus = (agent: any): string =>
		agent.id in activeOverride ? (activeOverride[agent.id] ? 'active' : 'paused') : agent.status;

	/** A viewer seat can see personas but the server refuses the toggle (403). */
	let toggleBlocked = $derived(seatBlockedReason(seat, 'creator'));
	/** Deleting a persona outright is owner-only on the server. */
	let deleteBlocked = $derived(seatBlockedReason(seat, 'owner'));
	/**
	 * The seat's limits as VISIBLE text. The reason used to live only in the
	 * `title` of a disabled switch — no pointer-free way to read it, and nothing
	 * on screen said why a control did nothing. The switches and delete buttons
	 * point at this with aria-describedby.
	 */
	let seatNote = $derived(
		toggleBlocked
			? `Your ${seat?.label ?? 'current'} seat can see these personas but can't switch them on or off (that needs Creator or above) or delete them (Owner only). Ask a workspace admin to change your seat.`
			: deleteBlocked
				? `Only the workspace owner can delete a persona — your ${seat?.label ?? 'current'} seat can switch them on and off.`
				: null
	);

	/** Gen Spend read "$0.00 (0)" on every row for any account whose generations
	 *  predate metering, spending a column of horizontal budget on a cell that
	 *  cannot carry a value. Same rule as the review queue's QC column: a column
	 *  with nothing in it for any row is not rendered, and returns by itself. */
	let hasSpend = $derived(agents.some((a: any) => (a.total_token_cost ?? 0) > 0));
	/** Column count, for the empty state's single spanning cell. */
	let columnCount = $derived(hasSpend ? 8 : 7);

	type FilterType = 'all' | 'active' | 'paused' | 'pending' | 'top';

	let currentFilter = $state<FilterType>('all');

	/**
	 * Ids deleted in this session. Their rows disappear immediately so the table
	 * reflects the delete without a reload; each id is dropped again as soon as
	 * the reloaded server data agrees the persona is gone.
	 */
	let removedIds = $state<string[]>([]);

	let filteredAgents = $derived.by(() => {
		let result = agents.filter((a) => !removedIds.includes(a.id));
		switch (currentFilter) {
			case 'active':
				return result.filter((a) => a.status === 'active');
			case 'paused':
				return result.filter((a) => a.status === 'paused' || a.status === 'failing');
			case 'pending':
				return result.filter((a) => a.status === 'pending');
			case 'top':
				// Was `a.perf >= 70` against a score whose floor was 70, so it
				// returned the whole roster. Now: personas that have actually
				// published, best engagement first. A roster where nothing has
				// published yields an empty list, which is the true answer.
				return result
					.filter((a) => (a.publishedPosts ?? 0) > 0)
					.sort((a, b) => (b.engagementRate ?? 0) - (a.engagementRate ?? 0));
			default:
				return result;
		}
	});

	// ── Multi-select ───────────────────────────────────────────────────────
	const selected = new SvelteSet<string>();

	// Only ids that are actually on screen count towards the toolbar and towards
	// a bulk delete, so "N selected" never describes rows the filter is hiding.
	let selectedVisible = $derived(
		filteredAgents.filter((a) => selected.has(a.id)).map((a) => a.id as string)
	);
	let allVisibleSelected = $derived(
		filteredAgents.length > 0 && selectedVisible.length === filteredAgents.length
	);

	// Prune ids for personas that no longer exist (deleted here or elsewhere).
	$effect(() => {
		const present = new Set(agents.map((a) => a.id));
		for (const id of Array.from(selected)) {
			if (!present.has(id)) selected.delete(id);
		}
	});

	// Stop hiding rows once the reloaded data agrees they are gone.
	$effect(() => {
		if (removedIds.length === 0) return;
		const stillReturned = removedIds.filter((id) => agents.some((a) => a.id === id));
		if (stillReturned.length !== removedIds.length) removedIds = stillReturned;
	});

	function toggleSelect(id: string) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}

	function selectAllVisible() {
		for (const a of filteredAgents) selected.add(a.id);
	}

	function clearSelection() {
		selected.clear();
	}

	function nameOf(id: string): string {
		return agents.find((a) => a.id === id)?.name || 'Persona';
	}

	// ── Delete (single + bulk) ─────────────────────────────────────────────
	// Deleting a persona also destroys its posts, connections, memories and chat
	// history — and unlike a post it does NOT go to Trash. Both paths therefore go
	// through the app-wide ConfirmDialog with type-to-confirm. This used to be a
	// bespoke modal here; it now shares the one every other destructive action uses.
	let deleting = $state(false);

	async function requestDelete(ids: string[]) {
		if (ids.length === 0 || deleting) return;

		const protectedCount = ids.filter((id) => agents.find((a) => a.id === id)?.is_overseer).length;
		const ok = await confirmAction({
			title: `Delete ${ids.length === 1 ? 'persona' : countLabel(ids.length, 'persona')}?`,
			body:
				'This also permanently destroys every post, platform connection, memory and chat ' +
				`message belonging to ${ids.length === 1 ? 'this persona' : 'these personas'}. ` +
				'Personas do not go to Trash.',
			warning:
				protectedCount > 0
					? `There is no undo for this. ${protectedCount} protected Hermes overseer ` +
						`${plural(protectedCount, 'persona')} in this selection will be skipped.`
					: 'There is no undo for this.',
			preview: ids.map((id) => {
				const a = agents.find((x) => x.id === id);
				return {
					gradient: a?.gradient ?? null,
					initial: a?.initial ?? a?.name?.charAt(0) ?? null,
					label: a?.name ?? 'Persona',
					meta: a?.handle ? `@${a.handle}` : (a?.niche ?? null),
					badge: a?.is_overseer ? 'Protected' : null
				};
			}),
			confirmLabel: `Delete ${ids.length === 1 ? 'persona' : countLabel(ids.length, 'persona')}`,
			tone: 'danger',
			typeToConfirm: 'DELETE'
		});
		if (!ok) return;
		await runDelete(ids);
	}

	async function runDelete(ids: string[]) {
		if (deleting || ids.length === 0) return;
		// Names must be captured up front — the rows vanish on success.
		const names = new Map<string, string>(ids.map((id) => [id, nameOf(id)]));
		deleting = true;
		try {
			const res = await fetch('/api/agents/config', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(ids.length === 1 ? { agentId: ids[0] } : { agentIds: ids })
			});
			const data = await res.json().catch(() => ({}));
			// The endpoint reports per-agent outcomes; never assume the whole batch went.
			const deleted: string[] = Array.isArray(data?.deleted)
				? data.deleted
				: res.ok && data?.success
					? ids
					: [];
			const failed: Array<{ agentId: string; error: string }> = Array.isArray(data?.failed)
				? data.failed
				: [];

			if (deleted.length > 0) {
				removedIds = removedIds.concat(deleted);
				for (const id of deleted) selected.delete(id);
				showToast(
					deleted.length === 1
						? `Deleted ${names.get(deleted[0]) ?? 'persona'}`
						: `Deleted ${countLabel(deleted.length, 'persona')}`,
					'success'
				);
			}

			if (failed.length > 0) {
				const detail = failed
					.slice(0, 3)
					.map((f) => `${names.get(f.agentId) ?? f.agentId} — ${f.error}`)
					.join('; ');
				const more = failed.length > 3 ? ` (+${failed.length - 3} more)` : '';
				showToast(
					`${countLabel(failed.length, 'persona')} could not be deleted: ${detail}${more}`,
					'error'
				);
			} else if (deleted.length === 0) {
				throw new Error(data?.error || 'Delete failed');
			}

			// Refresh the sidebar persona list and every other loader-backed view.
			if (deleted.length > 0) await invalidateAll();
		} catch (err) {
			console.error('[AgentRoster] Failed to delete personas:', err);
			showToast((err as Error).message || 'Failed to delete personas', 'error');
		} finally {
			deleting = false;
		}
	}

	const filters: { label: string; value: FilterType }[] = [
		{ label: 'All', value: 'all' },
		{ label: 'Active', value: 'active' },
		{ label: 'Paused', value: 'paused' },
		{ label: 'Pending', value: 'pending' },
		{ label: 'Top Performers', value: 'top' }
	];

	// Semantic tokens rather than literals so the bars follow the theme (and the brand
	// theme feature) instead of staying frozen at one palette.
	function engagementClass(eng: number): string {
		if (eng >= 5) return 'positive';
		if (eng < 3) return 'negative';
		return '';
	}

	async function toggleAgent(agent: any) {
		if (agent.status === 'pending' || toggleBlocked || togglingIds[agent.id]) return;
		const next = !isActive(agent);
		activeOverride = { ...activeOverride, [agent.id]: next };
		togglingIds = { ...togglingIds, [agent.id]: true };
		const status = next ? 'active' : 'paused';

		try {
			const res = await fetch('/api/agents/config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ agentId: agent.id, status })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok || !data.success) {
				throw new Error(data.error || 'Server error');
			}
			showToast(`${agent.name} is now ${status}`, 'success');
			// Every other surface that shows this persona's state reads server data.
			await invalidateAll();
			await restoreSwitchFocus(agent.id);
		} catch (err: any) {
			console.error('[AgentRoster] Failed to toggle status in DB:', err);
			showToast(err.message || 'Failed to sync status with database', 'error');
		} finally {
			// Success: the reloaded data now carries the new state. Failure: dropping
			// the override IS the revert, to exactly what the server still holds.
			const { [agent.id]: _dropped, ...rest } = activeOverride;
			activeOverride = rest;
			const { [agent.id]: _busy, ...others } = togglingIds;
			togglingIds = others;
		}
	}

	/**
	 * The switch stays focusable while its request is in flight (aria-disabled,
	 * not `disabled`: disabling the focused button dropped keyboard focus to
	 * <body> in every browser, so a second Space — the natural undo — went
	 * nowhere). If the reload removed the row (e.g. pausing under the "Active"
	 * filter), focus lands on the roster rather than the top of the document.
	 */
	let rosterEl = $state<HTMLElement | null>(null);
	async function restoreSwitchFocus(agentId: string) {
		await tick();
		const active = document.activeElement;
		if (active && active !== document.body) return;
		const sw = rosterEl?.querySelector<HTMLElement>(`[data-toggle-for="${agentId}"]`);
		(sw ?? rosterEl)?.focus();
	}

	function formatTokens(tokens: number): string {
		if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
		if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
		return String(tokens);
	}
</script>

<div class="dash-table-wrap">
	<div class="dash-table-header">
		<h3>Your Personas</h3>
		<!-- A group of pressed-state buttons. It was role="tablist" with no tabpanel
		     and no arrow keys — the same fake tablist the Admin page dropped. -->
		<div class="dash-table-filters" role="group" aria-label="Filter personas">
			{#each filters as filter}
				<button
					type="button"
					class="dash-filter"
					class:active={currentFilter === filter.value}
					aria-pressed={currentFilter === filter.value}
					onclick={() => (currentFilter = filter.value)}
				>
					{filter.label}
				</button>
			{/each}
		</div>
	</div>

	{#if seatNote}
		<p class="roster-seat-note" id="roster-seat-note">{seatNote}</p>
	{/if}

	<!-- Selection exists only to bulk-delete, which is owner-only on the server:
	     a seat that cannot delete is not offered checkboxes that lead to a 403. -->
	{#if !deleteBlocked}
		<SelectionToolbar
			total={filteredAgents.length}
			selectedCount={selectedVisible.length}
			noun="persona"
			busy={deleting}
			onSelectAll={selectAllVisible}
			onClear={clearSelection}
			onDelete={() => void requestDelete(selectedVisible.slice())}
		/>
	{/if}

	<!-- A real, consistent ARIA table (audit A11Y-002). The previous version made
	     each row a role="link" with the checkbox, switch and delete button nested
	     INSIDE the link — a link's children are presentational, so those controls
	     were misrepresented — left one orphan role="cell", and hid a focusable
	     select-all checkbox inside an aria-hidden header. Now: table > row >
	     columnheader/cell throughout, so a screen reader announces each value with
	     its column, and the persona's NAME is the link. -->
	<div class="dash-table" role="table" aria-label="Persona roster" tabindex="-1" bind:this={rosterEl}>
		<div class="dash-row row-header" class:no-spend={!hasSpend} role="row">
			<span class="pick-cell" role="columnheader">
				{#if !deleteBlocked}
					<input
						type="checkbox"
						class="pick-box pick-all"
						aria-label="Select all personas in view"
						checked={allVisibleSelected}
						indeterminate={selectedVisible.length > 0 && !allVisibleSelected}
						disabled={filteredAgents.length === 0 || deleting}
						onchange={() => (allVisibleSelected ? clearSelection() : selectAllVisible())}
					/>
				{:else}
					<span class="sr-only">Select</span>
				{/if}
			</span>
			<span role="columnheader">Persona</span>
			<span role="columnheader">Followers</span>
			<span role="columnheader">Engagement</span>
			{#if hasSpend}
				<span role="columnheader">Gen Spend</span>
			{/if}
			<span role="columnheader">Published <span class="col-period">all time</span></span>
			<span role="columnheader">Active</span>
			<span class="pick-cell" role="columnheader"><span class="sr-only">Delete</span></span>
		</div>

		<!-- Agent Rows -->
		{#each filteredAgents as agent (agent.id)}
			<!-- The whole row stays clickable as a mouse convenience; the keyboard and
			     screen-reader path is the persona-name link in the first data cell. -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_interactive_supports_focus -->
			<div
				onclick={(e) => {
					// A click on a control inside the row is that control's, not the row's.
					if ((e.target as HTMLElement).closest('a, button, input, label')) return;
					goto(`/personas/${agent.id}`);
				}}
				class="dash-row"
				class:no-spend={!hasSpend}
				class:is-selected={selected.has(agent.id)}
				role="row"
			>
				<!-- The cell is a span; the label inside it keeps the whole hit area
				     clickable. A role on the <label> itself is not a valid pairing. -->
				<span class="pick-cell pick-select" role="cell">
					{#if !deleteBlocked}
						<label class="pick-hit" title="Select {agent.name}">
							<input
								type="checkbox"
								class="pick-box"
								aria-label="Select {agent.name}"
								checked={selected.has(agent.id)}
								disabled={deleting}
								onchange={() => toggleSelect(agent.id)}
							/>
						</label>
					{/if}
				</span>
				<div class="dash-agent-cell" role="cell">
					<div
						class="dash-agent-avatar"
						style={agent.ugc_character_ref ? '' : `background: ${agent.gradient}`}
					>
						{#if agent.ugc_character_ref}
							<!-- decorative: the name link beside it already says who this is -->
							<img src={agent.ugc_character_ref} alt="" />
						{:else}
							{agent.initial}
						{/if}
					</div>
					<div class="dash-agent-info">
						<span class="dash-agent-name" style="display: flex; align-items: center; gap: 0.5rem;">
							<a class="dash-agent-link" href="/personas/{agent.id}">{agent.name}</a>
							{#if agent.is_overseer}
								<!-- Gradient darkened: the original mint/cyan pair carried white 9px
								     text at ~2.5:1. These stops clear 4.5:1 in both themes. -->
								<span class="hermes-badge">Hermes</span>
							{:else if agent.managed_by_overseer}
								<span class="managed-badge" title="Orchestrated and monitored by Hermes">
									<svg
										width="10"
										height="10"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true"
									>
										<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
									</svg>
									Managed
								</span>
							{/if}
						</span>
						<!-- Join only the parts that exist (audit UI-001): a missing handle OR a
						     missing niche must never leave a dangling " · ". -->
						<span class="dash-agent-niche">
							{#each [agent.handle, agent.niche].filter((v) => typeof v === 'string' && v.trim()) as part (part)}<span
									class="niche-part">{part}</span
								><span class="niche-sep" aria-hidden="true">·</span>{/each}<StatusBadge
								status={shownStatus(agent)}
							/>
						</span>
					</div>
				</div>
				<span class="dash-cell" role="cell"><span class="cell-label" aria-hidden="true">Followers</span>{agent.followers}</span>
				<!-- Only a MEASURED rate (published posts with stats); a stored figure on
				     a persona that has published nothing is not engagement. -->
				<span
					class="dash-cell {agent.hasMetrics ? engagementClass(agent.engagementRate) : ''}"
					role="cell"
				>
					<span class="cell-label" aria-hidden="true">Engagement</span>{agent.hasMetrics
						? `${agent.engagementRate}%`
						: '—'}
				</span>
				<!-- total_token_cost is the ledger's PROVIDER spend. The wallet was debited
				     at the platform markup, so rendering the raw figure with a `$` showed
				     roughly a third of what the persona actually drew down. quote() puts
				     it back in the same money the wallet pill speaks. -->
				{#if hasSpend}
					<span class="dash-cell token-cost-cell" role="cell">
						<span class="cell-label" aria-hidden="true">Gen spend</span>
						{#if agent.total_token_cost !== undefined && agent.total_token_cost !== null && agent.total_token_cost > 0}
							{quote(agent.total_token_cost)}
							<span class="token-count">({formatTokens(agent.total_token_usage || 0)})</span>
						{:else}
							{quote(0)} <span class="token-count">(0)</span>
						{/if}
					</span>
				{/if}
				<!-- A count of posts that actually went out, not a score. The bar that
				     used to live here plotted a number floored at 70 by a constant. -->
				<span class="dash-cell published-cell" role="cell">
					<span class="cell-label" aria-hidden="true">Published, all time</span>
					{#if (agent.publishedPosts ?? 0) > 0}
						<span class="published-count">{agent.publishedPosts}</span>
					{:else}
						<span class="published-none" title="This persona has not published anything yet">—</span>
					{/if}
				</span>
				<span class="dash-cell" role="cell">
					<span class="cell-label" aria-hidden="true">Active</span>
					{#if agent.status === 'pending'}
						<a
							class="agent-connect-cta"
							href="/personas/{agent.id}"
							onclick={(e) => e.stopPropagation()}
						>
							Connect →
						</a>
					{:else}
						<!-- The name is STABLE and aria-checked carries the state: a name that
						     flips with state ("Pause X", on) makes a screen reader announce the
						     action and the state together, and hides the visible column label
						     "Active" (WCAG 2.5.3). -->
						<!-- aria-disabled, never `disabled`: see restoreSwitchFocus(). A blocked
						     seat can still reach the switch and hear why via the seat note. -->
						<button
							type="button"
							class="toggle"
							role="switch"
							data-toggle-for={agent.id}
							aria-checked={isActive(agent)}
							aria-label="Active: {agent.name}"
							aria-busy={togglingIds[agent.id] ? 'true' : undefined}
							aria-disabled={toggleBlocked || togglingIds[agent.id] ? 'true' : undefined}
							aria-describedby={toggleBlocked ? 'roster-seat-note' : undefined}
							title={toggleBlocked ??
								`${isActive(agent) ? 'Pause' : 'Activate'} ${agent.name} — an active persona generates and spends`}
							onclick={(e) => {
								e.stopPropagation();
								toggleAgent(agent);
							}}
						>
							<span class="toggle-track"></span>
							<span class="toggle-thumb"></span>
						</button>
					{/if}
				</span>
				<span class="pick-cell" role="cell">
					<button
						type="button"
						class="row-del"
						aria-label="Delete {agent.name}"
						aria-describedby={deleteBlocked ? 'roster-seat-note' : undefined}
						title={agent.is_overseer
							? 'The Hermes overseer is protected and cannot be deleted'
							: (deleteBlocked ?? `Delete ${agent.name}`)}
						disabled={agent.is_overseer || deleting || !!deleteBlocked}
						onclick={(e) => {
							e.stopPropagation();
							void requestDelete([agent.id]);
						}}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<polyline points="3 6 5 6 21 6" />
							<path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
						</svg>
					</button>
				</span>
			</div>
		{/each}

		{#if filteredAgents.length === 0}
			<!-- Inside role="table" every child must be a row. -->
			<div class="dash-empty" role="row">
				<span role="cell" aria-colspan={columnCount}>No personas match this filter.</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.dash-table-wrap {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.5rem;
	}

	.dash-table-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.dash-table-header h3 {
		font-size: 0.95rem;
		font-weight: 600;
	}

	.dash-table-filters {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.dash-filter {
		position: relative;
		padding: 5px 14px;
		border-radius: var(--radius-xs);
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text-dim);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		font-family: var(--font-body);
	}

	/* Filter pills render ~26px tall. The visual size is deliberate, so the tap target is
	   grown to 44px with an invisible overlay child instead of padding the pill out. */
	.dash-filter::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 44px;
		transform: translateY(-50%);
	}

	.dash-filter:hover {
		color: var(--text-muted);
		border-color: var(--border-strong);
	}

	.dash-filter.active {
		border-color: var(--accent-mid);
		/* raw --accent is 4.08:1 on the tinted pill — under AA for this 12px label. */
		color: var(--accent-text);
		background: var(--accent-soft);
	}

	/* The roster lays itself out by ITS OWN width, not the viewport's. Keyed on
	   the viewport, the desktop grid switched on at 769px — where the sidebar
	   takes 240px and leaves the roster ~480px — so eight columns were forced
	   into a space that fits four, and a re-audit measured 11–92px clipped
	   between 769 and 950px. The container decides now. */
	.dash-table {
		container-type: inline-size;
		container-name: roster;
	}
	/* Programmatic focus target (restoreSwitchFocus): a ring for keyboard users. */
	.dash-table:focus-visible {
		outline: 2px solid var(--focus-ring);
		outline-offset: 2px;
	}

	.roster-seat-note {
		margin: 0 0 0.9rem;
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--border);
		border-left: 3px solid var(--text-dim);
		border-radius: var(--radius-xs);
		background: var(--surface-2);
		color: var(--text-muted);
		font-size: 0.8rem;
		line-height: 1.45;
	}

	/* minmax(0, …) on every flexible track. A bare `fr` track's minimum is its
	   content's min-content, so tracks could not shrink below their content
	   (the overflow) and each row — its own grid — sized its columns from its
	   own content (the zig-zag between rows). With a zero minimum every row
	   resolves identical tracks. The switch column keeps a real floor. */
	.dash-row {
		display: grid;
		grid-template-columns:
			30px minmax(0, 2.5fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)
			minmax(0, 1.2fr) minmax(52px, 0.6fr) 34px;
	}
	/* One fewer column when Gen Spend has nothing to report. */
	.dash-row.no-spend {
		grid-template-columns:
			30px minmax(0, 2.5fr) minmax(0, 1fr) minmax(0, 1fr)
			minmax(0, 1.2fr) minmax(52px, 0.6fr) 34px;
	}
	.dash-row > * {
		min-width: 0;
	}

	/* The card labels exist for sighted users in the stacked layout only.
	   Screen readers get the column headers instead, so these stay aria-hidden. */
	.cell-label {
		display: none;
	}
	.col-period {
		display: block;
		font-size: 0.85em;
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
		color: var(--text-dim);
	}

	.dash-agent-link {
		color: inherit;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dash-agent-link:hover {
		text-decoration: underline;
	}
	.dash-agent-link:focus-visible {
		outline: 2px solid var(--focus-ring, var(--accent));
		outline-offset: 2px;
		border-radius: 3px;
	}

	.niche-part {
		white-space: nowrap;
	}
	.niche-sep {
		margin: 0 0.35em;
		color: var(--text-dim);
	}
	.dash-row {
		align-items: center;
		gap: 0.75rem;
		padding: 0.65rem 0.5rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.82rem;
		text-decoration: none;
		color: inherit;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.dash-row:hover:not(.row-header) {
		background: rgba(255, 255, 255, 0.02);
	}

	/* The row is tabbable, so keyboard users need to see where they are. */
	.dash-row:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
		border-radius: var(--radius-xs);
	}

	.dash-row:last-child {
		border-bottom: none;
	}

	.dash-row.is-selected,
	.dash-row.is-selected:hover:not(.row-header) {
		background: var(--accent-soft);
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.dash-row.row-header {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
		font-weight: 700;
		border-bottom: 1px solid var(--border-strong);
		padding-bottom: 0.5rem;
		margin-bottom: 0.25rem;
		cursor: default;
	}

	.dash-agent-cell {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.dash-agent-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.72rem;
		font-weight: 700;
		color: #fff;
		flex-shrink: 0;
		overflow: hidden;
	}

	.dash-agent-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.dash-agent-info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.dash-agent-name {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Was two inline style strings with hardcoded #10B981/#06B6D4, which never repainted
	   with the brand theme and failed contrast on the light surface. */
	.hermes-badge {
		font-size: 9px;
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--success) 75%, #000),
			color-mix(in srgb, var(--cyan) 75%, #000)
		);
		color: #fff;
		padding: 2px 6px;
		border-radius: 4px;
		font-weight: 700;
		text-transform: uppercase;
		line-height: 1;
		flex-shrink: 0;
	}

	.managed-badge {
		font-size: 9px;
		background: color-mix(in srgb, var(--success) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 20%, transparent);
		color: var(--success-text);
		padding: 1px 5px;
		border-radius: 4px;
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		gap: 3px;
		line-height: 1;
		flex-shrink: 0;
	}

	.dash-agent-niche {
		font-size: 0.7rem;
		color: var(--text-dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.dash-cell {
		font-size: 0.82rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum' 1;
	}

	/* `-text` variants: the fill hues are 3.8:1 and 4.2:1 on the white card, under AA
	   for this 13px body text. */
	.dash-cell.positive {
		color: var(--success-text);
	}

	.dash-cell.negative {
		color: var(--rose-text);
	}



	/* scaleX rather than width: the bar holds no text (`.perf-val` is a flex sibling),
	   so nothing is squashed and the meter no longer relayouts the row every frame. */

	@media (prefers-reduced-motion: reduce) {
		.perf-bar {
			transition: none;
		}
	}


	/* Multi-select checkbox + row delete */
	.pick-cell {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
	}

	.pick-hit {
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		cursor: pointer;
		/* Negative margin keeps the wider hit area from shifting the grid. */
		padding: 6px;
		margin: -6px;
	}

	/* Padding alone leaves a 27px target; this overlay takes it to 44x44 without
	   resizing the native box or disturbing the grid. */
	.pick-hit::before {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 44px;
		height: 44px;
		transform: translate(-50%, -50%);
	}

	.pick-box {
		width: 15px;
		height: 15px;
		margin: 0;
		flex-shrink: 0;
		accent-color: var(--accent);
		cursor: pointer;
	}

	.pick-box:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	.row-del {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border-radius: var(--radius-xs);
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-dim);
		cursor: pointer;
		transition: all 0.2s;
	}

	/* 26px button keeps its look; the tap target reaches 44x44 via an overlay child. */
	.row-del::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 44px;
		height: 44px;
		transform: translate(-50%, -50%);
	}

	.row-del:disabled::after {
		display: none;
	}

	.row-del:hover:not(:disabled) {
		color: var(--error);
		border-color: color-mix(in srgb, var(--error) 45%, transparent);
		background: color-mix(in srgb, var(--error) 12%, transparent);
	}

	.row-del:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	/* Toggle switch */
	.toggle {
		position: relative;
		display: inline-flex;
		align-items: center;
		cursor: pointer;
		width: 36px;
		height: 20px;
		padding: 0;
		border: none;
		background: none;
	}

	/* The switch stays 36x20 visually; this invisible overlay lifts the tap target to
	   44x44. It is the first positioned child, so the track and thumb still paint over
	   it, and clicks land on the label exactly as before. */
	.toggle::before {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 44px;
		height: 44px;
		transform: translate(-50%, -50%);
	}

	/* OFF used to be a 15%-alpha grey track (1.37:1 against the card) under a
	   white thumb (1.00:1) — on screen, a bare white dot. WCAG 1.4.11 wants the
	   parts that identify a control and its state at 3:1. OFF is now an outlined
	   track with a solid dim thumb (6.3:1 light, 5.0:1 dark); ON is the filled
	   accent track with a white thumb, so the two states differ in shape and
	   fill, not in colour alone. */
	.toggle-track {
		position: absolute;
		inset: 0;
		border-radius: 10px;
		background: var(--surface);
		box-shadow: inset 0 0 0 1.5px var(--text-dim);
		transition:
			background 0.2s,
			box-shadow 0.2s;
	}

	.toggle[aria-checked='true'] .toggle-track {
		background: var(--accent);
		box-shadow: none;
	}

	.toggle-thumb {
		position: absolute;
		left: 4px;
		top: 4px;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--text-dim);
		transition:
			transform 0.2s,
			background 0.2s,
			width 0.2s,
			height 0.2s,
			left 0.2s,
			top 0.2s;
	}

	.toggle[aria-checked='true'] .toggle-thumb {
		left: 2px;
		top: 2px;
		width: 16px;
		height: 16px;
		background: #fff;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
		transform: translateX(16px);
	}

	.toggle[aria-busy='true'] {
		cursor: progress;
	}
	.toggle[aria-disabled='true']:not([aria-busy='true']) {
		cursor: not-allowed;
		opacity: 0.55;
	}

	@media (prefers-reduced-motion: reduce) {
		.toggle-track,
		.toggle-thumb {
			transition: none;
		}
	}

	/* Connect CTA */
	.agent-connect-cta {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		border-radius: var(--radius-xs);
		background: color-mix(in srgb, var(--warning) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent);
		color: var(--warning-text);
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
		transition: all 0.2s;
		min-height: 28px;
	}

	/* Pill reads ~28px tall; grow the tap target to 44px without inflating the design. */
	.agent-connect-cta::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 44px;
		transform: translateY(-50%);
	}

	.agent-connect-cta:hover {
		background: color-mix(in srgb, var(--warning) 20%, transparent);
	}

	.dash-empty {
		display: block;
		padding: 2rem;
		text-align: center;
		color: var(--text-dim);
		font-size: 0.85rem;
	}

	@container roster (max-width: 720px) {
		/* Stacked card: checkbox / agent / delete on the first line, labelled
		   metrics underneath the agent cell.

		   BOTH selectors, deliberately. A container query adds no specificity,
		   so a lone `.dash-row` here lost to `.dash-row.no-spend` (two classes)
		   above: every workspace without spend kept the seven-track desktop grid
		   inside the card, and a re-audit measured persona names 0px wide at
		   320–390px. roster-layout.spec.ts holds this. */
		.dash-row,
		.dash-row.no-spend {
			grid-template-columns: 30px minmax(0, 1fr) 34px;
			gap: 0.4rem 0.5rem;
			padding: 0.75rem 0.5rem;
		}

		.pick-cell.pick-select {
			grid-column: 1;
			grid-row: 1;
		}

		.dash-agent-cell {
			grid-column: 2;
			grid-row: 1;
		}

		.pick-cell:not(.pick-select) {
			grid-column: 3;
			grid-row: 1;
		}

		.dash-cell {
			grid-column: 2;
		}

		/* Visually hidden, NOT display:none: the column headers must stay in the
		   accessibility tree, or a screen reader loses which value is which in
		   exactly the layout where the labels are no longer lined up. */
		.dash-row.row-header {
			position: absolute;
			width: 1px;
			height: 1px;
			margin: -1px;
			padding: 0;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
			border: 0;
		}

		.dash-cell {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			font-size: 0.75rem;
		}

		.cell-label {
			display: inline;
			min-width: 6.5rem;
			color: var(--text-dim);
			font-weight: 600;
		}

		/* The select-all box would be a Tab stop inside a 1px clipped header —
		   focus you cannot see (2.4.7). The toolbar's visible "Select all" button
		   does the same job in this layout. */
		.row-header .pick-all {
			visibility: hidden;
		}
	}

	/* The filter bar stacks on narrow VIEWPORTS (its own row is not in the
	   roster container). */
	@media (max-width: 768px) {
		.dash-table-header {
			flex-direction: column;
			align-items: flex-start;
		}
	}

	.token-cost-cell {
		/* #f59e0b was 2.15:1 on the white card — the AA text variant is 6.2:1. */
		color: var(--warning-text) !important;
		font-family: var(--font-mono);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		font-feature-settings: 'tnum' 1;
	}

	.published-cell {
		font-variant-numeric: tabular-nums;
	}
	.published-count {
		font-weight: 600;
		color: var(--text);
	}
	.published-none {
		color: var(--text-dim);
	}

	.token-count {
		font-size: 0.7rem;
		color: var(--text-dim);
	}
</style>
