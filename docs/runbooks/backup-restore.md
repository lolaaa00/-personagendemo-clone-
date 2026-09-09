# Backup and restore

**Before 2026-09-09 there was no backup of any kind.** 20 MB held every account,
every credit balance, the whole ledger and the encrypted provider keys. A lost
volume would have lost the business, not a deployment.

## Take one

```
cd personagen-svelte
npm run backup
```

Writes `backup/<timestamp>/` — one JSON file per table, `auth_users.json`, and a
`manifest.json` recording row counts plus the migration ledger head at capture.
It verifies itself immediately after writing.

`backup/` is gitignored. **The files hold password hashes and encrypted provider
keys.** The ciphertext only: the passphrase lives in the server environment and
never in the database, so a stolen backup alone cannot decrypt the keys. Copy a
backup somewhere off this machine; that copy is as sensitive as the database.

## Check one you already have

```
npm run backup:verify           # files match the manifest
npm run backup:check-restore    # the rows still convert into the live schema
```

`backup:verify` re-reads every file and compares it to the manifest — it catches
a dropped row, a truncated file, a deleted file.

`backup:check-restore` is the one that matters. It runs the **same**
`json_populate_recordset` conversion a restore would, as a SELECT, so Postgres
performs every cast against the live schema and throws the result away. Nothing
is written. A column that has changed type fails here instead of during an
outage, and a column the schema has since dropped is named, because that
conversion would otherwise discard it in silence.

Both exit non-zero on a problem, so either can be a cron check.

## Restore

```
npm run backup:sql              # writes restore.sql into the backup directory
```

Then, against the **empty** replacement database:

1. Run `supabase/client_bootstrap.sql` first. Check its migration count matches
   the header of `restore.sql` — a mismatch means you are putting data back into
   a different schema than it came from.
2. Read `restore.sql`. It is not executed for you.
3. `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f restore.sql`

Every row goes back through `json_populate_recordset(null::public.<table>, …)`,
so Postgres does the type coercion. No hand-written literal has to be right about
arrays, jsonb, timestamps or enums. Foreign keys are deferred for the load with
`session_replication_role = replica`, which removes load order as a question.
`auth.users` is inserted first regardless, because everything else points at it.

## What a backup does not contain

- **Storage objects.** Generated images and video live in the storage bucket, not
  in Postgres. Post rows will point at URLs that a restored database cannot serve
  unless the bucket survived too.
- **Server environment.** `SECRET_KEY_BASE` and the platform provider keys are in
  the EasyPanel environment. Without them the encrypted key columns are
  unreadable ciphertext, and users would have to re-enter their own keys.
- **GoTrue's own tables** beyond `auth.users`. Sessions and refresh tokens are not
  captured; everyone signs in again after a restore.

## Cadence

Nothing schedules this yet. Run it before every migration and before any
EasyPanel change that touches the database service. A weekly cron calling
`npm run backup && npm run backup:check-restore` would be the next improvement.
