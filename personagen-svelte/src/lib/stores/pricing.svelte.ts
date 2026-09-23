/**
 * Pricing context — what a screen needs to quote a price instead of a cost.
 *
 * Every surface that shows money before a generation used to render the raw
 * provider estimate (`$0.42`) while the wallet debited retail
 * (`ceil(usd × credit_markup × 100)` credits, shown in the user's currency).
 * Seven screens, one of them the campaign planner's launch button, understated
 * the charge by the whole markup.
 *
 * The fix has to be impossible to get wrong from a component, so the markup and
 * the FX table are primed ONCE per page load from the portal layout — the same
 * place the wallet pill gets them — and every screen calls `quote()`. A
 * component can no longer accidentally print a cost, because it never sees one
 * formatted.
 *
 * Falls back to markup 1 (at cost) if priming ever fails: quoting AT cost when
 * the markup is unknown is the honest direction — it can only ever understate
 * margin, never overcharge the customer relative to what they were shown.
 */
import type { FxRates, PricingContext, FormatOptions } from '$lib/money';
import { quoteCredits, quoteMoney, formatMoney, creditsToAmount } from '$lib/money';

const ctx = $state<PricingContext>({ markup: 1, currency: 'USD', fx: null, locale: undefined });

/**
 * Back to the at-cost defaults. The root layout calls this at the start of
 * every SERVER render: this store is module-level, so on the server it is
 * shared by every request — without a reset, a page outside the portal could
 * render with the currency and markup the previous visitor's render left.
 * (Safe because server rendering is synchronous: no other request's render
 * can interleave between this reset, the portal layout's prime, and the page.)
 */
export function resetPricing(): void {
	ctx.markup = 1;
	ctx.currency = 'USD';
	ctx.fx = null;
	ctx.locale = undefined;
	ctx.timeZone = undefined;
	ctx.metered = undefined;
	ctx.enforced = undefined;
}

/** Primed by the portal layout from server data. Safe to call repeatedly. */
export function primePricing(next: Partial<PricingContext> | null | undefined): void {
	if (!next) return;
	if (typeof next.markup === 'number' && Number.isFinite(next.markup) && next.markup >= 1) {
		ctx.markup = next.markup;
	}
	if (typeof next.currency === 'string' && next.currency) ctx.currency = next.currency;
	if (next.fx !== undefined) ctx.fx = (next.fx as FxRates | null) ?? null;
	if (next.locale !== undefined) ctx.locale = next.locale;
	if (next.timeZone !== undefined) ctx.timeZone = next.timeZone;
	if (next.metered !== undefined) ctx.metered = next.metered;
	if (next.enforced !== undefined) ctx.enforced = next.enforced;
}

/** The live context (reactive). Prefer quote()/quoteRaw() over reading this. */
export function pricingContext(): PricingContext {
	return ctx;
}

/**
 * A provider estimate rendered as what the customer pays, in their currency.
 * This is the ONLY money formatter a pre-spend screen should use.
 */
export function quote(usd: number, opts?: FormatOptions): string {
	return quoteMoney(usd, ctx, opts ?? { whole: false });
}

/** Retail credits for a provider estimate — for totals and comparisons. */
export function quoteRaw(usd: number): number {
	return quoteCredits(usd, ctx);
}

/**
 * Retail credits for a multi-step run, rounded up PER STEP — the way the
 * ledger debits (one event per paid stage, each ceiled). Rounding once on the
 * total quoted a product-motion clip at 362 credits that debited 363.
 */
export function quoteStepsRaw(stepsUsd: readonly number[]): number {
	return stepsUsd.reduce((sum, usd) => sum + quoteCredits(usd, ctx), 0);
}

/**
 * The headline for a multi-step run: the CREDITS the ledger will debit
 * (per-step ceilings, quoteStepsRaw) converted ONCE into the viewer's
 * currency — so the quote is the debit's value to the cent, and the same
 * figure the landing page, Billing and the tiles print for that run.
 *
 * History: round 4 summed each stage's rounded price instead, so the stages
 * on screen added up — and the composer then quoted ₱157.27 for a 251-credit
 * debit worth ₱157.25, and a text post read ₱5.02 beside Billing's ₱5.01
 * (round-5 re-audit). The stage lines now come from quoteStepsLines(), which
 * allocates THIS total across the stages so they still add up exactly.
 */
export function quoteSteps(stepsUsd: readonly number[], opts?: FormatOptions): string {
	return formatMoney(quoteStepsAmount(stepsUsd), ctx.currency, ctx.locale, opts ?? { whole: false });
}

/** The run's total in the viewer's currency (unrounded). */
export function quoteStepsAmount(stepsUsd: readonly number[]): number {
	return creditsToAmount(quoteStepsRaw(stepsUsd), ctx.currency, ctx.fx);
}

/**
 * One price per stage that ADD UP to quoteSteps() exactly: the total's minor
 * units are shared out in proportion to each stage's credits, remainders to
 * the largest fractions first (the way an invoice splits tax). Rounding each
 * stage on its own drifted from the total by a cent or two in PHP and GBP.
 */
export function quoteStepsLines(stepsUsd: readonly number[], opts?: FormatOptions): string[] {
	const credits = stepsUsd.map((usd) => quoteCredits(usd, ctx));
	const totalCredits = credits.reduce((a, b) => a + b, 0);
	const totalMinor = Math.round(creditsToAmount(totalCredits, ctx.currency, ctx.fx) * 100);
	if (totalCredits <= 0 || totalMinor <= 0) {
		return credits.map(() => formatMoney(0, ctx.currency, ctx.locale, opts ?? { whole: false }));
	}
	const exact = credits.map((c) => (totalMinor * c) / totalCredits);
	const floors = exact.map((x) => Math.floor(x));
	let left = totalMinor - floors.reduce((a, b) => a + b, 0);
	const order = exact
		.map((x, i) => ({ i, frac: x - Math.floor(x) }))
		.sort((a, b) => b.frac - a.frac || a.i - b.i);
	for (const { i } of order) {
		if (left <= 0) break;
		floors[i] += 1;
		left -= 1;
	}
	return floors.map((minor) => formatMoney(minor / 100, ctx.currency, ctx.locale, opts ?? { whole: false }));
}
