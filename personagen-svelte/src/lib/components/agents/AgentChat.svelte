<script lang="ts">
	import { showToast } from '$lib/stores/ui.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { page } from '$app/stores';

	/** Escape HTML entities for safe rendering */
	function escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	/** Robust Markdown-to-HTML renderer for chat messages */
	function renderMarkdown(raw: string): string {
		if (!raw) return '';
		const codeBlocks: string[] = [];
		let text = raw.replace(/```([\s\S]*?)```/g, (_match, code) => {
			const idx = codeBlocks.length;
			codeBlocks.push(`<pre class="md-code-block"><code>${escapeHtml(code.trim())}</code></pre>`);
			return `%%CODEBLOCK_${idx}%%`;
		});
		const lines = text.split('\n');
		const htmlParts: string[] = [];
		let i = 0;
		while (i < lines.length) {
			const trimmed = lines[i].trim();
			if (trimmed.startsWith('%%CODEBLOCK_')) {
				htmlParts.push(trimmed.replace(/%%CODEBLOCK_(\d+)%%/, (_m, idx) => codeBlocks[Number(idx)] || ''));
				i++; continue;
			}
			if (trimmed === '') { i++; continue; }
			if (/^[-*_]{3,}$/.test(trimmed)) { htmlParts.push('<hr class="md-hr">'); i++; continue; }
			const hm = trimmed.match(/^(#{1,6})\s+(.*)$/);
			if (hm) { htmlParts.push(`<h${hm[1].length} class="md-h${hm[1].length}">${inlineFormat(hm[2])}</h${hm[1].length}>`); i++; continue; }
			if (/^[-*+]\s+/.test(trimmed)) {
				const items: string[] = [];
				while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) { items.push(inlineFormat(lines[i].trim().replace(/^[-*+]\s+/, ''))); i++; }
				htmlParts.push('<ul class="md-ul">' + items.map(it => `<li>${it}</li>`).join('') + '</ul>');
				continue;
			}
			if (/^\d+[.)\u{FF0E}]\s+/u.test(trimmed) || /^\d+️⃣/.test(trimmed)) {
				const items: string[] = [];
				while (i < lines.length) {
					const t = lines[i].trim();
					if (/^\d+[.)\u{FF0E}]\s+/u.test(t)) { items.push(inlineFormat(t.replace(/^\d+[.)\u{FF0E}]\s+/u, ''))); }
					else if (/^\d+️⃣/.test(t)) { items.push(inlineFormat(t.replace(/^\d+️⃣\s*/, ''))); }
					else break;
					i++;
				}
				htmlParts.push('<ol class="md-ol">' + items.map(it => `<li>${it}</li>`).join('') + '</ol>');
				continue;
			}
			htmlParts.push(`<p>${inlineFormat(trimmed)}</p>`);
			i++;
		}
		return htmlParts.join('');
	}

	function inlineFormat(text: string): string {
		let s = escapeHtml(text);
		s = s.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
		s = s.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
		s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
		s = s.replace(/\*(.*?)\*/g, '<em>$1</em>');
		s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
		return s;
	}

	interface Props {
		agentId: string;
		agentName: string;
		agentGradient: string;
		agentInitial: string;
	}

	let { agentId, agentName, agentGradient, agentInitial }: Props = $props();

	interface Message {
		id: string;
		role: 'user' | 'agent' | 'system';
		content: string;
		timestamp: string;
		toolCalls?: any[];
	}

	let messages = $state<Message[]>([]);
	let inputValue = $state('');
	let loading = $state(false);
	let chatOpen = $state(false);
	let isMaximized = $state(false);
	let scrollContainer = $state<HTMLElement | null>(null);
	let activeSessionId = $state<string | null>(null);

	// Fetch message history from the server with localStorage fallback
	async function fetchHistory() {
		try {
			const res = await fetch(`/api/agent/${agentId}/chat`);
			if (res.ok) {
				const data = await res.json();
				if (data.success && Array.isArray(data.messages)) {
					activeSessionId = data.sessionId || null;
					if (data.messages.length > 0) {
						messages = data.messages.map((m: any) => ({
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
						}));
						scrollToBottom();
						return;
					}
				}
			}
		} catch (err) {
			console.error('Error fetching chat history from server:', err);
		}

		// Fallback: load from localStorage
		const userId = $page.data.user?.id || 'guest';
		const cacheKey = activeSessionId
			? `personagen_chat_session_${userId}_${agentId}_${activeSessionId}`
			: `personagen_chat_session_${userId}_${agentId}`;
		const cached = localStorage.getItem(cacheKey);
		if (cached) {
			try {
				messages = JSON.parse(cached);
			} catch {
				initializeChat();
			}
		} else {
			initializeChat();
		}
		scrollToBottom();
	}

	// Save messages to localStorage when updated
	$effect(() => {
		if (messages.length > 0) {
			const userId = $page.data.user?.id || 'guest';
			const cacheKey = activeSessionId
				? `personagen_chat_session_${userId}_${agentId}_${activeSessionId}`
				: `personagen_chat_session_${userId}_${agentId}`;
			localStorage.setItem(cacheKey, JSON.stringify(messages));
		}
	});

	// Watch agentId change
	$effect(() => {
		if (agentId) {
			fetchHistory();
		}
	});

	function initializeChat() {
		messages = [
			{
				id: 'welcome',
				role: 'agent',
				content: `Hi there! I am ${agentName}. I'm fully configured and connected to your content engine. Ask me to scan trends, draft content, or check schedule!`,
				timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
			}
		];
	}

	function scrollToBottom() {
		setTimeout(() => {
			if (scrollContainer) {
				scrollContainer.scrollTop = scrollContainer.scrollHeight;
			}
		}, 50);
	}

	async function pollForDaemonResponse(sessionId: string) {
		for (let attempt = 0; attempt < 20; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 2000));
			const res = await fetch(`/api/agent/${agentId}/chat?sessionId=${sessionId}`);
			if (!res.ok) continue;

			const data = await res.json();
			if (!data.success || !Array.isArray(data.messages) || data.messages.length === 0) continue;

			messages = data.messages.map((m: any) => ({
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
			}));
			scrollToBottom();

			if (data.messages[data.messages.length - 1]?.role === 'model') return;
		}

		messages.push({
			id: Math.random().toString(36).substring(7),
			role: 'system',
			content: 'Hermes daemon has not responded yet. Confirm the daemon worker is running.',
			timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		});
	}

	async function handleSend(e: Event) {
		e.preventDefault();
		if (!inputValue.trim() || loading) return;

		const userText = inputValue;
		inputValue = '';
		loading = true;

		// Push user message immediately
		messages.push({
			id: Math.random().toString(36).substring(7),
			role: 'user',
			content: userText,
			timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		});
		scrollToBottom();

		try {
			const res = await fetch(`/api/agent/${agentId}/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: userText,
					sessionId: activeSessionId
				})
			});

			const data = (await res.json()) as any;

			if (res.ok && data.success) {
				if (!activeSessionId && data.sessionId) {
					activeSessionId = data.sessionId;
				}
				if (data.queued && data.sessionId) {
					await pollForDaemonResponse(data.sessionId);
					return;
				}
				messages.push({
					id: Math.random().toString(36).substring(7),
					role: 'agent',
					content: data.response,
					timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
					toolCalls: data.toolCalls || []
				});
			} else {
				showToast(data.error || 'Failed to get response', 'error');
				messages.push({
					id: Math.random().toString(36).substring(7),
					role: 'system',
					content: `Connection failed: ${data.error || 'Unable to reach agent'}`,
					timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
				});
			}
		} catch (err) {
			console.error('Chat error:', err);
			showToast('API network connection error', 'warning');
		} finally {
			loading = false;
			scrollToBottom();
		}
	}

	async function clearHistory() {
		if (confirm('Clear chat history?')) {
			initializeChat();
			const userId = $page.data.user?.id || 'guest';
			if (activeSessionId) {
				localStorage.removeItem(`personagen_chat_session_${userId}_${agentId}_${activeSessionId}`);
			}
			localStorage.removeItem(`personagen_chat_session_${userId}_${agentId}`);
			try {
				const url = activeSessionId
					? `/api/agent/${agentId}/chat?sessionId=${activeSessionId}`
					: `/api/agent/${agentId}/chat`;
				const res = await fetch(url, {
					method: 'DELETE'
				});
				if (!res.ok) {
					const data = await res.json();
					showToast(data.error || 'Failed to clear history on server', 'warning');
				}
			} catch (err) {
				console.error('Error clearing chat history on server:', err);
				showToast('Network error while clearing server history', 'warning');
			}
		}
	}
</script>

<!-- Floating Chat Trigger -->
<button
	class="chat-trigger"
	onclick={() => {
		chatOpen = !chatOpen;
		if (chatOpen) {
			isMaximized = typeof window !== 'undefined' ? window.innerWidth > 768 : false;
		}
		scrollToBottom();
	}}
	aria-label="Chat with agent"
>
	<div class="trigger-avatar" style="background: {agentGradient}">
		{agentInitial}
	</div>
	<span class="trigger-ping"></span>
	<svg
		width="20"
		height="20"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
	</svg>
</button>

<!-- Chat Window -->
{#if chatOpen}
	{#if isMaximized}
		<button
			class="chat-backdrop"
			onclick={() => {
				isMaximized = false;
				scrollToBottom();
			}}
			aria-label="Restore chat size"
		></button>
	{/if}
	<div class="chat-window glass-card" class:maximized={isMaximized}>
		<!-- Header -->
		<header class="chat-header" style="--agent-grad: {agentGradient}">
			<div class="agent-avatar" style="background: {agentGradient}">
				{agentInitial}
			</div>
			<div class="chat-header-info">
				<h4>{agentName}</h4>
				<span class="chat-status-indicator">
					<span class="status-pulse"></span> Active UGC Agent
				</span>
			</div>
			<div class="chat-header-actions">
				<button onclick={clearHistory} class="btn-icon" title="Clear history">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						><path
							d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
						/></svg
					>
				</button>
				<button
					onclick={() => {
						isMaximized = !isMaximized;
						scrollToBottom();
					}}
					class="btn-icon"
					title={isMaximized ? 'Restore' : 'Maximize'}
				>
					{#if isMaximized}
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
							<polyline points="4 14 10 14 10 20" />
							<polyline points="20 10 14 10 14 4" />
							<line x1="14" y1="10" x2="21" y2="3" />
							<line x1="10" y1="14" x2="3" y2="20" />
						</svg>
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
						>
							<polyline points="15 3 21 3 21 9" />
							<polyline points="9 21 3 21 3 15" />
							<line x1="21" y1="3" x2="14" y2="10" />
							<line x1="3" y1="21" x2="10" y2="14" />
						</svg>
					{/if}
				</button>
				<button
					onclick={() => {
						chatOpen = false;
						isMaximized = false;
					}}
					class="btn-icon"
					title="Minimize"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
					>
				</button>
			</div>
		</header>

		<!-- Thread -->
		<div class="chat-thread" bind:this={scrollContainer}>
			{#each messages as msg (msg.id)}
				<div class="chat-bubble-row {msg.role}">
					{#if msg.role === 'agent'}
						<div class="bubble-avatar" style="background: {agentGradient}">
							{agentInitial}
						</div>
					{/if}
					<div class="bubble-content-wrap">
						<div class="chat-bubble">
							<div class="bubble-text">{@html renderMarkdown(msg.content)}</div>

							<!-- Tool Calls Display -->
							{#if msg.toolCalls && msg.toolCalls.length > 0}
								<div class="tool-calls-container">
									<div class="tool-calls-header">
										<svg
											width="12"
											height="12"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											><path
												d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"
											/></svg
										>
										Executed Tool Trace ({msg.toolCalls.length})
									</div>
									{#each msg.toolCalls as call}
										<div class="tool-call-badge" class:failed={call.status === 'failed'}>
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
						</div>
						<span class="bubble-ts">{msg.timestamp}</span>
					</div>
				</div>
			{/each}

			{#if loading}
				<div class="chat-bubble-row agent">
					<div class="bubble-avatar" style="background: {agentGradient}">
						{agentInitial}
					</div>
					<div class="bubble-content-wrap">
						<div class="chat-bubble loading-bubble">
							<span class="dot"></span>
							<span class="dot"></span>
							<span class="dot"></span>
						</div>
					</div>
				</div>
			{/if}
		</div>

		<!-- Input Form -->
		<form onsubmit={handleSend} class="chat-input-form">
			<Input
				type="text"
				bind:value={inputValue}
				placeholder="Type a message or request tool..."
				disabled={loading}
				autocomplete="off"
				class="chat-input-field"
			/>
			<Button
				type="submit"
				disabled={loading || !inputValue.trim()}
				variant="primary"
				class="chat-submit-button"
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<line x1="22" y1="2" x2="11" y2="13" /><polyline points="22 2 15 22 11 13 2 9 22 2" />
				</svg>
			</Button>
		</form>
	</div>
{/if}

<style>
	/* Trigger */
	.chat-trigger {
		position: fixed;
		bottom: 2rem;
		right: 2rem;
		width: 60px;
		height: 60px;
		border-radius: 50%;
		border: 1px solid var(--border-strong);
		background: color-mix(in srgb, var(--surface) 85%, transparent);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		color: var(--text);
		cursor: pointer;
		box-shadow:
			0 10px 30px rgba(0, 0, 0, 0.15),
			0 0 20px rgba(124, 106, 237, 0.15);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
		z-index: 1000;
	}

	.chat-trigger:hover {
		transform: scale(1.08) translateY(-3px);
	}

	.trigger-avatar {
		position: absolute;
		top: -5px;
		left: -5px;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.65rem;
		font-weight: 800;
		border: 2px solid var(--bg);
	}

	.trigger-ping {
		position: absolute;
		top: 0;
		right: 0;
		width: 10px;
		height: 10px;
		background: var(--success);
		border-radius: 50%;
		border: 2px solid var(--bg);
		animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
	}

	@keyframes ping {
		75%,
		100% {
			transform: scale(2);
			opacity: 0;
		}
	}

	/* Backdrop */
	.chat-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 999;
		border: none;
		cursor: default;
		animation: fadeIn 0.2s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	/* Chat window */
	.chat-window {
		position: fixed;
		bottom: 6.5rem;
		right: 2rem;
		width: 380px;
		height: 520px;
		background: color-mix(in srgb, var(--surface) 93%, transparent);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-lg);
		box-shadow:
			0 20px 50px rgba(0, 0, 0, 0.25),
			0 0 0 1px rgba(255, 255, 255, 0.05) inset;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		z-index: 1000;
		transform: translate(0, 0);
		transition:
			width 0.35s cubic-bezier(0.16, 1, 0.3, 1),
			height 0.35s cubic-bezier(0.16, 1, 0.3, 1),
			bottom 0.35s cubic-bezier(0.16, 1, 0.3, 1),
			right 0.35s cubic-bezier(0.16, 1, 0.3, 1),
			transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
		animation: chatOpenNormal 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.chat-window.maximized {
		width: 1150px;
		height: 820px;
		max-width: calc(100vw - 4rem);
		max-height: calc(100vh - 6rem);
		bottom: 50%;
		right: 50%;
		transform: translate(50%, 50%);
		box-shadow:
			0 30px 70px rgba(0, 0, 0, 0.35),
			0 0 0 1px rgba(255, 255, 255, 0.08) inset;
		animation: chatOpenMaximized 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes chatOpenNormal {
		from {
			opacity: 0;
			transform: translateY(20px) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@keyframes chatOpenMaximized {
		from {
			opacity: 0;
			transform: translate(50%, calc(50% + 20px)) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translate(50%, 50%) scale(1);
		}
	}

	/* Header */
	.chat-header {
		padding: 1.2rem;
		background: linear-gradient(to right, var(--surface), var(--surface-2));
		border-bottom: 1px solid var(--border);
		display: flex;
		align-items: center;
		gap: 0.75rem;
		position: relative;
	}

	.chat-header::after {
		content: '';
		position: absolute;
		bottom: -1px;
		left: 0;
		right: 0;
		height: 1px;
		background: var(--agent-grad);
		opacity: 0.3;
	}

	.agent-avatar {
		width: 38px;
		height: 38px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.9rem;
		color: #fff;
		font-family: var(--font-display);
	}

	.chat-header-info h4 {
		margin: 0 0 0.15rem 0;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.chat-status-indicator {
		font-size: 0.68rem;
		color: var(--text-dim);
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.status-pulse {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--success);
		animation: pulse 1.8s infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	.chat-header-actions {
		margin-left: auto;
		display: flex;
		gap: 6px;
	}

	.btn-icon {
		background: transparent;
		border: none;
		color: var(--text-dim);
		cursor: pointer;
		width: 24px;
		height: 24px;
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}

	.btn-icon:hover {
		color: var(--text);
		background: rgba(255, 255, 255, 0.05);
	}

	/* Thread */
	.chat-thread {
		flex: 1;
		overflow-y: auto;
		padding: 1.2rem;
		display: flex;
		flex-direction: column;
		gap: 1.2rem;
		scrollbar-width: thin;
	}

	.chat-bubble-row {
		display: flex;
		gap: 0.65rem;
		max-width: 85%;
	}

	.chat-bubble-row.user {
		align-self: flex-end;
		flex-direction: row-reverse;
	}

	.bubble-avatar {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.62rem;
		font-weight: 800;
		color: #fff;
		margin-top: 2px;
		flex-shrink: 0;
	}

	.bubble-content-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.chat-bubble {
		padding: 0.8rem 1rem;
		border-radius: 14px;
		font-size: 0.82rem;
		line-height: 1.5;
		word-break: break-word;
		overflow-wrap: break-word;
	}

	.user .chat-bubble {
		background: var(--accent);
		color: #fff;
		border-top-right-radius: 2px;
	}

	.agent .chat-bubble {
		background: var(--surface-2);
		color: var(--text);
		border-top-left-radius: 2px;
		border: 1px solid var(--border);
	}

	.system .chat-bubble {
		background: var(--error-soft);
		color: var(--error);
		border: 1px solid rgba(239, 68, 68, 0.2);
		align-self: center;
		border-radius: var(--radius-sm);
	}

	.bubble-text {
		margin: 0;
		white-space: normal;
		word-break: break-word;
		overflow-wrap: break-word;
	}

	/* Markdown styles in bubble */
	.bubble-text :global(p) { margin: 0 0 0.35rem 0; }
	.bubble-text :global(p:last-child) { margin-bottom: 0; }
	.bubble-text :global(.md-h1),
	.bubble-text :global(.md-h2),
	.bubble-text :global(.md-h3),
	.bubble-text :global(.md-h4),
	.bubble-text :global(.md-h5),
	.bubble-text :global(.md-h6) { margin: 0.15rem 0 0.3rem 0; font-weight: 700; color: var(--accent); }
	.bubble-text :global(.md-h1) { font-size: 1.05rem; }
	.bubble-text :global(.md-h2) { font-size: 0.95rem; }
	.bubble-text :global(.md-h3) { font-size: 0.88rem; }
	.bubble-text :global(.md-h4) { font-size: 0.82rem; }
	.bubble-text :global(.md-ul),
	.bubble-text :global(.md-ol) { margin: 0 0 0.4rem 0; padding-left: 1.1rem; }
	.bubble-text :global(.md-ul li),
	.bubble-text :global(.md-ol li) { font-size: 0.78rem; line-height: 1.45; color: var(--text-muted); margin-bottom: 0.15rem; }
	.bubble-text :global(.md-inline-code) { background: rgba(124,106,237,0.12); color: var(--accent); padding: 1px 4px; border-radius: 3px; font-family: var(--font-mono); font-size: 0.8em; }
	.bubble-text :global(.md-code-block) { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem 0.75rem; margin: 0.3rem 0; overflow-x: auto; font-size: 0.72rem; font-family: var(--font-mono); color: var(--text-muted); }
	.bubble-text :global(.md-code-block code) { background: none; padding: 0; color: inherit; }
	.bubble-text :global(.md-hr) { border: none; border-top: 1px solid var(--border); margin: 0.4rem 0; }
	.bubble-text :global(strong) { font-weight: 700; color: var(--text); }
	.bubble-text :global(em) { font-style: italic; color: var(--text-muted); }

	.bubble-ts {
		font-size: 0.65rem;
		color: var(--text-dim);
		margin: 0 4px;
	}

	.user .bubble-content-wrap {
		align-items: flex-end;
	}

	/* Tool Trace */
	.tool-calls-container {
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border-strong);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.tool-calls-header {
		font-size: 0.68rem;
		font-weight: 700;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.tool-call-badge {
		background: var(--bg);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-xs);
		padding: 6px 8px;
		font-size: 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.tool-call-badge.failed {
		border-color: rgba(239, 68, 68, 0.3);
	}

	.tool-name {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--text);
	}

	.tool-args {
		margin: 0;
		padding: 4px;
		background: rgba(255, 255, 255, 0.02);
		border-radius: 3px;
		font-size: 0.65rem;
		overflow-x: auto;
		font-family: var(--font-mono);
		color: var(--text-muted);
	}

	.tool-status {
		font-size: 0.65rem;
		font-weight: 600;
		align-self: flex-end;
	}

	.tool-status.success {
		color: var(--success);
	}

	.tool-status.fail {
		color: var(--rose);
	}

	/* Typing dots */
	.loading-bubble {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0.8rem 1.2rem;
	}

	.loading-bubble .dot {
		width: 6px;
		height: 6px;
		background: var(--text-dim);
		border-radius: 50%;
		animation: typing 1.4s infinite;
	}

	.loading-bubble .dot:nth-child(2) {
		animation-delay: 0.2s;
	}
	.loading-bubble .dot:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes typing {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-4px);
		}
	}

	/* Input Form */
	.chat-input-form {
		padding: 1rem;
		border-top: 1px solid var(--border);
		display: flex;
		gap: 0.5rem;
		background: var(--surface);
	}

	.chat-input-form :global(.chat-input-field) {
		flex: 1;
		font-size: 0.82rem;
		padding: 10px 14px;
	}

	.chat-input-form :global(.chat-submit-button) {
		width: 38px;
		height: 38px;
		padding: 0;
		flex-shrink: 0;
	}

	@media (max-width: 768px) {
		.chat-window {
			width: calc(100vw - 2rem);
			right: 1rem;
			bottom: 6rem;
			height: 500px;
		}

		.chat-window.maximized {
			width: calc(100vw - 2rem);
			height: calc(100vh - 8rem);
			max-width: none;
			max-height: none;
			bottom: 6rem;
			right: 1rem;
			transform: none;
			animation: chatOpenNormal 0.3s cubic-bezier(0.16, 1, 0.3, 1);
		}

		.chat-trigger {
			right: 1rem;
			bottom: 1.5rem;
		}
	}
</style>
