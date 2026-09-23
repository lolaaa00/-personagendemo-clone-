import type { PageServerLoad } from './$types';
import { creditMarkup } from '$lib/server/flags';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { outcomeStepsUsd, type PostOutcome } from '$lib/server/outcome-prices';
import { retailCreditsFor, retailCreditsForStep } from '$lib/billing-packs';
import { formatCredits, resolveDisplayCurrency, localeFromAcceptLanguage, type FxRates } from '$lib/money';
import { getSettings } from '$lib/server/settings';
import { priceOf } from '$lib/pricing';

/**
 * The landing page's prices — the receipt table, the queue mock and the
 * media-wallet FAQ — from the SAME registry defaults the composer quotes from
 * (server/outcome-prices.ts), at the platform markup, rounded per stage as the
 * ledger debits. They were string literals kept in step with a static table
 * that had drifted from the registry: "$1.58 for a video post" that no format
 * in the product costs (round-2 re-audit).
 */
export const load: PageServerLoad = async ({ request }) => {
	const markup = creditMarkup();
	let credits: Record<PostOutcome, number>;
	try {
		const steps = await outcomeStepsUsd(getServiceSupabase(), null);
		const sum = (k: PostOutcome) => steps[k].reduce((s, usd) => s + retailCreditsForStep(usd, markup), 0);
		credits = { textPost: sum('textPost'), imagePost: sum('imagePost'), videoPost: sum('videoPost'), talkingHead: sum('talkingHead') };
	} catch {
		// Never-brick: without a database the static table still answers.
		credits = {
			// Two writing passes — a text post is never free.
			textPost: 2 * retailCreditsForStep(priceOf('openrouter', 'llm'), markup),
			imagePost: retailCreditsFor('imagePost', markup),
			videoPost: retailCreditsFor('videoPost', markup),
			talkingHead: retailCreditsFor('talkingHead', markup)
		};
	}
	// In the VISITOR's currency, resolved exactly as the portal resolves it — a
	// Manila visitor read "$0.04" here and "₱2.30" on the first screen inside
	// (re-audit). Never-brick: any failure prints USD.
	let currency = 'USD';
	let fx: FxRates | null = null;
	let locale: string | undefined = 'en-US';
	try {
		const settings = getSettings();
		const acceptLanguage = request.headers.get('accept-language');
		currency = resolveDisplayCurrency({
			preference: null,
			country: request.headers.get('cf-ipcountry'),
			acceptLanguage,
			platformDefault: settings.display_currency_default
		});
		fx = settings.fx_rates ?? null;
		locale = localeFromAcceptLanguage(acceptLanguage) ?? 'en-US';
	} catch {
		currency = 'USD';
	}
	const usd = (c: number) => formatCredits(c, currency, fx, locale, { whole: false });
	return {
		receipt: {
			credits,
			text: usd(credits.textPost),
			sixText: usd(6 * credits.textPost),
			image: usd(credits.imagePost),
			video: usd(credits.videoPost),
			talkingHead: usd(credits.talkingHead)
		}
	};
};
