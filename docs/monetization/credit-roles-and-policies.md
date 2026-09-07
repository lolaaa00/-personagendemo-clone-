# PersonaGen — Credit System × User Roles: the policy set

**Date:** 2026-09-07
**Question answered:** does the credit system line up with the users, roles and administrative model the app already has, and is every role's database policy actually in place?
**Method:** dumped RLS state, table grants, policies and function privileges from production; wrote a role-impersonating verifier (`scripts/verify-roles-db.mjs`, rollback-wrapped, safe on production) that runs each assertion as `anon`, as each seat, as an owner, an outsider and a platform admin; closed the gaps in `credit_roles_policies_migration.sql`; reran.

---

## 1. The roles the app actually has

| role | how it is defined | relationship to money |
|---|---|---|
| anonymous | no session | none — must see nothing |
| personal user | `auth.users` row, no workspace | owns a wallet; pays for their own personas |
| workspace owner | `workspaces.owner_id` | **owner pays**: every persona in the workspace debits the owner's wallet, whoever pressed Generate |
| admin seat | `workspace_members.role = 'admin'` | manages seats and spend limits; sees the workspace's generation events; is gated on the owner's wallet when generating |
| creator seat | `workspace_members.role = 'creator'` | generates against workspace personas; gated on the owner's wallet and on their own seat cap |
| platform admin | `platform_admins` row (or env bootstrap) | cross-tenant operator: grants, sets, switches, timelines — always through the service role, never through table policies |
| service role | the server | bypasses RLS; the only writer of wallets, ledger and settings |

Billing account resolution (`resolveBillingAccount`): workspace persona → workspace owner; personal persona → persona owner; no persona → the actor. The gate (`assertCreditsAvailable`) and the debit both use it, so what is checked is what is charged.

---

## 2. Policy matrix (production, after the migration)

| object | anon | personal / seat (authenticated) | owner | platform admin | service |
|---|---|---|---|---|---|
| `credit_accounts` | no privilege | SELECT own row | SELECT own row | via service | all |
| `workspace_wallets()` | no privilege | balance + mode of each workspace they belong to | own wallet, role `owner` | via service | all |
| `credit_ledger` | no privilege | SELECT own rows | SELECT own rows | via service | all |
| `generation_events` | no privilege | SELECT own rows, rows billed to them, rows of personas they manage (admin seat); INSERT own rows billing self or the persona's workspace owner | SELECT everything billed to them | via service | all |
| `subscriptions` | no privilege | SELECT own row | SELECT own row | via service | all |
| `user_activity_events` | no privilege | SELECT own rows | SELECT own rows | via service (identity resolved at render) | all |
| `user_presence`, `user_activity_daily` | none | none | none | via service | all |
| `platform_settings`, `platform_settings_history`, `platform_admins`, `schema_migrations` | none | none | none | via service (`/api/admin/*` gate) | all |
| `credit_apply`, `credit_set_mode`, `platform_setting_set`, `admin_auth_events`, `anonymize_user_activity`, roll-up / prune / partition functions | no execute | no execute | no execute | via service | execute |
| `is_platform_admin(uuid)` | no execute | execute, answers only for the caller | same | same | execute for any id |
| `handle_new_user()` | trigger only | trigger only | trigger only | trigger only | trigger only |

App-level gates on top: `/api/admin/credits`, `/api/admin/settings`, `/api/admin/activity`, `/models` require `requirePlatformAdmin`; the Workspace group of the Admin Console requires workspace owner or admin seat; `/billing` and the pill are per user.

---

## 3. What was wrong before, and what changed

| finding | risk | fix |
|---|---|---|
| `anon` held DELETE / INSERT / UPDATE / TRUNCATE on `credit_accounts`, `generation_events`, `subscriptions` and SELECT on the ledger and activity log. RLS blocked the DML, but TRUNCATE is not governed by RLS. | a leaked anon key plus any path that reaches SQL could empty a money table | all privileges revoked from `anon` and `PUBLIC` on the money tables |
| `authenticated` held UPDATE / DELETE / TRUNCATE on wallets, events, subscriptions | same class; append-only invariant (D3) held only by policy, not by privilege | privileges cut to exactly what the app uses: SELECT on wallets, ledger, subscriptions, activity; SELECT + INSERT on events |
| `is_platform_admin(uuid)` executable by anyone for any id | any visitor could enumerate which ids are platform admins | answers only for `auth.uid()` (service role, with no uid, may ask about anyone); execute revoked from `anon` / `PUBLIC` |
| a creator seat is gated on the owner's wallet but could not see it; the 402 sent them to top up their own wallet | confusing wall, no way to know why a run is refused | `workspace_wallets()` (SECURITY DEFINER, balance + mode only); Billing page section "Workspace wallets you draw on"; the 402 names the workspace owner as payer |
| `generation_events` INSERT let a client bill any `billed_user_id` | a user could pin phantom events on a stranger's account | insert may bill self or the persona's workspace owner only |
| owners could not see events billed to them for personas they did not manage directly | owner's Spend view could miss what they paid for | SELECT policy adds `billed_user_id = auth.uid()` |
| seat spend cap compared **raw** provider cost to a limit the owner sets in the same money the wallet shows (retail) | at 3× markup a seat could spend three times its cap from the owner's wallet | cap measured at retail (`est_cost × credit_markup`) |

Verified after the migration: 23 / 23 role assertions, 15 / 15 credit assertions, 9 / 9 activity assertions, all rolled back on production.

---

## 4. Alignment verdict

The credit system matches the existing user and role model without inventing a new one: the wallet is a property of the user, the workspace inherits the owner's wallet, seats are gated on it and can see it, admins manage seats and see spend, and the platform admin acts only through the server. What was missing was privilege hygiene and the seat's view of the wallet it draws on; both are now in place and proven by a verifier that runs as each role.

Left as design notes, not defects:
- Seat spend caps count BYO-key generations at their retail equivalent even though they cost the platform nothing; owners who hand seats their own provider keys may want a "BYO does not count" toggle later.
- Platform-admin actions are audited in the activity log and `platform_settings_history`; there is no second approver. Fine for two admins; revisit at ten.
