<script lang="ts">
	import { showToast } from '$lib/stores/ui.svelte';
	import { invalidateAll } from '$app/navigation';
	// The app's own confirmation, not the browser's: a native confirm() can't
	// show WHICH key or WHICH request is about to fire, and this page's two
	// prompts guard the most expensive mistakes in the product.
	import { confirmAction } from '$lib/stores/confirm.svelte';
	import PageShell from '$lib/components/ui/PageShell.svelte';

	let { data } = $props();

	let tab = $state<'keys' | 'reference' | 'console'>('keys');
	let keys = $derived((data as any).keys ?? []);

	// ── Plan gate ─────────────────────────────────────────────────────────────
	// POST /api/developer/keys refuses with 403 PLAN_FEATURE when the plan has no
	// API access, and until now nothing here read that — so the refusal landed on
	// a button that still looked enabled. Mirror the server's ONE gated door:
	// minting. Listing and revoking stay open on every plan, deliberately, so a
	// plan change never strands a key the user cannot see or turn off.
	//
	// Reason-or-null: an absent/permissive entitlement resolves to null, which is
	// how a database blip or an unmigrated catalog can never lock this button.
	let entitlements = $derived(
		(data as any).entitlements as { plan?: string; apiAccess?: boolean } | undefined
	);
	let createKeyBlockedReason = $derived(
		entitlements?.apiAccess === false
			? `API access is not included in the ${entitlements?.plan ?? 'free'} plan. See Billing to compare plans.`
			: null
	);

	// ── API keys ──────────────────────────────────────────────────────────────
	let newLabel = $state('');
	let creating = $state(false);
	let freshKey = $state<string | null>(null); // shown once, right after creation

	async function createKey() {
		if (!newLabel.trim()) return showToast('Give the key a label first', 'warning');
		creating = true;
		try {
			const res = await fetch('/api/developer/keys', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: newLabel.trim() })
			});
			const result = await res.json();
			if (!result.success) throw new Error(result.error || 'Failed to create key');
			freshKey = result.plaintext;
			newLabel = '';
			await invalidateAll();
		} catch (err) {
			showToast((err as Error).message, 'error');
		} finally {
			creating = false;
		}
	}

	async function revokeKey(id: string) {
		// A revoke can't be undone — the plaintext was only ever shown once, so
		// "revoked by mistake" means minting a new key and redeploying whatever
		// used it. Hence tone 'danger', and the preview names the key so you can
		// see you're killing the controller you meant to.
		const row = keys.find((k: { id: string }) => k.id === id);
		const ok = await confirmAction({
			title: 'Revoke this key?',
			body: 'Anything using it stops working immediately.',
			preview: row
				? [
						{
							label: row.label,
							meta: `${row.key_prefix}…`,
							initial: 'K',
							gradient: 'linear-gradient(135deg, #dc2626, #f97316)'
						}
				  ]
				: undefined,
			tone: 'danger',
			confirmLabel: 'Revoke'
		});
		if (!ok) return;
		try {
			const res = await fetch('/api/developer/keys', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			const result = await res.json();
			if (!result.success) throw new Error(result.error || 'Failed to revoke');
			showToast('Key revoked', 'success');
			await invalidateAll();
		} catch (err) {
			showToast((err as Error).message, 'error');
		}
	}

	function copy(text: string) {
		navigator.clipboard?.writeText(text).then(
			() => showToast('Copied', 'success'),
			() => showToast('Copy failed — select and copy manually', 'error')
		);
	}

	// ── Endpoint reference ──────────────────────────────────────────────────────
	interface Endpoint {
		method: string;
		path: string;
		role: string;
		summary: string;
		body?: Record<string, unknown>;
	}
	interface Group {
		name: string;
		note?: string;
		endpoints: Endpoint[];
	}
	const GROUPS: Group[] = [
		{
			name: 'Auth',
			note: 'Get a session token, then send it as Authorization: Bearer <token> — or use an API key from the Keys tab (recommended for a controller).',
			endpoints: [
				{
					method: 'POST',
					path: '/api/auth/login',
					role: 'public',
					summary: 'Exchange email + password for a session (access_token + refresh_token).',
					body: { email: data.viewerEmail ?? 'you@example.com', password: '••••••••' }
				}
			]
		},
		{
			name: 'Personas',
			endpoints: [
				{
					method: 'POST',
					path: '/api/agents',
					role: 'owner',
					summary: 'Create a persona (also seeds its default config row).',
					body: { name: 'Sofia Rivera', niche: 'Fitness & Wellness', handle: '@sofiarivera.ai' }
				},
				{
					method: 'POST',
					path: '/api/agents/config',
					role: 'creator+',
					summary: 'Configure a persona — bake in voice/soul/brand. Only fields you send change.',
					body: { agentId: '<persona-uuid>', soulText: 'Warm, punchy wellness POV…', ugcVoice: '' }
				}
			]
		},
		{
			name: 'Generation',
			note: 'Async — returns 202 with a post id and status "generating". Poll /api/posts {action:"get"} until status leaves "generating". Use preview:true to price a run without spending.',
			endpoints: [
				{
					method: 'POST',
					path: '/api/agent/<persona-uuid>/generate-post',
					role: 'creator+',
					summary: 'Generate a post. preview:true prices & plans it, spends nothing.',
					body: { media: 'video', platforms: ['instagram'], topic: '', preview: true }
				}
			]
		},
		{
			name: 'Posts',
			note: 'One POST switched on "action". Setting a publish-adjacent status needs manager+.',
			endpoints: [
				{
					method: 'POST',
					path: '/api/posts',
					role: 'viewer+',
					summary: 'Read a single post — the poll target after a generate.',
					body: { action: 'get', id: '<post-uuid>' }
				},
				{
					method: 'POST',
					path: '/api/posts',
					role: 'viewer+',
					summary: 'List posts, optionally for one persona.',
					body: { action: 'list', agent_id: '<persona-uuid>' }
				},
				{
					method: 'POST',
					path: '/api/posts',
					role: 'creator+',
					summary: 'Create a draft post.',
					body: {
						action: 'create',
						post: { agent_id: '<persona-uuid>', content: 'Caption…', platforms: ['instagram'], status: 'draft' }
					}
				},
				{
					method: 'POST',
					path: '/api/posts',
					role: 'manager+',
					summary: 'Approve/schedule a post (manager+).',
					body: { action: 'update', id: '<post-uuid>', status: 'scheduled', scheduled_date: '2026-09-10', scheduled_time: '09:00' }
				}
			]
		},
		{
			name: 'Publishing',
			endpoints: [
				{
					method: 'POST',
					path: '/api/agent/<persona-uuid>/publish-post',
					role: 'manager+',
					summary: 'Publish a post now (live to connected accounts).',
					body: { post_id: '<post-uuid>' }
				},
				{
					method: 'POST',
					path: '/api/accounts',
					role: 'viewer+ / manager+',
					summary: 'Connection ops: check_status (viewer+), initiate_connection / disconnect / sync_zernio (manager+).',
					body: { action: 'check_status', persona_id: '<persona-uuid>' }
				}
			]
		},
		{
			name: 'Workspaces & seats',
			endpoints: [
				{ method: 'GET', path: '/api/workspaces', role: 'authed', summary: 'Owned workspaces, memberships, pending invites.' },
				{ method: 'POST', path: '/api/workspaces/<id>/invites', role: 'owner/admin', summary: 'Invite a teammate by email + role.', body: { email: 'teammate@example.com', role: 'creator' } },
				{ method: 'GET', path: '/api/workspaces/<id>/personas', role: 'member', summary: 'Personas in the workspace + your available ones.' }
			]
		}
	];

	// ── Test console (safe by default) ──────────────────────────────────────────
	let cMethod = $state('POST');
	let cPath = $state('/api/workspaces');
	let cBody = $state('{}');
	let safeMode = $state(true);
	let running = $state(false);
	let cStatus = $state<number | null>(null);
	let cResponse = $state('');

	function loadIntoConsole(ep: Endpoint) {
		cMethod = ep.method;
		cPath = ep.path;
		cBody = ep.body ? JSON.stringify(ep.body, null, 2) : '{}';
		tab = 'console';
		cStatus = null;
		cResponse = '';
	}

	/** Returns a warning string if this call is paid/destructive, else null. */
	function riskOf(path: string, parsed: any): { kind: string; msg: string } | null {
		if (/\/generate-(post|avatar|reference-kit)|\/refine-post/.test(path))
			return { kind: 'paid', msg: 'This spends money (real generation).' };
		if (/\/publish-post/.test(path)) return { kind: 'publish', msg: 'This publishes live to connected accounts.' };
		const action = parsed?.action;
		if (['delete', 'delete_many', 'purge', 'purge_all'].includes(action))
			return { kind: 'destructive', msg: 'This deletes real data.' };
		if (path.endsWith('/api/posts') && ['scheduled', 'publishing', 'published'].includes(parsed?.status))
			return { kind: 'publish', msg: 'This schedules/publishes a post.' };
		return null;
	}

	async function runConsole() {
		let parsed: any = undefined;
		if (cMethod !== 'GET' && cBody.trim()) {
			try {
				parsed = JSON.parse(cBody);
			} catch {
				return showToast('Body is not valid JSON', 'error');
			}
		}

		const risk = riskOf(cPath, parsed);
		if (risk && safeMode) {
			if (risk.kind === 'paid' && /\/generate-post/.test(cPath)) {
				// Safe mode: force a priced-but-free preview instead of blocking outright.
				parsed = { ...(parsed || {}), preview: true };
				cBody = JSON.stringify(parsed, null, 2);
				showToast('Safe mode: forced preview:true (prices it, spends nothing)', 'success');
			} else {
				return showToast(`Safe mode blocked this — ${risk.msg} Turn Safe mode off to run it.`, 'warning');
			}
		}
		if (risk && !safeMode) {
			// Safe mode is off, so this fires at production as the logged-in user.
			// 'paid' only spends money; 'publish' and 'destructive' can't be taken
			// back at all (Instagram in particular has no delete API), so those
			// get the danger tone. The preview echoes the exact request line —
			// the thing a native confirm() could never show.
			const ok = await confirmAction({
				title: 'Run it for real against production?',
				body: risk.msg,
				preview: [
					{
						label: `${cMethod} ${cPath}`,
						meta: 'Live production · as your current login',
						badge: risk.kind,
						initial: cMethod.charAt(0),
						gradient:
							risk.kind === 'paid'
								? 'linear-gradient(135deg, #d97706, #f59e0b)'
								: 'linear-gradient(135deg, #dc2626, #f97316)'
					}
				],
				tone: risk.kind === 'paid' ? 'caution' : 'danger',
				confirmLabel: 'Run it'
			});
			if (!ok) return;
		}

		running = true;
		cStatus = null;
		cResponse = '';
		try {
			const res = await fetch(cPath, {
				method: cMethod,
				headers: { 'Content-Type': 'application/json' },
				...(cMethod !== 'GET' ? { body: JSON.stringify(parsed ?? {}) } : {})
			});
			cStatus = res.status;
			const text = await res.text();
			try {
				cResponse = JSON.stringify(JSON.parse(text), null, 2);
			} catch {
				cResponse = text;
			}
		} catch (err) {
			cResponse = `Request failed: ${(err as Error).message}`;
		} finally {
			running = false;
		}
	}
</script>

<PageShell
	title="Developer API"
	description="Drive PersonaGen programmatically — provision personas, generate content, and publish from your own controller. The full written reference lives in docs/API.md; this page is the live version with runnable examples."
>
	<div class="dev-page">

	<div class="dev-tabs" role="tablist">
		<button role="tab" class="dev-tab" class:active={tab === 'keys'} onclick={() => (tab = 'keys')}>API Keys</button>
		<button role="tab" class="dev-tab" class:active={tab === 'reference'} onclick={() => (tab = 'reference')}>Endpoints</button>
		<button role="tab" class="dev-tab" class:active={tab === 'console'} onclick={() => (tab = 'console')}>Test Console</button>
	</div>

	{#if tab === 'keys'}
		<section class="dev-card">
			<h2>API keys</h2>
			<p class="dev-hint">
				A key authenticates as <strong>you</strong> — it inherits your workspace role, so an
				admin's key can publish and a creator's key can only draft. Send it on every request as
				<code>Authorization: Bearer pg_live_…</code>. Store it like a password; we only ever show it
				once.
			</p>

			{#if freshKey}
				<div class="fresh-key">
					<div class="fresh-key-label">Your new key — copy it now, it won't be shown again:</div>
					<div class="fresh-key-row">
						<code>{freshKey}</code>
						<button class="dev-btn" onclick={() => copy(freshKey!)}>Copy</button>
					</div>
					<button class="dev-link" onclick={() => (freshKey = null)}>Done</button>
				</div>
			{/if}

			<div class="key-create">
				<input
					type="text"
					placeholder="Label (e.g. Monarch controller)"
					bind:value={newLabel}
					maxlength="120"
					disabled={createKeyBlockedReason !== null}
					title={createKeyBlockedReason ?? undefined}
				/>
				<button
					class="dev-btn primary"
					onclick={createKey}
					disabled={creating || !newLabel.trim() || createKeyBlockedReason !== null}
					title={createKeyBlockedReason ?? undefined}
				>
					{creating ? 'Creating…' : 'Create key'}
				</button>
			</div>
			{#if createKeyBlockedReason}
				<p class="dev-hint plan-note">{createKeyBlockedReason}</p>
			{/if}

			{#if keys.length > 0}
				<table class="key-table">
					<thead>
						<tr><th>Label</th><th>Key</th><th>Last used</th><th>Status</th><th></th></tr>
					</thead>
					<tbody>
						{#each keys as k (k.id)}
							<tr class:revoked={!!k.revoked_at}>
								<td>{k.label}</td>
								<td><code>{k.key_prefix}…</code></td>
								<td>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}</td>
								<td>{k.revoked_at ? 'revoked' : 'active'}</td>
								<td>
									{#if !k.revoked_at}
										<button class="dev-link danger" onclick={() => revokeKey(k.id)}>Revoke</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<p class="dev-hint">No keys yet.</p>
			{/if}
		</section>
	{:else if tab === 'reference'}
		{#each GROUPS as group (group.name)}
			<section class="dev-card">
				<h2>{group.name}</h2>
				{#if group.note}<p class="dev-hint">{group.note}</p>{/if}
				{#each group.endpoints as ep (ep.method + ep.path + ep.summary)}
					<div class="ep">
						<div class="ep-line">
							<span class="ep-method ep-{ep.method.toLowerCase()}">{ep.method}</span>
							<code class="ep-path">{ep.path}</code>
							<span class="ep-role">{ep.role}</span>
							<button class="dev-link ep-try" onclick={() => loadIntoConsole(ep)}>Try it →</button>
						</div>
						<p class="ep-summary">{ep.summary}</p>
						{#if ep.body}
							<pre class="ep-body">{JSON.stringify(ep.body, null, 2)}</pre>
						{/if}
					</div>
				{/each}
			</section>
		{/each}
	{:else}
		<section class="dev-card">
			<h2>Test console</h2>
			<p class="dev-hint">
				Runs against live production as your current login. <strong>Safe mode</strong> forces
				generation to <code>preview:true</code> (prices it, spends nothing) and blocks
				publish/delete — turn it off to fire those for real.
			</p>

			<label class="safe-toggle">
				<input type="checkbox" bind:checked={safeMode} />
				Safe mode {safeMode ? 'on' : 'off'}
			</label>

			<div class="console-row">
				<select bind:value={cMethod} class="console-method">
					<option>GET</option><option>POST</option><option>PATCH</option><option>DELETE</option>
				</select>
				<input class="console-path" bind:value={cPath} spellcheck="false" />
				<button class="dev-btn primary" onclick={runConsole} disabled={running}>
					{running ? 'Sending…' : 'Send'}
				</button>
			</div>

			{#if cMethod !== 'GET'}
				<label class="console-label" for="console-body">Request body (JSON)</label>
				<textarea id="console-body" class="console-body" bind:value={cBody} spellcheck="false" rows="8"></textarea>
			{/if}

			{#if cStatus !== null}
				<div class="console-result">
					<div class="console-status" class:ok={cStatus < 400} class:err={cStatus >= 400}>
						HTTP {cStatus}
					</div>
					<pre class="console-response">{cResponse}</pre>
				</div>
			{/if}
		</section>
	{/if}
</PageShell>

<style>
	.dev-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.dev-tabs {
		display: flex;
		gap: 0.4rem;
		border-bottom: 1px solid var(--border);
	}
	.dev-tab {
		background: none;
		border: none;
		padding: 0.6rem 1rem;
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text-muted);
		cursor: pointer;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}
	.dev-tab.active {
		color: var(--accent-text);
		border-bottom-color: var(--accent);
	}
	.dev-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}
	.dev-card h2 {
		font-size: 1.15rem;
		color: var(--text);
	}
	.dev-hint {
		font-size: 0.9rem;
		color: var(--text-muted);
		line-height: 1.5;
	}
	/* Why the Create-key button is off — sits under the create row, not over it. */
	.dev-hint.plan-note {
		margin: 0.5rem 0 0;
		font-size: 0.85rem;
	}
	.dev-hint code,
	.dev-head code {
		background: var(--surface-2);
		padding: 0.05rem 0.35rem;
		border-radius: 4px;
		font-size: 0.85em;
	}
	.dev-btn {
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		color: var(--text);
		border-radius: 8px;
		padding: 0.5rem 0.9rem;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
	.dev-btn.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}
	.dev-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.dev-link {
		background: none;
		border: none;
		color: var(--accent-text);
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
		padding: 0;
	}
	.dev-link.danger {
		color: var(--error-text, #dc2626);
	}
	/* Keys */
	.fresh-key {
		background: var(--accent-soft);
		border: 1px solid var(--accent);
		border-radius: 10px;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.fresh-key-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text);
	}
	.fresh-key-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.fresh-key-row code {
		flex: 1;
		background: var(--surface);
		padding: 0.5rem 0.7rem;
		border-radius: 6px;
		font-size: 0.85rem;
		word-break: break-all;
	}
	.key-create {
		display: flex;
		gap: 0.5rem;
	}
	.key-create input {
		flex: 1;
		padding: 0.55rem 0.7rem;
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		color: var(--text);
	}
	.key-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.88rem;
	}
	.key-table th {
		text-align: left;
		color: var(--text-muted);
		font-weight: 600;
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--border);
	}
	.key-table td {
		padding: 0.5rem 0.5rem;
		border-bottom: 1px solid var(--border);
		color: var(--text);
	}
	.key-table tr.revoked {
		opacity: 0.5;
	}
	.key-table code {
		font-size: 0.85rem;
	}
	/* Endpoints */
	.ep {
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0.8rem 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.ep-line {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.ep-method {
		font-size: 0.7rem;
		font-weight: 700;
		padding: 0.15rem 0.45rem;
		border-radius: 5px;
		color: #fff;
	}
	.ep-get { background: #2563eb; }
	.ep-post { background: #16a34a; }
	.ep-patch { background: #d97706; }
	.ep-delete { background: #dc2626; }
	.ep-path {
		font-size: 0.9rem;
		color: var(--text);
	}
	.ep-role {
		font-size: 0.72rem;
		color: var(--text-muted);
		background: var(--surface-2);
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
	}
	.ep-try {
		margin-left: auto;
	}
	.ep-summary {
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	.ep-body,
	.console-response {
		background: var(--surface-2);
		border-radius: 8px;
		padding: 0.7rem 0.9rem;
		font-size: 0.82rem;
		overflow-x: auto;
		color: var(--text);
		white-space: pre;
	}
	/* Console */
	.safe-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-muted);
	}
	.console-row {
		display: flex;
		gap: 0.5rem;
	}
	.console-method {
		padding: 0.55rem 0.6rem;
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		color: var(--text);
		font-weight: 600;
	}
	.console-path {
		flex: 1;
		padding: 0.55rem 0.7rem;
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		color: var(--text);
		font-family: var(--font-mono, monospace);
		font-size: 0.88rem;
	}
	.console-label {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--text-muted);
	}
	.console-body {
		width: 100%;
		background: var(--surface-2);
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		padding: 0.7rem 0.9rem;
		color: var(--text);
		font-family: var(--font-mono, monospace);
		font-size: 0.85rem;
		resize: vertical;
	}
	.console-result {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.console-status {
		font-weight: 700;
		font-size: 0.9rem;
	}
	.console-status.ok { color: #16a34a; }
	.console-status.err { color: #dc2626; }
</style>
