<script lang="ts">
	let { data } = $props();

	let tab = $state<'overview' | 'activity' | 'seats' | 'spend' | 'access' | 'platform'>(
		data.isPlatformAdmin && data.workspaces.length === 0 ? 'platform' : 'overview'
	);

	const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
	const when = (iso: string) => {
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
	};

	let activityFilter = $state<'all' | 'generation' | 'review' | 'publish'>('all');
	let filteredActivity = $derived(
		activityFilter === 'all'
			? data.activity
			: data.activity.filter((a: any) => a.kind === activityFilter)
	);

	// ── Platform tab (platform admins only) — credits across every tenant ──
	type PlatformUser = {
		id: string;
		email: string | null;
		created_at: string;
		last_sign_in_at: string | null;
		never_signed_in: boolean;
		balance_credits: number;
		billing_mode: 'credits' | 'unmetered';
		has_wallet: boolean;
		month_debited_credits: number;
		month_waived_credits: number;
		month_est_usd: number;
		month_events: number;
	};
	let platformUsers = $state<PlatformUser[]>([]);
	let platformMode = $state<'off' | 'shadow' | 'enforce'>('off');
	let platformLoading = $state(false);
	let platformError = $state<string | null>(null);
	let platformLoaded = $state(false);
	let platformSearch = $state('');
	let selectedIds = $state<string[]>([]);
	let bulkCredits = $state(5000);
	let bulkNote = $state('');
	let action = $state<{ userId: string; email: string; op: 'grant' | 'set' | 'adjust' } | null>(null);
	let actionCredits = $state(0);
	let actionNote = $state('');
	let actionBusy = $state(false);
	let ledgerFor = $state<{ userId: string; email: string } | null>(null);
	let ledgerRows = $state<any[]>([]);
	let ledgerLoading = $state(false);
	let toast = $state<string | null>(null);

	const fmtCredits = (n: number) => `${(Number(n) || 0).toLocaleString()} cr`;
	const usdOfCredits = (n: number) => `$${((Number(n) || 0) / 100).toFixed(2)}`;
	const flash = (msg: string) => {
		toast = msg;
		setTimeout(() => (toast = null), 4000);
	};

	let visiblePlatformUsers = $derived(
		platformSearch.trim()
			? platformUsers.filter((u) => (u.email ?? u.id).toLowerCase().includes(platformSearch.trim().toLowerCase()))
			: platformUsers
	);

	async function loadPlatform() {
		platformLoading = true;
		platformError = null;
		try {
			const res = await fetch('/api/admin/credits');
			const body = await res.json();
			if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
			platformUsers = body.users;
			platformMode = body.mode;
			platformLoaded = true;
		} catch (e) {
			platformError = (e as Error).message;
		} finally {
			platformLoading = false;
		}
	}

	async function postCredits(payload: Record<string, unknown>): Promise<string | null> {
		const res = await fetch('/api/admin/credits', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const body = await res.json().catch(() => ({}));
		return res.ok && body.success ? null : body.error || `HTTP ${res.status}`;
	}

	function openAction(u: PlatformUser, op: 'grant' | 'set' | 'adjust') {
		action = { userId: u.id, email: u.email ?? u.id, op };
		actionCredits = op === 'set' ? u.balance_credits : op === 'grant' ? 1000 : 0;
		actionNote = '';
	}

	async function submitAction() {
		if (!action) return;
		actionBusy = true;
		const err = await postCredits({ userId: action.userId, op: action.op, credits: actionCredits, note: actionNote });
		actionBusy = false;
		if (err) return flash(`Failed: ${err}`);
		flash(`${action.op} ${actionCredits.toLocaleString()} → ${action.email}`);
		action = null;
		await loadPlatform();
	}

	async function toggleMode(u: PlatformUser) {
		const next = u.billing_mode === 'unmetered' ? 'credits' : 'unmetered';
		const note = window.prompt(`Set ${u.email ?? u.id} to "${next}". Why? (recorded in the ledger)`);
		if (note === null) return;
		if (!note.trim()) return flash('A note is required.');
		const err = await postCredits({ userId: u.id, op: 'mode', mode: next, note });
		if (err) return flash(`Failed: ${err}`);
		flash(`${u.email ?? u.id} → ${next}`);
		await loadPlatform();
	}

	async function bulkGrant() {
		if (selectedIds.length === 0) return flash('Select at least one account.');
		if (!bulkNote.trim()) return flash('A note is required.');
		if (!(bulkCredits > 0)) return flash('Grant must be positive.');
		let failed = 0;
		for (const id of selectedIds) {
			const err = await postCredits({ userId: id, op: 'grant', credits: bulkCredits, note: bulkNote });
			if (err) failed++;
		}
		flash(failed ? `${selectedIds.length - failed} granted, ${failed} failed` : `Granted ${bulkCredits.toLocaleString()} to ${selectedIds.length} account(s)`);
		selectedIds = [];
		await loadPlatform();
	}

	function toggleSelect(id: string) {
		selectedIds = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
	}

	async function openLedger(u: PlatformUser) {
		ledgerFor = { userId: u.id, email: u.email ?? u.id };
		ledgerLoading = true;
		ledgerRows = [];
		try {
			const res = await fetch(`/api/admin/credits?userId=${encodeURIComponent(u.id)}`);
			const body = await res.json();
			if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
			ledgerRows = body.ledger;
		} catch (e) {
			flash(`Ledger failed: ${(e as Error).message}`);
		} finally {
			ledgerLoading = false;
		}
	}

	$effect(() => {
		if (tab === 'platform' && data.isPlatformAdmin && !platformLoaded && !platformLoading) loadPlatform();
	});
</script>

<svelte:head><title>Admin Console — PersonaGen</title></svelte:head>

<div class="admin-page">
	<header class="admin-head">
		<h1>Admin Console</h1>
		<p>
			Oversight for {data.workspaces.map((w: any) => w.name).join(', ')} — who's in the workspace,
			what they're doing, and what it costs. Managing seats and limits lives in
			<a href="/settings?section=team">Settings → Team</a>.
		</p>
	</header>

	<div class="stat-row">
		<div class="stat"><span class="stat-n">{money(data.stats.spendMonth)}</span><span class="stat-l">Spend this month</span></div>
		<div class="stat"><span class="stat-n">{data.stats.generationsMonth}</span><span class="stat-l">Generations this month</span></div>
		<div class="stat"><span class="stat-n">{data.stats.publishedTotal}</span><span class="stat-l">Posts published</span></div>
		<div class="stat"><span class="stat-n">{data.stats.seatCount}</span><span class="stat-l">Seats</span></div>
		<div class="stat"><span class="stat-n">{data.stats.personaCount}</span><span class="stat-l">Personas</span></div>
	</div>

	<div class="admin-tabs" role="tablist">
		{#each [['overview', 'Overview'], ['activity', 'Activity Log'], ['seats', 'Seats'], ['spend', 'Spend'], ['access', 'Access & Keys']] as [k, label] (k)}
			<button role="tab" class="admin-tab" class:active={tab === k} onclick={() => (tab = k as any)}>{label}</button>
		{/each}
		{#if data.isPlatformAdmin}
			<button role="tab" class="admin-tab platform-tab" class:active={tab === 'platform'} onclick={() => (tab = 'platform')}>Platform · Credits</button>
		{/if}
	</div>

	{#if toast}<div class="admin-toast" role="status">{toast}</div>{/if}

	{#if tab === 'overview'}
		<section class="admin-card">
			<h2>Workspaces</h2>
			<table class="admin-table">
				<thead><tr><th>Workspace</th><th>Your role</th><th>Created</th></tr></thead>
				<tbody>
					{#each data.workspaces as w (w.id)}
						<tr><td>{w.name}</td><td><span class="role-pill">{w.myRole}</span></td><td>{when(w.created_at)}</td></tr>
					{/each}
				</tbody>
			</table>
		</section>

		<section class="admin-card">
			<h2>Personas in these workspaces</h2>
			{#if data.personas.length === 0}
				<p class="admin-hint">No personas filed into these workspaces yet.</p>
			{:else}
				<table class="admin-table">
					<thead><tr><th>Persona</th><th>Handle</th><th>Status</th><th>Workspace</th></tr></thead>
					<tbody>
						{#each data.personas as p (p.id)}
							<tr>
								<td>{p.name}</td>
								<td class="mono">{p.handle || '—'}</td>
								<td>{p.status}</td>
								<td>{p.workspaceName}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>

		<section class="admin-card">
			<h2>Recent activity</h2>
			{#if data.activity.length === 0}
				<p class="admin-hint">Nothing logged yet.</p>
			{:else}
				<table class="admin-table">
					<thead><tr><th>When</th><th>Who</th><th>What</th><th>Persona</th></tr></thead>
					<tbody>
						{#each data.activity.slice(0, 10) as a (a.at + a.actor + a.detail)}
							<tr>
								<td class="nowrap">{when(a.at)}</td>
								<td class="mono">{a.actor}</td>
								<td><span class="kind-pill kind-{a.kind}">{a.kind}</span> {a.detail}</td>
								<td>{a.persona}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<button class="admin-link" onclick={() => (tab = 'activity')}>View full log →</button>
			{/if}
		</section>
	{:else if tab === 'platform' && data.isPlatformAdmin}
		<section class="admin-card">
			<div class="platform-head">
				<div>
					<h2>Every account on the platform</h2>
					<p class="admin-hint">
						Wallets, sign-ins, and this month's metered spend across all tenants. 1 credit = 1¢ of
						estimated provider cost. Every grant, set, adjustment and comp is a ledger row with you as
						the actor — nothing here is ever edited or deleted.
					</p>
				</div>
				<div class="platform-mode">
					<span class="mode-pill mode-{platformMode}">CREDITS_ENFORCE = {platformMode}</span>
					<button class="filter-btn" onclick={loadPlatform} disabled={platformLoading}>{platformLoading ? 'Loading…' : 'Refresh'}</button>
				</div>
			</div>
			{#if platformMode === 'off'}
				<p class="admin-warn">Credits are <strong>off</strong>: balances are shown but nothing is debited or blocked. Set <code>CREDITS_ENFORCE=shadow</code> to start recording debits, <code>enforce</code> to block at zero.</p>
			{:else if platformMode === 'shadow'}
				<p class="admin-warn">Shadow mode: debits are recorded, nothing is blocked. Balances may go negative — that is expected until you switch to <code>enforce</code>.</p>
			{/if}

			{#if platformError}
				<p class="admin-error">{platformError}</p>
			{/if}

			<div class="filter-row platform-tools">
				<input class="admin-input" placeholder="Filter by email…" bind:value={platformSearch} />
				<span class="admin-hint">{selectedIds.length} selected</span>
				<input class="admin-input narrow" type="number" min="1" step="100" bind:value={bulkCredits} aria-label="Credits to grant" />
				<input class="admin-input" placeholder="Note (required, e.g. pilot cohort 1)" bind:value={bulkNote} />
				<button class="filter-btn active" onclick={bulkGrant} disabled={selectedIds.length === 0}>Grant to selected</button>
			</div>

			{#if visiblePlatformUsers.length === 0}
				<p class="admin-hint">{platformLoaded ? 'No accounts match.' : 'Loading accounts…'}</p>
			{:else}
				<div class="table-scroll">
					<table class="admin-table">
						<thead>
							<tr>
								<th></th>
								<th>Account</th>
								<th>Created</th>
								<th>Last sign-in</th>
								<th>Balance</th>
								<th>Mode</th>
								<th>Debited (mo)</th>
								<th>Waived (mo)</th>
								<th>Est. spend (mo)</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each visiblePlatformUsers as u (u.id)}
								<tr class:negative={u.balance_credits < 0}>
									<td><input type="checkbox" checked={selectedIds.includes(u.id)} onchange={() => toggleSelect(u.id)} aria-label={`Select ${u.email ?? u.id}`} /></td>
									<td class="mono">{u.email ?? u.id.slice(0, 8) + '…'}</td>
									<td class="nowrap">{when(u.created_at).split(',')[0]}</td>
									<td class="nowrap">
										{#if u.never_signed_in}<span class="kind-pill kind-never">never</span>{:else}{when(u.last_sign_in_at ?? '')}{/if}
									</td>
									<td class="nowrap balance">{fmtCredits(u.balance_credits)} <span class="muted">({usdOfCredits(u.balance_credits)})</span></td>
									<td><span class="role-pill mode-{u.billing_mode}">{u.billing_mode}</span></td>
									<td class="nowrap">{fmtCredits(u.month_debited_credits)}</td>
									<td class="nowrap">{u.month_waived_credits ? fmtCredits(u.month_waived_credits) : '—'}</td>
									<td class="nowrap">{money(u.month_est_usd)} <span class="muted">· {u.month_events} ev</span></td>
									<td class="nowrap actions">
										<button class="admin-link" onclick={() => openAction(u, 'grant')}>Grant</button>
										<button class="admin-link" onclick={() => openAction(u, 'set')}>Set</button>
										<button class="admin-link" onclick={() => openAction(u, 'adjust')}>Adjust</button>
										<button class="admin-link" onclick={() => toggleMode(u)}>{u.billing_mode === 'unmetered' ? 'Un-comp' : 'Comp'}</button>
										<button class="admin-link" onclick={() => openLedger(u)}>Ledger</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#if action}
				<div class="action-panel">
					<strong>{action.op}</strong> — {action.email}
					<input class="admin-input narrow" type="number" step="1" bind:value={actionCredits} aria-label="Credits" />
					<span class="admin-hint">
						{#if action.op === 'grant'}adds credits{:else if action.op === 'set'}sets the balance to exactly this{:else}signed delta (negative reverses a mistake){/if}
					</span>
					<input class="admin-input" placeholder="Note (required)" bind:value={actionNote} />
					<button class="filter-btn active" onclick={submitAction} disabled={actionBusy || !actionNote.trim()}>{actionBusy ? 'Saving…' : 'Apply'}</button>
					<button class="filter-btn" onclick={() => (action = null)}>Cancel</button>
				</div>
			{/if}
		</section>

		{#if ledgerFor}
			<section class="admin-card">
				<div class="platform-head">
					<h2>Ledger — {ledgerFor.email}</h2>
					<button class="filter-btn" onclick={() => (ledgerFor = null)}>Close</button>
				</div>
				{#if ledgerLoading}
					<p class="admin-hint">Loading…</p>
				{:else if ledgerRows.length === 0}
					<p class="admin-hint">No ledger rows yet.</p>
				{:else}
					<div class="table-scroll">
						<table class="admin-table">
							<thead><tr><th>When</th><th>Kind</th><th>Δ</th><th>Waived</th><th>Balance after</th><th>Note</th><th>Links</th></tr></thead>
							<tbody>
								{#each ledgerRows as r (r.id)}
									<tr>
										<td class="nowrap">{when(r.created_at)}</td>
										<td><span class="kind-pill kind-{r.kind}">{r.kind}</span></td>
										<td class="nowrap" class:pos={r.delta > 0} class:neg={r.delta < 0}>{r.delta > 0 ? '+' : ''}{Number(r.delta).toLocaleString()}</td>
										<td class="nowrap">{r.waived_credits ? Number(r.waived_credits).toLocaleString() : '—'}</td>
										<td class="nowrap">{Number(r.balance_after).toLocaleString()}</td>
										<td>{r.note ?? ''}</td>
										<td class="mono small">
											{#if r.generation_event_id}ev {r.generation_event_id.slice(0, 8)}{/if}
											{#if r.post_id} · post {r.post_id.slice(0, 8)}{/if}
											{#if r.stripe_event_id} · {r.stripe_event_id}{/if}
											{#if r.actor_user_id} · by {r.actor_user_id.slice(0, 8)}{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>
		{/if}
	{:else if tab === 'activity'}
		<section class="admin-card">
			<h2>Activity log</h2>
			<p class="admin-hint">
				Every generation, approval decision, and publish across these workspaces — newest first,
				with the seat that did it.
			</p>
			<div class="filter-row">
				{#each [['all', 'All'], ['generation', 'Generations'], ['review', 'Approvals'], ['publish', 'Publishes']] as [k, label] (k)}
					<button class="filter-btn" class:active={activityFilter === k} onclick={() => (activityFilter = k as any)}>{label}</button>
				{/each}
			</div>
			{#if filteredActivity.length === 0}
				<p class="admin-hint">Nothing matches this filter.</p>
			{:else}
				<table class="admin-table">
					<thead><tr><th>When</th><th>Who</th><th>Type</th><th>Detail</th><th>Persona</th><th>Cost</th></tr></thead>
					<tbody>
						{#each filteredActivity as a (a.at + a.actor + a.detail)}
							<tr>
								<td class="nowrap">{when(a.at)}</td>
								<td class="mono">{a.actor}</td>
								<td><span class="kind-pill kind-{a.kind}">{a.kind}</span></td>
								<td>{a.detail}</td>
								<td>{a.persona}</td>
								<td class="nowrap">{a.cost > 0 ? money(a.cost) : '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>
	{:else if tab === 'seats'}
		<section class="admin-card">
			<h2>Seats</h2>
			<p class="admin-hint">
				Roles and spend caps are edited in <a href="/settings?section=team">Settings → Team</a>.
			</p>
			<table class="admin-table">
				<thead><tr><th>Member</th><th>Role</th><th>Monthly cap</th><th>Workspace</th><th>Joined</th></tr></thead>
				<tbody>
					{#each data.seats as s (s.workspace_id + s.user_id)}
						<tr>
							<td class="mono">{s.email ?? `${s.user_id.slice(0, 8)}…`}</td>
							<td><span class="role-pill">{s.role}</span></td>
							<td>{s.spend_limit_usd == null ? 'unlimited' : money(s.spend_limit_usd) + '/mo'}</td>
							<td>{s.workspaceName}</td>
							<td class="nowrap">{when(s.created_at)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		{#if data.pendingInvites.length > 0}
			<section class="admin-card">
				<h2>Pending invites</h2>
				<table class="admin-table">
					<thead><tr><th>Email</th><th>Role</th><th>Sent</th><th>Expires</th></tr></thead>
					<tbody>
						{#each data.pendingInvites as i (i.email + i.created_at)}
							<tr>
								<td class="mono">{i.email}</td>
								<td><span class="role-pill">{i.role}</span></td>
								<td class="nowrap">{when(i.created_at)}</td>
								<td class="nowrap">{when(i.expires_at)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/if}
	{:else if tab === 'spend'}
		<section class="admin-card">
			<h2>Spend this month — by seat</h2>
			{#if data.spendByActor.length === 0}
				<p class="admin-hint">No spend recorded this month.</p>
			{:else}
				<table class="admin-table">
					<thead><tr><th>Seat</th><th>Spend</th></tr></thead>
					<tbody>
						{#each data.spendByActor as row (row.actor)}
							<tr><td class="mono">{row.actor}</td><td>{money(row.usd)}</td></tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>
		<section class="admin-card">
			<h2>Spend this month — by persona</h2>
			{#if data.spendByPersona.length === 0}
				<p class="admin-hint">No spend recorded this month.</p>
			{:else}
				<table class="admin-table">
					<thead><tr><th>Persona</th><th>Spend</th></tr></thead>
					<tbody>
						{#each data.spendByPersona as row (row.persona)}
							<tr><td>{row.persona}</td><td>{money(row.usd)}</td></tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>
	{:else}
		<section class="admin-card">
			<h2>API keys issued by this team</h2>
			<p class="admin-hint">
				Machine access to the platform. A key carries its seat's exact permissions — revoke from
				<a href="/developer">Developer API</a>.
			</p>
			{#if data.apiKeys.length === 0}
				<p class="admin-hint">No API keys issued.</p>
			{:else}
				<table class="admin-table">
					<thead><tr><th>Label</th><th>Owner</th><th>Key</th><th>Last used</th><th>Status</th></tr></thead>
					<tbody>
						{#each data.apiKeys as k (k.id)}
							<tr class:muted={!!k.revoked_at}>
								<td>{k.label}</td>
								<td class="mono">{k.email}</td>
								<td class="mono">{k.key_prefix}…</td>
								<td class="nowrap">{k.last_used_at ? when(k.last_used_at) : 'never'}</td>
								<td>{k.revoked_at ? 'revoked' : 'active'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</section>
	{/if}
</div>

<style>
	.admin-page {
		max-width: 1100px;
		margin: 0 auto;
		padding: var(--space-6);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.admin-head h1 { font-size: 1.6rem; color: var(--text); }
	.admin-head p { color: var(--text-muted); font-size: 0.95rem; margin-top: 0.35rem; line-height: 1.5; }
	.admin-head a, .admin-hint a { color: var(--accent-text); font-weight: 600; }
	.stat-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 0.75rem;
	}
	.stat {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 0.9rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.stat-n { font-size: 1.35rem; font-weight: 700; color: var(--text); }
	.stat-l { font-size: 0.78rem; color: var(--text-muted); }
	.admin-tabs { display: flex; gap: 0.4rem; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
	.admin-tab {
		background: none; border: none; padding: 0.6rem 1rem;
		font-size: 0.95rem; font-weight: 600; color: var(--text-muted);
		cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
	}
	.admin-tab.active { color: var(--accent-text); border-bottom-color: var(--accent); }
	.admin-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 1.25rem 1.4rem;
		display: flex; flex-direction: column; gap: 0.75rem;
	}
	.admin-card h2 { font-size: 1.05rem; color: var(--text); }
	.admin-hint { font-size: 0.88rem; color: var(--text-muted); line-height: 1.5; }
	.admin-table { width: 100%; border-collapse: collapse; font-size: 0.86rem; display: block; overflow-x: auto; }
	.admin-table thead, .admin-table tbody { width: 100%; }
	.admin-table th {
		text-align: left; color: var(--text-muted); font-weight: 600;
		padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--border); white-space: nowrap;
	}
	.admin-table td { padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--border); color: var(--text); }
	.admin-table tr.muted { opacity: 0.55; }
	.mono { font-family: var(--font-mono, monospace); font-size: 0.82rem; }
	.nowrap { white-space: nowrap; }
	.role-pill, .kind-pill {
		font-size: 0.72rem; font-weight: 600; padding: 0.1rem 0.5rem;
		border-radius: 999px; background: var(--surface-2); color: var(--text-muted);
		text-transform: capitalize; white-space: nowrap;
	}
	.kind-generation { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent-text); }
	.kind-review { background: color-mix(in srgb, var(--gold, #d97706) 20%, transparent); }
	.kind-publish { background: color-mix(in srgb, #16a34a 18%, transparent); color: #16a34a; }
	.filter-row { display: flex; gap: 0.4rem; flex-wrap: wrap; }
	.filter-btn {
		background: var(--surface-2); border: 1px solid var(--border);
		border-radius: 999px; padding: 0.3rem 0.8rem; font-size: 0.82rem;
		font-weight: 600; color: var(--text-muted); cursor: pointer;
	}
	.filter-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
	.admin-link {
		align-self: flex-start; background: none; border: none;
		color: var(--accent-text); font-weight: 600; font-size: 0.85rem; cursor: pointer; padding: 0;
	}
	/* ── Platform · Credits tab ─────────────────────────────────────────── */
	.platform-tab {
		margin-left: auto;
	}
	.platform-head {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: flex-start;
		flex-wrap: wrap;
	}
	.platform-mode {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.mode-pill {
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.12);
	}
	.mode-off {
		opacity: 0.7;
	}
	.mode-shadow {
		background: rgba(245, 158, 11, 0.15);
		border-color: rgba(245, 158, 11, 0.4);
	}
	.mode-enforce {
		background: rgba(34, 197, 94, 0.15);
		border-color: rgba(34, 197, 94, 0.4);
	}
	.mode-unmetered {
		background: rgba(99, 102, 241, 0.18);
	}
	.admin-warn,
	.admin-error {
		font-size: 0.85rem;
		padding: 0.6rem 0.8rem;
		border-radius: 8px;
		margin: 0.5rem 0 0.75rem;
	}
	.admin-warn {
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.3);
	}
	.admin-error {
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.35);
	}
	.admin-warn code {
		font-family: ui-monospace, monospace;
	}
	.platform-tools {
		align-items: center;
		flex-wrap: wrap;
	}
	.admin-input {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: inherit;
		border-radius: 8px;
		padding: 0.4rem 0.6rem;
		font-size: 0.85rem;
		min-width: 12rem;
	}
	.admin-input.narrow {
		min-width: 7rem;
		width: 7rem;
	}
	.table-scroll {
		overflow-x: auto;
	}
	.admin-table tr.negative .balance {
		color: #f87171;
	}
	.muted {
		opacity: 0.6;
		font-size: 0.8em;
	}
	.small {
		font-size: 0.75rem;
	}
	.actions .admin-link {
		margin-right: 0.5rem;
	}
	.kind-never {
		background: rgba(239, 68, 68, 0.18);
	}
	.pos {
		color: #4ade80;
	}
	.neg {
		color: #f87171;
	}
	.action-panel {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
		margin-top: 0.9rem;
		padding: 0.75rem;
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.1);
	}
	.admin-toast {
		position: fixed;
		right: 1.25rem;
		bottom: 1.25rem;
		z-index: 50;
		padding: 0.6rem 0.9rem;
		border-radius: 10px;
		background: #111827;
		border: 1px solid rgba(255, 255, 255, 0.15);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
		font-size: 0.85rem;
	}
</style>
