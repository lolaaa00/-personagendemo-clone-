# Who can create an account, and what they get

**2026-09-09.** Every statement below was measured against production, not read
off the code.

## What is true right now

Registration is open on **both** doors.

| Door | State | Evidence |
|---|---|---|
| `POST <supabase>/auth/v1/signup` with the public anon key | **open** | returned 200 with a session and a usable access token |
| `POST /api/auth/signup` (the app's own route) with no PIN | **open** | returned 200 and created the account |

The anon key ships inside the browser bundle, so the first door is available to
anyone who opens developer tools. `ADMIN_PIN` is not set in the production
environment, so the second door asks for nothing either.

Before today, either door minted **1000 welcome credits** — roughly $10 of
retail generation — limited only by `signup_credits_hourly_cap`, which allows 20
welcome grants per hour platform-wide.

## What changed

The welcome credit now comes from the signup route, not from the database
trigger. An account created straight against GoTrue gets a profile, a free
subscription and an empty wallet. In enforce mode an empty wallet generates
nothing, so the bypass is no longer worth anything.

This **empties** the hole. It does not close it: accounts can still be created
without permission, and the app's own route still funds every account it
creates, because nothing is asking the visitor for admission.

### Why the grant had to move

The obvious fix was to mark accounts the route creates and have the trigger
check the mark. That cannot work, and the reason is worth remembering:

> GoTrue inserts the `auth.users` row and applies `app_metadata` in a **second
> step**. An `AFTER INSERT` trigger runs before the marker exists.

Both halves were measured. A row inserted by hand carrying the marker, inside a
rolled-back transaction, granted 1000. A real `admin.createUser` carrying
`app_metadata: {invited: true}` ended with the marker stored and the wallet
empty.

The marker is still set and is still the right channel — a client that sends its
own `app_metadata` has it land in `raw_user_meta_data` and ignored — but the
grant itself belongs to the route.

## The two operator actions

Neither can be done from this repository.

1. **Disable public signups on the Supabase project.**
   Set `GOTRUE_DISABLE_SIGNUP=true` on the Supabase service environment in
   EasyPanel and restart it. The app does not need it: `/api/auth/signup`
   creates users with the service role, which is unaffected by that flag.

2. **Set `ADMIN_PIN` on the app service.**
   Until it is set, the app's own registration form admits anyone. The route
   already rate-limits PIN attempts to 10 per 15 minutes per address and
   compares in constant time; it just has no secret to compare against.

Do them in that order. Reversing it leaves the anon-key door open while the
front door is shut, which is the worse half.

## What is still guarding the money

- **The grant only happens on the route.** A GoTrue-created account is unfunded.
- **`signup_credits_require_invite`** (platform setting, default true, visible in
  the Admin Console). Setting it false hands the grant back to the trigger, so
  every account is funded again — that is the switch to use if open signups with
  credit are ever wanted, and it is the only supported way to get that.
- **`signup_credits_hourly_cap`** (default 20). Platform-wide, still enforced.
- **The per-address clawback.** A second account created from the same daily
  salted IP hash has its welcome credit taken back within a second as an audited
  adjustment. Confirmed live: it fired on repeated test signups from one address
  and left the wallet at zero.

A single grant and its clawback both appear in `credit_ledger`, so this is
visible after the fact rather than only in logs.

## Checking it yourself

```
npm run smoke:live
```

Two of its checks cover this: the signup route must grant and mark the account,
and an account created straight against GoTrue with the anon key must end with
no wallet at all.
