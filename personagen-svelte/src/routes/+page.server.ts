import type { PageServerLoad } from './$types';
import { creditMarkup } from '$lib/server/flags';
import { getServiceSupabase } from '$lib/server/service-supabase';
import { outcomeStepsUsd, type PostOutcome } from '$lib/server/outcome-prices';
import { retailCreditsFor, retailCreditsForStep } from '$lib/billing-packs';
import { formatCredits } from '$lib/money';
import { priceOf } from '$lib/pricing';

/**
 * The landing page's prices — the receipt table, the queue mock and the
 * media-wallet FAQ — from the SAME registry defaults the composer quotes from
 * (server/outcome-prices.ts), at the platform markup, rounded per stage as the
 * ledger debits. They were string literals kept in step with a static table
 * that had drifted from the registry: "$1.58 for a video post" that no format
 * in the product costs (round-2 re-audit).
 */
export const load: PageServerLoad = async () => {
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
	const usd = (c: number) => formatCredits(c, 'USD', null, 'en-US', { whole: false });
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
