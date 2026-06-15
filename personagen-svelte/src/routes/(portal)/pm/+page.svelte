<script lang="ts">
	import { showToast } from '$lib/stores/ui.svelte';
	import type { Agent, PMTicket } from '$lib/types';

	interface PageData {
		agents: Agent[];
		tickets: PMTicket[];
	}

	let { data } = $props<{ data: PageData }>();

	type ColumnKey = 'backlog' | 'in_progress' | 'review' | 'done';
	type Priority = 'low' | 'medium' | 'high' | 'urgent';

	const COLUMNS: { key: ColumnKey; label: string }[] = [
		{ key: 'backlog', label: 'Backlog' },
		{ key: 'in_progress', label: 'In Progress' },
		{ key: 'review', label: 'Review' },
		{ key: 'done', label: 'Done' }
	];

	const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];

	const PRIORITY_COLORS: Record<Priority, string> = {
		low: 'var(--info)',
		medium: 'var(--warning)',
		high: '#f97316',
		urgent: 'var(--error)'
	};

	const PRIORITY_BG: Record<Priority, string> = {
		low: 'var(--info-soft)',
		medium: 'var(--warning-soft)',
		high: 'rgba(249,115,22,0.12)',
		urgent: 'var(--error-soft)'
	};

	// Initialize state with live database tickets
	let tickets = $state<PMTicket[]>(data.tickets || []);

	// Filters
	let filterPriority = $state<Priority | 'all'>('all');
	let filterAgent = $state<string>('all');

	// Inline add form
	let showAddForm = $state(false);
	let newTitle = $state('');
	let newDescription = $state('');
	let newPriority = $state<Priority>('medium');
	let newAssignee = $state('');

	// Expanded card
	let expandedId = $state<string | null>(null);
	let editingTitle = $state('');
	let editingDescription = $state('');
	let editingPriority = $state<Priority>('medium');
	let editingAssignee = $state('');

	let filteredTickets = $derived(
		tickets.filter((t) => {
			if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
			if (filterAgent !== 'all' && t.assignee_agent_id !== filterAgent) return false;
			return true;
		})
	);

	function ticketsForColumn(col: ColumnKey) {
		return filteredTickets.filter((t) => t.status === col).sort((a, b) => a.position - b.position);
	}

	function getAgent(id?: string) {
		return data.agents.find((a: Agent) => a.id === id);
	}

	async function postAction(action: string, formData: FormData) {
		const res = await fetch(`?/${action}`, {
			method: 'POST',
			body: formData
		});
		if (!res.ok) throw new Error('Server connection error');
		const json = await res.json();
		if (json.type === 'error' || json.type === 'failure') {
			throw new Error(json.data?.error || 'Operation failed');
		}
		let resultData: any = {};
		if (json.data) {
			const parsed = JSON.parse(json.data);
			resultData = Array.isArray(parsed) ? parsed[0] : parsed;
		}
		if (resultData && resultData.success === false) {
			throw new Error(resultData.error || 'Server rejected request');
		}
		return resultData;
	}

	async function moveTicket(ticketId: string, newStatus: ColumnKey) {
		const oldTickets = [...tickets];
		tickets = tickets.map((t) => (t.id === ticketId ? { ...t, status: newStatus } : t));
		showToast(`Moved to ${COLUMNS.find((c) => c.key === newStatus)?.label}`, 'success');

		const formData = new FormData();
		formData.append('id', ticketId);
		formData.append('status', newStatus);

		try {
			await postAction('move', formData);
		} catch (err) {
			tickets = oldTickets;
			showToast('Failed to save ticket move: ' + (err as Error).message, 'error');
		}
	}

	async function addTicket() {
		if (!newTitle.trim()) return;

		const formData = new FormData();
		formData.append('title', newTitle.trim());
		formData.append('description', newDescription.trim());
		formData.append('priority', newPriority);
		formData.append('assignee_agent_id', newAssignee);

		const tempId = `temp-${Date.now()}`;
		const tempTicket: PMTicket = {
			id: tempId,
			tenant_id: '',
			title: newTitle.trim(),
			description: newDescription.trim(),
			status: 'backlog',
			priority: newPriority,
			assignee_agent_id: newAssignee || undefined,
			due_date: undefined,
			position: tickets.filter((t) => t.status === 'backlog').length
		};

		tickets = [tempTicket, ...tickets];

		newTitle = '';
		newDescription = '';
		newPriority = 'medium';
		newAssignee = '';
		showAddForm = false;

		try {
			const res = await postAction('create', formData);
			if (res && res.ticket) {
				tickets = tickets.map((t) => (t.id === tempId ? res.ticket : t));
				showToast('Ticket created', 'success');
			}
		} catch (err) {
			tickets = tickets.filter((t) => t.id !== tempId);
			showToast('Failed to create ticket: ' + (err as Error).message, 'error');
		}
	}

	function expandCard(ticket: PMTicket) {
		if (expandedId === ticket.id) {
			expandedId = null;
			return;
		}
		expandedId = ticket.id;
		editingTitle = ticket.title;
		editingDescription = ticket.description;
		editingPriority = ticket.priority;
		editingAssignee = ticket.assignee_agent_id || '';
	}

	async function saveEdits(ticketId: string) {
		const oldTicket = tickets.find((t) => t.id === ticketId);
		if (!oldTicket) return;

		const formData = new FormData();
		formData.append('id', ticketId);
		formData.append('title', editingTitle);
		formData.append('description', editingDescription);
		formData.append('priority', editingPriority);
		formData.append('assignee_agent_id', editingAssignee);

		tickets = tickets.map((t) =>
			t.id === ticketId
				? {
						...t,
						title: editingTitle,
						description: editingDescription,
						priority: editingPriority,
						assignee_agent_id: editingAssignee || undefined
					}
				: t
		);
		expandedId = null;

		try {
			const res = await postAction('update', formData);
			if (res && res.ticket) {
				tickets = tickets.map((t) => (t.id === ticketId ? res.ticket : t));
				showToast('Ticket updated', 'success');
			}
		} catch (err) {
			tickets = tickets.map((t) => (t.id === ticketId ? oldTicket : t));
			showToast('Failed to update ticket: ' + (err as Error).message, 'error');
		}
	}

	async function deleteTicket(ticketId: string) {
		if (!confirm('Are you sure you want to delete this ticket?')) return;

		const oldTicket = tickets.find((t) => t.id === ticketId);
		if (!oldTicket) return;

		const formData = new FormData();
		formData.append('id', ticketId);

		tickets = tickets.filter((t) => t.id !== ticketId);
		expandedId = null;

		try {
			await postAction('delete', formData);
			showToast('Ticket deleted', 'info');
		} catch (err) {
			if (oldTicket) {
				tickets = [...tickets, oldTicket];
			}
			showToast('Failed to delete ticket: ' + (err as Error).message, 'error');
		}
	}

	function formatDate(d?: string) {
		if (!d) return '';
		return new Date(d).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
	}

	function isOverdue(d?: string) {
		if (!d) return false;
		return new Date(d) < new Date();
	}
</script>

<svelte:head>
	<title>Project Manager — PersonaGen</title>
</svelte:head>

<section class="page">
	<header class="page-header">
		<div class="header-top">
			<div>
				<h1>Project Manager</h1>
				<p class="subtitle">Track tasks, assign agents, and ship faster.</p>
			</div>
			<button class="btn-add" onclick={() => (showAddForm = !showAddForm)}>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg
				>
				Add Ticket
			</button>
		</div>

		<!-- Filter Bar -->
		<div class="filter-bar">
			<div class="filter-group">
				<label class="filter-label">Priority</label>
				<select bind:value={filterPriority}>
					<option value="all">All Priorities</option>
					{#each PRIORITIES as p}
						<option value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
					{/each}
				</select>
			</div>
			<div class="filter-group">
				<label class="filter-label">Agent</label>
				<select bind:value={filterAgent}>
					<option value="all">All Agents</option>
					{#each data.agents as agent}
						<option value={agent.id}>{agent.name}</option>
					{/each}
				</select>
			</div>
			{#if filterPriority !== 'all' || filterAgent !== 'all'}
				<button
					class="clear-filters"
					onclick={() => {
						filterPriority = 'all';
						filterAgent = 'all';
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
						><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
					>
					Clear
				</button>
			{/if}
		</div>
	</header>

	<!-- Add Ticket Form -->
	{#if showAddForm}
		<div class="add-form">
			<div class="add-form-inner">
				<h4>New Ticket</h4>
				<div class="form-row">
					<div class="form-field grow">
						<label>Title</label>
						<input type="text" bind:value={newTitle} placeholder="What needs to be done?" />
					</div>
					<div class="form-field">
						<label>Priority</label>
						<select bind:value={newPriority}>
							{#each PRIORITIES as p}
								<option value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
							{/each}
						</select>
					</div>
					<div class="form-field">
						<label>Assign Agent</label>
						<select bind:value={newAssignee}>
							<option value="">Unassigned</option>
							{#each data.agents as agent}
								<option value={agent.id}>{agent.name}</option>
							{/each}
						</select>
					</div>
				</div>
				<div class="form-field">
					<label>Description</label>
					<textarea
						bind:value={newDescription}
						placeholder="Describe the task in detail..."
						rows="3"
					></textarea>
				</div>
				<div class="form-actions">
					<button class="btn-cancel" onclick={() => (showAddForm = false)}>Cancel</button>
					<button class="btn-submit" onclick={addTicket} disabled={!newTitle.trim()}>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg
						>
						Create Ticket
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Kanban Board -->
	<div class="kanban">
		{#each COLUMNS as col}
			{@const colTickets = ticketsForColumn(col.key)}
			<div class="column">
				<div class="column-header">
					<div
						class="column-accent"
						style="background: {col.key === 'done'
							? 'var(--success)'
							: col.key === 'review'
								? 'var(--gold)'
								: col.key === 'in_progress'
									? 'var(--cyan)'
									: 'var(--accent)'}"
					></div>
					<div class="column-title-row">
						<span class="column-title">{col.label}</span>
						<span class="column-count">{colTickets.length}</span>
					</div>
				</div>
				<div class="column-body">
					{#each colTickets as ticket (ticket.id)}
						<div class="ticket-card" class:expanded={expandedId === ticket.id}>
							<!-- Card Header (always visible) -->
							<button class="ticket-header" onclick={() => expandCard(ticket)}>
								<div class="ticket-top">
									<span
										class="priority-badge"
										style="color: {PRIORITY_COLORS[ticket.priority]}; background: {PRIORITY_BG[
											ticket.priority
										]}"
									>
										{ticket.priority}
									</span>
									{#if ticket.due_date}
										<span
											class="due-date"
											class:overdue={isOverdue(ticket.due_date) && ticket.status !== 'done'}
										>
											<svg
												width="12"
												height="12"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												><rect x="3" y="4" width="18" height="18" rx="2" /><line
													x1="16"
													y1="2"
													x2="16"
													y2="6"
												/><line x1="8" y1="2" x2="8" y2="6" /><line
													x1="3"
													y1="10"
													x2="21"
													y2="10"
												/></svg
											>
											{formatDate(ticket.due_date)}
										</span>
									{/if}
								</div>
								<h5 class="ticket-title">{ticket.title}</h5>
								{#if expandedId !== ticket.id}
									<p class="ticket-desc-preview">
										{ticket.description.slice(0, 80)}{ticket.description.length > 80 ? '…' : ''}
									</p>
								{/if}
								<div class="ticket-footer">
									{#if ticket.assignee_agent_id}
										{@const agent = getAgent(ticket.assignee_agent_id)}
										{#if agent}
											<div class="agent-chip">
												<span class="agent-avatar" style="background: {agent.gradient}"
													>{agent.initial}</span
												>
												<span class="agent-name">{agent.name}</span>
											</div>
										{/if}
									{:else}
										<span class="unassigned">Unassigned</span>
									{/if}
								</div>
							</button>

							<!-- Expanded Detail -->
							{#if expandedId === ticket.id}
								<div class="ticket-detail">
									<div class="detail-field">
										<label>Title</label>
										<input type="text" bind:value={editingTitle} />
									</div>
									<div class="detail-field">
										<label>Description</label>
										<textarea bind:value={editingDescription} rows="4"></textarea>
									</div>
									<div class="detail-row">
										<div class="detail-field">
											<label>Priority</label>
											<select bind:value={editingPriority}>
												{#each PRIORITIES as p}
													<option value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
												{/each}
											</select>
										</div>
										<div class="detail-field">
											<label>Assignee</label>
											<select bind:value={editingAssignee}>
												<option value="">Unassigned</option>
												{#each data.agents as agent}
													<option value={agent.id}>{agent.name}</option>
												{/each}
											</select>
										</div>
									</div>

									<!-- Move To -->
									<div class="detail-field">
										<label>Move to</label>
										<div class="move-buttons">
											{#each COLUMNS.filter((c) => c.key !== ticket.status) as target}
												<button class="move-btn" onclick={() => moveTicket(ticket.id, target.key)}>
													<svg
														width="12"
														height="12"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														><line x1="5" y1="12" x2="19" y2="12" /><polyline
															points="12 5 19 12 12 19"
														/></svg
													>
													{target.label}
												</button>
											{/each}
										</div>
									</div>

									<div class="detail-actions">
										<button class="btn-delete" onclick={() => deleteTicket(ticket.id)}>
											<svg
												width="14"
												height="14"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												><polyline points="3 6 5 6 21 6" /><path
													d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
												/></svg
											>
											Delete
										</button>
										<div class="detail-save-group">
											<button class="btn-cancel-sm" onclick={() => (expandedId = null)}
												>Cancel</button
											>
											<button class="btn-save" onclick={() => saveEdits(ticket.id)}>Save</button>
										</div>
									</div>
								</div>
							{/if}
						</div>
					{/each}

					{#if colTickets.length === 0}
						<div class="empty-col">
							<svg
								width="24"
								height="24"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								opacity="0.3"
								><rect x="3" y="3" width="18" height="18" rx="2" /><line
									x1="9"
									y1="9"
									x2="15"
									y2="15"
								/><line x1="15" y1="9" x2="9" y2="15" /></svg
							>
							<span>No tickets</span>
						</div>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</section>

<style>
	.page {
		padding: 1.5rem;
		max-width: 1600px;
		margin: 0 auto;
	}

	.page-header {
		margin-bottom: 1.5rem;
	}
	.header-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.page-header h1 {
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

	.btn-add {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 22px;
		border-radius: var(--radius-sm);
		background: var(--gradient-subtle);
		color: #fff;
		border: none;
		cursor: pointer;
		font-weight: 600;
		font-size: 0.85rem;
		font-family: var(--font-body);
		white-space: nowrap;
		transition:
			transform 0.2s ease,
			box-shadow 0.3s ease;
	}
	.btn-add:hover {
		transform: translateY(-2px);
		box-shadow: var(--shadow-accent);
	}

	/* Filters */
	.filter-bar {
		display: flex;
		gap: 1rem;
		align-items: flex-end;
		margin-top: 1.25rem;
		flex-wrap: wrap;
	}
	.filter-group {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.filter-label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		color: var(--text-dim);
		font-weight: 700;
		margin-bottom: 0.35rem;
	}
	.filter-group select {
		width: 180px;
		padding: 8px 12px;
		font-size: 0.82rem;
	}

	.clear-filters {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: var(--radius-xs);
		background: var(--error-soft);
		border: 1px solid rgba(239, 68, 68, 0.2);
		color: var(--error);
		font-size: 0.78rem;
		cursor: pointer;
		font-family: var(--font-body);
		font-weight: 600;
		transition: background 0.2s;
	}
	.clear-filters:hover {
		background: rgba(239, 68, 68, 0.2);
	}

	/* Add Form */
	.add-form {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.5rem;
		margin-bottom: 1.5rem;
		animation: fadeDown 0.25s var(--ease-out);
	}
	.add-form-inner h4 {
		margin-bottom: 1rem;
		font-size: var(--text-lg);
	}
	.form-row {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	.form-field {
		display: flex;
		flex-direction: column;
		min-width: 160px;
	}
	.form-field.grow {
		flex: 1;
	}
	.form-field label {
		margin-bottom: 0.35rem;
	}
	.form-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
		margin-top: 1rem;
	}

	.btn-cancel {
		padding: 8px 18px;
		border-radius: var(--radius-xs);
		border: 1px solid var(--border-strong);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 0.82rem;
		font-family: var(--font-body);
		font-weight: 600;
	}
	.btn-cancel:hover {
		border-color: var(--accent-mid);
		color: var(--text);
	}

	.btn-submit {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 18px;
		border-radius: var(--radius-xs);
		background: var(--gradient-subtle);
		border: none;
		color: #fff;
		cursor: pointer;
		font-size: 0.82rem;
		font-family: var(--font-body);
		font-weight: 600;
		transition:
			transform 0.2s,
			box-shadow 0.2s;
	}
	.btn-submit:hover {
		transform: translateY(-1px);
		box-shadow: var(--shadow-accent);
	}
	.btn-submit:disabled {
		opacity: 0.4;
		cursor: not-allowed;
		pointer-events: none;
	}

	/* Kanban */
	.kanban {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
		align-items: flex-start;
	}

	.column {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		min-height: 300px;
	}

	.column-header {
		padding: 0;
	}
	.column-accent {
		height: 3px;
		width: 100%;
	}
	.column-title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1rem 0.75rem;
	}
	.column-title {
		font-weight: 700;
		font-size: var(--text-base);
		color: var(--text);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		font-family: var(--font-body);
	}
	.column-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		height: 22px;
		border-radius: var(--radius-full);
		background: var(--accent-soft);
		color: var(--accent);
		font-size: var(--text-xs);
		font-weight: 700;
		font-family: var(--font-mono);
	}

	.column-body {
		padding: 0 0.75rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* Ticket Card */
	.ticket-card {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		transition:
			border-color 0.2s,
			box-shadow 0.2s;
	}
	.ticket-card:hover {
		border-color: var(--border-hover);
	}
	.ticket-card.expanded {
		border-color: var(--accent-mid);
		box-shadow: var(--shadow-accent);
	}

	.ticket-header {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.85rem;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text);
	}

	.ticket-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.priority-badge {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
		padding: 2px 8px;
		border-radius: var(--radius-full);
		font-family: var(--font-mono);
	}

	.due-date {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-family: var(--font-mono);
	}
	.due-date.overdue {
		color: var(--error);
	}

	.ticket-title {
		font-size: 0.88rem;
		font-weight: 600;
		line-height: 1.3;
		margin-bottom: 0.35rem;
		font-family: var(--font-body);
	}
	.ticket-desc-preview {
		font-size: var(--text-xs);
		color: var(--text-dim);
		line-height: 1.4;
	}

	.ticket-footer {
		margin-top: 0.6rem;
	}

	.agent-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.agent-avatar {
		width: 20px;
		height: 20px;
		border-radius: var(--radius-full);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.55rem;
		font-weight: 700;
		color: #fff;
	}
	.agent-name {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.unassigned {
		font-size: var(--text-xs);
		color: var(--text-dim);
		font-style: italic;
	}

	/* Ticket Detail */
	.ticket-detail {
		padding: 0 0.85rem 0.85rem;
		border-top: 1px solid var(--border);
		animation: fadeDown 0.2s var(--ease-out);
	}

	.detail-field {
		margin-top: 0.75rem;
	}
	.detail-field label {
		margin-bottom: 0.3rem;
	}
	.detail-row {
		display: flex;
		gap: 0.75rem;
	}
	.detail-row .detail-field {
		flex: 1;
	}

	.move-buttons {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.move-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 12px;
		border-radius: var(--radius-xs);
		border: 1px solid var(--border);
		background: var(--surface-3);
		color: var(--text-muted);
		font-size: 0.72rem;
		cursor: pointer;
		font-family: var(--font-body);
		font-weight: 600;
		transition:
			background 0.2s,
			border-color 0.2s,
			color 0.2s;
	}
	.move-btn:hover {
		border-color: var(--accent-mid);
		color: var(--accent);
		background: var(--accent-soft);
	}

	.detail-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
	}
	.detail-save-group {
		display: flex;
		gap: 0.5rem;
	}

	.btn-delete {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 6px 12px;
		border-radius: var(--radius-xs);
		background: var(--error-soft);
		border: 1px solid rgba(239, 68, 68, 0.2);
		color: var(--error);
		font-size: 0.75rem;
		cursor: pointer;
		font-family: var(--font-body);
		font-weight: 600;
	}
	.btn-delete:hover {
		background: rgba(239, 68, 68, 0.2);
	}

	.btn-cancel-sm {
		padding: 6px 14px;
		border-radius: var(--radius-xs);
		border: 1px solid var(--border-strong);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 0.75rem;
		font-family: var(--font-body);
		font-weight: 600;
	}
	.btn-cancel-sm:hover {
		color: var(--text);
		border-color: var(--accent-mid);
	}

	.btn-save {
		padding: 6px 18px;
		border-radius: var(--radius-xs);
		background: var(--gradient-subtle);
		border: none;
		color: #fff;
		cursor: pointer;
		font-size: 0.75rem;
		font-family: var(--font-body);
		font-weight: 600;
		transition:
			transform 0.2s,
			box-shadow 0.2s;
	}
	.btn-save:hover {
		transform: translateY(-1px);
		box-shadow: var(--shadow-accent);
	}

	/* Empty column */
	.empty-col {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 2rem 1rem;
		color: var(--text-dim);
		font-size: var(--text-xs);
	}

	/* Mobile */
	@media (max-width: 1100px) {
		.kanban {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (max-width: 640px) {
		.page {
			padding: 1rem;
		}
		.kanban {
			grid-template-columns: 1fr;
		}
		.form-row {
			flex-direction: column;
		}
		.detail-row {
			flex-direction: column;
		}
		.filter-bar {
			flex-direction: column;
			align-items: stretch;
		}
		.filter-group select {
			width: 100%;
		}
	}
</style>
