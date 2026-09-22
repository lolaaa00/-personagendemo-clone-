<script lang="ts">
	/**
	 * Projects manager — create/rename/delete persona groups and file each
	 * persona into one. Every mutation hits /api/persona-groups immediately and
	 * then invalidateAll() refreshes the sidebar roster, so the rail regroups
	 * live while the modal stays open.
	 */
	import Modal from '$lib/components/ui/Modal.svelte';
	import { invalidateAll } from '$app/navigation';
	import { showToast } from '$lib/stores/ui.svelte';
	import { parseJsonResponse } from '$lib/services/api';

	let {
		open,
		onClose,
		groups,
		personas
	}: {
		open: boolean;
		onClose: () => void;
		/** persona_groups rows: { id, name } */
		groups: Array<{ id: string; name: string }>;
		/** sidebar roster: { id, name, initial, gradient, ugc_character_ref, group_id } */
		personas: any[];
	} = $props();

	let busy = $state(false);

	// ── Create ───────────────────────────────────────────────────────────────
	let newName = $state('');

	async function call(payload: Record<string, unknown>): Promise<any> {
		const res = await fetch('/api/persona-groups', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		const d = await parseJsonResponse<any>(res);
		if (!res.ok || !d.success) throw new Error(d.error || 'Server error');
		return d;
	}

	async function createGroup(e: SubmitEvent) {
		e.preventDefault();
		const name = newName.trim();
		if (!name || busy) return;
		busy = true;
		try {
			await call({ action: 'create', name });
			newName = '';
			await invalidateAll();
			showToast(`Project "${name}" created`, 'success');
		} catch (err) {
			showToast('Could not create project: ' + (err as Error).message, 'error');
		} finally {
			busy = false;
		}
	}

	// ── Rename ───────────────────────────────────────────────────────────────
	let renamingId = $state<string | null>(null);
	let renameValue = $state('');

	function startRename(group: { id: string; name: string }) {
		renamingId = group.id;
		renameValue = group.name;
	}

	async function commitRename(e: SubmitEvent) {
		e.preventDefault();
		const id = renamingId;
		const name = renameValue.trim();
		if (!id || !name || busy) return;
		busy = true;
		try {
			await call({ action: 'rename', id, name });
			renamingId = null;
			await invalidateAll();
		} catch (err) {
			showToast('Could not rename project: ' + (err as Error).message, 'error');
		} finally {
			busy = false;
		}
	}

	// ── Delete (two-tap confirm; personas just become ungrouped) ─────────────
	let confirmingDeleteId = $state<string | null>(null);

	async function deleteGroup(id: string) {
		if (confirmingDeleteId !== id) {
			confirmingDeleteId = id;
			return;
		}
		confirmingDeleteId = null;
		if (busy) return;
		busy = true;
		try {
			await call({ action: 'delete', id });
			await invalidateAll();
			showToast('Project deleted — its personas are now ungrouped', 'success');
		} catch (err) {
			showToast('Could not delete project: ' + (err as Error).message, 'error');
		} finally {
			busy = false;
		}
	}

	// ── Assignment ───────────────────────────────────────────────────────────
	let assigningId = $state<string | null>(null);

	async function assign(personaId: string, groupId: string) {
		assigningId = personaId;
		try {
			await call({ action: 'assign', agent_ids: [personaId], group_id: groupId || null });
			await invalidateAll();
		} catch (err) {
			showToast('Could not move persona: ' + (err as Error).message, 'error');
		} finally {
			assigningId = null;
		}
	}

	function memberCount(groupId: string): number {
		return personas.filter((p) => p.group_id === groupId).length;
	}

	// Reset transient edit state whenever the modal reopens.
	$effect(() => {
		if (!open) {
			renamingId = null;
			confirmingDeleteId = null;
			newName = '';
		}
	});
</script>

<Modal
	{open}
	{onClose}
	title="Projects"
	subtitle="Group personas into named projects — the sidebar organizes around them."
	size="md"
>
	<div class="projects-body">
		<!-- Create -->
		<form class="proj-create" onsubmit={createGroup}>
			<input
				type="text"
				class="proj-input"
				placeholder="New project name…"
				maxlength="60"
				bind:value={newName}
				aria-label="New project name"
			/>
			<button type="submit" class="proj-btn primary" disabled={busy || !newName.trim()}>
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg
				>
				Create
			</button>
		</form>

		<!-- Existing projects -->
		{#if groups.length === 0}
			<p class="proj-empty">
				No projects yet — create one above, then file personas into it below.
			</p>
		{:else}
			<ul class="proj-list">
				{#each groups as group (group.id)}
					<li class="proj-row">
						{#if renamingId === group.id}
							<form class="proj-rename" onsubmit={commitRename}>
								<input
									type="text"
									class="proj-input"
									maxlength="60"
									bind:value={renameValue}
									aria-label="Rename project"
								/>
								<button
									type="submit"
									class="proj-btn primary"
									disabled={busy || !renameValue.trim()}>Save</button
								>
								<button type="button" class="proj-btn" onclick={() => (renamingId = null)}
									>Cancel</button
								>
							</form>
						{:else}
							<span class="proj-icon" aria-hidden="true">
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path
										d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
									/></svg
								>
							</span>
							<span class="proj-name">{group.name}</span>
							<span class="proj-count">{memberCount(group.id)}</span>
							<div class="proj-actions">
								<button
									type="button"
									class="proj-btn"
									onclick={() => startRename(group)}
									aria-label="Rename {group.name}"
								>
									Rename
								</button>
								<button
									type="button"
									class="proj-btn danger"
									class:confirming={confirmingDeleteId === group.id}
									disabled={busy}
									onclick={() => deleteGroup(group.id)}
									aria-label={confirmingDeleteId === group.id
										? `Confirm delete ${group.name}`
										: `Delete ${group.name}`}
								>
									{confirmingDeleteId === group.id ? 'Confirm?' : 'Delete'}
								</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<!-- Assignment -->
		{#if personas.length > 0}
			<h4 class="assign-title">File personas</h4>
			<ul class="assign-list">
				{#each personas as persona (persona.id)}
					<li class="assign-row">
						<span
							class="assign-avatar"
							style={persona.ugc_character_ref
								? ''
								: `background: ${persona.gradient ?? 'var(--gradient)'}`}
						>
							{#if persona.ugc_character_ref}
								<img src={persona.ugc_character_ref} alt="" width="24" height="24" loading="lazy" />
							{:else}
								{persona.initial ?? (persona.name?.[0] ?? '?').toUpperCase()}
							{/if}
						</span>
						<span class="assign-name">{persona.name}</span>
						<select
							class="assign-select"
							value={persona.group_id ?? ''}
							disabled={assigningId === persona.id}
							aria-label="Project for {persona.name}"
							onchange={(e) => assign(persona.id, (e.currentTarget as HTMLSelectElement).value)}
						>
							<option value="">No project</option>
							{#each groups as group (group.id)}
								<option value={group.id}>{group.name}</option>
							{/each}
						</select>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</Modal>

<style>
	.projects-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.proj-create,
	.proj-rename {
		display: flex;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}

	.proj-input {
		flex: 1;
		min-width: 0;
		padding: 8px 12px;
		min-height: 44px;
		border-radius: 9px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-family: inherit;
		/* >=16px so iOS Safari doesn't force-zoom */
		font-size: 1rem;
	}

	.proj-input:focus {
		border-color: var(--accent);
		background: var(--surface);
	}

	.proj-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		min-height: 44px;
		border-radius: 9px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-muted);
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
	}

	.proj-btn:hover:not(:disabled) {
		color: var(--text);
		border-color: var(--border-hover);
	}

	.proj-btn.primary {
		background: var(--accent-soft);
		border-color: color-mix(in srgb, var(--accent) 30%, transparent);
		color: var(--accent-text);
	}

	.proj-btn.primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--accent) 20%, transparent);
		color: var(--accent-text);
	}

	.proj-btn.danger {
		color: var(--error);
	}

	.proj-btn.danger:hover:not(:disabled),
	.proj-btn.danger.confirming {
		background: var(--error-soft);
		border-color: color-mix(in srgb, var(--error) 40%, transparent);
		color: var(--error-text, var(--error));
	}

	.proj-btn:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.proj-empty {
		font-size: 0.82rem;
		color: var(--text-dim);
		margin: 0;
	}

	.proj-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.proj-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 10px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
		min-height: 52px;
	}

	.proj-icon {
		color: var(--text-dim);
		display: inline-flex;
		flex-shrink: 0;
	}

	.proj-name {
		font-size: 0.86rem;
		font-weight: 600;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.proj-count {
		font-size: 0.66rem;
		font-weight: 700;
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-dim);
		flex-shrink: 0;
	}

	.proj-actions {
		margin-left: auto;
		display: inline-flex;
		gap: 6px;
		flex-shrink: 0;
	}

	.assign-title {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
	}

	.assign-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-height: 320px;
		overflow-y: auto;
	}

	.assign-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 2px;
		min-height: 48px;
	}

	.assign-avatar {
		width: 24px;
		height: 24px;
		border-radius: 7px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.6rem;
		font-weight: 800;
		color: #fff;
		flex-shrink: 0;
		overflow: hidden;
	}

	.assign-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.assign-name {
		font-size: 0.84rem;
		font-weight: 600;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
		flex: 1;
	}

	.assign-select {
		padding: 6px 8px;
		min-height: 40px;
		max-width: 45%;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text);
		font-family: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.assign-select:focus-visible {
		border-color: var(--accent);
	}

	.assign-select:disabled {
		opacity: 0.55;
		cursor: default;
	}
</style>
