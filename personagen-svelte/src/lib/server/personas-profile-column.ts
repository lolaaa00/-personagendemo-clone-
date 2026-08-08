/**
 * Never-brick guard for the `agents.personas_profile` JSONB column.
 *
 * The column is introduced by `supabase/personas_profile_migration.sql`. Code and
 * schema do not deploy atomically: a build can reach production minutes before the
 * migration is applied, and self-hosted/client databases get bootstrapped on their
 * own schedule. Writing to a column PostgREST doesn't know about fails the whole
 * statement — which would take out persona creation and every profile save, the two
 * paths least acceptable to break.
 *
 * So writes go out WITH the column, and on a missing-column error only, retry
 * without it. `market` is written either way, so nothing is lost in the fallback —
 * `readPersonaProfile()` falls back to parsing `market`, which is exactly the
 * pre-migration behaviour. Once the migration lands, the first attempt succeeds and
 * this costs nothing.
 *
 * Detection is on the PostgREST error, not a schema probe: probing would add a
 * round-trip to every write, and the error is unambiguous (42703 = undefined_column).
 */

export const PERSONAS_PROFILE_COLUMN = 'personas_profile';

/**
 * True when an error is Postgres/PostgREST complaining that `personas_profile`
 * does not exist. Deliberately narrow — any other failure must still surface.
 */
export function isMissingPersonasProfileColumn(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const e = error as { code?: string; message?: string };
	const code = e.code ?? '';
	const message = (e.message ?? '').toLowerCase();
	// 42703 is Postgres `undefined_column`; PG* codes come through PostgREST as-is.
	// PostgREST also emits PGRST204 ("column not found in schema cache") when its
	// cached schema predates the migration even though the column now exists.
	const isUndefinedColumnCode = code === '42703' || code === 'PGRST204';
	const namesOurColumn = message.includes(PERSONAS_PROFILE_COLUMN);
	const saysMissing =
		message.includes('does not exist') ||
		message.includes('could not find') ||
		message.includes('not found') ||
		message.includes('unknown column');

	// An undefined-column code that names our column is conclusive. Some drivers
	// send the code with an empty message, which we also accept — the payload only
	// ever adds this one column, so it is the only candidate.
	if (isUndefinedColumnCode) return namesOurColumn || message === '';
	// No usable code: fall back to matching a message that both names the column
	// and says it is missing.
	return namesOurColumn && saysMissing;
}

/** Returns a shallow copy of `payload` without the `personas_profile` key. */
export function withoutPersonasProfile<T extends Record<string, unknown>>(
	payload: T
): Omit<T, 'personas_profile'> {
	const { [PERSONAS_PROFILE_COLUMN]: _dropped, ...rest } = payload as Record<string, unknown>;
	return rest as Omit<T, 'personas_profile'>;
}

/**
 * Runs `write(payload)`; if it fails only because `personas_profile` is missing,
 * retries once with that key stripped and reports it. `market` still carries the
 * profile, so the retry is lossless.
 */
// `PromiseLike`, not `Promise`: Supabase query builders are thenables, not real
// promises. `R extends { error: any }` preserves the caller's own error type, so
// `result.error.message` still type-checks at the call site.
export async function writeWithProfileFallback<R extends { error: any }>(
	payload: Record<string, unknown>,
	write: (p: Record<string, unknown>) => PromiseLike<R>
): Promise<R> {
	const first = await write(payload);
	if (!first.error || !isMissingPersonasProfileColumn(first.error)) return first;
	console.warn(
		'[personas_profile] column missing — retrying without it and relying on `market`. ' +
			'Apply supabase/personas_profile_migration.sql to enable the JSONB column.'
	);
	return write(withoutPersonasProfile(payload));
}
