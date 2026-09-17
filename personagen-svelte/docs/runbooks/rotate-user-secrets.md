# Runbook — rotating `USER_SECRETS_ENCRYPTION_KEY`

One environment secret, `USER_SECRETS_ENCRYPTION_KEY`, encrypts every provider
API key the platform stores on a user's behalf. Two tables hold that ciphertext,
and only these two:

| table                   | rows are                        | key column trio                  |
| ----------------------- | ------------------------------- | -------------------------------- |
| `public.user_api_keys`  | one per (user, provider)        | `encrypted_value`, `iv`, `auth_tag` |
| `public.zernio_keys`    | extra per-persona Zernio accounts | `encrypted_value`, `iv`, `auth_tag` |

Tool: `scripts/rotate-user-secrets.mjs`.

---

## Why this is dangerous to get wrong

A failed decrypt does not fail the request. Every caller swallows it and
falls back to the platform's own provider key:

```
src/lib/server/content/generate.ts:364,368   getUserApiKey(...).catch(() => null)
src/lib/server/ai-client.ts:163,169          getUserApiKey(...).catch(() => null)
```

That fallback is deliberate and unchanged. What changed (2026-09-17): the
failure is no longer invisible. `readStoredSecret()` in
`src/lib/server/user-api-keys.ts` — which `getUserApiKey` and
`getZernioKeySecretById` wrap — stamps the row `status='error'` with a short,
secret-free `last_error` before rethrowing, writes one `console.error` line,
and Settings → API keys shows both. Billing already attributes such a run to
the platform rate. So a half-finished rotation now shows up as every affected
key turning red in Settings and a log line per attempt — but it still produces
**no failed request**, and the spend still lands on the company's account until
somebody looks. Treat "the app is running fine" as **no evidence at all** that
a rotation worked.

That is why the script writes both tables in one transaction and refuses to
write anything at all unless every single row decrypts first.

---

## When to rotate

- The key leaked, or might have (a shared `.env`, a screenshot, a copied
  deployment, an ex-contractor's machine).
- Someone gained read access to the database or a backup dump and the key was
  ever stored near it.
- Routine hygiene, at most annually — there is no automatic schedule and no
  expiry; nothing in the system rotates this on its own.
- **Not** for a normal deploy, and **not** as part of restoring a backup.

Do not rotate and apply a schema migration in the same window. If something
breaks you want exactly one candidate.

---

## Before you start

- [ ] Take a backup: `npm run backup`, then `node scripts/backup-db.mjs --check-restore`.
- [ ] Know how to set env vars on the target deployment **and restart it**, and
      roughly how long a restart takes. That interval is your outage.
- [ ] Have the OLD key saved somewhere you can still reach if the flip goes
      wrong. Losing it before the rotation commits means losing every stored
      key permanently — there is no recovery, only asking every user to
      re-enter theirs.
- [ ] Generate the new key. Any of the three accepted forms works; prefer
      32 random bytes as base64:
      `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

The script reads the **old** key from `USER_SECRETS_ENCRYPTION_KEY` (exactly
where the app reads it) and the **new** key from `USER_SECRETS_ENCRYPTION_KEY_NEW`
(or `--new-key-env <VAR>`). It never guesses which is which, and refuses if the
two derive to the same AES key. Pass the new key through the environment, never
on the command line — argv is visible in the process list.

---

## Order of operations

The env var flips **after** the database write, never before. Between the two
steps the app is decrypting with a key the rows no longer use, so every BYOK
call fails-open onto the platform key. Keep that window as short as you can and
do it during low traffic.

**1. Prove it will work — writes nothing.**

```bash
export USER_SECRETS_ENCRYPTION_KEY_NEW='<the new key>'
node scripts/rotate-user-secrets.mjs --dry-run
```

This is the step that matters. It decrypts every row with the old key,
re-encrypts with the new one, and verifies the result round-trips — all in
memory. Expected tail:

```
totals   5 row(s) · 5 to rotate · 0 already rotated · 0 FAILED
DRY RUN complete · 5 row(s) would be rewritten · nothing was written.
```

Any `FAILED` row stops here. Do **not** proceed. See *If a row will not
decrypt* below.

**2. Rotate the stored rows.** One transaction, both tables, all or nothing.

```bash
node scripts/rotate-user-secrets.mjs --commit
```

Wait for `commit … ok`. If it errors, nothing was written — the database is
exactly as it was, and the old key is still correct. Fix and re-run.

**3. Flip the environment variable.** Only now. Set
`USER_SECRETS_ENCRYPTION_KEY` to the new value in the deployment environment
and restart the app. The old value is now dead weight — but keep it for a few
days anyway (see rollback).

**4. Verify with a real decrypt.** Do not trust a quiet log.

- Sign in as a user who has a saved BYOK key, open **Settings → API keys**, and
  press **Test** on a saved provider. That path calls `getUserApiKey`, which
  decrypts for real — a green "valid" is proof; the masked value alone is not,
  it comes from a plaintext column and would look identical with the key
  completely wrong.
- Run one generation on a BYOK account and confirm the generation event is
  recorded as `byo`, not platform-paid.

**5. Clean up.** Remove `USER_SECRETS_ENCRYPTION_KEY_NEW` from wherever you
exported it, and your shell history.

---

## If it fails midway

**During `--dry-run`** — nothing has happened. The database is untouched and
the app is unaffected. Nothing to undo.

**During `--commit`, before `ok`** — the write is one transaction, so it either
committed or it did not; there is no in-between state to repair. The script
prints `ok` only after the transaction returns. If you did not see `ok`, assume
nothing was written, re-run `--dry-run` to confirm the rows still decrypt under
the old key, and start again. A `--commit` re-run is safe regardless: rows that
did land are detected as already-rotated and skipped.

**After `--commit`, before the env flip** — every BYOK call is silently falling
back to the platform key. Complete step 3. This is the window to keep short.

**After the env flip, and BYOK is broken** — roll back by putting the OLD key
back and restarting, then run the rotation in reverse:

```bash
USER_SECRETS_ENCRYPTION_KEY='<new key>' \
USER_SECRETS_ENCRYPTION_KEY_NEW='<old key>' \
  node scripts/rotate-user-secrets.mjs --dry-run   # then --commit
```

The script is symmetric — "old" and "new" are just the two variables — so this
walks the rows back. Then restart with the old key in place.

**If a row will not decrypt** under either key, it was encrypted with a key
nobody has (a restored dump from a different environment, a key lost in an
earlier incident). That row is unrecoverable; no rotation will fix it. Either
delete it and ask that user to re-enter their key in Settings, or exclude the
table with `--table` and handle it separately. The script will keep refusing to
write while it is there — that refusal is the feature.

---

## Related: the column-grant migrations

Two migrations narrow who may read these tables.

**Stage A** — `supabase/user_api_keys_column_grants_migration.sql`, applied
2026-09-15 — removes `anon` entirely and strips `TRUNCATE` from
`authenticated` (which RLS does not govern, and which would have let any
signed-in role empty both key tables). It left `SELECT` table-wide on purpose
and carried stage B as a commented-out block.

**Stage B** — `supabase/user_api_keys_secret_columns_migration.sql`, written
2026-09-17 as live SQL — revokes the table-wide `SELECT` from `authenticated`
and re-grants exactly the non-secret columns, so a user cannot read even their
own ciphertext. Its prerequisite is now met in this repository:

- every read of `encrypted_value, iv, auth_tag` goes through the service-role
  client, scoped by `user_id`, whatever client the caller passed in —
  `readStoredSecret()` in `src/lib/server/user-api-keys.ts`, which
  `getUserApiKey()`, `getZernioKeySecretById()` and the Zernio key "test"
  route now use. The three `authenticated`-role secret reads named above no
  longer exist; function signatures are unchanged, so no caller moved;
- a decrypt failure stamps the row `status='error'` with a secret-free
  `last_error` before rethrowing (see *Why this is dangerous to get wrong*).

The migration is therefore **safe to apply**: `node scripts/apply-migration.mjs
supabase/user_api_keys_secret_columns_migration.sql` once it is committed and
registered in `supabase/migrations.json`. Not in the same window as a key
rotation. Rollback is two `GRANT SELECT ON TABLE … TO authenticated` lines
(in the file's header). After applying, the *Verify with a real decrypt* step
above is the proof: Settings → API keys → **Test** still runs a real decrypt,
now through the service role.

Two specs enforce this. `src/lib/server/user-secrets-rotation.spec.ts` proves
stage A's file still contains no column-level `SELECT` change and that its
commented stage-B block names exactly the secret three.
`src/lib/server/user-api-keys-service-read.spec.ts` proves the live stage-B
file grants exactly the non-secret columns (derived from `client_bootstrap.sql`,
so a new column fails the test), that the secret reads happen on the service
client, that a bad ciphertext throws and stamps the row without leaking a
fragment of it, and that no query in `src/` selects a secret column outside
the service-routed readers or uses `select('*')` on either table.
