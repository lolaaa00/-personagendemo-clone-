import { invalidate } from '$app/navigation';

/**
 * Re-read the sidebar wallet balance.
 *
 * The balance comes from the portal layout's server load, which SvelteKit only
 * re-runs on navigation. A generation debits the wallet server-side and the
 * client never hears about it, so the pill kept showing the pre-generation
 * number until the user happened to navigate — indistinguishable, from the
 * outside, from billing not working at all.
 *
 * Call this after anything that can move the balance. It is a no-op on the
 * server and cheap on the client: one layout load, no full page reload.
 */
export async function refreshCredits(): Promise<void> {
	try {
		await invalidate('app:credits');
	} catch {
		// Never let a refresh failure surface as a generation failure — the
		// generation already succeeded and the number corrects itself on the next
		// navigation.
	}
}
