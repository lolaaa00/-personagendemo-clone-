/**
 * Which wallet the sidebar pill should show.
 *
 * The pill read `credit_accounts` for the signed-in user. Generations bill
 * `resolveBillingAccount()` (credits.ts), which walks persona → workspace →
 * OWNER. For anyone who is a member of a workspace they do not own, those are
 * two different wallets, and the one on screen is the one that never moves.
 *
 * Measured on production before this was written: of 81 attributed generation
 * events, 79 were billed to an account other than the one that ran them. The
 * member watching the pill saw 2,000 credits and a last movement three weeks
 * old while the wallet actually paying dropped eight times that evening. The
 * money was correct the whole time and the display was pointed at the wrong
 * row, which reads to a customer as "billing is broken" — the most expensive
 * possible way to be wrong about money.
 *
 * The precedence here mirrors resolveBillingAccount deliberately: ownership
 * first. If the two ever disagree the pill lies again, so they are tested
 * against the same rule rather than merely written to match.
 */

/** A row from the `workspace_wallets` RPC — balance and mode only, never a ledger. */
export interface WorkspaceWallet {
	workspace_id: string;
	workspace_name: string;
	owner_id: string;
	role: string;
	balance_credits: number | string | null;
	billing_mode: string | null;
}

export interface OwnWallet {
	balance_credits?: number | string | null;
	billing_mode?: string | null;
}

export interface DisplayWallet {
	balance: number;
	billingMode: string;
	/**
	 * The workspace whose owner pays, when that is not the signed-in user.
	 * Null means this is the user's own wallet and the pill needs no caveat.
	 */
	paidBy: string | null;
}

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

/**
 * Decide the wallet to display, given the user's own account row and every
 * workspace wallet they can see.
 *
 * Owner first: owning a workspace outranks any membership, matching both
 * resolveBillingAccount and the account badge. A user who owns one workspace
 * and holds a seat in another has no single answer — their own wallet is the
 * one they can top up, and /billing lists the others in full.
 */
export function walletToDisplay(
	userId: string,
	own: OwnWallet | null,
	workspaces: WorkspaceWallet[] | null
): DisplayWallet {
	const mine: DisplayWallet = {
		balance: num(own?.balance_credits),
		billingMode: own?.billing_mode ?? 'credits',
		paidBy: null
	};

	const rows = workspaces ?? [];
	// Owning any workspace at all means the user's own wallet is a paying one.
	if (rows.some((w) => w.owner_id === userId)) return mine;

	const foreign = rows.filter((w) => w.owner_id && w.owner_id !== userId);
	if (foreign.length === 0) return mine;

	// Several owners, no single truth. Keep the wallet the user can actually
	// top up and let /billing enumerate the rest, rather than picking one
	// arbitrarily and being confidently wrong.
	const owners = new Set(foreign.map((w) => w.owner_id));
	if (owners.size > 1) return mine;

	const paying = foreign[0];
	return {
		balance: num(paying.balance_credits),
		billingMode: paying.billing_mode ?? 'credits',
		paidBy: paying.workspace_name || 'your workspace'
	};
}
