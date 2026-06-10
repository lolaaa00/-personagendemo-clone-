<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';

	interface Agent {
		id: string;
		name: string;
		handle?: string;
		initial?: string;
		gradient?: string;
		status?: string;
		soul?: string;
		skills?: string;
		tools?: string;
		is_overseer?: boolean;
		isHermes?: boolean;
		niche?: string;
	}

	interface Message {
		id: string;
		sender: 'user' | 'agent';
		text: string;
		timestamp: string;
		logs?: string[];
	}

	let { data } = $props();

	// Read data returned by PageServerLoad
	const agents = $derived(data.agents as Agent[]);
	const hermesAgent = $derived(data.hermesAgent as Agent);
	const selectedAgent = $derived(data.selectedAgent as Agent);

	// Reactive chat variables
	let messages: Message[] = $state([]);
	let inputValue = $state('');
	let isTyping = $state(false);
	let currentLogs: string[] = $state([]);
	let chatContainer: HTMLDivElement | null = $state(null);

	// Custom agent presets for direct interaction
	const presets = $derived.by(() => {
		if (selectedAgent.is_overseer || selectedAgent.isHermes) {
			return [
				{ label: '🔍 Audit platform state', prompt: 'Audit the current system health, check active heartbeats, and report back any anomalies.' },
				{ label: '⚡ Run health check', prompt: 'Trigger a programmatical heartbeat across all active agent instances now.' },
				{ label: '📋 View agent roster', prompt: 'Generate an executive summary of all creator agents under your supervision.' },
				{ label: '💾 Dump memory logs', prompt: 'Scan and dump your core memory indexes and instruction guidelines.' }
			];
		} else {
			return [
				{ label: '✍️ Draft a viral thread', prompt: `Draft a highly engaging 3-part social media thread tailored to your niche: "${selectedAgent.soul || 'creator'}".` },
				{ label: '📊 Scan recent trend reports', prompt: 'Scan trending topics in our market and identify content opportunities.' },
				{ label: '🔑 Review channel parameters', prompt: 'Analyze your active tools, skills, and autonomous config settings to recommend a performance improvement.' },
				{ label: '💡 Brainstorm new hook ideas', prompt: 'Give me 5 punchy hook templates we can use for our next video or article.' }
			];
		}
	});

	// Load chat logs on agent change
	$effect(() => {
		if (selectedAgent?.id) {
			loadChatHistory();
		}
	});

	function loadChatHistory() {
		if (typeof window === 'undefined') return;
		const key = `personagen_chat_history_${selectedAgent.id}`;
		const saved = localStorage.getItem(key);
		if (saved) {
			try {
				messages = JSON.parse(saved);
			} catch (e) {
				messages = [];
			}
		} else {
			// Populate welcome/intro message
			messages = [
				{
					id: 'init-msg',
					sender: 'agent',
					text: getInitialGreeting(),
					timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
				}
			];
		}
		scrollChatToBottom();
	}

	function saveChatHistory() {
		if (typeof window === 'undefined') return;
		const key = `personagen_chat_history_${selectedAgent.id}`;
		localStorage.setItem(key, JSON.stringify(messages));
	}

	function clearHistory() {
		messages = [
			{
				id: 'init-msg',
				sender: 'agent',
				text: getInitialGreeting(),
				timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
			}
		];
		saveChatHistory();
	}

	function getInitialGreeting(): string {
		if (selectedAgent.is_overseer || selectedAgent.isHermes) {
			return `Hello! I am **Hermes**, the Chief Operational Overseer. I monitor system metrics, orchestrate autonomic responses, and ensure smooth scheduling for all active creator agents. How can I assist you with platform diagnostics or scheduling configurations today?`;
		}
		return `Hi there! I am **${selectedAgent.name}**. My core mandate is: *"${selectedAgent.soul || 'Autonomous content creator'}"*. I specialize in **${selectedAgent.skills || 'creating viral content'}**. Let me know what you'd like to work on!`;
	}

	async function scrollChatToBottom() {
		await tick();
		if (chatContainer) {
			chatContainer.scrollTop = chatContainer.scrollHeight;
		}
	}

	// Trigger dynamic typing response
	async function sendMessage(text: string) {
		if (!text.trim() || isTyping) return;

		const userMsg: Message = {
			id: `user-${Date.now()}`,
			sender: 'user',
			text: text.trim(),
			timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		};

		messages = [...messages, userMsg];
		saveChatHistory();
		inputValue = '';
		await scrollChatToBottom();

		// Start typing simulation
		isTyping = true;
		currentLogs = [];

		// Simulated Tool Logs based on query
		const steps = selectedAgent.is_overseer || selectedAgent.isHermes
			? [
				'🔍 Scanning system database indexes...',
				'🛡️ Fetching operational metrics & memories...',
				'⚙️ Invoking agent_orchestrator tool...',
				'✅ Processing response parameters...'
			]
			: [
				'🧠 Checking personality profile & memories...',
				'📈 Searching social trend signals...',
				'🛠️ Accessing social media tools...',
				'📝 Formatting creative copy draft...'
			];

		// Step-by-step logs printing
		for (const step of steps) {
			await new Promise((resolve) => setTimeout(resolve, 800));
			currentLogs = [...currentLogs, step];
			await scrollChatToBottom();
		}

		// Generate a response based on the selected agent and input
		await new Promise((resolve) => setTimeout(resolve, 600));
		const replyText = generateSimulationResponse(text);

		const agentMsg: Message = {
			id: `agent-${Date.now()}`,
			sender: 'agent',
			text: replyText,
			timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
			logs: currentLogs
		};

		messages = [...messages, agentMsg];
		saveChatHistory();
		isTyping = false;
		currentLogs = [];
		await scrollChatToBottom();
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			sendMessage(inputValue);
		}
	}

	function switchAgent(id: string) {
		goto(`/chat/${id}`);
	}

	// Dynamic realistic responses
	function generateSimulationResponse(prompt: string): string {
		const lower = prompt.toLowerCase();
		const name = selectedAgent.name;

		if (selectedAgent.is_overseer || selectedAgent.isHermes) {
			if (lower.includes('audit') || lower.includes('health') || lower.includes('state')) {
				return `### 📊 Platform Diagnostics Report

I have executed \`system_log_reader\` and analyzed our Supabase db channels. Here is the current heartbeat assessment:

- **System Heartbeat**: Active (Pacing interval: 60s)
- **Active Creator Agents**: ${agents.length} Online
- **Database Status**: Sync stable (0 connections delayed)
- **Memory Buffer**: ${messages.length} local queries cached
- **Anomalies Detected**: None. The page server loading failure on the Overseer page has been resolved.

All operations are nominal. I will continue checking the scheduler cycles.`;
			}
			if (lower.includes('roster') || lower.includes('agents')) {
				const list = agents.map(a => `- **${a.name}** (${a.handle || '@creator'}): Status is *${a.status || 'active'}*. Niche is \`${a.niche || 'N/A'}\`.`).join('\n');
				return `### 📋 Supervised Agent Roster

Here is the status breakdown of the creators under my orchestration:

${list}

I will keep monitoring their connection stats and notify you if any platform APIs require manual re-authorization.`;
			}
			return `I have reviewed your request: *"${prompt}"*. 

As the **Chief Operational Overseer**, I can confirm our background workers are successfully operating without any exceptions. I am ready to schedule new posts, read server logs, or dispatch instructions to creators. Please let me know how I should assist next!`;
		} else {
			if (lower.includes('draft') || lower.includes('viral') || lower.includes('post') || lower.includes('thread')) {
				return `### ✍️ Draft: Viral Social Media Thread

Tailored for my niche (\`${selectedAgent.niche || 'Digital Growth'}\`) and soul directions:

1️⃣ **The Hook:** Stop doing what everyone else is doing to grow. If you want outlier results, you need an outlier strategy. Here is the exact playbook we used to scale 10x this quarter... 👇

2️⃣ **The Value:** Don't just build a product. Build an automated system that handles marketing, syncing, and content creation for you. Our creators are literally virtual instances executing 24/7.

3️⃣ **The Call-to-Action:** Ready to try? We just updated the **Persona Config** panel to allow live account syncing. Connect your platform handle today! Let me know what you think of this draft!`;
			}
			if (lower.includes('trend') || lower.includes('scan') || lower.includes('topic')) {
				return `### 📈 Trend Scanning Analysis

I have completed a scan of our target demographics. Here are top-performing topics for **${selectedAgent.name}**:

1. **Autonomic Automation** (Engagement Index: 🔥 94/100)
2. **AI Creators & Brand Personas** (Engagement Index: 🔥 89/100)
3. **Svelte 5 Runes Clean Code** (Engagement Index: 🔥 81/100)

**Recommendation:** We should draft our next piece of content targeting **Autonomic Automation** to capitalize on high search intent!`;
			}
			return `I have fully analyzed your message: *"${prompt}"*.

As a specialized creator, I've updated my internal logic context. I am connected, healthy, and ready to craft copy, generate ideas, or review market data. Let me know if you would like me to draft specific social posts or help brainstorm!`;
		}
	}

	onMount(() => {
		loadChatHistory();
	});
</script>

<div class="chat-portal-wrapper">
	<!-- Left Side Sidebar -->
	<aside class="chat-sidebar border-strong">
		<!-- Section: Chief Overseer -->
		<div class="sidebar-section">
			<h4 class="section-title">Chief Overseer</h4>
			<button 
				class="agent-card overseer-card" 
				class:active={selectedAgent.is_overseer || selectedAgent.isHermes}
				onclick={() => switchAgent('hermes')}
			>
				<div class="agent-avatar-gradient" style="background: {hermesAgent.gradient || 'linear-gradient(135deg, #10B981, #06B6D4)'}">
					{hermesAgent.initial || 'H'}
				</div>
				<div class="agent-info">
					<div class="agent-name-row">
						<span class="agent-name">{hermesAgent.name}</span>
						<span class="badge-overseer">System</span>
					</div>
					<span class="agent-handle">{hermesAgent.handle || '@hermes_overseer'}</span>
				</div>
				<div class="active-dot-glow"></div>
			</button>
		</div>

		<!-- Section: Creators List -->
		<div class="sidebar-section creators-section">
			<div class="section-title-row">
				<h4 class="section-title">Active Creators</h4>
				<span class="creator-count">{agents.length}</span>
			</div>
			
			<div class="creators-scroll-list">
				{#each agents as agent}
					<button 
						class="agent-card" 
						class:active={selectedAgent.id === agent.id && !selectedAgent.isHermes}
						onclick={() => switchAgent(agent.id)}
					>
						<div class="agent-avatar-gradient" style="background: {agent.gradient || 'linear-gradient(135deg, #7c6aed, #e84393)'}">
							{agent.initial || agent.name.charAt(0)}
						</div>
						<div class="agent-info">
							<div class="agent-name-row">
								<span class="agent-name">{agent.name}</span>
								{#if agent.status === 'active'}
									<span class="online-status-dot" title="Active"></span>
								{/if}
							</div>
							<span class="agent-handle">{agent.handle || '@connected'}</span>
						</div>
						{#if selectedAgent.id === agent.id && !selectedAgent.isHermes}
							<div class="active-indicator"></div>
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<!-- Quick Presets -->
		<div class="sidebar-section presets-section">
			<h4 class="section-title">Quick presets</h4>
			<div class="presets-list">
				{#each presets as preset}
					<button 
						class="preset-btn"
						onclick={() => sendMessage(preset.prompt)}
						disabled={isTyping}
					>
						{preset.label}
					</button>
				{/each}
			</div>
		</div>
	</aside>

	<!-- Right Chat Area -->
	<section class="chat-main-container">
		<!-- Header -->
		<header class="chat-header border-strong">
			<div class="header-left">
				<div class="agent-avatar-gradient" style="background: {selectedAgent.gradient || 'linear-gradient(135deg, #7c6aed, #e84393)'}">
					{selectedAgent.initial || selectedAgent.name.charAt(0)}
				</div>
				<div class="header-agent-meta">
					<div class="header-name-row">
						<h3>{selectedAgent.name}</h3>
						{#if selectedAgent.is_overseer || selectedAgent.isHermes}
							<span class="badge-overseer">Chief Overseer</span>
						{:else}
							<span class="badge-creator">Creator</span>
						{/if}
					</div>
					<span class="header-handle">{selectedAgent.handle || '@unconnected'}</span>
				</div>
			</div>

			<div class="header-right">
				<button class="clear-btn" onclick={clearHistory} title="Clear conversation history">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="3 6 5 6 21 6"></polyline>
						<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
					</svg>
					Clear History
				</button>
			</div>
		</header>

		<!-- Message Logs Viewport -->
		<div class="chat-messages-viewport" bind:this={chatContainer}>
			<div class="messages-container">
				<!-- Welcome Overlay Card -->
				<div class="chat-welcome-card glass-card border-strong">
					<div class="welcome-avatar-wrap">
						<div class="welcome-avatar" style="background: {selectedAgent.gradient || 'linear-gradient(135deg, #7c6aed, #e84393)'}">
							{selectedAgent.initial || selectedAgent.name.charAt(0)}
						</div>
						<div class="welcome-glow" style="background: {selectedAgent.gradient || 'linear-gradient(135deg, #7c6aed, #e84393)'}"></div>
					</div>
					<h2>Interact with {selectedAgent.name}</h2>
					<p class="welcome-subtitle">Ask details, run tool diagnostic parameters, or draft copy instantly.</p>

					<div class="welcome-details-grid">
						<div class="detail-box">
							<h5>Soul Personality Directive</h5>
							<p>{selectedAgent.soul || 'Operational autonomous personality instance.'}</p>
						</div>
						<div class="detail-box">
							<h5>Skills & Competencies</h5>
							<p>{selectedAgent.skills || 'Autonomous social strategy, campaign scheduling, performance analysis.'}</p>
						</div>
					</div>
				</div>

				<!-- Message list -->
				{#each messages as msg}
					{#if msg.id !== 'init-msg'}
						<div class="message-row" class:user-row={msg.sender === 'user'}>
							{#if msg.sender === 'agent'}
								<div class="message-avatar-wrap">
									<div class="message-avatar" style="background: {selectedAgent.gradient}">
										{selectedAgent.initial}
									</div>
								</div>
							{/if}

							<div class="message-bubble-wrapper">
								<!-- If there are execution logs, show them collapsed or elegant -->
								{#if msg.logs && msg.logs.length > 0}
									<div class="tool-logs-box">
										<div class="tool-logs-title">⚙️ Local Tool Executions</div>
										{#each msg.logs as log}
											<div class="tool-log-item">{log}</div>
										{/each}
									</div>
								{/if}

								<div class="message-bubble glass-card border-strong" class:user-bubble={msg.sender === 'user'}>
									<div class="message-text">
										<!-- Basic rendering with bolding/markdown formatting -->
										{#each msg.text.split('\n') as paragraph}
											{#if paragraph.startsWith('### ')}
												<h4>{paragraph.replace('### ', '')}</h4>
											{:else if paragraph.startsWith('- ')}
												<ul>
													<li>{paragraph.replace('- ', '')}</li>
												</ul>
											{:else}
												<p>
													<!-- Simple double bold formatting -->
													{@html paragraph
														.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
														.replace(/`(.*?)`/g, '<code class="inline-code">$1</code>')
													}
												</p>
											{/if}
										{/each}
									</div>
									<span class="message-time">{msg.timestamp}</span>
								</div>
							</div>
						</div>
					{/if}
				{/each}

				<!-- Typing states & Logs updates -->
				{#if isTyping}
					<div class="message-row">
						<div class="message-avatar-wrap">
							<div class="message-avatar" style="background: {selectedAgent.gradient}">
								{selectedAgent.initial}
							</div>
						</div>
						<div class="message-bubble-wrapper">
							<!-- Logs progress live stream -->
							{#if currentLogs.length > 0}
								<div class="tool-logs-box live-logs-box">
									<div class="tool-logs-title flex-row">
										<span>⚙️ Live Agent Activity...</span>
										<span class="live-dot-pulse"></span>
									</div>
									{#each currentLogs as log}
										<div class="tool-log-item fade-in-log">{log}</div>
									{/each}
								</div>
							{/if}

							<div class="typing-bubble glass-card border-strong">
								<span class="typing-dot"></span>
								<span class="typing-dot"></span>
								<span class="typing-dot"></span>
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Footer Glowing Text Input Area -->
		<footer class="chat-footer border-strong">
			<div class="input-glow-container glass-card">
				<textarea
					bind:value={inputValue}
					onkeydown={handleKeyDown}
					placeholder="Message {selectedAgent.name}... (Press Enter to send)"
					rows="1"
					disabled={isTyping}
				></textarea>
				<button 
					class="send-btn" 
					onclick={() => sendMessage(inputValue)}
					disabled={!inputValue.trim() || isTyping}
					aria-label="Send message"
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<line x1="22" y1="2" x2="11" y2="13"></line>
						<polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
					</svg>
				</button>
			</div>
		</footer>
	</section>
</div>

<style>
	:global(body) {
		overflow: hidden;
	}

	.chat-portal-wrapper {
		display: flex;
		height: calc(100vh - 100px); /* Fill remaining height cleanly */
		background: var(--bg-portal, #080710);
		border-radius: var(--radius-lg);
		overflow: hidden;
		position: relative;
		margin: -1rem; /* Absorb outer padding of portal page container for real full-screen immersion */
	}

	.border-strong {
		border-color: var(--border-strong, rgba(124, 106, 237, 0.15)) !important;
	}

	/* SIDEBAR */
	.chat-sidebar {
		width: 320px;
		background: rgba(10, 10, 20, 0.4);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		border-right: 1px solid rgba(255, 255, 255, 0.05);
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: 1.5rem;
		flex-shrink: 0;
	}

	.sidebar-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.section-title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.creator-count {
		font-size: 11px;
		font-weight: 700;
		color: var(--accent-light, #c084fc);
		background: rgba(124, 106, 237, 0.12);
		padding: 2px 8px;
		border-radius: 20px;
		border: 1px solid rgba(124, 106, 237, 0.15);
	}

	.section-title {
		margin: 0;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 700;
		color: var(--text-dim, rgba(255, 255, 255, 0.5));
	}

	/* AGENT CARD */
	.agent-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: rgba(255, 255, 255, 0.01);
		border: 1px solid rgba(255, 255, 255, 0.03);
		border-radius: 12px;
		padding: 0.75rem;
		text-align: left;
		cursor: pointer;
		position: relative;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		width: 100%;
	}

	.agent-card:hover {
		background: rgba(255, 255, 255, 0.04);
		border-color: rgba(124, 106, 237, 0.2);
		transform: translateY(-1px);
	}

	.agent-card.active {
		background: rgba(124, 106, 237, 0.08);
		border-color: rgba(124, 106, 237, 0.4);
		box-shadow: 0 4px 20px rgba(124, 106, 237, 0.05);
	}

	.overseer-card.active {
		background: rgba(16, 185, 129, 0.06);
		border-color: rgba(16, 185, 129, 0.3);
		box-shadow: 0 4px 20px rgba(16, 185, 129, 0.05);
	}

	.agent-avatar-gradient {
		width: 38px;
		height: 38px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 800;
		color: #ffffff;
		font-size: 14px;
		flex-shrink: 0;
		text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	.agent-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex-grow: 1;
	}

	.agent-name-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.agent-name {
		font-size: 13px;
		font-weight: 600;
		color: var(--text, #ffffff);
		white-space: nowrap;
		overflow: text-overflow;
		text-overflow: ellipsis;
	}

	.agent-handle {
		font-size: 11px;
		color: var(--text-dim, rgba(255, 255, 255, 0.4));
		font-family: var(--font-mono, monospace);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.badge-overseer {
		font-size: 9px;
		font-weight: 700;
		color: var(--success, #10b981);
		background: rgba(16, 185, 129, 0.12);
		padding: 1px 5px;
		border-radius: 4px;
		border: 1px solid rgba(16, 185, 129, 0.2);
		text-transform: uppercase;
	}

	.badge-creator {
		font-size: 9px;
		font-weight: 700;
		color: var(--accent-light, #c084fc);
		background: rgba(124, 106, 237, 0.12);
		padding: 1px 5px;
		border-radius: 4px;
		border: 1px solid rgba(124, 106, 237, 0.2);
		text-transform: uppercase;
	}

	.online-status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background-color: var(--success, #10b981);
		box-shadow: 0 0 6px var(--success, #10b981);
	}

	.active-dot-glow {
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--success, #10b981);
		box-shadow: 0 0 10px var(--success, #10b981);
		opacity: 0;
		transition: opacity 0.3s ease;
	}

	.overseer-card.active .active-dot-glow {
		opacity: 1;
	}

	.active-indicator {
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--accent-light, #c084fc);
		box-shadow: 0 0 8px var(--accent-light, #c084fc);
	}

	/* CREATORS LIST SCROLL */
	.creators-section {
		flex-grow: 1;
		min-height: 0;
	}

	.creators-scroll-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		overflow-y: auto;
		flex-grow: 1;
		padding-right: 2px;
	}

	/* QUICK PRESETS */
	.presets-section {
		flex-shrink: 0;
	}

	.presets-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.preset-btn {
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.04);
		border-radius: 8px;
		color: var(--text, #ffffff);
		cursor: pointer;
		font-size: var(--text-xs, 12px);
		padding: 0.6rem 0.8rem;
		text-align: left;
		transition: all 0.2s ease;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.preset-btn:hover:not(:disabled) {
		background: rgba(124, 106, 237, 0.05);
		border-color: rgba(124, 106, 237, 0.2);
		color: var(--accent-light, #c084fc);
		transform: translateX(2px);
	}

	.preset-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* CHAT MAIN CONTAINER */
	.chat-main-container {
		flex-grow: 1;
		display: flex;
		flex-direction: column;
		background: rgba(5, 5, 10, 0.15);
		position: relative;
	}

	/* CHAT HEADER */
	.chat-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 2rem;
		background: rgba(10, 10, 20, 0.25);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
		z-index: 10;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.header-agent-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.header-name-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.header-name-row h3 {
		margin: 0;
		font-size: var(--text-sm, 14px);
		font-weight: 700;
		color: var(--text, #ffffff);
	}

	.header-handle {
		font-size: 11px;
		color: var(--text-dim, rgba(255, 255, 255, 0.4));
		font-family: var(--font-mono, monospace);
	}

	.clear-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: rgba(239, 68, 68, 0.05);
		border: 1px solid rgba(239, 68, 68, 0.15);
		color: #f87171;
		font-size: 11px;
		font-weight: 600;
		padding: 0.5rem 0.8rem;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.clear-btn:hover {
		background: rgba(239, 68, 68, 0.12);
		border-color: rgba(239, 68, 68, 0.3);
		transform: translateY(-1px);
	}

	/* MESSAGES VIEWPORT */
	.chat-messages-viewport {
		flex-grow: 1;
		overflow-y: auto;
		padding: 2rem;
		display: flex;
		flex-direction: column;
	}

	.messages-container {
		max-width: 800px;
		width: 100%;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* WELCOME OVERLAY CARD */
	.chat-welcome-card {
		background: rgba(255, 255, 255, 0.01);
		border: 1px solid rgba(124, 106, 237, 0.12);
		border-radius: var(--radius-lg);
		padding: 2.5rem;
		text-align: center;
		margin-bottom: 2rem;
		position: relative;
		overflow: hidden;
	}

	.welcome-avatar-wrap {
		position: relative;
		width: 64px;
		height: 64px;
		margin: 0 auto 1.5rem auto;
	}

	.welcome-avatar {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 24px;
		font-weight: 800;
		color: #ffffff;
		z-index: 2;
		position: relative;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
	}

	.welcome-glow {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		filter: blur(16px);
		opacity: 0.6;
		z-index: 1;
		transform: scale(1.1);
	}

	.chat-welcome-card h2 {
		margin: 0 0 0.5rem 0;
		font-size: 1.5rem;
		font-weight: 800;
		color: var(--text, #ffffff);
	}

	.welcome-subtitle {
		font-size: var(--text-xs, 12px);
		color: var(--text-dim, rgba(255, 255, 255, 0.5));
		margin: 0 0 2rem 0;
	}

	.welcome-details-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1.5rem;
		text-align: left;
	}

	.detail-box {
		background: rgba(255, 255, 255, 0.015);
		border: 1px solid rgba(255, 255, 255, 0.03);
		border-radius: 12px;
		padding: 1.25rem;
	}

	.detail-box h5 {
		margin: 0 0 0.5rem 0;
		font-size: var(--text-xs, 12px);
		font-weight: 700;
		color: var(--accent-light, #c084fc);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.detail-box p {
		margin: 0;
		font-size: var(--text-xs, 12px);
		color: var(--text, rgba(255, 255, 255, 0.8));
		line-height: 1.5;
	}

	/* MESSAGE BUBBLES */
	.message-row {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		max-width: 85%;
	}

	.user-row {
		align-self: flex-end;
		flex-direction: row-reverse;
	}

	.message-avatar-wrap {
		flex-shrink: 0;
	}

	.message-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 800;
		color: #ffffff;
		font-size: 12px;
		box-shadow: 0 4px 10px rgba(0, 0, 0, 0.15);
	}

	.message-bubble-wrapper {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}

	.message-bubble {
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 16px;
		border-top-left-radius: 4px;
		padding: 1rem 1.25rem;
		position: relative;
	}

	.user-bubble {
		background: linear-gradient(135deg, rgba(124, 106, 237, 0.1), rgba(124, 106, 237, 0.03));
		border-color: rgba(124, 106, 237, 0.25);
		border-radius: 16px;
		border-top-right-radius: 4px;
		box-shadow: 0 4px 15px rgba(124, 106, 237, 0.03);
	}

	.message-text p {
		margin: 0 0 0.5rem 0;
		font-size: 13.5px;
		line-height: 1.6;
		color: var(--text, #ffffff);
	}

	.message-text p:last-child {
		margin-bottom: 0;
	}

	.message-text h4 {
		margin: 0 0 0.75rem 0;
		font-size: var(--text-sm, 14px);
		font-weight: 700;
		color: var(--accent-light, #c084fc);
	}

	.message-text ul {
		margin: 0 0 0.75rem 0;
		padding-left: 1.25rem;
	}

	.message-text li {
		font-size: 13px;
		line-height: 1.5;
		color: var(--text, rgba(255, 255, 255, 0.9));
		margin-bottom: 0.25rem;
	}

	.message-time {
		display: block;
		font-size: 10px;
		color: var(--text-dim, rgba(255, 255, 255, 0.35));
		margin-top: 0.5rem;
		text-align: right;
	}

	/* TOOL LOGS */
	.tool-logs-box {
		background: rgba(0, 0, 0, 0.35);
		border: 1px solid rgba(255, 255, 255, 0.03);
		border-radius: 10px;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-width: 100%;
		font-family: var(--font-mono, monospace);
	}

	.live-logs-box {
		border-color: rgba(124, 106, 237, 0.15);
		box-shadow: 0 0 15px rgba(124, 106, 237, 0.03);
	}

	.tool-logs-title {
		font-size: 11px;
		font-weight: 700;
		color: var(--text-dim, rgba(255, 255, 255, 0.4));
		margin-bottom: 4px;
	}

	.tool-log-item {
		font-size: 11px;
		color: var(--accent-light, #c084fc);
	}

	.fade-in-log {
		animation: fade-in 0.3s ease forwards;
	}

	.flex-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.live-dot-pulse {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent-light, #c084fc);
		animation: pulse-dot 1.5s infinite;
	}

	@keyframes pulse-dot {
		0%, 100% { transform: scale(1); opacity: 0.4; }
		50% { transform: scale(1.3); opacity: 1; }
	}

	/* TYPING INDICATOR */
	.typing-bubble {
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 16px;
		border-top-left-radius: 4px;
		padding: 0.75rem 1.25rem;
		display: flex;
		align-items: center;
		gap: 4px;
		width: fit-content;
	}

	.typing-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--text-dim, rgba(255, 255, 255, 0.4));
		animation: bounce-dot 1.4s infinite ease-in-out both;
	}

	.typing-dot:nth-child(1) { animation-delay: -0.32s; }
	.typing-dot:nth-child(2) { animation-delay: -0.16s; }

	@keyframes bounce-dot {
		0%, 80%, 100% { transform: scale(0); }
		40% { transform: scale(1); }
	}

	/* CHAT FOOTER */
	.chat-footer {
		padding: 1.5rem 2rem 2rem 2rem;
		background: transparent;
		border-top: 1px solid rgba(255, 255, 255, 0.03);
	}

	.input-glow-container {
		max-width: 800px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 1rem;
		background: rgba(15, 15, 25, 0.6) !important;
		border: 1px solid rgba(124, 106, 237, 0.2);
		border-radius: 16px;
		padding: 0.75rem 1.25rem;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
	}

	.input-glow-container:focus-within {
		border-color: rgba(124, 106, 237, 0.4);
		box-shadow: 0 0 25px rgba(124, 106, 237, 0.08), 0 8px 30px rgba(0, 0, 0, 0.25);
	}

	textarea {
		flex-grow: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text, #ffffff);
		font-size: 13.5px;
		line-height: 1.5;
		resize: none;
		font-family: inherit;
		padding: 0.25rem 0;
		max-height: 120px;
	}

	textarea::placeholder {
		color: var(--text-dim, rgba(255, 255, 255, 0.35));
	}

	.send-btn {
		width: 36px;
		height: 36px;
		border-radius: 10px;
		background: var(--accent-mid, #7c6aed);
		color: #ffffff;
		border: none;
		outline: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s ease;
		flex-shrink: 0;
	}

	.send-btn:hover:not(:disabled) {
		background: var(--accent-light, #907efc);
		transform: scale(1.04) rotate(-5deg);
		box-shadow: 0 0 15px rgba(124, 106, 237, 0.3);
	}

	.send-btn:disabled {
		background: rgba(255, 255, 255, 0.04);
		color: var(--text-dim, rgba(255, 255, 255, 0.2));
		cursor: not-allowed;
	}

	/* CUSTOM SCROLLBARS */
	::-webkit-scrollbar {
		width: 6px;
	}
	::-webkit-scrollbar-track {
		background: transparent;
	}
	::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.05);
		border-radius: 10px;
	}
	::-webkit-scrollbar-thumb:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	:global(.inline-code) {
		font-family: var(--font-mono, monospace);
		font-size: 11.5px;
		background: rgba(255, 255, 255, 0.05);
		padding: 2px 4px;
		border-radius: 4px;
		color: #fca5a5;
		border: 1px solid rgba(255, 255, 255, 0.02);
	}

	@keyframes fade-in {
		from { opacity: 0; transform: translateY(3px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
