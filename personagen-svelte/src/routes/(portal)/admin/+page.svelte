<script lang="ts">
	let { data } = $props();

	let tab = $state<'overview' | 'activity' | 'seats' | 'spend' | 'access'>('overview');

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
	</div>

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
</style>
