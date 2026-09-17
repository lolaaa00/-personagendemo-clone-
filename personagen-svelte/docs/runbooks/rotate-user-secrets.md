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

A failed decrypt does not surface as an error. Every caller swallows it and
falls back to the platform's own provider key:

```
src/lib/server/content/generate.ts:364,368   getUserApiKey(...).catch(() => null)
src/lib/server/ai-client.ts:163,169          getUserApiKey(...).catch(() => null)
```

So a half-finished rotation produces **no alarm, no failed request, and no log
line**. It just moves every affected user's spend onto the company's account
until somebody notices the bill. Treat "the app is running fine" as **no
evidence at all** that a rotation worked.

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

## Related: the column-grant migration

`supabase/user_api_keys_column_grants_migration.sql` is a separate change that
narrows who may read these tables. Stage A (live in that file) removes `anon`
entirely and strips `TRUNCATE` from `authenticated` — which RLS does not
govern, and which today would let any signed-in role empty both key tables.

Stage B — revoking `SELECT` on `encrypted_value`, `iv` and `auth_tag` from
`authenticated`, so a user cannot read even their own ciphertext — is written
out in that file but **commented out and must stay that way** until a code
change lands first. The server currently decrypts through `locals.supabase`,
which connects as the `authenticated` role:

```
src/lib/server/user-api-keys.ts:100
src/lib/server/zernio-keys.ts:35
src/routes/api/settings/zernio-keys/+server.ts:124
```

Postgres cannot distinguish that from the browser reading its own row. Applying
stage B today would break every BYOK generation, and — via the same
`.catch(() => null)` fallbacks above — break it silently onto the platform's
key. Move those three reads to the service-role client and make the failure
loud, then copy stage B into a new migration.

`src/lib/server/user-secrets-rotation.spec.ts` enforces both halves: that stage
B names exactly the three secret columns and re-grants exactly the others
(derived from the `CREATE TABLE` statements, so a new column fails the test),
and that the active SQL still contains no column-level `SELECT` change.
