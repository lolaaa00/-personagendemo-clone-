# Wallet reconciliation before atomic credit renewal

`atomic_credits_migration.sql` separates expiring subscription credit from
purchased/non-expiring credit. Existing positive balances are deliberately left
unclassified (`included_balance_credits IS NULL`); renewal fails closed for
those wallets instead of guessing and deleting money.

## Migration order

1. Back up the database with the normal repository backup command.
2. Apply all migrations through `scripts/apply-migration.mjs`; do not paste only
   fragments of the atomic migration. The migration seeds
   `last_credit_period_start` from the existing subscription period, preventing
   historical invoice replays from granting an old period again.
3. Keep webhook delivery paused or expect affected renewals to return HTTP 500
   while positive legacy wallets remain unclassified. Stripe will retry them.
4. Reconcile and classify every row returned by the inventory query below.
5. Verify there are no positive unclassified wallets, then resume/allow webhook
   retries. Never manually replay a newer invoice before an older failed invoice;
   the database will accept only the newest not-yet-credited period.

No production migration was run as part of this change.

## Inventory

Run read-only queries first and export the results with a timestamp:

```sql
SELECT ca.user_id,
       ca.balance_credits,
       ca.included_balance_credits,
       s.plan,
       s.current_period_start,
       s.current_period_end,
       s.last_included_grant_credits
FROM public.credit_accounts ca
LEFT JOIN public.subscriptions s ON s.user_id = ca.user_id
WHERE ca.balance_credits > 0
  AND ca.included_balance_credits IS NULL
ORDER BY ca.user_id;
```

For each user, export the complete credit ledger, Stripe pack purchases and
refunds, paid subscription invoices, and the subscription period active at each
ledger timestamp. Work from immutable payment records, not the current plan or
the old `last_included_grant_credits` value alone.

## Reconstructing the buckets

Replay each user's events in chronological order:

1. A paid pack adds to purchased credit.
2. A successful subscription invoice starts a new included bucket. Any included
   remainder from the prior period expires; purchased credit carries forward.
3. Usage debits included credit first, then purchased credit.
4. A pack refund removes purchased credit first. If the refund is larger than
   the purchased remainder, document and review the exceptional negative amount.
5. Confirm that `included remainder + purchased remainder` equals the current
   `balance_credits`. Do not classify a mismatch until it is explained.

Classify a reconciled wallet through the audited function. `p_remaining` is the
calculated unspent included amount, not the previous monthly grant:

```sql
SELECT public.credit_classify_included(
  'USER_UUID'::uuid,
  CALCULATED_INCLUDED_REMAINDER,
  'Reconciled from ledger export and Stripe invoices through YYYY-MM-DD; case TICKET-ID',
  'OPERATOR_USER_UUID'::uuid
);
```

The function only accepts an unclassified wallet, locks it, validates that the
included amount does not exceed the balance, and writes an immutable row to
`credit_bucket_classifications`. A second classification attempt fails.

## When history cannot establish the allocation

Never estimate from the plan grant or silently expire the whole balance. Choose
one of these explicit outcomes:

- Preferred: hold the renewal, contact the customer or recover the missing
  Stripe/ledger records, then classify from evidence.
- If the renewal must proceed and the allocation is genuinely unknowable,
  classify `p_remaining = 0`. This treats the entire current balance as
  purchased/non-expiring credit. It may preserve some old included credit as a
  customer-favourable windfall, but it cannot erase purchased credit. Record the
  evidence gap, approving operator, date, and support/change ticket in `p_reason`.

Do not classify the entire balance as included merely to unblock renewal: the
next renewal would expire it and recreate the original purchased-credit loss.

## Release checks

```sql
-- Must be zero before allowing affected invoice retries.
SELECT count(*) AS unclassified_positive_wallets
FROM public.credit_accounts
WHERE balance_credits > 0 AND included_balance_credits IS NULL;

-- Review the audit trail.
SELECT *
FROM public.credit_bucket_classifications
ORDER BY classified_at, user_id;
```

Run the isolated database regression suite after migration. It must cover exact
invoice replay, a status event arriving before `invoice.paid`, out-of-order
invoices, concurrent spending/renewal, concurrent signup admission, RPC role
permissions, and rollback on database errors.
