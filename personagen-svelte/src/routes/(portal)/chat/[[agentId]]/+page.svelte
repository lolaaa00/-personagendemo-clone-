<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';

	function escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	/**
	 * Robust Markdown-to-HTML renderer for chat messages.
	 * Handles headings (h1-h6), bold, italic, inline code, code blocks,
	 * ordered/unordered lists, horizontal rules, and paragraphs.
	 */
	function renderMarkdown(raw: string): string {
		if (!raw) return '';

		// 1. Extract fenced code blocks first to protect them from further processing
		const codeBlocks: string[] = [];
		let text = raw.replace(/```([\s\S]*?)```/g, (_match, code) => {
			const idx = codeBlocks.length;
			codeBlocks.push(`<pre class="md-code-block"><code>${escapeHtml(code.trim())}</code></pre>`);
			return `%%CODEBLOCK_${idx}%%`;
		});

		// 2. Split into lines and process block-level elements
		const lines = text.split('\n');
		const htmlParts: string[] = [];
		let i = 0;

		while (i < lines.length) {
			const line = lines[i];
			const trimmed = line.trim();

			// Codeblock placeholder — pass through
			if (trimmed.startsWith('%%CODEBLOCK_')) {
				htmlParts.push(trimmed.replace(/%%CODEBLOCK_(\d+)%%/, (_m, idx) => codeBlocks[Number(idx)] || ''));
				i++;
				continue;
			}

			// Empty line — skip (paragraph break)
			if (trimmed === '') { i++; continue; }

			// Horizontal rule
			if (/^[-*_]{3,}$/.test(trimmed)) {
				htmlParts.push('<hr class="md-hr">');
				i++;
				continue;
			}

			// Headings (h1-h6)
			const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
			if (headingMatch) {
				const level = headingMatch[1].length;
				const content = inlineFormat(headingMatch[2]);
				htmlParts.push(`<h${level} class="md-h${level}">${content}</h${level}>`);
				i++;
				continue;
			}

			// Unordered list
			if (/^[-*+]\s+/.test(trimmed)) {
				const items: string[] = [];
				while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
					items.push(inlineFormat(lines[i].trim().replace(/^[-*+]\s+/, '')));
					i++;
				}
				htmlParts.push('<ul class="md-ul">' + items.map(it => `<li>${it}</li>`).join('') + '</ul>');
				continue;
			}

			// Ordered list
			if (/^\d+[.)\u{FF0E}]\s+/u.test(trimmed) || /^\d+️⃣/.test(trimmed)) {
				const items: string[] = [];
				while (i < lines.length) {
					const t = lines[i].trim();
					if (/^\d+[.)\u{FF0E}]\s+/u.test(t)) {
						items.push(inlineFormat(t.replace(/^\d+[.)\u{FF0E}]\s+/u, '')));
					} else if (/^\d+️⃣/.test(t)) {
						items.push(inlineFormat(t.replace(/^\d+️⃣\s*/, '')));
					} else {
						break;
					}
					i++;
				}
				htmlParts.push('<ol class="md-ol">' + items.map(it => `<li>${it}</li>`).join('') + '</ol>');
				continue;
			}

			// Regular paragraph
			htmlParts.push(`<p>${inlineFormat(trimmed)}</p>`);
			i++;
		}

		return htmlParts.join('');
	}

	/** Format inline markdown: bold, italic, inline code, links */
	function inlineFormat(text: string): string {
		let s = escapeHtml(text);
		// Inline code (must run before bold/italic to avoid conflicts)
		s = s.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
		// Bold + italic
		s = s.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
		// Bold
		s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
		// Italic
		s = s.replace(/\*(.*?)\*/g, '<em>$1</em>');
		// Links
		s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
		return s;
	}

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
		runtime_owner?: string;
		niche?: string;
	}

	interface Message {
		id: string;
		role: 'user' | 'agent' | 'system';
		content: string;
		timestamp: string;
		toolCalls?: any[];
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

	function mapDbMessage(m: any): Message {
		return {
			id: m.id || Math.random().toString(36).substring(7),
			role: m.role === 'model' ? 'agent' : m.role === 'user' ? 'user' : 'system',
			content: m.content,
			timestamp: m.created_at
				? new Date(m.created_at).toLocaleTimeString([], {
						hour: '2-digit',
						minute: '2-digit'
					})
				: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
			toolCalls: m.tool_calls || []
		};
	}

	// Custom agent presets for direct interaction
	const presets = $derived.by(() => {
		if (selectedAgent.is_overseer || selectedAgent.isHermes) {
			return [
				{
					label: '🔍 Audit platform state',
					prompt:
						'Audit the current system health, check active heartbeats, and report back any anomalies.'
				},
				{
					label: '⚡ Run health check',
					prompt: 'Trigger a programmatical heartbeat across all active agent instances now.'
				},
				{
					label: '📋 View agent roster',
					prompt: 'Generate an executive summary of all creator agents under your supervision.'
				},
				{
					label: '💾 Dump memory logs',
					prompt: 'Scan and dump your core memory indexes and instruction guidelines.'
				}
			];
		} else {
			return [
				{
					label: '✍️ Draft a viral thread',
					prompt: `Draft a highly engaging 3-part social media thread tailored to your niche: "${selectedAgent.soul || 'creator'}".`
				},
				{
					label: '📊 Scan recent trend reports',
					prompt: 'Scan trending topics in our market and identify content opportunities.'
				},
				{
					label: '🔑 Review channel parameters',
					prompt:
						'Analyze your active tools, skills, and autonomous config settings to recommend a performance improvement.'
				},
				{
					label: '💡 Brainstorm new hook ideas',
					prompt: 'Give me 5 punchy hook templates we can use for our next video or article.'
				}
			];
		}
	});

	// Sessions state
	let sessions: any[] = $state([]);
	let activeSessionId: string | null = $state(null);
	let editingSessionId: string | null = $state(null);
	let editTitleValue = $state('');

	async function loadSessions(selectLatest = false) {
		if (!selectedAgent?.id || selectedAgent.id === 'hermes-dev-bypass-id') return;
		try {
			const res = await fetch(`/api/agent/${selectedAgent.id}/sessions`);
			if (res.ok) {
				const data = await res.json();
				if (data.success) {
					sessions = data.sessions || [];

					// Set active session from URL if present
					const urlParams = new URLSearchParams(window.location.search);
					const querySessId = urlParams.get('session');
					if (querySessId && sessions.some(s => s.id === querySessId)) {
						activeSessionId = querySessId;
					} else if (selectLatest && sessions.length > 0) {
						activeSessionId = sessions[0].id;
						updateUrlParams(activeSessionId);
					} else if (!querySessId) {
						activeSessionId = null;
					}
				}
			}
		} catch (err) {
			console.error('Error loading sessions:', err);
		}
	}

	function updateUrlParams(sessionId: string | null) {
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		if (sessionId) {
			url.searchParams.set('session', sessionId);
		} else {
			url.searchParams.delete('session');
		}
		window.history.replaceState({}, '', url.toString());
	}

	async function createNewChat() {
		activeSessionId = null;
		updateUrlParams(null);
		loadChatHistory();
	}

	async function deleteSession(sessionId: string, event: Event) {
		event.stopPropagation();
		if (!confirm('Are you sure you want to delete this conversation?')) return;
		try {
			const res = await fetch(`/api/agent/${selectedAgent.id}/sessions?sessionId=${sessionId}`, {
				method: 'DELETE'
			});
			if (res.ok) {
				const data = await res.json();
				if (data.success) {
					if (activeSessionId === sessionId) {
						activeSessionId = null;
						updateUrlParams(null);
					}
					await loadSessions(true);
					await loadChatHistory();
				}
			}
		} catch (err) {
			console.error('Error deleting session:', err);
		}
	}

	function startRenameSession(session: any, event: Event) {
		event.stopPropagation();
		editingSessionId = session.id;
		editTitleValue = session.title;
	}

	async function saveRenameSession(sessionId: string) {
		if (!editTitleValue.trim()) return;
		try {
			const res = await fetch(`/api/agent/${selectedAgent.id}/sessions`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId, title: editTitleValue.trim() })
			});
			if (res.ok) {
				const data = await res.json();
				if (data.success) {
					editingSessionId = null;
					await loadSessions(false);
				}
			}
		} catch (err) {
			console.error('Error renaming session:', err);
		}
	}

	function handleRenameKeyDown(event: KeyboardEvent, sessionId: string) {
		if (event.key === 'Enter') {
			saveRenameSession(sessionId);
		} else if (event.key === 'Escape') {
			editingSessionId = null;
		}
	}

	// Load chat logs on agent change
	$effect(() => {
		if (selectedAgent?.id) {
			isTyping = false;
			currentLogs = [];
			inputValue = '';
			loadSessions(true).then(() => {
				loadChatHistory();
			});
		}
	});

	async function loadChatHistory() {
		if (typeof window === 'undefined') return;
		messages = [];
		if (!activeSessionId) {
			// Fallback to greeting
			messages = [
				{
					id: 'welcome',
					role: 'agent',
					content: getInitialGreeting(),
					timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
				}
			];
			scrollChatToBottom();
			return;
		}

		try {
			const res = await fetch(`/api/agent/${selectedAgent.id}/chat?sessionId=${activeSessionId}`);
			if (res.ok) {
				const data = await res.json();
				if (data.success && Array.isArray(data.messages) && data.messages.length > 0) {
					messages = data.messages.map(mapDbMessage);
					scrollChatToBottom();
					return;
				}
			}
		} catch (err) {
			console.error('Error fetching chat history from server:', err);
		}

		// Fallback to greeting
		messages = [
			{
				id: 'welcome',
				role: 'agent',
				content: getInitialGreeting(),
				timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
			}
		];
		scrollChatToBottom();
	}

	async function clearHistory() {
		if (!activeSessionId) return;
		if (confirm('Clear conversation history?')) {
			messages = [
				{
					id: 'welcome',
					role: 'agent',
					content: getInitialGreeting(),
					timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
				}
			];
			try {
				const res = await fetch(`/api/agent/${selectedAgent.id}/chat?sessionId=${activeSessionId}`, {
					method: 'DELETE'
				});
				if (!res.ok) {
					console.error('Failed to clear history on server');
				}
			} catch (err) {
				console.error('Error clearing chat history on server:', err);
			}
			scrollChatToBottom();
		}
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

	async function pollForDaemonResponse(targetAgentId: string, sessionId: string) {
		for (let attempt = 0; attempt < 20; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 2000));
			if (selectedAgent.id !== targetAgentId || activeSessionId !== sessionId) return;

			const res = await fetch(`/api/agent/${targetAgentId}/chat?sessionId=${sessionId}`);
			if (!res.ok) continue;

			const data = await res.json();
			if (!data.success || !Array.isArray(data.messages)) continue;

			messages = data.messages.length > 0 ? data.messages.map(mapDbMessage) : messages;
			await scrollChatToBottom();

			const last = data.messages[data.messages.length - 1];
			if (last?.role === 'model') {
				currentLogs = ['Hermes daemon response received.'];
				return;
			}

			currentLogs = [`Hermes daemon is processing... (${attempt + 1}/20)`];
		}

		messages = [
			...messages,
			{
				id: Math.random().toString(36).substring(7),
				role: 'system',
				content: 'Hermes daemon has not responded yet. Confirm the daemon worker is running.',
				timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
			}
		];
	}

	async function sendMessage(text: string) {
		if (!text.trim() || isTyping) return;

		const userText = text.trim();
		inputValue = '';
		const targetAgentId = selectedAgent.id;

		// Push user message immediately
		messages = [
			...messages,
			{
				id: Math.random().toString(36).substring(7),
				role: 'user',
				content: userText,
				timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
			}
		];
		await scrollChatToBottom();

		isTyping = true;

		currentLogs = selectedAgent.is_overseer || selectedAgent.runtime_owner === 'hermes-gateway'
			? ['Connecting to Hermes gateway...']
			: ['🧠 Checking personality profile & memories...', '📈 Connecting to Gemini Managed Agents API...'];

		try {
			const resPromise = fetch(`/api/agent/${targetAgentId}/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: userText, sessionId: activeSessionId })
			});

			await new Promise((resolve) => setTimeout(resolve, 800));
			if (selectedAgent.id !== targetAgentId) return; // Discard if agent switched
			currentLogs = selectedAgent.is_overseer || selectedAgent.runtime_owner === 'hermes-gateway'
				? ['Hermes gateway processing request...']
				: [...currentLogs, '⚙️ Invoking model with real-time tools...'];
			await scrollChatToBottom();

			const res = await resPromise;
			const data = await res.json();

			if (selectedAgent.id !== targetAgentId) return; // Discard if agent switched

			if (res.ok && data.success) {
				if (!activeSessionId && data.sessionId) {
					activeSessionId = data.sessionId;
					updateUrlParams(activeSessionId);
					await loadSessions(false);
				}

				if (data.queued && data.sessionId) {
					currentLogs = ['Hermes daemon queued the request. Waiting for daemon response...'];
					await pollForDaemonResponse(targetAgentId, data.sessionId);
					return;
				}

				if (data.toolCalls && data.toolCalls.length > 0) {
					currentLogs = data.toolCalls.map((tc: any) => `⚙️ Executed tool: ${tc.name}`);
				} else {
					currentLogs = ['✅ Processed response successfully.'];
				}
				await scrollChatToBottom();
				await new Promise((resolve) => setTimeout(resolve, 400));
				if (selectedAgent.id !== targetAgentId) return; // Discard if agent switched

				messages = [
					...messages,
					{
						id: Math.random().toString(36).substring(7),
						role: 'agent',
						content: data.response,
						timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
						toolCalls: data.toolCalls || []
					}
				];
			} else {
				messages = [
					...messages,
					{
						id: Math.random().toString(36).substring(7),
						role: 'system',
						content: `Connection failed: ${data.error || 'Unable to reach agent'}`,
						timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
					}
				];
			}
		} catch (err) {
			console.error('Chat error:', err);
			if (selectedAgent.id !== targetAgentId) return; // Discard if agent switched
			messages = [
				...messages,
				{
					id: Math.random().toString(36).substring(7),
					role: 'system',
					content: 'API connection error. Please try again.',
					timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
				}
			];
		} finally {
			if (selectedAgent.id === targetAgentId) {
				isTyping = false;
				currentLogs = [];
				await scrollChatToBottom();
			}
		}
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
				const list = agents
					.map(
						(a) =>
							`- **${a.name}** (${a.handle || '@creator'}): Status is *${a.status || 'active'}*. Niche is \`${a.niche || 'N/A'}\`.`
					)
					.join('\n');
				return `### 📋 Supervised Agent Roster

Here is the status breakdown of the creators under my orchestration:

${list}

I will keep monitoring their connection stats and notify you if any platform APIs require manual re-authorization.`;
			}
			return `I have reviewed your request: *"${prompt}"*. 

As the **Chief Operational Overseer**, I can confirm our background workers are successfully operating without any exceptions. I am ready to schedule new posts, read server logs, or dispatch instructions to creators. Please let me know how I should assist next!`;
		} else {
			if (
				lower.includes('draft') ||
				lower.includes('viral') ||
				lower.includes('post') ||
				lower.includes('thread')
			) {
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
		loadSessions(true).then(() => {
			loadChatHistory();
		});
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
				<div
					class="agent-avatar-gradient"
					style="background: {hermesAgent.gradient || 'linear-gradient(135deg, #10B981, #06B6D4)'}"
				>
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
				<span class="creator-count">{agents.filter((a) => a.status === 'active').length}</span>
			</div>

			<div class="creators-scroll-list">
				{#each agents.filter((a) => a.status === 'active') as agent}
					<button
						class="agent-card"
						class:active={selectedAgent.id === agent.id && !selectedAgent.isHermes}
						onclick={() => switchAgent(agent.id)}
					>
						<div
							class="agent-avatar-gradient"
							style="background: {agent.gradient || 'linear-gradient(135deg, #7c6aed, #e84393)'}"
						>
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
					<button class="preset-btn" onclick={() => sendMessage(preset.prompt)} disabled={isTyping}>
						{preset.label}
					</button>
				{/each}
			</div>
		</div>
	</aside>

	<!-- Middle Sidebar (Sessions) -->
	<aside class="sessions-sidebar border-strong">
		<div class="sidebar-section">
			<button class="new-chat-btn" onclick={createNewChat} disabled={isTyping}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<line x1="12" y1="5" x2="12" y2="19"></line>
					<line x1="5" y1="12" x2="19" y2="12"></line>
				</svg>
				New Chat
			</button>
		</div>

		<div class="sidebar-section sessions-section">
			<h4 class="section-title">Conversations</h4>
			<div class="sessions-scroll-list">
				{#each sessions as session (session.id)}
					<button
						class="session-card"
						class:active={activeSessionId === session.id}
						onclick={() => {
							if (editingSessionId !== session.id) {
								activeSessionId = session.id;
								updateUrlParams(activeSessionId);
								loadChatHistory();
							}
						}}
					>
						<div class="session-icon">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
							</svg>
						</div>

						<div class="session-info">
							{#if editingSessionId === session.id}
								<input
									type="text"
									class="rename-input"
									bind:value={editTitleValue}
									onkeydown={(e) => handleRenameKeyDown(e, session.id)}
									onblur={() => saveRenameSession(session.id)}
									onclick={(e) => e.stopPropagation()}
									aria-label="Rename conversation"
								/>
							{:else}
								<span class="session-title-text" title={session.title}>{session.title}</span>
							{/if}
						</div>

						<div class="session-actions">
							{#if editingSessionId !== session.id}
								<button class="action-icon-btn" onclick={(e) => startRenameSession(session, e)} title="Rename chat">
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
										<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
										<path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
									</svg>
								</button>
								<button class="action-icon-btn delete" onclick={(e) => deleteSession(session.id, e)} title="Delete chat">
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
										<polyline points="3 6 5 6 21 6"></polyline>
										<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
									</svg>
								</button>
							{/if}
						</div>
					</button>
				{:else}
					<div class="no-sessions">No recent chats</div>
				{/each}
			</div>
		</div>
	</aside>

	<!-- Right Chat Area -->
	<section class="chat-main-container">
		<!-- Header -->
		<header class="chat-header border-strong">
			<div class="header-left">
				<div
					class="agent-avatar-gradient"
					style="background: {selectedAgent.gradient ||
						'linear-gradient(135deg, #7c6aed, #e84393)'}"
				>
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
				<button class="clear-btn" onclick={clearHistory} disabled={!activeSessionId} title="Clear conversation history">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polyline points="3 6 5 6 21 6"></polyline>
						<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
						></path>
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
						<div
							class="welcome-avatar"
							style="background: {selectedAgent.gradient ||
								'linear-gradient(135deg, #7c6aed, #e84393)'}"
						>
							{selectedAgent.initial || selectedAgent.name.charAt(0)}
						</div>
						<div
							class="welcome-glow"
							style="background: {selectedAgent.gradient ||
								'linear-gradient(135deg, #7c6aed, #e84393)'}"
						></div>
					</div>
					<h2>Interact with {selectedAgent.name}</h2>
					<p class="welcome-subtitle">
						Ask details, run tool diagnostic parameters, or draft copy instantly.
					</p>

					<div class="welcome-details-grid">
						<div class="detail-box">
							<h5>Soul Personality Directive</h5>
							<p>{selectedAgent.soul || 'Operational autonomous personality instance.'}</p>
						</div>
						<div class="detail-box">
							<h5>Skills & Competencies</h5>
							<p>
								{selectedAgent.skills ||
									'Autonomous social strategy, campaign scheduling, performance analysis.'}
							</p>
						</div>
					</div>
				</div>

				<!-- Message list -->
				{#each messages as msg}
					{#if msg.id !== 'welcome'}
						<div class="message-row" class:user-row={msg.role === 'user'}>
							{#if msg.role === 'agent'}
								<div class="message-avatar-wrap">
									<div class="message-avatar" style="background: {selectedAgent.gradient}">
										{selectedAgent.initial}
									</div>
								</div>
							{/if}

							<div class="message-bubble-wrapper">
								<!-- If there are execution logs, show them collapsed or elegant -->
								{#if msg.toolCalls && msg.toolCalls.length > 0}
									<div class="tool-logs-box">
										<div class="tool-logs-title">
											⚙️ Tool Execution Trace ({msg.toolCalls.length})
										</div>
										{#each msg.toolCalls as call}
											<div class="tool-log-item">
												<span class="tool-name">⚙ {call.name}</span>
												<pre class="tool-args">{JSON.stringify(call.args)}</pre>
												{#if call.result && call.result.success !== false}
													<span class="tool-status success">✓ Completed</span>
												{:else}
													<span class="tool-status fail">✗ Failed</span>
												{/if}
											</div>
										{/each}
									</div>
								{/if}

								<div
									class="message-bubble glass-card border-strong"
									class:user-bubble={msg.role === 'user'}
								>
									<div class="message-text">
										{@html renderMarkdown(msg.content)}
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
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
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
		background: var(--bg);
		border-radius: var(--radius-lg);
		overflow: hidden;
		position: relative;
		margin: -1rem; /* Absorb outer padding of portal page container for real full-screen immersion */
	}

	.border-strong {
		border-color: var(--border-strong) !important;
	}

	/* SIDEBAR */
	.chat-sidebar {
		width: 260px;
		background: var(--surface-2);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		border-right: 1px solid var(--border-strong);
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
		color: var(--accent);
		background: var(--accent-soft);
		padding: 2px 8px;
		border-radius: 20px;
		border: 1px solid var(--accent-mid);
	}

	.section-title {
		margin: 0;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 700;
		color: var(--text-dim);
	}

	/* AGENT CARD */
	.agent-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 0.75rem;
		text-align: left;
		cursor: pointer;
		position: relative;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		width: 100%;
	}

	.agent-card:hover {
		background: var(--surface-2);
		border-color: var(--accent-mid);
		transform: translateY(-1px);
	}

	.agent-card.active {
		background: var(--accent-soft);
		border-color: var(--accent);
		box-shadow: var(--shadow-sm);
	}

	.overseer-card.active {
		background: var(--success-soft);
		border-color: var(--success);
		box-shadow: var(--shadow-sm);
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
		box-shadow: var(--shadow-sm);
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
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.agent-handle {
		font-size: 11px;
		color: var(--text-dim);
		font-family: var(--font-mono, monospace);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.badge-overseer {
		font-size: 9px;
		font-weight: 700;
		color: var(--success);
		background: var(--success-soft);
		padding: 1px 5px;
		border-radius: 4px;
		border: 1px solid var(--success);
		text-transform: uppercase;
	}

	.badge-creator {
		font-size: 9px;
		font-weight: 700;
		color: var(--accent);
		background: var(--accent-soft);
		padding: 1px 5px;
		border-radius: 4px;
		border: 1px solid var(--accent-mid);
		text-transform: uppercase;
	}

	.online-status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background-color: var(--success);
		box-shadow: 0 0 6px var(--success);
	}

	.active-dot-glow {
		position: absolute;
		right: 12px;
		top: 50%;
		transform: translateY(-50%);
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--success);
		box-shadow: 0 0 10px var(--success);
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
		background: var(--accent);
		box-shadow: 0 0 8px var(--accent);
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
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text);
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
		background: var(--accent-soft);
		border-color: var(--accent-mid);
		color: var(--accent);
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
		background: var(--bg);
		position: relative;
	}

	/* MIDDLE SESSIONS SIDEBAR */
	.sessions-sidebar {
		width: 240px;
		background: var(--surface);
		border-right: 1px solid var(--border-strong);
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: 1.5rem 1rem;
		flex-shrink: 0;
	}

	.new-chat-btn {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: var(--accent);
		color: #ffffff;
		border: none;
		border-radius: 10px;
		padding: 0.75rem;
		font-weight: 600;
		font-size: 13px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.new-chat-btn:hover {
		background: var(--accent-dark, #6366f1);
		transform: translateY(-1px);
	}

	.sessions-section {
		flex-grow: 1;
		min-height: 0;
	}

	.sessions-scroll-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		overflow-y: auto;
		flex-grow: 1;
	}

	.session-card {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.6rem;
		text-align: left;
		cursor: pointer;
		position: relative;
		transition: all 0.2s ease;
		width: 100%;
		min-width: 0;
	}

	.session-card:hover {
		background: var(--surface);
		border-color: var(--accent-mid);
	}

	.session-card.active {
		background: var(--accent-soft);
		border-color: var(--accent);
	}

	.session-icon {
		color: var(--text-dim);
		flex-shrink: 0;
	}

	.session-card.active .session-icon {
		color: var(--accent);
	}

	.session-info {
		flex-grow: 1;
		min-width: 0;
		overflow: hidden;
	}

	.session-title-text {
		display: block;
		font-size: 12.5px;
		color: var(--text);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.rename-input {
		width: 100%;
		background: var(--surface);
		border: 1px solid var(--accent);
		border-radius: 4px;
		color: var(--text);
		font-size: 12px;
		padding: 2px 4px;
		outline: none;
	}

	.session-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		opacity: 0;
		transition: opacity 0.2s ease;
	}

	.session-card:hover .session-actions {
		opacity: 1;
	}

	.action-icon-btn {
		background: transparent;
		border: none;
		color: var(--text-dim);
		cursor: pointer;
		padding: 2px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s ease;
	}

	.action-icon-btn:hover {
		color: var(--text);
		background: var(--border-strong);
	}

	.action-icon-btn.delete:hover {
		color: var(--error);
		background: var(--error-soft);
	}

	.no-sessions {
		font-size: 12px;
		color: var(--text-dim);
		text-align: center;
		padding: 1rem;
	}

	/* CHAT HEADER */
	.chat-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.25rem 2rem;
		background: var(--surface);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--border-strong);
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
		font-size: var(--text-base, 14px);
		font-weight: 700;
		color: var(--text);
	}

	.header-handle {
		font-size: 11px;
		color: var(--text-dim);
		font-family: var(--font-mono, monospace);
	}

	.clear-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--error-soft);
		border: 1px solid rgba(239, 68, 68, 0.15);
		color: var(--error);
		font-size: 11px;
		font-weight: 600;
		padding: 0.5rem 0.8rem;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.clear-btn:hover {
		background: rgba(239, 68, 68, 0.2);
		border-color: var(--error);
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
		background: var(--surface);
		border: 1px solid var(--border-strong);
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
		box-shadow: var(--shadow-md);
	}

	.welcome-glow {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		filter: blur(16px);
		opacity: 0.4;
		z-index: 1;
		transform: scale(1.1);
	}

	.chat-welcome-card h2 {
		margin: 0 0 0.5rem 0;
		font-size: 1.5rem;
		font-weight: 800;
		color: var(--text);
	}

	.welcome-subtitle {
		font-size: var(--text-sm, 12px);
		color: var(--text-muted);
		margin: 0 0 2rem 0;
	}

	.welcome-details-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1.5rem;
		text-align: left;
	}

	.detail-box {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1.25rem;
	}

	.detail-box h5 {
		margin: 0 0 0.5rem 0;
		font-size: var(--text-sm, 12px);
		font-weight: 700;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.detail-box p {
		margin: 0;
		font-size: var(--text-sm, 12px);
		color: var(--text-muted);
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
		box-shadow: var(--shadow-sm);
	}

	.message-bubble-wrapper {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}

	.message-bubble {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 16px;
		border-top-left-radius: 4px;
		padding: 1rem 1.25rem;
		position: relative;
		word-break: break-word;
		overflow-wrap: break-word;
	}

	.user-bubble {
		background: var(--accent-soft);
		border-color: var(--accent-mid);
		border-radius: 16px;
		border-top-right-radius: 4px;
		box-shadow: var(--shadow-sm);
	}

	.message-text p {
		margin: 0 0 0.5rem 0;
		font-size: 13.5px;
		line-height: 1.6;
		color: var(--text);
		word-break: break-word;
		overflow-wrap: break-word;
	}

	.message-text p:last-child {
		margin-bottom: 0;
	}

	/* Markdown heading styles */
	.message-text :global(.md-h1),
	.message-text :global(.md-h2),
	.message-text :global(.md-h3),
	.message-text :global(.md-h4),
	.message-text :global(.md-h5),
	.message-text :global(.md-h6) {
		margin: 0.25rem 0 0.5rem 0;
		font-weight: 700;
		color: var(--accent);
		line-height: 1.4;
	}

	.message-text :global(.md-h1) { font-size: 1.25rem; }
	.message-text :global(.md-h2) { font-size: 1.1rem; }
	.message-text :global(.md-h3) { font-size: 1rem; }
	.message-text :global(.md-h4) { font-size: 0.9rem; }
	.message-text :global(.md-h5) { font-size: 0.85rem; }
	.message-text :global(.md-h6) { font-size: 0.8rem; }

	.message-text :global(.md-ul),
	.message-text :global(.md-ol) {
		margin: 0 0 0.75rem 0;
		padding-left: 1.25rem;
	}

	.message-text :global(.md-ul li),
	.message-text :global(.md-ol li) {
		font-size: 13px;
		line-height: 1.5;
		color: var(--text-muted);
		margin-bottom: 0.25rem;
	}

	.message-text :global(.md-inline-code) {
		background: rgba(124, 106, 237, 0.12);
		color: var(--accent);
		padding: 2px 6px;
		border-radius: 4px;
		font-family: var(--font-mono, monospace);
		font-size: 0.85em;
	}

	.message-text :global(.md-code-block) {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin: 0.5rem 0;
		overflow-x: auto;
		font-size: 12px;
		line-height: 1.5;
		font-family: var(--font-mono, monospace);
		color: var(--text-muted);
	}

	.message-text :global(.md-code-block code) {
		background: none;
		padding: 0;
		color: inherit;
	}

	.message-text :global(.md-hr) {
		border: none;
		border-top: 1px solid var(--border);
		margin: 0.75rem 0;
	}

	.message-text :global(strong) {
		font-weight: 700;
		color: var(--text);
	}

	.message-text :global(em) {
		font-style: italic;
		color: var(--text-muted);
	}

	.message-text :global(a) {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.message-time {
		display: block;
		font-size: 10px;
		color: var(--text-dim);
		margin-top: 0.5rem;
		text-align: right;
	}

	/* TOOL LOGS */
	.tool-logs-box {
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		border-radius: 10px;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-width: 100%;
		font-family: var(--font-mono, monospace);
	}

	.live-logs-box {
		border-color: var(--accent-mid);
		box-shadow: var(--shadow-sm);
	}

	.tool-logs-title {
		font-size: 11px;
		font-weight: 700;
		color: var(--text-dim);
		margin-bottom: 4px;
	}

	.tool-log-item {
		font-size: 11px;
		color: var(--accent);
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
		background: var(--accent);
		animation: pulse-dot 1.5s infinite;
	}

	@keyframes pulse-dot {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.4;
		}
		50% {
			transform: scale(1.3);
			opacity: 1;
		}
	}

	/* TYPING INDICATOR */
	.typing-bubble {
		background: var(--surface-2);
		border: 1px solid var(--border);
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
		background: var(--text-dim);
		animation: bounce-dot 1.4s infinite ease-in-out both;
	}

	.typing-dot:nth-child(1) {
		animation-delay: -0.32s;
	}
	.typing-dot:nth-child(2) {
		animation-delay: -0.16s;
	}

	@keyframes bounce-dot {
		0%,
		80%,
		100% {
			transform: scale(0);
		}
		40% {
			transform: scale(1);
		}
	}

	/* CHAT FOOTER */
	.chat-footer {
		padding: 1.5rem 2rem 2rem 2rem;
		background: transparent;
		border-top: 1px solid var(--border);
	}

	.input-glow-container {
		max-width: 800px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 1rem;
		background: var(--surface) !important;
		border: 1px solid var(--border-strong);
		border-radius: 16px;
		padding: 0.75rem 1.25rem;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		box-shadow: var(--shadow-sm);
	}

	.input-glow-container:focus-within {
		border-color: var(--accent);
		box-shadow:
			0 0 15px var(--accent-soft),
			var(--shadow-md);
	}

	textarea {
		flex-grow: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text);
		font-size: 13.5px;
		line-height: 1.5;
		resize: none;
		font-family: inherit;
		padding: 0.25rem 0;
		max-height: 120px;
	}

	textarea::placeholder {
		color: var(--text-dim);
	}

	.send-btn {
		width: 36px;
		height: 36px;
		border-radius: 10px;
		background: var(--accent);
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
		background: var(--accent-dark, #6366f1);
		transform: scale(1.04) rotate(-5deg);
		box-shadow: 0 0 15px var(--accent-mid);
	}

	.send-btn:disabled {
		background: var(--surface-2);
		color: var(--text-dim);
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
		background: var(--border-strong);
		border-radius: 10px;
	}
	::-webkit-scrollbar-thumb:hover {
		background: var(--accent-mid);
	}

	:global(.inline-code) {
		font-family: var(--font-mono, monospace);
		font-size: 11.5px;
		background: var(--surface-2);
		padding: 2px 4px;
		border-radius: 4px;
		color: var(--accent);
		border: 1px solid var(--border);
	}

	@keyframes fade-in {
		from {
			opacity: 0;
			transform: translateY(3px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
