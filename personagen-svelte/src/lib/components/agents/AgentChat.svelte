<script lang="ts">
  import { onMount } from 'svelte';
  import { showToast } from '$lib/stores/ui.svelte';

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
  let scrollContainer = $state<HTMLElement | null>(null);

  // Load chat session from localStorage on mount
  onMount(() => {
    const cached = localStorage.getItem(`personagen_chat_session_${agentId}`);
    if (cached) {
      try {
        messages = JSON.parse(cached);
      } catch {
        // start fresh
        initializeChat();
      }
    } else {
      initializeChat();
    }
  });

  // Save messages to localStorage when updated
  $effect(() => {
    if (messages.length > 0) {
      localStorage.setItem(`personagen_chat_session_${agentId}`, JSON.stringify(messages));
    }
  });

  // Watch agentId change
  $effect(() => {
    if (agentId) {
      const cached = localStorage.getItem(`personagen_chat_session_${agentId}`);
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

  async function handleSend(e: Event) {
    e.preventDefault();
    if (!inputValue.trim() || loading) return;

    const userText = inputValue;
    inputValue = '';
    loading = true;

    // Push user message
    messages.push({
      id: Math.random().toString(36).substring(7),
      role: 'user',
      content: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    scrollToBottom();

    try {
      const history = messages.slice(1, -1).map(m => ({
        role: m.role,
        content: m.content
      }));

      const res = await fetch(`/api/agent/${agentId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          history
        })
      });

      const data = (await res.json()) as any;

      if (res.ok && data.success) {
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

  function clearHistory() {
    if (confirm('Clear chat history?')) {
      initializeChat();
      localStorage.removeItem(`personagen_chat_session_${agentId}`);
    }
  }
</script>

<!-- Floating Chat Trigger -->
<button
  class="chat-trigger"
  onclick={() => { chatOpen = !chatOpen; scrollToBottom(); }}
  aria-label="Chat with agent"
>
  <div class="trigger-avatar" style="background: {agentGradient}">
    {agentInitial}
  </div>
  <span class="trigger-ping"></span>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
</button>

<!-- Chat Window -->
{#if chatOpen}
  <div class="chat-window glass-card">
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
        <button onclick={() => chatOpen = false} class="btn-icon" title="Minimize">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
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
              <p class="bubble-text">{msg.content}</p>

              <!-- Tool Calls Display -->
              {#if msg.toolCalls && msg.toolCalls.length > 0}
                <div class="tool-calls-container">
                  <div class="tool-calls-header">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
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
      <input
        type="text"
        bind:value={inputValue}
        placeholder="Type a message or request tool..."
        disabled={loading}
        autocomplete="off"
      />
      <button type="submit" disabled={loading || !inputValue.trim()} aria-label="Send message">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/><polyline points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
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
    border: 1px solid var(--border);
    background: rgba(14, 14, 22, 0.85);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    color: #fff;
    cursor: pointer;
    box-shadow:
      0 10px 30px rgba(0, 0, 0, 0.3),
      0 0 20px rgba(124, 106, 237, 0.2);
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
    75%, 100% { transform: scale(2); opacity: 0; }
  }

  /* Chat window */
  .chat-window {
    position: fixed;
    bottom: 6.5rem;
    right: 2rem;
    width: 380px;
    height: 520px;
    background: rgba(14, 14, 22, 0.9);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow:
      0 20px 50px rgba(0, 0, 0, 0.5),
      0 0 0 1px rgba(255, 255, 255, 0.05) inset;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 1000;
    animation: chatOpenAnim 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes chatOpenAnim {
    from { opacity: 0; transform: translateY(20px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* Header */
  .chat-header {
    padding: 1.2rem;
    background: linear-gradient(to right, rgba(14, 14, 22, 0.95), rgba(25, 25, 38, 0.95));
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
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
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
    white-space: pre-wrap;
  }

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

  .loading-bubble .dot:nth-child(2) { animation-delay: 0.2s; }
  .loading-bubble .dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes typing {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }

  /* Input Form */
  .chat-input-form {
    padding: 1rem;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 0.5rem;
    background: rgba(14, 14, 22, 0.95);
  }

  .chat-input-form input {
    flex: 1;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 14px;
    color: #fff;
    font-size: 0.82rem;
    outline: none;
    transition: border-color 0.2s;
  }

  .chat-input-form input:focus {
    border-color: var(--accent-mid);
  }

  .chat-input-form button {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    border: none;
    background: var(--gradient-subtle);
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s;
  }

  .chat-input-form button:hover:not(:disabled) {
    transform: scale(1.04);
  }

  .chat-input-form button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 480px) {
    .chat-window {
      width: calc(100vw - 2rem);
      right: 1rem;
      bottom: 6rem;
      height: 480px;
    }
    .chat-trigger {
      right: 1rem;
      bottom: 1rem;
    }
  }
</style>
