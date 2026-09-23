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
import { quoteCredits, quoteMoney, formatCredits } from '$lib/money';

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

/** The headline for a multi-step run; matches the debit to the credit. */
export function quoteSteps(stepsUsd: readonly number[], opts?: FormatOptions): string {
	return formatCredits(quoteStepsRaw(stepsUsd), ctx.currency, ctx.fx, ctx.locale, opts ?? { whole: false });
}
