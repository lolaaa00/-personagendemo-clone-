/**
 * Top-up requests — "Ask us to load $X" on Billing while card payments are off.
 *
 * They are rows in `public.tickets`, whose `status` column is constrained:
 *   CHECK (status IN ('backlog', 'in_progress', 'review', 'done'))
 * (supabase/migration.sql). The first version wrote and queried `'open'`, which
 * the constraint rejects — so every request failed with "could not be saved",
 * and the Billing and Admin lists (which filtered on 'open') could never have
 * shown one anyway. A round-2 re-audit found it in the server log. One constant
 * for writers and readers; topup-requests.spec.ts checks it against the SQL.
 */
export const TOPUP_TITLE_PREFIX = 'Top-up request';

/** Not yet handled. `backlog` is the constraint's own "new" state. */
export const TOPUP_PENDING_STATUS = 'backlog' as const;

/**
 * "Report this problem" on a failed post. The failure copy used to end "if it
 * keeps failing, tell us" with no way to — a re-audit found no route to anyone.
 * Same private table, same status rule, its own title prefix.
 */
export const PROBLEM_REPORT_TITLE_PREFIX = 'Problem report';

/** "Ask us to help you sign in" — anonymous, filed under a platform admin. */
export const SIGNIN_HELP_TITLE_PREFIX = 'Sign-in help';
