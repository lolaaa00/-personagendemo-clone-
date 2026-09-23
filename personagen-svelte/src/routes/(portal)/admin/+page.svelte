<script lang="ts">
	import { tick } from 'svelte';
	import { pricingContext } from '$lib/stores/pricing.svelte';
	import { formatCredits } from '$lib/money';
	import { instantShort } from '$lib/datetime';
	import { promptAction, confirmAction } from '$lib/stores/confirm.svelte';
	import { showToast } from '$lib/stores/ui.svelte';
	import PageShell from '$lib/components/ui/PageShell.svelte';
	import { countLabel } from '$lib/plural';
	let { data } = $props();

	type Tab = 'overview' | 'activity' | 'seats' | 'spend' | 'access' | 'platform' | 'controls';
	let tab = $state<Tab>(data.isPlatformAdmin ? 'controls' : 'overview');

	// ── Platform Controls (platform admins only) ─────────────────────────────
	type Switches = {
		credits_mode: { effective: 'off' | 'shadow' | 'enforce'; stored: string; source: 'env' | 'database' | 'default' };
		activity_log: { effective: boolean; stored: boolean; source: 'env' | 'database' };
		activity_pepper: { set: boolean; source: 'env' | 'database' };
		signup_credits: { stored: number; usd: string };
		credit_markup: { effective: number; stored: number; source: 'env' | 'database' | 'default' };
		daily_platform_spend_usd: { stored: number };
		signup_credits_hourly_cap: { stored: number };
		signup_credits_require_invite: { stored: boolean };
		plans_enabled: { stored: boolean };
		video_ingest: { effective: boolean; stored: boolean; source: 'env' | 'database' | 'default' };
		persona_generator: { effective: 'v1' | 'v2'; stored: string; source: 'env' | 'database' | 'default' };
		persona_backbone: { effective: 'off' | 'shadow' | 'fill' | 'on'; stored: string; source: 'env' | 'database' | 'default' };
		display_currency_default: { stored: string; supported: string[] };
		fx_rates: { base: string; count: number; updated_at: string | null; source: string | null; sample: Array<{ currency: string; rate: number | null }> };
	};
	let signupCreditsDraft = $state<number | null>(null);
	let markupDraft = $state<number | null>(null);
	let ceilingDraft = $state<number | null>(null);
	let hourlyCapDraft = $state<number | null>(null);
	let controls = $state<{
		switches: Switches;
		cache: { primed: boolean; lastRefreshAt: string | null; lastError: string | null; updatedAt: Record<string, string> };
		migrations: { pending: string[] | null; applied: number; total: number };
		activity: { enabled: boolean; queued: number; flushed: number; dropped: number; lastError: string | null; lastFlushAt: string | null };
		posture?: {
			admission: {
				anonSignup: 'open' | 'closed' | 'unverified';
				routePin: 'set' | 'unset';
				open: boolean;
				checkedAt: string | null;
				note: string | null;
			};
		};
		providerBalance?: {
			provider: string;
			state: 'ok' | 'low' | 'unknown';
			remainingUsd: number | null;
			postsRemaining: number | null;
			imagePostsRemaining: number | null;
			lowThresholdUsd: number;
			emptyThresholdUsd: number;
			checkedAt: string | null;
			note: string | null;
		};
		falBalance?: {
			provider: string;
			/** 'unconfigured' means nobody is watching it — never fold that into 'ok'. */
			state: 'ok' | 'low' | 'unknown' | 'unconfigured';
			remainingUsd: number | null;
			currency: string | null;
			postsRemaining: number | null;
			imagePostsRemaining: number | null;
			lowThresholdUsd: number;
			emptyThresholdUsd: number;
			checkedAt: string | null;
			note: string | null;
		};
		topupRequests?: Array<{ id: string; title: string; description: string | null; created_at: string; user_id: string }>;
		problemReports?: Array<{ id: string; title: string; description: string | null; created_at: string; user_id: string }>;
		signInHelp?: Array<{ id: string; title: string; description: string | null; created_at: string; user_id: string }>;
		platformKeys?: Array<{
			id: string;
			label: string;
			envVar: string;
			configured: boolean;
			costProvider: string | null;
			lastUsedAt: string | null;
			events30d: number;
			problem: string | null;
		}>;
		history: Array<{ key: string; old_value: any; new_value: any; changed_by: string | null; note: string | null; changed_at: string }>;
	} | null>(null);
	let controlsLoading = $state(false);
	let controlsError = $state<string | null>(null);
	let controlsBusy = $state(false);

	/** Ledger credits actually debited, in the viewer's currency (priced on the server too). */
	function charged(credits: number): string {
		const c = pricingContext();
		return formatCredits(credits, c.currency, c.fx, c.locale, { whole: false });
	}

	/** Mark a top-up (loaded) or a problem report (dealt with) as handled. */
	let closingTicket = $state<string | null>(null);
	let requestNotice = $state('');
	async function closeRequest(id: string) {
		if (closingTicket) return;
		// Move focus to a heading that survives the section's removal BEFORE the
		// request: the pressed button (and, for the last ticket, its whole
		// section) is about to disappear, and a focus call after the fact found
		// nothing to land on (round-5 re-audit: activeElement = body).
		document.getElementById('admin-controls-title')?.focus();
		closingTicket = id;
		requestNotice = '';
		try {
			const res = await fetch('/api/admin/requests', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ticketId: id })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
			await loadControls();
			await tick();
			// Again after the re-render, in case the heading was replaced.
			document.querySelector<HTMLElement>('#admin-controls-title, main h1')?.focus();
			requestNotice = 'Request handled.';
		} catch (e) {
			controlsError = (e as Error).message;
		} finally {
			closingTicket = null;
		}
	}

	async function loadControls() {
		controlsLoading = true;
		controlsError = null;
		try {
			const res = await fetch('/api/admin/settings');
			const body = await res.json();
			if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
			controls = body;
		} catch (e) {
			controlsError = (e as Error).message;
		} finally {
			controlsLoading = false;
		}
	}

	async function setSwitch(key: 'credits_mode' | 'activity_log' | 'activity_pepper' | 'signup_credits' | 'display_currency_default' | 'fx_rates' | 'credit_markup' | 'daily_platform_spend_usd' | 'signup_credits_hourly_cap' | 'plans_enabled' | 'persona_generator' | 'persona_backbone' | 'video_ingest', value?: unknown) {
		const label =
			key === 'activity_pepper'
				? 'Rotate the activity hashing secret? Cross-day correlation of IP hashes breaks for today (by design).'
				: key === 'fx_rates'
					? 'Refresh display exchange rates from the ECB feed (display only — wallets stay in USD cents)?'
					: `Set ${key} → ${String(value)}. Why?`;
		const note = await promptAction({
			title:
				key === 'activity_pepper'
					? 'Rotate the hashing secret'
					: key === 'fx_rates'
						? 'Refresh exchange rates'
						: `Change ${key}`,
			body: label,
			warning: 'This changes behaviour for every account on the platform.',
			tone: 'caution',
			confirmLabel: 'Apply change',
			prompt: {
				label: 'Why are you making this change? (recorded in the audit trail)',
				placeholder: 'e.g. raising the cap for the launch campaign',
				required: true
			}
		});
		if (note === null) return;
		controlsBusy = true;
		try {
			const res = await fetch('/api/admin/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(key === 'activity_pepper' ? { key, rotate: true, note } : key === 'fx_rates' ? { key, refresh: true, note } : { key, value, note })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
			flash(key === 'activity_pepper' ? 'Pepper rotated' : key === 'fx_rates' ? `Rates refreshed: ${body.stored}` : `${key} = ${body.stored}${body.source === 'env' ? ' (stored — env override still wins)' : ''}`);
			signupCreditsDraft = null;
			markupDraft = null;
			ceilingDraft = null;
			hourlyCapDraft = null;
			await loadControls();
			if (platformLoaded) await loadPlatform();
		} catch (e) {
			flash(`Failed: ${(e as Error).message}`);
		} finally {
			controlsBusy = false;
		}
	}

	$effect(() => {
		if (tab === 'controls' && data.isPlatformAdmin && !controls && !controlsLoading) loadControls();
	});

	const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
	// Same shape as /billing ("Sep 9, 9:15 PM"), in the viewer's locale and zone
	// on the server as well as after hydration.
	const when = (iso: string) => instantShort(iso);

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
	const fmtCredits = (n: number) => `${(Number(n) || 0).toLocaleString()} cr`;
	const usdOfCredits = (n: number) => `$${((Number(n) || 0) / 100).toFixed(2)}`;
	// Was a local bottom-right div at z-index 50 — i.e. behind every modal in the
	// portal, so a failure raised from inside a dialog was invisible. The global
	// stack sits at --z-toast (2000) and is the one users already know.
	const flash = (msg: string) => {
		showToast(msg, /fail|error|could not|couldn't/i.test(msg) ? 'error' : 'success');
	};

	let visiblePlatformUsers = $derived(
		platformSearch.trim()
			? platformUsers.filter((u) => (u.email ?? u.id).toLowerCase().includes(platformSearch.trim().toLowerCase()))
			: platformUsers
	);

	// Activity overview (presence, logins) merged onto the users table, plus the
	// per-user timeline drawer and the platform-wide live tail.
	type Presence = { last_seen_at: string; last_route_id: string | null; last_device: string | null; last_country: string | null; online: boolean };
	type LoginInfo = { last_login_at: string | null; login_count: number; last_device: string | null; last_country: string | null };
	let presenceByUser = $state<Record<string, Presence>>({});
	let loginsByUser = $state<Record<string, LoginInfo>>({});
	let activityStats = $state<{ enabled: boolean; queued: number; flushed: number; dropped: number; lastError: string | null } | null>(null);
	let timelineFor = $state<{ userId: string; email: string } | null>(null);
	let timelineRows = $state<any[]>([]);
	let timelineAuth = $state<any[]>([]);
	let timelineLoading = $state(false);
	let timelineFilter = $state<'all' | 'auth' | 'nav' | 'generation' | 'review' | 'publish' | 'scheduler' | 'admin' | 'errors'>('all');
	let liveRows = $state<any[]>([]);
	let liveOpen = $state(false);
	let liveErrorsOnly = $state(false);

	let filteredTimeline = $derived(
		timelineFilter === 'all'
			? timelineRows
			: timelineFilter === 'errors'
				? timelineRows.filter((r) => r.outcome !== 'ok')
				: timelineRows.filter((r) => r.category === timelineFilter)
	);
	const onlineCount = $derived(Object.values(presenceByUser).filter((p) => p.online).length);
	const ago = (iso: string | null | undefined) => {
		if (!iso) return '—';
		const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
		if (s < 60) return `${Math.floor(s)}s ago`;
		if (s < 3600) return `${Math.floor(s / 60)}m ago`;
		if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
		return `${Math.floor(s / 86400)}d ago`;
	};

	async function loadPlatform() {
		platformLoading = true;
		platformError = null;
		try {
			const [res, actRes] = await Promise.all([fetch('/api/admin/credits'), fetch('/api/admin/activity')]);
			const body = await res.json();
			if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
			platformUsers = body.users;
			platformMode = body.mode;
			platformLoaded = true;
			const act = await actRes.json().catch(() => null);
			if (actRes.ok && act?.success) {
				presenceByUser = act.presence ?? {};
				loginsByUser = act.logins ?? {};
				activityStats = act.stats ?? null;
			}
		} catch (e) {
			platformError = (e as Error).message;
		} finally {
			platformLoading = false;
		}
	}

	async function openTimeline(u: PlatformUser) {
		timelineFor = { userId: u.id, email: u.email ?? u.id };
		timelineLoading = true;
		timelineRows = [];
		timelineAuth = [];
		try {
			const res = await fetch(`/api/admin/activity?userId=${encodeURIComponent(u.id)}`);
			const body = await res.json();
			if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
			timelineRows = body.events;
			timelineAuth = body.authEvents;
		} catch (e) {
			flash(`Timeline failed: ${(e as Error).message}`);
		} finally {
			timelineLoading = false;
		}
	}

	async function loadLive() {
		liveOpen = true;
		try {
			const res = await fetch(`/api/admin/activity?${liveErrorsOnly ? 'errors=1' : 'live=1'}`);
			const body = await res.json();
			if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
			liveRows = body.events;
			activityStats = body.stats ?? activityStats;
		} catch (e) {
			flash(`Live feed failed: ${(e as Error).message}`);
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

	/**
	 * A one-time temporary password, for an account that cannot receive the
	 * reset email (this deployment's auth server may have no mail transport).
	 * Shown once, here; the user must replace it on first sign-in.
	 */
	let tempPw = $state<{ email: string; password: string } | null>(null);
	let tempPwBusy = $state<string | null>(null);
	async function issueTempPassword(u: PlatformUser) {
		// A real customer's password is replaced by this, so it goes through the
		// app's typed confirmation — never a stray click.
		const ok = await confirmAction({
			title: `Replace the password for ${u.email ?? 'this account'}?`,
			body:
				'Their current password stops working immediately. You will see a one-time temporary ' +
				'password to hand them privately; they must choose their own on first sign-in.',
			warning: 'Use this only when the person cannot receive the reset email.',
			confirmLabel: 'Replace password',
			tone: 'danger',
			typeToConfirm: 'REPLACE'
		});
		if (!ok) return;
		tempPwBusy = u.id;
		try {
			const res = await fetch('/api/admin/users/temp-password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: u.id })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
			tempPw = { email: body.email ?? u.email ?? u.id, password: body.password };
		} catch (e) {
			flash(`Failed: ${(e as Error).message}`);
		} finally {
			tempPwBusy = null;
		}
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
		const note = await promptAction({
			title: `Switch billing to "${next}"`,
			body: `${u.email ?? u.id} will be billed as ${next === 'unmetered' ? 'unmetered — generations stop debiting their wallet' : 'credits — generations debit their wallet again'}.`,
			tone: 'caution',
			confirmLabel: 'Switch billing',
			prompt: { label: 'Why? (recorded in the ledger)', placeholder: 'e.g. comped for the pilot', required: true }
		});
		if (note === null) return;
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
		flash(failed ? `${selectedIds.length - failed} granted, ${failed} failed` : `Granted ${bulkCredits.toLocaleString()} to ${countLabel(selectedIds.length, 'account')}`);
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

<PageShell title="Admin Console" width="wide">
	<div class="admin-page">
	<header class="admin-head">
		{#if data.isPlatformAdmin}
			<p>
				Platform administration — switches, every account's wallet and behaviour, the model registry
				{#if data.workspaces.length > 0}, plus oversight of {data.workspaces.map((w: any) => w.name).join(', ')}{/if}.
				Seat management for a workspace still lives in <a href="/settings?section=team">Settings → Team</a>.
			</p>
		{:else}
			<p>
				Oversight for {data.workspaces.map((w: any) => w.name).join(', ')} — who's in the workspace,
				what they're doing, and what it costs. Managing seats and limits lives in
				<a href="/settings?section=team">Settings → Team</a>.
			</p>
		{/if}
	</header>

	<!-- These figures cover the workspaces listed above. A platform admin who
	     runs none saw "$0.00 · 0 · 0 · 0 · 0" directly above the platform-wide
	     view, contradicting the non-zero debits beneath it (round-3 re-audit). -->
	{#if data.stats.personaCount > 0 || data.stats.seatCount > 0}
	<div class="tab-group-label">Your workspaces</div>
	<div class="stat-row">
		<!-- Spend as the WALLETS were charged — retail, in the viewer's currency —
		     not raw provider cost in "$". Seat caps are enforced in retail, so the
		     provider figure read a seat as a third of the way to a cap that was
		     already blocking it (audit QA-001 / re-audit). -->
		<div class="stat"><span class="stat-n">{charged(data.stats.spendMonthCredits)}</span><span class="stat-l">Charged this month</span></div>
		<div class="stat"><span class="stat-n">{data.stats.postsGeneratedMonth}</span><span class="stat-l">Posts generated this month</span></div>
		<div class="stat"><span class="stat-n">{data.stats.publishedTotal}</span><span class="stat-l">Posts published, all time</span></div>
		<div class="stat"><span class="stat-n">{data.stats.seatCount}</span><span class="stat-l">Seats</span></div>
		<div class="stat"><span class="stat-n">{data.stats.personaCount}</span><span class="stat-l">Personas</span></div>
	</div>
	{/if}

	{#if data.isPlatformAdmin}
		<div class="tab-group-label">Platform — every tenant</div>
		<!-- View switchers, not tabs: there are no tab panels, and the strip holds
		     a link and an action button — neither of which can live in a tablist.
		     A labelled group of pressed-state buttons says what this really is,
		     and the selected view is announced (it was shown by class only). -->
		<div class="admin-tabs" role="group" aria-label="Platform views">
			{#each [['controls', 'Controls & Health'], ['platform', 'Users & Credits']] as [k, label] (k)}
				<button type="button" class="admin-tab platform-tab-item" class:active={tab === k} aria-pressed={tab === k} onclick={() => (tab = k as any)}>{label}</button>
			{/each}
			<a class="admin-tab platform-tab-item" href="/models">Model Manager ↗</a>
			<button type="button" class="admin-tab platform-tab-item" onclick={() => { tab = 'platform'; loadLive(); }}>Refresh live feed</button>
		</div>
	{/if}
	{#if data.workspaces.length > 0}
		<div class="tab-group-label">Workspace{data.workspaces.length > 1 ? 's' : ''} — {data.workspaces.map((w: any) => w.name).join(', ')}</div>
		<div class="admin-tabs" role="group" aria-label="Workspace views">
			{#each [['overview', 'Overview'], ['activity', 'Activity Log'], ['seats', 'Seats'], ['spend', 'Spend'], ['access', 'Access & Keys']] as [k, label] (k)}
				<button type="button" class="admin-tab" class:active={tab === k} aria-pressed={tab === k} onclick={() => (tab = k as any)}>{label}</button>
			{/each}
		</div>
	{/if}

	{#if tab === 'overview'}
		<section class="admin-card">
			<h2>Workspaces</h2>
			<!-- A named, focusable scroll region: WebKit does not make a scroll container keyboard-focusable, so without tabindex its hidden columns were unreachable by keyboard. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div class="table-scroll" role="region" aria-label="Workspaces" tabindex="0">
			<table class="admin-table">
				<thead><tr><th>Workspace</th><th>Your role</th><th>Created</th></tr></thead>
				<tbody>
					{#each data.workspaces as w (w.id)}
						<tr><td>{w.name}</td><td><span class="role-pill">{w.myRole}</span></td><td>{when(w.created_at)}</td></tr>
					{/each}
				</tbody>
			</table>
			</div>
		</section>

		<section class="admin-card">
			<h2>Personas in these workspaces</h2>
			{#if data.personas.length === 0}
				<p class="admin-hint">No personas filed into these workspaces yet.</p>
			{:else}
				<!-- A named, focusable scroll region: WebKit does not make a scroll container keyboard-focusable, so without tabindex its hidden columns were unreachable by keyboard. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div class="table-scroll" role="region" aria-label="Personas in these workspaces" tabindex="0">
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
				</div>
			{/if}
		</section>

		<section class="admin-card">
			<h2>Recent activity</h2>
			{#if data.activity.length === 0}
				<p class="admin-hint">Nothing logged yet.</p>
			{:else}
				<!-- A named, focusable scroll region: WebKit does not make a scroll container keyboard-focusable, so without tabindex its hidden columns were unreachable by keyboard. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div class="table-scroll" role="region" aria-label="Recent activity" tabindex="0">
				<table class="admin-table">
					<thead><tr><th>When</th><th>Who</th><th>What</th><th>Persona</th></tr></thead>
					<tbody>
						{#each data.activity.slice(0, 10) as a (a.id)}
							<tr>
								<td class="nowrap">{when(a.at)}</td>
								<td class="mono">{a.actor}</td>
								<td><span class="kind-pill kind-{a.kind}">{a.kind}</span> {a.detail}</td>
								<td>{a.persona}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				</div>
				<button class="admin-link" onclick={() => (tab = 'activity')}>View full log →</button>
			{/if}
		</section>
	{:else if tab === 'controls' && data.isPlatformAdmin}
		<section class="admin-card">
			<div class="platform-head">
				<div>
					<!-- Focusable: closeRequest() lands here after a request is handled. -->
					<h2 id="admin-controls-title" tabindex="-1">Platform controls</h2>
					<p class="sr-only" role="status" aria-live="polite">{requestNotice}</p>
					<p class="admin-hint">
						These switches live in the database and take effect on every server within 15 seconds — no
						environment change, no redeploy. An environment variable of the same name, if set on the host,
						overrides the stored value (emergency stop). Every change needs a note and is written to the
						settings history and the activity log.
					</p>
				</div>
				<button class="filter-btn" onclick={loadControls} disabled={controlsLoading}>{controlsLoading ? 'Loading…' : 'Refresh'}</button>
			</div>
			{#if controlsError}<p class="admin-error">{controlsError}</p>{/if}
			{#if controls}
				{#if controls.posture?.admission?.open}
					<p class="admin-warn">
						<strong>Registration is open.</strong>
						{#if controls.posture.admission.anonSignup === 'open'}
							The Supabase project still accepts public signups, and the anon key ships in the
							browser bundle — anyone can create an account without passing through this app.
							Set <code>GOTRUE_DISABLE_SIGNUP=true</code> on the auth service.
						{/if}
						{#if controls.posture.admission.routePin === 'unset'}
							ADMIN_PIN is not set, so the signup form asks for nothing.
						{/if}
						{#if controls.posture.admission.anonSignup === 'open' && controls.posture.admission.routePin === 'unset'}
							Close the Supabase one first — shutting only the front door leaves the bypass.
						{/if}
						New accounts still receive welcome credit, so this costs money as well as control.
					</p>
				{:else if controls.posture?.admission?.anonSignup === 'unverified'}
					<p class="admin-warn">
						<strong>Admission unverified.</strong>
						Could not read the auth service to check whether public signups are open{controls.posture.admission.note
							? ` — ${controls.posture.admission.note}`
							: ''}. Treat this as unknown, not as closed.
					</p>
				{/if}
				{#if controls.providerBalance?.state === 'low'}
					<p class="admin-warn">
						<strong>The provider account is nearly empty.</strong>
						OpenRouter has <strong>{money(controls.providerBalance.remainingUsd ?? 0)}</strong> left —
						about {controls.providerBalance.postsRemaining ?? 0} more video posts, or
						{controls.providerBalance.imagePostsRemaining ?? 0} image posts, before generation starts
						failing for customers mid-post. Below
						{money(controls.providerBalance.emptyThresholdUsd)} the next video call cannot run at all.
						<strong>This is yours to fix, not a bug:</strong>
						top up the OpenRouter account at <code>openrouter.ai/settings/credits</code>. The warning
						starts at {money(controls.providerBalance.lowThresholdUsd)}.
						{#if controls.providerBalance.checkedAt}
							<span class="muted small">Measured {when(controls.providerBalance.checkedAt)}.</span>
						{/if}
					</p>
				{:else if controls.providerBalance?.state === 'unknown'}
					<p class="admin-warn">
						<strong>Provider balance unknown.</strong>
						Could not read what is left in the OpenRouter account{controls.providerBalance.note
							? ` — ${controls.providerBalance.note}`
							: ''}. Treat this as unknown, not as funded: an unread balance is exactly as likely to
						be empty as full, and nothing else in the app is watching it.
					</p>
				{:else if controls.providerBalance?.state === 'ok'}
					<p class="admin-hint small">
						Provider balance: OpenRouter has {money(controls.providerBalance.remainingUsd ?? 0)} left ≈
						{controls.providerBalance.postsRemaining ?? 0} video posts / {controls.providerBalance
							.imagePostsRemaining ?? 0} image posts. Warns below
						{money(controls.providerBalance.lowThresholdUsd)}.
						{#if controls.providerBalance.checkedAt}Measured {when(controls.providerBalance.checkedAt)}.{/if}
					</p>
				{/if}

				<!-- fal. Separate from the block above rather than folded into it: the
				     two accounts fail differently. OpenRouter degrades, fal LOCKS the
				     account when it runs out, and fal is the expensive one — so an
				     operator reading this needs to see which account is which. -->
				{#if controls.falBalance?.state === 'low'}
					<p class="admin-warn">
						<strong>fal balance low.</strong>
						fal has <strong>{money(controls.falBalance.remainingUsd ?? 0)}</strong> left — about
						{controls.falBalance.postsRemaining ?? 0} more talking-head clips, or
						{controls.falBalance.imagePostsRemaining ?? 0} image posts. fal locks the account when the
						balance runs out, so this stops every image and video at once rather than slowing down.
						Top up at <code>fal.ai/dashboard/billing</code>.
						{#if controls.falBalance.checkedAt}
							<span class="muted small">Measured {when(controls.falBalance.checkedAt)}.</span>
						{/if}
					</p>
				{:else if controls.falBalance?.state === 'unconfigured'}
					<p class="admin-hint small">
						<strong>fal balance not watched.</strong>
						{controls.falBalance.note}
					</p>
				{:else if controls.falBalance?.state === 'unknown'}
					<p class="admin-warn">
						<strong>fal balance unknown.</strong>
						{controls.falBalance.note} Treat this as unknown, not as funded.
					</p>
				{:else if controls.falBalance?.state === 'ok'}
					<p class="admin-hint small">
						fal balance: {money(controls.falBalance.remainingUsd ?? 0)} left ≈
						{controls.falBalance.postsRemaining ?? 0} talking-head clips / {controls.falBalance
							.imagePostsRemaining ?? 0} image posts. Warns below
						{money(controls.falBalance.lowThresholdUsd)}.
						{#if controls.falBalance.checkedAt}Measured {when(controls.falBalance.checkedAt)}.{/if}
					</p>
				{/if}

				{#if controls.topupRequests && controls.topupRequests.length > 0}
					<section class="pkeys" aria-labelledby="topup-req-h">
						<h3 id="topup-req-h">Top-up requests waiting ({controls.topupRequests.length})</h3>
						<p class="admin-hint">
							Card payments are off, so customers ask from Billing. <strong>Load</strong> grants the
							pack named in the request to their wallet and closes it — once, however often it is
							pressed. Oldest first.
						</p>
						<ul class="topup-req-list">
							{#each controls.topupRequests as r (r.id)}
								<li>
									<strong>{r.title.replace(/^Top-up request · /, '')}</strong>
									<span class="muted small">— {when(r.created_at)}</span>
									<button
										type="button"
										class="admin-link"
										aria-disabled={closingTicket === r.id ? 'true' : undefined}
										onclick={() => closeRequest(r.id)}
										>{closingTicket === r.id ? 'Loading…' : `Load ${r.title.replace(/^Top-up request · [^$]*/, '')}`}</button
									>
									{#if r.description}<p class="muted small">{r.description}</p>{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if controls.signInHelp && controls.signInHelp.length > 0}
					<section class="pkeys" aria-labelledby="signin-help-h">
						<h3 id="signin-help-h" tabindex="-1">Sign-in help requests ({controls.signInHelp.length})</h3>
						<p class="admin-hint">
							From the reset page, by people the reset email could not reach. Verify them from your own
							mail first; then Users &amp; Credits → Temp password.
						</p>
						<ul class="topup-req-list">
							{#each controls.signInHelp as r (r.id)}
								<li>
									<strong>{r.title.replace(/^Sign-in help · /, '')}</strong>
									<span class="muted small">— {when(r.created_at)}</span>
									<button type="button" class="admin-link" aria-disabled={closingTicket === r.id ? 'true' : undefined} onclick={() => closeRequest(r.id)}
										>{closingTicket === r.id ? 'Closing…' : 'Mark handled'}</button
									>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if controls.problemReports && controls.problemReports.length > 0}
					<section class="pkeys" aria-labelledby="problem-rep-h">
						<h3 id="problem-rep-h">Problem reports waiting ({controls.problemReports.length})</h3>
						<p class="admin-hint">
							Customers file these from a failed post ("Report this problem"). Each quotes the
							message they were shown; the real cause is in the server log. Oldest first.
						</p>
						<ul class="topup-req-list">
							{#each controls.problemReports as r (r.id)}
								<li>
									<strong>{r.title.replace(/^Problem report · /, '')}</strong>
									<span class="muted small">— {when(r.created_at)}</span>
									<button
										type="button"
										class="admin-link"
										aria-disabled={closingTicket === r.id ? 'true' : undefined}
										onclick={() => closeRequest(r.id)}
										>{closingTicket === r.id ? 'Closing…' : 'Mark handled'}</button
									>
									{#if r.description}<p class="muted small">{r.description}</p>{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if controls.platformKeys && controls.platformKeys.length > 0}
					<section class="pkeys">
						<h3>Platform provider keys</h3>
						<p class="admin-hint">
							Every generation runs on these — customer-supplied generation keys were withdrawn on
							2026-09-21, so there is no per-user fallback left. Set in the deployment environment,
							not here: this panel is read-only and never reads a key's value.
						</p>
						<!-- A data table may scroll sideways on a phone (WCAG 1.4.10), but only
					     inside a region that is reachable and named; it used to run off the
					     right edge of the page with no cue at all. -->
						<!-- A scrollable region must be focusable, or a keyboard user cannot scroll it (WCAG 2.1.1). -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<div class="pkeys-scroll" role="region" aria-label="Platform provider keys" tabindex="0">
						<table class="admin-table">
								<thead>
									<tr>
										<th>Provider</th>
										<th>Variable</th>
										<th>Status</th>
										<th class="nowrap">Last successful call</th>
										<th class="num">30d</th>
									</tr>
								</thead>
								<tbody>
									{#each controls.platformKeys as k (k.id)}
										<tr class:negative={!k.configured}>
											<td>{k.label}</td>
											<td><code>{k.envVar}</code></td>
											<td>
												<span class="mode-pill mode-{k.configured ? 'enforce' : 'off'}">
													{k.configured ? 'set' : 'missing'}
												</span>
											</td>
											<td class="nowrap">
												{k.lastUsedAt ? when(k.lastUsedAt) : k.costProvider ? 'never' : '—'}
											</td>
											<td class="num">{k.costProvider ? k.events30d : '—'}</td>
										</tr>
										{#if k.problem}
											<tr class="pkey-problem">
												<td colspan="5"><span class="muted small">{k.problem}</span></td>
											</tr>
										{/if}
									{/each}
							</tbody>
						</table>
						</div>
					</section>
				{/if}

				<div class="control-grid">
					<div class="control">
						<div class="control-head">
							<strong>Credits</strong>
							<span class="mode-pill mode-{controls.switches.credits_mode.effective}">{controls.switches.credits_mode.effective}</span>
							<span class="muted small">source: {controls.switches.credits_mode.source}</span>
						</div>
						<p class="admin-hint">
							<b>off</b> — wallets untouched (today's behaviour). <b>shadow</b> — every generation debits its
							wallet, nothing is ever blocked; balances may go negative. <b>enforce</b> — an empty wallet blocks
							paid generation before the first provider call. Recommended path: shadow for a day, reconcile, then enforce.
						</p>
						<div class="filter-row">
							{#each ['off', 'shadow', 'enforce'] as m (m)}
								<button class="filter-btn" class:active={controls.switches.credits_mode.stored === m} aria-pressed={controls.switches.credits_mode.stored === m} disabled={controlsBusy} onclick={() => setSwitch('credits_mode', m)}>{m}</button>
							{/each}
						</div>
						{#if controls.switches.credits_mode.source === 'env'}
							<p class="admin-warn">CREDITS_ENFORCE is set in the host environment and overrides the stored value. Remove it there to control this from here.</p>
						{/if}
					</div>

					<div class="control">
						<div class="control-head">
							<strong>Activity log</strong>
							<span class="mode-pill" class:mode-enforce={controls.switches.activity_log.effective} class:mode-off={!controls.switches.activity_log.effective}>{controls.switches.activity_log.effective ? 'on' : 'off'}</span>
							<span class="muted small">source: {controls.switches.activity_log.source}</span>
						</div>
						<p class="admin-hint">
							Records who did what, when, from which browser family and country, with outcome, duration and cost —
							pseudonymously (no emails, IPs or content in the rows). Powers Users & Credits' last-seen, online,
							timelines and the live feed.
						</p>
						<div class="filter-row">
							<button class="filter-btn" class:active={controls.switches.activity_log.stored === true} aria-pressed={controls.switches.activity_log.stored === true} disabled={controlsBusy} onclick={() => setSwitch('activity_log', true)}>on</button>
							<button class="filter-btn" class:active={controls.switches.activity_log.stored === false} aria-pressed={controls.switches.activity_log.stored === false} disabled={controlsBusy} onclick={() => setSwitch('activity_log', false)}>off</button>
						</div>
						{#if controls.switches.activity_log.source === 'env'}
							<p class="admin-warn">ACTIVITY_LOG is set in the host environment and overrides the stored value.</p>
						{/if}
						<p class="admin-hint small">
							Queue: {controls.activity.queued} waiting · {controls.activity.flushed} written since boot ·
							<span class:neg={controls.activity.dropped > 0}>{controls.activity.dropped} dropped</span>
							{#if controls.activity.lastError} · last error: {controls.activity.lastError}{/if}
						</p>
					</div>

					<div class="control">
						<div class="control-head">
							<strong>Hashing secret (pepper)</strong>
							<span class="mode-pill" class:mode-enforce={controls.switches.activity_pepper.set} class:mode-shadow={!controls.switches.activity_pepper.set}>{controls.switches.activity_pepper.set ? 'set' : 'MISSING'}</span>
							<span class="muted small">source: {controls.switches.activity_pepper.source}</span>
						</div>
						<p class="admin-hint">
							Salts the IP and subject hashes in the activity log. Never displayed. Rotating it breaks cross-day
							correlation on purpose (today's hashes become inconsistent for the rest of the day).
						</p>
						<div class="filter-row">
							<button class="filter-btn" disabled={controlsBusy} onclick={() => setSwitch('activity_pepper')}>Rotate</button>
						</div>
					</div>

					<div class="control">
						<div class="control-head">
							<strong>Welcome credits</strong>
							<span class="mode-pill" class:mode-enforce={controls.switches.signup_credits.stored > 0} class:mode-off={controls.switches.signup_credits.stored === 0}>
								{controls.switches.signup_credits.stored > 0 ? `${controls.switches.signup_credits.usd} per new account` : 'off'}
							</span>
						</div>
						<p class="admin-hint">
							Granted automatically the moment an account is created (any signup path), as an audited ledger row.
							100 credits = $1.00 at retail (provider cost × markup). Set 0 to disable. Because signup is open, keep this modest:
							enough for one persona and a handful of posts, never a video budget.
						</p>
						<div class="filter-row">
							<input class="admin-input narrow" type="number" min="0" step="100" value={signupCreditsDraft ?? controls.switches.signup_credits.stored} oninput={(e) => (signupCreditsDraft = Number((e.target as HTMLInputElement).value))} aria-label="Welcome credits" />
							<span class="admin-hint">= ${(((signupCreditsDraft ?? controls.switches.signup_credits.stored) || 0) / 100).toFixed(2)}</span>
							<button class="filter-btn active" disabled={controlsBusy || signupCreditsDraft === null || signupCreditsDraft === controls.switches.signup_credits.stored} onclick={() => setSwitch('signup_credits', signupCreditsDraft)}>Save</button>
						</div>
					</div>

					<div class="control">
						<div class="control-head">
							<strong>Margin (credit markup)</strong>
							<span class="mode-pill" class:mode-enforce={controls.switches.credit_markup.effective > 1} class:mode-shadow={controls.switches.credit_markup.effective <= 1}>
								{controls.switches.credit_markup.effective}× {controls.switches.credit_markup.effective <= 1 ? '(at cost, no margin)' : ''}
							</span>
							<span class="muted small">source: {controls.switches.credit_markup.source}</span>
						</div>
						<p class="admin-hint">
							Every debit is <em>estimated provider cost × markup</em>, so one credit is one retail cent: packs sell at par,
							the wallet pill shows exactly what was paid for, and margin is this one number. Persona/UGC tools run 3–10×;
							general AI wallets 1.2–2.5×. Takes effect on the next generation; balances are not changed.
						</p>
						<div class="filter-row">
							<input class="admin-input narrow" type="number" min="1" max="20" step="0.25" value={markupDraft ?? controls.switches.credit_markup.stored} oninput={(e) => (markupDraft = Number((e.target as HTMLInputElement).value))} aria-label="Credit markup" />
							<span class="admin-hint">× · a $0.42 video clip costs the customer ${(0.42 * ((markupDraft ?? controls.switches.credit_markup.stored) || 1)).toFixed(2)}; an $0.08 still ${(0.08 * ((markupDraft ?? controls.switches.credit_markup.stored) || 1)).toFixed(2)}</span>
							<button class="filter-btn active" disabled={controlsBusy || markupDraft === null || markupDraft === controls.switches.credit_markup.stored} onclick={() => setSwitch('credit_markup', markupDraft)}>Save</button>
						</div>
						{#if controls.switches.credit_markup.source === 'env'}
							<p class="admin-hint warn">CREDIT_MARKUP is set in the host environment and overrides the stored value.</p>
						{/if}
					</div>

					<div class="control">
						<div class="control-head">
							<strong>Platform daily ceiling</strong>
							<span class="mode-pill" class:mode-enforce={controls.switches.daily_platform_spend_usd.stored > 0} class:mode-off={controls.switches.daily_platform_spend_usd.stored === 0}>
								{controls.switches.daily_platform_spend_usd.stored > 0 ? `$${controls.switches.daily_platform_spend_usd.stored.toFixed(2)} / day` : 'off'}
							</span>
						</div>
						<p class="admin-hint">
							Total estimated <em>provider</em> spend per UTC day across every account. The last line against a leaked
							key or a runaway loop that per-user caps cannot see. Fails closed only while credits are enforced. 0 disables.
						</p>
						<div class="filter-row">
							<input class="admin-input narrow" type="number" min="0" step="10" value={ceilingDraft ?? controls.switches.daily_platform_spend_usd.stored} oninput={(e) => (ceilingDraft = Number((e.target as HTMLInputElement).value))} aria-label="Platform daily ceiling (USD)" />
							<span class="admin-hint">USD raw provider cost</span>
							<button class="filter-btn active" disabled={controlsBusy || ceilingDraft === null || ceilingDraft === controls.switches.daily_platform_spend_usd.stored} onclick={() => setSwitch('daily_platform_spend_usd', ceilingDraft)}>Save</button>
						</div>
					</div>

					<div class="control">
						<div class="control-head">
							<strong>Persona generator</strong>
							<span class="mode-pill" class:mode-enforce={controls.switches.persona_generator.effective === 'v2'} class:mode-off={controls.switches.persona_generator.effective === 'v1'}>{controls.switches.persona_generator.effective}</span>
							<span class="muted small">source: {controls.switches.persona_generator.source}</span>
						</div>
						<p class="admin-hint">
							How a NEW persona is built. <strong>v1</strong> is today's path: the model invents every field and the
							values are coerced afterwards. <strong>v2</strong> samples the facts first and lets the model write prose
							around them. Existing personas are untouched either way.
						</p>
						<div class="filter-row">
							{#each ['v1', 'v2'] as g (g)}
								<button class="filter-btn" class:active={controls.switches.persona_generator.stored === g} aria-pressed={controls.switches.persona_generator.stored === g} disabled={controlsBusy} onclick={() => setSwitch('persona_generator', g)}>{g}</button>
							{/each}
						</div>
						{#if controls.switches.persona_generator.source === 'env'}
							<p class="admin-hint warn">PERSONA_GENERATOR is set in the host environment and overrides the stored value.</p>
						{/if}
					</div>

					<div class="control">
						<div class="control-head">
							<strong>Persona backbone</strong>
							<span class="mode-pill" class:mode-enforce={controls.switches.persona_backbone.effective === 'on'} class:mode-shadow={controls.switches.persona_backbone.effective === 'shadow' || controls.switches.persona_backbone.effective === 'fill'} class:mode-off={controls.switches.persona_backbone.effective === 'off'}>{controls.switches.persona_backbone.effective}</span>
							<span class="muted small">source: {controls.switches.persona_backbone.source}</span>
						</div>
						<p class="admin-hint">
							How far the sampled life facts are switched on, one reversible step at a time:
							<strong>off</strong> nothing computed · <strong>shadow</strong> computed and compared, never saved ·
							<strong>fill</strong> saved and shown, never sent to a prompt · <strong>on</strong> also sent to prompts.
							Stored data and what the model is told never change in the same move.
						</p>
						<div class="filter-row">
							{#each ['off', 'shadow', 'fill', 'on'] as b (b)}
								<button class="filter-btn" class:active={controls.switches.persona_backbone.stored === b} aria-pressed={controls.switches.persona_backbone.stored === b} disabled={controlsBusy} onclick={() => setSwitch('persona_backbone', b)}>{b}</button>
							{/each}
						</div>
						{#if controls.switches.persona_backbone.source === 'env'}
							<p class="admin-hint warn">PERSONA_BACKBONE is set in the host environment and overrides the stored value.</p>
						{/if}
					</div>

					<div class="control">
						<div class="control-head">
							<strong>Plans (subscriptions)</strong>
							<span class="mode-pill" class:mode-enforce={controls.switches.plans_enabled.stored} class:mode-off={!controls.switches.plans_enabled.stored}>{controls.switches.plans_enabled.stored ? 'on' : 'off'}</span>
						</div>
						<p class="admin-hint">
							Offers Studio / Brand / Agency on the Billing page with an included monthly media wallet (reset each renewal,
							purchased credit untouched). Needs the Stripe keys in the host environment. Existing subscriptions keep
							renewing through the webhook whatever this says.
						</p>
						<div class="filter-row">
							<button class="filter-btn" class:active={controls.switches.plans_enabled.stored === true} aria-pressed={controls.switches.plans_enabled.stored === true} disabled={controlsBusy} onclick={() => setSwitch('plans_enabled', true)}>on</button>
							<button class="filter-btn" class:active={controls.switches.plans_enabled.stored === false} aria-pressed={controls.switches.plans_enabled.stored === false} disabled={controlsBusy} onclick={() => setSwitch('plans_enabled', false)}>off</button>
						</div>
					</div>

					<div class="control">
						<div class="control-head">
							<strong>Source clips (video-to-video)</strong>
							<span class="mode-pill" class:mode-enforce={controls.switches.video_ingest.effective} class:mode-off={!controls.switches.video_ingest.effective}>{controls.switches.video_ingest.effective ? 'on' : 'off'}</span>
							<span class="muted small">source: {controls.switches.video_ingest.source}</span>
						</div>
						<p class="admin-hint">
							Whether an account may upload a clip for the persona to re-perform (reel remake, motion transfer).
							Off refuses the upload endpoint outright, and says so as a policy answer rather than as a broken
							host — whether the box has the video tools is probed separately. Every accepted upload records the
							uploader's rights assertion in the activity log.
						</p>
						<div class="filter-row">
							<button class="filter-btn" class:active={controls.switches.video_ingest.stored === true} aria-pressed={controls.switches.video_ingest.stored === true} disabled={controlsBusy} onclick={() => setSwitch('video_ingest', true)}>on</button>
							<button class="filter-btn" class:active={controls.switches.video_ingest.stored === false} aria-pressed={controls.switches.video_ingest.stored === false} disabled={controlsBusy} onclick={() => setSwitch('video_ingest', false)}>off</button>
						</div>
						{#if controls.switches.video_ingest.source === 'env'}
							<p class="admin-hint warn">VIDEO_INGEST is set in the host environment and overrides the stored value.</p>
						{/if}
					</div>

					<div class="control">
						<div class="control-head">
							<strong>Welcome grants per hour</strong>
							<span class="mode-pill" class:mode-enforce={controls.switches.signup_credits_hourly_cap.stored > 0} class:mode-off={controls.switches.signup_credits_hourly_cap.stored === 0}>
								{controls.switches.signup_credits_hourly_cap.stored > 0 ? `${controls.switches.signup_credits_hourly_cap.stored} / hour` : 'unlimited'}
							</span>
						</div>
						<p class="admin-hint">
							Signup abuse guard: once this many accounts have received welcome credit in the last hour, further
							signups still succeed but receive none (the trigger logs it). Raise for launches, lower under attack.
						</p>
						<div class="filter-row">
							<input class="admin-input narrow" type="number" min="0" step="1" value={hourlyCapDraft ?? controls.switches.signup_credits_hourly_cap.stored} oninput={(e) => (hourlyCapDraft = Number((e.target as HTMLInputElement).value))} aria-label="Welcome grants per hour" />
							<button class="filter-btn active" disabled={controlsBusy || hourlyCapDraft === null || hourlyCapDraft === controls.switches.signup_credits_hourly_cap.stored} onclick={() => setSwitch('signup_credits_hourly_cap', hourlyCapDraft)}>Save</button>
						</div>
					</div>

					<div class="control">
						<div class="control-head">
							<strong>Currency display</strong>
							<span class="mode-pill">{controls.switches.display_currency_default.stored === 'auto' ? 'auto (visitor country)' : controls.switches.display_currency_default.stored}</span>
						</div>
						<p class="admin-hint">
							Balances are shown as money in each visitor's currency — from their saved preference, else their
							country, else their browser language, else this default. Wallets are always kept in USD cents;
							rates only change what is displayed.
						</p>
						<div class="filter-row">
							<select class="admin-input" value={controls.switches.display_currency_default.stored} onchange={(e) => setSwitch('display_currency_default', (e.target as HTMLSelectElement).value)} disabled={controlsBusy} aria-label="Default currency">
								<option value="auto">auto (visitor's country)</option>
								{#each controls.switches.display_currency_default.supported as c (c)}
									<option value={c}>{c}</option>
								{/each}
							</select>
						</div>
						<p class="admin-hint small">
							Rates: {controls.switches.fx_rates.count} currencies · {controls.switches.fx_rates.source ?? 'seed'} · updated {controls.switches.fx_rates.updated_at ? when(controls.switches.fx_rates.updated_at) : 'never (seed table)'}
							<br />
							{controls.switches.fx_rates.sample.map((s) => `${s.currency} ${s.rate ?? '—'}`).join(' · ')}
						</p>
						<div class="filter-row">
							<button class="filter-btn" disabled={controlsBusy} onclick={() => setSwitch('fx_rates')}>Refresh rates (ECB)</button>
						</div>
					</div>

					<div class="control">
						<div class="control-head">
							<strong>Schema & cache</strong>
							<span class="mode-pill" class:mode-enforce={controls.migrations.pending?.length === 0} class:mode-shadow={(controls.migrations.pending?.length ?? 1) > 0}>
								{controls.migrations.pending === null ? 'ledger absent' : controls.migrations.pending.length === 0 ? `${controls.migrations.applied}/${controls.migrations.total} applied` : `${controls.migrations.pending.length} pending`}
							</span>
						</div>
						{#if controls.migrations.pending && controls.migrations.pending.length > 0}
							<p class="admin-warn">Pending: {controls.migrations.pending.join(', ')} — run <code>node scripts/apply-migration.mjs --all</code>.</p>
						{/if}
						<p class="admin-hint small">
							Settings cache: {controls.cache.primed ? 'primed' : 'not primed'} · last refresh {controls.cache.lastRefreshAt ? when(controls.cache.lastRefreshAt) : '—'}
							{#if controls.cache.lastError} · <span class="neg">error: {controls.cache.lastError}</span>{/if}
						</p>
					</div>
				</div>

				<h3 class="sub">Change history</h3>
				{#if controls.history.length === 0}
					<p class="admin-hint">No changes yet.</p>
				{:else}
					<!-- A named, focusable scroll region: WebKit does not make a scroll container keyboard-focusable, so without tabindex its hidden columns were unreachable by keyboard. -->
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<div class="table-scroll" role="region" aria-label="Change history" tabindex="0">
						<table class="admin-table hist-table">
							<thead><tr><th>When</th><th>Setting</th><th>From</th><th>To</th><th>Note</th><th>By</th></tr></thead>
							<tbody>
								{#each controls.history as h (h.changed_at + h.key)}
									<tr>
										<td class="nowrap">{when(h.changed_at)}</td>
										<td class="mono">{h.key}</td>
										<td class="mono">{h.key === 'activity_pepper' ? '(secret)' : JSON.stringify(h.old_value)}</td>
										<td class="mono">{h.key === 'activity_pepper' ? '(rotated)' : JSON.stringify(h.new_value)}</td>
										<td>{h.note ?? ''}</td>
										<td class="mono small">{h.changed_by ? h.changed_by.slice(0, 8) + '…' : 'system'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			{:else if !controlsError}
				<p class="admin-hint">Loading…</p>
			{/if}
		</section>
	{:else if tab === 'platform' && data.isPlatformAdmin}
		<section class="admin-card">
			<div class="platform-head">
				<div>
					<h2>Every account on the platform</h2>
					<p class="admin-hint">
						Wallets, sign-ins, and this month's metered spend across all tenants. 1 credit = 1¢ of
						retail generation (provider cost × the platform markup) — what the customer pays. Every grant, set, adjustment and comp is a ledger row with you as
						the actor — nothing here is ever edited or deleted.
					</p>
				</div>
				<div class="platform-mode">
					<span class="mode-pill mode-{platformMode}">CREDITS_ENFORCE = {platformMode}</span>
					{#if activityStats}
						<span class="mode-pill" class:mode-enforce={activityStats.enabled && activityStats.dropped === 0} class:mode-shadow={activityStats.enabled && activityStats.dropped > 0} title={activityStats.lastError ?? ''}>
							ACTIVITY_LOG = {activityStats.enabled ? `on · ${onlineCount} online · ${activityStats.dropped} dropped` : 'off'}
						</span>
					{/if}
					<button class="filter-btn" onclick={loadLive}>Live feed</button>
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
				{#if tempPw}
					<div class="temp-pw" role="status">
						<p>
							Temporary password for <strong>{tempPw.email}</strong> — shown once. Give it to them
							privately; they must choose their own the first time they sign in.
						</p>
						<code class="temp-pw-value">{tempPw.password}</code>
						<button type="button" class="admin-link" onclick={() => (tempPw = null)}>Done — hide it</button>
					</div>
				{/if}
				<!-- A named, focusable scroll region: WebKit does not make a scroll container keyboard-focusable, so without tabindex its hidden columns were unreachable by keyboard. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div class="table-scroll" role="region" aria-label="Every account on the platform" tabindex="0">
					<table class="admin-table">
						<thead>
							<tr>
								<th></th>
								<th>Account</th>
								<th>Created</th>
								<th>Last sign-in</th>
								<th>Last seen</th>
								<th>Balance</th>
								<th>Mode</th>
								<th>Debited (mo)</th>
								<th>Waived (mo)</th>
								<!-- Provider cost, not what the customer paid — the ledger column
								     beside it is that. Under a header saying "1 credit = 1¢ retail" the
								     old "Est. spend" label read as customer spend (round-4 re-audit). -->
								<th title="What the providers charged us this month for this account's calls — not what the customer paid (see Debited)">Provider cost (mo)</th>
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
										{#if loginsByUser[u.id]}<span class="muted"> · {loginsByUser[u.id].login_count}× {loginsByUser[u.id].last_device ?? ''} {loginsByUser[u.id].last_country ?? ''}</span>{/if}
									</td>
									<td class="nowrap">
										{#if presenceByUser[u.id]}
											{#if presenceByUser[u.id].online}<span class="kind-pill kind-online">online</span>{:else}{ago(presenceByUser[u.id].last_seen_at)}{/if}
											<span class="muted small">{(presenceByUser[u.id].last_route_id ?? '').replace('/(portal)', '')}</span>
										{:else}—{/if}
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
										<button class="admin-link" onclick={() => openTimeline(u)}>Timeline</button>
										<button
											class="admin-link"
											onclick={() => issueTempPassword(u)}
											disabled={tempPwBusy === u.id}
											title="Sets a one-time password for {u.email ?? 'this account'} and makes them choose a new one on sign-in"
										>
											{tempPwBusy === u.id ? 'Setting…' : 'Temp password'}
										</button>
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

		{#if liveOpen}
			<section class="admin-card">
				<div class="platform-head">
					<h2>{liveErrorsOnly ? 'Errors' : 'Live feed'} — last 100 events, every account</h2>
					<div class="platform-mode">
						<label class="admin-hint"><input type="checkbox" bind:checked={liveErrorsOnly} onchange={loadLive} /> errors only</label>
						<button class="filter-btn" onclick={loadLive}>Refresh</button>
						<button class="filter-btn" onclick={() => (liveOpen = false)}>Close</button>
					</div>
				</div>
				{#if liveRows.length === 0}
					<p class="admin-hint">Nothing recorded yet{activityStats && !activityStats.enabled ? ' — ACTIVITY_LOG is off' : ''}.</p>
				{:else}
					<!-- A named, focusable scroll region: WebKit does not make a scroll container keyboard-focusable, so without tabindex its hidden columns were unreachable by keyboard. -->
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<div class="table-scroll" role="region" aria-label={liveErrorsOnly ? 'Errors — last 100 events' : 'Live feed — last 100 events'} tabindex="0">
						<table class="admin-table">
							<thead><tr><th>When</th><th>Who</th><th>Action</th><th>Outcome</th><th>ms</th><th>Credits</th><th>Client</th><th>Detail</th></tr></thead>
							<tbody>
								{#each liveRows as r (r.id)}
									<tr class:negative={r.outcome !== 'ok'}>
										<td class="nowrap">{when(r.occurred_at)}</td>
										<td class="mono">{r.actor}{r.target ? ` → ${r.target}` : ''}<span class="muted small"> {r.actor_kind}</span></td>
										<td><span class="kind-pill kind-{r.category}">{r.category}</span> {r.action}</td>
										<td>{r.outcome}{r.status_code ? ` ${r.status_code}` : ''}{r.error_code ? ` ${r.error_code}` : ''}</td>
										<td class="nowrap">{r.duration_ms ?? '—'}</td>
										<td class="nowrap">{r.credits_delta ?? (r.est_cost_usd ? money(r.est_cost_usd) : '—')}</td>
										<td class="nowrap small">{r.device ?? ''} {r.country ?? ''}</td>
										<td class="small mono">{r.route_id ?? ''} {Object.keys(r.meta ?? {}).length ? JSON.stringify(r.meta) : ''}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>
		{/if}

		{#if timelineFor}
			<section class="admin-card">
				<div class="platform-head">
					<h2>Timeline — {timelineFor.email}</h2>
					<button class="filter-btn" onclick={() => (timelineFor = null)}>Close</button>
				</div>
				<div class="filter-row">
					{#each [['all', 'All'], ['auth', 'Auth'], ['nav', 'Pages'], ['generation', 'Generations'], ['review', 'Reviews'], ['publish', 'Publishing'], ['scheduler', 'Autopilot'], ['admin', 'Admin'], ['errors', 'Errors']] as [k, label] (k)}
						<button class="filter-btn" class:active={timelineFilter === k} aria-pressed={timelineFilter === k} onclick={() => (timelineFilter = k as any)}>{label}</button>
					{/each}
				</div>
				{#if timelineLoading}
					<p class="admin-hint">Loading…</p>
				{:else}
					{#if timelineAuth.length > 0}
						<p class="admin-hint">
							Auth service trail: {timelineAuth.length} entries — last {timelineAuth[0]?.action} {when(timelineAuth[0]?.occurred_at)}.
							{timelineAuth.filter((a: any) => a.action === 'login').length} logins on record.
						</p>
					{/if}
					{#if filteredTimeline.length === 0}
						<p class="admin-hint">No events match.</p>
					{:else}
						<!-- A named, focusable scroll region: WebKit does not make a scroll container keyboard-focusable, so without tabindex its hidden columns were unreachable by keyboard. -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<div class="table-scroll" role="region" aria-label="Timeline — {timelineFor?.email ?? ''}" tabindex="0">
							<table class="admin-table">
								<thead><tr><th>When</th><th>Action</th><th>Outcome</th><th>ms</th><th>Persona</th><th>Credits / cost</th><th>Client</th><th>Detail</th></tr></thead>
								<tbody>
									{#each filteredTimeline as r (r.id)}
										<tr class:negative={r.outcome !== 'ok'}>
											<td class="nowrap">{when(r.occurred_at)}</td>
											<td><span class="kind-pill kind-{r.category}">{r.category}</span> {r.action}<span class="muted small"> {r.actor_kind !== 'user' ? r.actor_kind : ''}</span></td>
											<td>{r.outcome}{r.status_code ? ` ${r.status_code}` : ''}{r.error_code ? ` ${r.error_code}` : ''}</td>
											<td class="nowrap">{r.duration_ms ?? '—'}</td>
											<td>{r.persona ?? '—'}</td>
											<td class="nowrap">{r.credits_delta != null ? `${r.credits_delta} cr` : r.est_cost_usd ? money(r.est_cost_usd) : '—'}</td>
											<td class="nowrap small">{r.device ?? ''} {r.country ?? ''}</td>
											<td class="small mono">{(r.route_id ?? '').replace('/(portal)', '')} {Object.keys(r.meta ?? {}).length ? JSON.stringify(r.meta) : ''}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				{/if}
			</section>
		{/if}

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
					<!-- A named, focusable scroll region: WebKit does not make a scroll container keyboard-focusable, so without tabindex its hidden columns were unreachable by keyboard. -->
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<div class="table-scroll" role="region" aria-label="Ledger — {ledgerFor?.email ?? ''}" tabindex="0">
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
					<button class="filter-btn" class:active={activityFilter === k} aria-pressed={activityFilter === k} onclick={() => (activityFilter = k as any)}>{label}</button>
				{/each}
			</div>
			{#if filteredActivity.length === 0}
				<p class="admin-hint">Nothing matches this filter.</p>
			{:else}
				<!-- A named, focusable scroll region: WebKit does not make a scroll container keyboard-focusable, so without tabindex its hidden columns were unreachable by keyboard. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div class="table-scroll" role="region" aria-label="Activity log" tabindex="0">
				<table class="admin-table">
					<thead><tr><th>When</th><th>Who</th><th>Type</th><th>Detail</th><th>Persona</th><th>Cost</th></tr></thead>
					<tbody>
						{#each filteredActivity as a (a.id)}
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
				</div>
			{/if}
		</section>
	{:else if tab === 'seats'}
		<section class="admin-card">
			<h2>Seats</h2>
			<p class="admin-hint">
				Roles and spend caps are edited in <a href="/settings?section=team">Settings → Team</a>.
			</p>
			<!-- A named, focusable scroll region: WebKit does not make a scroll container keyboard-focusable, so without tabindex its hidden columns were unreachable by keyboard. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div class="table-scroll" role="region" aria-label="Seats" tabindex="0">
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
			</div>
		</section>

		{#if data.pendingInvites.length > 0}
			<section class="admin-card">
				<h2>Pending invites</h2>
				<!-- A named, focusable scroll region: WebKit does not make a scroll container keyboard-focusable, so without tabindex its hidden columns were unreachable by keyboard. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div class="table-scroll" role="region" aria-label="Pending invites" tabindex="0">
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
				</div>
			</section>
		{/if}
	{:else if tab === 'spend'}
		<section class="admin-card">
			<h2>Charged this month — by seat</h2>
			{#if data.spendByActor.length === 0}
				<p class="admin-hint">No spend recorded this month.</p>
			{:else}
				<!-- A named, focusable scroll region: WebKit does not make a scroll container keyboard-focusable, so without tabindex its hidden columns were unreachable by keyboard. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div class="table-scroll" role="region" aria-label="Charged this month, by seat" tabindex="0">
				<table class="admin-table">
					<thead><tr><th>Seat</th><th>Spend</th></tr></thead>
					<tbody>
						{#each data.spendByActor as row (row.actor)}
							<tr><td class="mono">{row.actor}</td><td>{charged(row.credits)}</td></tr>
						{/each}
					</tbody>
				</table>
				</div>
			{/if}
		</section>
		<section class="admin-card">
			<h2>Charged this month — by persona</h2>
			{#if data.spendByPersona.length === 0}
				<p class="admin-hint">No spend recorded this month.</p>
			{:else}
				<!-- A named, focusable scroll region: WebKit does not make a scroll container keyboard-focusable, so without tabindex its hidden columns were unreachable by keyboard. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div class="table-scroll" role="region" aria-label="Charged this month, by persona" tabindex="0">
				<table class="admin-table">
					<thead><tr><th>Persona</th><th>Spend</th></tr></thead>
					<tbody>
						{#each data.spendByPersona as row (row.persona)}
							<tr><td>{row.persona}</td><td>{charged(row.credits)}</td></tr>
						{/each}
					</tbody>
				</table>
				</div>
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
				<!-- A named, focusable scroll region: WebKit does not make a scroll container keyboard-focusable, so without tabindex its hidden columns were unreachable by keyboard. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div class="table-scroll" role="region" aria-label="API keys issued by this team" tabindex="0">
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
				</div>
			{/if}
		</section>
	{/if}
	</div>
</PageShell>

<style>
	.admin-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
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
	.admin-table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
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
	.kind-publish { background: color-mix(in srgb, #16a34a 10%, transparent); color: var(--success-text); } /* 18% tint under the AA green measured 4.47:1; 10% clears it */
	.filter-row { display: flex; gap: 0.4rem; flex-wrap: wrap; }
	.filter-btn {
		background: var(--surface-2); border: 1px solid var(--border);
		border-radius: 999px; padding: 0.3rem 0.8rem; font-size: 0.82rem;
		font-weight: 600; color: var(--text-muted); cursor: pointer;
	}
	.filter-btn.active { background: var(--accent-dark); border-color: var(--accent-dark); color: #fff; }
	.admin-link {
		align-self: flex-start; background: none; border: none;
		color: var(--accent-text); font-weight: 600; font-size: 0.85rem; cursor: pointer; padding: 0;
	}
	/* ── Platform · Credits tab ─────────────────────────────────────────── */
	.tab-group-label {
		font-size: 0.7rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		/* A dim colour that still clears AA — opacity 0.55 measured 3.91:1. */
		color: var(--text-muted);
		margin: 0.9rem 0 0.35rem;
	}
	.platform-tab-item {
		border-color: rgba(99, 102, 241, 0.35);
	}
	a.admin-tab {
		text-decoration: none;
	}
	.control-grid {
		display: grid;
		/* min(18rem, 100%): an 18rem floor made 288px cards in a 210px column at 320. */
		grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr));
		gap: 0.9rem;
		margin-top: 0.75rem;
	}
	.control {
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 10px;
		padding: 0.85rem;
		background: rgba(255, 255, 255, 0.02);
	}
	.control-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.35rem;
		flex-wrap: wrap;
	}
	.sub {
		font-size: 0.95rem;
		margin: 1.2rem 0 0.4rem;
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
		color: var(--warning-text); /* "N dropped" was 2.77:1 */
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
	/* Platform provider keys — a read-only inventory, so it is styled as a
	   sub-section of the controls card rather than as its own card. */
	.pkeys {
		margin: var(--space-5) 0 var(--space-4);
	}
	.pkeys h3 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-md);
		font-weight: 700;
	}
	/* The explanation for a row sits directly under it, sharing its full width,
	   so the reason a key is flagged never ends up in a truncated cell. */
	.pkeys-scroll {
		overflow-x: auto;
		max-width: 100%;
	}
	.pkeys-scroll:focus-visible {
		outline: 2px solid var(--focus-ring);
		outline-offset: 2px;
	}
	.topup-req-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.topup-req-list li {
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.topup-req-list p {
		margin: var(--space-1) 0 0;
		overflow-wrap: anywhere;
	}
	.pkey-problem td {
		padding-top: 0;
		border-top: none;
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
	/* The REGION scrolls, not the table: `.admin-table{display:block;overflow-x:auto}`
	   made every table its own unnamed scroller (a re-audit found the named
	   provider-keys region never scrolled at all), and WebKit gave those no Tab stop. */
	.temp-pw {
		margin: 0 0 var(--space-3);
		padding: 0.75rem 1rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-xs);
		background: var(--surface-2);
	}
	.temp-pw p {
		margin: 0 0 0.5rem;
	}
	.temp-pw-value {
		display: inline-block;
		margin-right: 0.75rem;
		padding: 0.2rem 0.5rem;
		font-size: 1rem;
		user-select: all;
	}
	.table-scroll {
		overflow-x: auto;
		max-width: 100%;
	}
	/* A JSON value (a price map, a model list) is one unbroken token: it set the
	   whole table thousands of pixels wide. Values wrap inside a bounded column. */
	.hist-table td.mono {
		max-width: 28ch;
		overflow-wrap: anywhere;
		word-break: break-word;
	}
	.table-scroll:focus-visible {
		outline: 2px solid var(--focus-ring);
		outline-offset: 2px;
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
	.kind-online {
		background: rgba(34, 197, 94, 0.22);
	}
	.pos {
		color: #4ade80;
	}
	.neg {
		color: var(--error-text); /* #f87171 on white was 2.77:1 */
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
	/* 320px: the Controls tab overflowed by 9px (hint text + currency select). */
	.admin-card {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.admin-card select,
	.admin-card .admin-input {
		max-width: 100%;
	}
</style>
