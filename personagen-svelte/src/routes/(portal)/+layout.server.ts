import type { LayoutServerLoad } from './$types';
import { entitlementsFor, UNRESTRICTED } from '$lib/server/entitlements';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { checkConfigStatus } from '$lib/server/config-check';
import { isPlatformAdmin as checkPlatformAdmin } from '$lib/server/platform-admin';
import { creditsMode, creditMarkup } from '$lib/server/flags';
import { getSettings } from '$lib/server/settings';
import { resolveDisplayCurrency, creditsToAmount, formatCredits, localeFromAcceptLanguage } from '$lib/money';

export const load: LayoutServerLoad = async ({ locals, request }) => {
	const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
	const isPlaceholder = !supabaseUrl || supabaseUrl.includes('placeholder');

	if (isPlaceholder) {
		return {
			session: null,
			user: null,
			configStatus: checkConfigStatus(),
			sidebarAgents: [],
			personaGroups: [],
			pendingInvites: [],
			badgeLabel: 'Personal account',
			mustChangePassword: false,
			isWorkspaceAdmin: false,
			isPlatformAdmin: false,
			// Never-brick default: an unreadable plan restricts nothing.
			entitlements: { plan: 'free', ...UNRESTRICTED }
		};
	}

	try {
		const { session, user } = await locals.safeGetSession();
		if (!session || !user) throw redirect(303, '/login');

		let sidebarAgents: any[] = [];
		let personaGroups: any[] = [];
		let pendingInvites: any[] = [];
		if (locals.supabase) {
			// Lean projection: the sidebar roster only renders these fields (see
			// +layout.svelte) — never the large soul/skills/tools/market text, so
			// don't ship every agent's full row on every navigation. Pages that
			// need full agent rows load them in their own server loads.
			// `is_overseer IS NOT TRUE` matches the old `!a.is_overseer` filter
			// (keeps rows where the column is false OR null).
			const [{ data: agents }, { data: groups }] = await Promise.all([
				locals.supabase
					.from('agents')
					.select('id, name, handle, initial, gradient, status, is_overseer, group_id, is_favorite')
					.not('is_overseer', 'is', true)
					.order('created_at', { ascending: false }),
				locals.supabase
					.from('persona_groups')
					.select('id, name')
					.eq('user_id', user.id)
					.order('name', { ascending: true })
			]);
			personaGroups = groups ?? [];
			const creatorAgents = (agents ?? []).filter((a: any) => !a.is_overseer);

			const agentIds = creatorAgents.map((a: any) => a.id);
			const { data: configs } = agentIds.length
				? await locals.supabase
						.from('agent_configs')
						.select('agent_id, ugc_character_ref')
						.in('agent_id', agentIds)
				: { data: [] };
			const characterRefById = new Map(
				(configs ?? []).map((c: any) => [c.agent_id, c.ugc_character_ref])
			);

			sidebarAgents = creatorAgents.map((a: any) => ({
				id: a.id,
				name: a.name,
				handle: a.handle,
				initial: a.initial,
				gradient: a.gradient,
				status: a.status,
				group_id: a.group_id ?? null,
				is_favorite: a.is_favorite ?? false,
				ugc_character_ref: characterRefById.get(a.id) ?? null
			}));

			// Surfaces "you've been invited to X" the moment a brand-new, otherwise
			// blank account logs in — RLS scopes this to invites whose email matches
			// the caller's own verified JWT email, nothing client-supplied.
			const { data: invites } = await locals.supabase
				.from('workspace_invites')
				.select('id, token, role, expires_at, workspaces(name)')
				.eq('status', 'pending')
				.order('created_at', { ascending: false });
			pendingInvites = (invites ?? []).filter(
				(i: any) => !i.expires_at || new Date(i.expires_at).getTime() > Date.now()
			);
		}

		// Replaces the old static "Managed Plan · Active" filler (never backed by
		// real data — there's no plan/subscription system) with the one piece of
		// account context that's actually true and useful: what this session
		// IS, ownership-first since owning a workspace outranks any membership.
		let badgeLabel = 'Personal account';
		// Drives the admin-only nav entry: owning a workspace, or holding an
		// admin seat in one, is what unlocks /admin.
		let isWorkspaceAdmin = false;
		if (locals.supabase) {
			const [{ data: owned }, { data: memberOf }] = await Promise.all([
				locals.supabase.from('workspaces').select('id, name').eq('owner_id', user.id),
				locals.supabase
					.from('workspace_members')
					.select('role, workspaces(name)')
					.eq('user_id', user.id)
			]);
			if (owned && owned.length > 0) {
				badgeLabel =
					owned.length === 1 ? `Owner · ${owned[0].name}` : `Owner · ${owned.length} workspaces`;
			} else if (memberOf && memberOf.length > 0) {
				const m = memberOf[0] as any;
				const role = String(m.role || '').replace(/^\w/, (c) => c.toUpperCase());
				badgeLabel = `${role} · ${m.workspaces?.name ?? 'Workspace'}`;
			}
			isWorkspaceAdmin =
				(owned?.length ?? 0) > 0 || (memberOf ?? []).some((m: any) => m.role === 'admin');
		}

		// Platform admin (cross-tenant operator) — unlocks the Platform tab on
		// /admin and the Model Manager. Fails closed inside the helper.
		const isPlatformAdmin = locals.supabase ? await checkPlatformAdmin(locals.supabase, user) : false;

		// Credit balance for the sidebar pill, shown as MONEY in the visitor's
		// currency ("Credits $20.00"): saved preference → country header →
		// Accept-Language → platform default → USD. Rates come from the stored
		// FX table (display only; the wallet is always USD cents). RLS lets a
		// user read their own wallet; no row yet = $0.00. Off = no pill, no query.
		const mode = creditsMode();
		// Pricing context for every screen that quotes a generation BEFORE it runs.
		// Resolved here (not per-component) so no screen can render a provider cost
		// where the customer will be charged retail — see stores/pricing.svelte.ts.
		const pricingSettings = getSettings();
		const pricingAcceptLanguage = request.headers.get('accept-language');
		const pricing = {
			markup: creditMarkup(),
			currency: resolveDisplayCurrency({
				preference: null,
				country: request.headers.get('cf-ipcountry'),
				acceptLanguage: pricingAcceptLanguage,
				platformDefault: pricingSettings.display_currency_default
			}),
			fx: pricingSettings.fx_rates ?? null,
			locale: localeFromAcceptLanguage(pricingAcceptLanguage),
			/** Credits are being written (shadow or enforce) — a quote is a real charge. */
			metered: mode !== 'off',
			enforced: mode === 'enforce'
		};
		let credits: {
			balance: number;
			mode: string;
			billing_mode: string;
			currency: string;
			amount: number;
			formatted: string;
			usd: string;
		} | null = null;
		if (mode !== 'off' && locals.supabase) {
			const [{ data: wallet }, { data: profile }] = await Promise.all([
				locals.supabase.from('credit_accounts').select('balance_credits, billing_mode').eq('user_id', user.id).maybeSingle(),
				locals.supabase.from('profiles').select('display_currency').eq('id', user.id).maybeSingle()
			]);
			const s = getSettings();
			const acceptLanguage = request.headers.get('accept-language');
			const currency = resolveDisplayCurrency({
				preference: profile?.display_currency ?? null,
				country: request.headers.get('cf-ipcountry'),
				acceptLanguage,
				platformDefault: s.display_currency_default
			});
			const locale = localeFromAcceptLanguage(acceptLanguage);
			pricing.currency = currency;
			pricing.locale = locale;
			const balance = Number(wallet?.balance_credits ?? 0);
			credits = {
				balance,
				mode,
				billing_mode: wallet?.billing_mode ?? 'credits',
				currency,
				amount: creditsToAmount(balance, currency, s.fx_rates),
				// Pill: whole units with ".00" (A$28.00). Tooltip: the exact USD balance.
				formatted: formatCredits(balance, currency, s.fx_rates, locale),
				usd: formatCredits(balance, 'USD', s.fx_rates, 'en-US', { whole: false })
			};
		}

		// What this account's plan includes, resolved ONCE for every portal page.
		//
		// Six server routes refuse a feature with 403 PLAN_FEATURE, and until now
		// no client read any of them — so a gated plan produced a refusal on a
		// control that still looked enabled, which reads as a bug rather than a
		// plan limit. This is the presentation half; the server stays authority.
		//
		// Cheap enough to sit here: the plan catalog is cached (plans.ts), so in
		// the steady state this is ONE subscriptions read, and this load does not
		// re-run on client-side navigation — it has no tracked dependencies.
		// Never throws: entitlementsFor resolves fully permissive on any failure,
		// so a database blip cannot lock the UI down.
		const entitlements = await entitlementsFor(user.id);

		return {
			session,
			user,
			configStatus: checkConfigStatus(),
			entitlements,
			sidebarAgents,
			personaGroups,
			pendingInvites,
			badgeLabel,
			isWorkspaceAdmin,
			isPlatformAdmin,
			credits,
			pricing,
			// Provisioned team accounts start on a shared throwaway password with
			// this metadata flag set — the layout blocks with a change-password
			// prompt until /api/settings/password clears it.
			mustChangePassword: Boolean((user.user_metadata as any)?.must_change_password)
		};
	} catch (e) {
		if ((e as any)?.status === 303) throw e;
		console.error('Portal layout auth error:', e);
		return {
			session: null,
			user: null,
			configStatus: checkConfigStatus(),
			sidebarAgents: [],
			personaGroups: [],
			pendingInvites: [],
			badgeLabel: 'Personal account',
			mustChangePassword: false,
			isWorkspaceAdmin: false,
			isPlatformAdmin: false,
			// Never-brick default: an unreadable plan restricts nothing.
			entitlements: { plan: 'free', ...UNRESTRICTED }
		};
	}
};
