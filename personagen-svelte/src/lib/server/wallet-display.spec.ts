/**
 * The sidebar pill must name the wallet that actually pays.
 *
 * A client reported that generating never moved their balance. It was true and
 * it was not a billing failure: they are an admin member of a workspace they do
 * not own, the owner's wallet was debited on every run, and the pill was reading
 * their own untouched account. Measured at the time: 79 of 81 attributed
 * generation events billed an account other than the one that ran them.
 *
 * These tests pin the precedence against resolveBillingAccount's — ownership
 * first — because the failure mode is the two rules drifting apart, not either
 * one being wrong on its own.
 */
import { describe, it, expect } from 'vitest';
import { walletToDisplay, type WorkspaceWallet } from './wallet-display';

const ME = 'user-me';
const OWNER = 'user-owner';

function ws(over: Partial<WorkspaceWallet> = {}): WorkspaceWallet {
	return {
		workspace_id: 'ws-1',
		workspace_name: 'HoneyX',
		owner_id: OWNER,
		role: 'admin',
		balance_credits: 1736,
		billing_mode: 'credits',
		...over
	};
}

describe('a member sees the wallet that pays for their work', () => {
	it('shows the owner balance, not the untouched personal one', () => {
		const w = walletToDisplay(ME, { balance_credits: 2000, billing_mode: 'credits' }, [ws()]);
		expect(w.balance).toBe(1736);
		expect(w.paidBy).toBe('HoneyX');
	});

	it('carries the owner billing mode, so a comped workspace reads as comped', () => {
		const w = walletToDisplay(ME, { balance_credits: 2000, billing_mode: 'credits' }, [
			ws({ billing_mode: 'unmetered' })
		]);
		expect(w.billingMode).toBe('unmetered');
	});

	it('names the workspace even when the row has no name', () => {
		// The pill substitutes this label for "Balance". An empty string would
		// render a pill with no label at all.
		const w = walletToDisplay(ME, null, [ws({ workspace_name: '' })]);
		expect(w.paidBy).toBeTruthy();
	});
});

describe('ownership comes first, exactly as resolveBillingAccount resolves it', () => {
	it('keeps the personal wallet for someone who owns the workspace', () => {
		const w = walletToDisplay(ME, { balance_credits: 2000, billing_mode: 'credits' }, [
			ws({ owner_id: ME, role: 'owner' })
		]);
		expect(w.balance).toBe(2000);
		expect(w.paidBy).toBeNull();
	});

	it('keeps the personal wallet when the user owns one workspace and sits in another', () => {
		// There is no single paying wallet here. Showing the one they can top up
		// is the honest answer; /billing lists every workspace in full.
		const w = walletToDisplay(ME, { balance_credits: 2000, billing_mode: 'credits' }, [
			ws({ workspace_id: 'ws-mine', owner_id: ME, role: 'owner' }),
			ws()
		]);
		expect(w.paidBy).toBeNull();
		expect(w.balance).toBe(2000);
	});

	it('does not pick arbitrarily between two foreign owners', () => {
		const w = walletToDisplay(ME, { balance_credits: 2000, billing_mode: 'credits' }, [
			ws({ workspace_id: 'ws-a', owner_id: 'owner-a', workspace_name: 'A' }),
			ws({ workspace_id: 'ws-b', owner_id: 'owner-b', workspace_name: 'B' })
		]);
		expect(w.paidBy).toBeNull();
		expect(w.balance).toBe(2000);
	});

	it('shows one owner wallet even across several of that owner workspaces', () => {
		const w = walletToDisplay(ME, { balance_credits: 2000, billing_mode: 'credits' }, [
			ws({ workspace_id: 'ws-a', workspace_name: 'A', balance_credits: 500 }),
			ws({ workspace_id: 'ws-b', workspace_name: 'B', balance_credits: 500 })
		]);
		expect(w.paidBy).toBe('A');
	});
});

describe('a personal account is unaffected', () => {
	it('shows its own wallet with no caveat when it belongs to no workspace', () => {
		const w = walletToDisplay(ME, { balance_credits: 4998, billing_mode: 'credits' }, []);
		expect(w.balance).toBe(4998);
		expect(w.paidBy).toBeNull();
	});

	it('survives an unreadable wallet and an unreadable RPC', () => {
		// Never-brick: a failed read renders a zero balance, not a broken sidebar.
		const w = walletToDisplay(ME, null, null);
		expect(w).toEqual({ balance: 0, billingMode: 'credits', paidBy: null });
	});

	it('coerces a string balance, which is how postgres numerics arrive', () => {
		const w = walletToDisplay(ME, { balance_credits: '1736' }, null);
		expect(w.balance).toBe(1736);
	});
});
