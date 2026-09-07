import { replaceState } from '$app/navigation';

/**
 * Mirror a piece of view state (active tab, calendar view, …) into a query param.
 *
 * Tabs and view switches used to live only in component state, so a refresh, a
 * Back press or a pasted link always dropped the user back on the default view.
 * `replaceState` is deliberate: switching tabs shouldn't stack history entries
 * that make Back feel broken — it should restore where you were.
 *
 * Passing the current value as `defaultValue` keeps the URL clean (no `?tab=overview`
 * on first load) while still round-tripping every non-default state.
 */
export function syncParam(key: string, value: string | null, defaultValue?: string): void {
	if (typeof window === 'undefined') return;

	const url = new URL(window.location.href);
	const current = url.searchParams.get(key);
	const next = value === defaultValue || value == null ? null : value;
	if (current === next) return;

	if (next === null) url.searchParams.delete(key);
	else url.searchParams.set(key, next);

	try {
		replaceState(url, {});
	} catch {
		// replaceState throws if the SvelteKit router isn't initialised yet
		// (e.g. an effect firing during the very first hydration pass).
		window.history.replaceState({}, '', url);
	}
}

/** Read a query param, constrained to a known set of values. */
export function readParam<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
	if (typeof window === 'undefined') return fallback;
	const raw = new URL(window.location.href).searchParams.get(key);
	// An absent param is the fallback, full stop. `includes(raw ?? '')` used to
	// return the raw null whenever '' was itself an allowed value.
	if (raw === null) return fallback;
	return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}
