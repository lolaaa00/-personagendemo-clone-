import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { creditsMode, creditMarkup, plansEnabled } from '$lib/server/flags';
import { getSettings } from '$lib/server/settings';
import { stripeEnabled } from '$lib/server/stripe';
import { CREDIT_PACKS, whatItBuys, retailCreditsForStep } from '$lib/billing-packs';
import { outcomeStepsUsd } from '$lib/server/outcome-prices';
import { loadPlanCatalog } from '$lib/server/plans';
import { TOPUP_PENDING_STATUS, TOPUP_TITLE_PREFIX } from '$lib/server/topup-requests';
import { resolveDisplayCurrency, creditsToAmount, formatCredits, formatMoney, localeFromAcceptLanguage } from '$lib/money';

/**
 * /billing — the wallet, in the visitor's money.
 *
 * Balance, what it buys, the packs (at par, USD, with the local equivalent
 * beside each), and the recent ledger. RLS scopes the wallet and ledger reads
 * to the caller; nothing here is service-role.
 */
/** One row of the workspace_wallets() function (balance + mode only, never the owner's ledger). */
interface WorkspaceWalletRow {
	workspace_id: string;
	workspace_name: string;
	owner_id: string;
	role: string;
	balance_credits: number | string;
	billing_mode: string;
}

/** One credit_ledger row as this page reads it. */
interface LedgerRow {
	seq: number;
	delta: number | string;
	kind: string;
	balance_after: number | string;
	note: string | null;
	created_at: string;
}

export const load: PageServerLoad = async ({ locals, request, url }) => {
	const { session, user } = await locals.safeGetSession();
	if (!session || !user) throw redirect(303, '/login');

	const s = getSettings();
	const markup = creditMarkup();
	const acceptLanguage = request.headers.get('accept-language');
	const locale = localeFromAcceptLanguage(acceptLanguage);

	const [{ data: wallet }, { data: profile }, { data: ledger }, { data: wsWallets }, { data: subscription }, catalog] = await Promise.all([
		locals.supabase.from('credit_accounts').select('balance_credits, billing_mode, updated_at').eq('user_id', user.id).maybeSingle(),
		locals.supabase.from('profiles').select('display_currency').eq('id', user.id).maybeSingle(),
		locals.supabase
			.from('credit_ledger')
			.select('seq, delta, kind, balance_after, note, created_at')
			.eq('user_id', user.id)
			.order('seq', { ascending: false })
			.limit(40),
		// Workspaces this user belongs to, with the OWNER's balance (owner pays):
		// SECURITY DEFINER function, balance + mode only, never the owner's ledger.
		locals.supabase.rpc('workspace_wallets'),
		// Own subscription row (RLS: select own) and the plan catalog (service-only table).
		locals.supabase.from('subscriptions').select('plan, status, current_period_end, included_credits, cancel_at_period_end, stripe_subscription_id').eq('user_id', user.id).maybeSingle(),
		loadPlanCatalog()
	]);

	const currency = resolveDisplayCurrency({
		preference: profile?.display_currency ?? null,
		country: request.headers.get('cf-ipcountry'),
		acceptLanguage,
		platformDefault: s.display_currency_default
	});
	const balance = Number(wallet?.balance_credits ?? 0);
	// Priced from the live registry, like the composer — not the static table.
	const live = await outcomeStepsUsd(locals.supabase, user.id);
	const buys = whatItBuys(Math.max(balance, 0), markup, live);
	const textPostCredits = live.textPost.reduce((s, usd) => s + retailCreditsForStep(usd, markup), 0);

	return {
		mode: creditsMode(),
		billingMode: wallet?.billing_mode ?? 'credits',
		currency,
		locale: locale ?? null,
		balance,
		// Exact on the money page (the sidebar pill rounds to whole units by design).
		balanceFormatted: formatCredits(balance, currency, s.fx_rates, locale, { whole: false }),
		balanceUsd: formatCredits(balance, 'USD', s.fx_rates, 'en-US', { whole: false }),
		buys: { imagePosts: buys.imagePosts, videoPosts: buys.videoPosts, talkingHeads: buys.talkingHeads },
		// "about eight cents" was USD prose on a page that speaks the viewer's
		// currency (re-audit: beside ₱5.01 text tiles). Same price, their money.
		textPostPrice: formatCredits(textPostCredits, currency, s.fx_rates, locale, { whole: false }),
		paymentsOpen: stripeEnabled(),
		// Open top-up requests this account has made (private: RLS select-own).
		topupRequests: await pendingTopups(locals.supabase, user.id),
		packs: CREDIT_PACKS.map((p) => ({
			...p,
			usd: formatMoney(p.usdCents / 100, 'USD', 'en-US'),
			// Real cents, like the balance above them (audit QA-002): whole-unit
			// rounding printed "$10.00 ≈ ₱627.00" on the same screen as a balance of
			// "₱626.50 · exactly $10.00".
			local:
				currency === 'USD'
					? null
					: formatMoney(creditsToAmount(p.usdCents, currency, s.fx_rates), currency, locale, { whole: false }),
			worth: formatCredits(p.credits, currency, s.fx_rates, locale, { whole: false }),
			buys: whatItBuys(p.credits, markup, live)
		})),
		ledger: (ledger ?? []).map((r: LedgerRow) => ({
			seq: r.seq,
			kind: r.kind,
			note: r.note,
			created_at: r.created_at,
			delta: Number(r.delta),
			deltaFormatted: formatCredits(Math.abs(Number(r.delta)), currency, s.fx_rates, locale, { whole: false }),
			after: formatCredits(Number(r.balance_after), currency, s.fx_rates, locale, { whole: false })
		})),
		status: url.searchParams.get('status'),
		wantedPlan: url.searchParams.get('plan'),
		markup,
		plans: {
			enabled: plansEnabled() && stripeEnabled(),
			current: subscription && (subscription.status === 'active' || subscription.status === 'trialing') && subscription.plan !== 'free'
				? {
						plan: subscription.plan,
						status: subscription.status,
						periodEnd: subscription.current_period_end,
						cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
						// A comped or hand-granted plan has nothing at Stripe to cancel; offering
						// the button would be a dead end that answers 404.
						cancellable: Boolean(subscription.stripe_subscription_id),
						included: formatCredits(Number(subscription.included_credits ?? 0), currency, s.fx_rates, locale)
					}
				: null,
			catalog: catalog
				.filter((p) => p.active && p.price_usd_cents > 0)
				.map((p) => ({
					plan: p.plan,
					name: p.name,
					usd: formatMoney(p.price_usd_cents / 100, 'USD', 'en-US'),
					local: currency === 'USD' ? null : formatMoney(creditsToAmount(p.price_usd_cents, currency, s.fx_rates), currency, locale),
					included: formatCredits(p.included_credits, currency, s.fx_rates, locale),
					personaLimit: p.persona_limit,
					features: p.features
				}))
		},
		workspaces: ((wsWallets as WorkspaceWalletRow[]) ?? [])
			.filter((w) => w.owner_id !== user.id)
			.map((w) => ({
				id: w.workspace_id,
				name: w.workspace_name,
				role: w.role,
				billingMode: w.billing_mode,
				balance: Number(w.balance_credits ?? 0),
				formatted: w.billing_mode === 'unmetered' ? '∞' : formatCredits(Number(w.balance_credits ?? 0), currency, s.fx_rates, locale, { whole: false })
			}))
	};
};


/** This account's open top-up requests, newest first. Never throws. */
async function pendingTopups(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Supabase client is untyped across this codebase
	supabase: any,
	userId: string
): Promise<Array<{ id: string; title: string; created_at: string }>> {
	try {
		const { data } = await supabase
			.from('tickets')
			.select('id, title, created_at')
			.eq('user_id', userId)
			.eq('status', TOPUP_PENDING_STATUS)
			.like('title', `${TOPUP_TITLE_PREFIX}%`)
			.order('created_at', { ascending: false })
			.limit(10);
		return data ?? [];
	} catch {
		return [];
	}
}
