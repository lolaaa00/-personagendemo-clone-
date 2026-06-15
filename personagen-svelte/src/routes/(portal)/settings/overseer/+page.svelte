<script lang="ts">
	import { enhance } from '$app/forms';
	import { showToast } from '$lib/stores/ui.svelte';

	let { data, form }: { data: any; form: any } = $props();

	// Local reactive state from data
	const hermesAgent = $derived(data.hermesAgent || {});
	const memories = $derived(data.memories || []);
	const managedCreators = $derived(data.managedCreators || []);
	const agentsMissingConfig = $derived(data.agentsMissingConfig || []);

	// Form field states
	let name = $state('');
	let soul = $state('');
	let skills = $state('');
	let tools = $state('');
	let initial = $state('H');
	let gradient = $state('linear-gradient(135deg, #10B981, #06B6D4)');

	// Heartbeat State
	let heartbeatPacing = $state(60); // 60 minutes default

	// Memory Modal / Form inputs
	let newMemoryContent = $state('');
	let newMemoryType = $state('fact');
	let newMemoryImportance = $state(5);

	// Sync local state when page data loads/changes
	$effect(() => {
		if (hermesAgent.id) {
			name = hermesAgent.name || 'Hermes';
			soul = hermesAgent.soul || '';
			skills = hermesAgent.skills || '';
			tools = hermesAgent.tools || '';
			initial = hermesAgent.initial || 'H';
			gradient = hermesAgent.gradient || 'linear-gradient(135deg, #10B981, #06B6D4)';
		}
	});

	// Trigger notifications based on action form feedback
	$effect(() => {
		if (form?.success) {
			showToast('Hermes operational parameters synchronized successfully.', 'success');
		} else if (form?.error) {
			showToast(form.error, 'error');
		}
	});

	// Available capabilities (administrative tools)
	const AVAILABLE_TOOLS = [
		{ id: 'system_log_reader', name: 'Log Monitor', desc: 'Read and scan system process output.' },
		{
			id: 'agent_orchestrator',
			name: 'Agent Coordinator',
			desc: 'Direct, spin up, or spin down other agents.'
		},
		{ id: 'slack_notifier', name: 'Instant Alerts', desc: 'Dispatch Slack and webhook alerts.' },
		{
			id: 'backup_scheduler',
			name: 'Disaster Recovery',
			desc: 'Manage automated database backups.'
		}
	];

	// Handle tools multi-select state
	function isToolSelected(toolId: string) {
		const currentList = tools
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
		return currentList.includes(toolId);
	}

	function toggleTool(toolId: string) {
		let currentList = tools
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
		if (currentList.includes(toolId)) {
			currentList = currentList.filter((id) => id !== toolId);
		} else {
			currentList.push(toolId);
		}
		tools = currentList.join(', ');
	}

	// Preset Gradients for administrative theme
	const ADMIN_GRADIENTS = [
		{ name: 'Emerald Teal (Hermes)', gradient: 'linear-gradient(135deg, #10B981, #06B6D4)' },
		{ name: 'Dark Cyberpunk', gradient: 'linear-gradient(135deg, #0F172A, #1E293B)' },
		{ name: 'Sapphire Aura', gradient: 'linear-gradient(135deg, #2563EB, #1D4ED8)' },
		{ name: 'Crimson Watch', gradient: 'linear-gradient(135deg, #DC2626, #991B1B)' }
	];
</script>

<div class="overseer-container">
	<header class="overseer-header">
		<div class="identity-badge" style="background: {gradient}">
			{initial}
		</div>
		<div class="header-text">
			<h2>{name} <span>Chief Overseer Portal</span></h2>
			<p>
				Configure cognitive overrides, administrative capabilities, and persistent guidelines for
				the Overseer Agent.
			</p>
		</div>
		<div class="pulse-indicator">
			<span class="pulse-dot"></span>
			Active Overseer State
		</div>
	</header>

	<div class="settings-grid">
		<!-- Left: Core Personality & Directive Form -->
		<section class="grid-card main-config-panel">
			<div class="card-header">
				<h3>🧠 Soul Directive & Core Controls</h3>
				<p>
					Establish high-level operational directives. Hermes uses this background context to
					orchestrate subordinate agents.
				</p>
			</div>

			<form method="POST" action="?/updateOverseer" use:enhance class="config-form">
				<!-- Gradient Input -->
				<input type="hidden" name="gradient" value={gradient} />
				<input type="hidden" name="tools" value={tools} />

				<div class="form-row">
					<div class="field-group">
						<label for="name">Overseer Name</label>
						<input
							type="text"
							id="name"
							name="name"
							bind:value={name}
							placeholder="e.g. Hermes"
							required
						/>
					</div>
					<div class="field-group flex-shrink-sm">
						<label for="initial">Initial Badge</label>
						<input
							type="text"
							id="initial"
							name="initial"
							bind:value={initial}
							maxlength="2"
							placeholder="H"
							required
						/>
					</div>
				</div>

				<div class="field-group">
					<label for="soul">Directive Soul (System Instructions)</label>
					<textarea
						id="soul"
						name="soul"
						bind:value={soul}
						rows="4"
						placeholder="Define the primary focus, behavior guidelines, and tone of voice for the overseer agent..."
						required
					></textarea>
				</div>

				<div class="field-group">
					<label for="skills">Administrative Skills</label>
					<input
						type="text"
						id="skills"
						name="skills"
						bind:value={skills}
						placeholder="e.g. system diagnostics, alert dispatch, database backups (comma separated)"
					/>
				</div>

				<div class="field-group">
					<label>Visual Identity Accent</label>
					<div class="gradient-grid">
						{#each ADMIN_GRADIENTS as preset}
							<button
								type="button"
								class="gradient-preset-btn"
								class:active={gradient === preset.gradient}
								style="background: {preset.gradient}"
								onclick={() => (gradient = preset.gradient)}
								title={preset.name}
							></button>
						{/each}
					</div>
				</div>

				<!-- Heartbeat pacing -->
				<div class="field-group">
					<label for="heartbeat">Cognitive Heartbeat Interval</label>
					<div class="heartbeat-control">
						<input
							type="range"
							id="heartbeat"
							min="5"
							max="240"
							step="5"
							bind:value={heartbeatPacing}
						/>
						<span class="heartbeat-value">Every {heartbeatPacing} minutes</span>
					</div>
					<span class="field-caption"
						>Controls how frequently Hermes wakes up autonomously to query system health, review
						logs, and report issues.</span
					>
				</div>

				<div class="field-group">
					<label>Capabilities (Administrative Tools)</label>
					<div class="capabilities-list">
						{#each AVAILABLE_TOOLS as tool}
							<button
								type="button"
								class="capability-item"
								class:selected={isToolSelected(tool.id)}
								onclick={() => toggleTool(tool.id)}
							>
								<div class="checkbox-ring">
									<span class="check-mark">✓</span>
								</div>
								<div class="capability-text">
									<strong>{tool.name}</strong>
									<span>{tool.desc}</span>
								</div>
							</button>
						{/each}
					</div>
				</div>

				<button type="submit" class="btn-primary"> ⚡ Save Core Operational Override </button>
			</form>
		</section>

		<!-- Right: Long-Term Memory (Episodic Guidelines) Manager -->
		<section class="grid-card memory-panel">
			<div class="card-header">
				<h3>💾 Long-Term Administrative Memory</h3>
				<p>
					Manage strict persistent instructions, system facts, and guidelines stored inside Hermes'
					permanent semantic vector memory.
				</p>
			</div>

			<!-- Add memory form -->
			<form
				method="POST"
				action="?/addMemory"
				use:enhance={() => {
					return ({ result }) => {
						if (result.type === 'success') {
							newMemoryContent = '';
							showToast('Persistent guideline registered to vector database.', 'success');
						}
					};
				}}
				class="add-memory-form"
			>
				<div class="field-group">
					<label for="newMemory">Add Persistent Guideline / Memory Block</label>
					<textarea
						id="newMemory"
						name="content"
						bind:value={newMemoryContent}
						rows="2"
						placeholder="Write an operational rule, system constraint, or critical context block..."
						required
					></textarea>
				</div>

				<div class="form-row-three">
					<div class="field-group">
						<label for="memoryType">Type</label>
						<select id="memoryType" name="memory_type" bind:value={newMemoryType}>
							<option value="fact">System Fact</option>
							<option value="instruction">Operational Instruction</option>
							<option value="task">Pre-scheduled Task</option>
						</select>
					</div>
					<div class="field-group">
						<label for="importance">Priority Rank (1-10)</label>
						<select id="importance" name="importance" bind:value={newMemoryImportance}>
							{#each Array.from({ length: 10 }, (_, i) => i + 1) as num}
								<option value={num}>Priority {num}</option>
							{/each}
						</select>
					</div>
					<button type="submit" class="btn-secondary flex-align-end"> 💾 Write Guideline </button>
				</div>
			</form>

			<!-- Active memory list -->
			<div class="active-memories-wrapper">
				<h4>Active Guidelines ({memories.length})</h4>
				{#if memories.length > 0}
					<div class="memory-scroller">
						{#each memories as memory}
							<div class="memory-card">
								<div class="memory-card-header">
									<span
										class="memory-badge"
										class:instruction={memory.memory_type === 'instruction'}
										class:task={memory.memory_type === 'task'}
									>
										{memory.memory_type}
									</span>
									<span class="importance-rating">Priority {memory.importance}/10</span>

									<form
										method="POST"
										action="?/deleteMemory"
										use:enhance={() => {
											return ({ result }) => {
												if (result.type === 'success') {
													showToast('Memory block purged.', 'info');
												}
											};
										}}
									>
										<input type="hidden" name="id" value={memory.id} />
										<button type="submit" class="btn-delete" title="Purge memory guideline">
											<svg
												width="14"
												height="14"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												stroke-linecap="round"
												stroke-linejoin="round"
												><path d="M3 6h18" /><path
													d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
												/><line x1="10" y1="11" x2="10" y2="17" /><line
													x1="14"
													y1="11"
													x2="14"
													y2="17"
												/></svg
											>
										</button>
									</form>
								</div>
								<div class="memory-card-body">
									<p>{memory.content}</p>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="empty-memories">
						<div class="empty-icon">📂</div>
						<h5>No Persistent Memories Registered</h5>
						<p>
							Establish persistent directives above to prevent Hermes from losing critical context
							during system reboots.
						</p>
					</div>
				{/if}
			</div>
		</section>
	</div>

	<!-- Ecosystem Integrity & Monitored Agents Section -->
	<section class="grid-card full-width-panel" style="margin-top: 2rem;">
		<div class="card-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1.25rem;">
			<div>
				<h3 style="display: flex; align-items: center; gap: 0.5rem; margin: 0; font-size: 1.1rem; font-weight: 700; color: var(--text);">🛡️ Ecosystem Integrity & Monitored Creators</h3>
				<p style="margin: 0.25rem 0 0 0; font-size: var(--text-xs); color: var(--text-dim); line-height: 1.4;">Verify that all creator agents are supervised by Hermes and have valid cognitive configurations.</p>
			</div>
			{#if agentsMissingConfig.length === 0}
				<span class="health-pill healthy">✓ All Configured</span>
			{:else}
				<span class="health-pill warning">⚠️ {agentsMissingConfig.length} Missing Configs</span>
			{/if}
		</div>

		<div style="display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 2rem; margin-top: 1.5rem;">
			<!-- Managed Creators Grid -->
			<div>
				<h4 style="font-size: var(--text-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); margin-bottom: 1rem;">Supervised Creators ({managedCreators.length})</h4>
				{#if managedCreators.length > 0}
					<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem;">
						{#each managedCreators as agent}
							<div class="creator-mini-card" style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; padding: 0.75rem 1rem; display: flex; align-items: center; gap: 0.75rem;">
								<div style="width: 28px; height: 28px; border-radius: 50%; background: {agent.gradient}; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: bold; color: white; flex-shrink: 0;">
									{agent.initial}
								</div>
								<div style="min-width: 0; flex: 1;">
									<div style="font-weight: 600; font-size: var(--text-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text);">{agent.name}</div>
									<div style="font-size: 10px; color: var(--text-dim); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{agent.handle}</div>
								</div>
								<span style="font-size: 9px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); color: #10B981; padding: 1px 5px; border-radius: 4px; font-weight: 600;">Monitored</span>
							</div>
						{/each}
					</div>
				{:else}
					<div style="background: rgba(255,255,255,0.01); border: 1px dashed rgba(255,255,255,0.05); border-radius: 8px; padding: 2rem; text-align: center; color: var(--text-dim); font-size: var(--text-sm);">
						No subordinate creator agents currently registered.
					</div>
				{/if}
			</div>

			<!-- Configuration Audits -->
			<div>
				<h4 style="font-size: var(--text-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); margin-bottom: 1rem;">Integrity Diagnostic Log</h4>
				<div style="display: flex; flex-direction: column; gap: 0.75rem;">
					<!-- Hermes Overseer Check -->
					<div class="diagnostic-item" style="display: flex; align-items: flex-start; gap: 0.75rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.03); padding: 0.75rem 1rem; border-radius: 8px;">
						<span style="font-size: var(--text-base); line-height: 1;">🛡️</span>
						<div style="flex: 1;">
							<div style="font-weight: 600; font-size: var(--text-xs); color: var(--text);">Overseer Identity</div>
							<div style="font-size: 10px; color: var(--text-dim); margin-top: 2px;">Hermes is correctly seeded and active with operational overrides.</div>
						</div>
						<span style="font-size: 10px; color: var(--success); font-weight: 700; text-transform: uppercase;">OK</span>
					</div>

					<!-- Config Check -->
					{#if agentsMissingConfig.length === 0}
						<div class="diagnostic-item" style="display: flex; align-items: flex-start; gap: 0.75rem; background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.03); padding: 0.75rem 1rem; border-radius: 8px;">
							<span style="font-size: var(--text-base); line-height: 1;">⚙️</span>
							<div style="flex: 1;">
								<div style="font-weight: 600; font-size: var(--text-xs); color: var(--text);">Cognitive Architectures</div>
								<div style="font-size: 10px; color: var(--text-dim); margin-top: 2px;">All creator agents have database-backed agent_config parameters.</div>
							</div>
							<span style="font-size: 10px; color: var(--success); font-weight: 700; text-transform: uppercase;">OK</span>
						</div>
					{:else}
						<div class="diagnostic-item warning" style="display: flex; align-items: flex-start; gap: 0.75rem; background: rgba(245, 158, 11, 0.03); border: 1px solid rgba(245, 158, 11, 0.15); padding: 0.75rem 1rem; border-radius: 8px;">
							<span style="font-size: var(--text-base); line-height: 1;">⚠️</span>
							<div style="flex: 1;">
								<div style="font-weight: 600; font-size: var(--text-xs); color: #f59e0b;">Cognitive Architectures ({agentsMissingConfig.length} Unconfigured)</div>
								<div style="font-size: 10px; color: var(--text-dim); margin-top: 4px;">
									The following agents are missing configuration profiles and may act with defaults:
									<ul style="margin: 4px 0 0 12px; padding: 0; color: #f87171;">
										{#each agentsMissingConfig as agent}
											<li>{agent.name} ({agent.handle})</li>
										{/each}
									</ul>
								</div>
							</div>
							<span style="font-size: 10px; color: #f59e0b; font-weight: 700; text-transform: uppercase;">Mismatched</span>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</section>
</div>

<style>
	.overseer-container {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		padding: 2rem;
		max-width: 1400px;
		margin: 0 auto;
	}

	.overseer-header {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		background: rgba(255, 255, 255, 0.01);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: var(--radius-md);
		padding: 1.5rem;
		backdrop-filter: blur(8px);
		position: relative;
	}

	.identity-badge {
		width: 56px;
		height: 56px;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.75rem;
		font-weight: 800;
		color: #fff;
		box-shadow: 0 0 20px rgba(16, 185, 129, 0.15);
	}

	.header-text h2 {
		margin: 0 0 0.25rem 0;
		font-size: 1.5rem;
		font-weight: 800;
		color: var(--text);
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.header-text h2 span {
		font-size: 0.75rem;
		background: rgba(16, 185, 129, 0.1);
		border: 1px solid rgba(16, 185, 129, 0.2);
		color: var(--success);
		padding: 3px 8px;
		border-radius: 99px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.header-text p {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-dim);
	}

	.pulse-indicator {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--success);
		background: rgba(16, 185, 129, 0.06);
		padding: 6px 12px;
		border-radius: 99px;
		border: 1px solid rgba(16, 185, 129, 0.1);
	}

	.pulse-dot {
		width: 6px;
		height: 6px;
		background: var(--success);
		border-radius: 50%;
		animation: pulse-emerald 1.5s infinite;
	}

	@keyframes pulse-emerald {
		0%,
		100% {
			transform: scale(1);
			box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
		}
		50% {
			transform: scale(1.2);
			box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
		}
	}

	.settings-grid {
		display: grid;
		grid-template-columns: 1.1fr 1fr;
		gap: 2rem;
		align-items: start;
	}

	.grid-card {
		background: rgba(255, 255, 255, 0.01);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: var(--radius-md);
		padding: 1.75rem;
		backdrop-filter: blur(12px);
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
	}

	.card-header {
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
		padding-bottom: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.card-header h3 {
		margin: 0 0 0.25rem 0;
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text);
	}

	.card-header p {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--text-dim);
		line-height: 1.4;
	}

	.config-form {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.form-row {
		display: flex;
		gap: 1.25rem;
	}

	.form-row-three {
		display: grid;
		grid-template-columns: 1fr 1fr auto;
		gap: 1rem;
		align-items: flex-end;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		flex: 1;
	}

	.flex-shrink-sm {
		flex: 0 0 120px;
	}

	.flex-align-end {
		align-self: flex-end;
		height: 42px;
	}

	label {
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		color: var(--text-dim);
		letter-spacing: 0.05em;
	}

	input[type='text'],
	textarea,
	select {
		width: 100%;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.75rem 1rem;
		color: var(--text);
		font-family: var(--font-body);
		font-size: var(--text-sm);
		outline: none;
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease;
	}

	input[type='text']:focus,
	textarea:focus,
	select:focus {
		border-color: var(--accent-mid);
		box-shadow: 0 0 0 3px rgba(124, 106, 237, 0.08);
	}

	.field-caption {
		font-size: 11px;
		color: var(--text-dim);
		font-style: italic;
	}

	.gradient-grid {
		display: flex;
		gap: 0.75rem;
	}

	.gradient-preset-btn {
		width: 36px;
		height: 36px;
		border-radius: 8px;
		border: 2px solid transparent;
		cursor: pointer;
		transition:
			transform 0.2s ease,
			border-color 0.2s;
	}

	.gradient-preset-btn:hover {
		transform: scale(1.1);
	}

	.gradient-preset-btn.active {
		border-color: #fff;
		transform: scale(1.1);
		box-shadow: 0 0 12px rgba(255, 255, 255, 0.2);
	}

	.heartbeat-control {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		background: rgba(255, 255, 255, 0.01);
		border: 1px solid rgba(255, 255, 255, 0.03);
		padding: 0.5rem 1rem;
		border-radius: 8px;
	}

	.heartbeat-control input[type='range'] {
		flex: 1;
		accent-color: var(--accent-mid);
		cursor: pointer;
	}

	.heartbeat-value {
		font-size: var(--text-xs);
		font-family: var(--font-mono);
		font-weight: 700;
		color: var(--text);
		background: rgba(255, 255, 255, 0.05);
		padding: 4px 8px;
		border-radius: 4px;
	}

	.capabilities-list {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}

	.capability-item {
		background: rgba(255, 255, 255, 0.01);
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		cursor: pointer;
		text-align: left;
		color: var(--text);
		transition: all 0.2s ease;
	}

	.capability-item:hover {
		background: rgba(255, 255, 255, 0.02);
		border-color: rgba(255, 255, 255, 0.08);
	}

	.capability-item.selected {
		background: rgba(124, 106, 237, 0.04);
		border-color: rgba(124, 106, 237, 0.3);
		box-shadow: 0 0 8px rgba(124, 106, 237, 0.02);
	}

	.checkbox-ring {
		width: 16px;
		height: 16px;
		border-radius: 4px;
		border: 1px solid var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		font-weight: 900;
		color: transparent;
		flex-shrink: 0;
		margin-top: 2px;
	}

	.capability-item.selected .checkbox-ring {
		background: var(--accent-mid);
		border-color: var(--accent-mid);
		color: #fff;
	}

	.capability-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.capability-text strong {
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.capability-text span {
		font-size: 10px;
		color: var(--text-dim);
	}

	.btn-primary {
		background: linear-gradient(135deg, var(--accent-mid), var(--accent-light));
		border: none;
		color: #fff;
		font-size: var(--text-xs);
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		padding: 0.85rem 1.5rem;
		border-radius: var(--radius-sm);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		transition:
			transform 0.2s,
			box-shadow 0.2s;
	}

	.btn-primary:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 15px rgba(124, 106, 237, 0.3);
	}

	.btn-secondary {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: var(--text);
		font-size: var(--text-xs);
		font-weight: 600;
		padding: 0.75rem 1.25rem;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-secondary:hover {
		background: rgba(255, 255, 255, 0.08);
		border-color: rgba(255, 255, 255, 0.15);
	}

	.add-memory-form {
		border-bottom: 1px dashed rgba(255, 255, 255, 0.08);
		padding-bottom: 1.5rem;
		margin-bottom: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.active-memories-wrapper h4 {
		margin: 0 0 1rem 0;
		font-size: var(--text-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-dim);
	}

	.memory-scroller {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-height: 500px;
		overflow-y: auto;
		padding-right: 0.5rem;
	}

	.memory-scroller::-webkit-scrollbar {
		width: 4px;
	}

	.memory-scroller::-webkit-scrollbar-track {
		background: rgba(255, 255, 255, 0.01);
	}

	.memory-scroller::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.1);
		border-radius: 2px;
	}

	.memory-card {
		background: rgba(255, 255, 255, 0.01);
		border: 1px solid rgba(255, 255, 255, 0.03);
		border-radius: 8px;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		transition: all 0.2s ease;
	}

	.memory-card:hover {
		background: rgba(255, 255, 255, 0.02);
		border-color: rgba(255, 255, 255, 0.06);
	}

	.memory-card-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.memory-badge {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 2px 6px;
		border-radius: 4px;
		background: rgba(6, 182, 212, 0.1);
		border: 1px solid rgba(6, 182, 212, 0.15);
		color: var(--cyan);
	}

	.memory-badge.instruction {
		background: rgba(124, 106, 237, 0.1);
		border-color: rgba(124, 106, 237, 0.15);
		color: var(--accent-light);
	}

	.memory-badge.task {
		background: rgba(245, 158, 11, 0.1);
		border-color: rgba(245, 158, 11, 0.15);
		color: var(--gold);
	}

	.importance-rating {
		font-size: 10px;
		color: var(--text-dim);
		font-weight: 500;
	}

	.btn-delete {
		margin-left: auto;
		background: transparent;
		border: none;
		color: var(--text-dim);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
		border-radius: 4px;
		transition: all 0.2s ease;
	}

	.btn-delete:hover {
		color: var(--rose);
		background: rgba(239, 68, 68, 0.1);
	}

	.memory-card-body p {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--text);
		line-height: 1.4;
	}

	.empty-memories {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 3rem 1rem;
		gap: 0.75rem;
		background: rgba(255, 255, 255, 0.01);
		border: 1px dashed rgba(255, 255, 255, 0.05);
		border-radius: 12px;
	}

	.empty-icon {
		font-size: 2rem;
		opacity: 0.7;
	}

	.empty-memories h5 {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text);
	}

	.empty-memories p {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--text-dim);
		max-width: 320px;
		line-height: 1.4;
	}

	.health-pill {
		font-size: var(--text-xs);
		font-weight: 600;
		padding: 4px 10px;
		border-radius: 99px;
	}
	.health-pill.healthy {
		background: rgba(16, 185, 129, 0.1);
		border: 1px solid rgba(16, 185, 129, 0.2);
		color: var(--success);
	}
	.health-pill.warning {
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.2);
		color: var(--gold);
	}
</style>
